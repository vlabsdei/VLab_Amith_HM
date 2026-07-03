/* ================================================================
   EXPERIMENT 5 — LIDAR PULSE TIME-OF-FLIGHT SIMULATION
   main.js — Three.js 3D setup scene + real ray-casting LiDAR engine
   ================================================================

   ARCHITECTURE
   ────────────
   SETUP PAGE
     ThreeScene    → renderer, camera, orbit controls, room + sensor
     Components    → tracks mounted equipment (lidar, tripod, walls, pole)
     RoomBuilder   → rectangular room with adjustable size + obstacle pole
     SetupWizard   → step navigation (0→4)

   SIMULATION PAGE
     RoomGeometry  → wall segments (line segments) + pole (circle) as
                     ray-intersection targets, built fresh per shape config
     RayCast       → for each angular step, cast a ray from sensor centre,
                     find nearest intersected segment, apply reflectivity
                     probability + noise to decide hit/miss and distance
     render*()     → polar map, distance-vs-angle, coverage timeline,
                     completeness breakdown
     WizardSim     → 4-step guided walkthrough

   CORE MATH (Experiment 5 theory) — all genuinely computed, not faked
   ────────────────────────────────────────────────────────────────────
     Distance:        d = (c × t_return) / 2     (modelled directly as d)
     Cartesian conv:  x = d·cos(θ),  y = d·sin(θ)
     Points/rotation: N = 360° / angular_resolution
     Rotation period: T_rotation = 60 / RPM
     Coverage check:  P = pulse_frequency × T_rotation,  need P ≥ N
     Noise model:     d_measured = d_true + N(0, σ²)
     Detection prob:  hit if random() < reflectivity (per pulse)
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */

const MOUNTED = { lidar: false, tripod: false, walls: false, obstacle: false };

const SETUP = {
  roomHalfWidth: 3.5,
  poleDist: 2.5,
  reflectivity: 0.90,
};

const SIM = {
  angRes:      0.5,    /* degrees                       */
  rpm:         600,
  pulseFreq:   8000,   /* Hz                             */
  reflectFar:  0.90,
  noise:       5,      /* mm                             */
  step:        0,      /* wizard step                    */
  sweepRunning: false,
  sweepAngle:   0,      /* degrees, current beam position */
};

/* Room geometry used by the ray-casting engine in the simulation.
   A simple rectangular room with one obstacle pole.               */
let ROOM = {
  halfW: 3.5,
  halfD: 3.5,
  poleDist: 2.5,
  poleRadius: 0.02,     /* 4cm diameter → 2cm radius */
  wallReflect: { near: 0.9, far: 0.9, left: 0.9, right: 0.9 },
};

/* Captured scan results: array of {angleDeg, dist, hit, isPole} */
let SCAN_POINTS = [];

/* Wizard content for simulation page */
const SIM_WIZARD = [
  {
    title: 'Watch the Sweep',
    text:  'Press Start Sweep to see the beam rotate continuously, with each pulse plotted on the polar map the instant its return is detected.',
    task:  '▶ Press Start Sweep and watch one full rotation complete.',
    lit:   'pg-angres',
  },
  {
    title: 'Coarsen the Resolution',
    text:  'Increase angular resolution well above 5° and look for the narrow pole disappearing from the map — the angular steps now jump past its thin profile.',
    task:  '▶ Set resolution to 8° and run a full scan. Check if the pole is detected.',
    lit:   'pg-angres',
  },
  {
    title: 'Break the Coverage Check',
    text:  'Push rotation speed high while keeping pulse frequency low. When P falls below N, angular gaps appear even though the sensor itself is working fine.',
    task:  '▶ Set RPM to 1500 and pulse frequency to 2000 Hz. Watch gaps appear.',
    lit:   'pg-rpm',
  },
  {
    title: 'Darken a Wall',
    text:  'Reduce far wall reflectivity and observe intermittent detection — some pulses return successfully, others do not, even at a fixed, unchanging distance.',
    task:  '▶ Set far wall reflectivity to 0.08 and run a full scan.',
    lit:   'pg-reflect',
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
function fmtNum(n) { return n.toLocaleString('en-IN'); }

/* ──────────────────────────────────────────────────────────────
   RAY-CASTING ENGINE — finds true distance + which wall/object
   a beam at angle θ would strike, plus that surface's reflectivity
────────────────────────────────────────────────────────────── */

/* Returns { dist, reflectivity, isPole } for the true (noise-free)
   intersection of a ray from origin at angle θ (radians) with the
   rectangular room walls and the obstacle pole, whichever is closer. */
function castRay(thetaRad) {
  const dx = Math.cos(thetaRad), dy = Math.sin(thetaRad);

  /* Intersect with 4 walls of the rectangle [-halfW,halfW] x [-halfD,halfD] */
  const candidates = [];

  /* right wall x = halfW */
  if (dx > 1e-9) {
    const t = ROOM.halfW / dx;
    const y = dy * t;
    if (Math.abs(y) <= ROOM.halfD) candidates.push({ t, reflect: ROOM.wallReflect.right, wall:'right' });
  }
  /* left wall x = -halfW */
  if (dx < -1e-9) {
    const t = -ROOM.halfW / dx;
    const y = dy * t;
    if (Math.abs(y) <= ROOM.halfD) candidates.push({ t, reflect: ROOM.wallReflect.left, wall:'left' });
  }
  /* far wall y = halfD */
  if (dy > 1e-9) {
    const t = ROOM.halfD / dy;
    const x = dx * t;
    if (Math.abs(x) <= ROOM.halfW) candidates.push({ t, reflect: ROOM.wallReflect.far, wall:'far' });
  }
  /* near wall y = -halfD */
  if (dy < -1e-9) {
    const t = -ROOM.halfD / dy;
    const x = dx * t;
    if (Math.abs(x) <= ROOM.halfW) candidates.push({ t, reflect: ROOM.wallReflect.near, wall:'near' });
  }

  /* Intersect with pole — a circle of radius poleRadius centred at (0, poleDist) */
  const pcx = 0, pcy = ROOM.poleDist;
  const ocx = -pcx, ocy = -pcy; /* origin relative to circle centre, ray starts at 0,0 */
  /* solve |t*dir - (pcx,pcy)|^2 = r^2 */
  const bq = -2*(dx*pcx + dy*pcy);
  const cq = pcx*pcx + pcy*pcy - ROOM.poleRadius*ROOM.poleRadius;
  const disc = bq*bq - 4*cq;
  let poleHit = null;
  if (disc >= 0) {
    const sqrtDisc = Math.sqrt(disc);
    const t1 = (-bq - sqrtDisc) / 2;
    const t2 = (-bq + sqrtDisc) / 2;
    const tPole = t1 > 1e-6 ? t1 : (t2 > 1e-6 ? t2 : null);
    if (tPole !== null) poleHit = { t: tPole, reflect: 0.85, wall: 'pole', isPole: true };
  }
  if (poleHit) candidates.push(poleHit);

  if (candidates.length === 0) return null;
  candidates.sort((a,b) => a.t - b.t);
  const best = candidates[0];
  return { dist: best.t, reflectivity: best.reflect, isPole: !!best.isPole, wall: best.wall };
}

/* Simulate firing one pulse at angle θ (degrees), applying reflectivity-based
   detection probability and Gaussian range noise on a successful hit.        */
function firePulse(angleDeg) {
  const theta = degToRad(angleDeg);
  const truth = castRay(theta);
  if (!truth) return { angleDeg, hit: false, dist: null, isPole: false };

  /* reflectivity acts as detection probability for this pulse */
  const detected = Math.random() < truth.reflectivity;
  if (!detected) return { angleDeg, hit: false, dist: null, isPole: truth.isPole };

  const noisyDist = truth.dist + gauss() * (SIM.noise / 1000);
  return { angleDeg, hit: true, dist: Math.max(0.05, noisyDist), isPole: truth.isPole };
}

/* ──────────────────────────────────────────────────────────────
   THREE.JS SCENE — SETUP PAGE
────────────────────────────────────────────────────────────── */

let renderer, scene, camera, animFrame;
let lidarMesh, tripodMesh, wallsGroup, poleMesh, beamLine, hitMarkersGroup;
let orbitTarget = new THREE.Vector3(0, 0.6, 0);
let isDragging = false, lastMouse = {x:0, y:0};
let phi = Math.PI/4, theta = Math.PI/4, radius = 7.0;
let currentView = 'iso';
let setupSweepAngle = 0;

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
  scene.fog = new THREE.Fog(0xe8edf5, 10, 22);

  camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 30);
  setViewISO();

  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
  dirLight.position.set(5, 8, 4);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024,1024);
  scene.add(dirLight);

  const floorGeo = new THREE.PlaneGeometry(14, 14);
  const floorMat = new THREE.MeshLambertMaterial({ color: 0xd8dfe8 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI/2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(14, 28, 0xb8c4d4, 0xccd5e0);
  grid.material.opacity = 0.5; grid.material.transparent = true;
  scene.add(grid);

  buildTripodMesh();
  buildLidarMesh();
  buildWallsGroup();
  buildPoleMesh();
  buildBeamLine();
  buildHitMarkersGroup();

  setupOrbitControls(canvas);
  window.addEventListener('resize', resizeRenderer);
  animateThree();
}

function resizeRenderer() {
  const wrap = document.getElementById('three-canvas').parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  if (camera) { camera.aspect = w/h; camera.updateProjectionMatrix(); }
}

function animateThree() {
  animFrame = requestAnimationFrame(animateThree);

  if (lidarMesh && lidarMesh.visible && MOUNTED.lidar) {
    setupSweepAngle += 1.2;
    lidarMesh.children[0].rotation.y = degToRad(setupSweepAngle);
    updateSetupBeam();
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

function setViewISO()   { phi = Math.PI/4;  theta = Math.PI/4;  radius = 7.0; }
function setViewTop()   { phi = 0;          theta = 0.01;       radius = 8.0; }
function setViewFront() { phi = 0;          theta = Math.PI/2;  radius = 7.0; }
function setViewSide()  { phi = Math.PI/2;  theta = Math.PI/2;  radius = 7.0; }

function setupOrbitControls(canvas) {
  canvas.addEventListener('mousedown', e => { isDragging=true; lastMouse={x:e.clientX,y:e.clientY}; });
  window.addEventListener('mouseup', () => { isDragging=false; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx=e.clientX-lastMouse.x, dy=e.clientY-lastMouse.y;
    lastMouse={x:e.clientX,y:e.clientY};
    if (e.buttons===1) {
      phi -= dx*0.008; theta = Math.max(0.05, Math.min(Math.PI-0.05, theta+dy*0.008));
      document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
    } else if (e.buttons===2) {
      orbitTarget.x -= dx*0.006; orbitTarget.y += dy*0.006;
    }
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); radius = Math.max(2.5, Math.min(16, radius+e.deltaY*0.008)); }, {passive:false});

  let lastTouch=null, lastTouchDist=0;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length===1) { isDragging=true; lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY}; }
    else if (e.touches.length===2) { lastTouchDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); }
  });
  canvas.addEventListener('touchend', () => { isDragging=false; lastTouch=null; });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length===1 && isDragging && lastTouch) {
      const dx=e.touches[0].clientX-lastTouch.x, dy=e.touches[0].clientY-lastTouch.y;
      lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY};
      phi -= dx*0.01; theta = Math.max(0.05, Math.min(Math.PI-0.05, theta+dy*0.01));
    } else if (e.touches.length===2) {
      const dist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      radius = Math.max(2.5, Math.min(16, radius*(lastTouchDist/dist))); lastTouchDist = dist;
    }
  }, {passive:false});
}

function buildTripodMesh() {
  tripodMesh = new THREE.Group();
  const baseGeo = new THREE.CylinderGeometry(0.18, 0.20, 0.04, 16);
  const baseMat = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 50 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.02;
  tripodMesh.add(base);

  const armGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.9, 10);
  const armMat = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, shininess: 70 });
  const arm = new THREE.Mesh(armGeo, armMat);
  arm.position.y = 0.48;
  arm.castShadow = true;
  tripodMesh.add(arm);

  tripodMesh.visible = false;
  scene.add(tripodMesh);
}

function buildLidarMesh() {
  const group = new THREE.Group();

  /* rotating drum */
  const drumGroup = new THREE.Group();
  const drumGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.13, 24);
  const drumMat = new THREE.MeshPhongMaterial({ color: 0x1c1c1c, shininess: 80 });
  const drum = new THREE.Mesh(drumGeo, drumMat);
  drum.castShadow = true;
  drumGroup.add(drum);

  /* emitter slit */
  const slitGeo = new THREE.BoxGeometry(0.02, 0.10, 0.02);
  const slitMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
  const slit = new THREE.Mesh(slitGeo, slitMat);
  slit.position.set(0.09, 0, 0);
  drumGroup.add(slit);

  group.add(drumGroup);

  /* static base */
  const baseGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.04, 20);
  const baseMat = new THREE.MeshPhongMaterial({ color: 0x2d2d2d, shininess: 50 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = -0.085;
  group.add(base);

  group.position.set(0, 0.97, 0);
  group.visible = false;
  lidarMesh = group;
  scene.add(group);
}

function buildWallsGroup() {
  wallsGroup = new THREE.Group();
  const h = 1.6;
  const wallMat = (colour) => new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide });

  const makeWall = (w, d, x, z, rotY, colour) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mesh = new THREE.Mesh(geo, wallMat(colour));
    mesh.position.set(x, h/2, z);
    mesh.rotation.y = rotY;
    mesh.receiveShadow = true;
    wallsGroup.add(mesh);
  };

  const hw = SETUP.roomHalfWidth;
  makeWall(hw*2, 0, 0, -hw, 0, 0xc7d2fe);          /* far  */
  makeWall(hw*2, 0, 0,  hw, Math.PI, 0xe0e7ff);     /* near */
  makeWall(hw*2, 0, -hw, 0, Math.PI/2, 0xddd6fe);   /* left */
  makeWall(hw*2, 0,  hw, 0, -Math.PI/2, 0xddd6fe);  /* right*/

  wallsGroup.visible = false;
  scene.add(wallsGroup);
}

function buildPoleMesh() {
  const geo = new THREE.CylinderGeometry(0.02, 0.02, 1.5, 16);
  const mat = new THREE.MeshPhongMaterial({ color: 0xd97706, shininess: 30 });
  poleMesh = new THREE.Mesh(geo, mat);
  poleMesh.position.set(0, 0.75, -SETUP.poleDist);
  poleMesh.castShadow = true;
  poleMesh.visible = false;
  scene.add(poleMesh);
}

function buildBeamLine() {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0.97,0), new THREE.Vector3(5,0.97,0)]);
  const mat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 });
  beamLine = new THREE.Line(geo, mat);
  beamLine.visible = false;
  scene.add(beamLine);
}

function buildHitMarkersGroup() {
  hitMarkersGroup = new THREE.Group();
  scene.add(hitMarkersGroup);
}

function updateSetupBeam() {
  if (!beamLine.visible) return;
  const rad = degToRad(setupSweepAngle);
  const hw = SETUP.roomHalfWidth;

  /* simple intersection with the 4-wall box for beam visual length */
  const dx = Math.sin(rad), dz = -Math.cos(rad);
  let tBest = 20;
  if (dx > 1e-6) tBest = Math.min(tBest, hw/dx);
  if (dx < -1e-6) tBest = Math.min(tBest, -hw/dx);
  if (dz > 1e-6) tBest = Math.min(tBest, hw/dz);
  if (dz < -1e-6) tBest = Math.min(tBest, -hw/dz);

  const endX = dx * tBest, endZ = dz * tBest;
  beamLine.geometry.setFromPoints([
    new THREE.Vector3(0, 0.97, 0),
    new THREE.Vector3(endX, 0.97, endZ)
  ]);

  /* drop a marker occasionally to show "live hits" */
  if (Math.random() < 0.15) {
    const markerGeo = new THREE.SphereGeometry(0.025, 8, 8);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(endX, 0.05, endZ);
    hitMarkersGroup.add(marker);
    if (hitMarkersGroup.children.length > 140) {
      hitMarkersGroup.remove(hitMarkersGroup.children[0]);
    }
  }
}

function rebuildRoomFromSetup() {
  scene.remove(wallsGroup);
  buildWallsGroup();
  wallsGroup.visible = MOUNTED.walls;
  poleMesh.position.set(0, 0.75, -SETUP.poleDist);

  const angRes = 0.5;
  const N = Math.round(360/angRes);
  const trot = 60/600;
  const P = 8000*trot;

  document.getElementById('obs-angres').textContent = angRes.toFixed(2) + '°';
  document.getElementById('obs-ptsrot').textContent = fmtNum(N);
  document.getElementById('obs-trot').textContent = trot.toFixed(2) + ' s';
  document.getElementById('obs-coverage').textContent = (P>=N ? 'OK (' : 'FAIL (') + Math.round(P) + '/' + N + ')';
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — STEP NAVIGATION
────────────────────────────────────────────────────────────── */

let currentSetupStep = 0;

const WIZARD_STEPS = [
  {
    title: "Components",
    text: "These are the components used in a rotating LiDAR scanning session. Click Mount to bring each one into the workspace.",
    task: "Select <strong>Component</strong> from the apparatus list → Click <strong>Mount Component</strong>."
  },
  {
    title: "Room Settings",
    text: "Set the physical bounds of the room being scanned.",
    task: "Use the slider to adjust the <strong>Room Width</strong>."
  },
  {
    title: "Obstacle Setup",
    text: "Place an obstacle in the room to observe how it casts a 'shadow' in the LiDAR scan.",
    task: "Adjust the <strong>Pole Distance</strong> from the sensor."
  },
  {
    title: "Surface Properties",
    text: "The reflectivity of walls affects how much of the emitted pulse returns to the sensor.",
    task: "Set the <strong>Wall Reflectivity</strong>."
  },
  {
    title: "Confirm Setup",
    text: "Your physical environment is ready for scanning. Review the settings below.",
    task: "Click <strong>Launch Simulation</strong> to proceed to the interactive scanning view."
  }
];

function gotoSetupStep(n) {
  n = Math.max(0, Math.min(4, n));
  currentSetupStep = n;
  
  if (n > 0) {
    const stepInfo = WIZARD_STEPS[n];
    document.getElementById('step-badge').textContent = `STEP ${n+1} OF 5`;
    document.getElementById('wizard-title').textContent = stepInfo.title;
    document.getElementById('wizard-text').textContent = stepInfo.text;
    document.getElementById('wizard-task').innerHTML = stepInfo.task;
  } else {
    document.getElementById('step-badge').textContent = `STEP 1 OF 5`;
    selectApparatus(selectedApparatus);
  }

  document.querySelectorAll('.step-content').forEach((el,i)=>el.classList.toggle('active', i===n));
  document.querySelectorAll('.sstep').forEach((el,i)=>{
    el.classList.remove('active','done');
    if(i===n) el.classList.add('active');
    if(i<n) el.classList.add('done');
  });
  document.getElementById('obs-overlay').style.display = n===4 ? 'block' : 'none';
  if (n>=4) { document.getElementById('btn-launch-sim').disabled=false; computeAndDisplayResults(); }
}

/* ──────────────────────────────────────────────────────────────
   COMPONENT MOUNTING
────────────────────────────────────────────────────────────── */

let selectedApparatus = 'lidar';

const APPARATUS_INFO = {
  lidar: { title: "2D LiDAR Sensor", text: "The core scanning device. Emits laser pulses and measures the time-of-flight to calculate distances." },
  tripod: { title: "Sensor Tripod", text: "A stable mount for the LiDAR. Ensures the sensor remains perfectly level and stationary during rotation." },
  walls: { title: "Enclosure Walls", text: "The boundaries of the room. Their surfaces will reflect the LiDAR pulses back to the sensor." },
  obstacle: { title: "Obstacle Pole", text: "A cylindrical obstacle placed in the room. It will block laser pulses, creating a 'shadow' region behind it where the walls cannot be seen." }
};

function selectApparatus(name) {
  selectedApparatus = name;
  document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.apparatus-card[data-comp="${name}"]`);
  if (card) card.classList.add('selected');

  if (currentSetupStep === 0) {
    const info = APPARATUS_INFO[name];
    if (info) {
      document.getElementById('wizard-title').textContent = info.title;
      document.getElementById('wizard-text').textContent = info.text;
      document.getElementById('wizard-task').innerHTML = "Click <strong>Mount Component</strong> to place it in the scene.";
    }
  }
}

function handleMount() {
  if (!selectedApparatus || MOUNTED[selectedApparatus]) return;
  mountComponent(selectedApparatus);
  
  const compOrder = ['lidar', 'tripod', 'walls', 'obstacle'];
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
  MOUNTED[name] = true;
  switch(name) {
    case 'lidar':    lidarMesh.visible = true; beamLine.visible = true; break;
    case 'tripod':   tripodMesh.visible = true; break;
    case 'walls':    wallsGroup.visible = true; break;
    case 'obstacle': poleMesh.visible = true; break;
  }
  
  const card = document.querySelector(`.apparatus-card[data-comp="${name}"]`);
  if (card) card.classList.add('mounted');
  
  const status = document.getElementById(`state-${name}`);
  if (status) status.textContent = 'Mounted';

  const allMounted = Object.values(MOUNTED).every(Boolean);
  if (allMounted) {
    const btnNext = document.getElementById('btn-next-sc0');
    if (btnNext) btnNext.style.display = 'flex';
    const btnMount = document.getElementById('btn-mount');
    if (btnMount) btnMount.style.display = 'none';
  }
  if (allMounted && currentSetupStep===0) setTimeout(()=>gotoSetupStep(1), 400);
}

function mountAll() { Object.keys(MOUNTED).forEach(mountComponent); }

/* ──────────────────────────────────────────────────────────────
   SETUP STEP 3/4 — CONFIRM + RESULTS
────────────────────────────────────────────────────────────── */

function confirmConfiguration() {
  document.getElementById('btn-next-obs').disabled = false;
}

function computeAndDisplayResults() {
  const angRes = 0.5;
  const N = Math.round(360/angRes);

  document.getElementById('r-roomw').textContent   = (SETUP.roomHalfWidth*2).toFixed(1);
  document.getElementById('r-poled').textContent   = SETUP.poleDist.toFixed(1);
  document.getElementById('r-reflect').textContent = SETUP.reflectivity.toFixed(2);
  document.getElementById('r-angres').textContent  = angRes.toFixed(1) + '°';
  document.getElementById('r-pts').textContent     = fmtNum(N);
}

/* ──────────────────────────────────────────────────────────────
   PAGE SWITCHING
────────────────────────────────────────────────────────────── */

function showSimulation() {
  document.getElementById('page-setup').classList.remove('active');
  document.getElementById('page-sim').classList.add('active');
  cancelAnimationFrame(animFrame);

  ROOM.halfW = SETUP.roomHalfWidth;
  ROOM.halfD = SETUP.roomHalfWidth;
  ROOM.poleDist = SETUP.poleDist;
  ROOM.wallReflect.far = SETUP.reflectivity;
  SIM.reflectFar = SETUP.reflectivity;

  document.getElementById('r-reflect').value = SIM.reflectFar;
  document.getElementById('pv-reflect').textContent = SIM.reflectFar.toFixed(2);

  initSimulation();
}

function showSetup() {
  document.getElementById('page-sim').classList.remove('active');
  document.getElementById('page-setup').classList.add('active');
  animateThree();
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — SWEEP ENGINE
────────────────────────────────────────────────────────────── */

let sweepTimer = null;

function resetScan() {
  SCAN_POINTS = [];
  SIM.sweepAngle = 0;
  ROOM.wallReflect = { near: 0.9, far: SIM.reflectFar, left: 0.9, right: 0.9 };
}

function stepSweep() {
  const N = Math.round(360 / SIM.angRes);
  const stepDeg = 360 / N;

  const result = firePulse(SIM.sweepAngle);
  SCAN_POINTS.push(result);

  SIM.sweepAngle += stepDeg;
  if (SIM.sweepAngle >= 360) {
    SIM.sweepAngle = 0;
    stopSweep();
  }
  renderAllSimCanvases();
}

function startSweep() {
  if (SIM.sweepRunning) return;
  SIM.sweepRunning = true;
  document.getElementById('btn-sweep-toggle').textContent = 'Pause Sweep';
  const intervalMs = Math.max(4, 60 - SIM.rpm/40); /* faster RPM = faster visual tick */
  sweepTimer = setInterval(() => {
    stepSweep();
    if (!SIM.sweepRunning) clearInterval(sweepTimer);
  }, intervalMs);
}

function stopSweep() {
  SIM.sweepRunning = false;
  document.getElementById('btn-sweep-toggle').textContent = 'Start Sweep';
  if (sweepTimer) clearInterval(sweepTimer);
}

function toggleSweep() {
  if (SIM.sweepRunning) stopSweep(); else startSweep();
}

function completeFullScan() {
  stopSweep();
  resetScan();
  const N = Math.round(360 / SIM.angRes);
  const stepDeg = 360 / N;
  for (let i = 0; i < N; i++) {
    SCAN_POINTS.push(firePulse(i * stepDeg));
  }
  SIM.sweepAngle = 0;
  renderAllSimCanvases();
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION CANVAS RENDERERS
────────────────────────────────────────────────────────────── */

function renderPolarMap(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth||canvas.width, H = canvas.offsetHeight||canvas.height;
  if (canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,W,H);

  const cx = W/2, cy = H/2;
  const maxRange = Math.max(ROOM.halfW, ROOM.halfD) * 1.5;
  const scale = Math.min(W,H)/2 / maxRange * 0.92;

  /* range rings */
  ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 0.5;
  for (let r=1; r<=Math.ceil(maxRange); r++) {
    ctx.beginPath(); ctx.arc(cx,cy, r*scale, 0, Math.PI*2); ctx.stroke();
  }

  /* sensor centre */
  ctx.fillStyle = '#0f172a';
  ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2); ctx.fill();

  /* plot all hit points */
  SCAN_POINTS.forEach(pt => {
    if (!pt.hit) return;
    const rad = degToRad(pt.angleDeg);
    const x = cx + pt.dist * scale * Math.sin(rad);
    const y = cy - pt.dist * scale * Math.cos(rad);
    ctx.fillStyle = pt.isPole ? '#dc2626' : '#0891b2';
    ctx.beginPath(); ctx.arc(x,y,1.6,0,Math.PI*2); ctx.fill();
  });

  /* current beam direction (live sweep indicator) */
  if (SIM.sweepRunning || SIM.sweepAngle > 0) {
    const rad = degToRad(SIM.sweepAngle);
    ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(cx + maxRange*scale*Math.sin(rad), cy - maxRange*scale*Math.cos(rad));
    ctx.stroke();
  }

  ctx.fillStyle = '#64748b'; ctx.font = '9px JetBrains Mono';
  ctx.fillText(`${SCAN_POINTS.filter(p=>p.hit).length} / ${SCAN_POINTS.length} pulses returned`, 8, H-8);
}

function renderDistAngle(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth||canvas.width, H = canvas.offsetHeight||canvas.height;
  if (canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,W,H);

  const padL=34, padR=10, padT=14, padB=24;
  const gW=W-padL-padR, gH=H-padT-padB;
  const maxRange = Math.max(ROOM.halfW, ROOM.halfD) * 1.5;

  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=0.5;
  for (let i=0;i<=4;i++){ const y=padT+gH-(i/4)*gH; ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(padL+gW,y); ctx.stroke(); }

  ctx.fillStyle='#64748b'; ctx.font='9px DM Sans'; ctx.textAlign='center';
  ctx.fillText('Angle (0–360°)', padL+gW/2, H-4);

  SCAN_POINTS.forEach(pt => {
    const x = padL + (pt.angleDeg/360)*gW;
    if (!pt.hit) { return; }
    const y = padT + gH - Math.min(gH, (pt.dist/maxRange)*gH);
    ctx.fillStyle = pt.isPole ? '#dc2626' : '#0891b2';
    ctx.beginPath(); ctx.arc(x,y,1.5,0,Math.PI*2); ctx.fill();
  });
  ctx.textAlign='left';
}

function renderCoverage(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth||canvas.width, H = canvas.offsetHeight||canvas.height;
  if (canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,W,H);

  const N = Math.round(360/SIM.angRes);
  const trot = 60/SIM.rpm;
  const P = SIM.pulseFreq * trot;
  const ratio = P / N;

  const degreesToShow = 10;
  const fraction = degreesToShow / 360;
  
  const stepsInView = Math.round(N * fraction);
  const pulsesInView = Math.round(P * fraction);
  
  ctx.fillStyle = '#334155'; ctx.font='bold 11px DM Sans'; ctx.textAlign='left';
  ctx.fillText(`Zoomed View (${degreesToShow}° window)`, 10, 20);

  const padL = 20, padR = 20, drawW = W - padL - padR;
  
  const ySteps = 45;
  ctx.fillStyle = '#64748b'; ctx.font = '10px DM Sans';
  ctx.fillText(`Required Angles (N=${fmtNum(N)}/rot)`, padL, ySteps - 8);
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(padL, ySteps); ctx.lineTo(padL+drawW, ySteps); ctx.stroke();
  
  ctx.fillStyle = '#475569';
  for(let i=0; i<=stepsInView; i++) {
    const x = padL + (i/Math.max(1, stepsInView)) * drawW;
    ctx.beginPath(); ctx.arc(x, ySteps, 3, 0, Math.PI*2); ctx.fill();
  }

  const yPulses = 85;
  ctx.fillStyle = ratio >= 1 ? '#0284c7' : '#ef4444';
  ctx.fillText(`Available Pulses (P=${fmtNum(Math.round(P))}/rot)`, padL, yPulses - 8);
  ctx.strokeStyle = ratio >= 1 ? '#bae6fd' : '#fecaca'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(padL, yPulses); ctx.lineTo(padL+drawW, yPulses); ctx.stroke();
  
  ctx.fillStyle = ratio >= 1 ? '#0ea5e9' : '#ef4444';
  for(let i=0; i<=pulsesInView; i++) {
    if (i > 300) break;
    const x = padL + (i/Math.max(1, pulsesInView)) * drawW;
    ctx.fillRect(x-1, yPulses-4, 2, 8);
  }
  
  ctx.fillStyle = ratio >= 1 ? '#16a34a' : '#dc2626';
  ctx.font = 'bold 11px DM Sans';
  ctx.fillText(ratio >= 1 ? `Coverage OK (P/N = ${ratio.toFixed(2)})` : `Coverage FAIL (P/N = ${ratio.toFixed(2)})`, padL, H-15);
}

function renderCompleteness(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth||canvas.width, H = canvas.offsetHeight||canvas.height;
  if (canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,W,H);

  const total = SCAN_POINTS.length || 1;
  const currentTotal = SCAN_POINTS.filter(p => p.angleDeg <= SIM.sweepAngle).length;
  
  const displayTotal = SIM.sweepAngle === 0 ? total : Math.max(1, currentTotal);
  const hits = SCAN_POINTS.filter(p => (SIM.sweepAngle === 0 || p.angleDeg <= SIM.sweepAngle) && p.hit).length;
  const misses = displayTotal - hits;

  const cx = W/2, cy = H/2 - 10, r = Math.min(W,H)/2 - 30;
  
  const hitPct = hits/displayTotal;
  const missPct = misses/displayTotal;
  
  ctx.lineWidth = 14;
  let startAngle = -Math.PI/2;
  
  const hitRad = hitPct * Math.PI * 2;
  if (hitRad > 0) {
    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + hitRad);
    ctx.stroke();
    startAngle += hitRad;
  }
  
  const missRad = missPct * Math.PI * 2;
  if (missRad > 0) {
    ctx.strokeStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, startAngle + missRad);
    ctx.stroke();
  }

  ctx.fillStyle = '#334155'; ctx.font='bold 16px DM Sans'; ctx.textAlign='center';
  ctx.fillText(`${(hitPct*100).toFixed(1)}%`, cx, cy + 6);
  
  ctx.font = '10px DM Sans';
  ctx.fillStyle = '#22c55e'; ctx.textAlign='left'; ctx.fillText(`● Detected (${hits})`, 20, H-15);
  ctx.fillStyle = '#ef4444'; ctx.textAlign='right'; ctx.fillText(`● Missed (${misses})`, W-20, H-15);
  ctx.textAlign='left';
}

function renderGauge(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const total = SCAN_POINTS.length || 1;
  const hits = SCAN_POINTS.filter(p=>p.hit).length;
  const completeness = (hits/total)*100;

  const cx=W/2, cy=H-8, r=H-16;
  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=10; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,2*Math.PI); ctx.stroke();

  const sweepA = Math.PI + (completeness/100)*Math.PI;
  const colour = completeness>80?'#22c55e':completeness>50?'#f59e0b':'#ef4444';
  ctx.strokeStyle=colour; ctx.lineWidth=10;
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,sweepA); ctx.stroke();

  ctx.strokeStyle='#334155'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r-4)*Math.cos(sweepA), cy+(r-4)*Math.sin(sweepA)); ctx.stroke();
  ctx.fillStyle='#334155'; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();

  document.getElementById('quality-label').textContent = `${completeness.toFixed(0)}% complete`;
  document.getElementById('quality-label').style.color = colour;
  document.getElementById('quality-sub').textContent =
    completeness>80 ? 'Room outline reliably captured' :
    completeness>50 ? 'Noticeable gaps in the map' :
                       'Severely incomplete — check coverage and reflectivity';
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — MAIN UPDATE
────────────────────────────────────────────────────────────── */

function updateReadouts() {
  const N = Math.round(360/SIM.angRes);
  const trot = 60/SIM.rpm;
  const P = SIM.pulseFreq * trot;
  const ratio = P/N;

  document.getElementById('ro-pts').textContent = fmtNum(N);
  document.getElementById('ro-trot').textContent = trot.toFixed(3);

  const covEl = document.getElementById('ro-coverage');
  covEl.textContent = ratio.toFixed(2);
  covEl.className = 'ro-val' + (ratio>=1.1?' good':ratio>=1?' warn':' danger');

  const total = SCAN_POINTS.length || 0;
  const hits = SCAN_POINTS.filter(p=>p.hit).length;
  const completeness = total>0 ? (hits/total*100) : 0;
  const compEl = document.getElementById('ro-complete');
  compEl.textContent = completeness.toFixed(1);
  compEl.className = 'ro-val' + (completeness>80?' good':completeness>50?' warn':' danger');

  document.getElementById('st-pulses').textContent = fmtNum(total);
  document.getElementById('st-hits').textContent = fmtNum(hits);
  document.getElementById('st-dead').textContent = fmtNum(total-hits);

  /* gaps: count angular runs of consecutive misses longer than 2 steps */
  let gaps=0, runLen=0;
  SCAN_POINTS.forEach(p=>{
    if(!p.hit){ runLen++; } else { if(runLen>2) gaps++; runLen=0; }
  });
  if (runLen>2) gaps++;
  document.getElementById('st-gaps').textContent = gaps;

  /* measured room dims from hit points (max extents) */
  const hitPts = SCAN_POINTS.filter(p=>p.hit && !p.isPole);
  if (hitPts.length>3) {
    let maxX=0, maxY=0;
    hitPts.forEach(p=>{
      const rad=degToRad(p.angleDeg);
      maxX = Math.max(maxX, Math.abs(p.dist*Math.sin(rad)));
      maxY = Math.max(maxY, Math.abs(p.dist*Math.cos(rad)));
    });
    document.getElementById('bb-width').textContent = (maxX*2).toFixed(2)+' m';
    document.getElementById('bb-depth').textContent = (maxY*2).toFixed(2)+' m';
  } else {
    document.getElementById('bb-width').textContent = '—';
    document.getElementById('bb-depth').textContent = '—';
  }

  const poleDetected = SCAN_POINTS.some(p=>p.hit && p.isPole);
  const poleEl = document.getElementById('bb-pole');
  poleEl.textContent = poleDetected ? 'Yes' : (total>0 ? 'No' : '—');
  poleEl.style.color = poleDetected ? '#16a34a' : '#dc2626';
}

function renderAllSimCanvases() {
  renderPolarMap(document.getElementById('cvs-polar'));
  renderDistAngle(document.getElementById('cvs-distangle'));
  renderCoverage(document.getElementById('cvs-coverage'));
  renderCompleteness(document.getElementById('cvs-completeness'));
  renderGauge(document.getElementById('gauge-canvas'));
  updateReadouts();
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — WIZARD
────────────────────────────────────────────────────────────── */

function updateSimWizard() {
  const step = Math.min(SIM.step, SIM_WIZARD.length-1);
  const s = SIM_WIZARD[step];
  document.getElementById('wiz-title').textContent = s.title;
  document.getElementById('wiz-text').textContent  = s.text;
  document.getElementById('wiz-task').textContent  = s.task;

  document.querySelectorAll('.param-grp').forEach(el=>el.classList.remove('lit'));
  if (s.lit) { const el=document.getElementById(s.lit); if(el){el.classList.add('lit'); el.scrollIntoView({block:'nearest',behavior:'smooth'});} }

  document.querySelectorAll('.wdot').forEach((d,i)=>{
    d.classList.remove('active','done');
    if(i===step) d.classList.add('active');
    if(i<step) d.classList.add('done');
  });

  const btnNext=document.getElementById('wiz-next'), btnSkip=document.getElementById('wiz-skip');
  if (step >= SIM_WIZARD.length-1) { btnNext.textContent='Explore Freely'; btnSkip.style.display='none'; }
  else { btnNext.textContent='Next Step'; btnSkip.style.display=''; }
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — INIT & CONTROLS
────────────────────────────────────────────────────────────── */

function initSimulation() {
  resetScan();
  updateSimWizard();
  renderAllSimCanvases();

  document.getElementById('r-angres').addEventListener('input', e=>{
    SIM.angRes = parseFloat(e.target.value);
    document.getElementById('pv-angres').textContent = SIM.angRes.toFixed(1)+'°';
    renderAllSimCanvases();
  });
  document.getElementById('r-rpm').addEventListener('input', e=>{
    SIM.rpm = parseFloat(e.target.value);
    document.getElementById('pv-rpm').textContent = SIM.rpm+' RPM';
    renderAllSimCanvases();
  });
  document.getElementById('r-pulsefreq').addEventListener('input', e=>{
    SIM.pulseFreq = parseFloat(e.target.value);
    document.getElementById('pv-pulsefreq').textContent = SIM.pulseFreq+' Hz';
    renderAllSimCanvases();
  });
  document.getElementById('r-reflect').addEventListener('input', e=>{
    SIM.reflectFar = parseFloat(e.target.value);
    ROOM.wallReflect.far = SIM.reflectFar;
    document.getElementById('pv-reflect').textContent = SIM.reflectFar.toFixed(2);
    renderAllSimCanvases();
  });
  document.getElementById('r-noise').addEventListener('input', e=>{
    SIM.noise = parseFloat(e.target.value);
    document.getElementById('pv-noise').textContent = SIM.noise.toFixed(0)+' mm';
    renderAllSimCanvases();
  });

  document.getElementById('btn-sweep-toggle').addEventListener('click', toggleSweep);
  document.getElementById('btn-full-scan').addEventListener('click', completeFullScan);

  document.getElementById('wiz-next').addEventListener('click', ()=>{ SIM.step=Math.min(SIM.step+1,SIM_WIZARD.length-1); updateSimWizard(); });
  document.getElementById('wiz-skip').addEventListener('click', ()=>{ SIM.step=SIM_WIZARD.length-1; updateSimWizard(); });
  document.querySelectorAll('.wdot').forEach(d=>d.addEventListener('click', ()=>{ SIM.step=parseInt(d.dataset.ws); updateSimWizard(); }));

  ['btn-sim-reset','btn-sim-reset2'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.addEventListener('click', resetSimulationFull);
  });

  const ro = new ResizeObserver(()=>renderAllSimCanvases());
  document.querySelectorAll('.sim-card').forEach(c=>ro.observe(c));
}

function resetSimulationFull() {
  stopSweep();
  SIM.angRes=0.5; SIM.rpm=600; SIM.pulseFreq=8000; SIM.reflectFar=SETUP.reflectivity; SIM.noise=5; SIM.step=0;

  document.getElementById('r-angres').value=0.5;
  document.getElementById('r-rpm').value=600;
  document.getElementById('r-pulsefreq').value=8000;
  document.getElementById('r-reflect').value=SIM.reflectFar;
  document.getElementById('r-noise').value=5;

  document.getElementById('pv-angres').textContent='0.5°';
  document.getElementById('pv-rpm').textContent='600 RPM';
  document.getElementById('pv-pulsefreq').textContent='8000 Hz';
  document.getElementById('pv-reflect').textContent=SIM.reflectFar.toFixed(2);
  document.getElementById('pv-noise').textContent='5 mm';

  resetScan();
  updateSimWizard();
  renderAllSimCanvases();
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — RESET
────────────────────────────────────────────────────────────── */

function resetSetup() {
  Object.keys(MOUNTED).forEach(k=>MOUNTED[k]=false);
  if(lidarMesh)  { lidarMesh.visible=false; }
  if(tripodMesh) tripodMesh.visible=false;
  if(wallsGroup) wallsGroup.visible=false;
  if(poleMesh)   poleMesh.visible=false;
  if(beamLine)   beamLine.visible=false;
  hitMarkersGroup.clear();

  document.querySelectorAll('.apparatus-card').forEach(c => {
    c.classList.remove('mounted');
    c.classList.remove('selected');
  });
  document.querySelectorAll('.apparatus-status').forEach(s => s.textContent = 'Unmounted');
  
  const btnNext = document.getElementById('btn-next-sc0');
  if (btnNext) btnNext.style.display = 'none';
  const btnMount = document.getElementById('btn-mount');
  if (btnMount) btnMount.style.display = 'flex';
  
  selectApparatus('lidar');

  SETUP.roomHalfWidth=3.5; SETUP.poleDist=2.5; SETUP.reflectivity=0.90;
  document.getElementById('sr-roomw').value=3.5;
  document.getElementById('sr-poled').value=2.5;
  document.getElementById('sr-reflect').value=0.90;
  document.getElementById('sv-roomw').textContent='3.5 m';
  document.getElementById('sv-poled').textContent='2.5 m';
  document.getElementById('sv-reflect').textContent='0.90';
  document.getElementById('reflect-display').textContent='90%';
  document.getElementById('reflect-fill').style.width='90%';
  document.getElementById('btn-next-obs').disabled = true;

  rebuildRoomFromSetup();
  document.getElementById('btn-launch-sim').disabled = true;
  gotoSetupStep(0);
}

/* ──────────────────────────────────────────────────────────────
   INIT
────────────────────────────────────────────────────────────── */

function init() {
  initThree();
  rebuildRoomFromSetup();

  document.querySelectorAll('.apparatus-card').forEach(card => {
    card.addEventListener('click', () => selectApparatus(card.dataset.comp));
  });
  const btnMount = document.getElementById('btn-mount');
  if (btnMount) btnMount.addEventListener('click', handleMount);

  document.querySelectorAll('[data-next]').forEach(btn=>{
    btn.addEventListener('click', ()=>gotoSetupStep(parseInt(btn.dataset.next)));
  });
  document.querySelectorAll('[data-prev]').forEach(btn=>{
    btn.addEventListener('click', ()=>gotoSetupStep(parseInt(btn.dataset.prev)));
  });

  document.getElementById('sr-roomw').addEventListener('input', e=>{
    SETUP.roomHalfWidth = parseFloat(e.target.value);
    document.getElementById('sv-roomw').textContent = SETUP.roomHalfWidth.toFixed(1)+' m';
    rebuildRoomFromSetup();
  });
  document.getElementById('sr-poled').addEventListener('input', e=>{
    SETUP.poleDist = parseFloat(e.target.value);
    document.getElementById('sv-poled').textContent = SETUP.poleDist.toFixed(1)+' m';
    poleMesh.position.set(0,0.75,-SETUP.poleDist);
  });
  document.getElementById('sr-reflect').addEventListener('input', e=>{
    SETUP.reflectivity = parseFloat(e.target.value);
    document.getElementById('sv-reflect').textContent = SETUP.reflectivity.toFixed(2);
    document.getElementById('reflect-display').textContent = Math.round(SETUP.reflectivity*100)+'%';
    document.getElementById('reflect-fill').style.width = (SETUP.reflectivity*100)+'%';
  });

  document.getElementById('btn-capture').addEventListener('click', confirmConfiguration);

  document.querySelectorAll('.view-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      switch(currentView){
        case 'iso': setViewISO(); break;
        case 'top': setViewTop(); break;
        case 'front': setViewFront(); break;
        case 'side': setViewSide(); break;
      }
    });
  });


  document.getElementById('btn-launch-sim').addEventListener('click', showSimulation);
  document.getElementById('btn-back-setup').addEventListener('click', showSetup);
  document.getElementById('btn-reset-setup').addEventListener('click', resetSetup);

  document.getElementById('three-canvas').addEventListener('contextmenu', e=>e.preventDefault());
}

window.addEventListener('load', init);
