## Procedure

## Dashboard Navigation Guide

Before you begin testing the algorithms, take a moment to familiarise yourself with the two main sections of the web application: **Setup Lab** and **Simulation**.

**Phase 1: Setup Lab**
* **Wizard & Information (Left):** Shows your current step in the setup process, offering helpful hints and displaying 3D view controls (Orbit, Pan, Zoom) as well as Camera Presets.
* **3D Setup & Preview (Center):** Features a live 3D workbench. As you mount modules or load point clouds, they will appear in this interactive scene.
* **Apparatus & Configuration (Right):** Use this panel to mount your virtual components (Noisy Scan Dataset, SOR Module, ROR Module, MLS Module). Later steps in this panel let you select a filter, tweak primary parameters, and run a test pass to preview results.

**Phase 2: Simulation**
* **Wizard & Live Readouts (Left):** Provides a guided tutorial for tuning algorithms. Below the wizard, you'll find live metric readouts for Precision, Recall, and F1 Score, along with a Confusion Matrix breakdown (TP, FP, FN, TN).
* **Scene & Maps (Center):** Displays four interactive views:
    * **Before/After Cloud:** Drag to compare the raw input (left) with the filtered result (right).
    * **Classification Map:** Visualises the filter's performance (Green = True Positives, Red = False Positives, Amber = False Negatives).
    * **Neighbour Distance Histogram:** Shows the statistical distribution used by the SOR algorithm.
    * **Precision-Recall Trade-off Curve:** Graphs how your parameter changes affect the trade-off.
* **Parameters & Quality Gauge (Right):** Switch between the three algorithms (SOR, ROR, MLS) and adjust their specific parameters using sliders. A large gauge visually represents your current F1 Score or RMSE.

---

## Experimental Procedure

### Step 1: Mount the Equipment
Every point cloud processing pipeline requires the right modules.
* **Action:** In the Setup Lab phase, look at the right panel under "Apparatus". Click **Mount Component** four times to sequentially mount the Noisy Scan Dataset, SOR Module, ROR Module, and MLS Module.
* **Observation:** The 3D workbench will update as each piece of equipment is placed. Once everything is mounted, proceed through the setup wizard to preview a basic filter pass, then click **Go To Simulation**.

### Step 2: Tune Statistical Outlier Removal (SOR)
SOR relies on the statistical distribution of neighbour distances to identify extreme outliers.
* **Action:** In the Simulation phase, ensure the Algorithm slider is set to **SOR**. Adjust the **Neighbourhood <i>k</i>** slider and the **SOR <i>&alpha;</i>** slider. 
* **Observation:** Notice how lowering <i>&alpha;</i> makes the filter more aggressive, catching more noise but accidentally deleting genuine surface points (False Positives in red). Watch the Precision-Recall curve shift as you find the "Goldilocks zone" that maximises the F1 Score.

### Step 3: Tune Radius Outlier Removal (ROR)
ROR deletes points that don't have enough neighbours within a fixed physical radius.
* **Action:** Switch the Algorithm slider to **ROR**. Play with the **ROR Radius <i>r</i>** and **ROR n_min** (minimum neighbours) sliders.
* **Observation:** See how a very small radius with a high n_min creates an extremely aggressive filter. Observe how ROR struggles to preserve naturally sparse valid points compared to SOR.

### Step 4: Explore Moving Least Squares (MLS)
Unlike SOR and ROR, MLS is a smoothing algorithm. It doesn't delete points; it moves them!
* **Action:** Switch the Algorithm slider to **MLS**. Adjust the **MLS Bandwidth <i>h</i>** slider.
* **Observation:** Because MLS doesn't delete points, the F1 Score gauge switches to an **RMSE (Root Mean Square Error)** gauge. Watch the Before/After Cloud carefully. A high bandwidth (like 30 mm) will make the surface perfectly smooth but will aggressively round off sharp corners. A small bandwidth preserves sharp corners but leaves behind some fuzzy noise.

### Step 5: Free Exploration and Comparison
Now that you understand all three algorithms, try comparing them on the same dataset.
* **Action:** Click "Skip to Free Explore" in the left Wizard panel. Quickly toggle the Algorithm slider between SOR, ROR, and MLS.
* **Observation:** Look at the Algorithm Comparison box in the bottom left to see the max F1 scores and RMSE side-by-side. Notice how each algorithm handles the same noisy point cloud differently, proving that no single algorithm is perfect for every scenario!
