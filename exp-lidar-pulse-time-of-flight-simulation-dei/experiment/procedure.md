## Procedure

1. **Understand the Interface:**
   Familiarise yourself with the simulation interface. The left panel contains the **Live Scan Polar Map**, **Distance vs Angle** graph, and other dynamic visualisations. The right panel contains control sliders for parameters such as **Angular Resolution**, **Rotation Speed (RPM)**, **Pulse Frequency**, and environmental variables.

2. **Explore Angular Resolution:**
   - Adjust the **Angular Resolution** slider.
   - Observe how fine resolutions (e.g., 0.5&deg;) produce a dense, highly detailed point cloud, accurately capturing small features in the virtual room.
   - Change to a coarse resolution (e.g., 5&deg;) and notice how the number of points drops. See if narrow objects (like poles or chair legs) disappear because they fall entirely between two consecutive laser pulses.

3. **Analyse Coverage and Scan Rates:**
   - Change the **Rotation Speed (RPM)**. Notice how this affects the time taken for one full 360&deg; rotation (<i>T</i><sub>rot</sub>).
   - Adjust the **Pulse Frequency**. Compare the number of pulses generated per rotation to the required angular steps.
   - If the pulse frequency is too low for the set rotation speed, observe the appearance of gaps in the scan due to skipped angular positions. Use the **Pulse Coverage Timeline** to visually confirm if coverage is adequate.

4. **Experiment with Environmental Factors:**
   - Modify the **Far Wall Reflectivity**. Lower the reflectivity to simulate dark or absorptive surfaces (e.g., black velvet). Observe how the return signal becomes unreliable, leading to gaps in the scanned wall.
   - Notice the glass panel in the room. Observe how the LiDAR pulse passes through or reflects away from it, mapping the glass as an open space-a real-world limitation of LiDAR sensors.

5. **Examine Measurement Noise:**
   - Increase the **Range Noise** slider.
   - Observe the "fuzziness" of the points on the walls. Notice how the positional uncertainty is particularly prominent at the corners where noisy measurements from two adjacent walls intersect.
   - Check the **Detected Room Dimensions** to see how noise impacts the accuracy of the measured width and depth of the room.

6. **Review the Results:**
   - Watch the **Map Completeness** chart dynamically update based on your settings.
   - Refer to the formulas in the right panel to understand the mathematical relationship between your adjusted parameters and the resulting scan data.
   - Click the **Start Sweep** button to initiate a new scanning cycle and observe the real-time formation of the 2D point map.
