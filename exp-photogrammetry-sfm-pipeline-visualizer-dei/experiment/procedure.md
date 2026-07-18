## Procedure

## Dashboard Navigation Guide

Before you begin, take a moment to understand the two main sections of the web application: **Setup Lab** and **SfM Simulation**.

**Phase 1: Setup Lab**
* **Tutorial Wizard (Left):** Guides you through the physical apparatus setup and gives you tips for interacting with the 3D environment.
* **3D Viewport (Center):** Features an interactive, real-time 3D view of the physical scanning setup. You can pan, orbit, and zoom to inspect the camera ring around the subject.
* **Apparatus Controls & Specifications (Right):** Allows you to mount the Turntable, Subject, Camera, and Scale Reference. It also provides detailed specifications for each selected component.

**Phase 2: SfM Simulation**
* **Pipeline Controls (Left):** Contains the core action buttons to "Run SfM Pipeline" and "Densify Reconstruction." It also displays the Live Readouts for the pipeline stages, point counts, errors, and scale factors.
* **Visualization (Center):** Shows the generated 3D Point Cloud on top, and a live graph of Feature Matches (or Bundle Adjustment Convergence) on the bottom.
* **Parameters & Quality (Right):** Houses the sliders for adjusting Number of Images, Overlap, Elevation Spread, False Matches, and the RANSAC Filter toggle. Below this, you'll see a Reconstruction Quality Gauge and the mathematical formula card.

## Experimental Procedure

### Step 1: Mount the Equipment
Proper data capture begins with a solid physical setup in the studio.
* **Action:** In the Setup Lab, click "Mount Component" sequentially to place the Motorised Turntable, the Carved Stone Subject, the Camera, and the Scale Reference.
* **Observation:** The 3D view updates as each component is added to the scene. Once all parts are mounted, click "Next Step" to proceed to capture configuration.

### Step 2: Configure the Camera Network
The density of your camera network directly impacts reconstruction quality.
* **Action:** Adjust the "Number of Cameras" and "Elevation Spread" sliders in the Setup Lab.
* **Observation:** Notice how the camera icons arrange themselves around the subject in the 3D view. When ready, click "Simulate Capture" to snap the photos, and then "Skip to Simulation."

### Step 3: Run the SfM Pipeline
The software must mathematically align all the unstructured photographs.
* **Action:** In the Simulation phase, click the "Run SfM Pipeline" button on the left panel.
* **Observation:** Watch the pipeline stage indicators (Feature Extraction, Matching, Pose Estimation, etc.) turn green as they complete. A sparse point cloud will appear in the 3D view, representing triangulated keypoints.

### Step 4: Test Image Overlap and Elevation Spread
A robust 3D model requires cameras to view the object from many angles.
* **Action:** Drop the "Elevation Spread" slider to 0° and re-run the pipeline.
* **Observation:** The top of the object will disappear from the 3D point cloud! Without elevation spread, the cameras can only see the equator of the subject. Increase it back to 60° to recapture the whole object.

### Step 5: Test RANSAC and Outlier Rejection
Not every feature match found by the computer is correct. False matches can destroy a reconstruction.
* **Action:** Increase the "False Match Rate" to 15% and turn the "RANSAC Filter" OFF. Run the pipeline.
* **Observation:** The Reprojection Error will skyrocket into the red, and the reconstruction quality will plummet.
* **Action:** Now turn the "RANSAC Filter" ON and re-run.
* **Observation:** Notice how the outlier lines in the match graph turn red (rejected) and green (accepted). The Reprojection Error drops back down as the algorithm successfully filters out the bad data.

### Step 6: Densify the Reconstruction
Sparse points are just the skeleton. A dense point cloud provides the surface.
* **Action:** Once you have a high-quality sparse reconstruction, click the "Densify Reconstruction" button.
* **Observation:** The Multi-View Stereo algorithm will fill in the gaps between the sparse points, producing a rich, solid-looking 3D point cloud of the subject.
