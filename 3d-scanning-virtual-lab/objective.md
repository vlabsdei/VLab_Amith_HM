## Objectives

**By the end of this virtual lab, students will be able to:**

1. Explain how different 3D scanning technologies - stereo vision, LiDAR time-of-flight, and structured light - recover depth, and point to the key formula that links sensor parameters to measurement accuracy in each case.

2. Adjust scanner parameters (baseline distance, scan resolution, noise level, phase step count) in the simulation and see first-hand how each one changes the quality of the 3D output.

3. Read and evaluate the outputs that these simulations produce - depth maps, point clouds, phase maps, polar environment maps - using metrics like RMSE, reprojection error, and feature loss percentage.

4. Run post-processing steps on simulated scan data: ICP registration, noise filtering (SOR, Voxel Grid, Radius Removal), surface normal estimation, and mesh generation. Compare how different parameter choices change the final result.

5. Deliberately break things. Push each scanner to its failure mode - stereo blind zones, LiDAR failing on glass, structured light washing out in ambient light, SfM collapsing on textureless surfaces - and explain why each failure occurs.

6. Work through the maths behind 3D scanning: the depth-triangulation formula, Nyquist sampling criterion, phase-extraction algorithm, and ICP convergence condition.
