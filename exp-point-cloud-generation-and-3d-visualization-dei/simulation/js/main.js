'use strict';

/* ================================================================
   EXPERIMENT 3 — POINT CLOUD GENERATION SIMULATION
   main.js
   ================================================================ */

/* ──────────────────────────────────────────────────────────────
   GLOBAL STATE
────────────────────────────────────────────────────────────── */

const MOUNTED = { backdrop: false, mount: false, sensor: false, object: false };
let selectedComp = 'backdrop';
const MOUNT_SEQ = ['backdrop', 'mount', 'sensor', 'object'];

const SIM = {
  res: 1,      // 0=Sparse, 1=Medium, 2=High, 3=Heavy
  Z: 2.0,      // Object Distance (m)
  offsetX: 0.0,// Object Offset (m)
  noise: 3,    // Sensor noise sigma (mm)
  fx: 700,     // Focal length (px)
  flying: 1    // Edge Discontinuity (0-3)
};

const CARRIED_SETUP = {
  Z: 2.0,
  offsetX: 0.0,
  rotationY: 0.0,
  res: 1
};

// Simulation state calculated values
let spacing_mm = 0;
let density_km2 = 0;
let rmse_mm = 0;
let num_points = 0;

/* ──────────────────────────────────────────────────────────────
   THREE.JS SETUP (RIG VIEW)
────────────────────────────────────────────────────────────── */

let setupRenderer, setupScene, setupCamera, setupAnimFrame, sensorCamera;
let setupTarget = new THREE.Vector3(0, 1, 0);
let setupIsDragging = false, setupLastMouse = {x:0, y:0};
let setupPhi = Math.PI/4, setupTheta = Math.PI/3, setupRadius = 5.0;
let currentSetupView = 'iso';

// Meshes
let backdropMesh, mountMesh, sensorMesh, objectMesh, frustumHelper;

function initSetupThree() {
  const canvas = document.getElementById('setup-canvas-webgl');
  if (!canvas) return;
  const wrap = canvas.parentElement;

  setupRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  setupRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  setupRenderer.setSize(wrap.clientWidth, wrap.clientHeight, false);
  setupRenderer.shadowMap.enabled = true;

  setupScene = new THREE.Scene();
  setupScene.fog = new THREE.Fog(0xf8fafc, 5, 20);

  setupCamera = new THREE.PerspectiveCamera(45, wrap.clientWidth / wrap.clientHeight, 0.1, 50);

  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  setupScene.add(ambient);

  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  setupScene.add(dirLight);

  // Ground & Grid
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshLambertMaterial({ color: 0xe2e8f0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  setupScene.add(ground);

  const grid = new THREE.GridHelper(20, 40, 0x94a3b8, 0xcbd5e1);
  grid.material.opacity = 0.5;
  grid.material.transparent = true;
  setupScene.add(grid);

  // Build Setup Components
  buildBackdrop();
  buildMount();
  buildSensor();
  buildObject();

  // Orbit controls manually implemented
  setupOrbitControls(canvas);
  
  window.addEventListener('resize', () => {
    if(wrap.clientWidth === 0) return;
    setupRenderer.setSize(wrap.clientWidth, wrap.clientHeight, false);
    setupCamera.aspect = wrap.clientWidth / wrap.clientHeight;
    setupCamera.updateProjectionMatrix();
  });

  animateSetup();
}

function buildBackdrop() {
  backdropMesh = new THREE.Group();

  const geo = new THREE.BoxGeometry(4, 3, 0.1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.8, metalness: 0.1 });
  const wall = new THREE.Mesh(geo, mat);
  wall.castShadow = true;
  wall.receiveShadow = true;
  backdropMesh.add(wall);

  // Grid lines on the wall
  const wallGrid = new THREE.GridHelper(4, 16, 0x64748b, 0x64748b);
  wallGrid.rotation.x = Math.PI / 2;
  wallGrid.position.z = 0.051; // Slightly in front of the wall
  wallGrid.material.opacity = 0.5;
  wallGrid.material.transparent = true;
  backdropMesh.add(wallGrid);

  backdropMesh.position.set(0, 1.5, -4);
  backdropMesh.visible = false;
  setupScene.add(backdropMesh);
}

function buildMount() {
  mountMesh = new THREE.Group();
  const baseGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16);
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.5 });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.025;
  
  const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.2, 8);
  const pole = new THREE.Mesh(poleGeo, baseMat);
  pole.position.y = 0.6;
  
  mountMesh.add(base);
  mountMesh.add(pole);
  mountMesh.position.set(0, 0, 0);
  mountMesh.visible = false;
  setupScene.add(mountMesh);
}

function buildSensor() {
  sensorMesh = new THREE.Group();
  const bodyGeo = new THREE.BoxGeometry(0.3, 0.08, 0.08);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true;
  sensorMesh.add(body);
  
  // Dedicated Sensor Camera
  sensorCamera = new THREE.PerspectiveCamera(45, 1.0, 0.1, 10);
  sensorMesh.add(sensorCamera); // Inherits position and rotation (looking down -Z)

  sensorMesh.position.set(0, 1.24, 0);
  sensorMesh.visible = false;
  
  // Frustum Helper (Field of View)
  const fGeo = new THREE.ConeGeometry(2, 4, 4, 1, true);
  fGeo.rotateY(Math.PI/4);
  fGeo.translate(0, -2, 0);
  const fMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false });
  frustumHelper = new THREE.Mesh(fGeo, fMat);
  frustumHelper.rotation.x = Math.PI/2;
  frustumHelper.position.set(0, 0, -0.04);
  sensorMesh.add(frustumHelper);
  
  setupScene.add(sensorMesh);
}

function buildObject() {
  objectMesh = new THREE.Group();

  // Floor Z-rail
  const zRailGeo = new THREE.BoxGeometry(0.1, 0.02, 5.0);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.5, metalness: 0.6 });
  const zRail = new THREE.Mesh(zRailGeo, railMat);
  zRail.position.set(0, 0.01, -1.5);
  zRail.receiveShadow = true;
  zRail.castShadow = true;
  
  // T-Stand Group (moves along Z)
  const tStand = new THREE.Group();
  tStand.position.set(0, 0, -2.0); // Initial distance Z = 2.0
  tStand.name = "tStand";
  
  // Vertical Pole
  const vPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8);
  const vPole = new THREE.Mesh(vPoleGeo, railMat);
  vPole.position.set(0, 0.5, 0);
  vPole.castShadow = true;
  tStand.add(vPole);

  // Horizontal X-Rail
  const xRailGeo = new THREE.BoxGeometry(3.2, 0.04, 0.04);
  const xRail = new THREE.Mesh(xRailGeo, railMat);
  xRail.position.set(0, 1.0, 0);
  xRail.castShadow = true;
  tStand.add(xRail);

  // Target Car (moves along X on the X-rail)
  const targetCar = new THREE.Group();
  
  const carMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.2 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.1 });
  
  // Lower body
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.4), carMat);
  lowerBody.position.set(0, 0.1, 0);
  lowerBody.castShadow = true;
  lowerBody.receiveShadow = true;
  targetCar.add(lowerBody);
  
  // Upper body (cabin)
  const upperBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.35), carMat);
  upperBody.position.set(-0.05, 0.275, 0);
  upperBody.castShadow = true;
  upperBody.receiveShadow = true;
  targetCar.add(upperBody);
  
  // 4 Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelPositions = [
    [-0.25, 0.0, 0.2],
    [0.25, 0.0, 0.2],
    [-0.25, 0.0, -0.2],
    [0.25, 0.0, -0.2]
  ];
  wheelPositions.forEach(pos => {
    const wheel = new THREE.Mesh(wheelGeo, tireMat);
    wheel.position.set(pos[0], pos[1], pos[2]);
    wheel.castShadow = true;
    wheel.receiveShadow = true;
    targetCar.add(wheel);
  });
  
  targetCar.position.set(0, 1.24, 0); // Exact height as the sensor camera
  targetCar.name = "targetCar";
  tStand.add(targetCar);

  objectMesh.add(zRail);
  objectMesh.add(tStand);

  objectMesh.visible = false;
  setupScene.add(objectMesh);
}

function setupOrbitControls(canvas) {
  canvas.addEventListener('mousedown', e => {
    setupIsDragging = true;
    setupLastMouse = {x: e.clientX, y: e.clientY};
  });
  window.addEventListener('mouseup', () => { setupIsDragging = false; });
  window.addEventListener('mousemove', e => {
    if (!setupIsDragging) return;
    const dx = e.clientX - setupLastMouse.x;
    const dy = e.clientY - setupLastMouse.y;
    setupLastMouse = {x: e.clientX, y: e.clientY};

    if (e.buttons === 1) { // Orbit
      setupPhi -= dx * 0.01;
      setupTheta = Math.max(0.01, Math.min(Math.PI/2 - 0.01, setupTheta + dy * 0.01));
    } else if (e.buttons === 2) { // Pan
      setupTarget.x -= dx * 0.01;
      setupTarget.z -= dy * 0.01;
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    setupRadius = Math.max(1.5, Math.min(15, setupRadius + e.deltaY * 0.01));
  });
}

function animateSetup() {
  setupAnimFrame = requestAnimationFrame(animateSetup);
  const x = setupTarget.x + setupRadius * Math.sin(setupPhi) * Math.sin(setupTheta);
  const y = setupTarget.y + setupRadius * Math.cos(setupTheta);
  const z = setupTarget.z + setupRadius * Math.cos(setupPhi) * Math.sin(setupTheta);
  setupCamera.position.set(x, y, z);
  setupCamera.lookAt(setupTarget);
  setupRenderer.render(setupScene, setupCamera);
}

/* ──────────────────────────────────────────────────────────────
   SETUP UI LOGIC
────────────────────────────────────────────────────────────── */

function setupCameraPresets() {
  ['iso','top','front','side'].forEach(preset => {
    const btn = document.getElementById(`preset-${preset}`);
    if(btn) {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        if(preset === 'iso') { setupPhi=Math.PI/4; setupTheta=Math.PI/3; }
        if(preset === 'top') { setupPhi=Math.PI/2; setupTheta=0.01; }
        if(preset === 'front') { setupPhi=0; setupTheta=Math.PI/2; }
        if(preset === 'side') { setupPhi=Math.PI/2; setupTheta=Math.PI/2; }
        setupRadius = 5.0;
        setupTarget.set(0, 1.2, 0);
      });
    }
  });
}
setupCameraPresets();

function mountSetupComponent(name) {
  MOUNTED[name] = true;
  if(name === 'backdrop') backdropMesh.visible = true;
  if(name === 'mount') mountMesh.visible = true;
  if(name === 'sensor') sensorMesh.visible = true;
  if(name === 'object') objectMesh.visible = true;

  const card = document.querySelector(`.apparatus-card[data-comp="${name}"]`);
  if (card) {
    card.classList.add('mounted');
    const status = card.querySelector('.apparatus-status');
    if (status) status.textContent = 'Mounted ✓';
    card.style.borderColor = 'var(--green)';
    card.style.background = '#f0fdf4';
  }

  const allMounted = Object.values(MOUNTED).every(Boolean);
  if (allMounted) {
    const specContent = document.getElementById('spec-content');
    if (specContent) specContent.style.display = 'none';
    
    const panelHeadingText = document.getElementById('setup-panel-heading-text');
    if (panelHeadingText) panelHeadingText.textContent = 'Adjust Configuration';
    
    const sliderPanel = document.getElementById('setup-sliders-panel');
    if (sliderPanel) sliderPanel.style.display = 'flex';
  }
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION CANVAS VISUALIZATIONS
────────────────────────────────────────────────────────────── */

// Config limits
const RESOLUTIONS = [ [160, 120], [320, 240], [640, 480], [1280, 960] ];

/* Vis 1: Raw Depth Feed (2D) */
let rawOffscreenCanvas = document.createElement('canvas');
let rawOffscreenCtx = rawOffscreenCanvas.getContext('2d');

function drawRawDepth() {
  const canvas = document.getElementById('cvs-raw');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const rect = canvas.parentElement.getBoundingClientRect();
  if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height-30)) {
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height-30);
  }
  const W = canvas.width, H = canvas.height;

  const [cols, rows] = RESOLUTIONS[SIM.res];
  
  if (rawOffscreenCanvas.width !== cols || rawOffscreenCanvas.height !== rows) {
    rawOffscreenCanvas.width = cols;
    rawOffscreenCanvas.height = rows;
  }
  
  const imgData = rawOffscreenCtx.createImageData(cols, rows);
  const data = imgData.data;

  renderDepthMap(cols, rows); // Ensure depth map is up to date

  const sigmaM = (SIM.noise / 1000.0);
  
  let i = 0;
  for(let y=0; y<rows; y++) {
    for(let x=0; x<cols; x++) {
      const idx = ((rows - 1 - y) * cols + x) * 4;
      const r_d = depthBuffer[idx], g_d = depthBuffer[idx+1], b_d = depthBuffer[idx+2], a_d = depthBuffer[idx+3];
      
      let trueZ = 4.0;
      let hitObj = false;
      if (!(r_d === 0 && g_d === 0 && b_d === 0 && a_d === 0)) {
        const zNorm = (r_d/255.0) + (g_d/65025.0) + (b_d/16581375.0) + (a_d/4228250625.0);
        trueZ = 0.1 + zNorm * 9.9;
        if (trueZ < 3.5) hitObj = true;
      }

      const measuredZ = trueZ + (Math.random() - 0.5) * sigmaM * 2.5;
      let intensity = Math.max(0, Math.min(1, 1 - (measuredZ / 8.0)));
      
      if(hitObj) {
         data[i] = Math.floor(intensity * 255);
         data[i+1] = Math.floor(intensity * 200);
         data[i+2] = Math.floor(intensity * 100);
      } else {
         const v = Math.floor(intensity * 255);
         data[i] = v;
         data[i+1] = v;
         data[i+2] = v;
      }
      data[i+3] = 255; // Alpha
      i += 4;
    }
  }
  
  rawOffscreenCtx.putImageData(imgData, 0, 0);
  ctx.clearRect(0, 0, W, H);
  
  // To avoid blurry scaling, disable image smoothing
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(rawOffscreenCanvas, 0, 0, W, H);
}

/* Vis 2: Interactive Point Cloud (3D) */
let pcScene, pcCamera, pcRenderer, pcAnimFrame, pointCloudMesh;
let pcPhi = 0.5, pcTheta = 1.0, pcRadius = 5.0;
let pcTargetX = 0, pcTargetY = 0, pcTargetZ = -2;
let pcIsDragging = false, pcLastMouse = {x:0, y:0}, pcButton = 0;

function initPointCloud() {
  const canvas = document.getElementById('cvs-cloud3d');
  if(!canvas || pcRenderer) return;
  
  pcRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  pcScene = new THREE.Scene();
  pcCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 50);

  // Setup simple controls
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => { pcIsDragging = true; pcLastMouse = {x:e.clientX, y:e.clientY}; pcButton = e.buttons; });
  window.addEventListener('mouseup', () => pcIsDragging = false);
  window.addEventListener('mousemove', e => {
    if(!pcIsDragging) return;
    const dx = e.clientX - pcLastMouse.x;
    const dy = e.clientY - pcLastMouse.y;
    pcLastMouse = {x:e.clientX, y:e.clientY};
    if(pcButton === 1) { // Left click: Orbit
      pcPhi -= dx * 0.01;
      pcTheta = Math.max(0.01, Math.min(Math.PI-0.01, pcTheta + dy * 0.01));
    } else if(pcButton === 2) { // Right click: Pan
      pcTargetX -= dx * 0.01;
      pcTargetY += dy * 0.01;
    }
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); pcRadius = Math.max(1, Math.min(20, pcRadius + e.deltaY * 0.005)); });

  const grid = new THREE.GridHelper(10, 10, 0x94a3b8, 0xcbd5e1);
  grid.position.y = -1.5;
  pcScene.add(grid);

  animatePointCloud();
}

/* --- WebGL Depth Engine --- */
let depthScene, depthCamera, depthRenderTarget;
let depthWall, depthCar;
let depthMaterial;
let depthBuffer;

function initDepthEngine() {
  depthScene = new THREE.Scene();
  depthScene.background = new THREE.Color(0x000000);
  
  depthCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
  
  depthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      near: { value: 0.1 },
      far: { value: 10.0 }
    },
    vertexShader: `
      varying float vZ;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vZ = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float near;
      uniform float far;
      varying float vZ;
      vec4 packFloatToRGBA(float v) {
        vec4 enc = vec4(1.0, 255.0, 65025.0, 16581375.0) * v;
        enc = fract(enc);
        enc -= enc.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0);
        return enc;
      }
      void main() {
        float zNorm = (vZ - near) / (far - near);
        gl_FragColor = packFloatToRGBA(zNorm);
      }
    `
  });

  depthCar = new THREE.Group();
  
  const lowerBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.4), depthMaterial);
  lowerBody.position.set(0, 0.1, 0);
  depthCar.add(lowerBody);
  
  const upperBody = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.15, 0.35), depthMaterial);
  upperBody.position.set(-0.05, 0.275, 0);
  depthCar.add(upperBody);
  
  const wheelGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16);
  wheelGeo.rotateX(Math.PI / 2);
  const wheelPositions = [
    [-0.25, 0.0, 0.2], [0.25, 0.0, 0.2],
    [-0.25, 0.0, -0.2], [0.25, 0.0, -0.2]
  ];
  wheelPositions.forEach(pos => {
    const wheel = new THREE.Mesh(wheelGeo, depthMaterial);
    wheel.position.set(pos[0], pos[1], pos[2]);
    depthCar.add(wheel);
  });
  
  depthCar.position.set(0, 1.24, -2.0);
  depthScene.add(depthCar);

  depthWall = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 0.1), depthMaterial);
  depthWall.position.set(0, 1.24, -4.0);
  depthScene.add(depthWall);

  depthCamera.position.set(0, 1.24, 0);
  depthCamera.lookAt(0, 1.24, -1);
}

function renderDepthMap(cols, rows) {
  if(!depthScene) initDepthEngine();

  if (!depthRenderTarget || depthRenderTarget.width !== cols || depthRenderTarget.height !== rows) {
    if (depthRenderTarget) depthRenderTarget.dispose();
    depthRenderTarget = new THREE.WebGLRenderTarget(cols, rows, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType
    });
    depthBuffer = new Uint8Array(cols * rows * 4);
  }

  depthCar.position.z = -SIM.Z;
  depthCar.position.x = SIM.offsetX;
  depthCar.rotation.y = THREE.MathUtils.degToRad(CARRIED_SETUP.rotationY);

  // Three.js fov is VERTICAL FOV in degrees. 
  // Assuming 640x480 nominal sensor, H/2 = 240.
  depthCamera.fov = 2 * Math.atan(240 / SIM.fx) * (180 / Math.PI);
  depthCamera.aspect = cols / rows;
  depthCamera.updateProjectionMatrix();

  pcRenderer.setRenderTarget(depthRenderTarget);
  pcRenderer.render(depthScene, depthCamera);
  pcRenderer.setRenderTarget(null);

  pcRenderer.readRenderTargetPixels(depthRenderTarget, 0, 0, cols, rows, depthBuffer);
}

function updatePointCloud() {
  if(!pcScene) return;
  
  const [cols, rows] = RESOLUTIONS[SIM.res];
  num_points = cols * rows;

  renderDepthMap(cols, rows);

  let positions, colors;
  let isReused = false;

  if (pointCloudMesh && pointCloudMesh.geometry.attributes.position.count === num_points) {
    positions = pointCloudMesh.geometry.attributes.position.array;
    colors = pointCloudMesh.geometry.attributes.color.array;
    isReused = true;
  } else {
    if(pointCloudMesh) {
      pcScene.remove(pointCloudMesh);
      pointCloudMesh.geometry.dispose();
      pointCloudMesh.material.dispose();
    }
    positions = new Float32Array(num_points * 3);
    colors = new Float32Array(num_points * 3);
  }

  const cx = cols/2;
  const cy = rows/2;
  const fx = SIM.fx * (cols/320); // Scale focal length to match current resolution grid
  const fy = fx;
  const noiseM = SIM.noise / 1000.0;
  
  let i = 0;
  for(let y=0; y<rows; y++) {
    for(let x=0; x<cols; x++) {
      const idx = ((rows - 1 - y) * cols + x) * 4;
      const r_d = depthBuffer[idx];
      const g_d = depthBuffer[idx+1];
      const b_d = depthBuffer[idx+2];
      const a_d = depthBuffer[idx+3];
      
      let trueZ;
      let isHit = true;
      if (r_d === 0 && g_d === 0 && b_d === 0 && a_d === 0) { // Black background = no hit
        trueZ = 4.0; // fallback to back wall
        isHit = false;
      } else {
        const zNorm = (r_d/255.0) + (g_d/65025.0) + (b_d/16581375.0) + (a_d/4228250625.0);
        trueZ = 0.1 + zNorm * (10.0 - 0.1);
      }

      // Flying pixels at edges
      if(isHit && SIM.flying > 0) {
        // Detect edge by checking adjacent pixel depth difference
        const idxRight = x < cols - 1 ? ((rows - 1 - y) * cols + x + 1) * 4 : idx;
        const r_r = depthBuffer[idxRight], g_r = depthBuffer[idxRight+1], b_r = depthBuffer[idxRight+2], a_r = depthBuffer[idxRight+3];
        const zNormR = (r_r/255.0) + (g_r/65025.0) + (b_r/16581375.0) + (a_r/4228250625.0);
        const zRight = 0.1 + zNormR * 9.9;
        
        if (Math.abs(trueZ - zRight) > 0.5) { // Edge!
          if(Math.random() < (SIM.flying * 0.2)) {
             trueZ = Math.min(trueZ, zRight) + Math.random() * Math.abs(trueZ - zRight);
          }
        }
      }
      
      const measuredZ = trueZ + (Math.random()-0.5) * noiseM * 2;

      // Back-projection
      const px = (x - cx) * measuredZ / fx;
      const py = -(y - cy) * measuredZ / fy; // negative y for graphics coordinates
      
      positions[i*3] = px;
      positions[i*3+1] = py;
      positions[i*3+2] = -measuredZ;

      const t = Math.max(0, Math.min(1, measuredZ / 5.0));
      const isCar = trueZ < 3.5;
      
      if(isCar) {
        colors[i*3] = 0.9; colors[i*3+1] = 0.2; colors[i*3+2] = 0.2;
      } else {
        colors[i*3] = 1 - t;
        colors[i*3+1] = 0.5;
        colors[i*3+2] = t;
      }
      
      i++;
    }
  }

  if (isReused) {
    pointCloudMesh.geometry.attributes.position.needsUpdate = true;
    pointCloudMesh.geometry.attributes.color.needsUpdate = true;
  } else {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 0.05, vertexColors: true });
    pointCloudMesh = new THREE.Points(geometry, material);
    pcScene.add(pointCloudMesh);
  }
}

function animatePointCloud() {
  pcAnimFrame = requestAnimationFrame(animatePointCloud);
  if(!pcRenderer) return;
  const canvas = pcRenderer.domElement;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = Math.floor(rect.width);
  const H = Math.floor(rect.height - 30);
  if(canvas.width !== W || canvas.height !== H) {
    pcRenderer.setSize(W, H, false);
    pcCamera.aspect = W / H;
    pcCamera.updateProjectionMatrix();
  }

  pcCamera.position.x = pcTargetX + pcRadius * Math.sin(pcTheta) * Math.sin(pcPhi);
  pcCamera.position.y = pcTargetY + pcRadius * Math.cos(pcTheta);
  pcCamera.position.z = pcTargetZ + pcRadius * Math.sin(pcTheta) * Math.cos(pcPhi);
  pcCamera.lookAt(pcTargetX, pcTargetY, pcTargetZ);
  
  pcRenderer.render(pcScene, pcCamera);
}

/* Vis 3: Frustum Cross Section (2D) */
function drawFrustum() {
  const canvas = document.getElementById('cvs-frustum');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  if (canvas.width !== Math.floor(rect.width) || canvas.height !== Math.floor(rect.height-30)) {
    canvas.width = Math.floor(rect.width);
    canvas.height = Math.floor(rect.height-30);
  }
  const W = canvas.width, H = canvas.height;
  
  ctx.clearRect(0, 0, W, H);
  
  // Draw top-down view
  // Sensor at left (x=10), looking right.
  const originX = 20;
  const originY = H/2;
  const scale = W / 10; // 10 meters fits horizontally

  // Sensor width roughly 640 pixels for calculation
  const fov = 2 * Math.atan(320 / SIM.fx); 
  const objZ = SIM.Z * scale;
  
  // Draw Frustum Rays
  ctx.strokeStyle = '#bfdbfe';
  ctx.lineWidth = 1;
  const numRays = 10;
  for(let i=0; i<=numRays; i++) {
    const angle = -fov/2 + (i/numRays) * fov;
    const endX = originX + Math.cos(angle) * (8 * scale); // 8m max
    const endY = originY + Math.sin(angle) * (8 * scale);
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  // Draw Object Intersect
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  const objAngleTop = -fov/2 * (0.5 / (SIM.Z * Math.tan(fov/2)));
  const objAngleBot = fov/2 * (0.5 / (SIM.Z * Math.tan(fov/2)));
  const topY = originY + Math.sin(objAngleTop) * objZ;
  const botY = originY + Math.sin(objAngleBot) * objZ;
  ctx.moveTo(originX + objZ, topY);
  ctx.lineTo(originX + objZ, botY);
  ctx.stroke();

  // Draw annotation showing spacing
  ctx.fillStyle = '#64748b';
  ctx.font = '10px JetBrains Mono';
  
  // Calculation
  spacing_mm = (SIM.Z / SIM.fx) * 1000;
  ctx.fillText(`Δs: ${spacing_mm.toFixed(1)} mm`, originX + objZ + 10, originY);
}

/* Vis 4: Flying Pixel Edge (3D) */
let edgeScene, edgeCamera, edgeRenderer, edgeAnimFrame, edgeMesh;
let edgePhi = Math.PI/4, edgeTheta = Math.PI/3, edgeRadius = 1.5;
let edgeTargetX = 0, edgeTargetY = 0, edgeTargetZ = 0;
let edgeIsDragging = false, edgeLastMouse = {x:0, y:0}, edgeButton = 0;

function initFlyingPixel() {
  const canvas = document.getElementById('cvs-flying');
  if(!canvas || edgeRenderer) return;
  
  edgeRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  edgeScene = new THREE.Scene();
  edgeCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
  
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('mousedown', e => { edgeIsDragging = true; edgeLastMouse = {x:e.clientX, y:e.clientY}; edgeButton = e.buttons; });
  window.addEventListener('mouseup', () => edgeIsDragging = false);
  window.addEventListener('mousemove', e => {
    if(!edgeIsDragging) return;
    const dx = e.clientX - edgeLastMouse.x;
    const dy = e.clientY - edgeLastMouse.y;
    edgeLastMouse = {x:e.clientX, y:e.clientY};
    if(edgeButton === 1) { // Left click: Orbit
      edgePhi -= dx * 0.01;
      edgeTheta = Math.max(0.01, Math.min(Math.PI-0.01, edgeTheta + dy * 0.01));
    } else if(edgeButton === 2) { // Right click: Pan
      edgeTargetX -= dx * 0.01;
      edgeTargetY += dy * 0.01;
    }
  });
  canvas.addEventListener('wheel', e => { e.preventDefault(); edgeRadius = Math.max(0.5, Math.min(10, edgeRadius + e.deltaY * 0.005)); });

  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  edgeScene.add(ambient);

  animateFlyingPixel();
}

function updateFlyingPixel() {
  if(!edgeScene) return;
  if(edgeMesh) {
    edgeScene.remove(edgeMesh);
    edgeMesh.geometry.dispose();
    edgeMesh.material.dispose();
  }

  const numPts = 1000;
  const pos = new Float32Array(numPts * 3);
  const col = new Float32Array(numPts * 3);

  for(let i=0; i<numPts; i++) {
    // Left side = foreground object (z=0)
    // Right side = background wall (z=-2)
    const x = (Math.random() - 0.5) * 1.5;
    const y = (Math.random() - 0.5) * 1.5;
    let z = 0;
    
    if (x < -0.1) {
      z = 0 + (Math.random()-0.5)*(SIM.noise/500); // Front
      col[i*3]=0.9; col[i*3+1]=0.6; col[i*3+2]=0.1; // Orange
    } else if (x > 0.1) {
      z = -1.0 + (Math.random()-0.5)*(SIM.noise/500); // Back
      col[i*3]=0.2; col[i*3+1]=0.5; col[i*3+2]=0.9; // Blue
    } else {
      // The boundary (Flying Pixels)
      if (Math.random() < (SIM.flying * 0.3)) {
         z = -Math.random(); // Streaks between 0 and -1
         col[i*3]=0.9; col[i*3+1]=0.2; col[i*3+2]=0.2; // Red streaks!
      } else {
         z = Math.random() > 0.5 ? 0 : -1.0;
         col[i*3]=0.5; col[i*3+1]=0.5; col[i*3+2]=0.5;
      }
    }

    pos[i*3] = x;
    pos[i*3+1] = y;
    pos[i*3+2] = z;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  
  const mat = new THREE.PointsMaterial({ size: 0.04, vertexColors: true });
  edgeMesh = new THREE.Points(geo, mat);
  edgeScene.add(edgeMesh);
}

function animateFlyingPixel() {
  edgeAnimFrame = requestAnimationFrame(animateFlyingPixel);
  if(!edgeRenderer) return;
  const canvas = edgeRenderer.domElement;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = Math.floor(rect.width);
  const H = Math.floor(rect.height - 30);
  if(canvas.width !== W || canvas.height !== H) {
    edgeRenderer.setSize(W, H, false);
    edgeCamera.aspect = W / H;
    edgeCamera.updateProjectionMatrix();
  }

  edgeCamera.position.x = edgeTargetX + edgeRadius * Math.sin(edgeTheta) * Math.sin(edgePhi);
  edgeCamera.position.y = edgeTargetY + edgeRadius * Math.cos(edgeTheta);
  edgeCamera.position.z = edgeTargetZ + edgeRadius * Math.sin(edgeTheta) * Math.cos(edgePhi);
  edgeCamera.lookAt(edgeTargetX, edgeTargetY, edgeTargetZ);
  
  edgeRenderer.render(edgeScene, edgeCamera);
}

/* ──────────────────────────────────────────────────────────────
   SIMULATION PARAMETER UPDATES
────────────────────────────────────────────────────────────── */

function updateSimState() {
  if (!pcRenderer) return;
  
  drawRawDepth();
  updatePointCloud();
  drawFrustum();
  updateFlyingPixel();

  // Calculations
  spacing_mm = (SIM.Z / SIM.fx) * 1000;
  density_km2 = 1.0 / ((spacing_mm/1000) * (spacing_mm/1000) * 1000); // points per m^2 / 1000
  rmse_mm = SIM.noise * (1.0 + (SIM.Z/8.0)); // Fake RMSE scaling
  
  // UI Updates
  document.getElementById('out-points').textContent = num_points.toLocaleString();
  document.getElementById('out-spacing').textContent = spacing_mm.toFixed(1);
  document.getElementById('out-density').textContent = density_km2.toFixed(1);
  document.getElementById('out-rmse').textContent = rmse_mm.toFixed(1);

  // Left Panel Dynamic Observation
  const leftSpc = document.getElementById('left-out-spacing');
  const leftDen = document.getElementById('left-out-density');
  if (leftSpc) leftSpc.textContent = spacing_mm.toFixed(1);
  if (leftDen) leftDen.textContent = density_km2.toFixed(1);

  // Mini Diagrams
  updateMiniDiagrams();
}

function updateMiniDiagrams() {
  // 1. Density & Spacing Grid
  const svgGrid = document.getElementById('svg-density-grid');
  if(svgGrid) {
    const resLevels = [2, 4, 8, 16];
    const lines = resLevels[SIM.res];
    let gridHTML = '';
    const scale = 1.0 / (SIM.Z / 2.0); // Z=2 is scale 1
    const size = Math.min(100, Math.max(20, 60 * scale));
    const offsetX = (100 - size) / 2;
    const offsetY = (60 - size) / 2;
    gridHTML += `<rect x="${offsetX}" y="${offsetY}" width="${size}" height="${size}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>`;
    for(let i=1; i<lines; i++) {
      const px = offsetX + (i/lines)*size;
      const py = offsetY + (i/lines)*size;
      gridHTML += `<line x1="${px}" y1="${offsetY}" x2="${px}" y2="${offsetY + size}" stroke="#cbd5e1" stroke-width="1"/>`;
      gridHTML += `<line x1="${offsetX}" y1="${py}" x2="${offsetX+size}" y2="${py}" stroke="#cbd5e1" stroke-width="1"/>`;
    }
    svgGrid.innerHTML = gridHTML;
  }

  // 2. Sensor Noise Curve
  const pathNoise = document.getElementById('path-noise-curve');
  if(pathNoise) {
    const s = Math.max(2, SIM.noise);
    const w = s * 1.5; 
    const h = Math.max(10, 60 - s*0.8);
    const d = `M${50-w*2},60 Q${50-w},60 ${50},${60-h} Q${50+w},60 ${50+w*2},60`;
    pathNoise.setAttribute('d', d);
  }

  // 3. Focal Length Rays
  const polyFx = document.getElementById('poly-fx-frustum');
  if(polyFx) {
    const fovW = 60 * (700 / SIM.fx);
    polyFx.setAttribute('points', `50,60 ${50-fovW/2},0 ${50+fovW/2},0`);
  }

  // 4. Flying Pixels Edge
  const fpContainer = document.getElementById('flying-pixels-container');
  if(fpContainer) {
    let fpHTML = '';
    const count = SIM.flying * 8;
    for(let i=0; i<count; i++) {
      const x = 50 + (Math.random() - 0.5) * 15 * SIM.flying;
      const y = Math.random() * 100;
      fpHTML += `<div class="flying-pixel" style="left:${x}%; top:${y}%;"></div>`;
    }
    fpContainer.innerHTML = fpHTML;
  }
}

function updateSliderFill(el) {
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const pct = ((el.value - min) / (max - min)) * 100;
  el.style.background = `linear-gradient(to right, var(--blue) ${pct}%, var(--slate-200) ${pct}%)`;
}

let simUpdateTimer = null;
function bindSlider(rngId, lblId, simKey, formatter) {
  const el = document.getElementById(rngId);
  const lbl = document.getElementById(lblId);
  if(!el) return;
  el.addEventListener('input', () => {
    SIM[simKey] = parseFloat(el.value);
    lbl.textContent = formatter(SIM[simKey]);
    
    updateSliderFill(el);

    if(simUpdateTimer) clearTimeout(simUpdateTimer);
    simUpdateTimer = setTimeout(() => {
      updateSimState();
    }, 80);
  });
  // Trigger initial fill
  updateSliderFill(el);
}

/* ──────────────────────────────────────────────────────────────
   PAGE SWITCH & INIT
────────────────────────────────────────────────────────────── */

window.showSimulation = function() {
  initPointCloud();
  initFlyingPixel();
  updateSimState();
};

function init() {
  // Init Setup interactions
  initSetupThree();
  
  // === WIZARD STATE MANAGEMENT ===
  let currentSetupStep = 1;

  function goToSetupStep(step) {
    currentSetupStep = step;
    
    // Update Left Panel Instruction
    const badge = document.getElementById('setup-step-badge');
    const title = document.getElementById('setup-wizard-title');
    const text = document.getElementById('setup-wizard-text');
    const task = document.getElementById('setup-wizard-task');
    
    if (badge) badge.textContent = `STEP ${step} OF 4`;
    
    if (step === 1) {
      if(title) title.textContent = "Mount Apparatus";
      if(text) text.textContent = "Mount the background wall, sensor mount arm, RGB-D sensor, and target object into the scene.";
      if(task) task.innerHTML = "Select each component from the list and click <strong>Mount Component</strong> sequentially.";
    } else if (step === 2) {
      if(title) title.textContent = "Fix Object Position";
      if(text) text.textContent = "Set the distance and offset for the target object. This position will be locked for your captures.";
      if(task) task.innerHTML = "Adjust sliders and click <strong>Lock Position</strong> in the right panel.";
    } else if (step === 3) {
      if(title) title.textContent = "Capture Resolutions";
      if(text) text.textContent = "You must capture the scene using 4 different sensor resolutions (Sparse, Low, High, Heavy) to observe their effect.";
      if(task) task.innerHTML = "Select a resolution, click <strong>Capture Image</strong>, and repeat until 4 are captured. Then click <strong>Next Step</strong>.";
    } else if (step === 4) {
      if(title) title.textContent = "Live Observations";
      if(text) text.textContent = "Review the theoretical impact of your final captured resolution before moving into the interactive 3D simulation.";
      if(task) task.innerHTML = "Review the readings and click <strong>Launch Simulation</strong>.";
    }

    const specContent = document.getElementById('spec-content');
    if (specContent) {
      specContent.style.display = (step === 1) ? 'block' : 'none';
    }

    // Toggle Right Panel Containers
    for(let i=1; i<=4; i++) {
      const container = document.getElementById(`setup-wiz-${i}`);
      if (container) {
        container.style.display = (i === step) ? 'flex' : 'none';
      }
    }
  }

  const componentSpecs = {
    backdrop: "<h3 style='margin:0 0 8px 0;font-size:1rem;color:var(--slate-800);'>Calibration Backdrop</h3><p style='margin:0;font-size:0.85rem;color:var(--slate-600);line-height:1.5;'>A planar wall used to simulate the background environment. This provides a distinct depth boundary against which the target object is measured, demonstrating edge discontinuity.</p>",
    mount: "<h3 style='margin:0 0 8px 0;font-size:1rem;color:var(--slate-800);'>Sensor Mount</h3><p style='margin:0;font-size:0.85rem;color:var(--slate-600);line-height:1.5;'>A rigid vertical stand to securely hold the RGB-D sensor at a fixed height. Prevents movement and angular misalignment during the scanning process.</p>",
    sensor: "<h3 style='margin:0 0 8px 0;font-size:1rem;color:var(--slate-800);'>RGB-D Sensor</h3><p style='margin:0;font-size:0.85rem;color:var(--slate-600);line-height:1.5;'>A structured light or time-of-flight camera. It simultaneously captures color (RGB) and per-pixel depth (D) data, projecting infrared rays to calculate distance.</p>",
    object: "<h3 style='margin:0 0 8px 0;font-size:1rem;color:var(--slate-800);'>Target Car & Rail</h3><p style='margin:0;font-size:0.85rem;color:var(--slate-600);line-height:1.5;'>The object being scanned, placed on a dual-axis rail system. The rails allow precise adjustments to both distance (Z-axis) and horizontal offset (X-axis).</p>"
  };

  // Init step 1
  goToSetupStep(1);
  const initialSpecContent = document.getElementById('spec-content');
  if (initialSpecContent) {
    initialSpecContent.innerHTML = componentSpecs['backdrop'];
  }

  // Setup Step 1: Sequential Mount
  document.querySelectorAll('.apparatus-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedComp = card.dataset.comp;
      document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      
      const specContent = document.getElementById('spec-content');
      if (specContent && componentSpecs[selectedComp]) {
        specContent.innerHTML = componentSpecs[selectedComp];
      }
    });
  });

  const btnMount = document.getElementById('btn-mount');
  if (btnMount) {
    btnMount.addEventListener('click', function() {
      if (MOUNTED[selectedComp]) return;
      const idx = MOUNT_SEQ.indexOf(selectedComp);
      if (idx > 0 && !MOUNTED[MOUNT_SEQ[idx - 1]]) return;
      
      this.classList.remove('btn-mount-anim');
      void this.offsetWidth;
      this.classList.add('btn-mount-anim');
      
      mountSetupComponent(selectedComp);
      
      if (idx < MOUNT_SEQ.length - 1) {
        selectedComp = MOUNT_SEQ[idx + 1];
        document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
        document.querySelector(`.apparatus-card[data-comp="${selectedComp}"]`).classList.add('selected');
        
        const specContent = document.getElementById('spec-content');
        if (specContent && componentSpecs[selectedComp]) {
          specContent.innerHTML = componentSpecs[selectedComp];
        }
      } else {
        // All mounted, proceed to Step 2
        setTimeout(() => {
          goToSetupStep(2);
        }, 600);
      }
    });
  }

  // Setup Step 2: Object Positioning & Locking
  const rngSetupDist = document.getElementById('rng-setup-dist');
  const lblSetupDist = document.getElementById('lbl-setup-dist');
  const rngSetupOffset = document.getElementById('rng-setup-offset');
  const lblSetupOffset = document.getElementById('lbl-setup-offset');
  const rngSetupRot = document.getElementById('rng-setup-rot');
  const lblSetupRot = document.getElementById('lbl-setup-rot');
  const btnLockPos = document.getElementById('btn-lock-pos');

  if (rngSetupDist) {
    rngSetupDist.addEventListener('input', () => {
      const v = parseFloat(rngSetupDist.value);
      lblSetupDist.textContent = v.toFixed(1) + ' m';
      if (objectMesh) {
        const tStand = objectMesh.getObjectByName("tStand");
        if (tStand) tStand.position.z = -v;
      }
      updateSliderFill(rngSetupDist);
    });
    // Give it a tiny delay to ensure DOM is ready for initial fill
    setTimeout(() => updateSliderFill(rngSetupDist), 50);
  }

  if (rngSetupOffset) {
    rngSetupOffset.addEventListener('input', () => {
      const v = parseFloat(rngSetupOffset.value);
      lblSetupOffset.textContent = v.toFixed(1) + ' m';
      if (objectMesh) {
        const targetCar = objectMesh.getObjectByName("targetCar");
        if (targetCar) targetCar.position.x = v;
      }
      updateSliderFill(rngSetupOffset);
    });
    setTimeout(() => updateSliderFill(rngSetupOffset), 50);
  }

  if (rngSetupRot) {
    rngSetupRot.addEventListener('input', () => {
      const v = parseFloat(rngSetupRot.value);
      lblSetupRot.textContent = v + '°';
      if (objectMesh) {
        const targetCar = objectMesh.getObjectByName("targetCar");
        if (targetCar) targetCar.rotation.y = THREE.MathUtils.degToRad(v);
      }
      updateSliderFill(rngSetupRot);
    });
    setTimeout(() => updateSliderFill(rngSetupRot), 50);
  }

  if (btnLockPos) {
    btnLockPos.addEventListener('click', () => {
      CARRIED_SETUP.Z = parseFloat(rngSetupDist.value);
      CARRIED_SETUP.offsetX = parseFloat(rngSetupOffset.value);
      CARRIED_SETUP.rotationY = parseFloat(rngSetupRot.value);
      updateLiveReadings();
      goToSetupStep(3);
    });
  }

  const btnBackStep2 = document.getElementById('btn-back-step2');
  if (btnBackStep2) {
    btnBackStep2.addEventListener('click', () => {
      Object.keys(MOUNTED).forEach(k => MOUNTED[k] = false);
      if (typeof backdropMesh !== 'undefined' && backdropMesh) backdropMesh.visible = false;
      if (typeof mountMesh !== 'undefined' && mountMesh) mountMesh.visible = false;
      if (typeof sensorMesh !== 'undefined' && sensorMesh) sensorMesh.visible = false;
      if (typeof objectMesh !== 'undefined' && objectMesh) objectMesh.visible = false;
      
      ['backdrop', 'mount', 'sensor', 'object'].forEach(comp => {
        const card = document.querySelector(`.apparatus-card[data-comp="${comp}"]`);
        if(card) {
          card.classList.remove('mounted');
          card.style.borderColor = '';
          card.style.background = '';
          const status = card.querySelector('.apparatus-status');
          if(status) status.textContent = 'Unmounted';
        }
      });
      selectedComp = 'backdrop';
      document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
      const firstCard = document.querySelector('.apparatus-card[data-comp="backdrop"]');
      if(firstCard) firstCard.classList.add('selected');
      const specContent = document.getElementById('spec-content');
      if (specContent && typeof componentSpecs !== 'undefined') specContent.innerHTML = componentSpecs['backdrop'];

      goToSetupStep(1);
    });
  }

  // Setup Step 2 & 3: Resolution Captures & Live Readings
  let capturedRes = new Set();
  const btnCapture = document.getElementById('btn-capture');
  const rngSetupRes = document.getElementById('rng-setup-res');
  
  if(rngSetupRes) {
    rngSetupRes.addEventListener('input', () => {
      CARRIED_SETUP.res = parseInt(rngSetupRes.value, 10);
      const resLabels = ['Sparse', 'Low', 'Medium', 'Heavy'];
      const lbl = document.getElementById('lbl-setup-res');
      if(lbl) lbl.textContent = resLabels[CARRIED_SETUP.res];
      updateSliderFill(rngSetupRes);
      updateLiveReadings();
    });
    updateSliderFill(rngSetupRes);
  }

  if (btnCapture) {
    btnCapture.addEventListener('click', function(e) {
      e.preventDefault();
      
      const gallery = document.getElementById('observation-gallery');
      const placeholder = document.getElementById('obs-placeholder');
      if (placeholder) placeholder.style.display = 'none';
      
      const resVal = parseInt(rngSetupRes.value, 10);
      const resLabels = ['160x120', '320x240', '640x480', '1280x960'];
      
      if (!capturedRes.has(resVal)) {
        capturedRes.add(resVal);
        
        // Grab image from sensor camera
        if (setupRenderer && setupRenderer.domElement && typeof sensorCamera !== 'undefined') {
          sensorCamera.aspect = setupCamera.aspect;
          sensorCamera.updateProjectionMatrix();
          setupRenderer.render(setupScene, sensorCamera);
          const dataURL = setupRenderer.domElement.toDataURL('image/png');
          
          setupRenderer.render(setupScene, setupCamera); // restore
          
          const itemDiv = document.createElement('div');
          itemDiv.style.cssText = 'width: 140px; border: 1px solid var(--slate-200); border-radius: 4px; overflow: hidden; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.1);';
          
          const img = document.createElement('img');
          img.src = dataURL;
          img.style.cssText = 'width: 100%; height: 90px; object-fit: cover; display: block; border-bottom: 1px solid var(--slate-200);';
          
          const caption = document.createElement('div');
          caption.style.cssText = 'padding: 4px; font-size: 0.75rem; color: var(--slate-700); text-align: center; background: #f8fafc;';
          caption.innerHTML = `<strong>${resLabels[resVal]}</strong><br/>Z:${CARRIED_SETUP.Z}m | Offset:${CARRIED_SETUP.offsetX}m`;
          
          itemDiv.appendChild(img);
          itemDiv.appendChild(caption);
          gallery.appendChild(itemDiv);

          // Update counter logic
          const countSpan = document.getElementById('capture-count');
          if(countSpan) countSpan.textContent = capturedRes.size;

          if(capturedRes.size >= 4) {
            const btnStep3Next = document.getElementById('btn-step3-next');
            if(btnStep3Next) {
              btnStep3Next.style.display = 'block';
              btnStep3Next.removeAttribute('disabled');
            }
          }
        }
      }
    });
  }

  const btnStep3Next = document.getElementById('btn-step3-next');
  if (btnStep3Next) {
    btnStep3Next.addEventListener('click', () => {
      goToSetupStep(4);
      const btnGoSim = document.getElementById('btn-go-sim');
      if(btnGoSim) btnGoSim.removeAttribute('disabled');
    });
  }

  const btnBackStep3 = document.getElementById('btn-back-step3');
  if (btnBackStep3) {
    btnBackStep3.addEventListener('click', () => {
      goToSetupStep(2);
    });
  }

  const btnBackStep4 = document.getElementById('btn-back-step4');
  if (btnBackStep4) {
    btnBackStep4.addEventListener('click', () => {
      goToSetupStep(3);
    });
  }

  function updateLiveReadings() {
    const Z = CARRIED_SETUP.Z;
    const rngSetupRes = document.getElementById('rng-setup-res');
    const resVal = rngSetupRes ? parseInt(rngSetupRes.value, 10) : 1;
    let w = 320, h = 240;
    if (resVal === 0) { w = 160; h = 120; }
    else if (resVal === 2) { w = 640; h = 480; }
    else if (resVal === 3) { w = 1280; h = 960; }
    
    const pts = w * h;
    const fx = 700.0;
    const spacing = (Z * 1000) / fx;
    const density = 1.0 / ((spacing/1000) * (spacing/1000));
    const boundsX = ((w/2) * Z) / fx;
    const boundsY = ((h/2) * Z) / fx;
    
    const rdPts = document.getElementById('rd-points');
    const rdSpc = document.getElementById('rd-spacing');
    const rdDen = document.getElementById('rd-density');
    const rdFly = document.getElementById('rd-flying');
    const rdBnd = document.getElementById('rd-bounds');
    
    if(rdPts) rdPts.textContent = pts.toLocaleString();
    if(rdSpc) rdSpc.textContent = spacing.toFixed(1);
    if(rdDen) rdDen.textContent = Math.round(density).toLocaleString();
    if(rdFly) rdFly.textContent = (w * 0.05).toFixed(0);
    if(rdBnd) rdBnd.innerHTML = `${(boundsX*2).toFixed(2)} <span style="font-family:sans-serif; margin:0 4px;">&times;</span> ${(boundsY*2).toFixed(2)} <span style="font-family:sans-serif; margin:0 4px;">&times;</span> 2.60`;
    
    // Sync to SIM default
    SIM.Z = Z;
    SIM.offsetX = CARRIED_SETUP.offsetX;
    SIM.res = resVal;
  }

  // Init Sim Sliders
  bindSlider('rng-res', 'lbl-res', 'res', v => ['Sparse', 'Medium', 'High', 'Heavy'][v]);
  bindSlider('rng-Z', 'lbl-Z', 'Z', v => v.toFixed(1) + ' m');
  bindSlider('rng-noise', 'lbl-noise', 'noise', v => v.toFixed(0) + ' mm');
  bindSlider('rng-fx', 'lbl-fx', 'fx', v => v.toFixed(0) + ' px');
  bindSlider('rng-flying', 'lbl-flying', 'flying', v => ['Clean', 'Low', 'Medium', 'High'][v]);

  // Reset Setup
  const btnResetSetup = document.querySelector('#setup-view .btn-reset');
  if (btnResetSetup) {
    btnResetSetup.addEventListener('click', () => {
      Object.keys(MOUNTED).forEach(k => MOUNTED[k] = false);
      if(backdropMesh) backdropMesh.visible = false;
      if(mountMesh) mountMesh.visible = false;
      if(sensorMesh) sensorMesh.visible = false;
      if(objectMesh) objectMesh.visible = false;

      capturedRes.clear();
      const countSpan = document.getElementById('capture-count');
      if(countSpan) countSpan.textContent = "0";

      const btnGoSim = document.getElementById('btn-go-sim');
      if(btnGoSim) btnGoSim.setAttribute('disabled', 'true');
      
      const btnStep3Next = document.getElementById('btn-step3-next');
      if(btnStep3Next) {
        btnStep3Next.setAttribute('disabled', 'true');
        btnStep3Next.style.display = 'none';
      }

      const gallery = document.getElementById('observation-gallery');
      if(gallery) {
        gallery.innerHTML = '<p id="obs-placeholder" style="color:var(--slate-400); font-size:0.9rem; margin:auto;">Captured images will appear here.</p>';
      }
      
      // Reset Step 1 locks & sliders
      if(rngSetupDist) { rngSetupDist.disabled = false; rngSetupDist.value = "2.0"; document.getElementById('lbl-setup-dist').textContent = "2.0 m"; }
      if(rngSetupOffset) { rngSetupOffset.disabled = false; rngSetupOffset.value = "0.0"; document.getElementById('lbl-setup-offset').textContent = "0.0 m"; }
      if(btnLockPos) { btnLockPos.disabled = false; btnLockPos.textContent = "Lock Position"; }
      if(selSetupRes) { selSetupRes.value = "1"; }
      
      if (objectMesh) {
        const tStand = objectMesh.getObjectByName("tStand");
        if (tStand) tStand.position.z = -2.0;
        const targetCar = objectMesh.getObjectByName("targetCar");
        if (targetCar) targetCar.position.x = 0;
      }
      
      goToSetupStep(1);
      
      document.querySelectorAll('.apparatus-card').forEach(c => {
        c.classList.remove('mounted');
        c.style.borderColor = '';
        c.style.background = '';
        const status = c.querySelector('.apparatus-status');
        if(status) status.textContent = 'Unmounted';
      });

      selectedComp = 'backdrop';
      document.querySelectorAll('.apparatus-card').forEach(c => c.classList.remove('selected'));
      const firstCard = document.querySelector('.apparatus-card[data-comp="backdrop"]');
      if(firstCard) {
        firstCard.classList.add('selected');
      }
      const specContent = document.getElementById('spec-content');
      if (specContent) {
        specContent.innerHTML = componentSpecs['backdrop'];
      }
    });
  }

  // Reset Simulation
  const btnResetSim = document.querySelector('#simulation-view .btn-reset');
  if (btnResetSim) {
    btnResetSim.addEventListener('click', () => {
      // Use CARRIED_SETUP values instead of hardcoded 1, 2.0
      document.getElementById('rng-res').value = CARRIED_SETUP.res;
      document.getElementById('rng-Z').value = CARRIED_SETUP.Z;
      // Other sliders reset to nominal defaults
      document.getElementById('rng-noise').value = 3;
      document.getElementById('rng-fx').value = 700;
      document.getElementById('rng-flying').value = 1;
      
      ['rng-res','rng-Z','rng-noise','rng-fx','rng-flying'].forEach(id => {
        document.getElementById(id).dispatchEvent(new Event('input'));
      });
    });
  }

  // Wizard steps logic for left panel
  const steps = [
    { title: "Resolution Effects", text: "Change the sensor resolution and observe the density of the generated point cloud. Lower resolution results in sparse point spacing, while higher resolution captures finer details but increases computational cost." },
    { title: "Object Distance", text: "Move the object further away by increasing Z. Notice how point spacing grows linearly with distance, reducing the overall density of points on the object surface." },
    { title: "Sensor Noise", text: "Increase sensor noise to simulate a lower quality RGB-D sensor. Watch how the Z-coordinates of points scatter, increasing the Root Mean Square Error (RMSE) of the surface." },
    { title: "Back-Projection Distortion", text: "Change the focal length. If the simulation uses an incorrect focal length during back-projection, the resulting 3D shape stretches or squashes incorrectly." },
    { title: "Boundary Artifacts", text: "Increase edge discontinuity to simulate mixed pixels at object boundaries. You'll see 'flying pixels' streak between the foreground object and the background wall." }
  ];
  let currentStep = 0;
  
  const btnNext = document.getElementById('btn-next');
  if (btnNext) {
    btnNext.addEventListener('click', () => {
      currentStep = (currentStep + 1) % steps.length;
      document.getElementById('wizard-title').textContent = steps[currentStep].title;
      document.getElementById('wizard-text').textContent = steps[currentStep].text;

      // Remove highlight from all groups
      ['grp-res','grp-Z','grp-noise','grp-fx','grp-flying'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.classList.remove('highlight-active');
      });

      // Add highlight to current group
      let activeId = '';
      if(currentStep === 0) activeId = 'grp-res';
      else if (currentStep === 1) activeId = 'grp-Z';
      else if (currentStep === 2) activeId = 'grp-noise';
      else if (currentStep === 3) activeId = 'grp-fx';
      else if (currentStep === 4) activeId = 'grp-flying';

      if(activeId) {
        const el = document.getElementById(activeId);
        if(el) {
          el.classList.add('highlight-active');
          // el.scrollIntoView({ behavior: 'smooth', block: 'center' }); // optional scroll
        }
      }
    });
  }

  const btnSkip = document.getElementById('btn-skip');
  if (btnSkip) {
    btnSkip.addEventListener('click', () => {
      currentStep = steps.length - 1;
      document.getElementById('wizard-title').textContent = steps[currentStep].title;
      document.getElementById('wizard-text').textContent = steps[currentStep].text;
    });
  }

  // Trigger input on all range sliders to sync text and visuals upon page reload
  document.querySelectorAll('input[type="range"]').forEach(rng => {
    rng.dispatchEvent(new Event('input'));
  });
}

window.addEventListener('load', init);
