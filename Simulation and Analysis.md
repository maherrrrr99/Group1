## ○ Simulation and Analysis

### ● Mechanical
A mechanical analysis was performed in SolidWorks Motion Study to estimate the required torque at each joint throughout the robot’s movement. The simulation incorporated gravity effects and defined motor-driven joints to replicate realistic operating conditions. A predefined motion profile was applied to guide the arm through a representative pick-and-place cycle, allowing the software to compute the dynamic loads and torque demands over time. The results show peak torque values of approximately 165 N·mm at critical points in the motion. These values fall within the operating capabilities of the selected MG995 servo motors, confirming that the motor selection is appropriate for the intended application. Overall, the analysis validates that the system can operate reliably without overloading the actuators.
![Simulation Results ](Images/torque_analysis.png)

### ● Kinematics (FK and IK)
Forward kinematics (FK) was implemented and visualized in RViz using ROS 2 to model the robot’s motion and verify link transformations. By defining the robot’s geometry and joint relationships, the end-effector position could be determined for given joint angles, allowing us to confirm that the arm reaches the desired workspace and behaves as expected. This also helped with debugging the overall structure and ensuring consistency between the CAD model and the software representation. In addition to FK, inverse kinematics (IK) will be implemented to enable the robot to compute the required joint angles for a desired end-effector position. This will allow for more intuitive control of the system, particularly for pick-and-place tasks where target positions are defined in Cartesian space.
![Robot Demo](Images/video.gif)

### ● Performance Evaluation
Discuss expected performance based on simulations.
