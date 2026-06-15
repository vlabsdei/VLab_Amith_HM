## Procedure

## Dashboard Navigation Guide

Before you begin, take a moment to understand the two main sections of the web application: **Setup Lab** and **Calibration Simulation**.

**Phase 1: Setup Lab**
* **Setup Instructions & 3D Controls (Left):** Shows your current step in mounting the equipment or capturing images. It also provides hints for orbiting, panning, and zooming the 3D scene.
* **3D Scene & Captured Poses (Center):** Displays a live 3D view of the physical setup. Below it, you'll see a gallery of your captured calibration poses. You need at least 5 poses to calculate the intrinsic matrix.
* **Equipment & Capture Controls (Right):** Use this to mount the Camera Tripod, USB Camera, Checkerboard on Rail, and Light Source sequentially. Once everything is set up, the panel switches to Capture Mode. Here, you get sliders to adjust the board's tilt and distance so you can grab a variety of checkerboard poses.

**Phase 2: Calibration Simulation**
* **Wizard & Matrices (Left):** A guided tutorial that displays the live Intrinsic Matrix (K) alongside estimated Distortion Coefficients (k1, k2, p1, p2).
* **Image Processing & Error Visualizations (Center):** Compares Distorted and Undistorted images, and shows a 3D Reprojection Error Surface, Pose Diversity Map, and a Quality Gauge for your calibration.
* **Parameters & Live Readouts (Right):** Includes sliders for the Number of Poses (N), Tilt Diversity, Square Size, and physical lens Distortion (k1). It also provides live readings for Focal Length, Reprojection Error, and optical center (cx, cy).

## Experimental Procedure

### Step 1: Mount the Equipment
A stable physical setup is essential for proper calibration.
* **Action:** Click "Mount Component" in the right panel to place the Camera Tripod, USB Camera, Checkerboard on Rail, and Light Source in order.
* **Observation:** The central 3D view updates as you place each piece of equipment. After mounting everything, the interface automatically switches to Capture Mode.

### Step 2: Capture Calibration Poses
Zhang's Method relies on multiple images of the checkerboard taken from different distances and orientations.
* **Action:** Change the **Board tilt X**, **Board tilt Y**, and **Board distance** sliders, then click "Capture Pose". Do this repeatedly to collect at least 5 varied poses (15-30 is ideal).
* **Observation:** Your images will appear in the Captured Poses grid. Note how changing the distance and tilt alters the perspective distortion of the squares—this variation is key to solving the intrinsic matrix. Once you have 5 or more poses, click "Go to Simulation".

### Step 3: Analyze Distortion and Undistortion
Real lenses have radial distortion, which makes straight lines look curved.
* **Action:** In the Simulation phase, move the **Distortion k1** slider in the right panel between -0.6 (barrel distortion) and +0.3 (pincushion distortion).
* **Observation:** Look at the Distorted Image (Raw Camera) in the center panel and see how the lines bend. Then, check the Undistorted Image, which uses the estimated calibration parameters to straighten those lines back out.

### Step 4: Explore Pose Quantity and Diversity
Calibration accuracy heavily depends on the number of poses and how diverse their orientations are.
* **Action:** Change the **Number of Poses (N)** and **Tilt Diversity** sliders. Keep an eye on the Quality Gauge and the 3D Reprojection Error Surface.
* **Observation:** Lowering the number of poses or tilt diversity causes the Reprojection Error to spike, dropping the Quality Gauge to "Poor". Capturing a high number of poses (15-25) with varied tilt ensures a stable K matrix and low error.

### Step 5: Understand Square Size Scaling
The physical size of the checkerboard squares anchors the calibration to real-world measurements.
* **Action:** Move the **Square Size** slider between 8 mm and 60 mm.
* **Observation:** See how the estimated Focal Length shifts. If the assumed square size doesn't match the actual physical board, the focal length estimation will be scaled wrong, even if the reprojection error remains low.
