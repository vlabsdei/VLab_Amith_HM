## Procedure

## Dashboard Navigation Guide

Before you begin the experiment, take a moment to understand the dual-phase architecture of the web application: **Setup Lab** and **Fringe Projection Simulation**. This structure is designed to help you first build a physical intuition of the hardware, and then dive deep into the computational algorithms.

**Phase 1: Setup Lab**
* **Setup Instructions & 3D Controls (Left Panel):** Displays your current objective in the equipment mounting process. It provides helpful hints for navigating the 3D space (orbiting, panning, and zooming) so you can inspect the physical relationships between components.
* **3D Scene & Observations (Center Panel):** Features a live, interactive 3D view of the physical equipment. Once your projector and camera are mounted, this panel visualizes the spatial triangulation arrangement—the core geometric principle that makes structured light scanning possible.
* **Apparatus Controls (Right Panel):** Use this panel to sequentially mount the system components into the virtual lab: the Projector (which acts as an active light source), the Camera (the sensor), the Target Surface (the object being scanned), and the Enclosure (used to control environmental lighting). You can also define initial physical parameters, such as Surface Reflectivity and Baseline Angle (α), before launching the simulation.

**Phase 2: Fringe Projection Simulation**
* **Wizard & Readouts (Left Panel):** Provides a guided tutorial wizard that walks you through the core concepts of phase shifting. It also features real-time live readouts of calculated variables (like the exact calculated Height RMSE) and an interactive graph plotting Height RMSE vs. Phase Steps (N) to help you visualize the diminishing returns of taking excessive images.
* **Scene & Maps (Center Panel):** Displays the core visual algorithms of the simulation in real-time. This includes:
  * **Projected Fringes:** The raw, intensity-distorted sine waves as seen by the camera.
  * **Wrapped Phase Map:** The raw arctangent output of the phase-shifting algorithm, bounded between $-\pi$ and $+\pi$ (creating a sawtooth visual pattern).
  * **Unwrapped Height Profile:** The final 3D reconstruction achieved by removing the $2\pi$ discontinuities from the wrapped map.
  * **Modulation Map:** A visual representation of fringe contrast (signal-to-noise ratio) across the surface.
* **Parameters & Quality (Right Panel):** Includes interactive sliders for adjusting Phase Steps (N), Fringe Period (p), Baseline Angle (α), Ambient Light, and Surface Amplitude. It also features a Phase Steps Preview (showing the exact sequence of shifted sine waves being projected) and a dynamic Quality Gauge.

---

## Elaborated Experimental Procedure

Structured light 3D scanning relies on projecting a known pattern (usually sinusoidal fringes) onto an object, capturing the deformed pattern with a camera, and using triangulation to calculate depth. Follow these steps to understand the variables that affect this process.

### Step 1: Mount and Inspect the Physical Equipment
A highly stable and precisely calibrated projector-camera setup is strictly required for structured light scanning. 
* **Action:** Click the mount button in the right panel to place the Projector, Camera, Surface, and Enclosure in order. Use your mouse to rotate the 3D view and observe the angles.
* **Observation & Theory:** Notice that the camera and projector are offset by a specific Baseline Angle (&alpha;). This is the triangulation angle. If they were perfectly aligned (angle = 0&deg;), the camera would not see any distortion in the fringes regardless of the object's height. Once mounted, click "Go To Simulation".

### Step 2: Analyze the Effect of Phase Steps (N)
The Phase-Shifting algorithm requires projecting multiple sine waves, each shifted by a fraction of a period (like 2&pi;/N), to mathematically solve for the phase at each pixel.
* **Action:** In the Simulation phase, grab the **Phase Steps (N)** slider and move it between its minimum (3) and maximum (16).
* **Observation & Theory:** Mathematically, a minimum of 3 steps is required to solve the three unknowns in the fringe equation (ambient intensity, modulation amplitude, and phase). However, using only 3 steps makes the system highly susceptible to sensor noise. As you increase N, you are effectively oversampling. Watch the **Height RMSE vs N graph**; you will see the Root Mean Square Error (RMSE) drop dramatically from N=3 to N=6, but then plateau. This teaches you that while more steps average out noise, taking 16 images takes more time and yields diminishing returns compared to 6 or 8 images.

### Step 3: Optimize the Fringe Period (p)
The fringe period determines the spatial frequency—the physical width of each black-and-white sine wave cycle projected onto the object.
* **Action:** Slowly move the **Fringe Period (p)** slider from 40 mm down to 2 mm.
* **Observation & Theory:** 
  * **Low Frequency (e.g., 40 mm):** The fringes are very wide. The Phase Map is simple and easy for the computer to unwrap, but the height measurement has low sensitivity and low resolution.
  * **High Frequency (e.g., 5 mm):** The fringes are thin and dense. This greatly increases the depth resolution and sensitivity to microscopic surface details.
  * **The Trade-off:** If you make the period too small (e.g., 2 mm), the spatial frequency becomes too high for the camera's pixel grid (aliasing), or the steep slopes of the object cause neighboring fringes to overlap. Watch the **Unwrapped Height Profile** carefully: at very low periods, the unwrapping algorithm will fail, causing massive artifacts (artificial cliffs or spikes) in the 3D reconstruction.

### Step 4: Configure the Baseline Angle (α)
The baseline angle dictates the geometric sensitivity of the system.
* **Action:** Drag the **Baseline Angle (α)** slider back and forth between 5° and 55°.
* **Observation & Theory:** As you increase the angle, the spatial distortion of the fringes caused by the object's height becomes much more exaggerated from the camera's perspective. This leads to higher depth resolution. However, observe the edges of the simulated object. Excessive angles create geometric "shadows" (occlusions) where the projector illuminates a region that the camera's lens cannot physically see. This results in missing data points in your 3D scan. Engineers must balance resolution against maximum surface coverage.

### Step 5: Inject Ambient Light and Monitor the Modulation Map
Real-world scanning environments contain background lighting that interferes with the active projection.
* **Action:** Set the **Ambient Light** slider to various percentages (0% to 80%) while watching the **Modulation Map**.
* **Observation & Theory:** Ambient light acts as a DC (constant) offset to the sinusoidal fringe intensity. It washes out the dark areas of the sine wave, drastically reducing the fringe contrast. The **Modulation Map** calculates this contrast mathematically. As ambient light increases, you will see the modulation amplitude drop toward zero, and the **Quality Gauge** will plummet. If the modulation drops below the camera's noise floor, the arctangent function used to calculate the phase becomes completely chaotic, destroying the 3D scan. This is why the physical enclosure (from Step 1) is so critical in industrial scanning.

### Step 6: Test Algorithm Robustness with Surface Amplitude
The surface amplitude dictates the maximum height variation (the steepness of the slopes) of the physical object being scanned.
* **Action:** Modify the **Surface Amp.** slider while maintaining a dense Fringe Period (e.g., p = 6 mm).
* **Observation & Theory:** Larger surface features distort the projected fringes more aggressively. By maximizing the surface amplitude, you are putting maximum stress on the spatial phase unwrapping algorithm. You can use this step to find the exact "breaking point" where your chosen Fringe Period is no longer wide enough to safely unwrap the steep height transitions of the object, resulting in catastrophic phase-unwrapping failures.
