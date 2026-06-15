# References

## Section Reference Mapping

| # | Reference | Year | Section(s) Used |
|---|---|---|---|
| 1 | Hartley, R. & Zisserman, A. — *Multiple View Geometry in Computer Vision* (2nd ed.). Cambridge University Press. | 2004 | Epipolar geometry, depth formula derivation, fundamental matrix, camera projection model |
| 2 | Zhang, Z. — A flexible new technique for camera calibration. *IEEE Transactions on Pattern Analysis and Machine Intelligence*, 22(11), 1330–1334. | 2000 | Camera calibration theory (Zhang's method), homography per pose, SVD-based K estimation |
| 3 | Longuet-Higgins, H. C. — A computer algorithm for reconstructing a scene from two projections. *Nature*, 293(5828), 133–135. | 1981 | Foundational stereo theory, essential matrix, depth from two viewpoints |
| 4 | Scharstein, D. & Szeliski, R. — A taxonomy and evaluation of dense two-frame stereo correspondence algorithms. *International Journal of Computer Vision*, 47(1–3), 7–42. | 2002 | Disparity map computation, stereo matching, depth map quality metrics |
| 5 | Faugeras, O. — *Three-Dimensional Computer Vision: A Geometric Viewpoint*. MIT Press. | 1993 | Camera geometry, perspective projection, 3D point back-projection, depth reconstruction |
| 6 | Trucco, E. & Verri, A. — *Introductory Techniques for 3-D Computer Vision*. Prentice Hall. | 1998 | Stereo vision basics, baseline triangulation formula Z = fB/d, disparity definition |
| 7 | Tsai, R. Y. — A versatile camera calibration technique for high-accuracy 3D machine vision metrology. *IEEE Journal on Robotics and Automation*, 3(4), 323–344. | 1987 | Lens distortion model, radial distortion coefficients, camera intrinsic parameter estimation |
| 8 | Kanade, T. & Okutomi, M. — A stereo matching algorithm with an adaptive window: Theory and experiment. *IEEE Transactions on Pattern Analysis and Machine Intelligence*, 16(9), 920–932. | 1994 | Disparity computation methods, stereo correspondence, depth uncertainty with window size |
| 9 | Horn, B. K. P. — *Robot Vision*. MIT Press. | 1986 | Camera model, image formation, projection equations X = (u−cx)Z/fx |
| 10 | Bradski, G. & Kaehler, A. — *Learning OpenCV: Computer Vision with the OpenCV Library*. O'Reilly Media. | 2008 | Practical stereo calibration, disparity map generation, OpenCV stereo pipeline reference |
| 11 | Poggio, G. F. & Poggio, T. — The analysis of stereopsis. *Annual Review of Neuroscience*, 7(1), 379–412. | 1984 | Biological motivation — binocular parallax, human depth perception analogy |
| 12 | Box, G. E. P. & Muller, M. E. — A note on the generation of random normal deviates. *The Annals of Mathematical Statistics*, 29(2), 610–611. | 1958 | Gaussian noise simulation — Box-Muller transform used in noise model |

## Reference List

### [1] Hartley, R., & Zisserman, A. (2004)

**Title:** Multiple View Geometry in Computer Vision (2nd ed.)  
**Publisher:** Cambridge University Press  
**ISBN:** 978-0-521-54051-3

**Used in experiment for:**
- Epipolar geometry and the epipolar constraint
- Derivation of the fundamental matrix F from two camera views
- Depth triangulation from stereo: Z = (f × B) / d
- Camera projection model: x = K[R|t]X
- Back-projection of depth pixels to 3D points

**Relevant chapters:** Chapter 6 (Camera Models), Chapter 9 (Epipolar Geometry), Chapter 11 (Structure from Motion)

### [2] Zhang, Z. (2000)

**Title:** A flexible new technique for camera calibration  
**Journal:** IEEE Transactions on Pattern Analysis and Machine Intelligence  
**Volume/Issue:** 22(11), pp. 1330–1334  
**DOI:** 10.1109/34.888718

**Used in experiment for:**
- Camera calibration using a planar checkerboard (Experiment 2 foundation)
- Homography per pose: H = K[r₁ r₂ t]
- SVD-based estimation of intrinsic matrix K from multiple poses
- Reprojection error as calibration quality metric

**Relevant sections:** Section II (Homography estimation), Section III (Solving for intrinsic parameters)

### [3] Longuet-Higgins, H. C. (1981)

**Title:** A computer algorithm for reconstructing a scene from two projections  
**Journal:** Nature  
**Volume/Issue:** 293(5828), pp. 133–135  
**DOI:** 10.1038/293133a0

**Used in experiment for:**
- Historical and foundational basis of stereo depth recovery
- Proof that depth can be recovered from two views of the same scene
- Essential matrix formulation E = KᵀFK

**Note:** This is one of the most cited papers in computer vision and establishes the mathematical basis of everything in Experiment 1.

### [4] Scharstein, D., & Szeliski, R. (2002)

**Title:** A taxonomy and evaluation of dense two-frame stereo correspondence algorithms  
**Journal:** International Journal of Computer Vision  
**Volume/Issue:** 47(1–3), pp. 7–42  
**DOI:** 10.1023/A:1014573219977

**Used in experiment for:**
- Disparity map computation and interpretation
- Taxonomy of stereo matching methods
- Ground truth comparison methodology for depth map RMSE
- Understanding why invalid regions (occluded, low-texture) appear black

**Relevant sections:** Section 2 (Stereo matching framework), Section 4 (Comparison methodology)

### [5] Faugeras, O. (1993)

**Title:** Three-Dimensional Computer Vision: A Geometric Viewpoint  
**Publisher:** MIT Press  
**ISBN:** 978-0-262-06158-2

**Used in experiment for:**
- Camera perspective projection geometry
- Back-projection formula: X = (u−cx)Z/fx, Y = (v−cy)Z/fy
- Stereo geometry with known baseline
- Mathematical formulation of depth from disparity

**Relevant chapters:** Chapter 3 (Image Formation), Chapter 7 (Stereo Vision)

### [6] Trucco, E., & Verri, A. (1998)

**Title:** Introductory Techniques for 3-D Computer Vision  
**Publisher:** Prentice Hall  
**ISBN:** 978-0-13-261108-4

**Used in experiment for:**
- Primary pedagogical reference for the stereo depth formula Z = (f × B) / d
- Disparity definition and measurement in pixel coordinates
- Camera intrinsic parameters: focal length, principal point
- Stereo camera setup and baseline geometry

**Relevant chapters:** Chapter 6 (Stereo Vision), Chapter 2 (Camera Model)

### [7] Tsai, R. Y. (1987)

**Title:** A versatile camera calibration technique for high-accuracy 3D machine vision metrology using off-the-shelf TV cameras and lenses  
**Journal:** IEEE Journal on Robotics and Automation  
**Volume/Issue:** 3(4), pp. 323–344  
**DOI:** 10.1109/JRA.1987.1087109

**Used in experiment for:**
- Radial lens distortion model: x_corrected = x(1 + k₁r² + k₂r⁴)
- Camera calibration for metric 3D measurement
- Relationship between pixel measurements and physical world coordinates
- Why an uncalibrated camera produces systematic depth errors

### [8] Kanade, T., & Okutomi, M. (1994)

**Title:** A stereo matching algorithm with an adaptive window: Theory and experiment  
**Journal:** IEEE Transactions on Pattern Analysis and Machine Intelligence  
**Volume/Issue:** 16(9), pp. 920–932  
**DOI:** 10.1109/34.310690

**Used in experiment for:**
- Disparity estimation methods and accuracy
- How window size affects stereo matching quality and noise
- Depth uncertainty as a function of local image statistics
- Understanding why far-range stereo is less reliable than near-range

### [9] Horn, B. K. P. (1986)

**Title:** Robot Vision  
**Publisher:** MIT Press  
**ISBN:** 978-0-262-08159-7

**Used in experiment for:**
- Foundational camera model: perspective projection equations
- Image formation: how 3D points map to 2D pixels
- Role of focal length in image geometry
- Early treatment of depth estimation from images

**Relevant chapters:** Chapter 1 (Perspective Projection), Chapter 4 (Stereo)

### [10] Bradski, G., & Kaehler, A. (2008)

**Title:** Learning OpenCV: Computer Vision with the OpenCV Library  
**Publisher:** O'Reilly Media  
**ISBN:** 978-0-596-51613-0

**Used in experiment for:**
- Practical stereo calibration pipeline reference (stereoCalibrate, stereoRectify)
- Disparity map generation using StereoSGBM
- Reprojection of disparity to 3D using reprojectImageTo3D
- Real-world parameter ranges for focal length and baseline

**Relevant chapters:** Chapter 11 (Stereo Vision), Chapter 6 (Camera Calibration)

### [11] Poggio, G. F., & Poggio, T. (1984)

**Title:** The analysis of stereopsis  
**Journal:** Annual Review of Neuroscience  
**Volume/Issue:** 7(1), pp. 379–412  
**DOI:** 10.1146/annurev.ne.07.030184.002115

**Used in experiment for:**
- Biological motivation for the stereo vision approach
- Human binocular parallax as the inspiration for stereo cameras
- Neural basis of disparity detection in the visual cortex
- Why human depth perception degrades at large distances (same physics as ΔZ ∝ Z²)

### [12] Box, G. E. P., & Muller, M. E. (1958)

**Title:** A note on the generation of random normal deviates  
**Journal:** The Annals of Mathematical Statistics  
**Volume/Issue:** 29(2), pp. 610–611  
**DOI:** 10.1214/aoms/1177706645

**Used in experiment for:**
- Box-Muller transform used in simulation.js to generate Gaussian-distributed disparity noise
- Theoretical basis for the noise model: d_measured = d_true + N(0, σ²)
- Justification that sensor noise follows a Gaussian distribution

**Formula implemented:**
$$
u_1 = \text{random}(), \quad u_2 = \text{random}()
$$
$$
\text{noise} = \sigma \times \sqrt{-2 \times \ln(u_1)}\times \cos(2\pi u_2)
$$

## References by Experiment Section

| Experiment Section | References Used |
|---|---|
| Biological inspiration — binocular vision | [11] Poggio & Poggio (1984) |
| Stereo camera setup and geometry | [1] Hartley & Zisserman (2004), [6] Trucco & Verri (1998), [5] Faugeras (1993) |
| Depth formula: Z = (f × B) / d | [1] Hartley & Zisserman (2004), [6] Trucco & Verri (1998), [3] Longuet-Higgins (1981) |
| Camera projection model | [5] Faugeras (1993), [9] Horn (1986), [1] Hartley & Zisserman (2004) |
| Back-projection: X = (u−cx)Z/fx | [5] Faugeras (1993), [9] Horn (1986) |
| Disparity map computation | [4] Scharstein & Szeliski (2002), [8] Kanade & Okutomi (1994) |
| Camera calibration (Zhang's method) | [2] Zhang (2000), [7] Tsai (1987) |
| Radial distortion model | [7] Tsai (1987), [2] Zhang (2000) |
| Depth uncertainty: ΔZ = Z²σ/(fB) | [4] Scharstein & Szeliski (2002), [8] Kanade & Okutomi (1994) |
| Gaussian noise model for disparity | [12] Box & Muller (1958) |
| Practical implementation reference | [10] Bradski & Kaehler (2008) |
| Foundational mathematical basis | [3] Longuet-Higgins (1981), [1] Hartley & Zisserman (2004) |
