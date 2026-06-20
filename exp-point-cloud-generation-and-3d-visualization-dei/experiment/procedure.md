## Procedure

## Dashboard Navigation Guide

Before you begin, take a moment to understand the two main sections of the web application: **Setup Lab** and **Point Cloud Simulation**.

**Phase 1: Setup Lab**
* **Setup Instructions & 3D Controls (Left):** Shows your current step in mounting the depth sensing equipment or placing the target object. It also provides hints for orbiting, panning, and zooming the 3D scene.
* **3D Scene & Depth Map (Center):** Displays a live 3D view of the physical setup. Below it, you'll see the raw 2D depth map captured by the sensor. 
* **Equipment & Target Controls (Right):** Use this to sequentially mount the Tripod, Depth Sensor, and Target Object (like a cube or flat wall). Once everything is set up, the panel switches to Simulation Mode.

**Phase 2: Point Cloud Simulation**
* **Wizard & Theory (Left):** A guided tutorial that explains the back-projection math and displays live calculations for Total Points, Density, and Point Spacing.
* **3D Point Cloud Viewer (Center):** An interactive 3D viewer showing the generated point cloud. You can freely orbit and zoom to inspect surface details, noise, and edge artifacts.
* **Parameters & Live Readouts (Right):** Includes sliders for Camera Resolution, Distance (<i>Z</i>), Sensor Noise (&sigma;), Focal Length (<i>f</i><sub><i>x</i></sub>), and Principal Point (<i>c</i><sub><i>x</i></sub>). It also provides live readings for Root Mean Square Error (RMSE).

## Experimental Procedure

### Step 1: Mount the Equipment
A stable physical setup is required before generating the point cloud.
* **Action:** Click "Mount Component" in the right panel to place the Tripod, Depth Sensor, and Target Object in order.
* **Observation:** The central 3D view updates as you place each piece of equipment. After mounting everything, the interface automatically switches to Simulation Mode.

### Step 2: Investigate Resolution and Point Count
The resolution of your depth sensor directly dictates how many 3D points are generated.
* **Action:** In the Simulation phase, adjust the **Resolution** slider between 320×240, 640×480, and 1280×960. Keep the target at a fixed distance (e.g., <i>Z</i> = 1 m).
* **Observation:** Watch the Total Points counter. Notice how dropping the resolution by half in both dimensions reduces the point count to a quarter (e.g., from ~300k to ~75k), creating visibly larger gaps between the points in the 3D viewer.

### Step 3: Explore Distance and Point Density
Point spacing changes drastically depending on how far the target is from the camera.
* **Action:** Keep the resolution constant and slide the **Distance (Z)** from 1 meter back to 4 meters or 8 meters.
* **Observation:** The bounding box of the point cloud expands as the camera's field of view covers more area. Because the total number of points remains the same, the point density plummets, making the distant target appear sparse and ghost-like.

### Step 4: Model Sensor Noise and RMSE
Real depth sensors have inherent random noise that creates rough surfaces.
* **Action:** Place a flat wall target at <i>Z</i> = 2 m. Increase the **Sensor Noise (&sigma;)** slider to 30 mm, then slowly reduce it to 2 mm. Check the RMSE readout.
* **Observation:** At high noise levels, the flat wall appears incredibly wavy and rough as points are randomly pushed forward and backward. As you lower the noise to 2 mm, the points snap tightly into a clean, flat plane. Notice how the RMSE value scales linearly with the noise parameter.

### Step 5: Introduce Calibration Errors
Accurate back-projection relies completely on perfectly calibrated intrinsic parameters.
* **Action:** Intentionally add a 10% error to the **Focal Length (<i>f</i><sub><i>x</i></sub>)** slider. Then, reset it and add a +5 px error to the **Principal Point (<i>c</i><sub><i>x</i></sub>)** slider.
* **Observation:** A smaller focal length artificially inflates your X and Y coordinates, stretching the target object and making it look much larger. A wrong principal point shifts the entire point cloud sideways systematically—a rigid translation error that looks completely different from random sensor noise.

### Step 6: Analyze Edge Artifacts (Flying Pixels)
Depth sensors often get confused at sharp boundaries between objects.
* **Action:** Select the Cube target and orbit the 3D viewer so you can see the edge where the cube meets the background wall. 
* **Observation:** You will spot rogue points floating in mid-air between the box and the wall. These are "flying pixels," caused by a single pixel straddling the depth discontinuity. Try changing the resolution to see how it affects the density of these artifacts without eliminating them.
