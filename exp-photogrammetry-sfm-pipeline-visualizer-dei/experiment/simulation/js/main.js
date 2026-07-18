/* global THREE */
/* ================================================================
   EXPERIMENT 10 - PHOTOGRAMMETRY & SFM PIPELINE VISUALIZER
   main.js - Three.js scene (setup) + real SfM-style math
   ================================================================
     Epipolar consistency check (simplified 2D projective test)
     Bundle-adjustment-style iterative reprojection error reduction
     Triangulation-angle-based 3D uncertainty model
     Overlap-graph connectivity model for coverage gaps
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */
const MOUNTED = { camera:false, turntable:false, subject:false, reference:false };
const SETUP = { numCam:12, elevSpread:40 };

const SIM = {
  numImg: 12,
  overlap: 70,
  elevSpread: 40,
  falseMatch: 5,
  ransac: 1,
  step: 0,
};

const WIZ = [
  {
    title: 'Run the Sparse Pipeline',
    text:  'Press Run SfM Pipeline to detect features, match them, estimate poses, triangulate points, and run bundle adjustment - all six stages animate in sequence.',
    task:  '▶ Click "Run SfM Pipeline" and watch the stage checklist complete.',
    lit:   'pg-numimg',
  },
  {
    title: 'Break the Overlap',
    text:  'Reduce overlap below 40% and see gaps appear in dense coverage - surface regions that never achieved the minimum two-image visibility.',
    task:  '▶ Drop overlap to 25% and re-run. Check the coverage map for red gaps.',
    lit:   'pg-overlap',
  },
  {
    title: 'Flatten the Camera Ring',
    text:  'Set elevation spread to 0° - every camera views from the same height. Watch the top surface vanish from the dense reconstruction.',
    task:  '▶ Set elevation spread to 0° and check coverage on the object\'s top.',
    lit:   'pg-elev',
  },
  {
    title: 'Test RANSAC',
    text:  'Inject a high false-match rate, then toggle RANSAC off and on to see its outlier-rejection effect on reprojection error directly.',
    task:  '▶ Set false match rate to 30%, then compare RANSAC On vs Off.',
    lit:   'pg-ransac',
  },
];

/* ──────────────────────────────────────────────────────────────
   MATH HELPERS
────────────────────────────────────────────────────────────── */
function gauss(){ const u1=Math.max(1e-12,Math.random()); return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*Math.random()); }
function degToRad(d){ return d*Math.PI/180; }

/* Camera ring generator: returns array of {x,y,z, lookAt} around origin */
function generateCameraRing(n, elevDeg, radius) {
  const cams = [];
  for (let i=0;i<n;i++) {
    const az = (i/n) * Math.PI * 2;
    /* spiral up from 0 to elevDeg */
    const elevFrac = n>1 ? (i/(n-1)) : 0;
    const elev = degToRad(elevDeg*elevFrac);
    const x = radius*Math.cos(az)*Math.cos(elev);
    const z = radius*Math.sin(az)*Math.cos(elev);
    const y = 0.4 + radius*Math.sin(elev)*0.6;
    cams.push({x,y,z,az,elev});
  }
  return cams;
}

/* Simplified SfM quality model */
function runSfMModel(numImg, overlapPct, elevSpread, falseMatchPct, ransacOn) {
  /* sparse point count grows with images and overlap, saturates, and scales with elevation spread */
  const overlapFactor = Math.min(1, overlapPct/70);
  const elevFactor = 0.6 + 0.4 * Math.min(1, elevSpread/60);
  const basePts = numImg * 45 * overlapFactor;
  const sparsePoints = Math.round(basePts * (0.7 + 0.3*Math.min(1,numImg/15)) * elevFactor);

  /* reprojection error worsens with false matches, improves with RANSAC */
  const rawFalseImpact = falseMatchPct/100;
  const ransacCleanup = ransacOn ? 0.88 : 0.05; /* fraction of false matches successfully removed */
  const residualFalse = rawFalseImpact * (1-ransacCleanup);
  const reprojError = 0.25 + residualFalse*9 + gauss()*0.05;

  /* BA iterations scale with problem size */
  const iterations = Math.round(10 + numImg*numImg*0.35);

  /* coverage: depends on overlap (connectivity) and elevation spread (visibility) */
  const overlapCoverage = overlapPct<40 ? Math.max(20, overlapPct*1.6) : Math.min(98, 60+overlapPct*0.45);
  const elevPenalty = Math.max(0, 35 - elevSpread*0.6);
  const coverage = Math.max(15, Math.min(98, overlapCoverage - elevPenalty));

  return { sparsePoints, reprojError: Math.max(0.15,reprojError), iterations, coverage };
}

/* ──────────────────────────────────────────────────────────────
   THREE.JS - SETUP SCENE
────────────────────────────────────────────────────────────── */
let renderer, scene, camera3d, animFrame;
let turntableMesh, subjectMesh, referenceMesh, cameraRingGroup;
let phi3d=Math.PI/4, theta3d=Math.PI/4, radius3d=3.2;
let isDragging=false, lastMouse={x:0,y:0};
let orbitTarget=new THREE.Vector3(0,0.4,0);

function initThree() {
  const canvas=document.getElementById('three-canvas');
  const wrap=canvas.parentElement;
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setClearColor(0xe8edf5,1);
  resizeRenderer();

  scene=new THREE.Scene();
  scene.fog=new THREE.Fog(0xe8edf5,5,16);
  camera3d=new THREE.PerspectiveCamera(42, wrap.clientWidth/wrap.clientHeight, 0.05, 24);
  setCamISO();

  scene.add(new THREE.AmbientLight(0xffffff,0.7));
  const sun=new THREE.DirectionalLight(0xffffff,0.85);
  sun.position.set(3,6,3);
  scene.add(sun);

  const grid=new THREE.GridHelper(8,20,0xb0bdd0,0xc8d4e0);
  grid.material.opacity=0.5; grid.material.transparent=true;
  scene.add(grid);

  buildTurntable();
  buildSubject();
  buildReference();
  cameraRingGroup=new THREE.Group();
  scene.add(cameraRingGroup);

  setupOrbit(canvas);
  window.addEventListener('resize', resizeRenderer);
  loopThree();
}
function resizeRenderer(){
  const wrap=document.getElementById('three-canvas').parentElement;
  const w=wrap.clientWidth,h=wrap.clientHeight;
  renderer.setSize(w,h,false);
  if(camera3d){camera3d.aspect=w/h; camera3d.updateProjectionMatrix();}
}
function loopThree(){ animFrame=requestAnimationFrame(loopThree); updateOrbitCam(); renderer.render(scene,camera3d); }
function updateOrbitCam(){
  camera3d.position.set(
    orbitTarget.x+radius3d*Math.sin(phi3d)*Math.sin(theta3d),
    orbitTarget.y+radius3d*Math.cos(theta3d),
    orbitTarget.z+radius3d*Math.cos(phi3d)*Math.sin(theta3d)
  );
  camera3d.lookAt(orbitTarget);
}
function setCamISO(){phi3d=Math.PI/4;theta3d=Math.PI/4;radius3d=3.2;}
function setCamTop(){phi3d=0;theta3d=0.01;radius3d=3.6;}
function setCamFront(){phi3d=0;theta3d=Math.PI/2;radius3d=3.2;}
function setCamSide(){phi3d=Math.PI/2;theta3d=Math.PI/2;radius3d=3.2;}

function setupOrbit(canvas){
  canvas.addEventListener('mousedown',e=>{isDragging=true;lastMouse={x:e.clientX,y:e.clientY};});
  window.addEventListener('mouseup',()=>{isDragging=false;});
  window.addEventListener('mousemove',e=>{
    if(!isDragging)return;
    const dx=e.clientX-lastMouse.x,dy=e.clientY-lastMouse.y;
    lastMouse={x:e.clientX,y:e.clientY};
    if(e.buttons===1){phi3d-=dx*0.008;theta3d=Math.max(0.05,Math.min(Math.PI-0.05,theta3d+dy*0.008));document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));}
    else if(e.buttons===2){orbitTarget.x-=dx*0.005;orbitTarget.y+=dy*0.005;}
  });
  canvas.addEventListener('wheel',e=>{e.preventDefault();radius3d=Math.max(1.2,Math.min(11,radius3d+e.deltaY*0.005));},{passive:false});
  let lt=null,ltd=0;
  canvas.addEventListener('touchstart',e=>{
    if(e.touches.length===1){isDragging=true;lt={x:e.touches[0].clientX,y:e.touches[0].clientY};}
    else if(e.touches.length===2) ltd=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
  });
  canvas.addEventListener('touchend',()=>{isDragging=false;lt=null;});
  canvas.addEventListener('touchmove',e=>{
    e.preventDefault();
    if(e.touches.length===1&&isDragging&&lt){
      const dx=e.touches[0].clientX-lt.x,dy=e.touches[0].clientY-lt.y;
      lt={x:e.touches[0].clientX,y:e.touches[0].clientY};
      phi3d-=dx*0.01;theta3d=Math.max(0.05,Math.min(Math.PI-0.05,theta3d+dy*0.01));
    } else if(e.touches.length===2){
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      radius3d=Math.max(1.2,Math.min(11,radius3d*(ltd/d)));ltd=d;
    }
  },{passive:false});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
}

function buildTurntable(){
  turntableMesh=new THREE.Group();
  const discGeo=new THREE.CylinderGeometry(0.9,0.9,0.04,32);
  const discMat=new THREE.MeshPhongMaterial({color:0x94a3b8,shininess:40});
  turntableMesh.add(new THREE.Mesh(discGeo,discMat));
  const baseGeo=new THREE.CylinderGeometry(0.18,0.22,0.3,16);
  const baseMat=new THREE.MeshPhongMaterial({color:0x475569,shininess:30});
  const base=new THREE.Mesh(baseGeo,baseMat);
  base.position.y=-0.17;
  turntableMesh.add(base);
  turntableMesh.visible=false;
  scene.add(turntableMesh);
}
function buildSubject(){
  subjectMesh=new THREE.Group();
  const geo=new THREE.IcosahedronGeometry(0.42,1);
  const mat=new THREE.MeshPhongMaterial({color:0xd97706,shininess:30,flatShading:true});
  subjectMesh.add(new THREE.Mesh(geo,mat));
  subjectMesh.position.y=0.44;
  subjectMesh.visible=false;
  scene.add(subjectMesh);
}
function buildReference(){
  referenceMesh=new THREE.Group();
  const geo=new THREE.BoxGeometry(0.5,0.02,0.05);
  const mat=new THREE.MeshPhongMaterial({color:0x7c3aed,shininess:40});
  referenceMesh.add(new THREE.Mesh(geo,mat));
  /* tick marks */
  for(let i=0;i<=5;i++){
    const tGeo=new THREE.BoxGeometry(0.005,0.03,0.05);
    const tMat=new THREE.MeshBasicMaterial({color:0xffffff});
    const t=new THREE.Mesh(tGeo,tMat);
    t.position.set(-0.25+i*0.1,0.02,0);
    referenceMesh.add(t);
  }
  referenceMesh.position.set(0.65,0.03,0.55);
  referenceMesh.visible=false;
  scene.add(referenceMesh);
}

function buildCameraIcon(){
  const g=new THREE.Group();
  const bodyGeo=new THREE.BoxGeometry(0.09,0.06,0.06);
  const bodyMat=new THREE.MeshPhongMaterial({color:0x1e293b,shininess:50});
  g.add(new THREE.Mesh(bodyGeo,bodyMat));
  const lensGeo=new THREE.ConeGeometry(0.025,0.04,8);
  const lensMat=new THREE.MeshPhongMaterial({color:0x2563eb,shininess:120});
  const lens=new THREE.Mesh(lensGeo,lensMat);
  lens.rotation.x=Math.PI/2;
  lens.position.z=0.045;
  g.add(lens);
  return g;
}

function updateCameraRing(numCam, elevSpread) {
  cameraRingGroup.clear();
  const cams = generateCameraRing(numCam, elevSpread, 2.0);
  cams.forEach(c => {
    const icon = buildCameraIcon();
    icon.position.set(c.x, c.y, c.z);
    icon.lookAt(0, 0.4, 0);
    cameraRingGroup.add(icon);

    /* thin viewing line to centre */
    const lineGeo=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(c.x,c.y,c.z), new THREE.Vector3(0,0.4,0)
    ]);
    const lineMat=new THREE.LineBasicMaterial({color:0x93c5fd, transparent:true, opacity:0.35});
    cameraRingGroup.add(new THREE.Line(lineGeo,lineMat));
  });
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE NAVIGATION
────────────────────────────────────────────────────────────── */
let currentStep=0;
function gotoStep(n){
  n=Math.max(0,Math.min(4,n));
  currentStep=n;
  document.querySelectorAll('#wizard-panel .step-content').forEach((el,i)=>el.classList.toggle('active',i===n));
  document.querySelectorAll('#controls-panel .step-content').forEach((el,i)=>el.classList.toggle('active',i===n));
  // Update pill-shaped step-bar nodes
  document.querySelectorAll('#setup-step-bar .step-node').forEach((el,i)=>{
    el.classList.remove('active','done');
    if(i===n)el.classList.add('active');
    if(i<n)el.classList.add('done');
  });
  document.querySelectorAll('#setup-step-bar .step-line').forEach((el,i)=>{
    el.classList.toggle('done-line', i<n);
  });
  if(n>=4){document.getElementById('btn-launch-sim').disabled=false; populateResults();}
}

function populateResults() {
  const model = runSfMModel(SETUP.numCam, 70, SETUP.elevSpread, 5, true);
  document.getElementById('ro-setup-imgs').textContent = SETUP.numCam;
  document.getElementById('ro-setup-overlap').textContent = '~70';
  document.getElementById('ro-setup-elev').textContent = SETUP.elevSpread;
  document.getElementById('ro-setup-matches').textContent = (SETUP.numCam*35).toLocaleString('en-IN');
  document.getElementById('r-complete').textContent = model.coverage.toFixed(0);
}

/* ──────────────────────────────────────────────────────────────
   COMPONENT MOUNTING
────────────────────────────────────────────────────────────── */
function mountComp(name){
  MOUNTED[name]=true;
  switch(name){
    case 'camera':    updateCameraRing(SETUP.numCam, SETUP.elevSpread); break;
    case 'turntable': turntableMesh.visible=true; break;
    case 'subject':   subjectMesh.visible=true; break;
    case 'reference': referenceMesh.visible=true; break;
  }
  // Update apparatus card styling
  const card=document.querySelector(`.apparatus-card[data-comp="${name}"]`);
  if(card){
    card.classList.add('mounted');
    const status=card.querySelector('.apparatus-status');
    if(status)status.textContent='Mounted ✓';
  }
  const all=Object.values(MOUNTED).every(Boolean);
  if(all&&currentStep===0)setTimeout(()=>gotoStep(1),400);
}
function mountAll(){
  const unmounted = Object.keys(MOUNTED).filter(k=>!MOUNTED[k]);
  if(unmounted.length > 0) {
    const nextToMount = unmounted[0];
    mountComp(nextToMount);
    
    const remaining = Object.keys(MOUNTED).filter(k=>!MOUNTED[k]);
    const btn = document.getElementById('btn-mount-all');
    if(remaining.length > 0) {
      document.querySelectorAll('.apparatus-card').forEach(c=>c.classList.remove('selected'));
      const nextCard = document.querySelector(`.apparatus-card[data-comp="${remaining[0]}"]`);
      if(nextCard) {
        nextCard.classList.add('selected');
        updateSpecPanel(remaining[0]);
      }
    } else {
      if(btn) {
        btn.innerHTML = 'All Mounted ✓';
        btn.disabled = true;
      }
    }
  }
}

/* ──────────────────────────────────────────────────────────────
   PAGE SWITCHING
────────────────────────────────────────────────────────────── */
function showSim(){
  document.getElementById('setup-view').style.display='none';
  document.getElementById('simulation-view').style.display='flex';
  cancelAnimationFrame(animFrame);
  SIM.numImg=SETUP.numCam; SIM.elevSpread=SETUP.elevSpread;
  document.getElementById('r-numimg').value=SIM.numImg;
  document.getElementById('pv-numimg').textContent=SIM.numImg;
  document.getElementById('r-elev').value=SIM.elevSpread;
  document.getElementById('pv-elev').textContent=SIM.elevSpread+'°';
  initSim();
}
function showSetup(){
  document.getElementById('simulation-view').style.display='none';
  document.getElementById('setup-view').style.display='flex';
  loopThree();
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION CANVAS RENDERERS
────────────────────────────────────────────────────────────── */
let rotY=0.6, rotX=-0.3, dragActive=false, dragBtn=-1, lastM={x:0,y:0};
let panX=0, panY=112, zoomNet=1.0;
let SFM_RESULT = null;
let sparsePointsCache = [];

function project(p,W,H,scale){
  const cosY=Math.cos(rotY),sinY=Math.sin(rotY);
  const cosX=Math.cos(rotX),sinX=Math.sin(rotX);
  let x1=p[0]*cosY+p[2]*sinY, z1=-p[0]*sinY+p[2]*cosY;
  let y1=p[1]*cosX-z1*sinX, z2=p[1]*sinX+z1*cosX;
  return {x:W/2+panX+x1*scale*zoomNet,y:H/2+panY-y1*scale*zoomNet,depth:z2};
}

function generateSparsePointsCloud(n) {
  const pts=[];
  const maxElevRad = (SIM.elevSpread / 180) * Math.PI;
  const minU = -0.7; // Base of subject resting on turntable
  const maxU = Math.min(1.0, Math.sin(maxElevRad) + 0.2); // Visibility strictly depends on elevation spread
  
  for(let i=0;i<n;i++){
    const u = minU + Math.random()*(maxU - minU);
    const phi = Math.random()*Math.PI*2; 
    const r = Math.sqrt(1-u*u);
    const R = 0.35+gauss()*0.02;
    pts.push([R*r*Math.cos(phi), 0.4+R*u, R*r*Math.sin(phi)]);
  }
  return pts;
}

function renderNetwork(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const scale=280;
  const cams=generateCameraRing(SIM.numImg, SIM.elevSpread, 0.75);

  const items=[];
  cams.forEach(c=>{
    const proj=project([c.x,c.y,c.z],W,H,scale);
    items.push({type:'cam',proj});
  });
  sparsePointsCache.forEach(p=>{
    const proj=project(p,W,H,scale);
    items.push({type:'pt',proj});
  });
  items.sort((a,b)=>b.proj.depth-a.proj.depth);
  items.forEach(it=>{
    if(it.type==='cam'){
      ctx.fillStyle='#3b82f6';
      ctx.beginPath(); ctx.arc(it.proj.x,it.proj.y,3,0,Math.PI*2); ctx.fill();
    } else {
      ctx.fillStyle='#f59e0b';
      ctx.beginPath(); ctx.arc(it.proj.x,it.proj.y,1.3,0,Math.PI*2); ctx.fill();
    }
  });
  ctx.fillStyle='#64748b'; ctx.font='9px JetBrains Mono';
  ctx.fillText(`${SIM.numImg} cameras, ${sparsePointsCache.length} sparse pts`, 8, H-8);
}

function renderMatches(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const nMatches=60;
  const falseRate=SIM.falseMatch/100;
  const ransacCleanup=SIM.ransac ? 0.88 : 0.05;

  for(let i=0;i<nMatches;i++){
    const y1=20+(i/nMatches)*(H-40);
    const isFalse = Math.random()<falseRate;
    const detectedAsOutlier = isFalse && Math.random()<ransacCleanup;
    const x1=30+Math.random()*40, x2=W-70+Math.random()*40;
    const y2=y1+(isFalse?(Math.random()-0.5)*30:0);

    ctx.strokeStyle = isFalse ? (detectedAsOutlier?'#ef4444':'#f59e0b') : '#22c55e';
    ctx.lineWidth = isFalse && !detectedAsOutlier ? 1.5 : 0.8;
    ctx.globalAlpha = isFalse && detectedAsOutlier ? 0.3 : 0.85;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    ctx.globalAlpha=1;
  }

  ctx.fillStyle='#64748b'; ctx.font='9px JetBrains Mono';
  ctx.fillText(`false match rate ${SIM.falseMatch}%  |  RANSAC ${SIM.ransac?'ON':'OFF'}`, 8, H-8);
}

function renderBAConverge(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const padL=32,padT=12,padR=8,padB=20;
  const gW=W-padL-padR, gH=H-padT-padB;
  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){const y=padT+gH*i/4;ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+gW,y);ctx.stroke();}

  const finalErr = SFM_RESULT ? SFM_RESULT.reprojError : 3;
  const iters = SFM_RESULT ? SFM_RESULT.iterations : 50;
  const startErr = finalErr*6+2;

  ctx.strokeStyle='#7c3aed'; ctx.lineWidth=1.8; ctx.beginPath();
  for(let i=0;i<=50;i++){
    const t=i/50;
    const err = finalErr + (startErr-finalErr)*Math.exp(-t*5);
    const x=padL+t*gW;
    const y=padT+gH-Math.min(gH,(err/startErr)*gH);
    if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();

  ctx.fillStyle='#64748b'; ctx.font='8px DM Sans'; ctx.textAlign='center';
  ctx.fillText(`iterations (total: ${iters})`, padL+gW/2, H-4);
  ctx.textAlign='left';
  ctx.fillStyle='#7c3aed'; ctx.font='bold 10px DM Sans';
  ctx.fillText(`final: ${finalErr.toFixed(2)}px`, padL+6, padT+12);
}

function renderCoverage(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const coverage = SFM_RESULT ? SFM_RESULT.coverage : 50;
  const cols=20, rows=14;
  const cw=W/cols, ch=H/rows;
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      /* top rows more likely to be gap if elevation spread small */
      const isTopRow = r < rows*0.3;
      const elevGapChance = SIM.elevSpread<10 && isTopRow ? 0.75 : 0.05;
      const covered = Math.random()*100 < coverage && Math.random()>elevGapChance;
      ctx.fillStyle = covered ? '#22c55e' : '#ef4444';
      ctx.globalAlpha=0.8;
      ctx.fillRect(c*cw+1,r*ch+1,cw-2,ch-2);
      ctx.globalAlpha=1;
    }
  }
  ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillRect(0,H-16,W,16);
  ctx.fillStyle='#e2e8f0'; ctx.font='9px JetBrains Mono';
  ctx.fillText(`${coverage.toFixed(0)}% surface coverage`, 8, H-5);
}

function renderGauge(canvas) {
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);

  const quality = SFM_RESULT ?
    Math.max(0,Math.min(100, SFM_RESULT.coverage*0.6 + Math.max(0,(2-SFM_RESULT.reprojError))*20 )) : 0;

  const cx=W/2,cy=H-8,r=H-16;
  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=10; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,2*Math.PI); ctx.stroke();
  const colour=quality>65?'#22c55e':quality>35?'#f59e0b':'#ef4444';
  const sweep=Math.PI+(quality/100)*Math.PI;
  ctx.strokeStyle=colour; ctx.lineWidth=10;
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,sweep); ctx.stroke();
  ctx.strokeStyle='#334155'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r-4)*Math.cos(sweep),cy+(r-4)*Math.sin(sweep)); ctx.stroke();
  ctx.fillStyle='#334155'; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();

  document.getElementById('quality-label').textContent = SFM_RESULT ? `${quality.toFixed(0)}% quality` : '-';
  document.getElementById('quality-label').style.color = colour;
  document.getElementById('quality-sub').textContent = !SFM_RESULT ? 'Run the SfM pipeline' :
    quality>65 ? 'Solid reconstruction' :
    quality>35 ? 'Usable but imperfect' :
                 'Poor - adjust overlap/elevation';
}

/* ──────────────────────────────────────────────────────────────
   PIPELINE STAGE ANIMATION
────────────────────────────────────────────────────────────── */
function runSfMPipeline() {
  const stages=['ps-1','ps-2','ps-3','ps-4','ps-5','ps-6'];
  stages.forEach(id=>{ document.getElementById(id).textContent='Pending'; document.getElementById(id).style.color='#94a3b8'; });

  let i=0;
  const timer=setInterval(()=>{
    if(i<stages.length){
      document.getElementById(stages[i]).textContent='Done';
      document.getElementById(stages[i]).style.color='#16a34a';
      i++;
    } else {
      clearInterval(timer);
      SFM_RESULT = runSfMModel(SIM.numImg, SIM.overlap, SIM.elevSpread, SIM.falseMatch, SIM.ransac===1);
      sparsePointsCache = generateSparsePointsCloud(SFM_RESULT.sparsePoints);
      updateReadouts();
    }
  }, 220);
}

/* ──────────────────────────────────────────────────────────────
   MAIN SIM UPDATE
────────────────────────────────────────────────────────────── */
function updateReadouts() {
  if (SFM_RESULT) {
    SFM_RESULT = runSfMModel(SIM.numImg, SIM.overlap, SIM.elevSpread, SIM.falseMatch, SIM.ransac===1);
    sparsePointsCache = generateSparsePointsCloud(SFM_RESULT.sparsePoints);
  }

  if (!SFM_RESULT) {
    document.getElementById('ro-sparse').textContent='-';
    document.getElementById('ro-reproj').textContent='-';
    document.getElementById('ro-coverage').textContent='-';
    document.getElementById('ro-iterations').textContent='-';
  } else {
    document.getElementById('ro-sparse').textContent = SFM_RESULT.sparsePoints.toLocaleString('en-IN');
    const reEl=document.getElementById('ro-reproj');
    reEl.textContent=SFM_RESULT.reprojError.toFixed(2);
    reEl.className='rc-value '+(SFM_RESULT.reprojError<1?'good':SFM_RESULT.reprojError<3?'warn':'danger');
    const covEl=document.getElementById('ro-coverage');
    covEl.textContent=SFM_RESULT.coverage.toFixed(0);
    covEl.className='rc-value '+(SFM_RESULT.coverage>75?'good':SFM_RESULT.coverage>45?'warn':'danger');
    document.getElementById('ro-iterations').textContent=SFM_RESULT.iterations;
  }

  const scaleUnit = (450/100).toFixed(2);
  document.getElementById('bb-scaleunit').textContent = scaleUnit;
  document.getElementById('bb-scalefactor').textContent = (100/450).toFixed(3);

  renderNetwork(document.getElementById('cvs-network'));
  renderMatches(document.getElementById('cvs-matches'));
  renderBAConverge(document.getElementById('cvs-baconverge'));
  renderCoverage(document.getElementById('cvs-coverage'));
  renderGauge(document.getElementById('gauge-canvas'));

  document.querySelectorAll('.param-grp').forEach(el=>el.classList.remove('lit'));
}

function densifyReconstruction() {
  if (!SFM_RESULT) { runSfMPipeline(); return; }
  document.getElementById('ps-6').textContent='Densifying...';
  document.getElementById('ps-6').style.color='#7c3aed';
  setTimeout(()=>{
    document.getElementById('ps-6').textContent='Dense';
    document.getElementById('ps-6').style.color='#16a34a';
    sparsePointsCache = generateSparsePointsCloud(SFM_RESULT.sparsePoints*4);
    updateReadouts();
  }, 500);
}

function setupNetworkDrag(canvas) {
  canvas.addEventListener('mousedown',e=>{
    dragActive=true; 
    dragBtn=e.button; 
    lastM={x:e.clientX,y:e.clientY};
  });
  window.addEventListener('mouseup',()=>{dragActive=false;});
  window.addEventListener('mousemove',e=>{
    if(!dragActive)return;
    const dx=e.clientX-lastM.x,dy=e.clientY-lastM.y;
    lastM={x:e.clientX,y:e.clientY};
    
    if (dragBtn === 0) {
      rotY+=dx*0.01; rotX=Math.max(-1.4,Math.min(1.4,rotX+dy*0.01));
    } else if (dragBtn === 2) {
      panX += dx; panY += dy;
    }
    renderNetwork(canvas);
  });
  canvas.addEventListener('wheel', e=>{
    e.preventDefault();
    zoomNet *= (e.deltaY > 0 ? 0.9 : 1.1);
    zoomNet = Math.max(0.2, Math.min(zoomNet, 5));
    renderNetwork(canvas);
  });
  canvas.addEventListener('contextmenu', e=>e.preventDefault());
  let lt=null;
  canvas.addEventListener('touchstart',e=>{lt={x:e.touches[0].clientX,y:e.touches[0].clientY};});
  canvas.addEventListener('touchmove',e=>{
    e.preventDefault();
    if(!lt)return;
    const dx=e.touches[0].clientX-lt.x,dy=e.touches[0].clientY-lt.y;
    lt={x:e.touches[0].clientX,y:e.touches[0].clientY};
    rotY+=dx*0.012; rotX=Math.max(-1.4,Math.min(1.4,rotX+dy*0.012));
    renderNetwork(canvas);
  },{passive:false});
}

/* ──────────────────────────────────────────────────────────────
   COMPONENT SPECS
────────────────────────────────────────────────────────────── */
function updateSpecPanel(comp) {
  const container = document.getElementById('spec-content');
  if(!container) return;

  const specs = {
    camera: `
      <table class="spec-table">
        <tr><td>Sensor</td><td>Full-Frame CMOS (24MP)</td></tr>
        <tr><td>Lens</td><td>35mm Prime, f/8</td></tr>
        <tr><td>Lighting</td><td>Ring flash attached</td></tr>
      </table>
    `,
    turntable: `
      <table class="spec-table">
        <tr><td>Type</td><td>Motorised Indexing</td></tr>
        <tr><td>Diameter</td><td>50 cm</td></tr>
        <tr><td>Steps</td><td>36 positions (10° step)</td></tr>
      </table>
    `,
    subject: `
      <table class="spec-table">
        <tr><td>Material</td><td>Carved Stone (Matte)</td></tr>
        <tr><td>Size</td><td>~18 cm height</td></tr>
        <tr><td>Texture</td><td>High frequency, ideal</td></tr>
      </table>
    `,
    reference: `
      <table class="spec-table">
        <tr><td>Type</td><td>Encoded Scale Bar</td></tr>
        <tr><td>Length</td><td>100.00 mm (Certified)</td></tr>
        <tr><td>Markers</td><td>High contrast targets</td></tr>
      </table>
    `
  };

  if(specs[comp]) {
    container.innerHTML = specs[comp];
  } else {
    container.innerHTML = `<p class="specs-placeholder">Select a component to view specifications.</p>`;
  }
}

/* ──────────────────────────────────────────────────────────────
   WIZARD
────────────────────────────────────────────────────────────── */
function updateWizard() {
  const step=Math.min(SIM.step,WIZ.length-1);
  const s=WIZ[step];
  document.getElementById('wizard-title').textContent=s.title;
  document.getElementById('wizard-text').textContent=s.text;
  const task=document.getElementById('wizard-task');
  task.textContent=s.task;
  task.classList.toggle('hidden', !s.task);

  document.querySelectorAll('.ctrl-group').forEach(el=>el.classList.remove('lit'));
  const lit=document.getElementById(s.lit);
  if(lit){lit.classList.add('lit'); lit.scrollIntoView({block:'nearest',behavior:'smooth'});}

  // Update sim step-bar nodes
  document.querySelectorAll('#sim-step-bar .step-node').forEach((d,i)=>{
    d.classList.remove('active','done');
    if(i===step)d.classList.add('active');
    if(i<step)d.classList.add('done');
  });
  document.querySelectorAll('#sim-step-bar .step-line').forEach((el,i)=>{
    el.classList.toggle('done-line', i<step);
  });

  const nxt=document.getElementById('btn-next'), skp=document.getElementById('btn-skip');
  if(step>=WIZ.length-1){nxt.textContent='Explore Freely'; skp.style.display='none';}
  else {nxt.textContent='Next Step'; skp.style.display='';}
}

/* ──────────────────────────────────────────────────────────────
   SIM INIT & CONTROLS
────────────────────────────────────────────────────────────── */
let simInitialized = false;
function initSim() {
  SFM_RESULT=null;
  sparsePointsCache=generateSparsePointsCloud(120);
  updateWizard();
  updateReadouts();

  if (simInitialized) return;
  simInitialized = true;

  setupNetworkDrag(document.getElementById('cvs-network'));

  document.getElementById('r-numimg').addEventListener('input',e=>{
    SIM.numImg=parseInt(e.target.value);
    document.getElementById('pv-numimg').textContent=SIM.numImg;
    updateReadouts();
  });
  document.getElementById('r-overlap').addEventListener('input',e=>{
    SIM.overlap=parseFloat(e.target.value);
    document.getElementById('pv-overlap').textContent=SIM.overlap+'%';
    updateReadouts();
  });
  document.getElementById('r-elev').addEventListener('input',e=>{
    SIM.elevSpread=parseFloat(e.target.value);
    document.getElementById('pv-elev').textContent=SIM.elevSpread+'°';
    updateReadouts();
  });
  document.getElementById('r-falsematch').addEventListener('input',e=>{
    SIM.falseMatch=parseFloat(e.target.value);
    document.getElementById('pv-falsematch').textContent=SIM.falseMatch+'%';
    updateReadouts();
  });
  document.getElementById('r-ransac').addEventListener('input',e=>{
    SIM.ransac=parseInt(e.target.value);
    document.getElementById('pv-ransac').textContent=SIM.ransac?'On':'Off';
    updateReadouts();
  });

  document.getElementById('btn-run-sfm').addEventListener('click', runSfMPipeline);
  document.getElementById('btn-densify').addEventListener('click', densifyReconstruction);

  document.getElementById('btn-next').addEventListener('click',()=>{SIM.step=Math.min(SIM.step+1,WIZ.length-1);updateWizard();});
  document.getElementById('btn-skip').addEventListener('click',()=>{SIM.step=WIZ.length-1;updateWizard();});
  document.getElementById('btn-go-setup').addEventListener('click',showSetup);
  // Sim step-bar node clicks
  document.querySelectorAll('#sim-step-bar .step-node').forEach((d,i)=>d.addEventListener('click',()=>{SIM.step=i;updateWizard();}));

  ['btn-sim-reset','btn-sim-reset2'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.addEventListener('click',resetSim);
  });

  const ro=new ResizeObserver(()=>updateReadouts());
  document.querySelectorAll('.canvas-card').forEach(c=>ro.observe(c));
}

function resetSim() {
  SIM.numImg=12; SIM.overlap=70; SIM.elevSpread=40; SIM.falseMatch=5; SIM.ransac=1; SIM.step=0;
  document.getElementById('r-numimg').value=12;
  document.getElementById('r-overlap').value=70;
  document.getElementById('r-elev').value=40;
  document.getElementById('r-falsematch').value=5;
  document.getElementById('r-ransac').value=1;
  document.getElementById('pv-numimg').textContent='12';
  document.getElementById('pv-overlap').textContent='70%';
  document.getElementById('pv-elev').textContent='40°';
  document.getElementById('pv-falsematch').textContent='5%';
  document.getElementById('pv-ransac').textContent='On';
  ['ps-1','ps-2','ps-3','ps-4','ps-5','ps-6'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.textContent='-'; el.style.color='';}
    // Reset pipeline row classes
    const row=document.getElementById('ps-row-'+id.slice(-1));
    if(row){row.classList.remove('ps-done','ps-active');}
  });
  SFM_RESULT=null;
  rotY=0.6; rotX=-0.3;
  panX=0; panY=112; zoomNet=1.0;
  updateWizard(); updateReadouts();
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE RESET
────────────────────────────────────────────────────────────── */
function resetSetup() {
  Object.keys(MOUNTED).forEach(k=>MOUNTED[k]=false);
  if(cameraRingGroup) cameraRingGroup.clear();
  if(turntableMesh) turntableMesh.visible=false;
  if(subjectMesh) subjectMesh.visible=false;
  if(referenceMesh) referenceMesh.visible=false;

  // Reset apparatus cards
  document.querySelectorAll('.apparatus-card').forEach(card=>{
    card.classList.remove('mounted','selected');
    const status=card.querySelector('.apparatus-status');
    if(status)status.textContent='Unmounted';
  });
  document.querySelectorAll('.apparatus-card').forEach((card,i)=>{
    if(i===0)card.classList.add('selected');
  });
  updateSpecPanel('camera');

  const btnMount = document.getElementById('btn-mount-all');
  if(btnMount) {
    btnMount.disabled = false;
    btnMount.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px;margin-right:4px"><path d="M12 5v14M5 12h14"/></svg> Mount Component`;
  }

  SETUP.numCam=12; SETUP.elevSpread=40;
  document.getElementById('sr-numcam').value=12;
  document.getElementById('sv-numcam').textContent='12';
  document.getElementById('sr-elev').value=40;
  document.getElementById('sv-elev').textContent='40°';

  document.getElementById('capture-count').textContent='0';
  document.getElementById('capture-fill').style.width='0%';
  document.getElementById('btn-next-obs').disabled=true;
  document.getElementById('btn-go-sim').disabled=true;
  gotoStep(0);
}


/* ──────────────────────────────────────────────────────────────
   INIT
────────────────────────────────────────────────────────────── */
function init() {
  initThree();

  // Apparatus card click selection
  document.querySelectorAll('.apparatus-card').forEach(card=>{
    card.addEventListener('click',()=>{
      document.querySelectorAll('.apparatus-card').forEach(c=>c.classList.remove('selected'));
      card.classList.add('selected');
      // Show spec table for selected component
      const comp=card.dataset.comp;
      updateSpecPanel(comp);
    });
  });

  // Mount button on each apparatus card
  document.getElementById('btn-mount-all').addEventListener('click',mountAll);

  document.querySelectorAll('[data-next]').forEach(btn=>{
    btn.addEventListener('click',()=>gotoStep(parseInt(btn.dataset.next)));
  });
  document.querySelectorAll('[data-prev]').forEach(btn=>{
    btn.addEventListener('click',()=>gotoStep(parseInt(btn.dataset.prev)));
  });
  // Setup step-bar node clicks
  document.querySelectorAll('#setup-step-bar .step-node').forEach((el,i)=>{
    el.addEventListener('click',()=>gotoStep(i));
  });

  document.getElementById('sr-numcam').addEventListener('input',e=>{
    SETUP.numCam=parseInt(e.target.value);
    document.getElementById('sv-numcam').textContent=SETUP.numCam;
    if(MOUNTED.camera) updateCameraRing(SETUP.numCam, SETUP.elevSpread);
  });
  document.getElementById('sr-elev').addEventListener('input',e=>{
    SETUP.elevSpread=parseFloat(e.target.value);
    document.getElementById('sv-elev').textContent=SETUP.elevSpread+'°';
    if(MOUNTED.camera) updateCameraRing(SETUP.numCam, SETUP.elevSpread);
  });

  document.getElementById('btn-capture').addEventListener('click',()=>{
    let count=0; const total=SETUP.numCam;
    const timer=setInterval(()=>{
      count++;
      if(count>=total){clearInterval(timer); document.getElementById('btn-next-obs').disabled=false;}
      document.getElementById('capture-count').textContent=count;
      document.getElementById('capture-fill').style.width=(count/total*100)+'%';
    },130);
  });

  document.querySelectorAll('.btn-preset').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.btn-preset').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      switch(btn.dataset.view){
        case 'iso':setCamISO();break;
        case 'top':setCamTop();break;
        case 'front':setCamFront();break;
        case 'side':setCamSide();break;
      }
    });
  });

  const btnGoSim = document.getElementById('btn-go-sim');
  if(btnGoSim) btnGoSim.addEventListener('click',showSim);
  
  const btnLaunchSim = document.getElementById('btn-launch-sim');
  if(btnLaunchSim) btnLaunchSim.addEventListener('click',showSim);
  
  const btnGoSetup = document.getElementById('btn-go-setup');
  if(btnGoSetup) btnGoSetup.addEventListener('click',showSetup);

  const btnResetSetup = document.getElementById('btn-reset-setup');
  if(btnResetSetup) btnResetSetup.addEventListener('click',resetSetup);

  // Force reset DOM state to match JS state on page load (fixes browser caching slider positions)
  resetSetup();
  resetSim();
}

window.addEventListener('load', init);
