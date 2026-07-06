## Theory

### 1. The Core Idea — Painting with Light

Imagine trying to figure out the shape of an invisible object in a dark room. In previous experiments, we learned that LiDAR fires a single laser pulse and measures how long it takes to bounce back (one point at a time), while Stereo Vision uses two cameras to triangulate points like human eyes. 

Structured Light takes a much more creative approach: it **paints the scene** with a known pattern of light. When this pattern lands on a 3D object, the shape of the object distorts the pattern. By looking at how the pattern bends, stretches, and curves from the camera's perspective, we can decode the height of *every single point on the surface all at once*.

### 2. Why Use Wavy Lines?

The most common pattern used in industrial structured light isn't a simple grid—it's a set of sinusoidal fringes. Picture a series of smooth, parallel black-and-white stripes that transition beautifully from bright to dark and back again, just like a cosine wave.

The secret ingredient hidden in these waves is the **phase (&phi;)**. Think of phase as your exact position within one black-and-white cycle (from 0 to 2&pi;). When you project these fringes onto a flat wall, they look perfectly straight. But when you project them onto a curved object, the fringes wrap around the object. To the camera sitting off to the side, the lines appear bent. This bending is a geometric shift, which changes the phase at every pixel. This shift in phase is exactly what encodes the object's height!

### 3. The Phase-Shifting Magic

There's one catch. If you just snap a single picture of these fringes on an object, you run into a math problem. At any given pixel, a dark spot could mean two things: either it's the dark part of the projected stripe (the phase), or the object itself is just painted black (surface reflectance). One image cannot tell the difference. 

To solve this, we use the **phase-shifting algorithm**. We don't project just one image—we project a sequence of *N* images, shifting the stripes slightly sideways each time by a known fraction of the pattern:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>shift</i><sub><i>n</i></sub>&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;">2&pi; &times; <i>n</i></span>
    <span style="padding: 0 10px; line-height: 1.2;"><i>N</i></span>
  </span>
</div>
*(for n = 0, 1, 2, ..., N-1)*

The intensity of light the camera captures at every pixel across these images looks like this:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem;">
  <i>I</i><sub><i>n</i></sub>(<i>u</i>, <i>v</i>) = <i>A</i>(<i>u</i>, <i>v</i>) + <i>B</i>(<i>u</i>, <i>v</i>) &times; cos(<i>&phi;</i>(<i>u</i>, <i>v</i>) + <i>shift</i><sub><i>n</i></sub>)
</div>

Here's what those letters actually mean:
- **A(u,v):** The average brightness (background ambient light + the object's natural colour).
- **B(u,v):** The fringe contrast (how bright the projector's stripes are on the object).
- **&phi;(u,v):** The geometric phase (the golden ticket that tells us the height!).

Since we have three unknowns (A, B, and &phi;), we mathematically need at least 3 images to solve the puzzle. If we use the classic **4-step method** (shifting the pattern by 0, &pi;/2, &pi;, and 3&pi;/2), the math simplifies beautifully to:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>&phi;</i>(<i>u</i>, <i>v</i>)&nbsp;=&nbsp;arctan&nbsp;
  <span style="font-size: 2rem; font-weight: 300;">(</span>
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center; margin: 0 5px;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;"><i>I</i><sub>3</sub> &minus; <i>I</i><sub>1</sub></span>
    <span style="padding: 0 10px; line-height: 1.2;"><i>I</i><sub>0</sub> &minus; <i>I</i><sub>2</sub></span>
  </span>
  <span style="font-size: 2rem; font-weight: 300;">)</span>
</div>

### 4. Taking More Steps (The General N-Step Formula)

If 3 or 4 images are enough, why would we ever take 8 or 16? Because camera sensors are noisy! Taking more images acts like an optical average, smoothing out the noise and making the final 3D model much cleaner. For any number of steps *N*, the phase is calculated as:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>&phi;</i>(<i>u</i>, <i>v</i>)&nbsp;=&nbsp;arctan&nbsp;
  <span style="font-size: 2rem; font-weight: 300;">(</span>
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center; margin: 0 5px;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;">
      &minus;&sum;<sub><i>n</i></sub> <i>I</i><sub><i>n</i></sub> &times; sin(<i>shift</i><sub><i>n</i></sub>)
    </span>
    <span style="padding: 0 10px; line-height: 1.2;">
      &sum;<sub><i>n</i></sub> <i>I</i><sub><i>n</i></sub> &times; cos(<i>shift</i><sub><i>n</i></sub>)
    </span>
  </span>
  <span style="font-size: 2rem; font-weight: 300;">)</span>
</div>

### 5. Translating Phase to Physical Height

Once we have our pure phase map &phi;, we use triangulation to convert it into actual physical height (h) in millimetres:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>h</i>(<i>u</i>, <i>v</i>)&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;"><i>p</i> &times; <i>&phi;</i>(<i>u</i>, <i>v</i>)</span>
    <span style="padding: 0 10px; line-height: 1.2;">2&pi; &times; tan(<i>&alpha;</i>)</span>
  </span>
</div>

Where:
- **p:** The physical width of one fringe on the object (the period).
- **&alpha;:** The baseline angle between the projector and the camera.

If you widen the angle **&alpha;**, the system becomes hyper-sensitive to height changes. If you shrink the fringe period **p** (making the stripes thinner), you can detect microscopic details. 

### 6. The Wrapping Problem

There's a mathematical catch in the arctan function we used earlier—it can only output values between -&pi; and +&pi;. Imagine a clock that resets to zero every time it hits 12. If a surface is so steep that the true phase should be 3&pi;, the math forces it to wrap around and output &pi; instead. 

This causes visual "cliffs" or sawtooth artefacts in the 3D data, known as **phase wrapping**. The process of seamlessly stitching these jumps back together is called phase unwrapping. The maximum height your system can measure before these messy wrapping jumps occur is:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>h</i><sub>max</sub>&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;"><i>p</i></span>
    <span style="padding: 0 10px; line-height: 1.2;">2&pi; &times; tan(<i>&alpha;</i>)</span>
  </span>
</div>

### 7. Battling Ambient Light 

Structured light scanners have a mortal enemy: the sun (or any bright room lights). Ambient light washes out the dark stripes of the projected pattern, destroying the contrast. We measure this contrast mathematically using the **modulation ratio (M)**:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>M</i>(<i>u</i>, <i>v</i>)&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;"><i>B</i>(<i>u</i>, <i>v</i>)</span>
    <span style="padding: 0 10px; line-height: 1.2;"><i>A</i>(<i>u</i>, <i>v</i>)</span>
  </span>
</div>

When M drops too low (because ambient light causes A to spike while B stays the same), the camera can no longer tell the difference between the stripes and the background. The phase math collapses into random noise, completely ruining the 3D scan. This is why professional 3D scanning is often done in darkened enclosures or uses ultra-bright lasers.

### 8. The Ultimate Trade-off

If you want a flawless 3D scan, you have to balance the **fringe frequency**:
- **High frequency (thin stripes):** You get incredibly detailed, high-resolution scans of smooth surfaces, but steep features will cause messy phase wrapping.
- **Low frequency (thick stripes):** You rarely get phase wrapping errors, but you sacrifice the ability to see fine, microscopic details.

In modern applications—like FaceID on your phone or industrial inspection robots—engineers use multi-frequency systems that project thick stripes first to get the general shape, and thin stripes later to fill in the ultra-fine details!
