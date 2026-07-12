## Theory

### 1. Why Do We Need Filtering?

Imagine you just used a 3D scanner—like a stereo camera or a LiDAR—to capture a beautiful sculpture. You might expect a perfect digital replica, but the reality is a bit messier. Every scanning technology introduces imperfections. You might see "flying pixels" hovering mid-air at sharp edges (like we saw in Experiment 3), stray points caused by random sensor reflections, or just general fuzziness (Gaussian noise). 

If we don't clean this up, our downstream tasks will suffer. Registering two scans together (Experiment 4) will fail if the surfaces are too rough, and generating a 3D mesh (Experiment 7) will result in jagged, spiky models. Noise filtering is our digital broom. However, every filter faces a tough balancing act: we need to scrub away the noise without accidentally erasing genuine surface details like sharp corners or delicate textures.

### 2. Statistical Outlier Removal (SOR)

Statistical Outlier Removal (SOR) relies on a simple idea: true surface points have friends nearby, while noise points are lonely. On a solid surface, every point is surrounded by neighbours at roughly similar distances. But an isolated noise point floating in space will be much farther from its closest neighbours.

Here is how SOR works:
**Step 1** — For every point *p*, calculate its mean distance to its *k* nearest neighbours. Let's call this <i>d̄(p)</i>.
**Step 2** — Compute the overall average (mean, <i>μ</i>) and standard deviation (<i>σ</i>) of these neighbour distances for the entire point cloud:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>&mu;</i>&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;">1</span>
    <span style="padding: 0 10px; line-height: 1.2;"><i>N</i></span>
  </span>
  &nbsp;&times;&nbsp;&sum;<sub><i>i</i>=1</sub><sup><i>N</i></sup> <i>d&#772;(p<sub>i</sub>)</i>
</div>

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>&sigma;</i>&nbsp;=&nbsp;
  <span style="font-size: 1.5rem; line-height: 1; vertical-align: middle;">&radic;</span>
  <span style="border-top: 1px solid #333; padding: 2px 5px; margin-left: 2px;">
    <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
      <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;">1</span>
      <span style="padding: 0 10px; line-height: 1.2;"><i>N</i></span>
    </span>
    &nbsp;&times;&nbsp;&sum;<sub><i>i</i>=1</sub><sup><i>N</i></sup> (<i>d&#772;(p<sub>i</sub>)</i> &minus; <i>&mu;</i>)<sup>2</sup>
  </span>
</div>

**Step 3** — Toss out any point that is too far away from its neighbours, based on a threshold multiplier (<i>&alpha;</i>):

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  Reject <i>p</i> if <i>d&#772;(p)</i> &gt; <i>&mu;</i> &plus; <i>&alpha;</i> &times; <i>&sigma;</i>
</div>

A smaller <i>&alpha;</i> (like 1.0) is aggressive and will delete a lot of points, including some real surface data. A larger <i>&alpha;</i> (like 3.0) is lenient, deleting only the most extreme outliers. SOR is brilliant at eliminating isolated "flying pixels" but struggles against uniform fuzzy noise that clings tightly to the surface.

### 3. Radius Outlier Removal (ROR)

Radius Outlier Removal (ROR) takes a more direct approach. Instead of calculating statistical distributions, it just counts neighbours.

**Rule** — Draw a sphere of radius <i>r</i> around a point <i>p</i>. If there aren't at least <i>n<sub>min</sub></i> other points inside that sphere, delete the point:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  Reject <i>p</i> if |{<i>q</i> &isin; cloud : ||<i>q</i> &minus; <i>p</i>|| &lt; <i>r</i>}| &lt; <i>n<sub>min</sub></i>
</div>

ROR is faster than SOR because it doesn't need to compute global statistics. It works wonderfully on point clouds that have a uniform density. However, if your point cloud is dense close up and sparse far away (like from a depth camera), a fixed radius will accidentally delete perfectly valid points in the sparse regions!

### 4. Moving Least Squares Smoothing (MLS)

While SOR and ROR delete problematic points, Moving Least Squares (MLS) acts like a digital rolling pin. It repositions points to smooth them out along an estimated surface, rather than deleting them.

**Step 1** — Gather the local neighbours around a point <i>p</i>.
**Step 2** — Fit a smooth polynomial surface (usually a quadratic curve) through these neighbours. To do this, MLS assigns weights to the neighbours, giving higher priority to points that are physically closer to <i>p</i>. The weighting function is controlled by a bandwidth parameter <i>h</i>:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>w(d)</i>&nbsp;=&nbsp;<i>e</i><sup>&minus;<i>d</i><sup>2</sup> / <i>h</i><sup>2</sup></sup>
</div>

**Step 3** — Shift point <i>p</i> onto this beautifully smooth fitted surface.

MLS is fantastic at ironing out high-frequency jitter to reveal a smooth surface. However, there's a catch: if you set the bandwidth <i>h</i> too high, MLS will violently smooth over everything, rounding off genuine sharp corners and destroying fine details. 

### 5. Precision vs Recall in Filtering

How do we know if our filter is actually doing a good job? We evaluate it using the concepts of Precision and Recall.

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>Precision</i>&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;"><i>TP</i></span>
    <span style="padding: 0 10px; line-height: 1.2;"><i>TP</i> &plus; <i>FP</i></span>
  </span>
</div>

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>Recall</i>&nbsp;=&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;"><i>TP</i></span>
    <span style="padding: 0 10px; line-height: 1.2;"><i>TP</i> &plus; <i>FN</i></span>
  </span>
</div>

- **True Positive (TP)**: A genuine noise point that we correctly removed.
- **False Positive (FP)**: A real surface point that we accidentally deleted (Over-filtering!).
- **False Negative (FN)**: A noise point we failed to remove (Under-filtering!).

An aggressive filter has high Recall but low Precision (it deleted all the noise, but took the real surface with it). A conservative filter has high Precision but low Recall (it only deleted obvious noise, leaving lots behind).

### 6. The F1 Score

To strike a balance, we use the F1 Score, which combines Precision and Recall into a single number called the harmonic mean:

<div style="text-align: center; margin: 15px 0; font-size: 1.2rem; display: flex; align-items: center; justify-content: center;">
  <i>F1</i>&nbsp;=&nbsp;2 &times;&nbsp;
  <span style="display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center;">
    <span style="border-bottom: 1px solid #333; padding: 0 10px; line-height: 1.2;"><i>Precision</i> &times; <i>Recall</i></span>
    <span style="padding: 0 10px; line-height: 1.2;"><i>Precision</i> &plus; <i>Recall</i></span>
  </span>
</div>

A high F1 score proves your filter is in the "Goldilocks zone"—not too aggressive, not too weak.

### 7. Which Filter Should You Choose?

Here is a quick cheat sheet for when to use which algorithm:

| Feature | Statistical Outlier Removal (SOR) | Radius Outlier Removal (ROR) | Moving Least Squares (MLS) |
|---|---|---|---|
| **What it does** | Deletes points | Deletes points | Shifts points to smooth them |
| **Logic** | Looks at neighbour distances | Looks at point density | Fits a smooth local surface |
| **Variable Density?** | Adapts quite well | Struggles | Adapts well |
| **Preserves Edges?** | Moderately well | Moderately well | Poorly (if bandwidth is high) |
| **Best used for...** | Isolated flying pixels | Clouds with uniform density | Smoothing out fuzzy jitter |

### 8. Pro Tip: Chain Your Filters!

In the professional 3D scanning world, nobody relies on just one filter. A standard trick is to run ROR or SOR first to aggressively strip out extreme flying pixels, and then run an MLS pass over the cleaned cloud to gently iron out the remaining surface jitter. (Don't run MLS first, or the extreme outliers will corrupt the smoothing curve!)
