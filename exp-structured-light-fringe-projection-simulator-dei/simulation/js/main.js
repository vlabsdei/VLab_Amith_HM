/* ================================================================
   EXPERIMENT 6 — STRUCTURED LIGHT FRINGE PROJECTION SIMULATOR
   main.js — Three.js 3D setup scene + real phase-shifting engine
   ================================================================
   ARCHITECTURE
   ────────────
   SETUP PAGE
     ThreeScene    → renderer, camera, orbit controls, projector + camera
                     + surface + enclosure in a scan chamber
     Components    → tracks mounted equipment (projector, camera, surface,
                     enclosure)
     SetupWizard   → step navigation (0→4)
   SIMULATION PAGE
     SurfaceGen    → generates a bumpy height profile h_true(x) as a sum
                     of cosine harmonics
     PhaseShifting → for each pixel, generates N fringe images
                     I_n = A + B·cos(φ + 2πn/N) with noise + ambient,
                     then extracts wrapped phase φ via the generalised
                     N-step arctan formula
     render*()     → fringe image, wrapped phase map, height profile,
                     modulation map, phase-steps preview, quality gauge,
                     RMSE-vs-N chart
     WizardSim     → 4-step guided walkthrough
   CORE MATH (Experiment 6 theory) — all genuinely computed, not faked
   ────────────────────────────────────────────────────────────────────
     Intensity:     I_n(u,v) = A + B·cos(φ(u,v) + 2πn/N)
     Phase extract: φ = arctan(−ΣI_n·sin(s_n) / ΣI_n·cos(s_n))
     Height:        h = p·φ / (2π·tan α)
     Wrap limit:    h_max = p / (2·tan α)
     Modulation:    M = B / A
   ================================================================ */
'use strict';
/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */
const MOUNTED = { projector: false, camera: false, surface: false, enclosure: false };
const SETUP = {
  alpha: 30,        /* baseline angle, degrees           */
  amplitude: 5,     /* surface amplitude, mm              */
  reflectivity: 0.85,
};
const SIM = {
  N:        4,       /* phase steps                       */
  p:        8,       /* fringe period, mm                 */
  alpha:    30,      /* baseline angle, degrees           */
  ambient:  5,       /* ambient light, percent            */
  surfAmp:  5,       /* surface amplitude, mm             */
  step:     0,       /* wizard step                       */
};
/* Computed scan data arrays, updated on every parameter change */
let SCAN = {
  W: 256,            /* pixel resolution of the simulation */
  H: 160,
  hTrue: null,       /* Float64Array(W*H) – true height    */
  hRecov: null,      /* Float64Array(W*H) – recovered height */
  phaseW: null,      /* Float64Array(W*H) – wrapped phase  */
  modMap: null,       /* Float64Array(W*H) – modulation ratio */
  fringeImg: null,   /* Float64Array(W*H) – last fringe step image */
};
/* Wizard content for simulation page */
const SIM_WIZARD = [
  {
    title: 'Project Fringes',
    text:  'The projector casts sinusoidal fringe patterns onto the surface. With N=4, four phase-shifted images are captured. Each fringe bends where the surface has height.',
    task:  '▶ Observe the Fringe Image — bright and dark bands bend over the bumpy surface.',
    lit:   'pg-N',
  },
  {
    title: 'Change Phase Steps',
    text:  'More steps reduce harmonic errors in the recovered phase. Try N=3 (minimum) and N=8+ and watch the height profile RMSE improve then saturate.',
    task:  '▶ Set N to 3, then to 8, and compare RMSE values.',
    lit:   'pg-N',
  },
  {
    title: 'Cause Phase Wrapping',
    text:  'Shorten the fringe period p or increase surface amplitude until h exceeds h_max = p/(2·tan α). The wrapped phase map shows sawtooth jumps.',
    task:  '▶ Set p = 4 mm with amplitude 10 mm. Look for sawtooth in the phase map.',
    lit:   'pg-p',
  },
  {
    title: 'Flood with Ambient Light',
    text:  'Ambient light raises the DC offset A, reducing M = B/A. When M drops too low, phase extraction fails — the modulation map turns red.',
    task:  '▶ Push ambient to 60% and observe the modulation map degrade.',
    lit:   'pg-ambient',
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
function degToRad(d) { return d * Math.PI / 180; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
/* ──────────────────────────────────────────────────────────────
   SURFACE GENERATOR — creates a bumpy h_true(x,y) profile
────────────────────────────────────────────────────────────── */
function generateSurface(W, H, amplitude) {
  const h = new Float64Array(W * H);
  /* sum of cosine harmonics to make a realistic, repeatable surface */
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const nx = u / W, ny = v / H;
      let val = 0;
      val += 0.45 * Math.cos(2 * Math.PI * 2.3 * nx + 0.4) * Math.cos(2 * Math.PI * 1.7 * ny);
      val += 0.30 * Math.cos(2 * Math.PI * 4.1 * nx - 1.2) * Math.cos(2 * Math.PI * 3.2 * ny + 0.8);
      val += 0.15 * Math.cos(2 * Math.PI * 7.5 * nx + 2.1) * Math.cos(2 * Math.PI * 5.8 * ny - 0.5);
      val += 0.10 * Math.cos(2 * Math.PI * 1.0 * nx) * Math.sin(2 * Math.PI * 2.5 * ny);
      h[v * W + u] = val * amplitude;
    }
  }
  return h;
}
/* ──────────────────────────────────────────────────────────────
   PHASE-SHIFTING ENGINE
   Generates N fringe images, extracts wrapped phase, computes
   height and modulation at every pixel.
────────────────────────────────────────────────────────────── */
function runPhaseShifting() {
  const { W, H } = SCAN;
  const N     = SIM.N;
  const p     = SIM.p;           /* mm */
  const alpha = degToRad(SIM.alpha);
  const tanA  = Math.tan(alpha);
  const ambientFrac = SIM.ambient / 100;
  const refl  = SETUP.reflectivity;
  /* generate true surface */
  const hTrue = generateSurface(W, H, SIM.surfAmp);
  /* B = modulation amplitude, proportional to reflectivity
     A = DC offset = ambient contribution + half the fringe range */
  const B_base = 127 * refl;
  const A_base = 40 + ambientFrac * 200;
  /* storage for the N intensity images at each pixel */
  const intensities = [];
  for (let n = 0; n < N; n++) intensities.push(new Float64Array(W * H));
  /* compute I_n for each pixel */
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const idx = v * W + u;
      /* true phase at this pixel: proportional to height × geometric factor */
      const phi_true = (2 * Math.PI * hTrue[idx] * tanA) / p;
      const A = A_base;
      const B = B_base;
      for (let n = 0; n < N; n++) {
        const shift_n = (2 * Math.PI * n) / N;
        let I = A + B * Math.cos(phi_true + shift_n);
        /* add small Gaussian noise to simulate sensor noise */
        I += gauss() * 2.0;
        intensities[n][idx] = I;
      }
    }
  }
  /* extract wrapped phase using the generalised N-step formula:
     φ = arctan( −Σ I_n·sin(2πn/N) / Σ I_n·cos(2πn/N) ) */
  const phaseW = new Float64Array(W * H);
  const modMap = new Float64Array(W * H);
  const hRecov = new Float64Array(W * H);
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const idx = v * W + u;
      let sumSin = 0, sumCos = 0;
      let Imax = -Infinity, Imin = Infinity;
      for (let n = 0; n < N; n++) {
        const shift_n = (2 * Math.PI * n) / N;
        const I = intensities[n][idx];
        sumSin += I * Math.sin(shift_n);
        sumCos += I * Math.cos(shift_n);
        if (I > Imax) Imax = I;
        if (I < Imin) Imin = I;
      }
      const phi = Math.atan2(-sumSin, sumCos);
      phaseW[idx] = phi;
      /* modulation ratio M = (Imax - Imin) / (Imax + Imin) ≈ B/A */
      const denom = Imax + Imin;
      modMap[idx] = denom > 0.01 ? (Imax - Imin) / denom : 0;
      /* height from phase: h = p·φ / (2π·tan α) */
      hRecov[idx] = (p * phi) / (2 * Math.PI * tanA);
    }
  }
  /* store the last fringe step image for display */
  const fringeImg = new Float64Array(intensities[N - 1]);
  SCAN.hTrue    = hTrue;
  SCAN.hRecov   = hRecov;
  SCAN.phaseW   = phaseW;
  SCAN.modMap   = modMap;
  SCAN.fringeImg = fringeImg;
}
/* ──────────────────────────────────────────────────────────────
   THREE.JS SCENE — SETUP PAGE
────────────────────────────────────────────────────────────── */
let renderer, scene, camera, animFrame;
let projectorGroup, cameraGroup, surfaceMesh, enclosureGroup;
let baselineLine, fringeBeamGroup;
let orbitTarget = new THREE.Vector3(0, 0.3, 0);
let isDragging = false, lastMouse = { x: 0, y: 0 };
let phi = Math.PI / 4, theta = Math.PI / 4, radius = 5.5;
let currentView = 'iso';
let fringePhase = 0;
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
  scene.fog = new THREE.Fog(0xe8edf5, 8, 18);
  camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 25);
  setViewISO();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(4, 3, 3);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  scene.add(dirLight);
  /* floor */
  const floorGeo = new THREE.PlaneGeometry(10, 10);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0xd8dfe8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(10, 20, 0xb8c4d4, 0xccd5e0);
  grid.material.opacity = 0.5;
  grid.material.transparent = true;
  scene.add(grid);
  buildProjectorGroup();
  buildCameraGroup();
  buildSurfaceMesh();
  buildEnclosureGroup();
  buildBaselineLine();
  buildFringeBeamGroup();
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
  /* animate fringe stripes on the surface when projector is mounted */
  if (projectorGroup && projectorGroup.visible && MOUNTED.projector) {
    fringePhase += 0.03;
    updateFringeBeams();
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
function setViewISO()   { phi = Math.PI / 4;  theta = Math.PI / 4;  radius = 5.5; }
function setViewTop()   { phi = 0;            theta = 0.01;         radius = 5.5; }
function setViewFront() { phi = 0;            theta = Math.PI / 2;  radius = 5.5; }
function setViewSide()  { phi = Math.PI / 2;  theta = Math.PI / 2;  radius = 5.5; }
function setupOrbitControls(canvas) {
  canvas.addEventListener('mousedown', e => { isDragging = true; lastMouse = { x: e.clientX, y: e.clientY }; });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouse.x, dy = e.clientY - lastMouse.y;
    lastMouse = { x: e.clientX, y: e.clientY };
    if (e.buttons === 1) {
      phi -= dx * 0.008;
      theta = Math.max(0.05, Math.min(Math.PI - 0.05, theta + dy * 0.008));
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    } else if (e.buttons === 2) {
      orbitTarget.x -= dx * 0.005;
      orbitTarget.y += dy * 0.005;
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    radius = Math.max(2.5, Math.min(12, radius + e.deltaY * 0.006));
  }, { passive: false });
  /* touch controls */
  let lastTouch = null, lastTouchDist = 0;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { isDragging = true; lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }
    else if (e.touches.length === 2) { lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); }
  });
  canvas.addEventListener('touchend', () => { isDragging = false; lastTouch = null; });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging && lastTouch) {
      const dx = e.touches[0].clientX - lastTouch.x, dy = e.touches[0].clientY - lastTouch.y;
      lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      phi -= dx * 0.01;
      theta = Math.max(0.05, Math.min(Math.PI - 0.05, theta + dy * 0.01));
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      radius = Math.max(2.5, Math.min(12, radius * (lastTouchDist / dist)));
      lastTouchDist = dist;
    }
  }, { passive: false });
}
/* ── Build 3D Models ──────────────────────────────────────── */
function buildProjectorGroup() {
  projectorGroup = new THREE.Group();
  /* projector body */
  const bodyGeo = new THREE.BoxGeometry(0.35, 0.15, 0.25);
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0x4c1d95, shininess: 60 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  projectorGroup.add(body);
  /* lens */
  const lensGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.06, 16);
  const lensMat = new THREE.MeshPhongMaterial({ color: 0xc4b5fd, shininess: 100, emissive: 0x7c3aed, emissiveIntensity: 0.3 });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, -0.10, 0);
  projectorGroup.add(lens);
  /* mount arm */
  const armGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8);
  const armMat = new THREE.MeshPhongMaterial({ color: 0x334155 });
  const arm = new THREE.Mesh(armGeo, armMat);
  arm.position.y = 0.28;
  arm.castShadow = true;
  projectorGroup.add(arm);
  /* crossbar */
  const barGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.6, 8);
  const barMat = new THREE.MeshPhongMaterial({ color: 0x475569 });
  const bar = new THREE.Mesh(barGeo, barMat);
  bar.rotation.z = Math.PI / 2;
  bar.position.y = 0.48;
  projectorGroup.add(bar);
  projectorGroup.position.set(0, 1.8, 0);
  projectorGroup.visible = false;
  scene.add(projectorGroup);
}
function buildCameraGroup() {
  cameraGroup = new THREE.Group();
  /* camera body */
  const bodyGeo = new THREE.BoxGeometry(0.22, 0.14, 0.18);
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0x1e293b, shininess: 50 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  cameraGroup.add(body);
  /* camera lens */
  const lensGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.08, 16);
  const lensMat = new THREE.MeshPhongMaterial({ color: 0x1d4ed8, shininess: 80, emissive: 0x3b82f6, emissiveIntensity: 0.2 });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, -0.05, 0.08);
  cameraGroup.add(lens);
  /* mount arm */
  const armGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.35, 8);
  const armMat = new THREE.MeshPhongMaterial({ color: 0x334155 });
  const arm = new THREE.Mesh(armGeo, armMat);
  arm.position.y = 0.24;
  arm.castShadow = true;
  cameraGroup.add(arm);
  updateCameraGroupPosition();
  cameraGroup.visible = false;
  scene.add(cameraGroup);
}
function updateCameraGroupPosition() {
  const alphaRad = degToRad(SETUP.alpha);
  const dist = 2.0;
  const x = dist * Math.sin(alphaRad);
  const y = 1.8;
  const z = 0;
  cameraGroup.position.set(x, y, z);
  /* tilt camera to look at the surface */
  cameraGroup.rotation.z = -alphaRad * 0.5;
}
function buildSurfaceMesh() {
  /* create a bumpy surface using a plane with displaced vertices */
  const geo = new THREE.PlaneGeometry(2.0, 1.5, 64, 48);
  const positions = geo.attributes.position.array;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1];
    const nx = (x + 1) / 2, ny = (y + 0.75) / 1.5;
    let h = 0;
    h += 0.45 * Math.cos(2 * Math.PI * 2.3 * nx + 0.4) * Math.cos(2 * Math.PI * 1.7 * ny);
    h += 0.30 * Math.cos(2 * Math.PI * 4.1 * nx - 1.2) * Math.cos(2 * Math.PI * 3.2 * ny + 0.8);
    h += 0.15 * Math.cos(2 * Math.PI * 7.5 * nx + 2.1) * Math.cos(2 * Math.PI * 5.8 * ny - 0.5);
    h += 0.10 * Math.cos(2 * Math.PI * 1.0 * nx) * Math.sin(2 * Math.PI * 2.5 * ny);
    h += 1.0; // shift to make all displacement strictly positive
    positions[i + 2] = h * (SETUP.amplitude / 20);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhongMaterial({
    color: 0xfcd34d,
    shininess: 20,
    side: THREE.DoubleSide,
  });
  surfaceMesh = new THREE.Mesh(geo, mat);
  surfaceMesh.rotation.x = -Math.PI / 2;
  surfaceMesh.position.set(0, 0.01, 0);
  surfaceMesh.receiveShadow = true;
  surfaceMesh.castShadow = true;
  surfaceMesh.visible = false;
  scene.add(surfaceMesh);
}
function buildEnclosureGroup() {
  enclosureGroup = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x0f172a, side: THREE.DoubleSide, transparent: true, opacity: 0.35 });
  const h = 2.5, w = 3.0, d = 2.5;
  /* back wall */
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  back.position.set(0, h / 2, -d / 2);
  enclosureGroup.add(back);
  /* left wall */
  const left = new THREE.Mesh(new THREE.PlaneGeometry(d, h), mat);
  left.rotation.y = Math.PI / 2;
  left.position.set(-w / 2, h / 2, 0);
  enclosureGroup.add(left);
  /* right wall */
  const right = new THREE.Mesh(new THREE.PlaneGeometry(d, h), mat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(w / 2, h / 2, 0);
  enclosureGroup.add(right);
  /* top */
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  top.rotation.x = Math.PI / 2;
  top.position.set(0, h, 0);
  enclosureGroup.add(top);
  enclosureGroup.visible = false;
  scene.add(enclosureGroup);
}
function buildBaselineLine() {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 1.8, 0),
    new THREE.Vector3(1, 1.8, 0),
  ]);
  const mat = new THREE.LineDashedMaterial({ color: 0x7c3aed, dashSize: 0.06, gapSize: 0.04 });
  baselineLine = new THREE.Line(geo, mat);
  baselineLine.computeLineDistances();
  baselineLine.visible = false;
  scene.add(baselineLine);
}
function updateBaselineLine() {
  if (!baselineLine) return;
  const alphaRad = degToRad(SETUP.alpha);
  const x = 2.0 * Math.sin(alphaRad);
  baselineLine.geometry.setFromPoints([
    new THREE.Vector3(0, 1.8, 0),
    new THREE.Vector3(x, 1.8, 0),
  ]);
  baselineLine.computeLineDistances();
}
function buildFringeBeamGroup() {
  fringeBeamGroup = new THREE.Group();
  /* create a cone of "light" from the projector */
  const coneGeo = new THREE.ConeGeometry(0.8, 1.6, 4, 1, true);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xa78bfa,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
  });
  const cone = new THREE.Mesh(coneGeo, coneMat);
  cone.position.set(0, -0.8, 0);
  fringeBeamGroup.add(cone);
  /* fringe stripe planes — animated */
  for (let i = 0; i < 8; i++) {
    const stripeGeo = new THREE.PlaneGeometry(1.6, 0.015);
    const stripeMat = new THREE.MeshBasicMaterial({
      color: 0xc4b5fd,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(0, -1.25, (i - 3.5) * 0.15);
    stripe.rotation.x = Math.PI / 2;
    fringeBeamGroup.add(stripe);
  }
  fringeBeamGroup.position.set(0, 1.8, 0);
  fringeBeamGroup.visible = false;
  scene.add(fringeBeamGroup);
}
function updateFringeBeams() {
  if (!fringeBeamGroup || !fringeBeamGroup.visible) return;
  const children = fringeBeamGroup.children;
  /* skip the cone (index 0), animate the stripes */
  for (let i = 1; i < children.length; i++) {
    const stripe = children[i];
    const baseZ = (i - 1 - 3.5) * 0.15;
    stripe.position.z = baseZ + Math.sin(fringePhase) * 0.08;
    stripe.material.opacity = 0.25 + 0.2 * Math.cos(fringePhase + i * 0.7);
  }
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
    if (i < n) el.classList.add('done');
  });
  if (n >= 4) {
    if(document.getElementById('btn-launch-sim')) document.getElementById('btn-launch-sim').disabled = false;
    computeAndDisplayResults();
  }
  /* show baseline line when we're on camera step or beyond */
  if (baselineLine) {
    baselineLine.visible = n >= 2 && MOUNTED.projector && MOUNTED.camera;
  }
}
/* ──────────────────────────────────────────────────────────────
   COMPONENT MOUNTING
────────────────────────────────────────────────────────────── */
let selectedApparatus = 'projector';
function selectApparatus(name) {
  selectedApparatus = name;
  document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.apparatus-card[data-comp="${name}"]`);
  if (card) card.classList.add('selected');
  if (currentSetupStep === 0) {
    const infos = {
      projector: "DLP Projector: Casts sinusoidal structured light patterns.",
      camera: "CMOS Camera: Captures the deformed fringes.",
      surface: "Target Surface: The object being scanned.",
      enclosure: "Scan Enclosure: Blocks ambient light for clean scans."
    };
    const wizText = document.getElementById('wizard-text');
    if (wizText && infos[name]) wizText.textContent = infos[name];
  }
}
function handleMount() {
  if (!selectedApparatus || MOUNTED[selectedApparatus]) return;
  mountComponent(selectedApparatus);
  
  const compOrder = ['projector', 'camera', 'surface', 'enclosure'];
  const currentIndex = compOrder.indexOf(selectedApparatus);
  for (let i = 1; i < compOrder.length; i++) {
    const nextComp = compOrder[(currentIndex + i) % compOrder.length];
    if (!MOUNTED[nextComp]) {
      selectApparatus(nextComp);
      break;
    }
  }
}
function mountComponent(name) {
  if (MOUNTED[name]) return;
  MOUNTED[name] = true;
  switch (name) {
    case 'projector':
      projectorGroup.visible = true;
      fringeBeamGroup.visible = true;
      break;
    case 'camera':
      cameraGroup.visible = true;
      if (MOUNTED.projector) baselineLine.visible = true;
      break;
    case 'surface':
      surfaceMesh.visible = true;
      break;
    case 'enclosure':
      enclosureGroup.visible = true;
      break;
  }
  const card = document.querySelector(`.apparatus-card[data-comp="${name}"]`);
  if (card) card.classList.add('mounted');
  const status = document.getElementById(`state-${name}`);
  if (status) status.textContent = 'Mounted';
  const allMounted = Object.values(MOUNTED).every(Boolean);
  if (allMounted) {
    const btnMount = document.getElementById('btn-mount');
    if (btnMount) btnMount.style.display = 'none';
  }
  if (allMounted && currentSetupStep === 0) {
    setTimeout(() => gotoSetupStep(1), 500);
  }
}
function mountAll() {
  Object.keys(MOUNTED).forEach(mountComponent);
}
/* ──────────────────────────────────────────────────────────────
   SETUP STEP 3 — CONFIRM CONFIGURATION
────────────────────────────────────────────────────────────── */
function confirmConfiguration() {
  document.getElementById('btn-next-obs').disabled = false;
}
function computeAndDisplayResults() {
  const alpha = SETUP.alpha;
  const amp = SETUP.amplitude;
  const refl = SETUP.reflectivity;
  const p = 8; /* default fringe period */
  const hmax = p / (2 * Math.tan(degToRad(alpha)));
  document.getElementById('r-alpha').textContent = alpha;
  document.getElementById('r-amp').textContent = amp.toFixed(1);
  document.getElementById('r-refl').textContent = refl.toFixed(2);
  document.getElementById('r-period').textContent = p + ' mm';
  document.getElementById('r-hmax').textContent = hmax.toFixed(2);
}
/* ──────────────────────────────────────────────────────────────
   PAGE SWITCHING
────────────────────────────────────────────────────────────── */
function showSimulation() {
  document.getElementById('page-setup').classList.remove('active');
  document.getElementById('page-sim').classList.add('active');
  cancelAnimationFrame(animFrame);
  /* carry setup params into simulation */
  SIM.alpha = SETUP.alpha;
  SIM.surfAmp = SETUP.amplitude;
  /* update sim slider displays to match setup values.
     NOTE: r-alpha ID is duplicated (setup result div + sim slider input).
     Use querySelector scoped to page-sim to target the correct element. */
  const simPage = document.getElementById('page-sim');
  const alphaSlider = simPage.querySelector('#r-alpha');
  if (alphaSlider) alphaSlider.value = SIM.alpha;
  document.getElementById('pv-alpha').textContent = SIM.alpha + '°';
  const surfSlider = simPage.querySelector('#r-surf');
  if (surfSlider) surfSlider.value = SIM.surfAmp;
  document.getElementById('pv-surf').textContent = SIM.surfAmp + ' mm';
  initSimulation();
}
function showSetup() {
  document.getElementById('page-sim').classList.remove('active');
  document.getElementById('page-setup').classList.add('active');
  animateThree();
}
/* ──────────────────────────────────────────────────────────────
   SIMULATION CANVAS RENDERERS
────────────────────────────────────────────────────────────── */
function autoSizeCanvas(canvas) {
  const W = canvas.clientWidth || canvas.width;
  const H = canvas.clientHeight || canvas.height;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  return { W, H };
}
/* ── Fringe Image (captured camera view) ──────────────────── */
function renderFringeImage(canvas) {
  const ctx = canvas.getContext('2d');
  const { W: cW, H: cH } = autoSizeCanvas(canvas);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, cW, cH);
  if (!SCAN.fringeImg) return;
  const sW = SCAN.W, sH = SCAN.H;
  const imgData = ctx.createImageData(sW, sH);
  /* find min/max for normalisation */
  let minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < sW * sH; i++) {
    if (SCAN.fringeImg[i] < minV) minV = SCAN.fringeImg[i];
    if (SCAN.fringeImg[i] > maxV) maxV = SCAN.fringeImg[i];
  }
  const range = maxV - minV || 1;
  for (let i = 0; i < sW * sH; i++) {
    const val = clamp(Math.round(((SCAN.fringeImg[i] - minV) / range) * 255), 0, 255);
    imgData.data[i * 4]     = val;
    imgData.data[i * 4 + 1] = val;
    imgData.data[i * 4 + 2] = val;
    imgData.data[i * 4 + 3] = 255;
  }
  /* render to a temp canvas at source resolution, then scale */
  const tmpCvs = document.createElement('canvas');
  tmpCvs.width = sW;
  tmpCvs.height = sH;
  tmpCvs.getContext('2d').putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmpCvs, 0, 0, cW, cH);
  ctx.fillStyle = '#64748b';
  ctx.font = '9px JetBrains Mono';
  ctx.fillText(`p = ${SIM.p} mm  |  N = ${SIM.N} steps`, 6, cH - 6);
}
/* ── Wrapped Phase Map ────────────────────────────────────── */
function renderPhaseMap(canvas) {
  const ctx = canvas.getContext('2d');
  const { W: cW, H: cH } = autoSizeCanvas(canvas);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, cW, cH);
  if (!SCAN.phaseW) return;
  const sW = SCAN.W, sH = SCAN.H;
  const imgData = ctx.createImageData(sW, sH);
  for (let i = 0; i < sW * sH; i++) {
    /* map [-π, π] to [0, 255] using a blue-white-red colormap */
    const t = (SCAN.phaseW[i] + Math.PI) / (2 * Math.PI); /* 0..1 */
    let r, g, b;
    if (t < 0.5) {
      /* blue to white */
      const s = t * 2;
      r = Math.round(30 + s * 225);
      g = Math.round(60 + s * 195);
      b = Math.round(200 + s * 55);
    } else {
      /* white to red */
      const s = (t - 0.5) * 2;
      r = 255;
      g = Math.round(255 - s * 200);
      b = Math.round(255 - s * 210);
    }
    imgData.data[i * 4]     = clamp(r, 0, 255);
    imgData.data[i * 4 + 1] = clamp(g, 0, 255);
    imgData.data[i * 4 + 2] = clamp(b, 0, 255);
    imgData.data[i * 4 + 3] = 255;
  }
  const tmpCvs = document.createElement('canvas');
  tmpCvs.width = sW;
  tmpCvs.height = sH;
  tmpCvs.getContext('2d').putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmpCvs, 0, 0, cW, cH);
  ctx.fillStyle = '#64748b';
  ctx.font = '9px JetBrains Mono';
  ctx.fillText('φ ∈ [−π, +π]', 6, cH - 6);
}
/* ── Height Profile h(x) — middle row comparison ─────────── */
function renderHeightProfile(canvas) {
  const ctx = canvas.getContext('2d');
  const { W: cW, H: cH } = autoSizeCanvas(canvas);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, cW, cH);
  if (!SCAN.hTrue || !SCAN.hRecov) return;
  const sW = SCAN.W, sH = SCAN.H;
  const midRow = Math.floor(sH / 2);
  const padL = 36, padR = 10, padT = 14, padB = 24;
  const gW = cW - padL - padR, gH = cH - padT - padB;
  /* find range across both true and recovered */
  let minH = Infinity, maxH = -Infinity;
  for (let u = 0; u < sW; u++) {
    const idx = midRow * sW + u;
    const ht = SCAN.hTrue[idx], hr = SCAN.hRecov[idx];
    if (ht < minH) minH = ht; if (ht > maxH) maxH = ht;
    if (hr < minH) minH = hr; if (hr > maxH) maxH = hr;
  }
  const range = maxH - minH || 1;
  /* gridlines */
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padT + gH - (i / 4) * gH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + gW, y);
    ctx.stroke();
  }
  /* axis labels */
  ctx.fillStyle = '#94a3b8';
  ctx.font = '8px JetBrains Mono';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + gH - (i / 4) * gH;
    const val = minH + (i / 4) * range;
    ctx.fillText(val.toFixed(1), padL - 4, y + 3);
  }
  ctx.textAlign = 'left';
  /* plot true height (red dashed) */
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (let u = 0; u < sW; u++) {
    const x = padL + (u / sW) * gW;
    const y = padT + gH - ((SCAN.hTrue[midRow * sW + u] - minH) / range) * gH;
    if (u === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  /* plot recovered height (blue solid) */
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let u = 0; u < sW; u++) {
    const x = padL + (u / sW) * gW;
    const y = padT + gH - ((SCAN.hRecov[midRow * sW + u] - minH) / range) * gH;
    if (u === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  /* legend */
  ctx.fillStyle = '#ef4444';
  ctx.font = '9px DM Sans';
  ctx.fillText('── True', padL + 4, padT + 10);
  ctx.fillStyle = '#3b82f6';
  ctx.fillText('── Recovered', padL + 60, padT + 10);
  ctx.fillStyle = '#64748b';
  ctx.font = '9px DM Sans';
  ctx.textAlign = 'center';
  ctx.fillText('Pixel position x', padL + gW / 2, cH - 4);
  ctx.textAlign = 'left';
}
/* ── Modulation Map M(u,v) ────────────────────────────────── */
function renderModulationMap(canvas) {
  const ctx = canvas.getContext('2d');
  const { W: cW, H: cH } = autoSizeCanvas(canvas);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, cW, cH);
  if (!SCAN.modMap) return;
  const sW = SCAN.W, sH = SCAN.H;
  const imgData = ctx.createImageData(sW, sH);
  const M_THRESHOLD = 0.15;
  for (let i = 0; i < sW * sH; i++) {
    const M = SCAN.modMap[i];
    let r, g, b;
    if (M >= M_THRESHOLD) {
      /* green gradient: good modulation */
      const t = clamp((M - M_THRESHOLD) / (1 - M_THRESHOLD), 0, 1);
      r = Math.round(30 * (1 - t));
      g = Math.round(100 + 155 * t);
      b = Math.round(50 * (1 - t));
    } else {
      /* red gradient: bad modulation */
      const t = clamp(M / M_THRESHOLD, 0, 1);
      r = Math.round(220 - 80 * t);
      g = Math.round(50 * t);
      b = Math.round(30 * t);
    }
    imgData.data[i * 4]     = r;
    imgData.data[i * 4 + 1] = g;
    imgData.data[i * 4 + 2] = b;
    imgData.data[i * 4 + 3] = 255;
  }
  const tmpCvs = document.createElement('canvas');
  tmpCvs.width = sW;
  tmpCvs.height = sH;
  tmpCvs.getContext('2d').putImageData(imgData, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmpCvs, 0, 0, cW, cH);
  /* average M display */
  let sumM = 0;
  for (let i = 0; i < sW * sH; i++) sumM += SCAN.modMap[i];
  const avgM = sumM / (sW * sH);
  ctx.fillStyle = avgM > 0.3 ? '#16a34a' : avgM > 0.15 ? '#f59e0b' : '#ef4444';
  ctx.font = 'bold 10px JetBrains Mono';
  ctx.fillText(`M_avg = ${avgM.toFixed(3)}`, 6, cH - 6);
}
/* ── Phase Steps Preview (right panel) ────────────────────── */
function renderStepsPreview(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);
  const N = SIM.N;
  const barW = Math.max(4, (W - 20) / N - 2);
  const startX = (W - (barW + 2) * N) / 2;
  for (let n = 0; n < N; n++) {
    const shift = (2 * Math.PI * n) / N;
    const intensity = 0.5 + 0.5 * Math.cos(shift); /* normalised 0..1 */
    const barH = 10 + intensity * (H - 25);
    const x = startX + n * (barW + 2);
    const y = H - 5 - barH;
    /* gradient fill */
    const grad = ctx.createLinearGradient(x, y, x, y + barH);
    grad.addColorStop(0, `hsl(263, 70%, ${40 + intensity * 30}%)`);
    grad.addColorStop(1, `hsl(263, 50%, ${25 + intensity * 20}%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);
    /* step number */
    ctx.fillStyle = '#64748b';
    ctx.font = '7px JetBrains Mono';
    ctx.textAlign = 'center';
    ctx.fillText(n + 1, x + barW / 2, H - 1);
  }
  ctx.textAlign = 'left';
}
/* ── Quality Gauge (arc gauge) ────────────────────────────── */
function renderGauge(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!SCAN.modMap || !SCAN.hTrue || !SCAN.hRecov) return;
  /* compute quality score: combination of RMSE and modulation */
  const sW = SCAN.W, sH = SCAN.H;
  const midRow = Math.floor(sH / 2);
  let sumSqErr = 0, count = 0;
  for (let u = 0; u < sW; u++) {
    const idx = midRow * sW + u;
    const err = SCAN.hRecov[idx] - SCAN.hTrue[idx];
    sumSqErr += err * err;
    count++;
  }
  const rmse = Math.sqrt(sumSqErr / count);
  let sumM = 0;
  for (let i = 0; i < sW * sH; i++) sumM += SCAN.modMap[i];
  const avgM = sumM / (sW * sH);
  /* quality 0–100 based on RMSE and modulation */
  const rmseScore = clamp(1 - rmse / SIM.surfAmp, 0, 1) * 60;
  const modScore = clamp(avgM / 0.8, 0, 1) * 40;
  const quality = Math.round(rmseScore + modScore);
  const cx = W / 2, cy = H - 8, r = H - 16;
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.stroke();
  const sweepA = Math.PI + (quality / 100) * Math.PI;
  const colour = quality > 70 ? '#22c55e' : quality > 40 ? '#f59e0b' : '#ef4444';
  ctx.strokeStyle = colour;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, sweepA);
  ctx.stroke();
  /* needle */
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + (r - 4) * Math.cos(sweepA), cy + (r - 4) * Math.sin(sweepA));
  ctx.stroke();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fill();
  const qualLabel = quality > 70 ? 'Good' : quality > 40 ? 'Fair' : 'Poor';
  document.getElementById('quality-label').textContent = qualLabel + ' (' + quality + '%)';
  document.getElementById('quality-label').style.color = colour;
  document.getElementById('quality-sub').textContent =
    quality > 70 ? 'Phase map accurately recovers surface' :
    quality > 40 ? 'Some error — check parameters' :
                   'Phase extraction degraded — adjust settings';
}
/* ── RMSE vs N chart (right panel) ────────────────────────── */
function renderRmseVsN(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);
  const padL = 28, padR = 8, padT = 10, padB = 18;
  const gW = W - padL - padR, gH = H - padT - padB;
  /* compute RMSE for N = 3..16 using the current settings */
  const points = [];
  const p = SIM.p, alpha = degToRad(SIM.alpha), tanA = Math.tan(alpha);
  const ambientFrac = SIM.ambient / 100;
  const refl = SETUP.reflectivity;
  const B_base = 127 * refl;
  const A_base = 40 + ambientFrac * 200;
  /* use a 1D profile (middle row) for speed */
  const sW = 128;
  const hTrue1D = new Float64Array(sW);
  for (let u = 0; u < sW; u++) {
    const nx = u / sW;
    hTrue1D[u]  = 0.45 * Math.cos(2 * Math.PI * 2.3 * nx + 0.4);
    hTrue1D[u] += 0.30 * Math.cos(2 * Math.PI * 4.1 * nx - 1.2);
    hTrue1D[u] += 0.15 * Math.cos(2 * Math.PI * 7.5 * nx + 2.1);
    hTrue1D[u] += 0.10 * Math.cos(2 * Math.PI * 1.0 * nx);
    hTrue1D[u] *= SIM.surfAmp;
  }
  for (let N = 3; N <= 16; N++) {
    let sumSqErr = 0;
    for (let u = 0; u < sW; u++) {
      const phi_true = (2 * Math.PI * hTrue1D[u] * tanA) / p;
      let sumSin = 0, sumCos = 0;
      for (let n = 0; n < N; n++) {
        const shift_n = (2 * Math.PI * n) / N;
        const I = A_base + B_base * Math.cos(phi_true + shift_n) + gauss() * 2.0;
        sumSin += I * Math.sin(shift_n);
        sumCos += I * Math.cos(shift_n);
      }
      const phiRecov = Math.atan2(-sumSin, sumCos);
      const hRecov = (p * phiRecov) / (2 * Math.PI * tanA);
      const err = hRecov - hTrue1D[u];
      sumSqErr += err * err;
    }
    points.push({ N, rmse: Math.sqrt(sumSqErr / sW) });
  }
  let maxRmse = 0;
  points.forEach(pt => { if (pt.rmse > maxRmse) maxRmse = pt.rmse; });
  maxRmse = Math.max(maxRmse, 0.1);
  /* gridlines */
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padT + gH - (i / 4) * gH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + gW, y);
    ctx.stroke();
  }
  /* plot */
  ctx.strokeStyle = '#7c3aed';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((pt, i) => {
    const x = padL + ((pt.N - 3) / 13) * gW;
    const y = padT + gH - (pt.rmse / maxRmse) * gH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  /* dots */
  points.forEach(pt => {
    const x = padL + ((pt.N - 3) / 13) * gW;
    const y = padT + gH - (pt.rmse / maxRmse) * gH;
    const isCurrent = pt.N === SIM.N;
    ctx.fillStyle = isCurrent ? '#ef4444' : '#7c3aed';
    ctx.beginPath();
    ctx.arc(x, y, isCurrent ? 4 : 2, 0, Math.PI * 2);
    ctx.fill();
  });
  /* axis labels */
  ctx.fillStyle = '#64748b';
  ctx.font = '8px DM Sans';
  ctx.textAlign = 'center';
  ctx.fillText('N = 3', padL, H - 3);
  ctx.fillText('16', padL + gW, H - 3);
  ctx.textAlign = 'left';
}
/* ──────────────────────────────────────────────────────────────
   SIMULATION — READOUTS
────────────────────────────────────────────────────────────── */
function updateReadouts() {
  const alpha = degToRad(SIM.alpha);
  const tanA = Math.tan(alpha);
  const hmax = SIM.p / (2 * tanA);
  /* h_max */
  const hmaxEl = document.getElementById('ro-hmax');
  hmaxEl.textContent = hmax.toFixed(2);
  hmaxEl.className = 'ro-val' + (hmax > SIM.surfAmp * 1.5 ? ' good' : hmax > SIM.surfAmp ? ' warn' : ' danger');
  /* Modulation ratio */
  if (SCAN.modMap) {
    let sumM = 0;
    for (let i = 0; i < SCAN.W * SCAN.H; i++) sumM += SCAN.modMap[i];
    const avgM = sumM / (SCAN.W * SCAN.H);
    const mEl = document.getElementById('ro-M');
    mEl.textContent = avgM.toFixed(3);
    mEl.className = 'ro-val' + (avgM > 0.3 ? ' good' : avgM > 0.15 ? ' warn' : ' danger');
  }
  /* RMSE */
  if (SCAN.hTrue && SCAN.hRecov) {
    const sW = SCAN.W, sH = SCAN.H;
    const midRow = Math.floor(sH / 2);
    let sumSqErr = 0;
    for (let u = 0; u < sW; u++) {
      const idx = midRow * sW + u;
      const err = SCAN.hRecov[idx] - SCAN.hTrue[idx];
      sumSqErr += err * err;
    }
    const rmse = Math.sqrt(sumSqErr / sW);
    const rmseEl = document.getElementById('ro-rmse');
    rmseEl.textContent = rmse.toFixed(3);
    rmseEl.className = 'ro-val' + (rmse < 0.5 ? ' good' : rmse < 2 ? ' warn' : ' danger');
  }
  /* Wrap risk */
  const wrapEl = document.getElementById('ro-wrap');
  if (SIM.surfAmp > hmax) {
    wrapEl.textContent = 'HIGH';
    wrapEl.className = 'ro-val danger';
  } else if (SIM.surfAmp > hmax * 0.7) {
    wrapEl.textContent = 'Medium';
    wrapEl.className = 'ro-val warn';
  } else {
    wrapEl.textContent = 'Low';
    wrapEl.className = 'ro-val good';
  }
  /* Measurement summary (right panel) */
  document.getElementById('bb-hmax').textContent = hmax.toFixed(2) + ' mm';
  document.getElementById('bb-amp').textContent = SIM.surfAmp.toFixed(1) + ' mm';
  document.getElementById('bb-wrap').textContent = SIM.surfAmp > hmax ? 'Yes' : 'No';
  /* valid pixel fraction (M > 0.15) */
  if (SCAN.modMap) {
    let validPx = 0;
    for (let i = 0; i < SCAN.W * SCAN.H; i++) {
      if (SCAN.modMap[i] > 0.15) validPx++;
    }
    const frac = validPx / (SCAN.W * SCAN.H);
    document.getElementById('bb-valid').textContent = (frac * 100).toFixed(1) + '%';
  }
}
/* ──────────────────────────────────────────────────────────────
   SIMULATION — RENDER ALL
────────────────────────────────────────────────────────────── */
function renderAllSimCanvases() {
  runPhaseShifting();
  renderFringeImage(document.getElementById('cvs-fringe'));
  renderPhaseMap(document.getElementById('cvs-phase'));
  renderHeightProfile(document.getElementById('cvs-height'));
  renderModulationMap(document.getElementById('cvs-modulation'));
  renderStepsPreview(document.getElementById('cvs-steps'));
  renderGauge(document.getElementById('gauge-canvas'));
  renderRmseVsN(document.getElementById('cvs-rmse-n'));
  updateReadouts();
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
  document.querySelectorAll('.ctrl-group').forEach(el => el.classList.remove('lit'));
  if (s.lit) {
    const el = document.getElementById(s.lit);
    if (el) { el.classList.add('lit'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  document.querySelectorAll('.wdot').forEach((d, i) => {
    d.classList.remove('active', 'done');
    if (i === step) d.classList.add('active');
    if (i < step) d.classList.add('done');
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
let simInitialised = false;
function initSimulation() {
  if (simInitialised) {
    renderAllSimCanvases();
    return;
  }
  simInitialised = true;
  updateSimWizard();
  renderAllSimCanvases();
  /* Parameter sliders — scope to sim page to avoid ID conflicts */
  const simPage = document.getElementById('page-sim');
  simPage.querySelector('#r-N').value = SIM.N;
  document.getElementById('pv-N').textContent = SIM.N;
  simPage.querySelector('#r-p').value = SIM.p;
  document.getElementById('pv-p').textContent = SIM.p + ' mm';
  simPage.querySelector('#r-ambient').value = SIM.ambient;
  document.getElementById('pv-ambient').textContent = SIM.ambient + '%';
  simPage.querySelector('#r-N').addEventListener('input', e => {
    SIM.N = parseInt(e.target.value);
    document.getElementById('pv-N').textContent = SIM.N;
    renderAllSimCanvases();
  });
  simPage.querySelector('#r-p').addEventListener('input', e => {
    SIM.p = parseInt(e.target.value);
    document.getElementById('pv-p').textContent = SIM.p + ' mm';
    renderAllSimCanvases();
  });
  simPage.querySelector('#r-alpha').addEventListener('input', e => {
    SIM.alpha = parseInt(e.target.value);
    document.getElementById('pv-alpha').textContent = SIM.alpha + '°';
    renderAllSimCanvases();
  });
  simPage.querySelector('#r-ambient').addEventListener('input', e => {
    SIM.ambient = parseInt(e.target.value);
    document.getElementById('pv-ambient').textContent = SIM.ambient + '%';
    renderAllSimCanvases();
  });
  simPage.querySelector('#r-surf').addEventListener('input', e => {
    SIM.surfAmp = parseFloat(e.target.value);
    document.getElementById('pv-surf').textContent = SIM.surfAmp + ' mm';
    renderAllSimCanvases();
  });
  /* Wizard navigation */
  document.getElementById('wiz-next').addEventListener('click', () => {
    SIM.step = Math.min(SIM.step + 1, SIM_WIZARD.length - 1);
    updateSimWizard();
  });
  document.getElementById('wiz-skip').addEventListener('click', () => {
    SIM.step = SIM_WIZARD.length - 1;
    updateSimWizard();
  });
  document.querySelectorAll('.wdot').forEach(d => d.addEventListener('click', () => {
    SIM.step = parseInt(d.dataset.ws);
    updateSimWizard();
  }));
  /* Reset buttons */
  ['btn-sim-reset', 'btn-sim-reset2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', resetSimulationFull);
  });
  /* Responsive re-render */
  const ro = new ResizeObserver(() => renderAllSimCanvases());
  document.querySelectorAll('.sim-card').forEach(c => ro.observe(c));
}
function resetSimulationFull() {
  SIM.N = 4;
  SIM.p = 8;
  SIM.alpha = SETUP.alpha;
  SIM.ambient = 5;
  SIM.surfAmp = SETUP.amplitude;
  SIM.step = 0;
  const simPage = document.getElementById('page-sim');
  simPage.querySelector('#r-N').value = 4;
  simPage.querySelector('#r-p').value = 8;
  simPage.querySelector('#r-alpha').value = SIM.alpha;
  simPage.querySelector('#r-ambient').value = 5;
  simPage.querySelector('#r-surf').value = SIM.surfAmp;
  document.getElementById('pv-N').textContent = '4';
  document.getElementById('pv-p').textContent = '8 mm';
  document.getElementById('pv-alpha').textContent = SIM.alpha + '°';
  document.getElementById('pv-ambient').textContent = '5%';
  document.getElementById('pv-surf').textContent = SIM.surfAmp + ' mm';
  updateSimWizard();
  renderAllSimCanvases();
}
/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — RESET
────────────────────────────────────────────────────────────── */
function resetSetup() {
  Object.keys(MOUNTED).forEach(k => MOUNTED[k] = false);
  if (projectorGroup) projectorGroup.visible = false;
  if (cameraGroup) cameraGroup.visible = false;
  if (surfaceMesh) surfaceMesh.visible = false;
  if (enclosureGroup) enclosureGroup.visible = false;
  if (baselineLine) baselineLine.visible = false;
  if (fringeBeamGroup) fringeBeamGroup.visible = false;
  document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('mounted'));
  document.querySelectorAll('.apparatus-status').forEach(s => s.textContent = 'Unmounted');
  
  const btnMount = document.getElementById('btn-mount');
  if (btnMount) btnMount.style.display = 'flex';
  
  selectApparatus('projector');
  const srAlpha = document.getElementById('sr-alpha');
  srAlpha.value = 30;
  srAlpha.dispatchEvent(new Event('input'));
  const srAmp = document.getElementById('sr-amp');
  srAmp.value = 5;
  srAmp.dispatchEvent(new Event('input'));
  const srRefl = document.getElementById('sr-refl');
  srRefl.value = 0.85;
  srRefl.dispatchEvent(new Event('input'));
  document.getElementById('btn-next-obs').disabled = true;
  if(document.getElementById('btn-launch-sim')) document.getElementById('btn-launch-sim').disabled = true;
  gotoSetupStep(0);
}
/* ──────────────────────────────────────────────────────────────
   INIT — entry point
────────────────────────────────────────────────────────────── */
function init() {
  initThree();
  /* Initialize setup slider fills */
  document.querySelectorAll('.setup-range').forEach(slider => {
    const updateFill = () => {
      const min = parseFloat(slider.min) || 0;
      const max = parseFloat(slider.max) || 100;
      const val = parseFloat(slider.value) || 0;
      const pct = ((val - min) / (max - min)) * 100;
      slider.parentElement.style.setProperty('--fill', pct + '%');
    };
    slider.addEventListener('input', updateFill);
    updateFill();
  });
  document.querySelectorAll('.apparatus-card').forEach(card => {
    card.addEventListener('click', () => {
      selectApparatus(card.dataset.comp);
    });
  });
  const globalBtnMount = document.getElementById('btn-mount');
  if (globalBtnMount) globalBtnMount.addEventListener('click', handleMount);
  /* Step navigation */
  document.querySelectorAll('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => gotoSetupStep(parseInt(btn.dataset.next)));
  });
  document.querySelectorAll('[data-prev]').forEach(btn => {
    btn.addEventListener('click', () => gotoSetupStep(parseInt(btn.dataset.prev)));
  });
  /* Setup sliders — Step 2: baseline angle α */
  document.getElementById('sr-alpha').addEventListener('input', e => {
    SETUP.alpha = parseInt(e.target.value);
    document.getElementById('sv-alpha').textContent = SETUP.alpha + '°';
    updateCameraGroupPosition();
    updateBaselineLine();
  });
  /* Setup sliders — Step 3: surface amplitude */
  document.getElementById('sr-amp').addEventListener('input', e => {
    SETUP.amplitude = parseFloat(e.target.value);
    document.getElementById('sv-amp').textContent = SETUP.amplitude + ' mm';
  });
  /* Setup sliders — Step 3: surface reflectivity */
  document.getElementById('sr-refl').addEventListener('input', e => {
    SETUP.reflectivity = parseFloat(e.target.value);
    document.getElementById('sv-refl').textContent = SETUP.reflectivity.toFixed(2);
    document.getElementById('refl-display').textContent = Math.round(SETUP.reflectivity * 100) + '%';
    document.getElementById('refl-fill').style.width = (SETUP.reflectivity * 100) + '%';
  });
  /* Confirm configuration button */
  document.getElementById('btn-capture').addEventListener('click', confirmConfiguration);
  /* View buttons */
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
  /* Page navigation */
  document.getElementById('btn-launch-sim').addEventListener('click', showSimulation);
  if (document.getElementById('btn-launch-sim')) document.getElementById('btn-launch-sim').addEventListener('click', showSimulation);
  if (document.getElementById('btn-back-setup')) document.getElementById('btn-back-setup').addEventListener('click', showSetup);
  if (document.getElementById('btn-reset-setup')) document.getElementById('btn-reset-setup').addEventListener('click', resetSetup);
  /* prevent context menu on canvas */
  document.getElementById('three-canvas').addEventListener('contextmenu', e => e.preventDefault());
}
window.addEventListener('load', init);

