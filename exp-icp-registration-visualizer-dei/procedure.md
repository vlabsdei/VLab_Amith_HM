## Procedure

### Part 1: Setting up the ICP Rig
Before we can run the algorithm, you need to configure the initial state of the two point clouds.

1. **Mount the Components:** Start in the Apparatus panel. Sequentially mount the 3D Sensor, the Target Reference Frame, and the Base Object by clicking the "Mount Component" button.
2. **Examine the Overlap:** Move to Step 1. Notice the two point clouds perfectly overlapping. The orange cloud acts as your fixed target, while the blue cloud is the source you will be trying to align.
3. **Introduce a Misalignment:** In Step 2, use the sliders to manually offset the blue source cloud. You can introduce both a rotation (in degrees) and a translation (in meters). This mimics the offset caused by moving a 3D scanner to a new position!
4. **Set the Overlap Percentage:** In Step 3, define how much of the original surface area both clouds share. Setting a low overlap mimics scanning two very different sides of an object.
5. **Review Initial Error:** Move to Step 4 and review the live observations. The Initial RMSE tells you exactly how far off your alignment is before the algorithm even begins. Click "Go To Simulation" when you are ready.

### Part 2: Running the Algorithm
Now it's time to watch the math at work!

1. **Step Through Iterations:** Click "Step One Iteration". Watch closely as the blue source cloud makes its first jump toward the orange target cloud. 
2. **Observe the Correspondences:** Look at the "Correspondence Lines" panel. These faint lines show exactly which points the algorithm paired together to calculate that jump.
3. **Track the Error:** Check the "RMSE Graph" panel. You'll see the error drop significantly in the first few iterations, before leveling out.
4. **Run to Convergence:** If you're tired of stepping manually, click "Run to Convergence". The algorithm will automatically loop until the change in error drops below the threshold, meaning the clouds are as aligned as they're going to get!
5. **Reset and Re-test:** Did it fail to align? Was the initial offset too large? Click "Reset Simulation", return to the Setup page, and try giving it a smaller offset or a more distinct, asymmetrical object to align!
