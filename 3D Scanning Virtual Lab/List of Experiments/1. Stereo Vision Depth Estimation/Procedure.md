## Procedure

## Dashboard Navigation Guide

Before starting, familiarize yourself with the three main sections of your web application:

* **Wizard & Legend Panel (Left):** Displays your current step in the guided tutorial, the task instructions, and color keys for the camera views, depth map, and uncertainty map.
* **Scene — Top View (Center):** An overhead perspective of the left and right cameras (blue and teal) looking down the Z-axis at the orange object.
* **Camera Views (Center):** The simulated Left and Right camera perspectives, showing the object's horizontal shift (marked by a gold disparity bracket).
* **Depth Map (Center):** A color-coded heatmap where red indicates near objects, blue indicates far objects, and black indicates an invalid reading (disparity < 1 px).
* **Uncertainty Map (Center):** Visualizes reliable depth (green) and unreliable depth (red).
* **Controls & Readouts (Right):** The panel containing interactive sliders for Baseline (B), Focal Length (f), Object Distance (Z), and Disparity Noise (σ).
* **Live Metrics (Right):** Below the sliders are live readouts for Disparity, Computed Z, Uncertainty (ΔZ), and RMSE, along with the live mathematical formulas.

## Experimental Procedure

Use the Wizard Panel on the left to click "Next Step" and follow along with the guided simulation.

### Step 1: Set the Baseline
The baseline (B) is the physical horizontal distance between the two cameras.
* **Action:** Drag the Baseline slider between 5 cm and 30 cm.
* **Observation:** Watch the camera icons spread apart in the Scene Top View. Notice how a wider baseline produces larger disparity values for the same object distance, which improves depth accuracy.

### Step 2: Set the Focal Length
Focal length (f) controls how much the lens zooms, narrowing the field of view but increasing precision.
* **Action:** Adjust the Focal Length slider to 400 px, and then up to 900 px.
* **Observation:** Watch the disparity readout change in the live metrics. A longer focal length makes the scene point appear farther from the center in each camera image, increasing disparity.

### Step 3: Place the Object
Object distance (Z) controls how far the object sits from the camera pair.
* **Action:** Drag the Object Distance slider from 0.5 m all the way to 9 m.
* **Observation:** As Z increases, disparity falls and the Depth Map shifts from warm red to cool blue. Notice that when you push the object too far, disparity drops below 1 px, and the Depth Map displays invalid black patches.

### Step 4: Add Measurement Noise
Real sensors are imperfect, and the noise parameter adds Gaussian random error to disparity measurements.
* **Action:** Set the Disparity Noise (σ) slider to 3.0 px, then slowly move the Object Distance (Z) from 1 m to 7 m.
* **Observation:** Watch the RMSE readout grow exponentially. While the depth map stays usable at close range, the Uncertainty Map will light up bright red at far ranges as the noise creates enormous depth errors.

### Step 5: Explore Freely
Now that the simulation is fully unlocked, all parameters are live.
* **Action:** Change any combination to observe how the four central displays respond together.
* **Challenge:** Try to find a Baseline (B) and Focal Length (f) combination that keeps the RMSE below 5 cm when the Object Distance is 3 m and the Disparity Noise is 2.0 px.
