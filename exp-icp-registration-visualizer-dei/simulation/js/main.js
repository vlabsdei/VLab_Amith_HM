/* ================================================================
   EXPERIMENT 4 — ICP REGISTRATION VISUALIZER
   main.js — Three.js 3D setup scene + real ICP algorithm + 2D canvases
   ================================================================

   ARCHITECTURE
   ────────────
   SETUP PAGE
     ThreeScene    → renderer, camera, orbit controls, two point clouds
     Components    → tracks mounted equipment (source, target, frame, shape)
     Misalignment  → rotation/translation sliders applied to source cloud
     SetupWizard   → step navigation (0→4)

   SIMULATION PAGE
     PointCloudGen → generates L-shape / arc / sphere-like point sets
     ICP Engine    → real nearest-neighbour + SVD-based rigid registration
     render*()     → 3D overlay, RMSE graph, correspondence lines, before/after
     WizardSim     → 4-step guided walkthrough

   CORE MATH (Experiment 4 theory) — all implemented for real, not faked
   ────────────────────────────────────────────────────────────────────
     Objective:     E(R,t) = Σ ||qᵢ - (R*pᵢ + t)||²
     Centroids:     p̄ = mean(P), q̄ = mean(Q)
     Cross-cov:     H = Σ (pᵢ-p̄)(qᵢ-q̄)ᵗ
     SVD:           H = U*Σ*Vᵗ   (3×3 Jacobi-based SVD implemented below)
     Rotation:      R = V*Uᵗ      (with reflection-case correction)
     Translation:   t = q̄ - R*p̄
     RMSE:          sqrt(mean(||qᵢ-(R*pᵢ+t)||²))
     Convergence:   |RMSEₖ - RMSEₖ₋₁| < ε
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */

const MOUNTED = { source: false, target: false, frame: false, shape: false };

const SETUP = {
  rotDeg: 20,
  trans:  0.3,
  overlap: 65,
};

const SIM = {
  rotDeg:  20,
  overlap: 65,
  eps:     0.005,
  noise:   0,
  shapeIdx: 0,    /* 0 = L-shape, 1 = arc, 2 = sphere-like */
  step:    0,     /* wizard step */
};

const SHAPE_NAMES = ['L-shape', 'Arc', 'Sphere-like'];

/* ICP runtime state */
let ICP = {
  sourcePts: [],     /* live, mutated each iteration            */
  targetPts: [],     /* fixed reference cloud                   */
  origSourcePts: [], /* untouched copy for before/after compare */
  R: [[1,0,0],[0,1,0],[0,0,1]],
  t: [0,0,0],
  iteration: 0,
  rmseHistory: [],
  converged: false,
  convergedAt: null,
  maxIter: 150,
};

/* Wizard content for simulation page */
const SIM_WIZARD = [
  {
    title: 'Run One Iteration',
    text:  'Each ICP iteration finds nearest-neighbour matches, computes the optimal R and t via SVD, and applies it. Press Step to watch a single iteration happen.',
    task:  '▶ Click "Step One Iteration" 3 times and watch RMSE drop each time.',
    lit:   'pg-rot',
  },
  {
    title: 'Push Initial Misalignment',
    text:  'Beyond about 45° rotation, nearest-neighbour correspondences in early iterations are often wrong, risking convergence to an incorrect local minimum.',
    task:  '▶ Set rotation to 50° and Run to Convergence. Check the alignment overlay carefully.',
    lit:   'pg-rot',
  },
  {
    title: 'Reduce Overlap',
    text:  'With less shared surface area, more correspondences are forced matches between points that do not truly correspond, destabilising the optimisation.',
    task:  '▶ Drop overlap to 30% and Run. Watch the RMSE curve behave less smoothly.',
    lit:   'pg-overlap',
  },
  {
    title: 'Add Point Noise',
    text:  'Even after perfect convergence, noisy point clouds cannot achieve RMSE = 0. The noise sets an unavoidable floor on final accuracy.',
    task:  '▶ Set noise to 4mm on a clean L-shape run and observe the RMSE floor.',
    lit:   'pg-noise',
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

/* ──────────────────────────────────────────────────────────────
   3×3 MATRIX / VECTOR HELPERS (vanilla, no library)
────────────────────────────────────────────────────────────── */

function matMul3(A, B) {
  const C = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        C[i][j] += A[i][k] * B[k][j];
  return C;
}

function matTranspose3(A) {
  return [[A[0][0],A[1][0],A[2][0]],[A[0][1],A[1][1],A[2][1]],[A[0][2],A[1][2],A[2][2]]];
}

function matVec3(A, v) {
  return [
    A[0][0]*v[0] + A[0][1]*v[1] + A[0][2]*v[2],
    A[1][0]*v[0] + A[1][1]*v[1] + A[1][2]*v[2],
    A[2][0]*v[0] + A[2][1]*v[1] + A[2][2]*v[2],
  ];
}

function matDet3(A) {
  return A[0][0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1])
       - A[0][1]*(A[1][0]*A[2][2]-A[1][2]*A[2][0])
       + A[0][2]*(A[1][0]*A[2][1]-A[1][1]*A[2][0]);
}

/* Jacobi eigenvalue algorithm for symmetric 3×3 matrices.
   Used internally to build SVD of H via eigendecomposition of HᵗH and HHᵗ.
   This is a standard, numerically simple approach suitable for 3×3. */
function jacobiEigenSymmetric3(Ain) {
  let A = [[Ain[0][0],Ain[0][1],Ain[0][2]],[Ain[1][0],Ain[1][1],Ain[1][2]],[Ain[2][0],Ain[2][1],Ain[2][2]]];
  let V = [[1,0,0],[0,1,0],[0,0,1]];

  for (let sweep = 0; sweep < 60; sweep++) {
    /* find largest off-diagonal element */
    let p = 0, q = 1, maxVal = Math.abs(A[0][1]);
    if (Math.abs(A[0][2]) > maxVal) { maxVal = Math.abs(A[0][2]); p = 0; q = 2; }
    if (Math.abs(A[1][2]) > maxVal) { maxVal = Math.abs(A[1][2]); p = 1; q = 2; }
    if (maxVal < 1e-12) break;

    const app = A[p][p], aqq = A[q][q], apq = A[p][q];
    const phi = 0.5 * Math.atan2(2*apq, aqq - app);
    const c = Math.cos(phi), s = Math.sin(phi);

    /* build rotation J and apply A' = JᵗAJ, V' = VJ */
    const J = [[1,0,0],[0,1,0],[0,0,1]];
    J[p][p] = c; J[q][q] = c; J[p][q] = -s; J[q][p] = s;

    const Jt = matTranspose3(J);
    A = matMul3(matMul3(Jt, A), J);
    V = matMul3(V, J);
  }

  const eigenvalues = [A[0][0], A[1][1], A[2][2]];
  /* eigenvectors are columns of V */
  const eigenvectors = [
    [V[0][0], V[1][0], V[2][0]],
    [V[0][1], V[1][1], V[2][1]],
    [V[0][2], V[1][2], V[2][2]],
  ];
  return { values: eigenvalues, vectors: eigenvectors };
}

/* SVD of a general 3×3 matrix H via eigendecomposition of HᵗH (gives V)
   and HHᵗ (gives U), matching singular values by sorted order.
   Returns { U, S, V } such that H ≈ U * diag(S) * Vᵗ                  */
function svd3(H) {
  const Ht  = matTranspose3(H);
  const HtH = matMul3(Ht, H);
  const HHt = matMul3(H, Ht);

  const eigV = jacobiEigenSymmetric3(HtH); /* gives V and singular values² */
  const eigU = jacobiEigenSymmetric3(HHt); /* gives U */

  /* sort both by descending eigenvalue for consistent ordering */
  const orderV = [0,1,2].sort((a,b) => eigV.values[b] - eigV.values[a]);
  const orderU = [0,1,2].sort((a,b) => eigU.values[b] - eigU.values[a]);

  const S = orderV.map(i => Math.sqrt(Math.max(0, eigV.values[i])));
  const V = orderV.map(i => eigV.vectors[i]);   /* rows = eigenvectors */
  const U = orderU.map(i => eigU.vectors[i]);

  /* V and U currently stored as row-major lists of eigenvectors;
     convert to column form (standard U,V convention) */
  const Vmat = [[V[0][0],V[1][0],V[2][0]],[V[0][1],V[1][1],V[2][1]],[V[0][2],V[1][2],V[2][2]]];
  const Umat = [[U[0][0],U[1][0],U[2][0]],[U[0][1],U[1][1],U[2][1]],[U[0][2],U[1][2],U[2][2]]];

  return { U: Umat, S, V: Vmat };
}

/* ──────────────────────────────────────────────────────────────
   POINT CLOUD GENERATORS
────────────────────────────────────────────────────────────── */

function generateLShape(n, noiseMm) {
  const pts = [];
  const noise = noiseMm / 1000;
  for (let i = 0; i < n; i++) {
    let x, y;
    if (Math.random() < 0.5) {
      x = Math.random() * 0.6 - 0.3;
      y = -0.3 + Math.random() * 0.08;
    } else {
      x = -0.3 + Math.random() * 0.08;
      y = Math.random() * 0.6 - 0.3;
    }
    const z = (Math.random() - 0.5) * 0.04;
    pts.push([
      x + gauss()*noise,
      y + gauss()*noise,
      z + gauss()*noise,
    ]);
  }
  return pts;
}

function generateArc(n, noiseMm) {
  const pts = [];
  const noise = noiseMm / 1000;
  const R = 0.35;
  for (let i = 0; i < n; i++) {
    const t = Math.random() * Math.PI * 1.4 - 0.2;
    const x = R * Math.cos(t);
    const y = R * Math.sin(t);
    const z = (Math.random() - 0.5) * 0.04;
    pts.push([x + gauss()*noise, y + gauss()*noise, z + gauss()*noise]);
  }
  return pts;
}

function generateSphereLike(n, noiseMm) {
  const pts = [];
  const noise = noiseMm / 1000;
  const R = 0.45;
  for (let i = 0; i < n; i++) {
    const u = Math.random()*2-1;
    const phi = Math.random()*Math.PI*2;
    const r = Math.sqrt(1-u*u);
    const x = R * r * Math.cos(phi);
    const y = R * r * Math.sin(phi);
    const z = R * u;
    pts.push([x + gauss()*noise, y + gauss()*noise, z + gauss()*noise]);
  }
  return pts;
}

function generateCar(n, noiseMm) {
  const pts = [];
  const noise = noiseMm / 1000;
  const nBody = Math.floor(n * 0.4);
  const nCabin = Math.floor(n * 0.3);
  const nWheels = n - nBody - nCabin;
  
  for(let i=0; i<nBody; i++) pts.push([ (Math.random()-0.5)*1.2, -0.1 + (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.5 ]);
  for(let i=0; i<nCabin; i++) pts.push([ -0.05 + (Math.random()-0.5)*0.5, 0.1 + (Math.random()-0.5)*0.2, (Math.random()-0.5)*0.4 ]);
  
  const wh = [[-0.35, -0.2, 0.25], [0.35, -0.2, 0.25], [-0.35, -0.2, -0.25], [0.35, -0.2, -0.25]];
  const ptsPerWh = Math.floor(nWheels / 4);
  wh.forEach(w => {
    for(let i=0; i<ptsPerWh; i++) {
      const ang = Math.random()*Math.PI*2;
      const r = 0.12 * Math.sqrt(Math.random());
      pts.push([ w[0]+r*Math.cos(ang), w[1]+r*Math.sin(ang), w[2] + (Math.random()-0.5)*0.05 ]);
    }
  });
  return pts.map(p => [p[0]+gauss()*noise, p[1]+gauss()*noise, p[2]+gauss()*noise]);
}

function generateScooter(n, noiseMm) {
  const pts = [];
  const noise = noiseMm / 1000;
  const nDeck = Math.floor(n * 0.4);
  const nStem = Math.floor(n * 0.3);
  const nHandle = Math.floor(n * 0.1);
  const nWheels = n - nDeck - nStem - nHandle;
  
  for(let i=0; i<nDeck; i++) pts.push([ (Math.random()-0.5)*1.0, -0.2, (Math.random()-0.5)*0.2 ]);
  for(let i=0; i<nStem; i++) pts.push([ 0.4 + (Math.random()-0.5)*0.05, -0.2 + Math.random()*0.8, (Math.random()-0.5)*0.05 ]);
  for(let i=0; i<nHandle; i++) pts.push([ 0.4 + (Math.random()-0.5)*0.05, 0.6, (Math.random()-0.5)*0.4 ]);
  
  const wh = [[-0.4, -0.3, 0], [0.45, -0.3, 0]];
  const ptsPerWh = Math.floor(nWheels / 2);
  wh.forEach(w => {
    for(let i=0; i<ptsPerWh; i++) {
      const ang = Math.random()*Math.PI*2;
      const r = 0.12 * Math.sqrt(Math.random());
      pts.push([ w[0]+r*Math.cos(ang), w[1]+r*Math.sin(ang), w[2] + (Math.random()-0.5)*0.02 ]);
    }
  });
  return pts.map(p => [p[0]+gauss()*noise, p[1]+gauss()*noise, p[2]+gauss()*noise]);
}

function generateTree(n, noiseMm) {
  const pts = [];
  const noise = noiseMm / 1000;
  const nTrunk = Math.floor(n * 0.25);
  const nCanopy = n - nTrunk;
  
  for(let i=0; i<nTrunk; i++) pts.push([ (Math.random()-0.5)*0.15, -0.2 + (Math.random()-0.5)*0.6, (Math.random()-0.5)*0.15 ]);
  
  for(let i=0; i<nCanopy; i++) {
    const u = Math.random(); const v = Math.random();
    const theta = 2 * Math.PI * u; const phi = Math.acos(2 * v - 1);
    const r = 0.45 * Math.cbrt(Math.random());
    pts.push([ r * Math.sin(phi) * Math.cos(theta), 0.2 + r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi) ]);
  }
  return pts.map(p => [p[0]+gauss()*noise, p[1]+gauss()*noise, p[2]+gauss()*noise]);
}

function generateShape(idx, n, noiseMm) {
  idx = parseInt(idx);
  if (idx === 0) return generateLShape(n, noiseMm);
  if (idx === 1) return generateArc(n, noiseMm);
  if (idx === 2) return generateSphereLike(n, noiseMm);
  if (idx === 3) return generateCar(n, noiseMm);
  if (idx === 4) return generateScooter(n, noiseMm);
  return generateTree(n, noiseMm);
}

/* Apply overlap by keeping only a fraction of source points that lie
   within the "shared" spatial region, simulating partial scan overlap. */
function applyOverlapMask(pts, overlapPct) {
  if (overlapPct >= 95) return pts.slice();
  const keepFrac = overlapPct / 100;
  const cut = pts.slice().sort((a,b) => a[0]-b[0]);
  const keepCount = Math.floor(pts.length * keepFrac);
  /* keep a contiguous spatial band to simulate genuine partial overlap */
  const startIdx = Math.floor((pts.length - keepCount) * Math.random());
  return cut.slice(startIdx, startIdx + keepCount);
}

/* Apply rotation (about Z then small tilt) + translation to a point set */
function transformPoints(pts, rotDeg, transMag) {
  const theta = degToRad(rotDeg);
  const c = Math.cos(theta), s = Math.sin(theta);
  const R = [[c,-s,0],[s,c,0],[0,0,1]];
  const tx = transMag * 0.7, ty = transMag * 0.5, tz = transMag * 0.2;
  return pts.map(p => {
    const r = matVec3(R, p);
    return [r[0]+tx, r[1]+ty, r[2]+tz];
  });
}

/* ──────────────────────────────────────────────────────────────
   ICP ENGINE — single iteration
────────────────────────────────────────────────────────────── */

function nearestNeighbour(p, targetPts) {
  let best = targetPts[0], bestDist = Infinity;
  for (const q of targetPts) {
    const dx = p[0]-q[0], dy = p[1]-q[1], dz = p[2]-q[2];
    const d = dx*dx + dy*dy + dz*dz;
    if (d < bestDist) { bestDist = d; best = q; }
  }
  return best;
}

function computeRMSE(sourcePts, matches) {
  let sum = 0;
  for (let i = 0; i < sourcePts.length; i++) {
    const p = sourcePts[i], q = matches[i];
    const dx = p[0]-q[0], dy = p[1]-q[1], dz = p[2]-q[2];
    sum += dx*dx + dy*dy + dz*dz;
  }
  return Math.sqrt(sum / sourcePts.length);
}

function icpStep() {
  if (ICP.converged) return;

  /* subsample for performance on nearest-neighbour search */
  const sampleSize = Math.min(180, ICP.sourcePts.length);
  const sampleIdx = [];
  for (let i = 0; i < sampleSize; i++) {
    sampleIdx.push(Math.floor(Math.random() * ICP.sourcePts.length));
  }

  const P = sampleIdx.map(i => ICP.sourcePts[i]);
  const Q = P.map(p => nearestNeighbour(p, ICP.targetPts));

  /* centroids */
  const pBar = [0,0,0], qBar = [0,0,0];
  P.forEach(p => { pBar[0]+=p[0]; pBar[1]+=p[1]; pBar[2]+=p[2]; });
  Q.forEach(q => { qBar[0]+=q[0]; qBar[1]+=q[1]; qBar[2]+=q[2]; });
  for (let k=0;k<3;k++) { pBar[k] /= P.length; qBar[k] /= Q.length; }

  /* cross-covariance H = Σ (p-p̄)(q-q̄)ᵗ */
  let H = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < P.length; i++) {
    const pc = [P[i][0]-pBar[0], P[i][1]-pBar[1], P[i][2]-pBar[2]];
    const qc = [Q[i][0]-qBar[0], Q[i][1]-qBar[1], Q[i][2]-qBar[2]];
    for (let r=0;r<3;r++) for (let c=0;c<3;c++) H[r][c] += pc[r]*qc[c];
  }

  /* SVD: H = U S Vᵗ  →  R = V Uᵗ */
  const { U, V } = svd3(H);
  let R = matMul3(V, matTranspose3(U));

  /* reflection correction: if det(R) < 0, flip last column of V */
  if (matDet3(R) < 0) {
    const Vfix = [[V[0][0],V[0][1],-V[0][2]],[V[1][0],V[1][1],-V[1][2]],[V[2][0],V[2][1],-V[2][2]]];
    R = matMul3(Vfix, matTranspose3(U));
  }

  const t = [
    qBar[0] - (R[0][0]*pBar[0]+R[0][1]*pBar[1]+R[0][2]*pBar[2]),
    qBar[1] - (R[1][0]*pBar[0]+R[1][1]*pBar[1]+R[1][2]*pBar[2]),
    qBar[2] - (R[2][0]*pBar[0]+R[2][1]*pBar[1]+R[2][2]*pBar[2]),
  ];

  /* apply transform to the FULL source cloud */
  ICP.sourcePts = ICP.sourcePts.map(p => {
    const r = matVec3(R, p);
    return [r[0]+t[0], r[1]+t[1], r[2]+t[2]];
  });

  /* accumulate global R, t (composition, approximate for display) */
  ICP.R = matMul3(R, ICP.R);
  ICP.t = [ICP.t[0]+t[0], ICP.t[1]+t[1], ICP.t[2]+t[2]];

  /* compute RMSE on the (now updated) sample correspondences */
  const Pafter = sampleIdx.map(i => ICP.sourcePts[i]);
  const Qafter = Pafter.map(p => nearestNeighbour(p, ICP.targetPts));
  const rmse = computeRMSE(Pafter, Qafter);

  ICP.iteration++;
  ICP.rmseHistory.push(rmse);

  if (ICP.rmseHistory.length > 1) {
    const prev = ICP.rmseHistory[ICP.rmseHistory.length-2];
    if (Math.abs(rmse - prev) < SIM.eps || ICP.iteration >= ICP.maxIter) {
      ICP.converged = true;
      ICP.convergedAt = ICP.iteration;
    }
  }

  return rmse;
}

/* ──────────────────────────────────────────────────────────────
   THREE.JS SCENE — SETUP PAGE
────────────────────────────────────────────────────────────── */

let renderer, scene, camera, animFrame;
let sourceMesh, targetMesh, frameMesh, shapeMesh, dispLine;
let orbitTarget = new THREE.Vector3(0, 0, 0);
let isDragging = false, lastMouse = {x:0, y:0};
let phi = Math.PI/4, theta = Math.PI/4, radius = 3.0;
let currentView = 'iso';

let setupSourceRaw = [];
let setupTargetRaw = [];

function initThree() {
  const canvas = document.getElementById('three-canvas');
  const wrap   = canvas.parentElement;

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xe8edf5, 1);
  resizeRenderer();

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe8edf5, 6, 14);

  camera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 20);
  setViewISO();

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(3, 5, 3);
  scene.add(dirLight);

  const grid = new THREE.GridHelper(4, 16, 0xb8c4d4, 0xccd5e0);
  grid.material.opacity = 0.5; grid.material.transparent = true;
  scene.add(grid);

  setupTargetRaw = generateLShape(1800, 0);
  setupSourceRaw = generateLShape(1800, 0);

  buildPointCloudMesh('target');
  buildPointCloudMesh('source');
  buildFrameMesh();
  buildShapeOutline();
  buildDisplacementLine();

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

function setViewISO()   { phi = Math.PI/4;  theta = Math.PI/4;  radius = 3.0; }
function setViewTop()   { phi = 0;          theta = 0.01;       radius = 3.2; }
function setViewFront() { phi = 0;          theta = Math.PI/2;  radius = 3.0; }
function setViewSide()  { phi = Math.PI/2;  theta = Math.PI/2;  radius = 3.0; }

function setupOrbitControls(canvas) {
  canvas.addEventListener('mousedown', e => { isDragging = true; lastMouse = {x:e.clientX,y:e.clientY}; });
  window.addEventListener('mouseup', () => { isDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - lastMouse.x, dy = e.clientY - lastMouse.y;
    lastMouse = {x:e.clientX, y:e.clientY};
    if (e.buttons === 1) {
      phi -= dx*0.008; theta = Math.max(0.05, Math.min(Math.PI-0.05, theta+dy*0.008));
      document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
    } else if (e.buttons === 2) {
      orbitTarget.x -= dx*0.003; orbitTarget.y += dy*0.003;
    }
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); radius = Math.max(1.2, Math.min(7, radius+e.deltaY*0.004)); }, {passive:false});

  let lastTouch=null, lastTouchDist=0;
  canvas.addEventListener('touchstart', e => {
    if (e.touches.length===1){ isDragging=true; lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY}; }
    else if (e.touches.length===2){ lastTouchDist = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); }
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
      radius = Math.max(1.2, Math.min(7, radius*(lastTouchDist/dist))); lastTouchDist = dist;
    }
  }, {passive:false});
}

function buildPointCloudMesh(which) {
  const raw = which === 'source' ? setupSourceRaw : setupTargetRaw;
  const colour = which === 'source' ? 0x3b82f6 : 0xf59e0b;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(raw.length * 3);
  raw.forEach((p,i) => { positions[i*3]=p[0]; positions[i*3+1]=p[1]; positions[i*3+2]=p[2]; });
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.PointsMaterial({ color: colour, size: 0.012, sizeAttenuation: true });
  const mesh = new THREE.Points(geo, mat);
  mesh.visible = false;

  if (which === 'source') sourceMesh = mesh; else targetMesh = mesh;
  scene.add(mesh);
}

function buildFrameMesh() {
  frameMesh = new THREE.Group();
  const axes = [
    { dir:[1,0,0], color:0xdc2626 },
    { dir:[0,1,0], color:0x16a34a },
    { dir:[0,0,1], color:0x2563eb },
  ];
  axes.forEach(a => {
    const geo = new THREE.CylinderGeometry(0.006, 0.006, 0.5, 8);
    const mat = new THREE.MeshBasicMaterial({ color: a.color });
    const cyl = new THREE.Mesh(geo, mat);
    cyl.position.set(a.dir[0]*0.25, a.dir[1]*0.25, a.dir[2]*0.25);
    if (a.dir[0]) cyl.rotation.z = Math.PI/2;
    if (a.dir[2]) cyl.rotation.x = Math.PI/2;
    frameMesh.add(cyl);
  });
  frameMesh.visible = false;
  scene.add(frameMesh);
}

function buildShapeOutline() {
  /* faint reference outline of the true L-shape object being scanned */
  const pts = [
    [-0.3,-0.3,0],[0.3,-0.3,0],[0.3,-0.22,0],[-0.22,-0.22,0],[-0.22,0.3,0],[-0.3,0.3,0],[-0.3,-0.3,0]
  ].map(p => new THREE.Vector3(p[0],p[1],p[2]));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.5 });
  shapeMesh = new THREE.Line(geo, mat);
  shapeMesh.visible = false;
  scene.add(shapeMesh);
}

function buildDisplacementLine() {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,0)]);
  const mat = new THREE.LineDashedMaterial({ color: 0xef4444, dashSize: 0.03, gapSize: 0.02 });
  dispLine = new THREE.Line(geo, mat);
  dispLine.computeLineDistances();
  dispLine.visible = false;
  scene.add(dispLine);
}

function updateSourceTransformPreview() {
  if (!sourceMesh) return;
  const theta = degToRad(SETUP.rotDeg);
  sourceMesh.rotation.z = theta;
  sourceMesh.position.set(SETUP.trans*0.5, SETUP.trans*0.35, SETUP.trans*0.15);

  /* update displacement line between centroids */
  const srcCentroid = sourceMesh.position.clone();
  const tgtCentroid = new THREE.Vector3(0,0,0);
  dispLine.geometry.setFromPoints([srcCentroid, tgtCentroid]);
  dispLine.computeLineDistances();

  document.getElementById('obs-srcpts').textContent = '1,800';
  document.getElementById('obs-tgtpts').textContent = '1,800';
  document.getElementById('obs-overlap').textContent = SETUP.overlap + '%';

  const approxRmse = Math.sqrt(SETUP.trans*SETUP.trans + Math.pow(SETUP.rotDeg/60,2)*0.3) * 3;
  document.getElementById('obs-initrmse').textContent = approxRmse.toFixed(2);
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — STEP NAVIGATION
────────────────────────────────────────────────────────────── */

let currentSetupStep = 0;

function gotoSetupStep(n) {
  n = Math.max(0, Math.min(4, n));
  currentSetupStep = n;

  document.querySelectorAll('.step-content').forEach((el,i)=>el.classList.toggle('active', i===n));
  document.querySelectorAll('.sstep').forEach((el,i)=>{
    el.classList.remove('active','done');
    if (i===n) el.classList.add('active');
    if (i<n)  el.classList.add('done');
  });

  const badge = document.getElementById('step-badge');
  const title = document.getElementById('wizard-title');
  const text = document.getElementById('wizard-text');
  const task = document.getElementById('wizard-task');
  
  if (badge) badge.textContent = `STEP ${n + 1} OF 5`;
  
  const wizardSteps = [
      { title: "Mount Components", text: "Mount the source/target point clouds, coordinate frame, and reference object into the 3D workspace.", task: 'Select Component → Click <strong>Mount Component</strong> sequentially.' },
      { title: "Load the Two Scans", text: "Both point clouds are sampled from the same object. Review the color coding and point count before proceeding.", task: 'Review the cloud info and click <strong>Next</strong> to proceed.' },
      { title: "Introduce Misalignment", text: "Apply rotation and translation to the source cloud to simulate scan-to-scan misalignment.", task: 'Adjust the rotation and translation sliders, then click <strong>Next</strong>.' },
      { title: "Set Overlap Region", text: "Control what fraction of the two scans share surface area. Lower overlap makes ICP harder.", task: 'Set overlap %, click <strong>Confirm Config</strong>, then <strong>Next</strong>.' },
      { title: "Live Observations", text: "Review the initial configuration parameters before entering the simulation.", task: 'Review the readings. The <strong>Go To Simulation</strong> button will activate.' }
  ];
  
  if (wizardSteps[n]) {
      if (title) title.textContent = wizardSteps[n].title;
      if (text) text.textContent = wizardSteps[n].text;
      if (task) task.innerHTML = wizardSteps[n].task;
  }

  document.getElementById('obs-overlay').style.display = n===4 ? 'block':'none';
  dispLine.visible = n>=2 && MOUNTED.source && MOUNTED.target;

  if (n >= 4) {
    document.getElementById('btn-go-sim').disabled = false;
    computeAndDisplayResults();
  }
}

/* ──────────────────────────────────────────────────────────────
   COMPONENT MOUNTING
────────────────────────────────────────────────────────────── */

const MOUNT_SEQ = ['source', 'target', 'frame', 'shape'];

function mountComponent(name) {
  if (MOUNTED[name]) {
    alert("Component already mounted!");
    return;
  }
  
  const idx = MOUNT_SEQ.indexOf(name);
  if (idx > 0 && !MOUNTED[MOUNT_SEQ[idx-1]]) {
    alert("Please mount components in sequence!");
    return;
  }

  MOUNTED[name] = true;
  switch(name) {
    case 'source': sourceMesh.visible = true; break;
    case 'target': targetMesh.visible = true; break;
    case 'frame':  frameMesh.visible = true; break;
    case 'shape':  shapeMesh.visible = true; break;
  }
  const card = document.querySelector(`.apparatus-card[data-comp="${name}"]`);
  if (card) {
    card.classList.add('mounted');
    const status = card.querySelector('.apparatus-status');
    if (status) {
      status.textContent = 'Mounted ✓';
    }
  }

  if (idx < MOUNT_SEQ.length - 1) {
    document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
    const nextCard = document.querySelector(`.apparatus-card[data-comp="${MOUNT_SEQ[idx+1]}"]`);
    if (nextCard) nextCard.classList.add('selected');
  }

  const allMounted = Object.values(MOUNTED).every(Boolean);
  if (allMounted) {
    const nextBtn = document.getElementById('btn-next-sc0');
    if (nextBtn) nextBtn.disabled = false;
    if (currentSetupStep===0) setTimeout(()=>gotoSetupStep(1), 600);
  }
}

function mountAll() { Object.keys(MOUNTED).forEach(mountComponent); }

/* ──────────────────────────────────────────────────────────────
   SETUP STEP 3 — CONFIRM CONFIG / STEP 4 RESULTS
────────────────────────────────────────────────────────────── */

function confirmConfiguration() {
  document.getElementById('btn-next-obs').disabled = false;
}

function computeAndDisplayResults() {
  const rotDeg = SETUP.rotDeg, trans = SETUP.trans, overlap = SETUP.overlap;
  const approxCorr = Math.round(1800 * (overlap/100));
  const approxRmse = Math.sqrt(trans*trans + Math.pow(rotDeg/60,2)*0.3) * 3;

  document.getElementById('r-rot').textContent     = rotDeg;
  document.getElementById('r-trans').textContent   = trans.toFixed(2);
  document.getElementById('r-overlap').textContent = overlap;
  document.getElementById('r-corr').textContent    = approxCorr.toLocaleString('en-IN');
  document.getElementById('r-rmse').textContent    = approxRmse.toFixed(2);
}

/* ──────────────────────────────────────────────────────────────
   PAGE SWITCHING
────────────────────────────────────────────────────────────── */

function showSimulation() {
  document.getElementById('page-setup').classList.remove('active');
  document.getElementById('page-sim').classList.add('active');
  cancelAnimationFrame(animFrame);

  /* carry setup parameters into simulation defaults */
  SIM.rotDeg = SETUP.rotDeg;
  SIM.overlap = SETUP.overlap;
  document.getElementById('r-rotS').value = SIM.rotDeg;
  document.getElementById('pv-rot').textContent = SIM.rotDeg + '°';
  document.getElementById('r-overlapS').value = SIM.overlap;
  document.getElementById('pv-overlap').textContent = SIM.overlap + '%';

  initSimulation();

  if (window.MathJax && MathJax.typesetPromise) {
    const formulaCard = document.querySelector('.formula-card-sm');
    if (formulaCard) MathJax.typesetPromise([formulaCard]);
  }
}

function showSetup() {
  document.getElementById('page-sim').classList.remove('active');
  document.getElementById('page-setup').classList.add('active');
  animateThree();
}

/* ──────────────────────────────────────────────────────────────
   ICP RESET / INITIALISATION FOR SIMULATION
────────────────────────────────────────────────────────────── */

function resetICPState() {
  const N = 600; /* working point count for performance */
  const targetRaw = generateShape(SIM.shapeIdx, N, SIM.noise);
  let sourceRaw   = generateShape(SIM.shapeIdx, N, SIM.noise);

  sourceRaw = applyOverlapMask(sourceRaw, SIM.overlap);
  const targetMasked = applyOverlapMask(targetRaw, Math.min(100, SIM.overlap + 25));

  const transformedSource = transformPoints(sourceRaw, SIM.rotDeg, 0.35);

  ICP.targetPts = targetMasked;
  ICP.sourcePts = transformedSource.map(p => [...p]);
  ICP.origSourcePts = transformedSource.map(p => [...p]);
  ICP.R = [[1,0,0],[0,1,0],[0,0,1]];
  ICP.t = [0,0,0];
  ICP.iteration = 0;
  ICP.rmseHistory = [];
  ICP.converged = false;
  ICP.convergedAt = null;

  /* compute and record initial RMSE before any iteration */
  const sampleIdx = ICP.sourcePts.map((_,i)=>i).slice(0, Math.min(150, ICP.sourcePts.length));
  const P0 = sampleIdx.map(i => ICP.sourcePts[i]);
  const Q0 = P0.map(p => nearestNeighbour(p, ICP.targetPts));
  ICP.rmseHistory.push(computeRMSE(P0, Q0));
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION CANVAS RENDERERS
────────────────────────────────────────────────────────────── */

let overlayRotY = 0.6, overlayRotX = -0.3;
let overlayScale = 1.0, overlayPanX = 0, overlayPanY = 0;
let overlayDragging = false, overlayLastMouse = {x:0,y:0}, overlayBtn = 0;

function project3D(p, rotY, rotX, scale, W, H) {
  const cosY=Math.cos(rotY), sinY=Math.sin(rotY);
  const cosX=Math.cos(rotX), sinX=Math.sin(rotX);
  let x1 = p[0]*cosY + p[2]*sinY;
  let z1 = -p[0]*sinY + p[2]*cosY;
  let y1 = p[1]*cosX - z1*sinX;
  let z2 = p[1]*sinX + z1*cosX;
  const s = scale * overlayScale;
  return { x: W/2 + x1*s + overlayPanX, y: H/2 - y1*s + overlayPanY, depth: z2 };
}

function renderOverlay(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth||canvas.width, H = canvas.offsetHeight||canvas.height;
  if (canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,W,H);

  const scale = 280;
  const allPts = [];
  ICP.targetPts.forEach(p => allPts.push({p, col:'#ea580c'}));
  ICP.sourcePts.forEach(p => allPts.push({p, col:'#3b82f6'}));

  const projected = allPts.map(o => ({...project3D(o.p, overlayRotY, overlayRotX, scale, W, H), col:o.col}));
  projected.sort((a,b)=>b.depth-a.depth);

  projected.forEach(pt => {
    ctx.fillStyle = pt.col;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.4, 0, Math.PI*2); ctx.fill();
  });

  ctx.fillStyle = '#64748b'; ctx.font = 'bold 9px JetBrains Mono';
  ctx.fillText(`iter ${ICP.iteration}  |  RMSE ${ICP.rmseHistory[ICP.rmseHistory.length-1]?.toFixed(3) ?? '—'}`, 8, H-8);
}

function setupOverlayDrag(canvas) {
  canvas.addEventListener('mousedown', e=>{
    overlayDragging=true; overlayBtn=e.button; overlayLastMouse={x:e.clientX,y:e.clientY};
  });
  window.addEventListener('mouseup', ()=>{overlayDragging=false;});
  window.addEventListener('mousemove', e=>{
    if(!overlayDragging) return;
    const dx=e.clientX-overlayLastMouse.x, dy=e.clientY-overlayLastMouse.y;
    overlayLastMouse={x:e.clientX,y:e.clientY};
    if (overlayBtn === 0) {
      overlayRotY += dx*0.01; overlayRotX = Math.max(-1.4, Math.min(1.4, overlayRotX+dy*0.01));
    } else {
      overlayPanX += dx; overlayPanY += dy;
    }
    renderAllSimCanvases();
  });
  canvas.addEventListener('wheel', e=>{
    e.preventDefault();
    overlayScale *= (e.deltaY > 0 ? 0.9 : 1.1);
    overlayScale = Math.max(0.2, Math.min(5.0, overlayScale));
    renderAllSimCanvases();
  }, {passive:false});
  canvas.addEventListener('contextmenu', e=>e.preventDefault());
  
  let lastTouch=null;
  canvas.addEventListener('touchstart', e=>{
    if(e.touches.length===1) lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY};
  });
  canvas.addEventListener('touchmove', e=>{
    e.preventDefault();
    if(e.touches.length===1 && lastTouch) {
      const dx=e.touches[0].clientX-lastTouch.x, dy=e.touches[0].clientY-lastTouch.y;
      lastTouch={x:e.touches[0].clientX,y:e.touches[0].clientY};
      overlayRotY += dx*0.012; overlayRotX = Math.max(-1.4, Math.min(1.4, overlayRotX+dy*0.012));
      renderAllSimCanvases();
    }
  }, {passive:false});
}

function renderRMSEGraph(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth||canvas.width, H = canvas.offsetHeight||canvas.height;
  if (canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,W,H);

  const padL=36, padR=10, padT=14, padB=26;
  const gW=W-padL-padR, gH=H-padT-padB;

  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){
    const y = padT+gH-(i/4)*gH;
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(padL+gW,y); ctx.stroke();
  }
  ctx.fillStyle='#64748b'; ctx.font='10px DM Sans'; ctx.textAlign='center';
  ctx.fillText('Iteration', padL+gW/2, H-4);

  if (ICP.rmseHistory.length < 2) { ctx.textAlign='left'; return; }

  const maxRmse = Math.max(...ICP.rmseHistory, 0.01);
  ctx.strokeStyle='#2563eb'; ctx.lineWidth=2; ctx.beginPath();
  ICP.rmseHistory.forEach((r,i)=>{
    const x = padL + (i/(Math.max(ICP.rmseHistory.length-1,1))) * gW;
    const y = padT + gH - (r/maxRmse)*gH;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  /* current point marker */
  const lastIdx = ICP.rmseHistory.length-1;
  const lastX = padL + (lastIdx/(Math.max(ICP.rmseHistory.length-1,1)))*gW;
  const lastY = padT + gH - (ICP.rmseHistory[lastIdx]/maxRmse)*gH;
  ctx.fillStyle = ICP.converged ? '#22c55e' : '#2563eb';
  ctx.beginPath(); ctx.arc(lastX,lastY,4,0,Math.PI*2); ctx.fill();

  if (ICP.converged) {
    ctx.fillStyle='#16a34a'; ctx.font='bold 9px DM Sans'; ctx.textAlign='left';
    ctx.fillText(`Converged at iter ${ICP.convergedAt}`, Math.min(lastX+6,W-110), lastY-6);
  }
  ctx.textAlign='left';
}

function renderCorrespondences(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth||canvas.width, H = canvas.offsetHeight||canvas.height;
  if (canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,W,H);

  const scale = 280;
  
  ctx.fillStyle = '#cbd5e1';
  ICP.targetPts.forEach(p => {
    const pt = project3D(p, overlayRotY, overlayRotX, scale, W, H);
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.0, 0, Math.PI*2); ctx.fill();
  });
  ICP.sourcePts.forEach(p => {
    const pt = project3D(p, overlayRotY, overlayRotX, scale, W, H);
    ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.0, 0, Math.PI*2); ctx.fill();
  });

  const sampleCount = Math.min(40, ICP.sourcePts.length);
  const idxs = [];
  for (let i=0;i<sampleCount;i++) idxs.push(Math.floor(i*ICP.sourcePts.length/sampleCount));

  idxs.forEach(i => {
    const p = ICP.sourcePts[i];
    const q = nearestNeighbour(p, ICP.targetPts);
    const pp = project3D(p, overlayRotY, overlayRotX, scale, W, H);
    const pq = project3D(q, overlayRotY, overlayRotX, scale, W, H);

    ctx.strokeStyle = 'rgba(15,23,42,0.15)';
    ctx.lineWidth = 1.0;
    ctx.beginPath(); ctx.moveTo(pp.x,pp.y); ctx.lineTo(pq.x,pq.y); ctx.stroke();

    ctx.fillStyle = '#3b82f6';
    ctx.beginPath(); ctx.arc(pp.x,pp.y,2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ea580c';
    ctx.beginPath(); ctx.arc(pq.x,pq.y,2,0,Math.PI*2); ctx.fill();
  });

  ctx.fillStyle = '#64748b'; ctx.font = 'bold 9px JetBrains Mono';
  ctx.fillText(`${sampleCount} correspondence pairs shown`, 8, H-8);
}

function renderBeforeAfter(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth||canvas.width, H = canvas.offsetHeight||canvas.height;
  if (canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0,0,W,H);

  const halfW = W/2;
  const scale = 110;
  const drawCloud = (pts, offsetX, colour) => {
    pts.forEach(p => {
      const proj = project3D(p, overlayRotY, overlayRotX, scale, halfW, H);
      ctx.fillStyle = colour;
      ctx.beginPath(); ctx.arc(proj.x+offsetX, proj.y, 1.2, 0, Math.PI*2); ctx.fill();
    });
  };

  const getCentroid = (pts) => {
    let x=0,y=0,z=0;
    pts.forEach(p=>{x+=p[0];y+=p[1];z+=p[2];});
    const n = pts.length||1;
    return [x/n,y/n,z/n];
  };

  const drawOffset = (ptsA, ptsB, offsetX, label) => {
    const cA = getCentroid(ptsA);
    const cB = getCentroid(ptsB);
    const pA = project3D(cA, overlayRotY, overlayRotX, scale, halfW, H);
    const pB = project3D(cB, overlayRotY, overlayRotX, scale, halfW, H);

    ctx.strokeStyle = '#334155'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(pA.x+offsetX, pA.y); ctx.lineTo(pB.x+offsetX, pB.y); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ea580c'; ctx.beginPath(); ctx.arc(pA.x+offsetX, pA.y, 3.5, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#3b82f6'; ctx.beginPath(); ctx.arc(pB.x+offsetX, pB.y, 3.5, 0, Math.PI*2); ctx.fill();
    
    ctx.fillStyle = '#0f172a'; ctx.font = '9px JetBrains Mono'; ctx.textAlign = 'left';
    ctx.fillText(label, (pA.x+pB.x)/2 + offsetX + 5, (pA.y+pB.y)/2 - 5);
  };

  /* sample subset for speed, but use more points now (e.g. 600) so shape is clear */
  const sample = (arr, n) => { const out=[]; for(let i=0;i<n;i++) out.push(arr[Math.floor(i*arr.length/n)]); return out; };
  const targetSample = sample(ICP.targetPts, 600);
  const origSourceSample = sample(ICP.origSourcePts, 600);
  const curSourceSample = sample(ICP.sourcePts, 600);

  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, halfW, H); ctx.clip();
  drawCloud(targetSample, 0, '#ea580c');
  drawCloud(origSourceSample, 0, '#3b82f6');
  drawOffset(ICP.targetPts, ICP.origSourcePts, 0, 'Initial Offset');
  ctx.restore();

  ctx.save();
  ctx.beginPath(); ctx.rect(halfW, 0, halfW, H); ctx.clip();
  drawCloud(targetSample, halfW, '#ea580c');
  drawCloud(curSourceSample, halfW, '#3b82f6');
  drawOffset(ICP.targetPts, ICP.sourcePts, halfW, 'Current Offset');
  ctx.restore();

  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(halfW,0); ctx.lineTo(halfW,H); ctx.stroke();

  ctx.fillStyle = '#64748b'; ctx.font = 'bold 10px DM Sans'; ctx.textAlign='center';
  ctx.fillText('BEFORE', halfW/2, 14);
  ctx.fillText('NOW', halfW + halfW/2, 14);

  ctx.textAlign='left';
}

function renderGauge(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const lastRmse = ICP.rmseHistory[ICP.rmseHistory.length-1] ?? 1;
  const quality = Math.max(0, Math.min(100, 100 - lastRmse*60));

  const cx=W/2, cy=H-8, r=H-16;
  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=10; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,2*Math.PI); ctx.stroke();

  const sweepA = Math.PI + (quality/100)*Math.PI;
  const colour = ICP.converged ? (quality>70?'#22c55e':'#f59e0b') : '#3b82f6';
  ctx.strokeStyle=colour; ctx.lineWidth=10;
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,sweepA); ctx.stroke();

  ctx.strokeStyle='#334155'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx,cy);
  ctx.lineTo(cx+(r-4)*Math.cos(sweepA), cy+(r-4)*Math.sin(sweepA)); ctx.stroke();
  ctx.fillStyle='#334155'; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();

  document.getElementById('quality-label').textContent =
    ICP.converged ? (quality>70 ? `${quality.toFixed(0)}% — Converged well` : `${quality.toFixed(0)}% — Converged (check overlay)`)
                  : `${quality.toFixed(0)}% — Running`;
  document.getElementById('quality-label').style.color = colour;
  document.getElementById('quality-sub').textContent =
    ICP.converged ? 'Inspect 3D overlay to confirm correctness' : 'Iterating toward alignment';
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION — MAIN UPDATE
────────────────────────────────────────────────────────────── */

function updateReadouts() {
  const lastRmse = ICP.rmseHistory[ICP.rmseHistory.length-1];
  const prevRmse  = ICP.rmseHistory[ICP.rmseHistory.length-2];

  document.getElementById('ro-iter').textContent = ICP.iteration;
  document.getElementById('ro-rmse').textContent = lastRmse!==undefined ? lastRmse.toFixed(3) : '—';
  document.getElementById('ro-drmse').textContent = (prevRmse!==undefined && lastRmse!==undefined) ? (lastRmse-prevRmse).toFixed(4) : '—';
  document.getElementById('ro-status').textContent = ICP.converged ? 'Converged' : (ICP.iteration>0 ? 'Iterating' : 'Idle');

  /* R matrix display in LaTeX */
  const R = ICP.R;
  const latexStr = `\\( \\begin{bmatrix} ${R[0][0].toFixed(2)} & ${R[0][1].toFixed(2)} & ${R[0][2].toFixed(2)} \\\\ ${R[1][0].toFixed(2)} & ${R[1][1].toFixed(2)} & ${R[1][2].toFixed(2)} \\\\ ${R[2][0].toFixed(2)} & ${R[2][1].toFixed(2)} & ${R[2][2].toFixed(2)} \\end{bmatrix} \\)`;
  
  const container = document.getElementById('km-latex-container');
  if (container) {
    container.innerHTML = latexStr;
    if (window.MathJax && MathJax.typesetPromise) {
      MathJax.typesetPromise([container]);
    }
  }

  document.getElementById('dc-tx').textContent = ICP.t[0].toFixed(3);
  document.getElementById('dc-ty').textContent = ICP.t[1].toFixed(3);
  document.getElementById('dc-tz').textContent = ICP.t[2].toFixed(3);
  document.getElementById('dc-tmag').textContent = Math.sqrt(ICP.t[0]**2+ICP.t[1]**2+ICP.t[2]**2).toFixed(3);

  document.getElementById('bb-conviter').textContent = ICP.convergedAt ?? '—';
  document.getElementById('bb-finalrmse').textContent = ICP.converged ? lastRmse.toFixed(3) : '—';

  const riskLevel = SIM.rotDeg > 45 || SIM.overlap < 35 || SIM.shapeIdx > 0 ? 'Elevated' : 'Low';
  const riskEl = document.getElementById('bb-risk');
  riskEl.textContent = riskLevel;
  riskEl.style.color = riskLevel === 'Elevated' ? '#dc2626' : '#16a34a';
}

function renderAllSimCanvases() {
  renderOverlay(document.getElementById('cvs-overlay'));
  renderRMSEGraph(document.getElementById('cvs-rmsegraph'));
  renderCorrespondences(document.getElementById('cvs-corr'));
  renderBeforeAfter(document.getElementById('cvs-before-after'));
  renderGauge(document.getElementById('gauge-canvas'));
  updateReadouts();
}

function runOneIteration() {
  if (ICP.converged) return;
  icpStep();
  renderAllSimCanvases();
}

function runToConvergence() {
  let safety = 0;
  while (!ICP.converged && safety < ICP.maxIter) {
    icpStep();
    safety++;
  }
  renderAllSimCanvases();
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
  resetICPState();
  updateSimWizard();
  renderAllSimCanvases();
  setupOverlayDrag(document.getElementById('cvs-overlay'));
  setupOverlayDrag(document.getElementById('cvs-corr'));
  setupOverlayDrag(document.getElementById('cvs-before-after'));

  document.getElementById('r-rotS').addEventListener('input', e=>{
    SIM.rotDeg = parseFloat(e.target.value);
    document.getElementById('pv-rot').textContent = SIM.rotDeg+'°';
    resetICPState(); renderAllSimCanvases();
  });
  document.getElementById('r-overlapS').addEventListener('input', e=>{
    SIM.overlap = parseFloat(e.target.value);
    document.getElementById('pv-overlap').textContent = SIM.overlap+'%';
    resetICPState(); renderAllSimCanvases();
  });
  document.getElementById('r-eps').addEventListener('input', e=>{
    SIM.eps = parseFloat(e.target.value);
    document.getElementById('pv-eps').textContent = SIM.eps.toFixed(3);
  });
  document.getElementById('r-noise').addEventListener('input', e=>{
    SIM.noise = parseFloat(e.target.value);
    document.getElementById('pv-noise').textContent = SIM.noise.toFixed(1)+' mm';
    resetICPState(); renderAllSimCanvases();
  });
  document.getElementById('r-shape').addEventListener('input', e=>{
    SIM.shapeIdx = parseInt(e.target.value);
    resetICPState(); renderAllSimCanvases();
  });

  document.getElementById('btn-step').addEventListener('click', runOneIteration);
  document.getElementById('btn-run').addEventListener('click', runToConvergence);

  document.getElementById('wiz-next').addEventListener('click', ()=>{ SIM.step=Math.min(SIM.step+1,SIM_WIZARD.length-1); updateSimWizard(); });
  document.getElementById('wiz-skip').addEventListener('click', ()=>{ SIM.step=SIM_WIZARD.length-1; updateSimWizard(); });
  document.querySelectorAll('.wdot').forEach(d=>d.addEventListener('click', ()=>{ SIM.step=parseInt(d.dataset.ws); updateSimWizard(); }));

  ['btn-sim-reset','btn-sim-reset2'].forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', resetSimulationFull);
  });
  const ro = new ResizeObserver(()=>renderAllSimCanvases());
  document.querySelectorAll('.sim-card').forEach(c=>ro.observe(c));
}

function resetSimulationFull() {
  SIM.rotDeg=20; SIM.overlap=65; SIM.eps=0.005; SIM.noise=0; SIM.shapeIdx=0; SIM.step=0;

  document.getElementById('r-rotS').value=20;
  document.getElementById('r-overlapS').value=65;
  document.getElementById('r-eps').value=0.005;
  document.getElementById('r-noise').value=0;
  document.getElementById('r-shape').value=0;

  document.getElementById('pv-rot').textContent='20°';
  document.getElementById('pv-overlap').textContent='65%';
  document.getElementById('pv-eps').textContent='0.005';
  document.getElementById('pv-noise').textContent='0 mm';

  overlayRotY=0.6; overlayRotX=-0.3;

  resetICPState();
  updateSimWizard();
  renderAllSimCanvases();
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — RESET
────────────────────────────────────────────────────────────── */

function resetSetup() {
  Object.keys(MOUNTED).forEach(k=>MOUNTED[k]=false);
  if(sourceMesh) sourceMesh.visible=false;
  if(targetMesh) targetMesh.visible=false;
  if(frameMesh)  frameMesh.visible=false;
  if(shapeMesh)  shapeMesh.visible=false;
  if(dispLine)   dispLine.visible=false;

  document.querySelectorAll('.apparatus-card').forEach(c => {
    c.classList.remove('mounted');
    c.classList.remove('selected');
    const status = c.querySelector('.apparatus-status');
    if (status) status.textContent = 'Pending';
  });
  const firstCard = document.querySelector('.apparatus-card[data-comp="source"]');
  if (firstCard) firstCard.classList.add('selected');

  SETUP.rotDeg=20; SETUP.trans=0.3; SETUP.overlap=65;
  document.getElementById('sr-rot').value=20;
  document.getElementById('sr-trans').value=0.3;
  document.getElementById('sr-overlap').value=65;
  document.getElementById('sv-rot').textContent='20°';
  document.getElementById('sv-trans').textContent='0.3 m';
  document.getElementById('sv-overlap').textContent='65%';
  const overlapDisplay = document.getElementById('overlap-display');
  if (overlapDisplay) overlapDisplay.textContent='65%';
  document.getElementById('btn-next-obs').disabled = true;

  document.querySelectorAll('.setup-range').forEach(updateSliderFill);

  document.getElementById('btn-go-sim').disabled = true;
  gotoSetupStep(0);
}

function updateSliderFill(el) {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const val = parseFloat(el.value) || 0;
  let pct = ((val - min) / (max - min)) * 100;
  pct = Math.max(0, Math.min(100, pct));
  el.style.background = `linear-gradient(to right, var(--blue) ${pct}%, transparent ${pct}%)`;
}

/* ──────────────────────────────────────────────────────────────
   INIT
────────────────────────────────────────────────────────────── */

function init() {
  initThree();

  document.querySelectorAll('.apparatus-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  const btnMount = document.getElementById('btn-mount');
  if (btnMount) {
    btnMount.addEventListener('click', () => {
      const selected = document.querySelector('.apparatus-card.selected');
      if (selected) {
        mountComponent(selected.dataset.comp);
      }
    });
  }
  const btnMountAll = document.getElementById('mount-all-btn');
  if (btnMountAll) btnMountAll.addEventListener('click', mountAll);

  document.querySelectorAll('[data-next]').forEach(btn=>{
    btn.addEventListener('click', ()=>gotoSetupStep(parseInt(btn.dataset.next)));
  });
  document.querySelectorAll('[data-prev]').forEach(btn=>{
    btn.addEventListener('click', ()=>gotoSetupStep(parseInt(btn.dataset.prev)));
  });
  document.querySelectorAll('.sstep').forEach(el=>{
    el.addEventListener('click', ()=>gotoSetupStep(parseInt(el.dataset.s)));
  });

  document.getElementById('sr-rot').addEventListener('input', e=>{
    SETUP.rotDeg = parseFloat(e.target.value);
    document.getElementById('sv-rot').textContent = SETUP.rotDeg+'°';
    updateSourceTransformPreview();
  });
  document.getElementById('sr-trans').addEventListener('input', e=>{
    SETUP.trans = parseFloat(e.target.value);
    document.getElementById('sv-trans').textContent = SETUP.trans.toFixed(2)+' m';
    updateSourceTransformPreview();
  });
  document.getElementById('sr-overlap').addEventListener('input', e=>{
    SETUP.overlap = parseFloat(e.target.value);
    document.getElementById('sv-overlap').textContent = SETUP.overlap+'%';
    document.getElementById('overlap-display').textContent = SETUP.overlap+'%';
    document.getElementById('overlap-fill').style.width = SETUP.overlap+'%';
    updateSourceTransformPreview();
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

  document.getElementById('btn-go-sim').addEventListener('click', showSimulation);
  const btnLaunch = document.getElementById('btn-launch-sim');
  if (btnLaunch) btnLaunch.addEventListener('click', showSimulation);
  document.getElementById('btn-back-setup')?.addEventListener('click', showSetup);
  document.getElementById('btn-reset-setup').addEventListener('click', resetSetup);

  document.getElementById('three-canvas').addEventListener('contextmenu', e=>e.preventDefault());
  
  // Attach fill update and initialize only setup range inputs globally
  document.querySelectorAll('.setup-range').forEach(el => {
    el.addEventListener('input', () => updateSliderFill(el));
    updateSliderFill(el);
  });
}

window.addEventListener('load', init);
