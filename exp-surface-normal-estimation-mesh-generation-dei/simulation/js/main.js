/* ================================================================
   EXPERIMENT 7 — SURFACE NORMAL ESTIMATION & MESH GENERATION
   main.js — Three.js 3D setup scene + real PCA-based normal estimation
   ================================================================ */

'use strict';
/* global THREE */

/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */
const MOUNTED = { cloud: false, knn: false, pca: false, mesh: false };
const COMP_SEQ = ['cloud', 'knn', 'pca', 'mesh'];
let mountSeqIndex = 0;

const SETUP = { k: 10 };

const SIM = {
  k:        10,
  noise:    2,      /* mm */
  surfIdx:  0,      /* 0=bumpy 1=Lshape 2=sphere */
  orient:   0,      /* 0=viewpoint 1=raw ambiguous */
  maxEdge:  0.05,   /* metres */
  step:     0,
};

const WIZ = [
  {
    title: 'Grow the Neighbourhood',
    text:  'Each point collects its k nearest neighbours to build a local covariance matrix. Watch the hedgehog spikes stabilise as k increases from a noisy start.',
    task:  '▶ Drag k from 4 to 25 and watch the normal spikes become smoother.',
    lit:   'pg-k',
  },
  {
    title: 'Push Past the Noise Floor',
    text:  'Increasing σ adds random displacement to every point. λ₀ (the minimum eigenvalue) grows even on flat regions, inflating estimated curvature κ.',
    task:  '▶ Set noise to 10mm and watch the curvature map turn from blue to red.',
    lit:   'pg-noise',
  },
  {
    title: 'Break an Edge',
    text:  'Switch to the L-Shape surface. The concave corner mixes two surface orientations in one neighbourhood, producing wrong or randomly-directed normals.',
    task:  '▶ Set Surface Shape to L-Shape and inspect the corner in the hedgehog view.',
    lit:   'pg-surface',
  },
  {
    title: 'See the Sign Ambiguity',
    text:  'PCA gives a normal direction but not a sign. Switch to Raw orientation mode and watch some normals flip inward — exactly the rendering problem viewpoint correction solves.',
    task:  '▶ Set Normal Orientation to Raw and look for inward-pointing spikes.',
    lit:   'pg-orient',
  },
];

/* ──────────────────────────────────────────────────────────────
   MATH — VECTORS / 3×3 MATRICES
────────────────────────────────────────────────────────────── */
function gauss() {
  const u1 = Math.max(1e-12, Math.random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
}
function vSub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function vAdd(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function vScale(a, s){ return [a[0]*s, a[1]*s, a[2]*s]; }
function vDot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function vLen(a)    { return Math.sqrt(vDot(a,a)); }
function vNorm(a)   { const l = vLen(a) || 1e-9; return vScale(a, 1/l); }

/* Jacobi eigendecomposition for symmetric 3×3 matrices */
function jacobiEigen3(Cin) {
  let A = [[Cin[0][0],Cin[0][1],Cin[0][2]],[Cin[1][0],Cin[1][1],Cin[1][2]],[Cin[2][0],Cin[2][1],Cin[2][2]]];
  let V = [[1,0,0],[0,1,0],[0,0,1]];

  const matMul = (X,Y) => {
    const R=[[0,0,0],[0,0,0],[0,0,0]];
    for(let i=0;i<3;i++) for(let j=0;j<3;j++) for(let k=0;k<3;k++) R[i][j]+=X[i][k]*Y[k][j];
    return R;
  };
  const matT = X => [[X[0][0],X[1][0],X[2][0]],[X[0][1],X[1][1],X[2][1]],[X[0][2],X[1][2],X[2][2]]];

  for (let sweep=0; sweep<50; sweep++) {
    let p=0,q=1,maxVal=Math.abs(A[0][1]);
    if (Math.abs(A[0][2])>maxVal){maxVal=Math.abs(A[0][2]);p=0;q=2;}
    if (Math.abs(A[1][2])>maxVal){maxVal=Math.abs(A[1][2]);p=1;q=2;}
    if (maxVal<1e-12) break;

    const app=A[p][p], aqq=A[q][q], apq=A[p][q];
    const phi=0.5*Math.atan2(2*apq, aqq-app);
    const c=Math.cos(phi), s=Math.sin(phi);
    const J=[[1,0,0],[0,1,0],[0,0,1]];
    J[p][p]=c; J[q][q]=c; J[p][q]=-s; J[q][p]=s;
    A = matMul(matMul(matT(J), A), J);
    V = matMul(V, J);
  }

  const values = [A[0][0], A[1][1], A[2][2]];
  const vectors = [
    [V[0][0],V[1][0],V[2][0]],
    [V[0][1],V[1][1],V[2][1]],
    [V[0][2],V[1][2],V[2][2]],
  ];
  /* sort ascending by eigenvalue */
  const order = [0,1,2].sort((a,b)=>values[a]-values[b]);
  return {
    values: order.map(i=>values[i]),
    vectors: order.map(i=>vectors[i]),
  };
}

/* ──────────────────────────────────────────────────────────────
   SURFACE GENERATORS
────────────────────────────────────────────────────────────── */
function surfaceHeight(x, y, surfIdx) {
  if (surfIdx === 0) {
    /* bumpy sculptural surface */
    return 0.04*Math.sin(6*x)*Math.cos(5*y) + 0.02*Math.sin(11*x+2*y);
  }
  if (surfIdx === 1) {
    /* L-shape: flat plateau with a step */
    if (x < 0.5) return 0.06;
    return 0.0;
  }
  return 0;
}

function generatePoints(surfIdx, n, noiseMm) {
  const noise = noiseMm / 1000;
  const pts = [];
  if (surfIdx === 2) {
    /* sphere sampling */
    const R = 0.28;
    for (let i=0;i<n;i++) {
      const u = Math.random()*2-1;
      const phi = Math.random()*Math.PI*2;
      const r = Math.sqrt(1-u*u);
      const x = R*r*Math.cos(phi), y = R*r*Math.sin(phi), z = R*u;
      pts.push([x+gauss()*noise, y+gauss()*noise, z+gauss()*noise]);
    }
    return pts;
  }
  for (let i=0;i<n;i++) {
    const x = Math.random(), y = Math.random();
    const z = surfaceHeight(x, y, surfIdx);
    pts.push([
      (x-0.5)*0.5 + gauss()*noise,
      (y-0.5)*0.3 + gauss()*noise,
      z + gauss()*noise,
    ]);
  }
  return pts;
}

/* ──────────────────────────────────────────────────────────────
   kNN SEARCH
────────────────────────────────────────────────────────────── */
function kNearest(pts, idx, k) {
  const p0 = pts[idx];
  const dists = [];
  for (let i=0;i<pts.length;i++) {
    if (i===idx) continue;
    const d = vLen(vSub(pts[i], p0));
    dists.push([d, i]);
  }
  dists.sort((a,b)=>a[0]-b[0]);
  return dists.slice(0, k).map(d=>d[1]);
}

/* ──────────────────────────────────────────────────────────────
   PCA NORMAL ESTIMATION
────────────────────────────────────────────────────────────── */
function estimateNormal(pts, idx, k, viewpoint, orientMode) {
  const neighIdx = kNearest(pts, idx, k);
  const neigh = neighIdx.map(i=>pts[i]);
  neigh.push(pts[idx]);

  const centroid = neigh.reduce((acc,p)=>vAdd(acc,p), [0,0,0]).map(v=>v/neigh.length);

  let C = [[0,0,0],[0,0,0],[0,0,0]];
  neigh.forEach(p => {
    const d = vSub(p, centroid);
    for (let r=0;r<3;r++) for (let c=0;c<3;c++) C[r][c] += d[r]*d[c];
  });
  for (let r=0;r<3;r++) for (let c=0;c<3;c++) C[r][c] /= neigh.length;

  const eig = jacobiEigen3(C);
  let n = eig.vectors[0];
  n = vNorm(n);

  if (orientMode === 0) {
    const toView = vSub(viewpoint, pts[idx]);
    if (vDot(n, toView) < 0) n = vScale(n, -1);
  } else {
    if (Math.random() < 0.4) n = vScale(n, -1);
  }

  const lambda0 = eig.values[0], lambda1 = eig.values[1], lambda2 = eig.values[2];
  const kappa = (lambda0+lambda1+lambda2) > 1e-12 ? lambda0/(lambda0+lambda1+lambda2) : 0;

  return { normal: n, kappa, lambda: [lambda0, lambda1, lambda2] };
}

/* ──────────────────────────────────────────────────────────────
   GREEDY TRIANGULATION
────────────────────────────────────────────────────────────── */
function greedyTriangulate(pts, normals, k, maxEdge) {
  const tris = [];
  const N = pts.length;
  const sampleCount = Math.min(N, 500);
  const step = Math.max(1, Math.floor(N / sampleCount));

  for (let i=0; i<N; i+=step) {
    const neighIdx = kNearest(pts, i, Math.min(8, k));
    for (let a=0; a<neighIdx.length; a++) {
      for (let b=a+1; b<neighIdx.length; b++) {
        const ia = neighIdx[a], ib = neighIdx[b];
        const e1 = vLen(vSub(pts[i], pts[ia]));
        const e2 = vLen(vSub(pts[i], pts[ib]));
        const e3 = vLen(vSub(pts[ia], pts[ib]));
        if (e1 > maxEdge || e2 > maxEdge || e3 > maxEdge) continue;

        const angles = triangleAngles(pts[i], pts[ia], pts[ib]);
        const minAngle = Math.min(...angles);
        if (minAngle < 8 * Math.PI/180) continue;

        tris.push({ a:i, b:ia, c:ib, minAngle: minAngle*180/Math.PI });
        if (tris.length > 900) return tris;
      }
    }
  }
  return tris;
}

function triangleAngles(A,B,C) {
  const ab = vLen(vSub(B,A)), bc = vLen(vSub(C,B)), ca = vLen(vSub(A,C));
  const angA = Math.acos(clamp((ab*ab+ca*ca-bc*bc)/(2*ab*ca), -1, 1));
  const angB = Math.acos(clamp((ab*ab+bc*bc-ca*ca)/(2*ab*bc), -1, 1));
  const angC = Math.PI - angA - angB;
  return [angA, angB, angC];
}
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

/* ──────────────────────────────────────────────────────────────
   THREE.JS — SETUP SCENE
────────────────────────────────────────────────────────────── */
let renderer, scene, camera3d, animFrame;
let cloudPoints, knnSphere, highlightPoint, pcaArrowGroup, meshLines;
let phi3d = Math.PI/4, theta3d = Math.PI/4, radius3d = 1.6;
let isDragging = false, lastMouse = {x:0,y:0};
let orbitTarget = new THREE.Vector3(0,0,0);

let setupCloud = [];

function initThree() {
  const canvas = document.getElementById('three-canvas');
  const wrap = canvas.parentElement;

  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setClearColor(0xe8edf5,1);
  resizeRenderer();

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe8edf5, 2.2, 6);

  camera3d = new THREE.PerspectiveCamera(42, wrap.clientWidth/wrap.clientHeight, 0.05, 12);
  setCamISO();

  scene.add(new THREE.AmbientLight(0xffffff,0.7));
  const sun = new THREE.DirectionalLight(0xffffff,0.85);
  sun.position.set(2,3,2);
  scene.add(sun);

  const grid = new THREE.GridHelper(2, 16, 0xb0bdd0, 0xc8d4e0);
  grid.material.opacity=0.5; grid.material.transparent=true;
  scene.add(grid);

  setupCloud = generatePoints(0, 2400, 2.5);
  buildCloudPoints();
  buildKnnSphere();
  buildPcaArrowGroup();
  buildMeshLines();

  setupOrbit(canvas);
  window.addEventListener('resize', resizeRenderer);
  loopThree();
}

function resizeRenderer() {
  const wrap = document.getElementById('three-canvas').parentElement;
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w,h,false);
  if (camera3d) { camera3d.aspect = w/h; camera3d.updateProjectionMatrix(); }
}

function loopThree() {
  animFrame = requestAnimationFrame(loopThree);
  updateOrbitCam();
  renderer.render(scene, camera3d);
}
function updateOrbitCam() {
  camera3d.position.set(
    orbitTarget.x + radius3d*Math.sin(phi3d)*Math.sin(theta3d),
    orbitTarget.y + radius3d*Math.cos(theta3d),
    orbitTarget.z + radius3d*Math.cos(phi3d)*Math.sin(theta3d)
  );
  camera3d.lookAt(orbitTarget);
}
function setCamISO()  { phi3d=Math.PI/4; theta3d=Math.PI/4; radius3d=1.6; }
function setCamTop()  { phi3d=0; theta3d=0.01; radius3d=1.8; }
function setCamFront(){ phi3d=0; theta3d=Math.PI/2; radius3d=1.6; }
function setCamSide() { phi3d=Math.PI/2; theta3d=Math.PI/2; radius3d=1.6; }

function setupOrbit(canvas) {
  canvas.addEventListener('mousedown', e=>{isDragging=true; lastMouse={x:e.clientX,y:e.clientY};});
  window.addEventListener('mouseup', ()=>{isDragging=false;});
  window.addEventListener('mousemove', e=>{
    if(!isDragging) return;
    const dx=e.clientX-lastMouse.x, dy=e.clientY-lastMouse.y;
    lastMouse={x:e.clientX,y:e.clientY};
    if (e.buttons===1) {
      phi3d -= dx*0.008; theta3d=Math.max(0.05,Math.min(Math.PI-0.05,theta3d+dy*0.008));
      document.querySelectorAll('.btn-preset').forEach(b=>b.classList.remove('active'));
    } else if (e.buttons===2) {
      orbitTarget.x -= dx*0.0015; orbitTarget.y += dy*0.0015;
    }
  });
  canvas.addEventListener('wheel', e=>{ e.preventDefault(); radius3d=Math.max(0.5,Math.min(4,radius3d+e.deltaY*0.002)); }, {passive:false});
  let lt=null, ltd=0;
  canvas.addEventListener('touchstart', e=>{
    if(e.touches.length===1){isDragging=true; lt={x:e.touches[0].clientX,y:e.touches[0].clientY};}
    else if(e.touches.length===2) ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
  });
  canvas.addEventListener('touchend', ()=>{isDragging=false; lt=null;});
  canvas.addEventListener('touchmove', e=>{
    e.preventDefault();
    if(e.touches.length===1 && isDragging && lt){
      const dx=e.touches[0].clientX-lt.x, dy=e.touches[0].clientY-lt.y;
      lt={x:e.touches[0].clientX,y:e.touches[0].clientY};
      phi3d -= dx*0.01; theta3d=Math.max(0.05,Math.min(Math.PI-0.05,theta3d+dy*0.01));
    } else if(e.touches.length===2){
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      radius3d=Math.max(0.5,Math.min(4,radius3d*(ltd/d))); ltd=d;
    }
  }, {passive:false});
  canvas.addEventListener('contextmenu', e=>e.preventDefault());
}

function buildCloudPoints() {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(setupCloud.length*3);
  const colors = new Float32Array(setupCloud.length*3);
  let minZ=Infinity, maxZ=-Infinity;
  setupCloud.forEach(p=>{ minZ=Math.min(minZ,p[2]); maxZ=Math.max(maxZ,p[2]); });
  setupCloud.forEach((p,i)=>{
    positions[i*3]=p[0]; positions[i*3+1]=p[2]; positions[i*3+2]=p[1];
    const t = (p[2]-minZ)/Math.max(1e-6,(maxZ-minZ));
    const c = new THREE.Color().setHSL(0.62-0.5*t, 0.75, 0.55);
    colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
  });
  geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
  const mat = new THREE.PointsMaterial({ size:0.012, vertexColors:true, sizeAttenuation:true });
  cloudPoints = new THREE.Points(geo, mat);
  cloudPoints.visible = false;
  scene.add(cloudPoints);
}

function buildKnnSphere() {
  const geo = new THREE.SphereGeometry(0.06, 20, 20);
  const mat = new THREE.MeshBasicMaterial({ color:0x7c3aed, transparent:true, opacity:0.14, wireframe:false });
  knnSphere = new THREE.Mesh(geo, mat);
  knnSphere.visible = false;
  scene.add(knnSphere);

  const hgeo = new THREE.SphereGeometry(0.012, 12, 12);
  const hmat = new THREE.MeshBasicMaterial({ color:0xf59e0b });
  highlightPoint = new THREE.Mesh(hgeo, hmat);
  highlightPoint.visible = false;
  scene.add(highlightPoint);
}

function buildPcaArrowGroup() {
  pcaArrowGroup = new THREE.Group();
  pcaArrowGroup.visible = false;
  scene.add(pcaArrowGroup);
}

function buildMeshLines() {
  const geo = new THREE.BufferGeometry();
  const mat = new THREE.LineBasicMaterial({ color:0xf59e0b, transparent:true, opacity:0.7 });
  meshLines = new THREE.LineSegments(geo, mat);
  meshLines.visible = false;
  scene.add(meshLines);
}

function updateKnnHighlight(k) {
  if (!setupCloud.length) return;
  const idx = Math.floor(setupCloud.length/2);
  const p = setupCloud[idx];
  highlightPoint.position.set(p[0], p[2], p[1]);

  const neighIdx = kNearest(setupCloud, idx, k);
  const kthDist = vLen(vSub(setupCloud[neighIdx[neighIdx.length-1]], p));
  knnSphere.scale.setScalar(kthDist / 0.06);
  knnSphere.position.copy(highlightPoint.position);
}

function animatePcaOnSetupCloud() {
  pcaArrowGroup.clear();
  const sampleN = Math.min(300, setupCloud.length);
  const stepN = Math.floor(setupCloud.length/sampleN);
  const viewpoint = [0, 1.2, 1.2];

  for (let i=0; i<setupCloud.length; i+=stepN) {
    const { normal } = estimateNormal(setupCloud, i, SETUP.k, viewpoint, 0);
    const p = setupCloud[i];
    const start = new THREE.Vector3(p[0], p[2], p[1]);
    const end = new THREE.Vector3(p[0]+normal[0]*0.025, p[2]+normal[2]*0.025, p[1]+normal[1]*0.025);
    const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
    const mat = new THREE.LineBasicMaterial({ color: 0x2563eb });
    pcaArrowGroup.add(new THREE.Line(geo, mat));
  }
  pcaArrowGroup.visible = true;
}

function buildSetupMeshPreview() {
  const tris = greedyTriangulate(setupCloud, null, SETUP.k, 0.045);
  const positions = [];
  tris.slice(0,400).forEach(t=>{
    const A=setupCloud[t.a], B=setupCloud[t.b], C=setupCloud[t.c];
    positions.push(A[0],A[2],A[1], B[0],B[2],B[1]);
    positions.push(B[0],B[2],B[1], C[0],C[2],C[1]);
    positions.push(C[0],C[2],C[1], A[0],A[2],A[1]);
  });
  meshLines.geometry.dispose();
  meshLines.geometry = new THREE.BufferGeometry();
  meshLines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
  meshLines.visible = true;
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — STEP NAVIGATION
────────────────────────────────────────────────────────────── */

function gotoStep(n) {
  n = Math.max(0, Math.min(4,n));
  document.querySelectorAll('.step-content').forEach((el,i)=>el.classList.toggle('active', i===n));
  document.querySelectorAll('.sstep').forEach((el,i)=>{
    el.classList.remove('active','done');
    if(i===n) el.classList.add('active');
    if(i<n) el.classList.add('done');
  });
  
  document.getElementById('step-badge').textContent = `STEP ${n+1} OF 5`;
  
  const titles = [
    'Mount Processing Modules',
    'Load Point Cloud',
    'Configure Neighbourhood',
    'Estimate Normals',
    'Observe Results'
  ];
  const texts = [
    'This experiment processes existing scan data. Mount each software module onto the virtual processing workbench.',
    'The point cloud is loaded. Verify the bounding box and point count before proceeding.',
    'Set the neighbourhood size k for k-NN search. Larger k reduces noise but blurs sharp features.',
    'Run the PCA Covariance solver over all points to estimate surface normals.',
    'Review the final statistics and mesh quality. Proceed to the simulation mode for interactive parameter exploration.'
  ];
  
  document.getElementById('wizard-title').textContent = titles[n];
  document.getElementById('wizard-text').textContent = texts[n];

  document.getElementById('obs-overlay').style.display = n===4 ? 'block':'none';
  if (n>=4) { document.getElementById('btn-launch-sim').disabled=false; populateResults(); }
}

function populateResults() {
  document.getElementById('ro-setup-k').textContent = SETUP.k;
  const kappaAvg = (0.02 + Math.random()*0.03).toFixed(3);
  document.getElementById('ro-setup-kappa').textContent = kappaAvg;
  document.getElementById('ro-setup-consist').textContent = (2 + Math.random()*2).toFixed(1);

  document.getElementById('obs-pts').textContent = '2,400';
  document.getElementById('obs-k').textContent = SETUP.k;
  document.getElementById('obs-dev').textContent = (2 + Math.random()*2).toFixed(1) + '°';
  document.getElementById('obs-kappa').textContent = kappaAvg;
}

/* ──────────────────────────────────────────────────────────────
   COMPONENT MOUNTING
────────────────────────────────────────────────────────────── */
function mountNextComp() {
  if (mountSeqIndex < COMP_SEQ.length) {
    mountComp(COMP_SEQ[mountSeqIndex]);
    mountSeqIndex++;
  }
  if (mountSeqIndex >= COMP_SEQ.length) {
    document.getElementById('btn-mount-seq').disabled = true;
    document.getElementById('btn-mount-seq').textContent = 'All Components Mounted';
  }
}

function mountComp(name) {
  MOUNTED[name]=true;
  let specHtml = '';
  switch(name){
    case 'cloud': 
      cloudPoints.visible=true; 
      specHtml = `<table class="spec-table">
        <tr><th>Type</th><td>3D Point Cloud</td></tr>
        <tr><th>Format</th><td>Float32 (XYZ)</td></tr>
        <tr><th>Points</th><td>2,400</td></tr>
      </table>`;
      break;
    case 'knn':   
      knnSphere.visible=true; highlightPoint.visible=true; updateKnnHighlight(SETUP.k); 
      specHtml = `<table class="spec-table">
        <tr><th>Algorithm</th><td>Brute Force L2</td></tr>
        <tr><th>Metric</th><td>Euclidean Dist</td></tr>
        <tr><th>Query</th><td>k-Nearest</td></tr>
      </table>`;
      break;
    case 'pca':   
      animatePcaOnSetupCloud(); 
      specHtml = `<table class="spec-table">
        <tr><th>Solver</th><td>Jacobi Eigen</td></tr>
        <tr><th>Matrix</th><td>3x3 Covariance</td></tr>
      </table>`;
      break;
    case 'mesh':  
      buildSetupMeshPreview(); 
      specHtml = `<table class="spec-table">
        <tr><th>Method</th><td>Greedy Tri.</td></tr>
        <tr><th>Gating</th><td>Distance+Angle</td></tr>
      </table>`;
      break;
  }
  
  document.getElementById('spec-content').innerHTML = specHtml;
  
  const card=document.querySelector(`.apparatus-card[data-comp="${name}"]`);
  if(card) {
    card.classList.add('mounted');
    const status = card.querySelector('.apparatus-status');
    if (status) status.textContent = 'Mounted';
  }
  
  const all = Object.values(MOUNTED).every(Boolean);
  if (all) {
    document.getElementById('btn-next-0').disabled = false;
  }
}

function resetSetup() {
  Object.keys(MOUNTED).forEach(k=>MOUNTED[k]=false);
  mountSeqIndex = 0;
  if(cloudPoints) cloudPoints.visible=false;
  if(knnSphere) { knnSphere.visible=false; highlightPoint.visible=false; }
  if(pcaArrowGroup) { pcaArrowGroup.visible=false; pcaArrowGroup.clear(); }
  if(meshLines) meshLines.visible=false;

  document.getElementById('btn-mount-seq').disabled = false;
  document.getElementById('btn-mount-seq').textContent = 'Mount Component';
  document.getElementById('spec-content').innerHTML = '<p class="specs-placeholder">Mount components to view specifications.</p>';
  document.querySelectorAll('.apparatus-card').forEach(c => {
    c.classList.remove('mounted');
    const status = c.querySelector('.apparatus-status');
    if (status) status.textContent = 'Unmounted';
  });

  SETUP.k=10;
  const srk = document.getElementById('sr-k');
  srk.value=10;
  srk.dispatchEvent(new Event('input'));
  document.getElementById('sv-k').textContent='10';

  document.getElementById('normals-count').textContent='0';
  document.getElementById('normals-fill').style.width='0%';
  document.getElementById('btn-next-0').disabled=true;
  document.getElementById('btn-next-3').disabled=true;
  
  gotoStep(0);
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION WIZARD
────────────────────────────────────────────────────────────── */
function updateWizard() {
  const step=Math.min(SIM.step, WIZ.length-1);
  const s=WIZ[step];
  document.getElementById('wiz-title').textContent=s.title;
  document.getElementById('wiz-text').textContent=s.text;
  document.getElementById('wiz-task').textContent=s.task;

  document.querySelectorAll('.ctrl-group').forEach(el=>el.classList.remove('lit'));
  const lit=document.getElementById(s.lit);
  if(lit){lit.classList.add('lit'); lit.scrollIntoView({block:'nearest',behavior:'smooth'});}

  document.querySelectorAll('.wdot').forEach((d,i)=>{
    d.classList.remove('active','done');
    if(i===step) d.classList.add('active');
    if(i<step) d.classList.add('done');
  });

  const nxt=document.getElementById('wiz-next'), skp=document.getElementById('wiz-skip');
  if(step>=WIZ.length-1){nxt.textContent='Explore Freely'; skp.style.display='none';}
  else {nxt.textContent='Next Step'; skp.style.display='';}
}

/* ──────────────────────────────────────────────────────────────
   SIM INIT & CONTROLS
────────────────────────────────────────────────────────────── */
function initSim() {
  updateWizard();
  updateSim();
  setup2DControls(document.getElementById('cvs-hedgehog'));
  setup2DControls(document.getElementById('cvs-curvature'));
  setup2DControls(document.getElementById('cvs-mesh'));

  document.getElementById('r-k').addEventListener('input', e=>{
    SIM.k=parseInt(e.target.value);
    document.getElementById('pv-k').textContent=SIM.k;
    updateSim();
  });
  document.getElementById('r-noise').addEventListener('input', e=>{
    SIM.noise=parseFloat(e.target.value);
    document.getElementById('pv-noise').textContent=SIM.noise.toFixed(1)+' mm';
    generateSimCloud();
    updateSim();
  });
  // Surface Shape Toggle Buttons
  document.querySelectorAll('#r-surface-group .btn-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('#r-surface-group .btn-toggle').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      SIM.surfIdx = parseInt(e.target.dataset.val);
      generateSimCloud();
      updateSim();
    });
  });
  
  document.getElementById('r-orient').addEventListener('input', e=>{
    SIM.orient=parseInt(e.target.value);
    document.getElementById('pv-orient').textContent = SIM.orient===0 ? 'Viewpoint' : 'Raw';
    updateSim();
  });
  document.getElementById('r-maxedge').addEventListener('input', e=>{
    SIM.maxEdge=parseFloat(e.target.value);
    document.getElementById('pv-maxedge').textContent=SIM.maxEdge.toFixed(3)+' m';
    updateSim();
  });

  document.getElementById('wiz-next').addEventListener('click', ()=>{SIM.step=Math.min(SIM.step+1,WIZ.length-1); updateWizard();});
  document.getElementById('wiz-skip').addEventListener('click', ()=>{SIM.step=WIZ.length-1; updateWizard();});
  document.querySelectorAll('.wdot').forEach(d=>d.addEventListener('click', ()=>{SIM.step=parseInt(d.dataset.ws); updateWizard();}));

  ['btn-sim-reset','btn-sim-reset2'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.addEventListener('click', resetSim);
  });

  const ro=new ResizeObserver(()=>updateSim());
  document.querySelectorAll('.sim-card').forEach(c=>ro.observe(c));
}

function resetSim() {
  SIM.k=10; SIM.noise=2; SIM.surfIdx=0; SIM.orient=0; SIM.maxEdge=0.05; SIM.step=0;
  const rk = document.getElementById('r-k'); rk.value=10; rk.dispatchEvent(new Event('input'));
  const rn = document.getElementById('r-noise'); rn.value=2; rn.dispatchEvent(new Event('input'));
  document.querySelectorAll('#r-surface-group .btn-toggle').forEach((b, i) => {
    if(i===0) b.classList.add('active'); else b.classList.remove('active');
  });
  const ro = document.getElementById('r-orient'); ro.value=0; ro.dispatchEvent(new Event('input'));
  const rm = document.getElementById('r-maxedge'); rm.value=0.05; rm.dispatchEvent(new Event('input'));
  document.getElementById('pv-k').textContent='10';
  document.getElementById('pv-noise').textContent='2 mm';
  document.getElementById('pv-orient').textContent='Viewpoint';
  document.getElementById('pv-maxedge').textContent='0.05 m';
  rotY=0.6; rotX=-0.3; zoomScale=380; panX=0; panY=0;
  generateSimCloud(); updateWizard(); updateSim();
}

function renderAll2DViews() {
  renderHedgehog(document.getElementById('cvs-hedgehog'));
  renderCurvatureMap(document.getElementById('cvs-curvature'));
  renderMeshWireframe(document.getElementById('cvs-mesh'));
}

function setup2DControls(canvas) {
  let isOrbiting = false, isPanning = false, lastM = {x:0, y:0};

  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('mousedown', e=>{
    if(e.button===0) isOrbiting=true;
    else if(e.button===2) isPanning=true;
    lastM={x:e.clientX,y:e.clientY};
  });
  window.addEventListener('mouseup', ()=>{isOrbiting=false; isPanning=false;});
  window.addEventListener('mousemove', e=>{
    if(!isOrbiting && !isPanning) return;
    const dx=e.clientX-lastM.x, dy=e.clientY-lastM.y;
    lastM={x:e.clientX,y:e.clientY};
    if (isOrbiting) {
      rotY += dx*0.01; rotX = Math.max(-1.4,Math.min(1.4,rotX+dy*0.01));
    } else if (isPanning) {
      panX += dx; panY += dy;
    }
    renderAll2DViews();
  });
  canvas.addEventListener('wheel', e=>{
    e.preventDefault();
    zoomScale *= (e.deltaY > 0 ? 0.9 : 1.1);
    zoomScale = Math.max(50, Math.min(2000, zoomScale));
    renderAll2DViews();
  }, {passive:false});

  let lt=null;
  canvas.addEventListener('touchstart', e=>{
    if(e.touches.length===1) { isOrbiting=true; lt={x:e.touches[0].clientX,y:e.touches[0].clientY}; }
    else if(e.touches.length===2) { isPanning=true; lt={x:e.touches[0].clientX,y:e.touches[0].clientY}; }
  });
  canvas.addEventListener('touchend', ()=>{isOrbiting=false; isPanning=false; lt=null;});
  canvas.addEventListener('touchmove', e=>{
    e.preventDefault();
    if(!lt) return;
    const dx=e.touches[0].clientX-lt.x, dy=e.touches[0].clientY-lt.y;
    lt={x:e.touches[0].clientX,y:e.touches[0].clientY};
    if(isOrbiting) {
      rotY += dx*0.012; rotX = Math.max(-1.4,Math.min(1.4,rotX+dy*0.012));
    } else if (isPanning) {
      panX += dx; panY += dy;
    }
    renderAll2DViews();
  }, {passive:false});
}

/* ──────────────────────────────────────────────────────────────
   INIT & EVENTS
────────────────────────────────────────────────────────────── */
window.onload = () => {
  initSetup();
};

function initSetup() {
  initThree();

  document.getElementById('btn-mount-seq').addEventListener('click', mountNextComp);

  for(let i=0; i<4; i++) {
    const nextBtn = document.getElementById(`btn-next-${i}`);
    if (nextBtn) nextBtn.addEventListener('click', () => gotoStep(i+1));
  }

  document.querySelectorAll('[data-prev]').forEach(btn=>{
    btn.addEventListener('click', ()=>gotoStep(parseInt(btn.dataset.prev)));
  });
  document.querySelectorAll('.sstep').forEach(el=>{
    el.addEventListener('click', ()=>gotoStep(parseInt(el.dataset.s)));
  });

  document.getElementById('sr-k').addEventListener('input', e=>{
    SETUP.k=parseInt(e.target.value);
    document.getElementById('sv-k').textContent=SETUP.k;
    if (MOUNTED.knn) updateKnnHighlight(SETUP.k);
  });
  
  document.querySelectorAll('input[type="range"]').forEach(slider => {
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

  document.getElementById('btn-estimate').addEventListener('click', () => {
    let count=0;
    const total=2400;
    const timer=setInterval(()=>{
      count += 240;
      if (count>=total){count=total; clearInterval(timer); document.getElementById('btn-next-3').disabled=false;}
      document.getElementById('normals-count').textContent = count;
      document.getElementById('normals-fill').style.width = (count/total*100)+'%';
    }, 120);
    animatePcaOnSetupCloud();
  });

  document.querySelectorAll('.btn-preset').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.btn-preset').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      switch(btn.dataset.view){
        case 'iso': setCamISO(); break;
        case 'top': setCamTop(); break;
        case 'front': setCamFront(); break;
        case 'side': setCamSide(); break;
      }
    });
  });

  document.querySelectorAll('.btn-reset-setup').forEach(btn=>{
    btn.addEventListener('click', resetSetup);
  });

  document.getElementById('btn-launch-sim').addEventListener('click', showSim);
  document.getElementById('btn-back-setup').addEventListener('click', showSetup);
  
  gotoStep(0);
}

function showSim() {
  document.getElementById('setup-view').style.display = 'none';
  document.getElementById('simulation-view').style.display = 'flex';
  cancelAnimationFrame(animFrame);
  SIM.k = SETUP.k;
  document.getElementById('r-k').value = SIM.k;
  document.getElementById('pv-k').textContent = SIM.k;
  initSim();
}
function showSetup() {
  document.getElementById('simulation-view').style.display = 'none';
  document.getElementById('setup-view').style.display = 'flex';
  loopThree();
}


/* ──────────────────────────────────────────────────────────────
   SIMULATION DATA CACHE & RENDERERS
────────────────────────────────────────────────────────────── */
let SIM_CLOUD = [];
let SIM_NORMALS = [];
let SIM_KAPPAS = [];
let SIM_TRIS = [];
let rotY = 0.6, rotX = -0.3;
let zoomScale = 380, panX = 0, panY = 0;

function generateSimCloud() {
  const N = 700;
  SIM_CLOUD = generatePoints(SIM.surfIdx, N, SIM.noise);
}

function recomputeSim() {
  if (!SIM_CLOUD || SIM_CLOUD.length === 0) generateSimCloud();
  const viewpoint = [0, 0, 1.5];

  SIM_NORMALS = []; SIM_KAPPAS = [];
  const sampleStep = 1;
  for (let i=0;i<SIM_CLOUD.length;i+=sampleStep) {
    const { normal, kappa } = estimateNormal(SIM_CLOUD, i, SIM.k, viewpoint, SIM.orient);
    SIM_NORMALS[i]=normal; SIM_KAPPAS[i]=kappa;
  }
  SIM_TRIS = greedyTriangulate(SIM_CLOUD, SIM_NORMALS, SIM.k, SIM.maxEdge);
}

function updateSim() {
  recomputeSim();

  const avgKappa = SIM_KAPPAS.reduce((a,b)=>a+(b||0),0)/Math.max(1,SIM_KAPPAS.length);
  document.getElementById('ro-kappa').textContent = avgKappa.toFixed(4);

  const consistDeg = (2 + SIM.noise*0.8 + (SIM.surfIdx===1?4:0)).toFixed(1);
  document.getElementById('ro-consist').textContent = consistDeg + '°';
  document.getElementById('ro-consist').className = 'ro-val ' + (consistDeg<5?'good':consistDeg<10?'warn':'danger');

  document.getElementById('ro-tris').textContent = SIM_TRIS.length;
  const minAngles = SIM_TRIS.map(t=>t.minAngle);
  const worstAngle = minAngles.length ? Math.min(...minAngles) : 0;
  document.getElementById('ro-minangle').textContent = worstAngle.toFixed(1) + '°';
  document.getElementById('ro-minangle').className = 'ro-val ' + (worstAngle>25?'good':worstAngle>12?'warn':'danger');

  document.getElementById('bb-tris').textContent = SIM_TRIS.length;
  document.getElementById('bb-minang').textContent = worstAngle.toFixed(1)+'°';
  const holes = Math.max(0, Math.round(SIM.maxEdge<0.03 ? 12 : SIM.maxEdge>0.1 ? 2 : 5));
  document.getElementById('bb-holes').textContent = holes;
  document.getElementById('bb-consist').textContent = consistDeg+'°';

  renderHedgehog(document.getElementById('cvs-hedgehog'));
  renderCurvatureMap(document.getElementById('cvs-curvature'));
  renderMeshWireframe(document.getElementById('cvs-mesh'));
  renderKvsDeviation(document.getElementById('cvs-kvalues'));
  renderGauge(document.getElementById('gauge-canvas'));
}

function project(p, W, H, scale) {
  const cosY=Math.cos(rotY), sinY=Math.sin(rotY);
  const cosX=Math.cos(rotX), sinX=Math.sin(rotX);
  let x1=p[0]*cosY+p[2]*sinY, z1=-p[0]*sinY+p[2]*cosY;
  let y1=p[1]*cosX-z1*sinX, z2=p[1]*sinX+z1*cosX;
  return { x: W/2 + panX + x1*scale, y: H/2 + panY - y1*scale, depth:z2 };
}

function renderHedgehog(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const scale=zoomScale;
  const items=[];
  SIM_CLOUD.forEach((p,i)=>{
    const proj=project(p,W,H,scale);
    items.push({type:'pt', proj, depth:proj.depth});
    if (SIM_NORMALS[i]) {
      const tip=[p[0]+SIM_NORMALS[i][0]*0.03, p[1]+SIM_NORMALS[i][1]*0.03, p[2]+SIM_NORMALS[i][2]*0.03];
      const projTip=project(tip,W,H,scale);
      const inward = vDot(SIM_NORMALS[i], vNorm(p)) < -0.3 && SIM.surfIdx===2;
      items.push({type:'normal', p1:proj, p2:projTip, depth:proj.depth, inward});
    }
  });
  items.sort((a,b)=>b.depth-a.depth);
  items.forEach(it=>{
    if (it.type==='pt') {
      ctx.fillStyle='#64748b'; // darker points for contrast
      ctx.beginPath(); ctx.arc(it.proj.x, it.proj.y, 1.1, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.strokeStyle = it.inward ? '#ef4444' : '#0ea5e9'; // darker cyan for lines
      ctx.lineWidth=0.8;
      ctx.beginPath(); ctx.moveTo(it.p1.x,it.p1.y); ctx.lineTo(it.p2.x,it.p2.y); ctx.stroke();
    }
  });

  ctx.fillStyle='#64748b'; ctx.font='9px JetBrains Mono';
  ctx.fillText(`${SIM_CLOUD.length} normals  |  k=${SIM.k}`, 8, H-8);
}

function renderCurvatureMap(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const scale=zoomScale;
  const pts = SIM_CLOUD.map((p,i)=>({proj:project(p,W,H,scale), kappa:SIM_KAPPAS[i]||0}));
  pts.sort((a,b)=>b.proj.depth-a.proj.depth);
  const maxK = Math.max(0.05, ...pts.map(p=>p.kappa));
  pts.forEach(pt=>{
    const t = Math.min(1, pt.kappa/maxK);
    const hue = 210 - t*210; /* blue -> red */
    ctx.fillStyle = `hsl(${hue},75%,55%)`;
    ctx.beginPath(); ctx.arc(pt.proj.x, pt.proj.y, 1.6, 0, Math.PI*2); ctx.fill();
  });
  ctx.fillStyle='#64748b'; ctx.font='9px JetBrains Mono';
  ctx.fillText(`avg κ = ${(SIM_KAPPAS.reduce((a,b)=>a+(b||0),0)/SIM_KAPPAS.length).toFixed(4)}`, 8, H-8);
}

function renderMeshWireframe(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const scale=zoomScale;
  
  // Render point cloud behind mesh
  ctx.fillStyle = '#cbd5e1'; // light slate
  SIM_CLOUD.forEach(p => {
    const proj = project(p, W, H, scale);
    ctx.beginPath(); ctx.arc(proj.x, proj.y, 1.2, 0, Math.PI*2); ctx.fill();
  });

  ctx.strokeStyle='#f59e0b'; ctx.lineWidth=0.7;
  SIM_TRIS.forEach(t=>{
    const A=project(SIM_CLOUD[t.a],W,H,scale);
    const B=project(SIM_CLOUD[t.b],W,H,scale);
    const C=project(SIM_CLOUD[t.c],W,H,scale);
    ctx.beginPath();
    ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.lineTo(C.x,C.y); ctx.closePath();
    ctx.stroke();
  });

  ctx.fillStyle='#64748b'; ctx.font='9px JetBrains Mono';
  ctx.fillText(`${SIM_TRIS.length} triangles`, 8, H-8);
}

function renderKvsDeviation(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const padL=32,padT=12,padR=8,padB=20;
  const gW=W-padL-padR, gH=H-padT-padB;

  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){ const y=padT+gH*i/4; ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(padL+gW,y); ctx.stroke(); }

  const noiseFactor = SIM.noise/1000;
  const pts=[];
  for (let k=4;k<=50;k+=2) {
    const dev = (noiseFactor*4000)/Math.sqrt(k) + k*0.06;
    pts.push({k, dev});
  }
  const maxDev = Math.max(...pts.map(p=>p.dev));

  ctx.strokeStyle='#7c3aed'; ctx.lineWidth=1.8; ctx.beginPath();
  pts.forEach((pt,i)=>{
    const x=padL+((pt.k-4)/46)*gW;
    const y=padT+gH-(pt.dev/maxDev)*gH;
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();

  const curX = padL+((SIM.k-4)/46)*gW;
  const curDev = (noiseFactor*4000)/Math.sqrt(SIM.k) + SIM.k*0.06;
  const curY = padT+gH-(curDev/maxDev)*gH;
  ctx.fillStyle='#7c3aed';
  ctx.beginPath(); ctx.arc(curX,curY,4,0,Math.PI*2); ctx.fill();

  ctx.fillStyle='#64748b'; ctx.font='8px DM Sans'; ctx.textAlign='center';
  ctx.fillText('k (neighbourhood size)', padL+gW/2, H-4);
  ctx.textAlign='left';
}

function renderGauge(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);

  const avgKappa = SIM_KAPPAS.reduce((a,b)=>a+(b||0),0)/Math.max(1,SIM_KAPPAS.length);
  const edgePenalty = SIM.surfIdx===1 ? 15 : 0;
  const quality = Math.max(0, Math.min(100, 100 - avgKappa*800 - edgePenalty));

  const cx=W/2,cy=H-8,r=H-16;
  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=10; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,2*Math.PI); ctx.stroke();
  const colour = quality>65?'#22c55e':quality>35?'#f59e0b':'#ef4444';
  const sweep=Math.PI+(quality/100)*Math.PI;
  ctx.strokeStyle=colour; ctx.lineWidth=10;
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,sweep); ctx.stroke();
  ctx.strokeStyle='#334155'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r-4)*Math.cos(sweep), cy+(r-4)*Math.sin(sweep)); ctx.stroke();
  ctx.fillStyle='#334155'; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();

  document.getElementById('quality-label').textContent = `${quality.toFixed(0)}% quality`;
  document.getElementById('quality-label').style.color = colour;
  document.getElementById('quality-sub').textContent =
    quality>65 ? 'Normals and mesh look reliable' :
    quality>35 ? 'Reduce noise or adjust k' :
                 'Estimation degraded — check edges/noise';
}

