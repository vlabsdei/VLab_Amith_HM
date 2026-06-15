## Procedure

## Dashboard Navigation Guide

Before you begin, take a moment to understand the two main sections of the web application: **Setup Lab** and **Stereo Vision Simulation**.

**Phase 1: Setup Lab**
* **Setup Instructions & 3D Controls (Left):** Shows your current step in the mounting process. It also provides helpful hints for orbiting, panning, and zooming the 3D scene.
* **3D Scene & Observations (Center):** Features a live 3D view of the physical equipment setup. Once your cameras are mounted, this panel will also show a disparity measurement visualization and the raw camera observations.
* **Apparatus Controls (Right):** Use this to sequentially mount the Rail Assembly, Camera L (Blue), Camera R (Teal), and the Target Cube. You'll also find live readouts for Baseline and Depth here.

**Phase 2: Stereo Vision Simulation**
* **Wizard & Legends (Left):** Provides a guided tutorial wizard, along with color keys for the camera views, depth map, and uncertainty map.
* **Scene & Maps (Center):** Shows a top-down view of the scene, simulated left and right camera views (to visualize disparity), a 3D Depth Map, and a Topographic Uncertainty Map.
* **Parameters & Live Readouts (Right):** Includes sliders for adjusting Baseline (B), Focal Length (f), Object Distance (Z), and Disparity Noise (σ). You can also view live readouts for Disparity, Computed Z, Uncertainty (ΔZ), and RMSE, complete with live mathematical formulas.

## Experimental Procedure

### Step 1: Mount the Equipment
A stable dual-camera rig is essential for proper stereo vision.
* **Action:** Click "Mount Component" in the right panel to place the Rail Assembly, Camera L, Camera R, and the Target Cube in order.
* **Observation:** The central 3D view updates as you place each piece of equipment. After everything is mounted, click the "Go To Simulation" button.

### Step 2: Set the Baseline
The baseline (B) is simply the physical horizontal distance between your two cameras.
* **Action:** In the Simulation phase, move the **Baseline** slider anywhere between 2 cm and 50 cm.
* **Observation:** See how the camera icons spread apart in the Scene Top View. Widening the baseline yields larger disparity values for objects at the same distance, which ultimately boosts depth accuracy and reduces spikes on the Uncertainty Map.

### Step 3: Set the Focal Length
Focal length (f) determines how much the lens zooms in. A longer zoom narrows your field of view but grants higher precision.
* **Action:** Move the **Focal Length** slider between 200 px and 1000 px.
* **Observation:** Keep an eye on the disparity readout in the live metrics. A longer focal length forces a specific point in the scene to appear farther from the center of each camera image, which increases disparity.

### Step 4: Place the Object
Object distance (Z) determines how far away the target sits from the camera pair.
* **Action:** Drag the **Object Distance** slider from 0.3 m all the way out to 10 m.
* **Observation:** As the distance increases, the disparity drops and the Depth Map shifts in color. If you push the object too far away, disparity will fall below 1 px, causing the Depth Map to show invalid patches.

### Step 5: Add Measurement Noise
Real-world sensors aren't perfect. The noise parameter lets you inject Gaussian random error into your disparity measurements.
* **Action:** Set the **Disparity Noise (σ)** slider to 3.0 px, and then gradually move the Object Distance (Z) from 1 m to 7 m.
* **Observation:** Watch the RMSE readout climb. The depth map usually remains usable at close range, but the Uncertainty Map will develop red spikes at longer distances because the noise introduces massive depth errors. Try widening the Baseline to counter this uncertainty.
