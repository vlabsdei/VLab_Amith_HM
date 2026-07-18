## Procedure

## Dashboard Navigation Guide

Before you begin, take a moment to understand the two main sections of the web application: **Setup Lab** and **Simulation**.

**Phase 1: Setup Lab**
* **Equipment Tray & Specs (Left):** Shows your current step in the process, component specifications, and camera presets for the 3D view.
* **3D Rig Setup (Center):** Features an interactive 3D view of the physical equipment setup. You can orbit, pan, and zoom around the optical rail as you build it.
* **Apparatus Controls (Right):** A step-by-step wizard where you mount components (Rail, Sensor, Target, Gauge), set the initial distance, run an automated sweep, and view live observation readings.

**Phase 2: Simulation**
* **Wizard & Legends (Left):** Provides a guided step-by-step summary of the trade-offs, live readouts for Point Spacing, Detectable Features, and Estimated Time/Cost to scan.
* **Target View (Center):** Shows an interactive 3D view of the target block covered with a simulated sampling grid overlay. You can pan, zoom, and orbit this view to see exactly how the points land on the geometric features.
* **Parameters & Live Readouts (Right):** Includes sliders for adjusting Scanning Distance (Z), Focal Length (fx), Safety Margin (m), Target Feature size, and Alignment Jitter. It also features a live Detection Confidence Gauge and a mathematical formula card.

## Experimental Procedure

### Step 1: Mount the Equipment
A stable rail setup is required to systematically test scanning distances.
* **Action:** In the Setup Lab, select each component in the right panel and click "Mount Component" to place the Linear Distance Rail, Depth Sensor, Feature Target, and Spacing Gauge in order.
* **Observation:** The central 3D view updates as you mount each piece. Once everything is mounted, click "Next Step".

### Step 2: Position the Target
Establish your starting scanning distance.
* **Action:** Drag the Scanning Distance Z slider to adjust the distance between the camera and the target.
* **Observation:** The 3D target will move further down the rail. Click "Next Step" when you are ready.

### Step 3: Run Distance Sweep
Perform a systematic capture across multiple distances to observe how resolution changes.
* **Action:** Click "Run Distance Sweep" and watch the progress bar.
* **Observation:** The system simulates capturing data at 12 steps across the rail. Once complete, click "View Observations".

### Step 4: Analyse Initial Observations
Review the data before diving into the interactive simulation.
* **Action:** Examine the Live Observations card in the right panel.
* **Observation:** Note how point spacing and the smallest detectable feature size relate to the focal length and distance. Click "Launch Simulation" to enter Phase 2.

### Step 5: Explore the Trade-off
Interact with the variables to see how they impact feature detectability.
* **Action:** In the Simulation phase, adjust the Scanning Distance (Z) and Focal Length (fx) sliders.
* **Observation:** The sample grid overlay on the 3D target will grow and shrink. When the spacing is too wide, the grid points will miss the finer features, and the Detection Confidence Gauge will drop.

### Step 6: Test Safety Margins
Understand how over-sampling affects reliability.
* **Action:** Change the Target Feature slider to focus on a specific feature size (e.g., 2mm), then adjust the Safety Margin (m) slider.
* **Observation:** Higher safety margins demand a tighter point grid to guarantee detection. Notice how changing the alignment jitter demonstrates why these safety margins are necessary-without a margin, a small shift in alignment could cause the grid to completely miss the target feature.
