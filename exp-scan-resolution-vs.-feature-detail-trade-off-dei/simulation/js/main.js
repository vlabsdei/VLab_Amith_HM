/* ================================================================
   EXPERIMENT 9 — SCAN RESOLUTION VS FEATURE DETAIL TRADE-OFF
   main.js — Three.js setup scene + real Δs/detection math
   ================================================================ */

'use strict';

const MOUNTED = { rail:false, sensor:false, target:false, gauge:false };
const COMP_ORDER = ['rail', 'sensor', 'target', 'gauge'];
const FEATURES_MM = [0.5, 1, 2, 4, 8];

const SETUP = { z: 1.0, fx: 700 };

const SIM = {
  z: 1.0,
  fx: 700,
  margin: 3.0,
  targetIdx: 2,
  noiseMode: 0,
  step: 0,
};

const WIZ = [
  {
    title: 'Sweep the Distance',
    text:  'Point spacing Δs = Z/fx grows linearly with distance. Watch the feature ladder change colour as you move the sensor away.',
    task:  '▶ Drag Z from 0.2m to 2.5m and watch the 2mm ridge cross into the red zone.',
    lit:   'pg-z',
  },
  {
    title: 'Compensate with Resolution',
    text:  'A higher fx (finer native resolution) extends the usable distance for a given feature. This is the direct trade against cost and coverage.',
    task:  '▶ At Z=2m, raise fx until the 1mm feature turns green again.',
    lit:   'pg-fx',
  },
  {
    title: 'Adjust the Safety Margin',
    text:  'The margin m controls how conservative the detection rule is. A low margin claims detection is possible closer to the true Nyquist-like limit, but with higher risk.',
    task:  '▶ Lower margin to 1.5x and watch Z_max increase — but check the probability zone chart.',
    lit:   'pg-margin',
  },
  {
    title: 'Reveal the Probabilistic Boundary',
    text:  'Switch on Alignment Jitter to see that detection right at the boundary is not a hard yes/no — it depends on exact grid alignment, exactly as the theory describes.',
    task:  '▶ Set Alignment Jitter to High and watch the ladder flicker for boundary-case features.',
    lit:   'pg-noise',
  },
];

/* ──────────────────────────────────────────────────────────────
   CORE MATH
────────────────────────────────────────────────────────────── */
function pointSpacingMm(zMeters, fx) { return (zMeters / fx) * 1000; }
function zMaxMeters(featureMm, margin, fx) { return ((featureMm / margin) * fx) / 1000; }

function detectionState(featureMm, dsMm, margin, jitterMode) {
  const ratio = featureMm / dsMm;
  if (jitterMode === 1) {
    if (ratio >= margin * 1.3) return 'detected';
    if (ratio <= margin * 0.6) return 'missed';
    const p = Math.max(0, Math.min(1, (ratio - margin*0.6) / (margin*1.3 - margin*0.6)));
    return Math.random() < p ? 'detected' : 'risky';
  }
  if (ratio >= margin) return 'detected';
  if (ratio >= margin*0.66) return 'risky';
  return 'missed';
}

/* ──────────────────────────────────────────────────────────────
   THREE.JS SETUP SCENE
────────────────────────────────────────────────────────────── */
let renderer, scene, camera3d, animFrame;
let sensorMesh, railMesh, targetMesh, fovCone, sampleGrid;
let phi3d=Math.PI/4, theta3d=Math.PI/4, radius3d=2.6;
let isDragging=false, lastMouse={x:0,y:0};
let orbitTarget=new THREE.Vector3(0,0.14,1.0);

function initThree() {
  const canvas = document.getElementById('three-canvas');
  if(!canvas) return;
  const wrap = canvas.parentElement;
  renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setClearColor(0xe8edf5,1);
  resizeRenderer();

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xe8edf5,4,14);
  camera3d = new THREE.PerspectiveCamera(42, wrap.clientWidth/wrap.clientHeight, 0.05, 20);
  setCamISO();

  scene.add(new THREE.AmbientLight(0xffffff,0.7));
  const sun = new THREE.DirectionalLight(0xffffff,0.85);
  sun.position.set(3,5,3);
  scene.add(sun);

  const grid = new THREE.GridHelper(6,20,0xb0bdd0,0xc8d4e0);
  grid.material.opacity = 0.5; grid.material.transparent = true;
  scene.add(grid);

  buildRail();
  buildSensor();
  buildTarget();
  buildFovCone();
  buildSampleGrid();

  setupOrbit(canvas);
  window.addEventListener('resize', resizeRenderer);
  loopThree();
}

function resizeRenderer(){
  if(!renderer) return;
  const wrap = document.getElementById('three-canvas').parentElement;
  if(wrap.clientWidth===0 || wrap.clientHeight===0) return;
  const w=wrap.clientWidth, h=wrap.clientHeight;
  renderer.setSize(w,h,false);
  if(camera3d){ camera3d.aspect = w/h; camera3d.updateProjectionMatrix(); }
}
function loopThree(){ 
  animFrame=requestAnimationFrame(loopThree); 
  updateOrbitCam(); 
  renderer.render(scene,camera3d); 
}
function updateOrbitCam(){
  camera3d.position.set(
    orbitTarget.x+radius3d*Math.sin(phi3d)*Math.sin(theta3d),
    orbitTarget.y+radius3d*Math.cos(theta3d),
    orbitTarget.z+radius3d*Math.cos(phi3d)*Math.sin(theta3d)
  );
  camera3d.lookAt(orbitTarget);
}
function setCamISO(){phi3d=Math.PI/4;theta3d=Math.PI/4;radius3d=2.6;}
function setCamTop(){phi3d=0;theta3d=0.01;radius3d=3.0;}
function setCamFront(){phi3d=0;theta3d=Math.PI/2;radius3d=2.6;}
function setCamSide(){phi3d=Math.PI/2;theta3d=Math.PI/2;radius3d=2.6;}

function setupOrbit(canvas){
  canvas.addEventListener('mousedown',e=>{isDragging=true;lastMouse={x:e.clientX,y:e.clientY};});
  window.addEventListener('mouseup',()=>{isDragging=false;});
  window.addEventListener('mousemove',e=>{
    if(!isDragging)return;
    const dx=e.clientX-lastMouse.x, dy=e.clientY-lastMouse.y;
    lastMouse={x:e.clientX,y:e.clientY};
    if(e.buttons===1){
      phi3d-=dx*0.008; theta3d=Math.max(0.05,Math.min(Math.PI-0.05,theta3d+dy*0.008));
      document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
    }
    else if(e.buttons===2){ orbitTarget.x-=dx*0.005; orbitTarget.y+=dy*0.005; }
  });
  canvas.addEventListener('wheel',e=>{
    e.preventDefault(); 
    radius3d=Math.max(1,Math.min(9,radius3d+e.deltaY*0.004));
  },{passive:false});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
}

function buildRail(){
  railMesh=new THREE.Group();
  const trackGeo=new THREE.BoxGeometry(0.08,0.03,3.5);
  const trackMat=new THREE.MeshPhongMaterial({color:0x64748b,shininess:50});
  railMesh.add(new THREE.Mesh(trackGeo,trackMat));
  railMesh.position.set(0,0.015,1.5);
  railMesh.visible=false;
  scene.add(railMesh);
}
function buildSensor(){
  sensorMesh=new THREE.Group();
  const bodyGeo=new THREE.BoxGeometry(0.16,0.11,0.11);
  const bodyMat=new THREE.MeshPhongMaterial({color:0x1c1c1c,shininess:50});
  sensorMesh.add(new THREE.Mesh(bodyGeo,bodyMat));
  const lensGeo=new THREE.CylinderGeometry(0.03,0.034,0.06,16);
  const lensMat=new THREE.MeshPhongMaterial({color:0x0a1a2e,shininess:180});
  const lens=new THREE.Mesh(lensGeo,lensMat);
  lens.rotation.x=Math.PI/2;
  lens.position.set(0,0,-0.07);
  sensorMesh.add(lens);
  sensorMesh.position.set(0,0.14,1.0);
  sensorMesh.visible=false;
  scene.add(sensorMesh);
}
function buildTarget(){
  targetMesh=new THREE.Group();
  const baseGeo=new THREE.BoxGeometry(0.5,0.02,0.14);
  const baseMat=new THREE.MeshPhongMaterial({color:0xf1c67a,shininess:20});
  targetMesh.add(new THREE.Mesh(baseGeo,baseMat));
  const heights=[0.004,0.007,0.011,0.016,0.022];
  const xs=[-0.19,-0.095,0,0.095,0.19];
  heights.forEach((h,i)=>{
    const ridgeGeo=new THREE.BoxGeometry(0.06,h,0.14);
    const ridgeMat=new THREE.MeshPhongMaterial({color:0xd97706,shininess:30});
    const ridge=new THREE.Mesh(ridgeGeo,ridgeMat);
    ridge.position.set(xs[i], 0.01 + h/2, 0);
    targetMesh.add(ridge);
  });
  targetMesh.rotation.x=Math.PI/2;
  targetMesh.position.set(0,0.14,0);
  targetMesh.visible=false;
  scene.add(targetMesh);
}
function buildFovCone(){
  const geo=new THREE.ConeGeometry(0.5,0.9,4,1,true);
  geo.rotateY(Math.PI/4);
  const mat=new THREE.MeshBasicMaterial({color:0x3b82f6,transparent:true,opacity:0.08,side:THREE.DoubleSide});
  fovCone=new THREE.Mesh(geo,mat);
  fovCone.visible=false;
  scene.add(fovCone);
}
function buildSampleGrid(){
  sampleGrid=new THREE.Group();
  targetMesh.add(sampleGrid);
}
function updateSampleGrid(zM, fx){
  sampleGrid.clear();
  const dsM = zM/fx;
  const spanX=0.46, spanZ=0.12;
  const nx=Math.max(2, Math.min(80, Math.round(spanX/dsM)));
  const nz=Math.max(2, Math.min(30, Math.round(spanZ/dsM)));
  const dotGeo=new THREE.SphereGeometry(0.002,4,4);
  const dotMat=new THREE.MeshBasicMaterial({color:0x2563eb});
  
  const xs=[-0.19,-0.095,0,0.095,0.19];
  const heights=[0.004,0.007,0.011,0.016,0.022];

  for(let i=0;i<=nx;i++){
    for(let j=0;j<=nz;j++){
      const x=-spanX/2+(i/nx)*spanX;
      const z=-spanZ/2+(j/nz)*spanZ;
      
      let y = 0.01;
      for(let k=0; k<5; k++){
        if(Math.abs(x - xs[k]) <= 0.03) {
          y = 0.01 + heights[k];
          break;
        }
      }
      
      const dot=new THREE.Mesh(dotGeo,dotMat);
      dot.position.set(x, y + 0.001, z);
      sampleGrid.add(dot);
    }
  }
}
function updateSensorAndCone(zM){
  if(!sensorMesh)return;
  sensorMesh.position.z = zM;
  sensorMesh.position.y = 0.14;
  
  if(fovCone) {
    fovCone.position.set(0, 0.14, zM/2);
    fovCone.rotation.x = Math.PI/2;
    fovCone.scale.set(0.7, zM/0.9, 0.35);
  }
}

/* ──────────────────────────────────────────────────────────────
   SETUP PAGE NAVIGATION & LOGIC
────────────────────────────────────────────────────────────── */
let currentStep=0;
let selectedComp='rail';

function gotoStep(n){
  n=Math.max(0,Math.min(3,n));
  currentStep=n;
  document.querySelectorAll('.step-content').forEach((el,i)=>{
    el.style.display = i===n ? 'block' : 'none';
    if(i===n) el.classList.add('active');
    else el.classList.remove('active');
  });
  
  document.getElementById('step-badge').textContent = `STEP ${n+1} OF 4`;
  if(n===3) populateResults();

  /* update titles */
  const titles = ['Equipment Tray', 'Position the Target', 'Sweep and Capture', 'Live Observations'];
  document.getElementById('wizard-title').textContent = titles[n];
  const texts = [
    'Mount each component to build a resolution-planning test bench.',
    'Set the initial scanning distance. Watch the point grid overlay on the target update live.',
    'Run an automated sweep across a range of distances, capturing which features remain detectable.',
    'Review the final observation summary before heading into the main simulation.'
  ];
  document.getElementById('wizard-text').textContent = texts[n];
}

function mountComponentAction(){
  if(!selectedComp) return;
  MOUNTED[selectedComp] = true;
  
  switch(selectedComp){
    case 'sensor': sensorMesh.visible=true; fovCone.visible=true; break;
    case 'rail':   railMesh.visible=true; break;
    case 'target': targetMesh.visible=true; updateSampleGrid(SETUP.z, SETUP.fx); break;
    case 'gauge':  break;
  }
  
  const card = document.querySelector(`.apparatus-card[data-comp="${selectedComp}"]`);
  if(card){
    card.classList.add('mounted');
    const st = card.querySelector('.apparatus-status');
    if(st) st.textContent = 'Mounted';
  }

  const unmounted = COMP_ORDER.filter(c => !MOUNTED[c]);
  if(unmounted.length > 0){
    selectComp(unmounted[0]);
  } else {
    selectedComp = null;
    document.querySelectorAll('.apparatus-card').forEach(c=>c.classList.remove('selected'));
    document.getElementById('btn-next-step1').disabled = false;
    document.getElementById('btn-mount').disabled = true;
    document.getElementById('btn-mount').textContent = 'All Mounted';
    setTimeout(()=>gotoStep(1), 500);
  }
}

function selectComp(c){
  if(MOUNTED[c]) return;
  selectedComp = c;
  document.querySelectorAll('.apparatus-card').forEach(card=>{
    card.classList.toggle('selected', card.dataset.comp === c);
  });
}

function populateResults(){
  const ds=pointSpacingMm(SETUP.z, SETUP.fx);
  let smallest='none';
  for(const f of FEATURES_MM){ if(f>=3*ds){smallest=f;break;} }
  const zmax1mm=zMaxMeters(1, 3, SETUP.fx);

  document.getElementById('r4-fx').textContent=SETUP.fx;
  document.getElementById('r4-z').textContent=SETUP.z.toFixed(2);
  document.getElementById('r4-spacing').textContent=ds.toFixed(3);
  document.getElementById('r4-smallest').textContent=smallest;
  document.getElementById('r4-zmax').textContent=zmax1mm.toFixed(2);
}

function resetSetup(){
  Object.keys(MOUNTED).forEach(k=>MOUNTED[k]=false);
  if(sensorMesh){sensorMesh.visible=false;fovCone.visible=false;}
  if(railMesh)railMesh.visible=false;
  if(targetMesh)targetMesh.visible=false;
  if(sampleGrid)sampleGrid.clear();

  document.querySelectorAll('.apparatus-card').forEach(c=>{
    c.classList.remove('mounted','selected');
    const st = c.querySelector('.apparatus-status');
    if(st) st.textContent = 'Unmounted';
  });
  
  const mBtn = document.getElementById('btn-mount');
  mBtn.disabled = false;
  mBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px;margin-right:4px"><path d="M12 5v14M5 12h14"/></svg> Mount Component';
  
  selectComp('rail');

  SETUP.z=1.0; SETUP.fx=700;
  document.getElementById('sr-z').value=1.0;
  document.getElementById('sv-z').textContent='1.0 m';
  updateSensorAndCone(SETUP.z);

  document.getElementById('sweep-count').textContent='0';
  document.getElementById('sweep-fill').style.width='0%';
  document.getElementById('btn-next-step1').disabled=true;
  document.getElementById('btn-next-obs').disabled=true;
  
  gotoStep(0);
}

/* ──────────────────────────────────────────────────────────────
   PAGE SWITCH
────────────────────────────────────────────────────────────── */
function showSim(){
  document.getElementById('setup-view').style.display='none';
  document.getElementById('simulation-view').style.display='flex';
  cancelAnimationFrame(animFrame);
  SIM.z=SETUP.z; SIM.fx=SETUP.fx;
  document.getElementById('r-z').value=SIM.z;
  document.getElementById('pv-z').textContent=SIM.z.toFixed(2)+' m';
  document.getElementById('r-fx').value=SIM.fx;
  document.getElementById('pv-fx').textContent=SIM.fx+' px';
  
  // Resize observers will fix the canvas sizing, but we should manually call it too
  setTimeout(initSim, 50);
}
function showSetup(){
  document.getElementById('simulation-view').style.display='none';
  document.getElementById('setup-view').style.display='flex';
  loopThree();
  resizeRenderer();
}

/* ──────────────────────────────────────────────────────────────
   SIM CANVAS RENDERERS
────────────────────────────────────────────────────────────── */
let rotY=0.6, rotX=-0.3, panX=0, panY=0, zoomScale=1200;
let dragActive=false, dragButton=0, lastM={x:0,y:0};

function project(p,W,H,scale){
  const cosY=Math.cos(rotY),sinY=Math.sin(rotY);
  const cosX=Math.cos(rotX),sinX=Math.sin(rotX);
  let x1=p[0]*cosY+p[2]*sinY, z1=-p[0]*sinY+p[2]*cosY;
  let y1=p[1]*cosX-z1*sinX, z2=p[1]*sinX+z1*cosX;
  return {x:W/2+x1*scale+panX,y:H/2-y1*scale+panY,depth:z2};
}

function render3DTarget(canvas){
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#0f172a'; ctx.fillRect(0,0,W,H);

  const ds=pointSpacingMm(SIM.z,SIM.fx)/1000;
  const scale=zoomScale;
  const xs=[-0.19,-0.095,0,0.095,0.19];
  const heights=[0.004,0.007,0.011,0.016,0.022];

  const ridgeItems=[];
  xs.forEach((x,i)=>{
    const h=heights[i];
    const corners=[[x-0.03,0,h],[x+0.03,0,h],[x+0.03,0,0],[x-0.03,0,0]];
    const projd=corners.map(c=>project(c,W,H,scale));
    ridgeItems.push({proj:projd, depth: projd.reduce((a,p)=>a+p.depth,0)/4, idx:i});
  });
  ridgeItems.sort((a,b)=>b.depth-a.depth);
  ridgeItems.forEach(it=>{
    const state = detectionState(FEATURES_MM[it.idx], ds*1000, SIM.margin, SIM.noiseMode);
    ctx.fillStyle = state==='detected' ? '#22c55e' : state==='risky' ? '#f59e0b' : '#ef4444';
    ctx.beginPath();
    ctx.moveTo(it.proj[0].x, it.proj[0].y);
    it.proj.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));
    ctx.closePath(); ctx.fill();
  });

  const nx = Math.max(4, Math.min(60, Math.round(0.5/ds)));
  ctx.fillStyle='#60a5fa';
  for(let i=0;i<=nx;i++){
    const x=-0.25+(i/nx)*0.5;
    const p=project([x,0.001,0.07],W,H,scale);
    ctx.beginPath(); ctx.arc(p.x,p.y,1,0,Math.PI*2); ctx.fill();
  }

  ctx.fillStyle='#94a3b8'; ctx.font='9px JetBrains Mono';
  ctx.fillText(`Δs=${(ds*1000).toFixed(3)}mm at Z=${SIM.z.toFixed(2)}m`, 8, H-8);
}

function renderLadder(canvas){
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const ds=pointSpacingMm(SIM.z,SIM.fx);
  const barH=H/5;
  FEATURES_MM.forEach((f,i)=>{
    const state=detectionState(f, ds, SIM.margin, SIM.noiseMode);
    const colour = state==='detected'?'#22c55e':state==='risky'?'#f59e0b':'#ef4444';
    const y=i*barH;
    const barW = Math.min(W-70, (f/ds)*18);
    ctx.fillStyle=colour;
    ctx.fillRect(60, y+barH*0.2, Math.max(3,barW), barH*0.6);
    ctx.fillStyle='#334155'; ctx.font='10px JetBrains Mono'; ctx.textAlign='right';
    ctx.fillText(f+'mm', 54, y+barH*0.55);

    const el = document.getElementById('fl-'+i);
    if (el) {
      el.textContent = state.toUpperCase();
      el.style.color = colour;
    }
  });

  const threshX = 60 + SIM.margin*18;
  ctx.strokeStyle='#7c3aed'; ctx.setLineDash([3,2]); ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(threshX,0); ctx.lineTo(threshX,H); ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign='left';
}

function renderSpacingCurve(canvas){
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const padL=34,padT=12,padR=8,padB=20;
  const gW=W-padL-padR, gH=H-padT-padB;

  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){const y=padT+gH*i/4; ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+gW,y);ctx.stroke();}

  const maxZ=3.0, maxDs=pointSpacingMm(maxZ,SIM.fx)*1.1;
  ctx.strokeStyle='#7c3aed'; ctx.lineWidth=1.8; ctx.beginPath();
  for(let i=0;i<=60;i++){
    const z=0.2+(i/60)*2.8;
    const ds=pointSpacingMm(z,SIM.fx);
    const x=padL+((z-0.2)/2.8)*gW;
    const y=padT+gH-Math.min(gH,(ds/maxDs)*gH);
    if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();

  const curDs=pointSpacingMm(SIM.z,SIM.fx);
  const curX=padL+((SIM.z-0.2)/2.8)*gW;
  const curY=padT+gH-Math.min(gH,(curDs/maxDs)*gH);
  ctx.fillStyle='#7c3aed';
  ctx.beginPath(); ctx.arc(curX,curY,4,0,Math.PI*2); ctx.fill();

  const target = FEATURES_MM[SIM.targetIdx];
  const requiredDs = target/SIM.margin;
  const reqY=padT+gH-Math.min(gH,(requiredDs/maxDs)*gH);
  ctx.strokeStyle='#ef4444'; ctx.setLineDash([3,2]); ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(padL,reqY); ctx.lineTo(padL+gW,reqY); ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle='#64748b'; ctx.font='8px DM Sans'; ctx.textAlign='center';
  ctx.fillText('distance Z (m)', padL+gW/2, H-4);
  ctx.textAlign='left';
}

function renderProbZone(canvas){
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.offsetWidth||canvas.width, H=canvas.offsetHeight||canvas.height;
  if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}
  ctx.fillStyle='#f8fafc'; ctx.fillRect(0,0,W,H);

  const padL=32,padT=12,padR=8,padB=20;
  const gW=W-padL-padR, gH=H-padT-padB;

  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=0.5;
  for(let i=0;i<=4;i++){const y=padT+gH*i/4;ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+gW,y);ctx.stroke();}

  ctx.strokeStyle='#22c55e'; ctx.lineWidth=1.8; ctx.beginPath();
  for(let i=0;i<=60;i++){
    const ratio=0.5+(i/60)*5.5;
    const p = 1/(1+Math.exp(-4*(ratio-SIM.margin)));
    const x=padL+(i/60)*gW;
    const y=padT+gH-p*gH;
    if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();

  const ds=pointSpacingMm(SIM.z,SIM.fx);
  const curRatio = FEATURES_MM[SIM.targetIdx]/ds;
  const curX=padL+((curRatio-0.5)/5.5)*gW;
  const curP=1/(1+Math.exp(-4*(curRatio-SIM.margin)));
  const curY=padT+gH-curP*gH;
  ctx.fillStyle= curP>0.7?'#22c55e':curP>0.3?'#f59e0b':'#ef4444';
  ctx.beginPath(); ctx.arc(Math.max(padL,Math.min(padL+gW,curX)),curY,5,0,Math.PI*2); ctx.fill();

  ctx.fillStyle='#64748b'; ctx.font='8px DM Sans'; ctx.textAlign='center';
  ctx.fillText('feature_size / Δs ratio', padL+gW/2, H-4);
  ctx.textAlign='left';
}

function renderGauge(canvas){
  if(!canvas) return;
  const ctx=canvas.getContext('2d');
  const W=canvas.width,H=canvas.height;
  ctx.clearRect(0,0,W,H);

  const ds=pointSpacingMm(SIM.z,SIM.fx);
  const ratio=FEATURES_MM[SIM.targetIdx]/ds;
  const confidence=Math.max(0,Math.min(100, (ratio/SIM.margin)*70));

  const cx=W/2,cy=H-8,r=H-16;
  ctx.strokeStyle='#e2e8f0'; ctx.lineWidth=10; ctx.lineCap='round';
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,2*Math.PI); ctx.stroke();
  const colour=confidence>=70?'#22c55e':confidence>=40?'#f59e0b':'#ef4444';
  const sweep=Math.PI+(confidence/100)*Math.PI;
  ctx.strokeStyle=colour; ctx.lineWidth=10;
  ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,sweep); ctx.stroke();
  ctx.strokeStyle='#334155'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(cx+(r-4)*Math.cos(sweep),cy+(r-4)*Math.sin(sweep)); ctx.stroke();
  ctx.fillStyle='#334155'; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();

  document.getElementById('quality-label').textContent=`${confidence.toFixed(0)}%`;
  document.getElementById('quality-label').style.color=colour;
  document.getElementById('quality-sub').textContent=
    confidence>=70 ? `${FEATURES_MM[SIM.targetIdx]}mm feature reliably detected` :
    confidence>=40 ? 'Boundary zone — detection uncertain' :
                     'Feature likely undetectable at this resolution';
}

/* ──────────────────────────────────────────────────────────────
   FULL SIM UPDATE
────────────────────────────────────────────────────────────── */
function updateSim(){
  const ds=pointSpacingMm(SIM.z,SIM.fx);
  const target=FEATURES_MM[SIM.targetIdx];
  const ratio=target/ds;
  const zmax=zMaxMeters(target, SIM.margin, SIM.fx);

  const roSp = document.getElementById('ro-spacing');
  if(roSp) roSp.textContent=ds.toFixed(3);
  const roRat = document.getElementById('ro-ratio');
  if(roRat) {
    roRat.textContent=ratio.toFixed(2);
    roRat.className='rc-value '+(ratio>=SIM.margin?'good':ratio>=SIM.margin*0.66?'warn':'danger');
  }
  const roZ = document.getElementById('ro-zmax');
  if(roZ) roZ.textContent=zmax.toFixed(2);

  const state=detectionState(target, ds, SIM.margin, SIM.noiseMode);
  const statusEl=document.getElementById('ro-status');
  if(statusEl){
    statusEl.textContent=state.toUpperCase();
    statusEl.style.color = state==='detected'?'#16a34a':state==='risky'?'#d97706':'#dc2626';
  }

  const bbPt = document.getElementById('bb-points');
  if(bbPt) bbPt.textContent = Math.round(Math.pow(0.5/(ds/1000), 2)).toLocaleString('en-IN');
  const bbTi = document.getElementById('bb-time');
  if(bbTi) bbTi.textContent = Math.pow((SIM.fx/700)*(1.0/SIM.z), 2).toFixed(2)+'x';
  const bbTr = document.getElementById('bb-tradeoff');
  if(bbTr) bbTr.textContent = ratio>=SIM.margin ? 'Detail favoured' : 'Coverage favoured';

  render3DTarget(document.getElementById('cvs-target3d'));
  renderLadder(document.getElementById('cvs-ladder'));
  renderSpacingCurve(document.getElementById('cvs-spacingcurve'));
  renderProbZone(document.getElementById('cvs-probzone'));
  renderGauge(document.getElementById('gauge-canvas'));

  document.querySelectorAll('.ctrl-group').forEach(el=>el.classList.remove('lit'));
}

function setup3DDrag(canvas){
  if(!canvas) return;
  canvas.addEventListener('mousedown',e=>{
    dragActive=true;
    dragButton=e.button;
    lastM={x:e.clientX,y:e.clientY};
  });
  window.addEventListener('mouseup',()=>{dragActive=false;});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  window.addEventListener('mousemove',e=>{
    if(!dragActive)return;
    const dx=e.clientX-lastM.x,dy=e.clientY-lastM.y;
    lastM={x:e.clientX,y:e.clientY};
    if (dragButton === 0) {
      rotY+=dx*0.01; rotX=Math.max(-1.4,Math.min(1.4,rotX+dy*0.01));
    } else if (dragButton === 2) {
      panX += dx; panY += dy;
    }
    render3DTarget(canvas);
  });
  canvas.addEventListener('wheel',e=>{
    e.preventDefault();
    zoomScale=Math.max(200, Math.min(5000, zoomScale - e.deltaY * 2));
    render3DTarget(canvas);
  },{passive:false});
  let lt=null;
  canvas.addEventListener('touchstart',e=>{lt={x:e.touches[0].clientX,y:e.touches[0].clientY};});
  canvas.addEventListener('touchmove',e=>{
    e.preventDefault();
    if(!lt)return;
    const dx=e.touches[0].clientX-lt.x,dy=e.touches[0].clientY-lt.y;
    lt={x:e.touches[0].clientX,y:e.touches[0].clientY};
    rotY+=dx*0.012; rotX=Math.max(-1.4,Math.min(1.4,rotX+dy*0.012));
    render3DTarget(canvas);
  },{passive:false});
}

/* ──────────────────────────────────────────────────────────────
   WIZARD
────────────────────────────────────────────────────────────── */
function updateWizard(){
  const step=Math.min(SIM.step,WIZ.length-1);
  const s=WIZ[step];
  
  const wTitle = document.getElementById('wiz-title');
  if(wTitle) wTitle.textContent=s.title;
  const wText = document.getElementById('wiz-text');
  if(wText) wText.textContent=s.text;
  const wTask = document.getElementById('wiz-task');
  if(wTask) wTask.textContent=s.task;

  document.querySelectorAll('.ctrl-group').forEach(el=>el.classList.remove('lit'));
  const lit=document.getElementById(s.lit);
  if(lit){lit.classList.add('lit'); lit.scrollIntoView({block:'nearest',behavior:'smooth'});}

  document.querySelectorAll('.wdot').forEach((d,i)=>{
    d.classList.remove('active','done');
    if(i===step)d.classList.add('active');
    if(i<step)d.classList.add('done');
  });
  const nxt=document.getElementById('wiz-next'), skp=document.getElementById('wiz-skip');
  if(nxt && skp){
    if(step>=WIZ.length-1){nxt.textContent='Explore Freely'; skp.style.display='none';}
    else {nxt.textContent='Next Step'; skp.style.display='';}
  }
}

/* ──────────────────────────────────────────────────────────────
   SIM INIT & CONTROLS
────────────────────────────────────────────────────────────── */
function initSim(){
  updateWizard();
  updateSim();
  setup3DDrag(document.getElementById('cvs-target3d'));

  const rZ = document.getElementById('r-z');
  if(rZ) rZ.addEventListener('input',e=>{
    SIM.z=parseFloat(e.target.value);
    document.getElementById('pv-z').textContent=SIM.z.toFixed(2)+' m';
    updateSim();
  });
  
  const rFx = document.getElementById('r-fx');
  if(rFx) rFx.addEventListener('input',e=>{
    SIM.fx=parseFloat(e.target.value);
    document.getElementById('pv-fx').textContent=SIM.fx+' px';
    updateSim();
  });
  
  const rMargin = document.getElementById('r-margin');
  if(rMargin) rMargin.addEventListener('input',e=>{
    SIM.margin=parseFloat(e.target.value);
    document.getElementById('pv-margin').textContent=SIM.margin.toFixed(1)+'x';
    updateSim();
  });
  
  const rTarget = document.getElementById('r-target');
  if(rTarget) rTarget.addEventListener('input',e=>{
    SIM.targetIdx=parseInt(e.target.value);
    document.getElementById('pv-target').textContent=FEATURES_MM[SIM.targetIdx]+' mm';
    updateSim();
  });
  
  const rNoise = document.getElementById('r-noise');
  if(rNoise) rNoise.addEventListener('input',e=>{
    SIM.noiseMode=parseInt(e.target.value);
    document.getElementById('pv-noise').textContent=SIM.noiseMode===0?'Low':'High';
    updateSim();
  });

  const wNext = document.getElementById('wiz-next');
  if(wNext) wNext.addEventListener('click',()=>{SIM.step=Math.min(SIM.step+1,WIZ.length-1);updateWizard();});
  const wSkip = document.getElementById('wiz-skip');
  if(wSkip) wSkip.addEventListener('click',()=>{SIM.step=WIZ.length-1;updateWizard();});
  
  document.querySelectorAll('.wdot').forEach(d=>d.addEventListener('click',()=>{SIM.step=parseInt(d.dataset.ws);updateWizard();}));

  const resetBtn = document.getElementById('btn-sim-reset2');
  if(resetBtn) resetBtn.addEventListener('click',resetSim);

  if(window.ResizeObserver) {
    const ro=new ResizeObserver(()=>updateSim());
    document.querySelectorAll('.canvas-card').forEach(c=>ro.observe(c));
  }

  /* live re-render loop for probabilistic mode so flicker is visible */
  setInterval(()=>{ if(SIM.noiseMode===1 && document.getElementById('simulation-view').style.display!=='none') updateSim(); }, 700);
}

function resetSim(){
  SIM.z=1.0; SIM.fx=700; SIM.margin=3.0; SIM.targetIdx=2; SIM.noiseMode=0; SIM.step=0;
  
  if(document.getElementById('r-z')) document.getElementById('r-z').value=1.0;
  if(document.getElementById('r-fx')) document.getElementById('r-fx').value=700;
  if(document.getElementById('r-margin')) document.getElementById('r-margin').value=3;
  if(document.getElementById('r-target')) document.getElementById('r-target').value=2;
  if(document.getElementById('r-noise')) document.getElementById('r-noise').value=0;
  
  if(document.getElementById('pv-z')) document.getElementById('pv-z').textContent='1.00 m';
  if(document.getElementById('pv-fx')) document.getElementById('pv-fx').textContent='700 px';
  if(document.getElementById('pv-margin')) document.getElementById('pv-margin').textContent='3.0x';
  if(document.getElementById('pv-target')) document.getElementById('pv-target').textContent='2 mm';
  if(document.getElementById('pv-noise')) document.getElementById('pv-noise').textContent='Low';
  
  rotY=0.6; rotX=-0.3; panX=0; panY=0; zoomScale=1200;
  updateWizard(); updateSim();
}

/* ──────────────────────────────────────────────────────────────
   INIT
────────────────────────────────────────────────────────────── */
function init(){
  initThree();

  const mountBtn = document.getElementById('btn-mount');
  if(mountBtn) mountBtn.addEventListener('click', mountComponentAction);
  
  document.querySelectorAll('.apparatus-card').forEach(card=>{
    card.addEventListener('click', () => selectComp(card.dataset.comp));
  });

  document.querySelectorAll('[data-next]').forEach(btn=>{
    btn.addEventListener('click',()=>gotoStep(parseInt(btn.dataset.next)));
  });
  document.querySelectorAll('[data-prev]').forEach(btn=>{
    btn.addEventListener('click',()=>gotoStep(parseInt(btn.dataset.prev)));
  });
  
  const bNext1 = document.getElementById('btn-next-step1');
  if(bNext1) bNext1.addEventListener('click', () => gotoStep(1));
  const bNext2 = document.getElementById('btn-next-step2');
  if(bNext2) bNext2.addEventListener('click', () => gotoStep(2));

  const srZ = document.getElementById('sr-z');
  if(srZ) srZ.addEventListener('input',e=>{
    SETUP.z=parseFloat(e.target.value);
    document.getElementById('sv-z').textContent=SETUP.z.toFixed(2)+' m';
    updateSensorAndCone(SETUP.z);
    updateSampleGrid(SETUP.z, SETUP.fx);
  });

  const btnSweep = document.getElementById('btn-sweep');
  if(btnSweep) btnSweep.addEventListener('click',()=>{
    let count=0; const total=12;
    const timer=setInterval(()=>{
      count++;
      const z=0.2+(count/total)*2.8;
      if(count>=total){ 
        clearInterval(timer); 
        document.getElementById('btn-next-obs').disabled=false; 
      }
      document.getElementById('sweep-count').textContent=count;
      document.getElementById('sweep-fill').style.width=(count/total*100)+'%';
    }, 150);
  });

  document.querySelectorAll('.view-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      switch(btn.dataset.view){
        case 'iso':setCamISO();break;
        case 'top':setCamTop();break;
        case 'front':setCamFront();break;
        case 'side':setCamSide();break;
      }
    });
  });

  const lSim = document.getElementById('btn-launch-sim');
  if(lSim) lSim.addEventListener('click',showSim);
  const bSet = document.getElementById('btn-back-setup');
  if(bSet) bSet.addEventListener('click',showSetup);
  const rSet = document.getElementById('btn-reset-setup');
  if(rSet) rSet.addEventListener('click',resetSetup);
  
  document.querySelectorAll('.btn-reset-local').forEach(btn=>{
    btn.addEventListener('click', resetSetup);
  });
  
  selectComp('rail');
  
  SETUP.z=1.0; SETUP.fx=700;
  updateSensorAndCone(SETUP.z);
  updateSampleGrid(SETUP.z, SETUP.fx);
}

window.addEventListener('load', init);
