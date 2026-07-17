/* ================================================================
   EXPERIMENT 2 — CAMERA CALIBRATION SIMULATION
   main.js — Three.js 3D setup scene + 2D simulation canvases
   ================================================================

   ARCHITECTURE
   ────────────
   SETUP PAGE
     ThreeScene  → manages Three.js renderer, camera, orbit controls
     Components  → tracks which lab equipment is mounted
     PoseCapture → stores captured pose orientations
     SetupWizard → step navigation (0→4)

   SIMULATION PAGE
     SimState    → live parameter values
     render*()   → individual canvas renderers
     WizardSim   → 4-step guided walkthrough

   MATH
   ────
   Reprojection error model (simplified):
     RPE = base_rpe / (sqrt(N) * diversity_factor) + noise
     where base_rpe = f(k1, squareSize_error)

   Distortion correction (applied per pixel):
     r²  = x² + y²
     x_c = x * (1 + k1*r² + k2*r⁴)
     y_c = y * (1 + k1*r² + k2*r⁴)

   K matrix:
     K = [[fx, 0, cx], [0, fy, cy], [0, 0, 1]]
     fx = fy = f  (square sensor assumption)
     cx = imageW/2 + principal_offset_x
     cy = imageH/2 + principal_offset_y
   ================================================================ */

'use strict';
/* global THREE, MathJax */

/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */

const MOUNTED = { camera: false, tripod: false, board: false, light: false };
let selectedComp = 'tripod';
const MOUNT_SEQ = ['tripod', 'camera', 'board', 'light'];

const POSES = [];          /* array of {tx, ty, dist} from setup sliders */

const BOARD_CONFIG = {
  cols: 9,                 /* inner corner columns */
  rows: 7,                 /* inner corner rows    */
  sqPx: 24,               /* square size in pixels for drawing */
};

const SIM = {
  N:     5,                /* number of poses            */
  tilt:  1,                /* tilt diversity 1–4         */
  sq:    25,               /* square size mm             */
  k1:    0,                /* radial distortion k1       */
  step:  0,                /* wizard step                */
};

/* Sim 3D Globals */
let simScene, simCamera, simRenderer, simAnimFrame, simSurfaceMesh;
let simIsDragging = false, simLastMouse = {x: 0, y: 0};
let simPhi = 0.5, simTheta = Math.PI / 4, simRadius = 4;

/* Wizard content for simulation page */
const SIM_WIZARD = [
  {
    title: 'Set Pose Count',
    text:  'The number of calibration poses N directly determines how well the linear system can estimate the intrinsic matrix K. Too few poses leaves the system underdetermined.',
    task:  'Drag N from 1 to 5. Watch reprojection error stay high below 5 poses.',
    lit:   'pg-poses',
  },
  {
    title: 'Add Tilt Diversity',
    text:  'All poses at the same angle give redundant — not new — information. The tilt diversity slider controls how spread out the pose orientations are across all three rotational axes.',
    task:  'Set Diversity to Low, note the error. Then switch to Full. Compare.',
    lit:   'pg-tilt',
  },
  {
    title: 'Vary Square Size',
    text:  'The square size defines the world coordinate scale. An incorrect value does not raise reprojection error — it silently scales the estimated focal length. This is a common real-world mistake.',
    task:  'Set square size to 28 mm (board is 25 mm). See how f changes but error stays low.',
    lit:   'pg-sq',
  },
  {
    title: 'Introduce Distortion',
    text:  'Moving k1 away from zero adds barrel (negative) or pincushion (positive) distortion. Watch the distorted and undistorted image panels update and see the corner overlay diverge and re-converge.',
    task:  'Set k1 = -0.4 and observe the distorted image. Then see undistorted correction.',
    lit:   'pg-k1',
  },
];

/* ──────────────────────────────────────────────────────────────
   UTILITY HELPERS
────────────────────────────────────────────────────────────── */



/** Gaussian noise N(0,1) via Box-Muller */
function gauss() {
  const u1 = Math.max(1e-12, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Radial distortion: applies correction or distortion */
function distortPoint(x, y, k1, k2, apply) {
  const r2 = x * x + y * y;
  const factor = apply
    ? 1 + k1 * r2 + k2 * r2 * r2
    : 1 / (1 + k1 * r2 + k2 * r2 * r2); /* inverse approx */
  return [x * factor, y * factor];
}

/** Compute simulated reprojection error from current SIM state */
function computeRPE() {
  if (SIM.N < 3) return 4.5 + Math.abs(gauss()) * 0.3;
  const divFactor  = [0.2, 0.55, 0.8, 1.0][SIM.tilt - 1];
  const sqErr      = Math.abs(SIM.sq - 25) / 25 * 0.05; /* scale error is invisible in RPE */
  const k1contrib  = Math.abs(SIM.k1) * 0.4;
  const nFactor    = Math.min(1, Math.sqrt(SIM.N) / Math.sqrt(20));
  const base       = 3.5 / (nFactor * divFactor * 10 + 1) + k1contrib * 0.1;
  return Math.max(0.18, base + sqErr + gauss() * 0.04);
}

/** Compute focal length from square size (scale effect) */
function computeF() {
  return Math.round(700 * (SIM.sq / 25));
}

/* ──────────────────────────────────────────────────────────────
   THREE.JS SCENE — SETUP PAGE
────────────────────────────────────────────────────────────── */

let renderer, scene, camera, animFrame;
let boardMesh, cameraMesh, tripodMesh, lightMesh, fovHelper;
let orbitTarget = new THREE.Vector3(0, 0.5, 0);
let isDragging = false, lastMouse = {x:0, y:0};
let phi = Math.PI/4, theta = Math.PI/5, radius = 4.5;
let currentView = 'iso';

/* Board orientation controlled by setup sliders */
let boardTX = 0, boardTY = 0, boardDist = 0.6;

function initThree() {
  try {
    if (typeof THREE === "undefined") { console.warn("THREE.js not loaded."); return; }
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

  camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 30);
  setViewISO();

  /* Lights */
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
  dirLight.position.set(4, 6, 3);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width  = 1024;
  dirLight.shadow.mapSize.height = 1024;
  scene.add(dirLight);

  const fillLight = new THREE.DirectionalLight(0x9dc8f0, 0.35);
  fillLight.position.set(-3, 2, -2);
  scene.add(fillLight);

  /* Ground plane */
  const groundGeo  = new THREE.PlaneGeometry(8, 8);
  const groundMat  = new THREE.MeshLambertMaterial({ color: 0xd8dfe8 });
  const ground     = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  /* Grid helper */
  const grid = new THREE.GridHelper(8, 16, 0xb8c4d4, 0xccd5e0);
  grid.material.opacity = 0.5;
  grid.material.transparent = true;
  scene.add(grid);

  /* Build all equipment meshes (hidden initially) */
  buildTripodMesh();
  buildCameraMesh();
  buildRailMesh();
  buildBoardMesh();
  buildLightMesh();
  buildFOVHelper();

  /* Orbit controls via mouse events */
  setupOrbitControls(canvas);

  /* Window resize */
  window.addEventListener('resize', resizeRenderer);

  animateThree();
  } catch (error) {
    console.error("Three.js init error:", error);
  }
}

function resizeRenderer() {
  const wrap = document.getElementById('three-canvas').parentElement;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  if (camera) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

function animateThree() {
  animFrame = requestAnimationFrame(animateThree);

  /* Removed gentle float animation to keep the board firmly mounted on the rail */

  /* Camera orbit */
  if (!isDragging && currentView === 'iso') {
    /* very slow auto-rotate when idle in iso view */
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

/* ── View presets ──────────────────────────────────────────── */
function setViewISO()   { phi = Math.PI/4;  theta = Math.PI/4;  radius = 4.5; }
function setViewTop()   { phi = 0;          theta = 0.01;       radius = 5.0; }
function setViewFront() { phi = 0;          theta = Math.PI/2;  radius = 4.5; }
function setViewSide()  { phi = Math.PI/2;  theta = Math.PI/2;  radius = 4.5; }

/* ── Orbit controls ────────────────────────────────────────── */
function setupOrbitControls(canvas) {
  canvas.addEventListener('mousedown', e => {
    isDragging = true;
    lastMouse  = {x: e.clientX, y: e.clientY};
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouse.x;
    const dy = e.clientY - lastMouse.y;
    lastMouse = {x: e.clientX, y: e.clientY};

    if (e.buttons === 1) {
      /* left drag = orbit */
      phi   -= dx * 0.008;
      theta  = Math.max(0.05, Math.min(Math.PI - 0.05, theta + dy * 0.008));
      currentView = 'iso'; /* reset active view button */
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
    } else if (e.buttons === 2) {
      /* right drag = pan */
      orbitTarget.x -= dx * 0.004;
      orbitTarget.y += dy * 0.004;
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    radius = Math.max(1.5, Math.min(9, radius + e.deltaY * 0.005));
  }, { passive: false });

  /* Touch support */
  let lastTouchDist = 0, lastTouch = null;

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      isDragging = true;
      lastTouch  = {x: e.touches[0].clientX, y: e.touches[0].clientY};
    } else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  });

  canvas.addEventListener('touchend', () => { isDragging = false; lastTouch = null; });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging && lastTouch) {
      const dx = e.touches[0].clientX - lastTouch.x;
      const dy = e.touches[0].clientY - lastTouch.y;
      lastTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
      phi   -= dx * 0.01;
      theta  = Math.max(0.05, Math.min(Math.PI - 0.05, theta + dy * 0.01));
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      radius = Math.max(1.5, Math.min(9, radius * (lastTouchDist / dist)));
      lastTouchDist = dist;
    }
  }, { passive: false });
}

/* ── Mesh builders ─────────────────────────────────────────── */

function buildTripodMesh() {
  tripodMesh = new THREE.Group();

  /* Head plate */
  const headGeo = new THREE.BoxGeometry(0.18, 0.04, 0.12);
  const metalMat = new THREE.MeshPhongMaterial({ color: 0x4a4a4a, shininess: 80 });
  const head = new THREE.Mesh(headGeo, metalMat);
  head.position.y = 1.1;
  tripodMesh.add(head);

  /* Three legs properly aligned */
  const legMat = new THREE.MeshPhongMaterial({ color: 0x2d2d2d, shininess: 60 });
  const legRadius = 0.3; // Spread of legs at the bottom
  const legHeight = 1.1;
  const legAngles = [Math.PI, Math.PI / 3, -Math.PI / 3]; // Math.PI points the front leg to -Z (towards rail)
  
  legAngles.forEach(angle => {
    // Create a group for each leg to handle rotation properly
    const legGroup = new THREE.Group();
    
    const legGeo = new THREE.CylinderGeometry(0.012, 0.008, legHeight, 8);
    const leg = new THREE.Mesh(legGeo, legMat);
    // Offset leg so top is at origin
    leg.position.y = -legHeight / 2;
    leg.castShadow = true;
    legGroup.add(leg);

    /* Rubber foot */
    const footGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.04, 8);
    const footMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.y = -legHeight;
    legGroup.add(foot);

    // Rotate leg outward from the head
    const tiltAngle = Math.atan2(legRadius, legHeight);
    legGroup.rotation.x = tiltAngle;
    
    // Rotate leg around the Y axis
    const pivot = new THREE.Group();
    pivot.add(legGroup);
    pivot.rotation.y = angle;
    pivot.position.y = 1.1; // Attach to head
    
    tripodMesh.add(pivot);
  });

  tripodMesh.visible = false;
  scene.add(tripodMesh);
}

function buildCameraMesh() {
  cameraMesh = new THREE.Group();

  /* Camera body */
  const bodyGeo = new THREE.BoxGeometry(0.22, 0.15, 0.12);
  const bodyMat = new THREE.MeshPhongMaterial({ color: 0x1a1a1a, shininess: 40 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  cameraMesh.add(body);

  /* Lens barrel */
  const lensGeo = new THREE.CylinderGeometry(0.042, 0.048, 0.1, 20);
  const lensMat = new THREE.MeshPhongMaterial({ color: 0x222222, shininess: 120 });
  const lens = new THREE.Mesh(lensGeo, lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 0, -0.1); // Face negative Z (towards checkerboard)
  cameraMesh.add(lens);

  /* Lens front glass */
  const glassGeo = new THREE.CircleGeometry(0.038, 20);
  const glassMat = new THREE.MeshPhongMaterial({
    color: 0x1a3c5e,
    shininess: 200,
    transparent: true,
    opacity: 0.8,
  });
  const glass = new THREE.Mesh(glassGeo, glassMat);
  glass.position.set(0, 0, -0.155);
  glass.rotation.y = Math.PI; // Face outwards
  cameraMesh.add(glass);

  /* Lens rim highlight */
  const rimGeo = new THREE.TorusGeometry(0.042, 0.006, 8, 20);
  const rimMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 150 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.set(0, 0, -0.152);
  cameraMesh.add(rim);

  /* Hot shoe */
  const shoeGeo = new THREE.BoxGeometry(0.06, 0.01, 0.04);
  const shoeMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const shoe = new THREE.Mesh(shoeGeo, shoeMat);
  shoe.position.set(0, 0.08, 0);
  cameraMesh.add(shoe);

  cameraMesh.position.set(0, 1.18, 0.05); // Sit on tripod head
  cameraMesh.visible = false;
  scene.add(cameraMesh);
}

let railMesh;
function createTextPlane(message) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0)';
  ctx.fillRect(0,0,128,64);
  ctx.font = 'bold 36px "JetBrains Mono", monospace';
  ctx.fillStyle = '#475569'; 
  ctx.fillText(message, 10, 45);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.04), mat);
  plane.rotation.x = -Math.PI/2;
  plane.rotation.z = -Math.PI/2;
  return plane;
}

function buildRailMesh() {
  railMesh = new THREE.Group();

  // The rail itself (length 0.9, from z=-0.3 to z=-1.2)
  const rGeo = new THREE.BoxGeometry(0.04, 0.02, 0.9);
  const rMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 100 });
  const rail = new THREE.Mesh(rGeo, rMat);
  rail.position.set(0, 0.01, -0.75); // Center of rail
  rail.castShadow = true;
  rail.receiveShadow = true;
  railMesh.add(rail);

  // Markings on rail
  const mGeo = new THREE.BoxGeometry(0.042, 0.022, 0.005);
  const mMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  for(let i=0; i<=9; i++) {
    const mark = new THREE.Mesh(mGeo, mMat);
    mark.position.set(0, 0.01, -0.3 - (i * 0.1));
    railMesh.add(mark);
    
    // Add text label every 20cm
    if (i % 2 === 0) {
      const distCm = 30 + (i * 10);
      const label = createTextPlane(distCm + "cm");
      label.position.set(-0.06, 0.022, -0.3 - (i * 0.1));
      railMesh.add(label);
    }
  }

  railMesh.visible = false;
  scene.add(railMesh);
}

function buildBoardMesh() {
  boardMesh = new THREE.Group();

  const boardPivot = new THREE.Group();
  boardPivot.name = 'boardPivot';
  boardPivot.position.set(0, 1.18, 0); // Linear to camera lens
  boardMesh.add(boardPivot);

  const totalCols = BOARD_CONFIG.cols + 1;
  const totalRows = BOARD_CONFIG.rows + 1;
  const sqSize    = 0.04;
  const boardW    = totalCols * sqSize;
  const boardH    = totalRows * sqSize;

  /* White backing */
  const backGeo = new THREE.BoxGeometry(boardW + 0.02, boardH + 0.02, 0.006);
  const backMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const back    = new THREE.Mesh(backGeo, backMat);
  back.castShadow = true;
  boardPivot.add(back);

  /* Checker squares */
  const darkMat  = new THREE.MeshLambertMaterial({ color: 0x111111 });

  for (let r = 0; r < totalRows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const isDark = (r + c) % 2 === 0;
      if (!isDark) continue;
      const sqGeo = new THREE.BoxGeometry(sqSize - 0.001, sqSize - 0.001, 0.004);
      const sq    = new THREE.Mesh(sqGeo, darkMat);
      sq.position.set(
        (c - totalCols / 2 + 0.5) * sqSize,
        (r - totalRows / 2 + 0.5) * sqSize,
        0.005
      );
      boardPivot.add(sq);
    }
  }

  /* Corner dot markers */
  const dotMat = new THREE.MeshLambertMaterial({ color: 0xff3333 });
  for (let r = 0; r < BOARD_CONFIG.rows; r++) {
    for (let c = 0; c < BOARD_CONFIG.cols; c++) {
      const dotGeo = new THREE.SphereGeometry(0.004, 6, 6);
      const dot    = new THREE.Mesh(dotGeo, dotMat);
      dot.position.set(
        (c - (BOARD_CONFIG.cols - 1) / 2) * sqSize,
        (r - (BOARD_CONFIG.rows - 1) / 2) * sqSize,
        0.01
      );
      boardPivot.add(dot);
    }
  }

  /* Board handle/stand reaching to rail */
  const handleGeo = new THREE.BoxGeometry(0.04, 1.11, 0.02); // Length 1.11 (from 1.18 down to 0.07)
  const handleMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const handle    = new THREE.Mesh(handleGeo, handleMat);
  handle.position.set(0, 0.625, 0); // Center of handle
  boardMesh.add(handle);

  // The base slider block on rail
  const sliderGeo = new THREE.BoxGeometry(0.08, 0.05, 0.08);
  const sliderMat = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 80 });
  const slider = new THREE.Mesh(sliderGeo, sliderMat);
  slider.position.set(0, 0.045, 0); // On top of rail
  boardMesh.add(slider);

  boardMesh.position.set(0, 0, -0.6);
  boardMesh.visible = false;
  scene.add(boardMesh);
}

function buildLightMesh() {
  lightMesh = new THREE.Group();

  /* Stand */
  const stGeo = new THREE.CylinderGeometry(0.01, 0.01, 1.4, 8);
  const stMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const stand = new THREE.Mesh(stGeo, stMat);
  stand.position.y = 0.7;
  lightMesh.add(stand);

  /* Light panel */
  const panGeo = new THREE.BoxGeometry(0.35, 0.25, 0.04);
  const panMat = new THREE.MeshPhongMaterial({ color: 0xf0f0f0, shininess: 20 });
  const panel  = new THREE.Mesh(panGeo, panMat);
  panel.position.set(0, 1.45, 0);
  
  // Orient panel to point at board (board is at 0, 0.85, -0.6)
  // Light is at -0.8, 0, 0
  panel.lookAt(0, 0.85, -0.6);
  
  lightMesh.add(panel);

  /* Warm glow front */
  const glowGeo = new THREE.PlaneGeometry(0.33, 0.23);
  const glowMat = new THREE.MeshLambertMaterial({
    color: 0xfff4cc,
    emissive: 0xfff4cc,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.9,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.copy(panel.position);
  glow.position.add(new THREE.Vector3(0, 0, 0.022).applyEuler(panel.rotation));
  glow.rotation.copy(panel.rotation);
  lightMesh.add(glow);

  /* Base foot */
  const baseGeo = new THREE.CylinderGeometry(0.12, 0.14, 0.025, 12);
  const baseMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const base    = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.012;
  lightMesh.add(base);

  lightMesh.position.set(-0.8, 0, 0);
  lightMesh.visible = false;
  scene.add(lightMesh);
}

function buildFOVHelper() {
  /* Camera field-of-view cone - pointing forward to checkerboard */
  // Base geometry points along Y axis. We rotate it to point along -Z.
  const coneGeo = new THREE.ConeGeometry(0.8, 1.2, 4, 1, true);
  coneGeo.rotateY(Math.PI / 4); // Rotate so flat sides align
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
    wireframe: false,
    depthWrite: false
  });
  fovHelper = new THREE.Mesh(coneGeo, coneMat);
  
  // Move apex to camera lens position
  // Cone base is at -1.2 on Z
  // We offset geometry so origin is at the apex
  coneGeo.translate(0, -0.6, 0); 
  
  fovHelper.position.set(0, 1.18, -0.1); 
  fovHelper.rotation.x = Math.PI / 2; // Point down -Z axis

  /* Wireframe edges */
  const wfGeo = new THREE.ConeGeometry(0.8, 1.2, 4, 1, true);
  wfGeo.rotateY(Math.PI / 4);
  wfGeo.translate(0, -0.6, 0);
  const wfMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, wireframe: true, opacity: 0.25, transparent: true });
  const wf = new THREE.Mesh(wfGeo, wfMat);
  fovHelper.add(wf);

  fovHelper.visible = false;
  scene.add(fovHelper);
}

/* Update board position/rotation when sliders change */

function updateBoardTransform() {
  if (!boardMesh) return;
  const pivot = boardMesh.children.find(c => c.name === 'boardPivot');
  if (pivot) {
    pivot.rotation.x = THREE.MathUtils.degToRad(boardTX);
    pivot.rotation.y = THREE.MathUtils.degToRad(boardTY);
  }
  boardMesh.position.z = -boardDist;

  /* Update obs-overlay */
  const tiltMag = Math.sqrt(boardTX * boardTX + boardTY * boardTY);
  document.getElementById('obs-tilt').textContent =
    `TX:${boardTX}° TY:${boardTY}°`;
  document.getElementById('obs-corners').textContent =
    tiltMag < 60 ? `${BOARD_CONFIG.cols * BOARD_CONFIG.rows} detected` : 'Partially visible';
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — STEP NAVIGATION
────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────
   COMPONENT MOUNTING & SETUP FLOW
────────────────────────────────────────────────────────────── */

function mountComponent(name) {
  MOUNTED[name] = true;

  /* Show 3D mesh */
  switch (name) {
    case 'camera':
      cameraMesh.visible = true;
      fovHelper.visible  = true;
      document.getElementById('setup-wiz-task').textContent = 'Task: Mount the checkerboard on the rail.';
      break;
    case 'tripod':
      tripodMesh.visible = true;
      document.getElementById('setup-wiz-task').textContent = 'Task: Mount the camera onto the tripod.';
      break;
    case 'board':
      railMesh.visible = true;
      boardMesh.visible = true;
      updateBoardTransform();
      document.getElementById('setup-wiz-task').textContent = 'Task: Mount the light source to illuminate the board.';
      break;
    case 'light':
      lightMesh.visible = true;
      document.getElementById('setup-wiz-task').textContent = 'Task: Adjust board position and capture poses.';
      break;
  }

  /* Update card state */
  const card = document.querySelector(`.apparatus-card[data-comp="${name}"]`);
  if (card) {
    card.classList.add('mounted');
    const status = card.querySelector('.apparatus-status');
    if (status) status.textContent = 'Mounted ✓';
  }

  /* If all mounted, transition to capture mode */
  const allMounted = Object.values(MOUNTED).every(Boolean);
  if (allMounted) {
    document.getElementById('btn-next').style.display = 'block';
    setTimeout(() => {
      document.getElementById('mount-section').style.display = 'none';
      document.getElementById('capture-section').style.display = 'block';
      const counterWrap = document.getElementById('setup-pose-counter-wrap'); if(counterWrap) counterWrap.style.display = 'block';
    }, 500);
  }
}

/* ──────────────────────────────────────────────────────────────
   POSE CAPTURE
────────────────────────────────────────────────────────────── */

function capturePose() {
  const tiltMag = Math.sqrt(boardTX * boardTX + boardTY * boardTY);

  /* Animated flash on 3D board */
  if (boardMesh) {
    const pivot = boardMesh.children.find(c => c.name === 'boardPivot');
    if (pivot && pivot.children[0] && pivot.children[0].material) {
      pivot.children[0].material.color.setHex(0xffcc44); // Yellow flash
      setTimeout(() => pivot.children[0].material.color.setHex(0xffffff), 200); // Restore to pure white
    }
  }

  POSES.push({ tx: boardTX, ty: boardTY, dist: boardDist, tiltMag });

  /* Update counter */
  const count = POSES.length;
  document.getElementById('pose-count').textContent = count;

  /* Add thumbnail (full image) */
  addPoseThumbnail(count, boardTX, boardTY, boardDist);

  /* Obs overlay */
  const accepted = tiltMag < 70;
  document.getElementById('obs-pose').textContent  = accepted ? 'Yes' : 'Partial';
  document.getElementById('obs-pose').style.color  = accepted ? '#16a34a' : '#d97706';
  document.getElementById('obs-corners').textContent =
    accepted
      ? `${BOARD_CONFIG.cols * BOARD_CONFIG.rows} / ${BOARD_CONFIG.cols * BOARD_CONFIG.rows}`
      : `${Math.floor(BOARD_CONFIG.cols * BOARD_CONFIG.rows * 0.6)} / ${BOARD_CONFIG.cols * BOARD_CONFIG.rows}`;
  
  const obsTilt = document.getElementById('obs-tilt');
  if (obsTilt) {
    obsTilt.textContent = `${Math.round(tiltMag)}°`;
  }

  /* Update results dynamically */
  computeAndDisplayResults();

  /* Enable go to sim button after 5 poses */
  if (count >= 5) {
    document.getElementById('btn-go-sim').disabled = false;
  }
}

function computeRPEFromPoses() {
  const n = POSES.length;
  if (n === 0) return 0;
  if (n < 3) return 3.5 + Math.random() * 0.8;

  /* diversity = spread of tilt angles */
  const angles = POSES.map(p => p.tiltMag);
  const maxAng = Math.max(...angles);
  const divF   = Math.min(1, maxAng / 35);

  const base   = 2.8 / (Math.sqrt(n) * (divF + 0.1));
  return Math.max(0.25, base + (Math.random() - 0.5) * 0.06);
}

function addPoseThumbnail(index, tx, ty, dist) {
  const grid   = document.getElementById('pose-grid');
  const wrap   = document.createElement('div');
  wrap.className = 'pose-thumb';

  const c = document.createElement('canvas');
  // Larger size for full uncropped images
  c.width  = 160;
  c.height = 120;
  drawMiniCheckerboard(c, tx, ty, index, dist);
  wrap.appendChild(c);
  grid.appendChild(wrap);
  
  // Scroll to bottom
  const posesWrap = document.querySelector('.poses-wrap');
  if (posesWrap) posesWrap.scrollTop = posesWrap.scrollHeight;
}

function drawMiniCheckerboard(canvas, tx, ty, idx, dist) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  /* Simulate perspective with simple skew and scaling */
  const skewX = (ty / 45) * 0.3;
  const skewY = (tx / 45) * 0.3;
  
  // Scale down based on distance (closer = larger)
  const scale = Math.max(0.3, 1.2 - dist); 

  const cols = BOARD_CONFIG.cols + 1;
  const rows = BOARD_CONFIG.rows + 1;
  
  // Board dimensions proportional to canvas
  const boardW = W * 0.8 * scale;
  const boardH = H * 0.8 * scale;
  
  const sqW = boardW / cols;
  const sqH = boardH / rows;

  const startX = (W - boardW) / 2;
  const startY = (H - boardH) / 2;

  ctx.save();
  // Translate to center, apply skew, translate back
  ctx.translate(W/2, H/2);
  ctx.transform(1, skewY, skewX, 1, 0, 0);
  ctx.translate(-W/2, -H/2);

  // White background for board
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 4;
  ctx.fillRect(startX, startY, boardW, boardH);
  ctx.shadowColor = 'transparent';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 === 0) {
        ctx.fillStyle = '#111';
        ctx.fillRect(startX + c * sqW, startY + r * sqH, sqW - 0.5, sqH - 0.5);
      }
    }
  }
  ctx.restore();

  /* Index label */
  ctx.fillStyle = '#3b82f6';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText(`P${idx}`, 4, 14);
}

/* ──────────────────────────────────────────────────────────────
   SETUP STEP 4 — RESULTS DISPLAY
────────────────────────────────────────────────────────────── */

function computeAndDisplayResults() {
  const n   = POSES.length;
  
  if (n >= 5) {
    const cont = document.getElementById('calibration-results-container');
    if (cont) cont.style.display = 'block';
  } else {
    const cont = document.getElementById('calibration-results-container');
    if (cont) cont.style.display = 'none';
    return; // Don't calculate yet
  }

  const rpe = computeRPEFromPoses();

  /* Estimated K values (simulate realistic noise) */
  const f  = 700 + gauss() * 3;
  const cx = 640 + gauss() * 2;
  const cy = 360 + gauss() * 2;
  const k1_est = -0.01 - gauss() * 0.01;

  document.getElementById('r-f').textContent  = f.toFixed(0);
  document.getElementById('r-cx').textContent = cx.toFixed(0);
  document.getElementById('r-cy').textContent = cy.toFixed(0);
  document.getElementById('r-k1-readout').textContent = k1_est.toFixed(3);
  document.getElementById('r-rpe').textContent = rpe.toFixed(2);

  /* RPE bar position (0 = excellent 0.0, 1 = bad 2.0+) */
  const pct = Math.min(95, (rpe / 2.0) * 100);
  document.getElementById('rpe-bar').style.left = pct + '%';

  /* K matrix display in LaTeX */
  document.getElementById('k-matrix').innerHTML =
    `\\( \\begin{bmatrix} ${f.toFixed(0)} & 0 & ${cx.toFixed(0)} \\\\ 0 & ${f.toFixed(0)} & ${cy.toFixed(0)} \\\\ 0 & 0 & 1 \\end{bmatrix} \\)`;
  if (window.MathJax) {
    MathJax.typesetPromise([document.getElementById('k-matrix')]).catch(err => console.error(err));
  }
}

/* ──────────────────────────────────────────────────────────────
   PAGE SWITCHING
────────────────────────────────────────────────────────────── */

function showSimulation() {
  document.getElementById('page-setup').classList.remove('active');
  document.getElementById('page-sim').classList.add('active');
  cancelAnimationFrame(animFrame);     /* stop Three.js */
  
  // Wait a frame for CSS to lay out canvases so clientWidth is correct
  requestAnimationFrame(() => {
    initSimulation();
    if (simRenderer) animateSim3D();     /* resume Sim 3D */
    updateSimulation(); // Ensure all 2D canvases are re-rendered with correct layout W/H
  });
}

function showSetup() {
  document.getElementById('page-sim').classList.remove('active');
  document.getElementById('page-setup').classList.add('active');
  animateThree();                      /* resume Three.js */
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION PAGE — CANVAS RENDERERS
────────────────────────────────────────────────────────────── */

/* ── Distorted Image ──────────────────────────────────────────
   Draws a checkerboard with radial distortion applied to corner
   positions. Lines curve barrel or pincushion based on k1.    */

function renderDistorted(canvas) {
  const ctx = canvas.getContext('2d');
  const clientW = canvas.clientWidth;
  const clientH = canvas.clientHeight;
  const W = clientW > 0 ? clientW : (canvas.width || 320);
  const H = clientH > 0 ? clientH : (canvas.height || 200);

  if (clientW > 0 && (canvas.width !== W || canvas.height !== H)) {
    canvas.width  = W;
    canvas.height = H;
  }

  // Draw Heatmap Background
  const k1 = SIM.k1;
  const k2 = k1 * k1 * 0.2 * Math.sign(k1);
  const cxC = W / 2, cyC = H / 2;
  
  const imgData = ctx.createImageData(W, H);
  const data = imgData.data;
  
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const nx = (x - cxC) / cxC;
      const ny = (y - cyC) / cyC;
      const r2 = nx*nx + ny*ny;
      
      // Color range: straight to barrel distortion (Heatmap)
      // Blue for 0 distortion, Red for high distortion magnitude
      const distMag = Math.min(1.0, r2 * Math.abs(k1) * 3.0);
      
      // Interpolate Blue (240, 250, 252) to Red (254, 226, 226)
      const r = 240 + distMag * 14;
      const g = 250 - distMag * 24;
      const b = 252 - distMag * 26;
      
      const idx = (y * W + x) * 4;
      data[idx] = r;
      data[idx+1] = g;
      data[idx+2] = b;
      data[idx+3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Dynamic Square Size based on SIM.sq
  const baseSq = Math.max(10, SIM.sq * 1.5); // Scale sq size
  const cols = Math.max(2, Math.floor(W / baseSq));
  const rows = Math.max(2, Math.floor(H / baseSq));
  
  const scaleFactor = 0.85;

  const tiltFactor = SIM.tilt * 0.15; // Max 0.6 rad
  const pitch = tiltFactor;
  const yaw   = tiltFactor * 0.6;
  
  const applyPerspective = (px, py) => {
    if (tiltFactor === 0) return [px, py];
    let x = px - cxC;
    let y = py - cyC;
    
    // yaw
    let x1 = x * Math.cos(yaw);
    let z1 = -x * Math.sin(yaw);
    
    // pitch
    let y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
    let z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
    
    const f = 400;
    const z_cam = 200;
    const proj = f / (f + z_cam + z2);
    
    // Scale up slightly to fit screen nicely
    return [cxC + x1 * proj * 1.5, cyC + y2 * proj * 1.5];
  };

  const drawDistLine = (x0, y0, x1, y1) => {
    const steps = 40;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let px = x0 + t * (x1 - x0);
      let py = y0 + t * (y1 - y0);
      
      [px, py] = applyPerspective(px, py);

      const nx = (px - cxC) / cxC;
      const ny = (py - cyC) / cyC;
      const [dx, dy] = distortPoint(nx, ny, k1, k2, true);
      const fpx = cxC + dx * cxC * scaleFactor;
      const fpy = cyC + dy * cyC * scaleFactor;
      if (i === 0) ctx.moveTo(fpx, fpy);
      else ctx.lineTo(fpx, fpy);
    }
    ctx.stroke();
  };

  ctx.strokeStyle = 'rgba(15, 23, 42, 0.4)';
  ctx.lineWidth = 1.0;
  for (let r = 0; r <= rows; r++) drawDistLine(0, r/rows*H, W, r/rows*H);
  for (let c = 0; c <= cols; c++) drawDistLine(c/cols*W, 0, c/cols*W, H);

  // Filled squares
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 !== 0) continue;
      
      const corners = [
        [c/cols*W, r/rows*H], [(c+1)/cols*W, r/rows*H],
        [(c+1)/cols*W, (r+1)/rows*H], [c/cols*W, (r+1)/rows*H]
      ].map(([px, py]) => {
        [px, py] = applyPerspective(px, py);
        const nx = (px - cxC) / cxC;
        const ny = (py - cyC) / cyC;
        const [dx, dy] = distortPoint(nx, ny, k1, k2, true);
        return [cxC + dx * cxC * scaleFactor, cyC + dy * cyC * scaleFactor];
      });

      // Distorted edges
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      
      // Bezier curve approximation for smooth filled edges
      const edgeSteps = 5;
      for (let e = 0; e < 4; e++) {
        const p1 = [ (c+(e===1||e===2?1:0))/cols*W, (r+(e===2||e===3?1:0))/rows*H ];
        const p2 = [ (c+(e===0||e===1?1:0))/cols*W, (r+(e===1||e===2?1:0))/rows*H ];
        for (let i = 1; i <= edgeSteps; i++) {
          const t = i / edgeSteps;
          let px = p1[0] + t*(p2[0]-p1[0]);
          let py = p1[1] + t*(p2[1]-p1[1]);
          [px, py] = applyPerspective(px, py);
          const nx = (px - cxC)/cxC, ny = (py - cyC)/cyC;
          const [dx, dy] = distortPoint(nx, ny, k1, k2, true);
          ctx.lineTo(cxC + dx*cxC*scaleFactor, cyC + dy*cyC*scaleFactor);
        }
      }
      ctx.fill();
    }
  }

  // Label
  const lbl = k1 < -0.01 ? 'Barrel (Negative k1)' : k1 > 0.01 ? 'Pincushion (Positive k1)' : 'Linear (No Distortion)';
  ctx.fillStyle = '#1e293b'; ctx.font = 'bold 12px DM Sans';
  ctx.textAlign = 'center'; ctx.fillText(lbl, W/2, H - 12);
}

function renderUndistorted(canvas) {
  const ctx = canvas.getContext('2d');
  const clientW = canvas.clientWidth;
  const clientH = canvas.clientHeight;
  const W = clientW > 0 ? clientW : (canvas.width || 320);
  const H = clientH > 0 ? clientH : (canvas.height || 200);

  if (clientW > 0 && (canvas.width !== W || canvas.height !== H)) {
    canvas.width  = W;
    canvas.height = H;
  }

  // Draw flat background
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  const cxC = W / 2, cyC = H / 2;
  const scaleFactor = 0.85;
  
  // Dynamic Square Size based on SIM.sq
  const baseSq = Math.max(10, SIM.sq * 1.5); // Scale sq size
  const cols = Math.max(2, Math.floor(W / baseSq));
  const rows = Math.max(2, Math.floor(H / baseSq));

  const drawLine = (x0, y0, x1, y1) => {
    ctx.beginPath();
    const fpx0 = cxC + (x0 - cxC) * scaleFactor;
    const fpy0 = cyC + (y0 - cyC) * scaleFactor;
    const fpx1 = cxC + (x1 - cxC) * scaleFactor;
    const fpy1 = cyC + (y1 - cyC) * scaleFactor;
    ctx.moveTo(fpx0, fpy0);
    ctx.lineTo(fpx1, fpy1);
    ctx.stroke();
  };

  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth   = 0.5;
  for (let r = 0; r <= rows; r++) drawLine(0, r/rows*H, W, r/rows*H);
  for (let c = 0; c <= cols; c++) drawLine(c/cols*W, 0, c/cols*W, H);

  /* Filled squares (undistorted) */
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2 !== 0) continue;
      const corners = [
        [c/cols*W, r/rows*H], [(c+1)/cols*W, r/rows*H],
        [(c+1)/cols*W, (r+1)/rows*H], [c/cols*W, (r+1)/rows*H]
      ].map(([px, py]) => [cxC + (px - cxC)*scaleFactor, cyC + (py - cyC)*scaleFactor]);

      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      corners.slice(1).forEach(([px, py]) => ctx.lineTo(px, py));
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.fillStyle = '#64748b'; ctx.font = 'bold 12px DM Sans';
  ctx.textAlign = 'center'; ctx.fillText('Calibrated & Rectified', W/2, H - 12);
}

function initSim3D(canvas) {
  if (simRenderer) return;
  
  simScene = new THREE.Scene();
  simScene.background = new THREE.Color('#f8fafc');
  
  simCamera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  simCamera.position.set(0, -3.5, 3.5);
  simCamera.lookAt(0, 0, 0);
  
  simRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  simRenderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  
  // Create Plane Geometry
  const cols = BOARD_CONFIG.cols;
  const rows = BOARD_CONFIG.rows;
  const geom = new THREE.PlaneGeometry(3.2, 2.0, cols - 1, rows - 1);
  
  const colors = [];
  for (let i = 0; i < geom.attributes.position.count; i++) {
    colors.push(0.2, 0.5, 1.0); // Default blue
  }
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  
  const mat = new THREE.MeshBasicMaterial({ 
    vertexColors: true, 
    wireframe: true, 
    wireframeLinewidth: 1.5 
  });
  
  // Rotate plane so it lies flat on XZ
  simSurfaceMesh = new THREE.Mesh(geom, mat);
  simSurfaceMesh.rotation.x = -Math.PI / 2;
  simScene.add(simSurfaceMesh);
  
  // Add an axis helper
  const axes = new THREE.AxesHelper(1);
  simScene.add(axes);
  
  // Custom orbit controls
  setupSimOrbitControls(canvas);
  
  // Start animation loop
  animateSim3D();
}

function setupSimOrbitControls(canvas) {
  canvas.addEventListener('mousedown', e => {
    simIsDragging = true;
    simLastMouse = {x: e.clientX, y: e.clientY};
  });

  window.addEventListener('mouseup', () => { simIsDragging = false; });

  window.addEventListener('mousemove', e => {
    if (!simIsDragging) return;
    const dx = e.clientX - simLastMouse.x;
    const dy = e.clientY - simLastMouse.y;
    simLastMouse = {x: e.clientX, y: e.clientY};

    if (e.buttons === 1) {
      simPhi -= dx * 0.01;
      simTheta = Math.max(0.1, Math.min(Math.PI - 0.1, simTheta + dy * 0.01));
    }
  });

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    simRadius = Math.max(2, Math.min(8, simRadius + e.deltaY * 0.005));
  }, { passive: false });

  /* Touch support */
  let simLastTouchDist = 0, simLastTouch = null;

  canvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      simIsDragging = true;
      simLastTouch  = {x: e.touches[0].clientX, y: e.touches[0].clientY};
    } else if (e.touches.length === 2) {
      simLastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  });

  canvas.addEventListener('touchend', () => { simIsDragging = false; simLastTouch = null; });

  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    if (e.touches.length === 1 && simIsDragging && simLastTouch) {
      const dx = e.touches[0].clientX - simLastTouch.x;
      const dy = e.touches[0].clientY - simLastTouch.y;
      simLastTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
      simPhi -= dx * 0.01;
      simTheta = Math.max(0.1, Math.min(Math.PI - 0.1, simTheta + dy * 0.01));
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      simRadius = Math.max(2, Math.min(8, simRadius * (simLastTouchDist / dist)));
      simLastTouchDist = dist;
    }
  }, { passive: false });
}

function updateSim3D() {
  if (!simSurfaceMesh) return;
  
  const rpe = computeRPE();
  const cols = BOARD_CONFIG.cols;
  const rows = BOARD_CONFIG.rows;
  const posAttr = simSurfaceMesh.geometry.attributes.position;
  const colAttr = simSurfaceMesh.geometry.attributes.color;
  
  const W = 320, H = 200; // Conceptual pixel bounds for error calculation
  const marginX = W * 0.12;
  const marginY = H * 0.14;
  const spacX = (W - marginX * 2) / (cols - 1);
  const spacY = (H - marginY * 2) / (rows - 1);
  const cxC = W / 2, cyC = H / 2;
  
  const scaleSq = SIM.sq / 25.0;
  const tiltFactor = SIM.tilt * 0.15;
  const pitch = tiltFactor;
  const yaw   = tiltFactor * 0.6;
  
  const applyPerspective3D = (vx, vy) => {
    let x = vx * scaleSq;
    let y = vy * scaleSq;
    if (tiltFactor === 0) return [x, y];
    
    let x1 = x * Math.cos(yaw);
    let z1 = -x * Math.sin(yaw);
    let y2 = y * Math.cos(pitch) - z1 * Math.sin(pitch);
    let z2 = y * Math.sin(pitch) + z1 * Math.cos(pitch);
    
    const f = 4.0;
    const z_cam = 2.0;
    const proj = f / (f + z_cam + z2);
    
    return [x1 * proj, y2 * proj];
  };
  
  let i = 0;
  // PlaneGeometry vertices go row by row, from top to bottom
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const trueX = marginX + c * spacX;
      const trueY = marginY + r * spacY;
      
      const nx_orig = (trueX - cxC) / cxC;
      const ny_orig = (trueY - cyC) / cyC;
      
      // Calculate deformed visual 3D position
      const [meshX, meshY] = applyPerspective3D(nx_orig * 1.6, -ny_orig * 1.0);
      posAttr.setX(i, meshX);
      posAttr.setY(i, meshY);
      
      const seed1 = Math.sin(r * 12.9898 + c * 78.233 + SIM.N * 0.1) * 43758.5453;
      const seed2 = Math.cos(r * 12.9898 + c * 78.233 + SIM.N * 0.1) * 43758.5453;
      const noiseX = (seed1 - Math.floor(seed1) - 0.5) * rpe * 0.5;
      const noiseY = (seed2 - Math.floor(seed2) - 0.5) * rpe * 0.5;
      
      // Use deformed coordinates to determine radial distortion realistically
      const nx = meshX / 1.6;
      const ny = -meshY / 1.0;
      const rad2 = nx * nx + ny * ny;
      
      const sysMag = SIM.k1 * rad2;
      const errVecX = nx * sysMag * cxC + noiseX * 0.2;
      const errVecY = ny * sysMag * cyC + noiseY * 0.2;
      
      const magPixel = Math.sqrt(errVecX*errVecX + errVecY*errVecY);
      
      // Z is the vertical height of the error surface
      const zHeight = magPixel * 0.15; // Scale for 3D visual
      posAttr.setZ(i, zHeight);
      
      // Color logic: blue to red based on magPixel
      const maxErr = 3.0;
      const t = Math.max(0, Math.min(1, magPixel / maxErr));
      colAttr.setXYZ(i, 0.2 + t * 0.8, 0.5 - t * 0.3, 1.0 - t * 0.8);
      
      i++;
    }
  }
  
  posAttr.needsUpdate = true;
  colAttr.needsUpdate = true;
}

function animateSim3D() {
  cancelAnimationFrame(simAnimFrame);
  simAnimFrame = requestAnimationFrame(animateSim3D);
  if (!document.getElementById('page-sim').classList.contains('active')) return;
  
  if (simCamera && simRenderer) {
    simCamera.position.x = simRadius * Math.sin(simTheta) * Math.sin(simPhi);
    simCamera.position.y = simRadius * Math.cos(simTheta);
    simCamera.position.z = simRadius * Math.sin(simTheta) * Math.cos(simPhi);
    simCamera.lookAt(0, 0, 0);
    
    // Handle resize
    const canvas = simRenderer.domElement;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (canvas.width !== W || canvas.height !== H) {
      simRenderer.setSize(W, H, false);
      simCamera.aspect = W / H;
      simCamera.updateProjectionMatrix();
    }
    
    simRenderer.render(simScene, simCamera);
  }
}

/* ── Reprojection Error Graph ─────────────────────────────────
   Line graph showing RPE falling as N increases.
   Diversity and k1 affect the curve shape.                   */

function renderRPEGraph(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const clientW = canvas.clientWidth;
  const clientH = canvas.clientHeight;
  const W = clientW > 0 ? clientW : (canvas.width || 320);
  const H = clientH > 0 ? clientH : (canvas.height || 200);

  if (clientW > 0 && (canvas.width !== W || canvas.height !== H)) {
    canvas.width  = W;
    canvas.height = H;
  }

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  const padL = 38, padR = 12, padT = 14, padB = 32;
  const gW = W - padL - padR;
  const gH = H - padT - padB;

  const divFactor = [0.2, 0.55, 0.8, 1.0][SIM.tilt - 1];
  const k1Effect  = Math.abs(SIM.k1) * 0.12;

  const points = [];
  let maxRPE = 0;
  for (let n = 1; n <= 30; n++) {
    const base = 3.5 / (Math.sqrt(n) * divFactor * 10 + 1) + k1Effect * 0.5;
    const rpe  = Math.max(0.18, base);
    points.push({ n, rpe });
    if (rpe > maxRPE) maxRPE = rpe;
  }
  
  const maxY = Math.max(2.5, Math.ceil(maxRPE * 1.2 * 2) / 2);

  /* Grid */
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth   = 0.5;
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const v = (i / steps) * maxY;
    const y = padT + gH - (v / maxY) * gH;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gW, y); ctx.stroke();
    ctx.fillStyle = '#94a3b8'; ctx.font = '9px JetBrains Mono';
    ctx.textAlign = 'right';
    ctx.fillText(v.toFixed(1), padL - 4, y + 3);
  }

  /* Axis labels */
  ctx.fillStyle = '#64748b'; ctx.font = '10px DM Sans';
  ctx.textAlign = 'center';
  ctx.fillText('Number of Poses', padL + gW / 2, H - 4);
  
  ctx.save();
  ctx.translate(11, padT + gH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('RPE (px)', 0, 0);
  ctx.restore();

  /* Gradient Area Chart */
  const grad = ctx.createLinearGradient(0, padT, 0, padT + gH);
  grad.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
  grad.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

  ctx.beginPath();
  ctx.moveTo(padL, padT + gH);
  points.forEach((pt) => {
    const x = padL + ((pt.n - 1) / 29) * gW;
    const y = padT + gH - (pt.rpe / maxY) * gH;
    ctx.lineTo(x, y);
  });
  ctx.lineTo(padL + gW, padT + gH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  /* Glowing Line */
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  points.forEach((pt, i) => {
    const x = padL + ((pt.n - 1) / 29) * gW;
    const y = padT + gH - (pt.rpe / maxY) * gH;
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  });
  ctx.stroke();

  /* Current N marker */
  const curRPE = computeRPE();
  const curX   = padL + ((SIM.N - 1) / 29) * gW;
  const curY   = padT + gH - Math.min(gH, (curRPE / maxY) * gH);

  ctx.shadowColor = '#3b82f6';
  ctx.shadowBlur = 10;
  ctx.fillStyle   = '#ffffff';
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.arc(curX, curY, 6, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0; // reset

  /* Annotation */
  ctx.fillStyle = '#1e293b'; ctx.font = 'bold 11px DM Sans'; ctx.textAlign = 'left';
  ctx.fillText(`N=${SIM.N} → ${curRPE.toFixed(2)}px`, Math.min(curX + 10, W - 80), curY - 8);

  ctx.textAlign = 'left';
}

function renderGauge(canvas) {
  const ctx = canvas.getContext('2d');
  const clientW = canvas.clientWidth;
  const clientH = canvas.clientHeight;
  const W = clientW > 0 ? clientW : (canvas.width || 320);
  const H = clientH > 0 ? clientH : (canvas.height || 200);

  if (clientW > 0 && (canvas.width !== W || canvas.height !== H)) {
    canvas.width  = W;
    canvas.height = H;
  }

  ctx.clearRect(0, 0, W, H);

  const rpe     = computeRPE();
  const quality = Math.max(0, Math.min(100, 100 - (rpe / 2.5) * 100));

  const cx   = W / 2, cy = H - 5;
  const r    = Math.min(W / 2 - 20, H - 20); // Scale up to fill canvas better
  const startA = Math.PI;
  const endA   = 2 * Math.PI;

  /* Background arc */
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth   = 10;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, endA);
  ctx.stroke();

  /* Colored arc */
  const colour = quality > 70 ? '#22c55e' : quality > 40 ? '#f59e0b' : '#ef4444';
  const fillEndA = startA + (quality / 100) * Math.PI;
  
  ctx.strokeStyle = colour;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, fillEndA);
  ctx.stroke();

  /* Needle / Pointer */
  const needleLen = r - 18;
  const needleX = cx + needleLen * Math.cos(fillEndA);
  const needleY = cy + needleLen * Math.sin(fillEndA);
  
  ctx.beginPath();
  ctx.moveTo(cx, cy - 2); // Slightly offset so pivot covers it
  ctx.lineTo(needleX, needleY);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.stroke();
  
  /* Needle center pivot */
  ctx.beginPath();
  ctx.arc(cx, cy - 2, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#1e293b';
  ctx.fill();

  /* Update DOM Elements instead of canvas fillText */
  const elPct = document.getElementById('q-pct');
  const elSub = document.getElementById('q-sub');
  const elRPE = document.getElementById('q-rpe');
  if (elPct) {
    elPct.textContent = `${quality.toFixed(0)}%`;
    elPct.style.color = colour;
  }
  if (elSub) {
    elSub.textContent = quality > 70 ? 'Excellent' : quality > 40 ? 'Acceptable' : 'Poor';
  }
  if (elRPE) {
    elRPE.textContent = rpe.toFixed(2);
  }
  
  // Hide HTML labels since we draw them in canvas
  const lbl = document.getElementById('quality-label');
  const sub = document.getElementById('quality-sub');
  if(lbl) lbl.style.display = 'none';
  if(sub) sub.style.display = 'none';
}

function renderDiversityMap(canvas) {
  const ctx = canvas.getContext('2d');
  const clientW = canvas.clientWidth;
  const clientH = canvas.clientHeight;
  const W = clientW > 0 ? clientW : (canvas.width || 320);
  const H = clientH > 0 ? clientH : (canvas.height || 100);

  if (clientW > 0 && (canvas.width !== W || canvas.height !== H)) {
    canvas.width  = W;
    canvas.height = H;
  }

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  /* Axes */
  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.stroke();

  ctx.fillStyle = '#94a3b8'; ctx.font = '8px JetBrains Mono'; ctx.textAlign = 'center';
  ctx.fillText('Tilt X', W / 2, H - 2);
  ctx.save();
  ctx.translate(8, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Tilt Y', 0, 0);
  ctx.restore();

  /* Plot simulated poses */
  const divFactor = [0.12, 0.3, 0.6, 1.0][SIM.tilt - 1];
  const totalPts  = SIM.N;

  for (let i = 0; i < totalPts; i++) {
    /* Use deterministic seed per i for stable layout */
    const seed  = Math.sin(i * 127.1) * 43758.5453;
    const s2    = Math.sin(i * 311.7) * 43758.5453;
    const tx    = (seed - Math.floor(seed) - 0.5) * 2 * divFactor * 0.85;
    const ty    = (s2   - Math.floor(s2)   - 0.5) * 2 * divFactor * 0.85;

    const pad = 18; // Increased Canvas margin
    const gW = W - pad * 2;
    const gH = H - pad * 2;
    const px = pad + gW / 2 + tx * gW / 2;
    const py = pad + gH / 2 + ty * gH / 2;

    const t   = i / Math.max(totalPts - 1, 1);
    const col = `hsl(${200 + t * 140}, 70%, 50%)`;

    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Convex hull suggestion: draw an ellipse around the spread */
  if (totalPts > 3) {
    const pad = 18;
    const gW = W - pad * 2;
    const gH = H - pad * 2;
    
    ctx.strokeStyle = '#3b82f680';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.ellipse(pad + gW / 2, pad + gH / 2, divFactor * gW * 0.42, divFactor * gH * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — MAIN UPDATE
────────────────────────────────────────────────────────────── */

function updateSimulation() {
  const rpe     = computeRPE();
  const f_est  = computeF();
  const k2_est  = SIM.k1 * SIM.k1 * 0.25 * Math.sign(SIM.k1);

  // Dynamically scale checkerboard grid to visually represent square size changes
  BOARD_CONFIG.sqPx = SIM.sq * 0.96;

  /* Calculate Calibration Error for Intrinsic Matrix */
  let f_est_x = f_est;
  let f_est_y = f_est;
  let cx_est = 640;
  let cy_est = 360;

  if (SIM.N < 3) {
    f_est_x = 'ERR';
    f_est_y = 'ERR';
    cx_est = 'ERR';
    cy_est = 'ERR';
  } else {
    // Add noise based on how poor the calibration is
    const divFactor  = [0.2, 0.55, 0.8, 1.0][SIM.tilt - 1];
    const nFactor    = Math.min(1, Math.sqrt(SIM.N) / Math.sqrt(20));
    // When divFactor * nFactor is small, error is high
    const errorScale = 1.0 / (nFactor * divFactor * 5 + 0.1); 
    
    // Add random jitter but seeded by the current values so it jumps around realistically
    // We can just use the gauss() function which gives a random normal variable
    f_est_x = Math.round(f_est + gauss() * f_est * 0.05 * errorScale);
    f_est_y = Math.round(f_est + gauss() * f_est * 0.05 * errorScale);
    cx_est = Math.round(640 + gauss() * 60 * errorScale);
    cy_est = Math.round(360 + gauss() * 40 * errorScale);
  }

  /* K matrix panel */
  document.getElementById('km-fx').textContent = f_est_x;
  document.getElementById('km-fy').textContent = f_est_y;
  document.getElementById('km-cx').textContent = cx_est;
  document.getElementById('km-cy').textContent = cy_est;

  /* Distortion coefficients */
  document.getElementById('dc-k1').textContent = SIM.k1.toFixed(3);
  document.getElementById('dc-k2').textContent = k2_est.toFixed(4);
  document.getElementById('dc-p1').textContent = (gauss() * 0.004).toFixed(4);
  document.getElementById('dc-p2').textContent = (gauss() * 0.003).toFixed(4);

  /* Live readouts */
  document.getElementById('ro-f').textContent  = f_est;
  document.getElementById('ro-cx').textContent = 640;
  document.getElementById('ro-cy').textContent = 360;

  const rpeEl = document.getElementById('ro-rpe');
  rpeEl.textContent = rpe.toFixed(2);
  rpeEl.className   = 'ro-val' + (
    rpe < 0.5 ? ' good' :
    rpe < 1.0 ? ' warn' :
                ' danger'
  );

  /* Render all canvases */
  renderDistorted(document.getElementById('cvs-distorted'));
  renderUndistorted(document.getElementById('cvs-undistorted'));
  
  const simCanvas = document.getElementById('cvs-corners');
  initSim3D(simCanvas);
  updateSim3D();
  
  renderRPEGraph(document.getElementById('cvs-rpe'));
  renderGauge(document.getElementById('gauge-canvas'));
  renderDiversityMap(document.getElementById('cvs-diversity'));
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — WIZARD
────────────────────────────────────────────────────────────── */

function updateSimWizard() {
  const step = Math.min(SIM.step, SIM_WIZARD.length - 1);
  const s    = SIM_WIZARD[step];

  document.getElementById('wiz-title').textContent = s.title;
  document.getElementById('wiz-text').textContent  = s.text;
  document.getElementById('wiz-task').textContent  = s.task;

  /* Highlight param group */
  document.querySelectorAll('.param-grp').forEach(el => el.classList.remove('lit'));
  if (s.lit) {
    const el = document.getElementById(s.lit);
    if (el) { el.classList.add('lit'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }

  /* Dots */
  document.querySelectorAll('.wdot').forEach((d, i) => {
    d.classList.remove('active', 'done');
    if (i === step) d.classList.add('active');
    if (i < step)  d.classList.add('done');
  });

  /* Buttons */
  const btnNext = document.getElementById('wiz-next');
  const btnSkip = document.getElementById('wiz-skip');
  if (step >= SIM_WIZARD.length - 1) {
    btnNext.textContent = 'Explore Freely';
    btnSkip.style.display = 'none';
  } else {
    btnNext.textContent   = 'Next Step';
    btnSkip.style.display = '';
  }
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — INIT & CONTROLS
────────────────────────────────────────────────────────────── */

function initSimulation() {
  /* Initialize simulation parameters from captured setup poses */
  if (POSES.length > 0) {
    SIM.N = Math.min(30, POSES.length);
    
    // Estimate tilt diversity from poses
    const maxTilt = Math.max(...POSES.map(p => p.tiltMag || 0));
    let tiltLevel = 1;
    if (maxTilt > 30) tiltLevel = 4;
    else if (maxTilt > 15) tiltLevel = 3;
    else if (maxTilt > 5) tiltLevel = 2;
    
    SIM.tilt = tiltLevel;
    
    // Sync UI Sliders
    const rN = document.getElementById('r-N');
    if (rN) { rN.value = SIM.N; document.getElementById('pv-N').textContent = SIM.N; }
    
    const rTilt = document.getElementById('r-tilt');
    if (rTilt) { 
      rTilt.value = SIM.tilt; 
      document.getElementById('pv-tilt').textContent = ['', 'Low','Medium','High','Full'][SIM.tilt]; 
    }
  }

  updateSimWizard();
  updateSimulation();

  /* Param sliders */
  const sliders = [
    { id: 'r-N',    lbl: 'pv-N',    key: 'N',    fmt: v => Math.round(v), disp: v => `${Math.round(v)}` },
    { id: 'r-tilt', lbl: 'pv-tilt', key: 'tilt', fmt: v => Math.round(v),
      disp: v => ['', 'Low','Medium','High','Full'][Math.round(v)] },
    { id: 'r-sq',   lbl: 'pv-sq',   key: 'sq',   fmt: v => Math.round(v), disp: v => `${Math.round(v)} mm` },
    { id: 'r-k1',   lbl: 'pv-k1',   key: 'k1',   fmt: v => parseFloat(v), disp: v => parseFloat(v).toFixed(2) },
  ];

  sliders.forEach(({ id, lbl, key, fmt, disp }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      SIM[key] = fmt(v);
      document.getElementById(lbl).textContent = disp(v);
      updateSimulation();
    });
  });

  /* Wizard buttons */
  document.getElementById('wiz-next').addEventListener('click', () => {
    SIM.step = Math.min(SIM.step + 1, SIM_WIZARD.length - 1);
    updateSimWizard();
  });

  document.getElementById('wiz-skip').addEventListener('click', () => {
    SIM.step = SIM_WIZARD.length - 1;
    updateSimWizard();
  });

  /* Interactive Graph Hover */
  const cvsRPE = document.getElementById('cvs-rpe');
  if (cvsRPE) {
    cvsRPE.addEventListener('mousemove', e => {
      const rect = cvsRPE.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const W = cvsRPE.offsetWidth || cvsRPE.width;
      const padL = 38, padR = 12;
      const gW = W - padL - padR;
      
      let hoverN = Math.round(1 + ((x - padL) / gW) * 29);
      if (hoverN < 1) hoverN = undefined;
      if (hoverN > 30) hoverN = undefined;
      
      if (SIM.rpeHoverN !== hoverN) {
        SIM.rpeHoverN = hoverN;
        renderRPEGraph(cvsRPE);
      }
    });
    
    cvsRPE.addEventListener('mouseout', () => {
      SIM.rpeHoverN = undefined;
      renderRPEGraph(cvsRPE);
    });
  }

  /* Interactive Vector Map Hover */
  
  document.querySelectorAll('.wdot').forEach(d => {
    d.addEventListener('click', () => {
      SIM.step = parseInt(d.dataset.ws);
      updateSimWizard();
    });
  });

  /* Reset buttons */
  ['btn-sim-reset', 'btn-sim-reset2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', resetSimulation);
  });

  /* Responsive canvas resizing */
  const ro = new ResizeObserver(() => updateSimulation());
  document.querySelectorAll('.sim-card').forEach(c => ro.observe(c));
}

function resetSimulation() {
  SIM.N = 5; SIM.tilt = 1; SIM.sq = 25; SIM.k1 = 0; SIM.step = 0;

  document.getElementById('r-N').value    = 5;
  document.getElementById('r-tilt').value = 1;
  document.getElementById('r-sq').value   = 25;
  document.getElementById('r-k1').value   = 0;

  document.getElementById('pv-N').textContent    = '5';
  document.getElementById('pv-tilt').textContent = 'Low';
  document.getElementById('pv-sq').textContent   = '25 mm';
  document.getElementById('pv-k1').textContent   = '0.00';

  updateSimWizard();
  updateSimulation();
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — DRAW CHECKERBOARD ICON (CSS canvas)
────────────────────────────────────────────────────────────── */

function drawBoardIcon() {
  const el = document.getElementById('ci-board');
  if (!el) return;

  const c   = document.createElement('canvas');
  c.width   = 40;
  c.height  = 32;
  c.style.width  = '40px';
  c.style.height = '32px';

  const ctx  = c.getContext('2d');
  const cols = 5, rows = 4;
  const sqW  = 40 / cols, sqH = 32 / rows;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 40, 32);

  for (let r = 0; r < rows; r++) {
    for (let c2 = 0; c2 < cols; c2++) {
      if ((r + c2) % 2 === 0) {
        ctx.fillStyle = '#111';
        ctx.fillRect(c2 * sqW, r * sqH, sqW, sqH);
      }
    }
  }

  el.appendChild(c);
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — RESET EVERYTHING
────────────────────────────────────────────────────────────── */

function resetPoses() {
  /* Reset poses */
  POSES.length = 0;
  document.getElementById('pose-count').textContent = '0';
  document.getElementById('pose-grid').innerHTML    = '';
  document.getElementById('btn-go-sim').disabled  = true;

  const obsPose = document.getElementById('obs-pose');
  if (obsPose) {
    obsPose.textContent = '—';
    obsPose.style.color = '';
  }
}

function resetSetup() {
  /* Reset mounted state */
  Object.keys(MOUNTED).forEach(k => { MOUNTED[k] = false; });

  /* Reset 3D meshes */
  if (cameraMesh) { cameraMesh.visible = false; fovHelper.visible = false; }
  if (tripodMesh) tripodMesh.visible = false;
  if (boardMesh)  boardMesh.visible  = false;
  if (railMesh)   railMesh.visible   = false;
  if (lightMesh)  lightMesh.visible  = false;

  /* Reset poses */
  resetPoses();
  const obsCorners = document.getElementById('obs-corners');
  if (obsCorners) obsCorners.textContent = '—';
  const obsTilt = document.getElementById('obs-tilt');
  if (obsTilt) obsTilt.textContent = '—';

  /* Reset cards */
  document.querySelectorAll('.apparatus-card').forEach(c => {
    c.classList.remove('mounted', 'selected');
    const status = c.querySelector('.apparatus-status');
    if (status) status.textContent = 'Unmounted';
  });
  
  // Re-enable first item
  const firstCard = document.querySelector('.apparatus-card[data-comp="tripod"]');
  if (firstCard) firstCard.classList.add('selected');
  selectedComp = 'tripod';
  
  const warn = document.getElementById('mount-warning');
  if(warn) warn.textContent = '';
  
  const btnNext = document.getElementById('btn-next');
  if (btnNext) btnNext.style.display = 'none';

  /* Reset sliders */
  document.getElementById('sr-tx').value = 0;
  document.getElementById('sr-ty').value = 0;
  document.getElementById('sr-bd').value = 60;
  document.getElementById('sv-tx').textContent = '0°';
  document.getElementById('sv-ty').textContent = '0°';
  document.getElementById('sv-bd').textContent = '60 cm';
  boardTX = 0; boardTY = 0; boardDist = 0.6;
  
  /* Reset readout values */
  document.getElementById('r-f').textContent = '—';
  document.getElementById('r-cx').textContent = '—';
  document.getElementById('r-cy').textContent = '—';
  document.getElementById('r-k1-readout').textContent = '—';
  document.getElementById('r-rpe').textContent = '—';
  document.getElementById('rpe-bar').style.left = '0%';

  /* Reset UI panels */
  document.getElementById('mount-section').style.display = 'block';
  document.getElementById('capture-section').style.display = 'none';
  const counterWrapReset = document.getElementById('setup-pose-counter-wrap'); if(counterWrapReset) counterWrapReset.style.display = 'none';
  document.getElementById('setup-wiz-task').textContent = 'Task: Mount the tripod.';
}

/* ──────────────────────────────────────────────────────────────
   INIT — Wire up all events and start
────────────────────────────────────────────────────────────── */

function init() {
  try {
  /* Draw board CSS icon */
  drawBoardIcon();

  /* Init Three.js */
  initThree();

  /* Apparatus selection */
  document.querySelectorAll('.apparatus-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedComp = card.dataset.comp;
      document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const warn = document.getElementById('mount-warning');
      if (warn) warn.textContent = '';
    });
  });

  /* Component mount button */
  const btnMount = document.getElementById('btn-mount');
  if (btnMount) {
    btnMount.addEventListener('click', function() {
      const warn = document.getElementById('mount-warning');
      if (warn) warn.textContent = '';
      
      if (MOUNTED[selectedComp]) {
        if (warn) warn.textContent = 'Component already mounted!';
        return;
      }
      
      const idx = MOUNT_SEQ.indexOf(selectedComp);
      if (idx > 0 && !MOUNTED[MOUNT_SEQ[idx - 1]]) {
        if (warn) warn.textContent = 'Please mount components in sequence!';
        return;
      }
      
      // Animation
      this.classList.remove('btn-mount-anim');
      void this.offsetWidth;
      this.classList.add('btn-mount-anim');
      
      mountComponent(selectedComp);
      
      // Auto-select next
      if (idx < MOUNT_SEQ.length - 1) {
        const next = MOUNT_SEQ[idx + 1];
        selectedComp = next;
        document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
        document.querySelector(`.apparatus-card[data-comp="${next}"]`).classList.add('selected');
      }
    });
  }

  /* Back to mounting button */
  const btnBackMount = document.getElementById('btn-back-mount');
  if (btnBackMount) {
    btnBackMount.addEventListener('click', () => {
      document.getElementById('capture-section').style.display = 'none';
      document.getElementById('mount-section').style.display = 'block';
    });
  }

  const btnNext = document.getElementById('btn-next');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      document.getElementById('mount-section').style.display = 'none';
      document.getElementById('capture-section').style.display = 'block';
    });
  }

  const btnResetMount = document.getElementById('btn-reset-mount');
  if (btnResetMount) {
    btnResetMount.addEventListener('click', resetSetup);
  }

  /* Setup board sliders */
  document.getElementById('sr-tx').addEventListener('input', e => {
    boardTX = parseInt(e.target.value);
    document.getElementById('sv-tx').textContent = `${boardTX}°`;
    updateBoardTransform();
  });

  document.getElementById('sr-ty').addEventListener('input', e => {
    boardTY = parseInt(e.target.value);
    document.getElementById('sv-ty').textContent = `${boardTY}°`;
    updateBoardTransform();
  });

  document.getElementById('sr-bd').addEventListener('input', e => {
    boardDist = parseInt(e.target.value) / 100;
    document.getElementById('sv-bd').textContent = `${e.target.value} cm`;
    updateBoardTransform();
  });

  /* Capture pose */
  document.getElementById('btn-capture').addEventListener('click', capturePose);

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
  const btnGoSim = document.getElementById('btn-go-sim');
  if (btnGoSim) btnGoSim.addEventListener('click', showSimulation);
  
  const btnLaunchSim = document.getElementById('btn-launch-sim');
  if (btnLaunchSim) btnLaunchSim.addEventListener('click', showSimulation);
  
  const btnBack = document.getElementById('btn-back-setup'); if(btnBack) btnBack.addEventListener('click', showSetup);
  document.getElementById('btn-reset-poses').addEventListener('click', resetPoses);

  /* Disable context menu on canvas */
  document.getElementById('three-canvas').addEventListener('contextmenu', e => e.preventDefault());
  
  initDynamicSliders();
  } catch (err) {
    alert("Init Error: " + err.message);
    console.error(err);
  }
}

function initDynamicSliders() {

}

function initTooltips() {
  const tooltip = document.getElementById('global-tooltip');
  if (!tooltip) return;

  document.querySelectorAll('.info-icon').forEach(icon => {
    icon.addEventListener('mouseenter', () => {
      const text = icon.getAttribute('data-tooltip');
      if (!text) return;
      
      tooltip.textContent = text;
      tooltip.style.display = 'block';
      
      const rect = icon.getBoundingClientRect();
      tooltip.style.left = (rect.left + rect.width / 2) + 'px';
      tooltip.style.top = rect.top + 'px';
    });
    
    icon.addEventListener('mouseleave', () => {
      tooltip.style.display = 'none';
    });
  });
}

window.addEventListener('load', () => {
  init();
  initTooltips();
});
