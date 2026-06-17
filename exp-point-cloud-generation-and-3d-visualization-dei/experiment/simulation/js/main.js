/* ================================================================
   EXPERIMENT 3 — POINT CLOUD GENERATION & 3D VISUALISATION
   main.js — Three.js 3D setup scene + 2D/3D simulation canvases
   ================================================================

   ARCHITECTURE
   ────────────
   SETUP PAGE
     ThreeScene   → renderer, camera, orbit controls, lab equipment
     Components   → tracks mounted equipment (sensor, mount, cube, wall)
     ScanCapture  → stores captured depth-frame configurations
     SetupWizard  → step navigation (0→4)

   SIMULATION PAGE
     SimState     → live parameter values (resolution, Z, noise, fx, edge)
     render*()    → depth map, 3D cloud (rotatable), top view, density curve
     WizardSim    → 4-step guided walkthrough

   CORE MATH (Experiment 3 theory)
   ────────────────────────────────
     Back-projection:   X = (u-cx)*Z/fx,  Y = (v-cy)*Z/fy,  Z = depth(u,v)
     Point count:        N = W * H
     Point spacing:       Δs = Z / fx
     Noise model:         Z_measured = Z_true + N(0, σ²)
     Cloud density:        ρ = N_valid / A_surface
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */

const MOUNTED = { sensor: false, mount: false, object: false, backdrop: false };

const SCANS = [];   /* array of {res, cubeZ, cubeOffset} captured in setup */

/* Resolution presets used both in setup and simulation */
const RES_PRESETS = [
  { w: 160,  h: 120,  label: '160×120'   },
  { w: 320,  h: 240,  label: '320×240'   },
  { w: 640,  h: 480,  label: '640×480'   },
  { w: 1280, h: 960,  label: '1280×960'  },
];

const SIM = {
  resIdx: 1,     /* index into RES_PRESETS               */
  Z:      1.5,   /* object distance in metres             */
  noise:  3,     /* sigma in mm                           */
  fx:     700,   /* focal length in px                    */
  edge:   1,     /* edge discontinuity / flying pixel knob */
  step:   0,     /* wizard step                           */
};

/* setup-page scene controls (cube placement) */
let cubeZ = 1.5, cubeOffset = 0, setupResIdx = 1;

/* Wizard content for simulation page */
const SIM_WIZARD = [
  {
    title: 'Vary Resolution',
    text:  'Point count equals width times height. Doubling both dimensions quadruples the cloud size. Watch the 3D cloud density change as you move this slider.',
    task:  '▶ Step through all 4 resolution presets and watch total points change.',
    lit:   'pg-res',
  },
  {
    title: 'Move the Object',
    text:  'Point spacing Δs = Z/fx grows linearly with distance. The same sensor produces a much sparser cloud on a far object than a near one, even at fixed resolution.',
    task:  '▶ Drag Z from 0.5m to 6m. Watch spacing grow and density fall on the right panel.',
    lit:   'pg-Z',
  },
  {
    title: 'Inject Sensor Noise',
    text:  'Noise adds a random Gaussian deviation directly to the true depth value before back-projection. RMSE scales linearly with σ — double the noise, double the error.',
    task:  '▶ Set σ = 30mm on a flat region and watch the 3D cloud turn wavy.',
    lit:   'pg-noise',
  },
  {
    title: 'Explore Calibration Error',
    text:  'An incorrect focal length stretches or compresses every X and Y coordinate proportionally. This connects directly back to why Experiment 2 calibration matters here.',
    task:  '▶ Set fx to 350 (half of true 700) and watch the cube appear to double in width.',
    lit:   'pg-fx',
  },
];

/* ──────────────────────────────────────────────────────────────
   UTILITIES
────────────────────────────────────────────────────────────── */

function gauss() {
  const u1 = Math.max(1e-12, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function fmtNum(n) {
  return n.toLocaleString('en-IN');
}

function currentRes() { return RES_PRESETS[SIM.resIdx]; }
function setupRes()   { return RES_PRESETS[setupResIdx]; }

/* ──────────────────────────────────────────────────────────────
   THREE.JS SCENE — SETUP PAGE
────────────────────────────────────────────────────────────── */

let renderer, scene, camera, animFrame;
let sensorMesh, mountMesh, cubeMesh, wallMesh, fovHelper, scanPlane;
let orbitTarget = new THREE.Vector3(0, 0.6, -0.5);
let isDragging = false, lastMouse = {x:0, y:0};
let phi = Math.PI/4, theta = Math.PI/4, radius = 5.0;
let currentView = 'iso';

function initThree() {
  const canvas = document.getElementById('three-canvas');
  const wrap   = canvas.parentElement;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xe8edf5, 1);
  resizeRenderer();

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe8edf5, 9, 20);

  camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 30);
  setViewISO();

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(4, 6, 3);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0x9dc8f0, 0.35);
  fillLight.position.set(-3, 2, -2);
  scene.add(fillLight);

  const groundGeo = new THREE.PlaneGeometry(10, 10);
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xd8dfe8 });
  const ground    = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(10, 20, 0xb8c4d4, 0xccd5e0);
  grid.material.opacity = 0.5;
  grid.material.transparent = true;
  scene.add(grid);

  buildMountMesh();
  buildSensorMesh();
  buildCubeMesh();
  buildWallMesh();
  buildFOVHelper();
  buildScanPlane();

  setupOrbitControls(canvas);
  window.addEventListener('resize', resizeRenderer);

  animateThree();
}

function resizeRenderer() {
  const wrap = document.getElementById('three-canvas').parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  if (camera) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}

function animateThree() {
  animFrame = requestAnimationFrame(animateThree);
  if (cubeMesh && cubeMesh.visible) {
    cubeMesh.rotation.y += 0.0025;
  }
  updateCameraPosition();
  renderer.render(scene, camera);
}

function updateCameraPosition() {
  const x = orbitTarget.x + radius * Math.sin(phi) * Math.sin(theta);
  const y = orbitTarget.y + radius * Math.cos(theta);
  const z = orbitTarget.z + radius * Math.cos(phi) * Math.sin(theta);
  camera.position.set(x, y, z);
  camera.lookAt(orbitTarget);
}

function setViewISO()   { phi = Math.PI/4;  theta = Math.PI/4;  radius = 5.0; }
function setViewTop()   { phi = 0;          theta = 0.01;       radius = 5.6; }
function setViewFront() { phi = 0;          theta = Math.PI/2;  radius = 5.0; }
function setViewSide()  { phi = Math.PI/2;  theta = Math.PI/2;  radius = 5.0; }

function setupOrbitControls(canvas) {
  canvas.addEventListener('mousedown', e => { isDragging = true; lastMouse = {x:e.clientX, y:e.clientY}; });
  window.addEventListener('mouseup', () => { isDragging = false; });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse = {x:e.clientX, y:e.clientY};

    if (e.buttons === 1) {
      phi   -= dx * 0.008;
      theta  = Math.max(0.05, Math.min(Math.PI-0.05, theta + dy * 0.008));
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    } else if (e.buttons === 2) {
      orbitTarget.x -= dx * 0.004;
      orbitTarget.y += dy * 0.004;
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    radius = Math.max(2, Math.min(10, radius + e.deltaY * 0.005));
  }, { passive: false });

  let lastTouchDist = 0, lastTouch = null;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { isDragging = true; lastTouch = {x:e.touches[0].clientX, y:e.touches[0].clientY}; }
    else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  });
  canvas.addEventListener('touchend', () => { isDragging = false; lastTouch = null; });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging && lastTouch) {
      const dx = e.touches[0].clientX - lastTouch.x;
      const dy = e.touches[0].clientY - lastTouch.y;
      lastTouch = {x:e.touches[0].clientX, y:e.touches[0].clientY};
      phi -= dx * 0.01;
      theta = Math.max(0.05, Math.min(Math.PI-0.05, theta + dy * 0.01));
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      radius = Math.max(2, Math.min(10, radius * (lastTouchDist / dist)));
      lastTouchDist = dist;
    }
  }, { passive: false });
}

/* ── Mesh builders ─────────────────────────────────────────── */

function buildMountMesh() {
  mountMesh = new THREE.Group();

  const baseGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.03, 16);
  const baseMat = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 50 });
  const base    = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.015;
  mountMesh.add(base);

  const armGeo = new THREE.CylinderGeometry(0.018, 0.018, 1.25, 10);
  const armMat = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, shininess: 70 });
  const arm    = new THREE.Mesh(armGeo, armMat);
  arm.position.y = 0.66;
  arm.castShadow = true;
  mountMesh.add(arm);

  const plateGeo = new THREE.BoxGeometry(0.2, 0.03, 0.14);
  const plateMat = new THREE.MeshPhongMaterial({ color: 0x555555, shininess: 60 });
  const plate    = new THREE.Mesh(plateGeo, plateMat);
  plate.position.y = 1.3;
  mountMesh.add(plate);

  mountMesh.visible = false;
  scene.add(mountMesh);
}

function buildSensorMesh() {
  sensorMesh = new THREE.Group();

  const bodyGeo = new THREE.BoxGeometry(0.26, 0.07, 0.07);
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0x1c1c1c, shininess: 40 });
  const body    = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  sensorMesh.add(body);

  /* two IR lenses + one RGB lens (typical RGB-D layout) */
  const lensMat = new THREE.MeshPhongMaterial({ color: 0x0a1a2e, shininess: 180 });
  [-0.08, 0, 0.08].forEach(xOff => {
    const lensGeo = new THREE.CylinderGeometry(0.018, 0.02, 0.025, 16);
    const lens    = new THREE.Mesh(lensGeo, lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(xOff, 0, 0.045);
    sensorMesh.add(lens);

    const glassGeo = new THREE.CircleGeometry(0.015, 16);
    const glassMat = new THREE.MeshPhongMaterial({ color: 0x2a4a6a, shininess: 220, transparent: true, opacity: 0.85 });
    const glass    = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(xOff, 0, 0.058);
    sensorMesh.add(glass);
  });

  /* status LED */
  const ledGeo = new THREE.SphereGeometry(0.006, 8, 8);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  const led    = new THREE.Mesh(ledGeo, ledMat);
  led.position.set(0, 0.03, 0.036);
  sensorMesh.add(led);

  sensorMesh.position.set(0, 1.33, 0.04);
  sensorMesh.visible = false;
  scene.add(sensorMesh);
}

function buildCubeMesh() {
  cubeMesh = new THREE.Group();

  const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const mat = new THREE.MeshPhongMaterial({ color: 0xf59e0b, shininess: 30 });
  const box = new THREE.Mesh(geo, mat);
  box.castShadow = true;
  box.receiveShadow = true;
  cubeMesh.add(box);

  /* edge wireframe for clarity */
  const edgesGeo = new THREE.EdgesGeometry(geo);
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x92400e, linewidth: 2 });
  const edges    = new THREE.LineSegments(edgesGeo, edgesMat);
  cubeMesh.add(edges);

  cubeMesh.position.set(0, 0.4, -cubeZ);
  cubeMesh.visible = false;
  scene.add(cubeMesh);
}

function buildWallMesh() {
  const geo = new THREE.PlaneGeometry(4, 2.4);
  const mat = new THREE.MeshLambertMaterial({ color: 0xc7d2fe, side: THREE.DoubleSide });
  wallMesh  = new THREE.Mesh(geo, mat);
  wallMesh.position.set(0, 1.2, -8);
  wallMesh.receiveShadow = true;
  wallMesh.visible = false;
  scene.add(wallMesh);

  /* subtle grid pattern on wall to show it's a measurable surface */
  const gridGeo = new THREE.PlaneGeometry(4, 2.4, 16, 10);
  const gridMat = new THREE.MeshBasicMaterial({ color: 0x818cf8, wireframe: true, transparent: true, opacity: 0.3 });
  const gridMesh = new THREE.Mesh(gridGeo, gridMat);
  gridMesh.position.copy(wallMesh.position);
  gridMesh.position.z += 0.01;
  gridMesh.visible = false;
  wallMesh.userData.gridMesh = gridMesh;
  scene.add(gridMesh);
}

function buildFOVHelper() {
  const coneGeo = new THREE.ConeGeometry(0.7, 1.3, 20, 1, true);
  const coneMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.07, side: THREE.DoubleSide });
  fovHelper = new THREE.Mesh(coneGeo, coneMat);
  fovHelper.position.set(0, 1.33, -0.65);
  fovHelper.rotation.x = -Math.PI / 2;

  const wfGeo = new THREE.ConeGeometry(0.7, 1.3, 4, 1, true);
  const wfMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, wireframe: true, transparent: true, opacity: 0.25 });
  fovHelper.add(new THREE.Mesh(wfGeo, wfMat));

  fovHelper.visible = false;
  scene.add(fovHelper);
}

function buildScanPlane() {
  /* visual indicator plane that "flashes" when a scan is captured */
  const geo = new THREE.PlaneGeometry(1.4, 1.0);
  const mat = new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0 });
  scanPlane = new THREE.Mesh(geo, mat);
  scanPlane.position.set(0, 0.9, -cubeZ * 0.5);
  scene.add(scanPlane);
}

function updateCubeTransform() {
  if (!cubeMesh) return;
  cubeMesh.position.z = -cubeZ;
  cubeMesh.position.x = cubeOffset / 100;
  scanPlane.position.z = -cubeZ * 0.5;

  /* obs overlay live update */
  const res = setupRes();
  const spacingMm = (cubeZ / 700) * 1000; /* assuming fx=700 */
  document.getElementById('obs-pixels').textContent  = fmtNum(res.w * res.h);
  document.getElementById('obs-spacing').textContent = spacingMm.toFixed(1) + ' mm';
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — STEP NAVIGATION
────────────────────────────────────────────────────────────── */

let currentSetupStep = 0;

function gotoSetupStep(n) {
  n = Math.max(0, Math.min(4, n));
  currentSetupStep = n;

  document.querySelectorAll('.step-content').forEach((el, i) => el.classList.toggle('active', i === n));
  document.querySelectorAll('.sstep').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i === n) el.classList.add('active');
    if (i < n)  el.classList.add('done');
  });

  document.getElementById('obs-overlay').style.display = n === 4 ? 'block' : 'none';

  if (n >= 4) {
    document.getElementById('btn-go-sim').disabled = false;
    computeAndDisplayResults();
  }
}

/* ──────────────────────────────────────────────────────────────
   COMPONENT MOUNTING
────────────────────────────────────────────────────────────── */

function mountComponent(name) {
  MOUNTED[name] = true;

  switch (name) {
    case 'sensor':
      sensorMesh.visible = true;
      fovHelper.visible  = true;
      break;
    case 'mount':
      mountMesh.visible = true;
      break;
    case 'object':
      cubeMesh.visible = true;
      updateCubeTransform();
      break;
    case 'backdrop':
      wallMesh.visible = true;
      wallMesh.userData.gridMesh.visible = true;
      break;
  }

  const btn = document.querySelector(`.btn-mount[data-comp="${name}"]`);
  if (btn) { btn.textContent = 'Mounted'; btn.classList.add('mounted'); }

  const card = document.querySelector(`.comp-card[data-comp="${name}"]`);
  if (card) card.classList.add('mounted');

  const allMounted = Object.values(MOUNTED).every(Boolean);
  if (allMounted && currentSetupStep === 0) {
    setTimeout(() => gotoSetupStep(1), 400);
  }
}

function mountAll() { Object.keys(MOUNTED).forEach(mountComponent); }

/* ──────────────────────────────────────────────────────────────
   SCAN CAPTURE (Setup Step 3)
────────────────────────────────────────────────────────────── */

function captureScan() {
  /* flash the scan plane */
  scanPlane.material.opacity = 0.5;
  let fadeStep = 0;
  const fadeInterval = setInterval(() => {
    fadeStep++;
    scanPlane.material.opacity = Math.max(0, 0.5 - fadeStep * 0.08);
    if (fadeStep > 6) clearInterval(fadeInterval);
  }, 40);

  const res = setupRes();
  SCANS.push({ res: { ...res }, cubeZ, cubeOffset });

  const count = SCANS.length;
  document.getElementById('scan-count').textContent = count;
  document.getElementById('scan-fill').style.width = Math.min(100, count / 5 * 100) + '%';

  addScanThumbnail(count, res, cubeZ);

  /* live observation computations */
  const totalPx   = res.w * res.h;
  const spacingMm = (cubeZ / 700) * 1000;
  const validPct  = 0.94 + Math.random() * 0.04;
  const validPx   = Math.round(totalPx * validPct);

  document.getElementById('obs-pixels').textContent = fmtNum(totalPx);
  document.getElementById('obs-valid').textContent  = fmtNum(validPx) + ` (${(validPct*100).toFixed(1)}%)`;
  document.getElementById('obs-points').textContent = fmtNum(validPx);
  document.getElementById('obs-spacing').textContent = spacingMm.toFixed(1) + ' mm';

  if (count >= 1) document.getElementById('btn-next-obs').disabled = false;
}

function addScanThumbnail(index, res, z) {
  const grid = document.getElementById('scan-grid');
  const wrap = document.createElement('div');
  wrap.className = 'scan-thumb';
  const c = document.createElement('canvas');
  c.width = 40; c.height = 40;
  drawMiniDepthThumb(c, z, index);
  wrap.appendChild(c);
  grid.appendChild(wrap);
}

function drawMiniDepthThumb(canvas, z, idx) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const hue = Math.max(0, 240 - (z / 8) * 240);
  ctx.fillStyle = `hsl(${hue}, 70%, 55%)`;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.font = 'bold 9px sans-serif';
  ctx.fillText(`S${idx}`, 2, 9);
}

/* ──────────────────────────────────────────────────────────────
   SETUP STEP 4 — RESULTS DISPLAY
────────────────────────────────────────────────────────────── */

function computeAndDisplayResults() {
  const lastScan = SCANS[SCANS.length - 1] || { res: setupRes(), cubeZ, cubeOffset };
  const { res } = lastScan;
  const z = lastScan.cubeZ;

  const totalPoints = res.w * res.h;
  const spacingMm   = (z / 700) * 1000;
  const fovWidthM   = (res.w / 700) * z * 2; /* rough physical width at depth z */
  const fovHeightM  = (res.h / 700) * z * 2;
  const surfaceArea = fovWidthM * fovHeightM;
  const density     = totalPoints / Math.max(surfaceArea, 0.01);
  const flyingPx     = Math.round(totalPoints * 0.003 * (1 + Math.random()));

  document.getElementById('r-points').textContent  = fmtNum(totalPoints);
  document.getElementById('r-spacing').textContent = spacingMm.toFixed(1);
  document.getElementById('r-density').textContent = fmtNum(Math.round(density));
  document.getElementById('r-flying').textContent  = fmtNum(flyingPx);
  document.getElementById('r-bbox').textContent    =
    `${(0.4).toFixed(2)} × ${(0.4).toFixed(2)} × ${(z).toFixed(2)}`;
}

/* ──────────────────────────────────────────────────────────────
   PAGE SWITCHING
────────────────────────────────────────────────────────────── */

function showSimulation() {
  document.getElementById('page-setup').classList.remove('active');
  document.getElementById('page-sim').classList.add('active');
  cancelAnimationFrame(animFrame);
  initSimulation();
}

function showSetup() {
  document.getElementById('page-sim').classList.remove('active');
  document.getElementById('page-setup').classList.add('active');
  animateThree();
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION PAGE — CANVAS RENDERERS
────────────────────────────────────────────────────────────── */

/* Depth map: a cube-shaped near region against a far background,
   coloured by depth, with optional flying-pixel halo at the edge. */
function renderDepthMap(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || canvas.width;
  const H = canvas.offsetHeight || canvas.height;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

  const imgData = ctx.createImageData(W, H);
  const px = imgData.data;

  const bgZ = 8.0;
  const objZ = SIM.Z;
  const ox0 = Math.floor(W * 0.32), ox1 = Math.floor(W * 0.68);
  const oy0 = Math.floor(H * 0.28), oy1 = Math.floor(H * 0.78);

  const edgeBand = [0, 1, 3, 6][SIM.edge]; /* px width of ambiguous boundary */

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inObj = x >= ox0 && x <= ox1 && y >= oy0 && y <= oy1;

      const distToEdgeX = Math.min(Math.abs(x - ox0), Math.abs(x - ox1));
      const distToEdgeY = Math.min(Math.abs(y - oy0), Math.abs(y - oy1));
      const nearEdge = inObj && Math.min(distToEdgeX, distToEdgeY) < edgeBand;

      let z = inObj ? objZ : bgZ;

      /* flying pixel: blend depth between object and background near edge */
      if (nearEdge && edgeBand > 0) {
        z = (objZ + bgZ) / 2 + gauss() * 0.3;
      }

      /* sensor noise */
      z += gauss() * (SIM.noise / 1000);

      const t = Math.max(0, Math.min(1, z / 10));
      const hue = 240 - t * 240;
      const [r, g, b] = hslToRgb(hue / 360, 0.75, 0.5);

      px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox0, oy0, ox1-ox0, oy1-oy0);
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q-p)*6*t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q-p)*(2/3-t)*6;
      return p;
    };
    const q = l < 0.5 ? l*(1+s) : l+s-l*s;
    const p = 2*l-q;
    r = hue2rgb(p,q,h+1/3); g = hue2rgb(p,q,h); b = hue2rgb(p,q,h-1/3);
  }
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}

/* 3D rotatable point cloud rendered via simple isometric projection */
let cloudRotY = 0.6, cloudRotX = -0.3;
let cloudDragging = false, cloudLastMouse = {x:0,y:0};

function renderCloud3D(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || canvas.width;
  const H = canvas.offsetHeight || canvas.height;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  const res = currentRes();
  /* subsample for rendering performance — cap visual points */
  const stepX = Math.max(1, Math.floor(res.w / 48));
  const stepY = Math.max(1, Math.floor(res.h / 36));

  const cosY = Math.cos(cloudRotY), sinY = Math.sin(cloudRotY);
  const cosX = Math.cos(cloudRotX), sinX = Math.sin(cloudRotX);

  const objZ = SIM.Z;
  const fx = SIM.fx;
  const cx = res.w / 2, cy = res.h / 2;

  const ox0 = res.w * 0.32, ox1 = res.w * 0.68;
  const oy0 = res.h * 0.28, oy1 = res.h * 0.78;

  const pts = [];

  for (let v = 0; v < res.h; v += stepY) {
    for (let u = 0; u < res.w; u += stepX) {
      const inObj = u >= ox0 && u <= ox1 && v >= oy0 && v <= oy1;
      if (!inObj) continue; /* render object only for clarity */

      const noisyZ = objZ + gauss() * (SIM.noise / 1000);
      const X = (u - cx) * noisyZ / fx;
      const Y = (v - cy) * noisyZ / fx;
      const Z = noisyZ;

      /* rotate around Y then X */
      let x1 = X * cosY + Z * sinY;
      let z1 = -X * sinY + Z * cosY;
      let y1 = Y * cosX - z1 * sinX;
      let z2 = Y * sinX + z1 * cosX;

      const scale = 280;
      const px = W/2 + x1 * scale;
      const py = H/2 - y1 * scale;
      const depthSort = z2;

      pts.push({ px, py, depthSort, z: noisyZ });
    }
  }

  pts.sort((a,b) => b.depthSort - a.depthSort);

  pts.forEach(p => {
    const t = Math.max(0, Math.min(1, (p.z - (objZ-0.15)) / 0.3));
    const hue = 30 + t * 30;
    ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
    ctx.beginPath();
    ctx.arc(p.px, p.py, 1.6, 0, Math.PI*2);
    ctx.fill();
  });

  ctx.fillStyle = '#94a3b8';
  ctx.font = '9px JetBrains Mono';
  ctx.fillText(`${fmtNum(pts.length)} pts shown (subsampled)`, 8, H - 8);
}

function setupCloud3DDrag(canvas) {
  canvas.addEventListener('mousedown', e => { cloudDragging = true; cloudLastMouse = {x:e.clientX,y:e.clientY}; });
  window.addEventListener('mouseup', () => { cloudDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!cloudDragging) return;
    const dx = e.clientX - cloudLastMouse.x;
    const dy = e.clientY - cloudLastMouse.y;
    cloudLastMouse = {x:e.clientX, y:e.clientY};
    cloudRotY += dx * 0.01;
    cloudRotX = Math.max(-1.4, Math.min(1.4, cloudRotX + dy * 0.01));
    renderCloud3D(canvas);
  });

  let lastTouch = null;
  canvas.addEventListener('touchstart', e => { lastTouch = {x:e.touches[0].clientX, y:e.touches[0].clientY}; });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (!lastTouch) return;
    const dx = e.touches[0].clientX - lastTouch.x;
    const dy = e.touches[0].clientY - lastTouch.y;
    lastTouch = {x:e.touches[0].clientX, y:e.touches[0].clientY};
    cloudRotY += dx * 0.012;
    cloudRotX = Math.max(-1.4, Math.min(1.4, cloudRotX + dy * 0.012));
    renderCloud3D(canvas);
  }, { passive: false });
}

/* Top-down view showing field-of-view spread at current Z */
function renderTopView(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || canvas.width;
  const H = canvas.offsetHeight || canvas.height;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  const camX = W/2, camY = 24;
  const scaleZ = (H - 50) / 8; /* 8m max range mapped to canvas height */

  /* FOV cone lines (approx half-angle from fx) */
  const fovAngle = Math.atan(320 / SIM.fx); /* radians, half-angle */
  const farZ = 8 * scaleZ;
  ctx.strokeStyle = '#93c5fd';
  ctx.lineWidth = 1;
  ctx.setLineDash([4,3]);
  ctx.beginPath();
  ctx.moveTo(camX, camY);
  ctx.lineTo(camX - Math.tan(fovAngle) * farZ, camY + farZ);
  ctx.moveTo(camX, camY);
  ctx.lineTo(camX + Math.tan(fovAngle) * farZ, camY + farZ);
  ctx.stroke();
  ctx.setLineDash([]);

  /* depth gridlines */
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 0.5;
  for (let z = 1; z <= 8; z++) {
    const y = camY + z * scaleZ;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.font = '8px JetBrains Mono';
    ctx.fillText(`${z}m`, 4, y - 2);
  }

  /* camera marker */
  ctx.fillStyle = '#2563eb';
  ctx.beginPath(); ctx.arc(camX, camY, 5, 0, Math.PI*2); ctx.fill();

  /* object marker at current Z */
  const objY = camY + SIM.Z * scaleZ;
  const objHalfWidth = Math.tan(fovAngle) * SIM.Z * scaleZ * 0.18;
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(camX - objHalfWidth, objY - 6, objHalfWidth*2, 12);

  ctx.fillStyle = '#16a34a';
  ctx.font = 'bold 9px DM Sans';
  ctx.fillText(`Z = ${SIM.Z.toFixed(2)}m  |  FOV width ≈ ${(2*Math.tan(fovAngle)*SIM.Z).toFixed(2)}m`, camX + 10, objY + 3);

  /* background wall line at 8m */
  ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, camY + 8*scaleZ); ctx.lineTo(W, camY + 8*scaleZ); ctx.stroke();
}

/* Density vs distance curve */
function renderDensityCurve(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || canvas.width;
  const H = canvas.offsetHeight || canvas.height;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  const padL = 42, padR = 10, padT = 14, padB = 28;
  const gW = W - padL - padR, gH = H - padT - padB;

  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padT + gH - (i/4) * gH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL+gW, y); ctx.stroke();
  }

  ctx.fillStyle = '#64748b'; ctx.font = '10px DM Sans'; ctx.textAlign = 'center';
  ctx.fillText('Distance Z (m)', padL + gW/2, H - 4);

  ctx.strokeStyle = '#0891b2'; ctx.lineWidth = 2;
  ctx.beginPath();
  let maxDensity = 0;
  const densities = [];
  for (let z = 0.3; z <= 8; z += 0.1) {
    const spacing = z / SIM.fx;
    const density = 1 / (spacing * spacing); /* pts/m² approx */
    densities.push(density);
    maxDensity = Math.max(maxDensity, density);
  }

  let idx = 0;
  for (let z = 0.3; z <= 8; z += 0.1) {
    const x = padL + ((z - 0.3) / 7.7) * gW;
    const y = padT + gH - Math.min(gH, (densities[idx] / maxDensity) * gH);
    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    idx++;
  }
  ctx.stroke();

  /* current Z marker */
  const curSpacing = SIM.Z / SIM.fx;
  const curDensity = 1 / (curSpacing * curSpacing);
  const curX = padL + ((SIM.Z - 0.3) / 7.7) * gW;
  const curY = padT + gH - Math.min(gH, (curDensity / maxDensity) * gH);

  ctx.fillStyle = '#dc2626';
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(curX, curY, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = '#dc2626'; ctx.font = 'bold 9px DM Sans';
  ctx.fillText(`Z=${SIM.Z.toFixed(1)}m`, Math.min(curX+8, W-60), curY-6);
}

/* Quality gauge — based on noise + flying pixel severity */
function renderGauge(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const noisePenalty = Math.min(50, SIM.noise * 1.2);
  const edgePenalty  = SIM.edge * 8;
  const quality = Math.max(0, Math.min(100, 100 - noisePenalty - edgePenalty));

  const cx = W/2, cy = H-8, r = H-16;
  const startA = Math.PI, endA = 2*Math.PI;

  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 10; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx,cy,r,startA,endA); ctx.stroke();

  const sweepA = startA + (quality/100) * Math.PI;
  const colour = quality > 70 ? '#22c55e' : quality > 40 ? '#f59e0b' : '#ef4444';
  ctx.strokeStyle = colour; ctx.lineWidth = 10;
  ctx.beginPath(); ctx.arc(cx,cy,r,startA,sweepA); ctx.stroke();

  ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx,cy);
  ctx.lineTo(cx + (r-4)*Math.cos(sweepA), cy + (r-4)*Math.sin(sweepA));
  ctx.stroke();
  ctx.fillStyle = '#334155'; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();

  document.getElementById('quality-label').textContent =
    quality > 70 ? `${quality.toFixed(0)}% — Clean cloud` :
    quality > 40 ? `${quality.toFixed(0)}% — Visible noise` :
                   `${quality.toFixed(0)}% — Heavily degraded`;
  document.getElementById('quality-label').style.color = colour;
  document.getElementById('quality-sub').textContent =
    quality > 70 ? 'Surface clearly defined' :
    quality > 40 ? 'Reduce noise or edge ambiguity' :
                   'Cloud unsuitable for measurement';
}

/* Mini spacing-vs-resolution bar chart in right panel */
function renderSpacingMini(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,W,H);

  const realSpacing = RES_PRESETS.map(r => (SIM.Z / SIM.fx) * (640 / r.w) * 1000); /* mm, normalised vs 640 ref */

  const maxS = Math.max(...realSpacing);
  const barW = W / RES_PRESETS.length * 0.6;
  const gap  = W / RES_PRESETS.length;

  RES_PRESETS.forEach((r, i) => {
    const h = (realSpacing[i] / maxS) * (H - 22);
    const x = gap * i + (gap - barW)/2;
    const y = H - 16 - h;
    const isCurrent = i === SIM.resIdx;
    ctx.fillStyle = isCurrent ? '#2563eb' : '#bfdbfe';
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = '#64748b'; ctx.font = '7px JetBrains Mono'; ctx.textAlign = 'center';
    ctx.fillText(r.label.split('×')[0], x + barW/2, H - 4);
  });
  ctx.textAlign = 'left';
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — MAIN UPDATE
────────────────────────────────────────────────────────────── */

function updateSimulation() {
  const res = currentRes();
  const totalPoints = res.w * res.h;
  const spacingMm = (SIM.Z / SIM.fx) * 1000;
  const fovWidthM = (res.w / SIM.fx) * SIM.Z;
  const fovHeightM = (res.h / SIM.fx) * SIM.Z;
  const surfaceArea = fovWidthM * fovHeightM;
  const densityK = (totalPoints / Math.max(surfaceArea, 0.001)) / 1000;
  const rmse = SIM.noise; /* linear relationship: RMSE ≈ σ */

  document.getElementById('ro-points').textContent  = fmtNum(totalPoints);
  document.getElementById('ro-spacing').textContent = spacingMm.toFixed(1);
  document.getElementById('ro-density').textContent = densityK.toFixed(1);

  const rmseEl = document.getElementById('ro-rmse');
  rmseEl.textContent = rmse.toFixed(1);
  rmseEl.className = 'ro-val' + (rmse < 5 ? ' good' : rmse < 20 ? ' warn' : ' danger');

  /* stats panel */
  document.getElementById('st-w').textContent = res.w;
  document.getElementById('st-h').textContent = res.h;
  document.getElementById('st-valid').textContent = (94 + Math.random()*4).toFixed(1) + '%';
  const flyingCount = Math.round(totalPoints * 0.002 * (SIM.edge + 1));
  document.getElementById('st-flying').textContent = fmtNum(flyingCount);

  /* bbox */
  document.getElementById('bb-x').textContent = '0.40 m';
  document.getElementById('bb-y').textContent = '0.40 m';
  document.getElementById('bb-z').textContent = SIM.Z.toFixed(2) + ' m';

  /* render canvases */
  renderDepthMap(document.getElementById('cvs-depthmap'));
  renderCloud3D(document.getElementById('cvs-cloud3d'));
  renderTopView(document.getElementById('cvs-topview'));
  renderDensityCurve(document.getElementById('cvs-density'));
  renderGauge(document.getElementById('gauge-canvas'));
  renderSpacingMini(document.getElementById('cvs-spacing-mini'));
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — WIZARD
────────────────────────────────────────────────────────────── */

function updateSimWizard() {
  const step = Math.min(SIM.step, SIM_WIZARD.length - 1);
  const s = SIM_WIZARD[step];

  document.getElementById('wiz-title').textContent = s.title;
  document.getElementById('wiz-text').textContent  = s.text;
  document.getElementById('wiz-task').textContent  = s.task;

  document.querySelectorAll('.param-grp').forEach(el => el.classList.remove('lit'));
  if (s.lit) {
    const el = document.getElementById(s.lit);
    if (el) { el.classList.add('lit'); el.scrollIntoView({block:'nearest', behavior:'smooth'}); }
  }

  document.querySelectorAll('.wdot').forEach((d,i) => {
    d.classList.remove('active','done');
    if (i === step) d.classList.add('active');
    if (i < step)  d.classList.add('done');
  });

  const btnNext = document.getElementById('wiz-next');
  const btnSkip = document.getElementById('wiz-skip');
  if (step >= SIM_WIZARD.length - 1) {
    btnNext.textContent = 'Explore Freely';
    btnSkip.style.display = 'none';
  } else {
    btnNext.textContent = 'Next Step';
    btnSkip.style.display = '';
  }
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — INIT & CONTROLS
────────────────────────────────────────────────────────────── */

function initSimulation() {
  updateSimWizard();
  updateSimulation();
  setupCloud3DDrag(document.getElementById('cvs-cloud3d'));

  document.getElementById('r-res').addEventListener('input', e => {
    SIM.resIdx = parseInt(e.target.value);
    document.getElementById('pv-res').textContent = RES_PRESETS[SIM.resIdx].label;
    updateSimulation();
  });

  document.getElementById('r-Z').addEventListener('input', e => {
    SIM.Z = parseFloat(e.target.value);
    document.getElementById('pv-Z').textContent = SIM.Z.toFixed(2) + ' m';
    updateSimulation();
  });

  document.getElementById('r-noise').addEventListener('input', e => {
    SIM.noise = parseFloat(e.target.value);
    document.getElementById('pv-noise').textContent = SIM.noise.toFixed(0) + ' mm';
    updateSimulation();
  });

  document.getElementById('r-fx').addEventListener('input', e => {
    SIM.fx = parseFloat(e.target.value);
    document.getElementById('pv-fx').textContent = SIM.fx.toFixed(0) + ' px';
    updateSimulation();
  });

  document.getElementById('r-flying').addEventListener('input', e => {
    SIM.edge = parseInt(e.target.value);
    const labels = ['Clean', 'Normal', 'High', 'Severe'];
    document.getElementById('pv-flying').textContent = labels[SIM.edge];
    updateSimulation();
  });

  document.getElementById('wiz-next').addEventListener('click', () => {
    SIM.step = Math.min(SIM.step + 1, SIM_WIZARD.length - 1);
    updateSimWizard();
  });
  document.getElementById('wiz-skip').addEventListener('click', () => {
    SIM.step = SIM_WIZARD.length - 1;
    updateSimWizard();
  });
  document.querySelectorAll('.wdot').forEach(d => {
    d.addEventListener('click', () => { SIM.step = parseInt(d.dataset.ws); updateSimWizard(); });
  });

  ['btn-sim-reset', 'btn-sim-reset2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', resetSimulation);
  });

  const ro = new ResizeObserver(() => updateSimulation());
  document.querySelectorAll('.sim-card').forEach(c => ro.observe(c));
}

function resetSimulation() {
  SIM.resIdx = 1; SIM.Z = 1.5; SIM.noise = 3; SIM.fx = 700; SIM.edge = 1; SIM.step = 0;

  document.getElementById('r-res').value = 1;
  document.getElementById('r-Z').value = 1.5;
  document.getElementById('r-noise').value = 3;
  document.getElementById('r-fx').value = 700;
  document.getElementById('r-flying').value = 1;

  document.getElementById('pv-res').textContent = '320×240';
  document.getElementById('pv-Z').textContent = '1.50 m';
  document.getElementById('pv-noise').textContent = '3 mm';
  document.getElementById('pv-fx').textContent = '700 px';
  document.getElementById('pv-flying').textContent = 'Normal';

  cloudRotY = 0.6; cloudRotX = -0.3;

  updateSimWizard();
  updateSimulation();
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — RESET
────────────────────────────────────────────────────────────── */

function resetSetup() {
  Object.keys(MOUNTED).forEach(k => MOUNTED[k] = false);

  if (sensorMesh) { sensorMesh.visible = false; fovHelper.visible = false; }
  if (mountMesh)  mountMesh.visible = false;
  if (cubeMesh)   cubeMesh.visible = false;
  if (wallMesh)   { wallMesh.visible = false; wallMesh.userData.gridMesh.visible = false; }

  SCANS.length = 0;
  document.getElementById('scan-count').textContent = '0';
  document.getElementById('scan-fill').style.width = '0%';
  document.getElementById('scan-grid').innerHTML = '';
  document.getElementById('btn-next-obs').disabled = true;

  document.querySelectorAll('.btn-mount').forEach(b => { b.textContent = 'Mount'; b.classList.remove('mounted'); });
  document.querySelectorAll('.comp-card').forEach(c => c.classList.remove('mounted'));

  document.getElementById('sr-cd').value = 1.5;
  document.getElementById('sr-co').value = 0;
  document.getElementById('sr-res').value = 1;
  document.getElementById('sv-cd').textContent = '1.5 m';
  document.getElementById('sv-co').textContent = '0 cm';
  document.getElementById('sv-res').textContent = '320×240';

  cubeZ = 1.5; cubeOffset = 0; setupResIdx = 1;

  document.getElementById('btn-go-sim').disabled = true;
  gotoSetupStep(0);
}

/* ──────────────────────────────────────────────────────────────
   INIT
────────────────────────────────────────────────────────────── */

function init() {
  initThree();

  document.querySelectorAll('.btn-mount').forEach(btn => {
    btn.addEventListener('click', () => mountComponent(btn.dataset.comp));
  });
  document.getElementById('mount-all-btn').addEventListener('click', mountAll);

  document.querySelectorAll('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => gotoSetupStep(parseInt(btn.dataset.next)));
  });
  document.querySelectorAll('[data-prev]').forEach(btn => {
    btn.addEventListener('click', () => gotoSetupStep(parseInt(btn.dataset.prev)));
  });
  document.querySelectorAll('.sstep').forEach(el => {
    el.addEventListener('click', () => gotoSetupStep(parseInt(el.dataset.s)));
  });

  document.getElementById('sr-cd').addEventListener('input', e => {
    cubeZ = parseFloat(e.target.value);
    document.getElementById('sv-cd').textContent = cubeZ.toFixed(1) + ' m';
    updateCubeTransform();
  });
  document.getElementById('sr-co').addEventListener('input', e => {
    cubeOffset = parseFloat(e.target.value);
    document.getElementById('sv-co').textContent = cubeOffset.toFixed(0) + ' cm';
    updateCubeTransform();
  });
  document.getElementById('sr-res').addEventListener('input', e => {
    setupResIdx = parseInt(e.target.value);
    document.getElementById('sv-res').textContent = RES_PRESETS[setupResIdx].label;
    updateCubeTransform();
  });

  document.getElementById('btn-capture').addEventListener('click', captureScan);

  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      switch (currentView) {
        case 'iso':   setViewISO();   break;
        case 'top':   setViewTop();   break;
        case 'front': setViewFront(); break;
        case 'side':  setViewSide();  break;
      }
    });
  });

  document.getElementById('btn-go-sim').addEventListener('click', showSimulation);
  document.getElementById('btn-launch-sim').addEventListener('click', showSimulation);
  document.getElementById('btn-back-setup').addEventListener('click', showSetup);
  document.getElementById('btn-reset-setup').addEventListener('click', resetSetup);

  document.getElementById('three-canvas').addEventListener('contextmenu', e => e.preventDefault());
}

window.addEventListener('load', init);
