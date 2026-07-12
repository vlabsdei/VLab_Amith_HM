/* ================================================================
   EXPERIMENT 8 — NOISE FILTERING ALGORITHM COMPARATOR
   main.js — Three.js 3D setup scene + real SOR / ROR / MLS math
   ================================================================
   Updated to Unified 3-Column UI Layout
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */
const MOUNTED = { cloud: false, sor: false, ror: false, mls: false };
const COMP_ORDER = ['cloud', 'sor', 'ror', 'mls'];

const SETUP = { filterType: 0, primary: 2.0 };

const SIM = {
  algo:      0,     /* 0=SOR 1=ROR 2=MLS */
  k:         10,
  alpha:     2.0,
  radius:    15,    /* mm */
  nmin:      6,
  bandwidth: 6,     /* mm */
  step:      0,
};

const ALGO_NAMES = ['SOR', 'ROR', 'MLS'];

const WIZ = [
  {
    title: 'Tune SOR\'s Threshold',
    text:  'SOR rejects any point whose mean neighbour distance exceeds μ + α·σ. Watch precision and recall move in opposite directions as α changes.',
    task:  '▶ Drag α from 3.0 down to 1.0 and watch recall rise while precision falls.',
    lit:   'pg-alpha',
  },
  {
    title: 'Switch to ROR',
    text:  'ROR uses a fixed physical radius instead of statistics. On this cloud it behaves differently — test whether it out- or under-performs SOR.',
    task:  '▶ Set Active Algorithm to ROR and compare its F1 score to SOR\'s best result.',
    lit:   'pg-algo',
  },
  {
    title: 'Push ROR Radius Too Far',
    text:  'A radius too large relative to fine surface detail starts erasing legitimate features, not just outliers — exactly the effect described in the theory.',
    task:  '▶ Set ROR radius above 40mm and inspect the classification map for wrongly-removed real points.',
    lit:   'pg-radius',
  },
  {
    title: 'Smooth with MLS',
    text:  'MLS repositions points instead of deleting them. A small bandwidth preserves detail but leaves jitter; a large bandwidth over-smooths and rounds sharp features.',
    task:  '▶ Switch to MLS and compare bandwidth 2mm vs 20mm on the Before/After panel.',
    lit:   'pg-bandwidth',
  },
];

const COMP_SPECS = {
  cloud: {
    desc: 'Synthetic scan of a mechanical part with added Gaussian sensor noise and scattered flying-pixel outliers.',
    specs: [['Points', '1,800'], ['Outliers', '15%'], ['Base Noise', '±2 mm'], ['Density', 'High']]
  },
  sor: {
    desc: 'Statistical Outlier Removal (SOR). Analyzes distance distribution to k-nearest neighbours and rejects points far from the local mean.',
    specs: [['Metric', 'Distance to Mean'], ['Complexity', 'O(N log N)'], ['Parameters', 'k, α'], ['Output', 'Binary classification']]
  },
  ror: {
    desc: 'Radius Outlier Removal (ROR). Counts neighbours within a fixed physical radius to identify isolated flying pixels.',
    specs: [['Metric', 'Points in Radius'], ['Complexity', 'O(N log N)'], ['Parameters', 'Radius r, n_min'], ['Output', 'Binary classification']]
  },
  mls: {
    desc: 'Moving Least Squares (MLS). Projects noisy points onto a locally fitted polynomial surface to smooth out gaussian noise.',
    specs: [['Metric', 'Local Plane Fit'], ['Complexity', 'O(N²) local'], ['Parameters', 'Bandwidth h'], ['Output', 'Repositioned coordinates']]
  }
};

/* ──────────────────────────────────────────────────────────────
   MATH HELPERS
────────────────────────────────────────────────────────────── */
function gauss() {
  const u1 = Math.max(1e-12, Math.random());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random());
}
function vSub(a,b){ return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function vLen(a){ return Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]); }

/* ──────────────────────────────────────────────────────────────
   CLOUD GENERATOR
────────────────────────────────────────────────────────────── */
function surfaceZ(x, y) {
  return 0.03*Math.sin(4*x)*Math.cos(3*y) + 0.015*Math.sin(9*x);
}

function generateNoisyCloud(n, outlierFrac, jitterMm) {
  const jitter = jitterMm/1000;
  const pts = [];
  const isOutlier = [];
  const nOutliers = Math.round(n * outlierFrac);
  const nGenuine  = n - nOutliers;

  for (let i=0;i<nGenuine;i++){
    const x=Math.random(), y=Math.random();
    const z=surfaceZ(x,y);
    pts.push([(x-0.5)*0.5+gauss()*jitter, (y-0.5)*0.35+gauss()*jitter, z+gauss()*jitter]);
    isOutlier.push(false);
  }
  for (let i=0;i<nOutliers;i++){
    const x=Math.random(), y=Math.random();
    const zBase=surfaceZ(x,y);
    const disp = (0.02 + Math.random()*0.05) * (Math.random()<0.5?-1:1);
    pts.push([(x-0.5)*0.5+gauss()*jitter*2, (y-0.5)*0.35+gauss()*jitter*2, zBase+disp]);
    isOutlier.push(true);
  }
  return { pts, isOutlier };
}

/* ──────────────────────────────────────────────────────────────
   kNN & FILTERS
────────────────────────────────────────────────────────────── */
function kNearestDists(pts, idx, k) {
  const p0 = pts[idx];
  const d = [];
  for (let i=0;i<pts.length;i++){
    if(i===idx) continue;
    d.push(vLen(vSub(pts[i], p0)));
  }
  d.sort((a,b)=>a-b);
  return d.slice(0,k);
}
function neighboursWithinRadius(pts, idx, r) {
  const p0 = pts[idx];
  let count=0;
  for (let i=0;i<pts.length;i++){
    if(i===idx) continue;
    if (vLen(vSub(pts[i], p0)) < r) count++;
  }
  return count;
}
function runSOR(pts, k, alpha) {
  const meanDists = pts.map((_,i) => {
    const d = kNearestDists(pts, i, k);
    return d.reduce((a,b)=>a+b,0)/d.length;
  });
  const mu = meanDists.reduce((a,b)=>a+b,0)/meanDists.length;
  const variance = meanDists.reduce((a,b)=>a+(b-mu)*(b-mu),0)/(meanDists.length-1);
  const sigma = Math.sqrt(variance);
  const threshold = mu + alpha*sigma;
  const keep = meanDists.map(d => d <= threshold);
  return { keep, meanDists, mu, sigma, threshold };
}
function runROR(pts, radiusM, nMin) {
  const keep = pts.map((_,i) => neighboursWithinRadius(pts, i, radiusM) >= nMin);
  return { keep };
}
function runMLS(pts, k, hMm) {
  const h = hMm/1000;
  const out = pts.map((p,i) => {
    const idxs = [];
    const dists=[];
    for (let j=0;j<pts.length;j++){
      const d = vLen(vSub(pts[j],p));
      idxs.push(j); dists.push(d);
    }
    const order = idxs.map((idx,n)=>({idx,d:dists[n]})).sort((a,b)=>a.d-b.d).slice(0, Math.max(6,k));

    let wSum=0, cx=0, cy=0, cz=0;
    order.forEach(o=>{
      const w = Math.exp(-(o.d*o.d)/(h*h));
      wSum += w;
      cx += pts[o.idx][0]*w; cy += pts[o.idx][1]*w; cz += pts[o.idx][2]*w;
    });
    if (wSum < 1e-9) return p.slice();
    const centroid = [cx/wSum, cy/wSum, cz/wSum];
    const pull = 0.6;
    return [
      p[0]*(1-pull)+centroid[0]*pull,
      p[1]*(1-pull)+centroid[1]*pull,
      p[2]*(1-pull)+centroid[2]*pull,
    ];
  });
  return out;
}

/* ──────────────────────────────────────────────────────────────
   METRICS
────────────────────────────────────────────────────────────── */
function computeMetrics(keep, isOutlier) {
  let TP=0, FP=0, FN=0, TN=0;
  keep.forEach((k,i) => {
    const outlier = isOutlier[i];
    if (outlier && !k) TP++;
    else if (!outlier && !k) FP++;
    else if (outlier && k) FN++;
    else TN++;
  });
  const precision = (TP+FP) > 0 ? TP/(TP+FP) : 1;
  const recall    = (TP+FN) > 0 ? TP/(TP+FN) : 1;
  const f1 = (precision+recall) > 0 ? 2*precision*recall/(precision+recall) : 0;
  return { TP, FP, FN, TN, precision, recall, f1 };
}

/* ──────────────────────────────────────────────────────────────
   THREE.JS — SETUP SCENE
────────────────────────────────────────────────────────────── */
let renderer, scene, camera3d, animFrame;
let cloudGood, cloudBad, knnSphere, highlightPoint;
let proxySOR, proxyROR, proxyMLS;
let phi3d=Math.PI/4, theta3d=Math.PI/4, radius3d=1.6;
let isDragging=false, lastMouse={x:0,y:0};
let orbitTarget = new THREE.Vector3(0,0,0);

let setupData = null;

function initThree() {
  const canvas = document.getElementById('three-canvas');
  if(!canvas) return;
  const wrap = canvas.parentElement;

  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setClearColor(0xe8edf5, 0); // Transparent for background consistency
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

  setupData = generateNoisyCloud(1800, 0.15, 2);
  buildCloudMeshes();
  buildKnnSphere();
  buildProxies();

  setupOrbit(canvas);
  window.addEventListener('resize', resizeRenderer);
  loopThree();
}

function resizeRenderer() {
  const canvas = document.getElementById('three-canvas');
  if(!canvas) return;
  const wrap = canvas.parentElement;
  if(wrap.clientWidth===0) return;
  const w=wrap.clientWidth, h=wrap.clientHeight;
  renderer.setSize(w,h,false);
  if (camera3d){ camera3d.aspect=w/h; camera3d.updateProjectionMatrix(); }
}
function loopThree(){ animFrame=requestAnimationFrame(loopThree); updateOrbitCam(); renderer.render(scene,camera3d); }
function updateOrbitCam(){
  camera3d.position.set(
    orbitTarget.x + radius3d*Math.sin(phi3d)*Math.sin(theta3d),
    orbitTarget.y + radius3d*Math.cos(theta3d),
    orbitTarget.z + radius3d*Math.cos(phi3d)*Math.sin(theta3d)
  );
  camera3d.lookAt(orbitTarget);
}
function setCamISO(){ phi3d=Math.PI/4; theta3d=Math.PI/4; radius3d=1.6; }
function setCamTop(){ phi3d=0; theta3d=0.01; radius3d=1.8; }
function setCamFront(){ phi3d=0; theta3d=Math.PI/2; radius3d=1.6; }
function setCamSide(){ phi3d=Math.PI/2; theta3d=Math.PI/2; radius3d=1.6; }

function setupOrbit(canvas) {
  canvas.addEventListener('mousedown', e=>{isDragging=true; lastMouse={x:e.clientX,y:e.clientY};});
  window.addEventListener('mouseup', ()=>{isDragging=false;});
  window.addEventListener('mousemove', e=>{
    if(!isDragging) return;
    const dx=e.clientX-lastMouse.x, dy=e.clientY-lastMouse.y;
    lastMouse={x:e.clientX,y:e.clientY};
    if(e.buttons===1){
      phi3d -= dx*0.008; theta3d=Math.max(0.05,Math.min(Math.PI-0.05,theta3d+dy*0.008));
      document.querySelectorAll('.btn-preset').forEach(b=>b.classList.remove('active'));
    } else if(e.buttons===2){
      orbitTarget.x -= dx*0.0015; orbitTarget.y += dy*0.0015;
    }
  });
  canvas.addEventListener('wheel', e=>{e.preventDefault(); radius3d=Math.max(0.5,Math.min(4,radius3d+e.deltaY*0.002));}, {passive:false});
}

function buildCloudMeshes() {
  const good = setupData.pts.filter((_,i)=>!setupData.isOutlier[i]);
  const bad  = setupData.pts.filter((_,i)=>setupData.isOutlier[i]);

  const makePts = (arr, colour, size) => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(arr.length*3);
    arr.forEach((p,i)=>{ positions[i*3]=p[0]; positions[i*3+1]=p[2]; positions[i*3+2]=p[1]; });
    geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
    const mat = new THREE.PointsMaterial({ color:colour, size, sizeAttenuation:true });
    const pts = new THREE.Points(geo, mat);
    pts.visible = false;
    return pts;
  };

  cloudGood = makePts(good, 0xf59e0b, 0.011);
  cloudBad  = makePts(bad, 0xef4444, 0.014);
  scene.add(cloudGood); scene.add(cloudBad);
}

function buildKnnSphere() {
  const geo = new THREE.SphereGeometry(0.05, 20, 20);
  const mat = new THREE.MeshBasicMaterial({ color:0x7c3aed, transparent:true, opacity:0.14 });
  knnSphere = new THREE.Mesh(geo, mat);
  knnSphere.visible = false;
  scene.add(knnSphere);

  const hgeo = new THREE.SphereGeometry(0.012, 12, 12);
  const hmat = new THREE.MeshBasicMaterial({ color:0x2563eb });
  highlightPoint = new THREE.Mesh(hgeo, hmat);
  highlightPoint.visible = false;
  scene.add(highlightPoint);
}

function buildProxies() {
  const boxGeo = new THREE.BoxGeometry(0.12, 0.05, 0.08);
  const sorMat = new THREE.MeshStandardMaterial({color: 0xf59e0b, roughness: 0.8});
  proxySOR = new THREE.Mesh(boxGeo, sorMat);
  proxySOR.position.set(-0.8, 0.025, -0.8);
  proxySOR.visible = false;
  scene.add(proxySOR);

  const rorMat = new THREE.MeshStandardMaterial({color: 0x22c55e, roughness: 0.8});
  proxyROR = new THREE.Mesh(boxGeo, rorMat);
  proxyROR.position.set(-0.6, 0.025, -0.8);
  proxyROR.visible = false;
  scene.add(proxyROR);

  const mlsMat = new THREE.MeshStandardMaterial({color: 0x3b82f6, roughness: 0.8});
  proxyMLS = new THREE.Mesh(boxGeo, mlsMat);
  proxyMLS.position.set(-0.4, 0.025, -0.8);
  proxyMLS.visible = false;
  scene.add(proxyMLS);
}

function updateNeighbourhoodViz() {
  if (!setupData) return;
  const idx = Math.floor(setupData.pts.length*0.3);
  const p = setupData.pts[idx];
  highlightPoint.position.set(p[0], p[2], p[1]);

  if (SETUP.filterType===1) {
    knnSphere.scale.setScalar((SETUP.primary*0.01)/0.05); // using primary slider for viz scale loosely
  } else {
    const dists = kNearestDists(setupData.pts, idx, 10);
    const kth = dists[dists.length-1] || 0.05;
    knnSphere.scale.setScalar((kth + SETUP.primary*0.01)/0.05); // visual approximation
  }
  knnSphere.position.copy(highlightPoint.position);
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE — NAVIGATION
────────────────────────────────────────────────────────────── */
let setupRunResult = null;

function gotoSetupStep(n) {
  document.querySelectorAll('#controls-panel > .step-content').forEach((el,i)=>{
    el.classList.toggle('active', i===n);
  });
  document.getElementById('step-badge').textContent = `STEP ${n+1} OF 4`;
  
  if(n===0) {
    document.getElementById('wizard-title').textContent = 'Mount Components';
    document.getElementById('wizard-text').textContent = 'This experiment processes an existing noisy scan on a virtual bench. Mount each module to build the pipeline. Watch the 3D scene to see the module boxes and algorithm spheres appear as they are mounted.';
  } else if(n===1) {
    document.getElementById('wizard-title').textContent = 'Inspect Cloud';
    document.getElementById('wizard-text').textContent = 'Analyze the noise characteristics of the dataset before applying filters.';
  } else if(n===2) {
    document.getElementById('wizard-title').textContent = 'Configure Baseline Filter';
    document.getElementById('wizard-text').textContent = 'Choose an initial filtering algorithm and parameter set to run on the cloud.';
  } else if(n===3) {
    document.getElementById('wizard-title').textContent = 'Filter & Evaluate';
    document.getElementById('wiz-text').textContent = 'Review the performance of the filter on the initial dataset.';
  }

  if (n===3 && setupRunResult) { 
    populateResults(); 
  }
}

function populateResults() {
  if (!setupRunResult) return;
  const pLbl = document.getElementById('r-precision').parentElement.querySelector('.rcard-label');
  const rLbl = document.getElementById('r-recall').parentElement.querySelector('.rcard-label');
  const fLbl = document.getElementById('r-f1').parentElement.querySelector('.rcard-label');
  
  if (SETUP.filterType === 2) {
    pLbl.textContent = 'Precision';
    document.getElementById('r-precision').textContent = '—';
    rLbl.textContent = 'Recall';
    document.getElementById('r-recall').textContent = '—';
    fLbl.textContent = 'RMSE (Surface Error)';
    document.getElementById('r-f1').textContent = (setupRunResult.metrics.rmse*1000).toFixed(2) + ' mm';
  } else {
    pLbl.textContent = 'Precision';
    document.getElementById('r-precision').textContent = setupRunResult.metrics.precision.toFixed(2);
    rLbl.textContent = 'Recall';
    document.getElementById('r-recall').textContent = setupRunResult.metrics.recall.toFixed(2);
    fLbl.textContent = 'F1 Score';
    document.getElementById('r-f1').textContent = setupRunResult.metrics.f1.toFixed(2);
  }
}

function updateSliderFills() {
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const pct = ((val - min) / (max - min)) * 100;
    slider.parentNode.style.setProperty('--fill', pct + '%');
  });
}

/* ──────────────────────────────────────────────────────────────
   COMPONENT MOUNTING (Step 1)
────────────────────────────────────────────────────────────── */
let mountIdx = 0;
function mountNextComp() {
  if (mountIdx >= COMP_ORDER.length) return;
  
  const comp = COMP_ORDER[mountIdx];
  MOUNTED[comp] = true;
  
  // Show in scene
  if(comp === 'cloud') { cloudGood.visible=true; cloudBad.visible=true; }
  else if(comp === 'sor') {
    proxySOR.visible = true;
    knnSphere.material.color.setHex(0xf59e0b);
    knnSphere.visible=true; highlightPoint.visible=true; updateNeighbourhoodViz();
  }
  else if(comp === 'ror') {
    proxyROR.visible = true;
    knnSphere.material.color.setHex(0x22c55e);
  }
  else if(comp === 'mls') {
    proxyMLS.visible = true;
    knnSphere.material.color.setHex(0x3b82f6);
  }
  
  // UI update
  const card = document.querySelector(`.apparatus-card[data-comp="${comp}"]`);
  if (card) {
    card.classList.add('mounted');
    card.querySelector('.apparatus-status').textContent = 'Mounted';
  }
  showSpec(comp);
  
  const btn = document.getElementById('btn-mount');
  btn.classList.remove('btn-mount-anim');
  void btn.offsetWidth; // trigger reflow
  btn.classList.add('btn-mount-anim');

  mountIdx++;
  
  if (mountIdx < COMP_ORDER.length) {
    // Select next
    document.querySelectorAll('.apparatus-card').forEach(c=>c.classList.remove('selected'));
    document.querySelector(`.apparatus-card[data-comp="${COMP_ORDER[mountIdx]}"]`).classList.add('selected');
  } else {
    // Done
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg> All Mounted`;
    btn.classList.add('mounted');
    setTimeout(()=>gotoSetupStep(1), 500);
  }
}

function showSpec(comp) {
  document.querySelectorAll('.apparatus-card').forEach(c=>c.classList.remove('selected'));
  document.querySelector(`.apparatus-card[data-comp="${comp}"]`).classList.add('selected');

  const data = COMP_SPECS[comp];
  document.getElementById('spec-placeholder').style.display='none';
  document.getElementById('spec-table').style.display='table';
  document.getElementById('spec-desc').style.display='block';
  document.getElementById('spec-desc').textContent = data.desc;
  
  const tbody = document.getElementById('spec-tbody');
  tbody.innerHTML = '';
  data.specs.forEach(row => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<th>${row[0]}</th><td>${row[1]}</td>`;
    tbody.appendChild(tr);
  });
}

function resetSetup() {
  Object.keys(MOUNTED).forEach(k=>MOUNTED[k]=false);
  mountIdx = 0;
  if(cloudGood) cloudGood.visible=false;
  if(cloudBad) cloudBad.visible=false;
  if(knnSphere){ knnSphere.visible=false; highlightPoint.visible=false; }
  if(proxySOR) proxySOR.visible=false;
  if(proxyROR) proxyROR.visible=false;
  if(proxyMLS) proxyMLS.visible=false;

  document.querySelectorAll('.apparatus-card').forEach(c=>c.classList.remove('mounted', 'selected'));
  document.querySelector(`.apparatus-card[data-comp="cloud"]`).classList.add('selected');
  document.querySelectorAll('.apparatus-status').forEach(el=>el.textContent='Unmounted');

  const btn = document.getElementById('btn-mount');
  btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px;margin-right:4px"><path d="M12 5v14M5 12h14"/></svg> Mount Component`;
  btn.classList.remove('mounted');

  document.getElementById('spec-placeholder').style.display='block';
  document.getElementById('spec-table').style.display='none';
  document.getElementById('spec-desc').style.display='none';

  SETUP.filterType=0; SETUP.primary=2.0;
  document.getElementById('sr-filtertype').value=0;
  document.getElementById('sr-primary').value=2;
  document.getElementById('sv-filtertype').textContent='SOR';
  document.getElementById('sv-primary').textContent='α = 2.0';
  updateSliderFills();

  document.getElementById('processed-count').textContent='0';
  document.getElementById('processed-fill').style.width='0%';
  document.getElementById('r-precision').textContent='—';
  document.getElementById('r-recall').textContent='—';
  document.getElementById('r-f1').textContent='—';
  setupRunResult=null;
  gotoSetupStep(0);
}

/* ──────────────────────────────────────────────────────────────
   PAGE SWITCHING
────────────────────────────────────────────────────────────── */
function showSim() {
  document.getElementById('setup-view').classList.remove('active');
  document.getElementById('simulation-view').classList.add('active');
  cancelAnimationFrame(animFrame);
  SIM.algo = SETUP.filterType;
  document.getElementById('r-algo').value = SIM.algo;
  document.getElementById('pv-algo').textContent = ALGO_NAMES[SIM.algo];
  updateSliderFills();
  
  // Resize SIM canvases safely
  setTimeout(()=> {
    window.dispatchEvent(new Event('resize'));
    initSim();
  }, 50);
}
function showSetup() {
  document.getElementById('simulation-view').classList.remove('active');
  document.getElementById('setup-view').classList.add('active');
  setTimeout(()=> {
    resizeRenderer();
    loopThree();
  }, 50);
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION LOGIC
────────────────────────────────────────────────────────────── */
let SIM_DATA = null;
let SIM_KEEP = null;
let SIM_MLS_OUT = null;
let rotY=0.6, rotX=-0.3;
let simViewScale = 180;
let dragActive=false, lastM={x:0,y:0};
let dragGlobalBound=false;

function recomputeSim() {
  if (!SIM_DATA) SIM_DATA = generateNoisyCloud(500, 0.15, 2);
  const pts = SIM_DATA.pts;

  if (SIM.algo === 0) {
    const res = runSOR(pts, SIM.k, SIM.alpha);
    SIM_KEEP = res.keep;
    SIM_MLS_OUT = null;
  } else if (SIM.algo === 1) {
    const res = runROR(pts, SIM.radius/1000, SIM.nmin);
    SIM_KEEP = res.keep;
    SIM_MLS_OUT = null;
  } else {
    SIM_KEEP = pts.map(()=>true);
    SIM_MLS_OUT = runMLS(pts, SIM.k, SIM.bandwidth);
  }
}

function project(p, W, H, scale) {
  const cosY=Math.cos(rotY), sinY=Math.sin(rotY);
  const cosX=Math.cos(rotX), sinX=Math.sin(rotX);
  let x1=p[0]*cosY+p[2]*sinY, z1=-p[0]*sinY+p[2]*cosY;
  let y1=p[1]*cosX-z1*sinX, z2=p[1]*sinX+z1*cosX;
  return { x:W/2+x1*scale, y:H/2-y1*scale, depth:z2 };
}

function renderBeforeAfter(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#0f172a'; ctx.fillRect(0,0,W,H);

  const halfW=W/2;
  ctx.strokeStyle='#334155'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(halfW,0); ctx.lineTo(halfW,H); ctx.stroke();

  ctx.fillStyle='#94a3b8'; ctx.font='bold 9px DM Sans'; ctx.textAlign='center';
  ctx.fillText('BEFORE', halfW/2, 13);
  ctx.fillText('AFTER', halfW+halfW/2, 13);

  const scale = simViewScale;
  SIM_DATA.pts.forEach((p,i)=>{
    const proj=project(p, halfW, H, scale);
    ctx.fillStyle = SIM_DATA.isOutlier[i] ? '#ef4444' : '#f59e0b';
    ctx.beginPath(); ctx.arc(proj.x, proj.y, 1.3, 0, Math.PI*2); ctx.fill();
  });

  const afterPts = SIM.algo===2 ? SIM_MLS_OUT : SIM_DATA.pts.filter((_,i)=>SIM_KEEP[i]);
  afterPts.forEach(p=>{
    const proj=project(p, halfW, H, scale);
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath(); ctx.arc(proj.x+halfW, proj.y, 1.3, 0, Math.PI*2); ctx.fill();
  });
  ctx.textAlign='left';
}

function renderClassifyMap(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#0f172a'; ctx.fillRect(0,0,W,H);

  const scale = simViewScale * 2.11;
  const items = SIM_DATA.pts.map((p,i)=>{
    const proj=project(p,W,H,scale);
    let colour;
    const outlier=SIM_DATA.isOutlier[i], kept=SIM_KEEP[i];
    if (outlier && !kept) colour='#22c55e';       /* TP */
    else if (!outlier && !kept) colour='#ef4444'; /* FP */
    else if (outlier && kept) colour='#f59e0b';   /* FN */
    else colour='#475569';                        /* TN */
    return {proj, colour};
  });
  items.sort((a,b)=>b.proj.depth-a.proj.depth);
  items.forEach(it=>{
    ctx.fillStyle=it.colour;
    ctx.beginPath(); ctx.arc(it.proj.x, it.proj.y, 1.6, 0, Math.PI*2); ctx.fill();
  });

  ctx.fillStyle='#94a3b8'; ctx.font='9px JetBrains Mono';
  ctx.fillText(`${ALGO_NAMES[SIM.algo]} classification`, 8, H-8);
}

function renderHistogram(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const meanDists = SIM_DATA.pts.map((_,i)=>{
    const d=kNearestDists(SIM_DATA.pts, i, SIM.k);
    return d.reduce((a,b)=>a+b,0)/d.length;
  });
  const mu = meanDists.reduce((a,b)=>a+b,0)/meanDists.length;
  const variance = meanDists.reduce((a,b)=>a+(b-mu)*(b-mu),0)/meanDists.length;
  const sigma = Math.sqrt(variance);
  const threshold = mu + SIM.alpha*sigma;

  const padL=30,padT=10,padR=8,padB=20;
  const gW=W-padL-padR, gH=H-padT-padB;
  const maxD = Math.max(...meanDists)*1.05;

  const bins=28;
  const counts=new Array(bins).fill(0);
  meanDists.forEach(d=>{
    const bi=Math.min(bins-1, Math.floor((d/maxD)*bins));
    counts[bi]++;
  });
  const maxCount=Math.max(...counts,1);

  const barW = gW/bins;
  counts.forEach((c,i)=>{
    const h=(c/maxCount)*gH;
    const x=padL+i*barW;
    const binVal=(i/bins)*maxD;
    ctx.fillStyle = binVal > threshold ? '#ef4444' : '#60a5fa';
    ctx.fillRect(x, padT+gH-h, barW-1, h);
  });

  const threshX = padL + (threshold/maxD)*gW;
  ctx.strokeStyle='#7c3aed'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
  ctx.beginPath(); ctx.moveTo(threshX,padT); ctx.lineTo(threshX,padT+gH); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle='#7c3aed'; ctx.font='bold 8px DM Sans'; ctx.textAlign='center';
  ctx.fillText('μ+ασ', threshX, padT-1);

  ctx.fillStyle='#64748b'; ctx.font='8px DM Sans';
  ctx.fillText('mean neighbour distance', padL+gW/2, H-3);
  ctx.textAlign='left';
}

function renderPRCurve(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const padL=32,padT=10,padR=8,padB=20;
  const gW=W-padL-padR, gH=H-padT-padB;

  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){ const y=padT+gH*i/4; ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(padL+gW,y); ctx.stroke(); }

  const points=[];
  if (SIM.algo===0) {
    for (let a=0.5; a<=4; a+=0.25) {
      const res = runSOR(SIM_DATA.pts, SIM.k, a);
      const m = computeMetrics(res.keep, SIM_DATA.isOutlier);
      points.push({x:a, precision:m.precision, recall:m.recall, f1:m.f1});
    }
  } else if (SIM.algo===1) {
    for (let r=5; r<=60; r+=4) {
      const res = runROR(SIM_DATA.pts, r/1000, SIM.nmin);
      const m = computeMetrics(res.keep, SIM_DATA.isOutlier);
      points.push({x:r, precision:m.precision, recall:m.recall, f1:m.f1});
    }
  } else {
    for (let h=1; h<=30; h+=2) {
      points.push({x:h, precision:0.5+Math.random()*0.1, recall:0.5, f1:0.5});
    }
  }

  const maxX = points[points.length-1].x, minX = points[0].x;
  const drawLine = (key, colour) => {
    ctx.strokeStyle=colour; ctx.lineWidth=1.8; ctx.beginPath();
    points.forEach((p,i)=>{
      const x=padL+((p.x-minX)/(maxX-minX))*gW;
      const y=padT+gH-(p[key])*gH;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
  };
  drawLine('precision', '#7c3aed');
  drawLine('recall', '#0891b2');
  drawLine('f1', '#22c55e');

  ctx.font='8px DM Sans';
  ctx.fillStyle='#7c3aed'; ctx.fillText('Precision', padL+4, padT+10);
  ctx.fillStyle='#0891b2'; ctx.fillText('Recall', padL+4, padT+20);
  ctx.fillStyle='#22c55e'; ctx.fillText('F1', padL+4, padT+30);

  ctx.fillStyle='#64748b'; ctx.textAlign='center';
  ctx.fillText(SIM.algo===0?'α':(SIM.algo===1?'radius (mm)':'h (mm)'), padL+gW/2, H-3);
  ctx.textAlign='left';
}

function renderGauge(canvas, metrics) {
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);

  let quality = 50;
  if (metrics) {
    if (SIM.algo === 2) {
      quality = Math.max(0, 100 - (metrics.rmse*1000 / 15) * 100);
    } else {
      quality = metrics.f1 * 100;
    }
  }

  const cx=W/2,cy=H-8,r=H-16;
  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=10; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,2*Math.PI); ctx.stroke();
  const colour = quality>70?'#22c55e':quality>40?'#f59e0b':'#ef4444';
  const sweep=Math.PI+(quality/100)*Math.PI;
  ctx.strokeStyle=colour; ctx.lineWidth=10;
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,sweep); ctx.stroke();
  ctx.strokeStyle='#334155'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r-4)*Math.cos(sweep), cy+(r-4)*Math.sin(sweep)); ctx.stroke();
  ctx.fillStyle='#334155'; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();

  if (SIM.algo === 2) {
    document.getElementById('quality-label').textContent = `Accuracy = ${quality.toFixed(0)}%`;
    document.getElementById('quality-label').style.color = colour;
    document.getElementById('quality-sub').textContent =
      quality>70 ? 'Excellent surface adherence' :
      quality>40 ? 'Moderate deviation from surface' :
                   'Poor adherence / over-smoothed';
  } else {
    document.getElementById('quality-label').textContent = `F1 = ${quality.toFixed(0)}%`;
    document.getElementById('quality-label').style.color = colour;
    document.getElementById('quality-sub').textContent =
      quality>70 ? 'Balanced precision & recall' :
      quality>40 ? 'One-sided — adjust threshold' :
                   'Poor separation of noise vs signal';
  }
}

function renderStatsMini(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);
  const total = SIM_DATA.pts.length;
  const kept = SIM.algo===2 ? total : SIM_KEEP.filter(Boolean).length;
  const barW=W*0.6, barH=20, x=(W-barW)/2;
  ctx.fillStyle='#e2e8f0'; ctx.fillRect(x, 20, barW, barH);
  ctx.fillStyle='#7c3aed'; ctx.fillRect(x, 20, barW*(kept/total), barH);
  ctx.fillStyle='#64748b'; ctx.font='9px JetBrains Mono'; ctx.textAlign='center';
  ctx.fillText(`${kept} / ${total} pts retained`, W/2, 55);
  ctx.textAlign='left';
}

/* ──────────────────────────────────────────────────────────────
   FULL SIM UPDATE
────────────────────────────────────────────────────────────── */
let simUpdatePending = false;
function triggerSimUpdate() {
  if (simUpdatePending) return;
  simUpdatePending = true;
  requestAnimationFrame(() => {
    updateSim();
    simUpdatePending = false;
  });
}

function updateSim() {
  recomputeSim();

  const pLbl = document.getElementById('ro-precision').parentElement.querySelector('.ro-label');
  const rLbl = document.getElementById('ro-recall').parentElement.querySelector('.ro-label');
  const fLbl = document.getElementById('ro-f1').parentElement.querySelector('.ro-label');
  const tLbl = document.getElementById('ro-removed').parentElement.querySelector('.ro-label');

  let metrics = null;
  if (SIM.algo !== 2) {
    pLbl.textContent = 'Precision';
    rLbl.textContent = 'Recall';
    fLbl.textContent = 'F1 Score';
    tLbl.textContent = 'Removed';

    metrics = computeMetrics(SIM_KEEP, SIM_DATA.isOutlier);
    document.getElementById('ro-precision').textContent = metrics.precision.toFixed(2);
    document.getElementById('ro-recall').textContent = metrics.recall.toFixed(2);
    document.getElementById('ro-f1').textContent = metrics.f1.toFixed(2);
    document.getElementById('ro-f1').className = 'ro-val ' + (metrics.f1>0.7?'good':metrics.f1>0.4?'warn':'danger');
    document.getElementById('ro-removed').textContent = SIM_KEEP.filter(k=>!k).length;

    document.getElementById('cm-tp').textContent = metrics.TP;
    document.getElementById('cm-fp').textContent = metrics.FP;
    document.getElementById('cm-fn').textContent = metrics.FN;
    document.getElementById('cm-tn').textContent = metrics.TN;
  } else {
    pLbl.textContent = 'Precision';
    rLbl.textContent = 'Recall';
    fLbl.textContent = 'RMSE (Surface)';
    tLbl.textContent = 'Removed';

    document.getElementById('ro-precision').textContent = '—';
    document.getElementById('ro-recall').textContent = '—';
    document.getElementById('ro-removed').textContent = '0';
    document.getElementById('ro-f1').className = 'ro-val good';

    document.getElementById('cm-tp').textContent = '—';
    document.getElementById('cm-fp').textContent = '—';
    document.getElementById('cm-fn').textContent = '—';
    document.getElementById('cm-tn').textContent = '—';
  }

  const sorRes = runSOR(SIM_DATA.pts, SIM.k, SIM.alpha);
  const sorM = computeMetrics(sorRes.keep, SIM_DATA.isOutlier);
  const rorRes = runROR(SIM_DATA.pts, SIM.radius/1000, SIM.nmin);
  const rorM = computeMetrics(rorRes.keep, SIM_DATA.isOutlier);
  document.getElementById('bb-sorf1').textContent = sorM.f1.toFixed(2);
  document.getElementById('bb-rorf1').textContent = rorM.f1.toFixed(2);

  if (SIM.algo===2) {
    const genuineIdx = SIM_DATA.pts.map((_,i)=>i).filter(i=>!SIM_DATA.isOutlier[i]);
    let rmseSum=0;
    genuineIdx.forEach(i=>{
      const trueZ = surfaceZ(SIM_DATA.pts[i][0]/0.5+0.5, SIM_DATA.pts[i][1]/0.35+0.5);
      const err = SIM_MLS_OUT[i][2]-trueZ;
      rmseSum += err*err;
    });
    const rmse = Math.sqrt(rmseSum/genuineIdx.length);
    const rmseStr = (rmse*1000).toFixed(2)+' mm';
    document.getElementById('bb-mlsrmse').textContent = rmseStr;
    document.getElementById('ro-f1').textContent = rmseStr;
    metrics = { f1: 0, rmse: rmse };
  } else {
    document.getElementById('bb-mlsrmse').textContent = '—';
  }

  renderBeforeAfter(document.getElementById('cvs-beforeafter'));
  renderClassifyMap(document.getElementById('cvs-classify'));
  renderHistogram(document.getElementById('cvs-histogram'));
  renderPRCurve(document.getElementById('cvs-prcurve'));
  renderGauge(document.getElementById('gauge-canvas'), metrics);
  renderStatsMini(document.getElementById('cvs-stats-mini'));

  document.querySelectorAll('.ctrl-group').forEach(el=>el.classList.remove('lit'));
}

function setupClassifyDrag(canvas) {
  canvas.addEventListener('mousedown', e=>{dragActive=true; lastM={x:e.clientX,y:e.clientY};});
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    simViewScale -= e.deltaY * 0.5;
    simViewScale = Math.max(50, Math.min(800, simViewScale));
    renderBeforeAfter(document.getElementById('cvs-beforeafter'));
    renderClassifyMap(document.getElementById('cvs-classify'));
  }, {passive: false});
  let lt=null;
  canvas.addEventListener('touchstart', e=>{lt={x:e.touches[0].clientX,y:e.touches[0].clientY};});
  canvas.addEventListener('touchmove', e=>{
    e.preventDefault();
    if(!lt) return;
    const dx=e.touches[0].clientX-lt.x, dy=e.touches[0].clientY-lt.y;
    lt={x:e.touches[0].clientX,y:e.touches[0].clientY};
    rotY += dx*0.012; rotX = Math.max(-1.4,Math.min(1.4,rotX+dy*0.012));
    renderBeforeAfter(document.getElementById('cvs-beforeafter'));
    renderClassifyMap(document.getElementById('cvs-classify'));
  }, {passive:false});

  if (!dragGlobalBound) {
    dragGlobalBound = true;
    window.addEventListener('mouseup', ()=>{dragActive=false;});
    window.addEventListener('mousemove', e=>{
      if(!dragActive) return;
      const dx=e.clientX-lastM.x, dy=e.clientY-lastM.y;
      lastM={x:e.clientX,y:e.clientY};
      rotY += dx*0.01; rotX = Math.max(-1.4,Math.min(1.4,rotX+dy*0.01));
      renderBeforeAfter(document.getElementById('cvs-beforeafter'));
      renderClassifyMap(document.getElementById('cvs-classify'));
    });
  }
}

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

function initSim() {
  updateWizard();
  triggerSimUpdate();
}

/* ──────────────────────────────────────────────────────────────
   INIT & EVENT LISTENERS
────────────────────────────────────────────────────────────── */
function init() {
  // Show first page immediately
  document.getElementById('setup-view').classList.add('active');
  initThree();

  // Update slider fill on all inputs
  document.body.addEventListener('input', e => {
    if(e.target.matches('input[type="range"]')) {
      updateSliderFills();
    }
  });

  /* SETUP BINDINGS */
  document.getElementById('btn-mount').addEventListener('click', mountNextComp);
  document.querySelectorAll('.btn-reset-setup').forEach(btn => btn.addEventListener('click', resetSetup));
  
  document.getElementById('btn-next-2').addEventListener('click', ()=>gotoSetupStep(2));
  document.getElementById('btn-prev-2').addEventListener('click', ()=>gotoSetupStep(0));

  document.getElementById('btn-next-3').addEventListener('click', ()=>gotoSetupStep(3));
  document.getElementById('btn-prev-3').addEventListener('click', ()=>gotoSetupStep(1));

  document.getElementById('btn-prev-4').addEventListener('click', ()=>gotoSetupStep(2));
  
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

  document.querySelectorAll('.apparatus-card').forEach(card => {
    card.addEventListener('click', () => {
      showSpec(card.dataset.comp);
    });
  });

  document.getElementById('sr-filtertype').addEventListener('input', e=>{
    SETUP.filterType=parseInt(e.target.value);
    document.getElementById('sv-filtertype').textContent=ALGO_NAMES[SETUP.filterType];
    updateNeighbourhoodViz();
  });
  document.getElementById('sr-primary').addEventListener('input', e=>{
    SETUP.primary=parseFloat(e.target.value);
    const label = SETUP.filterType===0 ? `α = ${SETUP.primary.toFixed(1)}` :
                  SETUP.filterType===1 ? `r = ${(SETUP.primary*10).toFixed(0)} mm` :
                                          `h = ${(SETUP.primary*3).toFixed(0)} mm`;
    document.getElementById('sv-primary').textContent = label;
  });

  document.getElementById('btn-run-filter').addEventListener('click', () => {
    let count=0;
    const total=1800;
    const btn = document.getElementById('btn-run-filter');
    btn.disabled = true;
    const timer=setInterval(()=>{
      count += 180;
      if (count>=total) {
        count=total; clearInterval(timer);
        const k=10, alpha=SETUP.primary, radius=SETUP.primary*0.01, nmin=6;
        let metrics = null;
        if (SETUP.filterType===0) {
          const keep = runSOR(setupData.pts, k, alpha).keep;
          metrics = computeMetrics(keep, setupData.isOutlier);
          setupRunResult = { rejected: keep.filter(k=>!k).length, metrics };
        } else if (SETUP.filterType===1) {
          const keep = runROR(setupData.pts, radius, nmin).keep;
          metrics = computeMetrics(keep, setupData.isOutlier);
          setupRunResult = { rejected: keep.filter(k=>!k).length, metrics };
        } else {
          const keep = setupData.pts.map(()=>true);
          const mlsOut = runMLS(setupData.pts, k, SETUP.primary*3);
          const genuineIdx = setupData.pts.map((_,i)=>i).filter(i=>!setupData.isOutlier[i]);
          let rmseSum=0;
          genuineIdx.forEach(i=>{
            const trueZ = surfaceZ(setupData.pts[i][0]/0.5+0.5, setupData.pts[i][1]/0.35+0.5);
            const err = mlsOut[i][2]-trueZ;
            rmseSum += err*err;
          });
          const rmse = Math.sqrt(rmseSum/genuineIdx.length);
          metrics = { precision: 0, recall: 0, f1: 0, rmse: rmse };
          setupRunResult = { rejected: 0, metrics };
        }
        populateResults();
        btn.disabled = false;
      }
      document.getElementById('processed-count').textContent = count;
      document.getElementById('processed-fill').style.width = (count/total*100)+'%';
    }, 40);
  });

  document.getElementById('btn-launch-sim').addEventListener('click', showSim);

  /* SIMULATION BINDINGS */
  document.getElementById('btn-back-setup').addEventListener('click', showSetup);
  
  document.getElementById('r-algo').addEventListener('input', e=>{
    SIM.algo=parseInt(e.target.value);
    document.getElementById('pv-algo').textContent=ALGO_NAMES[SIM.algo];
    triggerSimUpdate();
  });
  document.getElementById('r-k').addEventListener('input', e=>{
    SIM.k=parseInt(e.target.value);
    document.getElementById('pv-k').textContent=SIM.k;
    triggerSimUpdate();
  });
  document.getElementById('r-alpha').addEventListener('input', e=>{
    SIM.alpha=parseFloat(e.target.value);
    document.getElementById('pv-alpha').textContent=SIM.alpha.toFixed(1);
    triggerSimUpdate();
  });
  document.getElementById('r-radius').addEventListener('input', e=>{
    SIM.radius=parseFloat(e.target.value);
    document.getElementById('pv-radius').textContent=SIM.radius+' mm';
    triggerSimUpdate();
  });
  document.getElementById('r-nmin').addEventListener('input', e=>{
    SIM.nmin=parseInt(e.target.value);
    document.getElementById('pv-nmin').textContent=SIM.nmin;
    triggerSimUpdate();
  });
  document.getElementById('r-bandwidth').addEventListener('input', e=>{
    SIM.bandwidth=parseFloat(e.target.value);
    document.getElementById('pv-bandwidth').textContent=SIM.bandwidth+' mm';
    triggerSimUpdate();
  });

  document.getElementById('wiz-next').addEventListener('click', ()=>{SIM.step=Math.min(SIM.step+1,WIZ.length-1); updateWizard();});
  document.getElementById('wiz-skip').addEventListener('click', ()=>{SIM.step=WIZ.length-1; updateWizard();});
  document.querySelectorAll('.wdot').forEach(d=>d.addEventListener('click', ()=>{SIM.step=parseInt(d.dataset.ws); updateWizard();}));

  document.getElementById('btn-sim-reset2').addEventListener('click', () => {
    SIM.algo=0; SIM.k=10; SIM.alpha=2.0; SIM.radius=15; SIM.nmin=6; SIM.bandwidth=6; SIM.step=0;
    document.getElementById('r-algo').value=0;
    document.getElementById('r-k').value=10;
    document.getElementById('r-alpha').value=2;
    document.getElementById('r-radius').value=15;
    document.getElementById('r-nmin').value=6;
    document.getElementById('r-bandwidth').value=6;
    document.getElementById('pv-algo').textContent='SOR';
    document.getElementById('pv-k').textContent='10';
    document.getElementById('pv-alpha').textContent='2.0';
    document.getElementById('pv-radius').textContent='15 mm';
    document.getElementById('pv-nmin').textContent='6';
    document.getElementById('pv-bandwidth').textContent='6 mm';
    rotY=0.6; rotX=-0.3;
    SIM_DATA = generateNoisyCloud(500, 0.15, 2);
    updateSliderFills();
    updateWizard(); triggerSimUpdate();
  });

  const ro=new ResizeObserver(()=>triggerSimUpdate());
  document.querySelectorAll('.sim-card').forEach(c=>ro.observe(c));

  updateSliderFills(); // initial fill states
  
  setupClassifyDrag(document.getElementById('cvs-beforeafter'));
  setupClassifyDrag(document.getElementById('cvs-classify'));

  // Set initial spec text
  document.getElementById('spec-placeholder').textContent = 'Click on a component in the right panel to view its specifications and theory of operation.';
}

window.addEventListener('load', init);
