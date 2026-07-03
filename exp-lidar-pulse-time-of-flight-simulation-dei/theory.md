## Theory

### 1. The Time-of-Flight Principle

LiDAR (Light Detection and Ranging) measures distance using the constant speed of light. The sensor fires a short laser pulse and measures how long it takes for the reflection to return. Because light travels at a known, fixed speed, we can calculate the distance directly from this elapsed time.

This approach differs from stereo vision (Experiment 1). While stereo vision infers depth geometrically from two camera views, LiDAR measures distance directly using a single sensor and a precise timer.

### 2. The Distance Formula

The formula for time-of-flight distance is:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>d</i>&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;"><i>c</i> &times; <i>t</i><sub>return</sub></span>
    <span style="padding: 0 10px; line-height: 1.2;">2</span>
  </span>
</div>

Where:
- **<i>d</i>** = distance to the object in metres
- **<i>c</i>** = speed of light (approx. 3 &times; 10<sup>8</sup> m/s)
- **<i>t</i><sub>return</sub>** = time taken for the pulse to return in seconds

We divide by 2 because the light travels the distance twice—once to the object, and once back to the sensor. Light moves so quickly that returning from 1.5 metres away takes only 10 nanoseconds. This speed makes direct observation impossible, which is why we simulate the process here.

### 3. Building a 2D Map Through Rotation

A single pulse gives us distance in one direction. To build a full map, the LiDAR sensor rotates, firing pulses rapidly to sweep a 360&deg; circle. Each distance reading is paired with its angle, allowing us to map points in 2D space:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>x</i>&nbsp;=&nbsp;<i>d</i> &times; cos(<i>&theta;</i>)
</div>
<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>y</i>&nbsp;=&nbsp;<i>d</i> &times; sin(<i>&theta;</i>)
</div>

Where **<i>&theta;</i>** is the laser's angle and **<i>d</i>** is the measured distance.

### 4. Angular Resolution and Point Density

Angular resolution dictates the spacing between consecutive pulses. We calculate the total number of points per rotation (<i>N</i>) as:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>N</i>&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;">360&deg;</span>
    <span style="padding: 0 10px; line-height: 1.2;">&Delta;<i>&theta;</i></span>
  </span>
</div>

Fine resolution (a small **&Delta;<i>&theta;</i>**) captures highly detailed shapes. Coarse resolution leaves large gaps where narrow objects, like poles, might slip by undetected.

### 5. Rotation Speed and Scan Rate

Rotation speed determines how often the map updates. The time for one full rotation is:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>T</i><sub>rot</sub>&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;">60</span>
    <span style="padding: 0 10px; line-height: 1.2;">RPM</span>
  </span>
</div>

At 600 RPM, the sensor takes 0.1 seconds to rotate, giving a refresh rate of 10 scans per second—perfect for tracking a moving environment.

### 6. Coverage Check — Pulses per Rotation

For the sensor to actually hit its target angular resolution, it has to fire pulses fast enough to cover every angular step within the rotation time:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>P</i>&nbsp;=&nbsp;<i>f</i><sub>pulse</sub> &times; <i>T</i><sub>rot</sub>
</div>

Here, **<i>P</i>** must be greater than or equal to **<i>N</i>**. If the pulse frequency drops too low, the laser skips steps as it spins, creating blind spots.

### 7. Surface Reflectivity and Return Strength

Not all surfaces bounce light back equally. A white, matte wall strongly reflects the laser, yielding a clear signal. A dark, matte object absorbs the energy, returning a weak signal that the sensor might miss, creating gaps in the map.

Glass and mirrors pose unique challenges. Glass lets the pulse pass through, while mirrors reflect it away. In both cases, the sensor gets no return signal, mapping a solid obstacle as empty space—a classic problem in robotics.

### 8. Measurement Noise and Map Accuracy

Real-world LiDAR data is always a bit noisy. Random errors make the distance measurements fluctuate slightly, giving straight walls a "fuzzy" appearance. When mapping rectangular rooms, corner intersections often show the highest positional uncertainty because the noise from two adjoining walls compounds.

### 9. Connection to the Broader Pipeline

If you tilt a 2D LiDAR up and down, or stack multiple lasers vertically, you get a full 3D point cloud—similar to what we saw in Experiment 3. LiDAR is crucial for autonomous navigation because, unlike cameras, it brings its own light source and works reliably over long ranges and in total darkness.
