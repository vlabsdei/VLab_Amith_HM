/* ================================================================
   STEREO VISION DEPTH ESTIMATION — SIMULATION LOGIC
   Experiment 1 | 3D Scanning Virtual Lab
   ================================================================

   ARCHITECTURE OVERVIEW
   ─────────────────────
   STATE  → holds all live parameter values (B, f, Z, sigma)
   NOISE  → pre-built Gaussian map reused across frames (stable look)
   RENDER → five drawing functions, each writes to its own canvas
   WIZARD → 6-step guided walkthrough using state.step
   SLIDERS→ input events update STATE then call renderAll()

   MATH USED
   ─────────
   Disparity:     d   = (f × B) / Z
   Depth:         Z   = (f × B) / d
   Uncertainty:   ΔZ  = Z² × σ / (f × B)
   Back-project:  X   = (u - cx) × Z / f
                  Y   = (v - cy) × Z / f
   Noise model:   d_measured = d_true + N(0, σ²)   [Box-Muller]
   ================================================================ */

'use strict';

/* ── ROUNDRECT POLYFILL ─────────────────────────────────────────
   Safari < 15.4 and older Chrome lack native roundRect.
   This polyfill makes it available everywhere.              */
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.arcTo(x + w, y, x + w, y + r, r);
    this.lineTo(x + w, y + h - r);
    this.arcTo(x + w, y + h, x + w - r, y + h, r);
    this.lineTo(x + r, y + h);
    this.arcTo(x, y + h, x, y + h - r, r);
    this.lineTo(x, y + r);
    this.arcTo(x, y, x + r, y, r);
    this.closePath();
    return this;
  };
}

/* ── DYNAMIC SIZING ─────────────────────────────────────────────
   Two modes:
   1. syncCanvasHiDPI — for vector-drawn canvases (scene).
      Sets drawing buffer to CSS size × devicePixelRatio and
      scales the context, producing crisp output on Retina/HiDPI.
   2. syncCanvasSize  — for pixel-map canvases (depth, unc).
      Sets drawing buffer to CSS size (1:1) for fast pixel loops.
   Camera canvases use FIXED width/height attributes and are
   NOT synced — ensuring identical rendering on all viewports. */

function syncCanvasHiDPI(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr  = window.devicePixelRatio || 1;
  const w    = Math.floor(rect.width);
  const h    = Math.floor(rect.height);
  if (w < 2 || h < 2) return null;
  canvas.width  = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, dpr, ctx };
}

function syncCanvasSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.floor(rect.width);
  const h = Math.floor(rect.height);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w;
    canvas.height = h;
  }
  return { w, h };
}

/* ── CONSTANTS ──────────────────────────────────────────────────*/
const CFG = {
  /* scene geometry */
  BG_DEPTH: 8.0,
  MAX_DEPTH: 10,
  MIN_DISP: 1.0,

  /* Object region as fractions of map canvas */
  OBJ_X0: 0.30,  OBJ_X1: 0.70,
  OBJ_Y0: 0.22,  OBJ_Y1: 0.75,

  /* Fixed camera view internal resolution */
  CAM_W: 280,
  CAM_H: 210,
};

/* ── STATE ──────────────────────────────────────────────────────*/
const S = {
  B:     0.10,
  f:     700,
  Z:     2.0,
  sigma: 0,
  step:  0,
};

/* ── SVG ICON STRINGS FOR WIZARD ───────────────────────────────*/
const WIZARD_ICONS = {
  camera:   '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  ruler:    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 6.5L6.5 17.5"/><path d="M7 2L2 7"/><path d="M22 17l-5 5"/><path d="M2 12l10 10"/><path d="M12 2l10 10"/></svg>',
  lens:     '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
  cube:     '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  wave:     '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M2 18c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M2 6c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/></svg>',
  rocket:   '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 3 0 3 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-3 0-3"/></svg>',
};

/* ── WIZARD STEPS ───────────────────────────────────────────────*/
const WIZARD = [
  {
    icon: 'camera',
    title: 'Welcome to Stereo Vision',
    text:  'Two cameras placed side by side observe the same scene. ' +
           'Each camera sees the same point at a slightly different ' +
           'horizontal pixel position. That shift is called disparity, ' +
           'and it directly encodes depth. Work through each step to ' +
           'build up the simulation before exploring freely.',
    task:  '',
    lit:   null,
  },
  {
    icon: 'ruler',
    title: 'Step 1 — Set the Baseline',
    text:  'The baseline B is the physical horizontal distance between ' +
           'the two cameras in metres. A wider baseline produces larger ' +
           'disparity values for the same object distance, which improves ' +
           'depth accuracy. Watch the cameras spread apart in the top view.',
    task:  'Drag the Baseline slider between 5 cm and 30 cm and watch the camera positions change.',
    lit:   'grp-baseline',
  },
  {
    icon: 'lens',
    title: 'Step 2 — Set the Focal Length',
    text:  'Focal length f (in pixels) controls how much the lens zooms. ' +
           'A longer focal length makes the same scene point appear farther ' +
           'from centre in each camera image, increasing disparity and improving ' +
           'depth precision — but narrowing the field of view.',
    task:  'Try f = 400 px and f = 900 px. Watch the disparity readout change.',
    lit:   'grp-focal',
  },
  {
    icon: 'cube',
    title: 'Step 3 — Place the Object',
    text:  'Object distance Z controls how far the object sits from the camera ' +
           'pair. As Z increases, disparity falls and the depth map colour shifts ' +
           'from warm red toward cool blue. Beyond a certain distance, disparity ' +
           'drops below 1 px and the depth map goes black (invalid). ' +
           'In the Camera Views, the orange rectangle is the object, the dashed ' +
           'grey line marks the image centre, and the gold bracket at the bottom ' +
           'shows the disparity shift.',
    task:  'Drag Z from 0.5 m all the way to 9 m. Notice when black patches appear.',
    lit:   'grp-Z',
  },
  {
    icon: 'wave',
    title: 'Step 4 — Add Measurement Noise',
    text:  'Real sensors are never perfect. The noise sigma (px) adds Gaussian ' +
           'random error to each disparity measurement. At close range the depth ' +
           'map stays usable. At far range the same noise creates enormous depth ' +
           'errors — watch the uncertainty map light up red as Z increases with sigma > 0.',
    task:  'Set sigma = 3 px, then move Z from 1 m to 7 m and watch RMSE grow.',
    lit:   'grp-noise',
  },
  {
    icon: 'rocket',
    title: 'Simulation Ready — Explore Freely',
    text:  'All parameters are live. Change any combination and observe all four ' +
           'displays responding together. Try pushing settings to extremes to ' +
           'discover the physical limits of the stereo system.',
    task:  'Challenge: find a B + f combination that keeps RMSE below 5 cm at Z = 3 m with sigma = 2 px.',
    lit:   null,
  },
];

/* ── GAUSSIAN NOISE UTILITIES ──────────────────────────────────*/
let noiseMap = [];
let noiseMapSize = 0;

function boxMuller() {
  const u1 = Math.max(1e-12, Math.random());
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function buildNoiseMap(count) {
  if (!count) count = 600 * 400;
  noiseMapSize = count;
  noiseMap = new Float32Array(count);
  for (let i = 0; i < count; i++) noiseMap[i] = boxMuller();
}

/* ── COLOUR UTILITIES ──────────────────────────────────────────*/
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function depthToRgb(z) {
  if (z <= 0 || z > CFG.MAX_DEPTH) return [12, 12, 12];
  const t = Math.max(0, Math.min(1, z / CFG.MAX_DEPTH));
  return hslToRgb(t * 0.667, 0.85, 0.50);
}

function uncToRgb(dz, maxDz) {
  const t = Math.min(1, dz / Math.max(maxDz, 0.001));
  return hslToRgb((1 - t) * 0.333, 0.80, 0.48);
}

/* ── RENDER: TOP-DOWN SCENE (HiDPI + aesthetics) ───────────────
   Uses devicePixelRatio for crisp vector rendering.
   Enhanced with gradient background, dot grid, glow effects,
   label badges, and improved visual hierarchy.                */

function renderScene(cvs) {
  const info = syncCanvasHiDPI(cvs);
  if (!info) return;
  const { w: W, h: H, ctx } = info;

  const cx = W / 2;
  const camY = 30;
  const scaleB = W * 0.6;

  /* Adaptive scaleZ: guarantees Z = 10 m always fits inside the
     canvas with room for the object body (22 px) + shadow (4 px)
     + padding (10 px) = 36 px bottom margin.  On short mobile
     canvases (H ≈ 160) this yields scaleZ ≈ 9.4 instead of 12,
     keeping the object well within bounds.                       */
  const bottomMargin = 36;
  const maxZ = 10;
  const scaleZ = (H - camY - bottomMargin) / maxZ;

  const halfB_px = (S.B / 2) * scaleB;
  const lcx = cx - halfB_px;
  const rcx = cx + halfB_px;
  const objY = Math.min(camY + S.Z * scaleZ, H - bottomMargin);
  const objInView = (S.Z * scaleZ) <= (H - camY - bottomMargin);

  /* ── Gradient background ── */
  const bgGrad = ctx.createRadialGradient(cx, H * 0.35, 0, cx, H * 0.35, W * 0.9);
  bgGrad.addColorStop(0, '#f0f4ff');
  bgGrad.addColorStop(0.7, '#e8ecf6');
  bgGrad.addColorStop(1, '#dfe4ef');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  /* ── Dot grid pattern ── */
  ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
  for (let x = 12; x < W; x += 18) {
    for (let y = 12; y < H; y += 18) {
      ctx.beginPath();
      ctx.arc(x, y, 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ── Subtle floor plane ── */
  const floorGrad = ctx.createLinearGradient(0, H * 0.75, 0, H);
  floorGrad.addColorStop(0, 'rgba(148, 163, 184, 0)');
  floorGrad.addColorStop(1, 'rgba(148, 163, 184, 0.06)');
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, H * 0.75, W, H * 0.25);

  /* ── Z-axis centre guide ── */
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(cx, camY + 18);
  ctx.lineTo(cx, H - 6);
  ctx.stroke();
  ctx.setLineDash([]);

  /* ── Depth scale ruler (right side) ── */
  const rulerX = W - 30;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rulerX, camY);
  ctx.lineTo(rulerX, H - 10);
  ctx.stroke();

  for (let zm = 1; zm <= 10; zm++) {
    const ty = camY + zm * scaleZ;
    if (ty > H - 10) break;
    const isMajor = zm % 2 === 0;
    ctx.strokeStyle = isMajor ? 'rgba(148, 163, 184, 0.45)' : 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = isMajor ? 1 : 0.5;
    ctx.beginPath();
    ctx.moveTo(rulerX - (isMajor ? 6 : 3), ty);
    ctx.lineTo(rulerX + (isMajor ? 3 : 1), ty);
    ctx.stroke();

    /* tick on centre axis too */
    ctx.beginPath();
    ctx.moveTo(cx - 4, ty);
    ctx.lineTo(cx + 4, ty);
    ctx.stroke();

    if (isMajor) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 7.5px JetBrains Mono';
      ctx.textAlign = 'right';
      ctx.fillText(`${zm}m`, rulerX - 9, ty + 3);
      ctx.textAlign = 'left';
    }
  }

  /* ── Baseline dimension ── */
  if (halfB_px > 14) {
    const dimY = camY - 14;

    /* dimension line */
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(lcx + 14, dimY);
    ctx.lineTo(rcx - 14, dimY);
    ctx.stroke();

    /* arrowheads */
    [[lcx + 14, 1], [rcx - 14, -1]].forEach(([ax, dir]) => {
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.moveTo(ax, dimY);
      ctx.lineTo(ax + dir * 6, dimY - 3.5);
      ctx.lineTo(ax + dir * 6, dimY + 3.5);
      ctx.closePath();
      ctx.fill();
    });

    /* Label badge */
    const label = `B = ${(S.B * 100).toFixed(0)} cm`;
    ctx.font = 'bold 9px DM Sans';
    const tw = ctx.measureText(label).width;
    const badgeX = cx - tw / 2 - 6;
    const badgeY = dimY - 18;
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, tw + 12, 15, 4);
    ctx.fill();
    /* badge shadow */
    ctx.shadowColor = 'rgba(59, 130, 246, 0.25)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, badgeY + 11);
  }

  /* ── Projection rays (gradient fade) ── */
  const rayTarget = objInView ? objY : H - 10;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.2;
  [[lcx, '#3b82f6'], [rcx, '#0891b2']].forEach(([cx2, col]) => {
    const g = ctx.createLinearGradient(cx2, camY + 18, cx, rayTarget);
    g.addColorStop(0, col + '60');
    g.addColorStop(1, col + '15');
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx2, camY + 18);
    ctx.lineTo(cx, rayTarget);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  /* ── Z label badge ── */
  if (objInView) {
    const labelZ = `Z = ${S.Z.toFixed(2)} m`;
    ctx.font = 'bold 9px DM Sans';
    const tw = ctx.measureText(labelZ).width;
    const lx = cx + 14;
    const ly = (camY + objY) / 2;
    ctx.fillStyle = '#16a34a';
    ctx.beginPath();
    ctx.roundRect(lx - 4, ly - 9, tw + 8, 15, 4);
    ctx.fill();
    ctx.shadowColor = 'rgba(22, 163, 74, 0.25)';
    ctx.shadowBlur = 5;
    ctx.shadowOffsetY = 1;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(labelZ, lx, ly + 3);
  }

  /* ── Camera icons with glow ── */
  ctx.save();
  ctx.shadowColor = 'rgba(59, 130, 246, 0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  drawCameraIcon(ctx, lcx, camY, '#3b82f6', 'L');
  ctx.shadowColor = 'rgba(8, 145, 178, 0.35)';
  drawCameraIcon(ctx, rcx, camY, '#0891b2', 'R');
  ctx.restore();

  /* ── Object with 3D shadow ── */
  if (objInView) {
    const ow = 34, oh = 22;

    /* drop shadow ellipse */
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.ellipse(cx + 2, objY + oh / 2 + 4, ow / 2, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    /* object body with richer gradient */
    const grad = ctx.createLinearGradient(cx - ow/2, objY - oh/2, cx + ow/2, objY + oh/2);
    grad.addColorStop(0, '#fdba74');
    grad.addColorStop(0.3, '#fb923c');
    grad.addColorStop(0.7, '#f97316');
    grad.addColorStop(1, '#c2410c');
    ctx.fillStyle = grad;
    ctx.strokeStyle = '#9a3412';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cx - ow/2, objY - oh/2, ow, oh, 5);
    ctx.fill();

    /* subtle glow */
    ctx.shadowColor = 'rgba(249, 115, 22, 0.3)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.stroke();

    /* highlight strip on top */
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.roundRect(cx - ow/2 + 2, objY - oh/2 + 1, ow - 4, 5, 3);
    ctx.fill();

    /* label */
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px DM Sans';
    ctx.textAlign = 'center';
    ctx.fillText('OBJ', cx, objY + 4);
  } else {
    ctx.fillStyle = '#ef444480';
    ctx.font = '9px DM Sans';
    ctx.textAlign = 'center';
    ctx.fillText(`Object at ${S.Z.toFixed(1)} m (far)`, cx, H - 8);
  }

  ctx.textAlign = 'left';
}

function drawCameraIcon(ctx, x, y, colour, label) {
  const w = 28, h = 18;

  /* Camera body with gradient */
  const bodyGrad = ctx.createLinearGradient(x - w/2, y, x - w/2, y + h);
  bodyGrad.addColorStop(0, colour);
  bodyGrad.addColorStop(1, shadeColor(colour, -25));
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w/2, y, w, h, 5);
  ctx.fill();
  ctx.stroke();

  /* lens ring */
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(x, y + h/2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  /* inner lens */
  ctx.fillStyle = colour + '55';
  ctx.beginPath();
  ctx.arc(x, y + h/2, 2.5, 0, Math.PI * 2);
  ctx.fill();

  /* label badge above */
  ctx.fillStyle = colour;
  ctx.font = 'bold 9px DM Sans';
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y - 4);
}

/* Darken a hex colour by a percentage */
function shadeColor(hex, percent) {
  let r = parseInt(hex.slice(1,3), 16);
  let g = parseInt(hex.slice(3,5), 16);
  let b = parseInt(hex.slice(5,7), 16);
  r = Math.max(0, Math.min(255, r + Math.round(r * percent / 100)));
  g = Math.max(0, Math.min(255, g + Math.round(g * percent / 100)));
  b = Math.max(0, Math.min(255, b + Math.round(b * percent / 100)));
  return '#' + [r,g,b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/* ── RENDER: CAMERA VIEWS (fixed resolution) ────────────────────
   Uses the FIXED canvas width/height (280×210) set in HTML.
   This ensures pixel-identical rendering on every screen size.
   CSS scales the bitmap to fill the container.                 */

function renderCameraView(ctx, isLeft) {
  /* Use the fixed canvas buffer dimensions — DO NOT sync to CSS */
  const W = ctx.canvas.width;   /* always 280 */
  const H = ctx.canvas.height;  /* always 210 */
  if (W < 2 || H < 2) return;

  const cx = W / 2, cy = H / 2;

  /* ── sky / ground background ── */
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.58);
  skyGrad.addColorStop(0, '#bfdbfe');
  skyGrad.addColorStop(1, '#dbeafe');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H * 0.58);

  const groundGrad = ctx.createLinearGradient(0, H * 0.58, 0, H);
  groundGrad.addColorStop(0, '#bbf7d0');
  groundGrad.addColorStop(1, '#d1fae5');
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, H * 0.58, W, H * 0.42);

  /* horizon line */
  ctx.strokeStyle = '#86efac';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.58);
  ctx.lineTo(W, H * 0.58);
  ctx.stroke();

  /* disparity = fB/Z, scaled to 280px reference */
  const dRaw = (S.f * S.B) / S.Z;
  const dScale = W / 188;  /* scale factor from original 188px */
  const d = dRaw * dScale;

  /* object pixel position in this camera */
  const objPx = isLeft ? cx + d / 2 : cx - d / 2;

  /* object angular size */
  const objW = Math.max(8, Math.min(W * 0.55, S.f * 1.2 / S.Z * dScale));
  const objH = objW * 0.65;
  const objTop = H * 0.28;

  /* ── shadow ellipse ── */
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.ellipse(objPx, H * 0.60, objW * 0.45, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  /* ── object body ── */
  const grad = ctx.createLinearGradient(objPx - objW/2, objTop, objPx, objTop + objH);
  grad.addColorStop(0, '#fdba74');
  grad.addColorStop(0.4, '#fb923c');
  grad.addColorStop(1, '#ea580c');
  ctx.fillStyle = grad;
  ctx.strokeStyle = '#9a3412';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(objPx - objW/2, objTop, objW, objH, 4);
  ctx.fill();
  ctx.stroke();

  /* highlight strip */
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.roundRect(objPx - objW/2 + 2, objTop + 1, objW - 4, 4, 2);
  ctx.fill();

  /* ── disparity indicator bar ── */
  const barY = H - 16;

  /* centre reference tick (dashed) */
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(cx, barY - 6); ctx.lineTo(cx, barY + 6);
  ctx.stroke();
  ctx.setLineDash([]);

  /* object position tick */
  const tickColour = isLeft ? '#3b82f6' : '#0891b2';
  ctx.strokeStyle = tickColour;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(objPx, barY - 7); ctx.lineTo(objPx, barY + 7);
  ctx.stroke();

  /* bracket and d label (left view only) */
  if (isLeft && Math.abs(objPx - cx) > 3) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, barY);
    ctx.lineTo(objPx, barY);
    ctx.stroke();
    /* "d" label badge */
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 9px JetBrains Mono';
    ctx.textAlign = 'center';
    const labelX = (cx + objPx) / 2;
    ctx.beginPath();
    ctx.roundRect(labelX - 8, barY - 15, 16, 12, 3);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText('d', labelX, barY - 6);
  }

  /* ── camera label chip ── */
  const chipColour = isLeft ? '#3b82f6' : '#0891b2';
  const chipText   = isLeft ? 'Left' : 'Right';
  ctx.fillStyle = chipColour + '22';
  ctx.strokeStyle = chipColour + '55';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.roundRect(4, 4, 42, 16, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = chipColour;
  ctx.font = 'bold 9px DM Sans';
  ctx.textAlign = 'left';
  ctx.fillText(chipText, 9, 15);

  ctx.textAlign = 'left';
}

/* ── RENDER: DEPTH MAP ─────────────────────────────────────────*/
function renderDepthMap(cvs) {
  const { w: W, h: H } = syncCanvasSize(cvs);
  if (W < 2 || H < 2) return;
  const ctx = cvs.getContext('2d');

  const imgData = ctx.createImageData(W, H);
  const px = imgData.data;

  const totalPx = W * H;
  if (noiseMapSize < totalPx) buildNoiseMap(totalPx);

  const ox0 = Math.floor(W * CFG.OBJ_X0);
  const ox1 = Math.floor(W * CFG.OBJ_X1);
  const oy0 = Math.floor(H * CFG.OBJ_Y0);
  const oy1 = Math.floor(H * CFG.OBJ_Y1);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i   = (y * W + x) * 4;
      const ni  = (y * W + x) % noiseMapSize;

      const inObj = (x >= ox0 && x <= ox1 && y >= oy0 && y <= oy1);
      const trueZ = inObj ? S.Z : CFG.BG_DEPTH;

      const trueD  = (S.f * S.B) / trueZ;
      const noiseD = noiseMap[ni] * S.sigma;
      const measD  = trueD + noiseD;

      let measZ;
      if (measD <= CFG.MIN_DISP) {
        measZ = 0;
      } else {
        measZ = (S.f * S.B) / measD;
      }

      const isInvalid = trueD < CFG.MIN_DISP || measZ <= 0 || measZ > CFG.MAX_DEPTH + 1;
      const [r, g, b] = isInvalid ? [12, 12, 12] : depthToRgb(measZ);
      px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);

  if ((S.f * S.B) / S.Z >= CFG.MIN_DISP) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox0, oy0, ox1 - ox0, oy1 - oy0);
  }
}

/* ── RENDER: UNCERTAINTY MAP ───────────────────────────────────*/
function renderUncertaintyMap(cvs) {
  const { w: W, h: H } = syncCanvasSize(cvs);
  if (W < 2 || H < 2) return;
  const ctx = cvs.getContext('2d');

  const imgData = ctx.createImageData(W, H);
  const px = imgData.data;

  const ox0 = Math.floor(W * CFG.OBJ_X0);
  const ox1 = Math.floor(W * CFG.OBJ_X1);
  const oy0 = Math.floor(H * CFG.OBJ_Y0);
  const oy1 = Math.floor(H * CFG.OBJ_Y1);

  const sigEff = Math.max(S.sigma, 0.4);
  const maxDz = (CFG.BG_DEPTH * CFG.BG_DEPTH * sigEff) / (S.f * S.B);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i    = (y * W + x) * 4;
      const inObj = (x >= ox0 && x <= ox1 && y >= oy0 && y <= oy1);
      const trueZ = inObj ? S.Z : CFG.BG_DEPTH;
      const trueD = (S.f * S.B) / trueZ;

      let r, g, b;
      if (trueD < CFG.MIN_DISP) {
        r = 20; g = 20; b = 20;
      } else {
        const dz = (trueZ * trueZ * sigEff) / (S.f * S.B);
        [r, g, b] = uncToRgb(dz, maxDz);
      }

      px[i] = r; px[i+1] = g; px[i+2] = b; px[i+3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

/* ── UPDATE READOUTS ───────────────────────────────────────────
   UNIT REFERENCE
   ──────────────
   S.B     = metres        (slider shows cm, converted via ÷100)
   S.f     = pixels
   S.Z     = metres
   S.sigma = pixels

   d  = (f × B) / Z       → px·m / m       = px
   Zc = (f × B) / d       → px·m / px      = m
   dZ = Z²·σ / (f·B)      → m²·px / (px·m) = m
   dZ_cm  = dZ × 100                        = cm
   rmse   = dZ_cm (same formula, 1-σ approx) = cm                */

function updateReadouts() {
  /* Disparity in pixels */
  const d  = (S.f * S.B) / S.Z;                  /* px              */

  /* Back-computed depth (should equal S.Z for zero noise) */
  const Zc = (S.f * S.B) / d;                    /* m               */

  /* Depth uncertainty (metres), then convert to cm for display */
  const dZ_m  = (S.Z * S.Z * S.sigma) / (S.f * S.B);  /* m        */
  const dZ_cm = dZ_m * 100;                             /* cm       */

  /* RMSE ≈ ΔZ for single-point Gaussian (same value, in cm) */
  const rmse_cm = dZ_cm;                                /* cm       */

  /* ── Disparity readout (px) ── */
  const dEl = document.getElementById('out-d');
  dEl.textContent = d.toFixed(1);
  dEl.className = 'rc-value' + (d < 2 ? ' danger' : d < 5 ? ' warn' : '');

  /* ── Computed Z readout (m) ── */
  document.getElementById('out-Z').textContent = Zc.toFixed(2);

  /* ── Uncertainty readout (cm) ── */
  document.getElementById('out-dZ').textContent = dZ_cm.toFixed(1);

  /* ── RMSE readout (cm) with colour coding ── */
  const rmseEl = document.getElementById('out-rmse');
  rmseEl.textContent = S.sigma > 0 ? rmse_cm.toFixed(1) : '0.0';
  rmseEl.className = 'rc-value' +
    (S.sigma === 0 ? '' :
      rmse_cm < 5 ? ' good' : rmse_cm < 20 ? ' warn' : ' danger');

  /* ── Formula card live values ── */
  document.getElementById('f-Z').textContent =
    `= ${Zc.toFixed(2)} m`;
  document.getElementById('f-dZ').textContent =
    S.sigma > 0 ? `= ${dZ_cm.toFixed(1)} cm` : '= 0 cm';
}

/* ── RENDER ALL ────────────────────────────────────────────────*/
function renderAll() {
  renderScene(document.getElementById('cvs-scene'));
  renderCameraView(document.getElementById('cvs-left').getContext('2d'),  true);
  renderCameraView(document.getElementById('cvs-right').getContext('2d'), false);
  renderDepthMap(document.getElementById('cvs-depth'));
  renderUncertaintyMap(document.getElementById('cvs-unc'));
  updateReadouts();
}

/* ── WIZARD LOGIC ──────────────────────────────────────────────*/
function updateWizard() {
  const s = WIZARD[S.step];

  const iconEl = document.getElementById('wizard-icon');
  iconEl.innerHTML = WIZARD_ICONS[s.icon] || WIZARD_ICONS.camera;

  document.getElementById('wizard-title').textContent = s.title;
  document.getElementById('wizard-text').textContent  = s.text;

  const taskEl = document.getElementById('wizard-task');
  if (s.task) {
    taskEl.textContent = s.task;
    taskEl.classList.remove('hidden');
  } else {
    taskEl.textContent = '';
    taskEl.classList.add('hidden');
  }

  document.querySelectorAll('.ctrl-group').forEach(el => el.classList.remove('lit'));

  if (s.lit) {
    const el = document.getElementById(s.lit);
    if (el) {
      el.classList.add('lit');
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  const dots  = document.querySelectorAll('.step-node');
  const lines = document.querySelectorAll('.step-line');
  dots.forEach((dot, i) => {
    dot.classList.remove('active', 'done');
    if (i === S.step)  dot.classList.add('active');
    if (i < S.step)   dot.classList.add('done');
  });
  lines.forEach((line, i) => {
    line.classList.toggle('done-line', i < S.step);
  });

  const btnNext = document.getElementById('btn-next');
  const btnSkip = document.getElementById('btn-skip');
  if (S.step >= WIZARD.length - 1) {
    btnNext.textContent = 'Explore Freely';
    btnSkip.style.display = 'none';
  } else {
    btnNext.textContent = 'Next Step';
    btnSkip.style.display = '';
  }
}

function gotoStep(n) {
  S.step = Math.max(0, Math.min(n, WIZARD.length - 1));
  updateWizard();
}

/* ── SLIDER EVENT BINDING ──────────────────────────────────────*/
function setupControls() {

  function bind(id, labelId, unit, transform, stateKey, noiseRebuild) {
    const el = document.getElementById(id);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value);
      S[stateKey] = transform(v);
      document.getElementById(labelId).textContent = formatLabel(v, unit, stateKey);
      if (noiseRebuild) buildNoiseMap();
      renderAll();
    });
  }

  function formatLabel(v, unit, key) {
    if (key === 'B')     return `${v.toFixed(1)} cm`;
    if (key === 'f')     return `${Math.round(v)} px`;
    if (key === 'Z')     return `${v.toFixed(2)} m`;
    if (key === 'sigma') return `${v.toFixed(1)} px`;
    return `${v} ${unit}`;
  }

  bind('rng-B', 'lbl-B', 'cm', v => v / 100, 'B', false);
  bind('rng-f', 'lbl-f', 'px', v => v, 'f', false);
  bind('rng-Z', 'lbl-Z', 'm', v => v, 'Z', false);
  bind('rng-s', 'lbl-s', 'px', v => v, 'sigma', true);

  document.getElementById('btn-next').addEventListener('click', () => {
    gotoStep(S.step + 1);
  });
  document.getElementById('btn-skip').addEventListener('click', () => {
    gotoStep(WIZARD.length - 1);
  });

  document.querySelectorAll('.step-node').forEach(dot => {
    dot.addEventListener('click', () => gotoStep(parseInt(dot.dataset.step)));
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    S.B = 0.10; S.f = 700; S.Z = 2.0; S.sigma = 0;
    document.getElementById('rng-B').value = 10;
    document.getElementById('rng-f').value = 700;
    document.getElementById('rng-Z').value = 2;
    document.getElementById('rng-s').value = 0;
    document.getElementById('lbl-B').textContent = '10.0 cm';
    document.getElementById('lbl-f').textContent = '700 px';
    document.getElementById('lbl-Z').textContent = '2.00 m';
    document.getElementById('lbl-s').textContent = '0.0 px';
    buildNoiseMap();
    renderAll();
  });

  /* Debounced resize handler */
  let resizeTimeout;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => renderAll(), 100);
  });
}

/* ── INIT ──────────────────────────────────────────────────────*/
function init() {
  buildNoiseMap();
  setupControls();
  updateWizard();

  /* Render after layout settles */
  requestAnimationFrame(() => {
    renderAll();
  });
}

window.addEventListener('load', init);
