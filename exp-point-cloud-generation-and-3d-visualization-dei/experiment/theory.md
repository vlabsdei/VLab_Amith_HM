## Theory
 
### 1. From 2D Depth Image to 3D Point Cloud
 
A depth image, also called a depth map, is a two-dimensional grid where every pixel stores a single value: the distance Z from the camera to whatever surface that pixel observes. This is fundamentally different from a regular photograph, where each pixel stores colour or brightness. A depth map alone is just a greyscale image of distances — useful, but still a 2D representation.
 
To make this data usable for measurement, mesh generation, or 3D visualisation, every pixel in the depth map must be converted into an actual point in 3D space with coordinates (X, Y, Z). This process is called back-projection, and the result of applying it to every valid pixel is called a point cloud — an unordered collection of 3D points that together describe the visible surface of the scanned object.
 
Point clouds are the universal output format of nearly all 3D scanning technologies. A LiDAR scanner produces a point cloud. A structured light scanner produces a point cloud. A stereo camera system, after computing depth as in Experiment 1, also produces a point cloud once back-projection is applied. Every downstream process in the 3D scanning pipeline — registration (Experiment 4), mesh generation (Experiment 7), noise filtering (Experiment 8) — operates on point cloud data.
 
### 2. The Back-Projection Formula
 
For a pixel at column u and row v in the depth image, with stored depth value Z, the corresponding 3D point (X, Y, Z) in the camera's coordinate frame is computed as:
 
```
X = (u − cx) × Z / fx
Y = (v − cy) × Z / fy
Z = depth_value(u, v)
```
 
Where:
 
- **(u, v)** — the pixel's column and row position in the depth image
- **(cx, cy)** — the principal point of the camera, recovered from calibration in Experiment 2
- **fx, fy** — the focal lengths in pixels along the horizontal and vertical axes, also from calibration
- **Z** — the depth value already stored at that pixel, in metres
This formula is the geometric inverse of the camera projection equation. While the projection equation in Experiment 2 takes a 3D point and computes where it lands in the 2D image, back-projection takes a 2D pixel with a known depth and recovers where that point exists in 3D space. The two operations are mathematically inverse to each other, and both depend critically on accurate camera intrinsic parameters.
 
This is the direct reason Experiment 2 (calibration) must be completed before this experiment can produce metrically accurate results. If fx or cx is wrong, every single point in the resulting cloud will be displaced from its true position, distorting the overall shape of the reconstructed surface.
 
### 3. Total Point Count and Resolution
 
Every valid pixel in the depth map generates exactly one 3D point. The total number of points in the resulting cloud is:
 
```
N_total = image_width × image_height
```
 
This means resolution has a direct and significant effect on point cloud size. Doubling both width and height (for example going from 320×240 to 640×480) does not double the point count — it quadruples it, because both dimensions doubled simultaneously. A typical depth camera operating at 640×480 produces just over 300,000 points per frame, assuming every pixel returns a valid depth reading.
 
### 4. Point Spacing and Its Relationship to Distance
 
Point spacing describes how far apart adjacent 3D points are on the scanned surface, measured in real-world units like millimetres. It is not constant — it depends directly on how far the surface is from the camera:
 
```
Δs = Z / fx
```
 
This relationship has an important practical consequence: the same camera, at the same resolution, produces a much denser sampling of nearby objects than distant ones. At 1 metre with a focal length of 700 pixels, point spacing is approximately 1.4 millimetres. At 3 metres, with the same camera settings, spacing grows to about 4.3 millimetres — roughly three times sparser. This is the same underlying principle that determines feature detectability, explored in depth in Experiment 9.
 
### 5. Modelling Sensor Noise
 
No depth sensor measures distance perfectly. Every reading contains some amount of random error, which is typically modelled as Gaussian (normally distributed) noise added to the true depth value:
 
```
Z_measured = Z_true + N(0, σ²)
```
 
Where σ is the standard deviation of the noise in metres, and N(0, σ²) represents a random sample drawn from a normal distribution with zero mean and variance σ². A typical consumer depth camera might have σ around 3 millimetres at a 1 metre measurement distance, with this value growing larger at greater distances — consistent with the depth uncertainty behaviour studied in Experiment 1.
 
When this noisy depth is back-projected into 3D, the result is a point cloud where points that should lie on a perfectly flat surface instead show small random deviations above and below the true surface plane. At low noise levels this appears as a slight roughness. At higher noise levels, a surface that is actually flat can appear visibly wavy or rippled in the 3D point cloud — an effect commonly seen in real-world depth camera output, especially outdoors where sunlight interferes with infrared depth sensors.
 
### 6. Cloud Density
 
Cloud density measures how many points fall within a given surface area, typically expressed in points per square metre:
 
```
ρ = N_valid / A_surface
```
 
Where N_valid is the count of points with a valid (successfully measured) depth value, and A_surface is the visible surface area at the relevant depth. Density is not uniform across a scan — it is higher for surfaces close to the camera and lower for surfaces farther away, following directly from the point spacing relationship described above. Understanding density is important for predicting whether a given scan will have sufficient detail for a specific downstream task, such as detecting a small surface feature or generating a smooth mesh.
 
### 7. Flying Pixels and Edge Artefacts
 
A specific and well-documented artefact in depth sensing occurs at object boundaries — the edges where a foreground object meets the background behind it. At these transition pixels, the depth measurement can become unreliable, sometimes producing a depth value that is neither the true foreground distance nor the true background distance, but something in between. When such a pixel is back-projected into 3D, it appears as an isolated point floating in space between the object and the background, disconnected from both surfaces. These are commonly called flying pixels or flying points, and they are a primary target for the noise filtering algorithms studied in Experiment 8.
 
### 8. Why Point Clouds Matter for 3D Scanning
 
The point cloud is the foundational data structure of the entire 3D scanning pipeline. Before a scanned object can be measured, compared to a CAD reference, converted into a printable mesh, or aligned with another scan, it must first exist as a point cloud. Understanding how resolution, distance, and noise shape the quality of this point cloud is therefore essential before any of the more advanced processing steps — registration, filtering, or mesh generation — can be meaningfully understood.

