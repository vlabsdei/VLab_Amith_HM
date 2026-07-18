## Introduction

**Welcome to the 3D Scanning Virtual Lab.**

A 3D scanner does something no tape measure or calliper can: it grabs the full shape of a real object - every bump, curve, and edge - and turns it into a digital model. Instead of recording one measurement at a time, the scanner fires thousands or millions of readings at once and stitches them into a cloud of 3D points (called, unsurprisingly, a "point cloud").

Most 3D scanners boil down to one trick: figure out how far away each point on a surface is. Some scanners project a pattern of light and watch how it warps on the surface. Others fire a laser pulse and time how long the reflection takes to come back. Stereo-camera systems skip active illumination entirely - they just snap two photos from slightly different angles and work out depth from the geometry. The end result is always the same: a dense set of XYZ coordinates that map the object's surface.

3D scanning is the digital counterpart of physical measurement. Where a traditional Vernier calliper measures one dimension at a time, a 3D scanner captures the entire geometry of a surface in a single session. This makes it especially powerful for complex shapes that cannot be fully described by simple measurements.

These techniques show up everywhere. Manufacturing lines use scanners to check whether machined parts match the original CAD file. Surgeons rely on facial and limb scans to design prosthetics that fit a particular patient. Archaeologists scan fragile artefacts so a permanent digital copy survives even if the original does not. And the LiDAR unit on a self-driving car is really just a fast 3D scanner - it builds a live point cloud of the road so the vehicle knows what is around it.

In this virtual lab you will work through these ideas yourself. Each experiment strips out one piece of the scanning pipeline - depth capture, noise filtering, point-cloud registration, surface reconstruction - and lets you poke at it with sliders and toggles. You see results immediately on screen, no laser hardware or licensed software required.
