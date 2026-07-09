## Procedure

## Dashboard Navigation Guide

Before diving into the experiment, take a moment to familiarize yourself with the two main sections of the virtual lab application: **Setup Lab** and **Simulation Explorer**.

**Phase 1: Setup Lab**
* **Guided Steps (Left):** Walks you through the process of preparing a 3D point cloud for normal estimation. It tracks your progress from mounting components to performing initial computations.
* **3D Scene View (Center):** Displays a live, interactive 3D environment. You can rotate, pan, and zoom to inspect the point cloud as it's being generated. Once the normal estimation is complete, you'll see a preview of the normals rendered as tiny spikes on the points.
* **Apparatus Controls & Live Readouts (Right):** Allows you to interact with the environment by mounting components and running processing sequences. You can also view live metrics here, like the average curvature (&kappa;) and consistency of the initial normals.

**Phase 2: Simulation Explorer**
* **Analysis Wizard (Left):** Provides a step-by-step tutorial on how different parameters affect surface meshing. It also displays detailed statistics about the generated mesh, such as triangle count and normal consistency.
* **Multi-View Analytics (Center):** Features four distinct camera views:
    * **3D Normal Hedgehog View:** A close-up 3D look at the normals (spikes) interacting with the surface.
    * **Curvature Map &kappa;:** A heatmap visualizing flat areas in blue and highly curved or noisy areas in red.
    * **Generated Mesh:** A live wireframe view showing the triangles created by the greedy meshing algorithm.
    * **Deviation vs. *k*:** A graph showing how the consistency of the normals fluctuates as you change the neighbourhood size.
* **Parameters & Quality Gauge (Right):** Offers interactive sliders to adjust crucial variables like Neighbourhood size (*k*), Point Noise (&sigma;), Surface Shape, Orientation logic, and Max Triangle Edge. A real-time Mesh Quality Gauge evaluates the overall health of your 3D mesh.

## Experimental Procedure

### Step 1: Initialize the Environment
Before processing any data, you need to prepare the virtual 3D scene.
* **Action:** In the Setup Lab phase, click the "Mount Component" button sequentially to spawn the 3D surface, sample the point cloud, and build the initial spatial trees. 
* **Observation:** Watch the 3D Scene View as the raw data appears on screen. 

### Step 2: Configure the Neighbourhood (*k*)
The choice of how many neighbours to look at profoundly impacts normal estimation.
* **Action:** Adjust the **Neighbourhood *k*** slider. 
* **Observation:** Notice how the highlighted points around the target region expand and contract. This visually demonstrates the volume of points that will be grouped together during the Principal Component Analysis (PCA).

### Step 3: Run the PCA Normal Estimation
You're now ready to compute the normals for thousands of points.
* **Action:** Click "Estimate Normals" and wait for the progress bar to complete.
* **Observation:** Tiny coloured spikes will erupt from the point cloud. These represent the estimated normal vectors. Once the calculation finishes, click the "Launch Simulation" button to dive into the detailed analysis.

### Step 4: Explore the Impact of Noise
Real 3D scanners are never perfect; they always introduce some level of noise into the coordinates.
* **Action:** In the Simulation Explorer, adjust the **Point Noise &sigma;** slider from 0 mm up to 15 mm. 
* **Observation:** Look at the Curvature Map and the Generated Mesh. As noise increases, the mesh becomes jagged, and the curvature heatmap turns red. The Mesh Quality Gauge on the right will plummet, indicating that the normals are becoming chaotic and the triangles are losing structural integrity.

### Step 5: Balance the Neighbourhood Size
Now you must find a way to combat the noise using the neighbourhood size.
* **Action:** With the noise set high, drag the **Neighbourhood *k*** slider upwards (e.g., towards 40 or 50).
* **Observation:** Watch the normal spikes align and the mesh smooth out. The larger neighbourhood effectively averages out the noise. However, if you push *k* too high, you might notice that sharp geometric features on the surface start to blur or round off entirely. Finding the "sweet spot" is the key to good 3D reconstruction!

### Step 6: Test Normal Orientation
A mesh is only valid if all its triangles face the "outside" of the object.
* **Action:** Toggle the **Orientation** slider between "Viewpoint" and "Raw".
* **Observation:** When set to "Raw", the normals might flip unpredictably inwards and outwards, causing lighting and rendering glitches in the Generated Mesh. Using the "Viewpoint" setting forces all normals to orient consistently towards the virtual camera, instantly fixing the mesh rendering.
