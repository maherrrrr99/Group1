# Smart Pick-and-Place Robot
### MEC483 — Mechatronic System Design · Spring 2025–2026
#### College of Engineering · Instructor: Dr. Claudio Vignola

<p align="center">
  <img src="Images/assembled_arm.png" width="680"/>
</p>

---

## Team Members

| Name | Role |
|------|------|
| [Maher Abo Abed](https://maherrrrr99.github.io/maherrrrr99/) | Project Lead · Embedded Systems · Mechanical Design · IK/ROS 2 |
| [Sabeeha Zainab Hasham](https://sabeehahasham.github.io/) | Computer Vision · Dataset · YOLOv8 Training · Pi Deployment |
| [Basel Feras Ghunaim](https://basel-ghunaim.github.io/) | CAD Modelling · Simulation · Fabrication |
| [Ahmed Nasser Alshehhi](https://ahmed1090822.github.io/Ahmed109.github.io/) | Control System · System Integration · GitHub Management |

---

## Problem Statement

Modern manufacturing and automation systems demand fast, accurate, and reliable object handling. Manual pick-and-place operations are slow, prone to human error, and unsuitable for repetitive, high-precision tasks. Traditional robotic systems are typically designed to work with objects in fixed locations and cannot adapt to changing environments.

To tackle these challenges, this project builds a **Smart Pick-and-Place Robotic System** with integrated computer vision. The system automatically identifies objects in a workspace, determines their positions, and commands a robotic arm to pick and place them — entirely without human intervention. It combines sensing, image processing, embedded control, and mechanical actuation into a smart, efficient automation solution.

### Impact

The system demonstrates the application of mechatronic engineering principles through the tight integration of mechanical, electrical, control, and computer engineering subsystems. By embedding computer vision directly into the robotic arm pipeline, the system improves detection precision and reduces reliance on manual handling. The platform also serves as a foundation for future developments in advanced object recognition and fully autonomous industrial robotics.

### Design Criteria

| # | Criterion | Goal |
|---|-----------|------|
| CR-1 | Object Detection Accuracy | Reliable identification of eggs, nuts, bolts, balls, and compasses |
| CR-2 | Pick-and-Place Success Rate | Consistent end-to-end cycle completion |
| CR-3 | Positioning Accuracy | Precise placement with minimal offset |
| CR-4 | Response Time | Low-latency vision-to-motion pipeline |
| CR-5 | Payload Capacity | Handle objects up to 250 g |
| CR-6 | Repeatability | Consistent performance across multiple cycles |
| CR-7 | Workspace Coverage | Full reach over the 30 cm platform footprint |

---

## The Robot

The final system is a **3-DOF robotic arm** mounted on a **differential-drive mobile platform**. The arm integrates a hybrid end-effector combining a rack-and-pinion mechanical gripper and a vacuum suction cup, enabling it to handle a wide variety of object shapes and textures. A Logitech C270 webcam feeds a live stream to a laptop running YOLOv8; detections are relayed over TCP to a Raspberry Pi 4 which sends joint commands to an Arduino Uno controlling the servo motors and suction pump.

<p align="center">
  <img src="Images/arm_and_platform.png" width="650"/>
</p>
<p align="center"><em>Fully assembled arm mounted on the 30 cm acrylic laser-cut platform</em></p>

<p align="center">
  <img src="Images/Hardware.jpg" width="650"/>
</p>
<p align="center"><em>Complete hardware setup — electronics, arm, platform, and camera</em></p>

### Workspace Envelope

| Measurement | Value |
|-------------|-------|
| Platform diameter (home footprint) | 30 cm |
| Extended arm reach beyond platform edge | ~16.5 cm |
| Maximum reach to lowest point (incl. suction cup) | **~22 cm** |
| Maximum horizontal reach (height unconstrained) | **~26 cm** |
| IK solver validated range — X | 0.05 – 0.20 m |
| IK solver validated range — Y | −0.10 – 0.10 m |
| IK solver validated range — Z | 0.02 – 0.07 m |

---

## CAD Design

The robot was modelled entirely in SolidWorks. All structural components — base, elbow, wrist, end-effector — were designed for 3D printing in PLA on a Raise3D E2 printer, with servo pockets and horn-mounting features printed accurately at each joint. The platform chassis was laser-cut from acrylic for flatness and rigidity, ensuring accurate motor alignment for differential drive.

<p align="center">
  <img src="Images/combined_clean.png" width="680"/>
</p>
<p align="center"><em>CAD model — home position (left) and fully extended position (right)</em></p>

<p align="center">
  <img src="Images/Unknown_torque_simulation.png" width="620"/>
</p>
<p align="center"><em>SolidWorks Motion Study — torque simulation with 250 g payload confirms motor selection</em></p>

The torque simulation confirmed that the MG995 servos (rated ~11 kg·cm at 6 V) comfortably cover the worst-case joint loads when the arm is fully extended with a 250 g object, validating the actuator selection before any physical parts were built.

- [SolidWorks CAD Files](CAD_SolidWorks.zip)
- [STEP Assembly File](assembly.STEP)
- [STL Files for 3D Printing](STL.zip)

---

## Gripper Design

The end-effector uses a **rack-and-pinion mechanical gripper** combined with a **vacuum suction cup**, both 3D-printed in PLA. The pinion is attached directly to the output shaft of an SG90 servo, driving two symmetric linear racks that open and close the jaws. The suction cup is mounted coaxially on top of the gripper casing, connected to a 6 V DC air pump via a relay on Arduino pin D10 — allowing either gripping mode to be used independently based on the object type.

<p align="center">
  <img src="Images/gripper_design.jpg" width="580"/>
</p>
<p align="center"><em>3D-printed hybrid gripper — rack-and-pinion jaws (bottom) and suction cup (top)</em></p>

| Mode | Best For | Control |
|------|----------|---------|
| Mechanical gripper | Nuts, bolts, rigid objects | SG90 servo via PCA9685 |
| Vacuum suction | Eggs, flat surfaces, smooth objects | DC pump via relay on Arduino D10 |

---

## Kinematics

### Forward Kinematics

The kinematic chain (`base_link → elbow_link → wrist_link → arm_link → end_link`) was modelled in URDF, exported from SolidWorks STL meshes. The URDF was validated in `robot_state_publisher` and visualised in RViz, confirming correct link orientation, joint hierarchy, and workspace geometry. Joint sliders were used to command each joint independently and verify that the forward kinematics matched the physical arm's motion.

<p align="center">
  <img src="Images/FK.png" width="650"/>
</p>
<p align="center"><em>Forward kinematics visualisation in RViz — joint slider control</em></p>

### Inverse Kinematics

An IK pipeline was built with **ROS 2 Humble** and **MoveIt 2**, using the KDL solver configured for **position-only IK** (`position_only_ik: true`). This is appropriate for pick-and-place: the solver computes joint angles for a given (X, Y, Z) target without constraining end-effector orientation. A `workspace_scan.cpp` node swept a grid of 40 Cartesian test points and confirmed **100% reachability** across the full operating workspace.

<p align="center">
  <img src="Images/IK.png" width="650"/>
</p>
<p align="center"><em>Inverse kinematics — workspace scan in RViz confirming 100% reachability over 40 test points</em></p>

#### Validated Reachable Points (sample)

| X (m) | Y (m) | Z (m) | Result |
|--------|--------|--------|--------|
| 0.05 | 0.00 | 0.02 | ✅ Reachable |
| 0.10 | 0.05 | 0.07 | ✅ Reachable |
| 0.20 | 0.10 | 0.07 | ✅ Reachable |
| 0.15 | −0.05 | 0.04 | ✅ Reachable |
| 0.08 | −0.10 | 0.05 | ✅ Reachable |

<p align="center">
  <img src="Images/video.gif" width="580"/>
</p>
<p align="center"><em>URDF robot simulation — motion planning in RViz</em></p>

### ROS Package

The full ROS 2 package is included in the [`ROS/`](ROS/) directory:

| File / Folder | Description |
|---------------|-------------|
| [`ROS/urdf/ros.urdf`](ROS/urdf/ros.urdf) | URDF kinematic model of the arm |
| [`ROS/meshes/`](ROS/meshes/) | STL meshes for each link (base, elbow, wrist, arm, end effector) |
| [`ROS/launch/display.launch`](ROS/launch/display.launch) | RViz visualisation launch file |
| [`ROS/launch/gazebo.launch`](ROS/launch/gazebo.launch) | Gazebo simulation launch file |
| [`ROS/config/joint_names_ros.yaml`](ROS/config/joint_names_ros.yaml) | Joint name configuration |
| [`ROS/package.xml`](ROS/package.xml) | ROS package manifest |
| [`ROS/CMakeLists.txt`](ROS/CMakeLists.txt) | Package build configuration |

```bash
# Visualise the arm in RViz
ros2 launch ros display.launch

# Run in Gazebo simulation
ros2 launch ros gazebo.launch
```

- [URDF Model File (legacy)](Files/urdf.urdf)

---

## Electrical System

The electrical architecture is split across three voltage rails to keep logic and power isolated:

- **12 V** — main Li-ion battery pack (12 V, 3000 mAh, 36 Wh)
- **6 V** — buck converter output for all actuators (servos, DC motors, air pump)
- **5 V** — regulated supply for Arduino, Raspberry Pi, Bluetooth module, and all signal lines

All grounds are tied to a single common bus to prevent electrical noise from high-current motor and servo wiring from interfering with signal lines.

<p align="center">
  <img src="Images/Electrical_block_diagram.jpg" width="680"/>
</p>
<p align="center"><em>Final electrical block diagram</em></p>

<p align="center">
  <img src="Images/Electrical_schematic.jpg" width="680"/>
</p>
<p align="center"><em>Electrical schematic — red: 12–6 V power, black: ground, blue: servo signals, orange: 5 V VCC</em></p>

### Power Budget Summary

| Subsystem | Voltage | Peak Current | Peak Power |
|-----------|---------|-------------|------------|
| MG995 Servo × 2 (Wrist + Elbow) | 6 V | 2.0 A each | 12.0 W each |
| SG90 Servo (Gripper) | 6 V | 650 mA | 3.9 W |
| DC Motor × 2 (Platform) | 6 V | 1.2 A each | 7.2 W each |
| DC Air Pump | 6 V | 400 mA | 2.4 W |
| Raspberry Pi 4 | 5 V | 1.2 A | 6.0 W |
| Arduino Uno | 5 V | 80 mA | 0.4 W |
| **6 V Rail Total (peak)** | 6 V | **7.45 A** | **44.7 W** |
| **Estimated runtime (normal use)** | — | — | **~4 hours** |

### Component Selection

All major components were chosen using weighted decision matrices (scored 1–5). Key results:

| Component | Selected | Score | Runner-up |
|-----------|----------|-------|-----------|
| Microcontroller | Arduino UNO | 4.20 | ESP32 (3.70) |
| Camera | Logitech C270 | 4.85 | InnoMaker USB (2.75) |
| Mini-computer | Raspberry Pi 4 | 4.60 | NVIDIA Jetson Nano (2.60) |
| Arm actuator | MG995 / SG90 Servo | 4.30 | DC Motor + Gearbox (2.80) |

<div align="center">
  <img src="https://raw.githubusercontent.com/maherrrrr99/Group1/main/Images/MG995%20Motor.webp" width="155"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/maherrrrr99/Group1/main/Images/20%20kg%C2%B7cm%20high-torque%20servo%20motor.jpg" width="155"/>
  &nbsp;&nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/maherrrrr99/Group1/main/Images/sg90%20micro%20servo.jpg" width="155"/>
</div>
<p align="center"><em>MG995 (left) · 20 kg·cm High-Torque Servo (center) · SG90 Micro Servo (right)</em></p>

---

## Computer Vision

The vision pipeline combines **YOLOv8 deep learning** with **HSV colour filtering** for a hybrid detection system — accuracy of machine learning with the speed and simplicity of colour-based processing.

### Dataset & Annotation

Five object classes were targeted: **egg, nut, bolt, compass, and ball**. Egg images were sourced from the Open Images Dataset; compass images were captured manually; nut and bolt datasets were partially sourced from Roboflow and partially captured in-lab. All images were annotated in **CVAT** with bounding boxes, exported in YOLO 1.1 format, and split 80/20 into training and validation sets.

<p align="center">
  <img src="Images/egg_nut_dataset.png" width="650"/>
</p>
<p align="center"><em>Sample images from the custom egg and nut datasets</em></p>

<p align="center">
  <img src="Images/Egg_annotation.png" width="650"/>
</p>
<p align="center"><em>CVAT bounding box annotations — each egg in the frame produces one row of YOLO coordinates</em></p>

### YOLOv8 Training

The model was trained for **100 epochs** in PyCharm using the Ultralytics YOLOv8 framework on the annotated custom dataset. Training monitored precision, recall, and mAP. The resulting `best.pt` weights were used for all subsequent testing and deployment.

<p align="center">
  <img src="Images/model_training.png" width="680"/>
</p>
<p align="center"><em>YOLOv8 training curves — loss, precision, recall, and mAP over 100 epochs</em></p>

### HSV Colour Calibration

HSV filtering was implemented for green ball detection using OpenCV. The HSV colour space separates colour from brightness, making it robust to lighting variation. An interactive calibration tool with live trackbars was used to determine optimal threshold values.

<p align="center">
  <img src="Images/HSV_CALIBRATION.png" width="650"/>
</p>
<p align="center"><em>HSV calibration tool — adjustable LH/LS/LV/UH/US/UV sliders with live binary mask preview</em></p>

### Deployment on Raspberry Pi

After desktop validation in PyCharm, the model and scripts were transferred to the Raspberry Pi 4. Required dependencies (Ultralytics, OpenCV, NumPy, PyYAML, libcamera) were installed on Ubuntu. The Logitech C270 webcam was integrated and resolution was tuned to balance detection accuracy against processing speed.

<p align="center">
  <img src="Images/camera_test_frame.jpg" width="580"/>
</p>
<p align="center"><em>Test frame from the live Raspberry Pi camera stream</em></p>

<p align="center">
  <img src="Images/detection_on_Pi.png" width="650"/>
</p>
<p align="center"><em>YOLOv8 running on Raspberry Pi — real-time multi-class detection with confidence scores</em></p>

---

## Platform Autonomous Tracking

The Raspberry Pi receiver (`pi_receiver.py`) implements **autonomous object tracking** using the YOLOv8 position data from the laptop. When tracking is active, the platform steers left or right to centre the detected object in the camera frame, then moves forward or backward to reach the target distance. The shoulder joint is effectively replaced by the platform's differential-drive yaw — a deliberate design simplification that reduced the arm from 4-DOF to 3-DOF while preserving full workspace coverage.

<p align="center">
  <img src="Images/tracking_correct.gif" width="680"/>
</p>
<p align="center"><em>Live demonstration — platform autonomously tracking and centring on a detected object</em></p>

**Tracking parameters (safe defaults):**

| Parameter | Value |
|-----------|-------|
| Platform speed | `PLATFORM_BOTH_MOTORS_SPEED:SLOW` |
| Centering dead zone | ±20 px around frame centre (X = 160) |
| Target approach distance | 25 cm |
| Distance dead zone | ±4 cm |
| Tracking command order | Turn to centre → then advance/retreat |
| Data loss timeout | Platform stops after 1 s without detection |

---

## Interactive Website

A full web control interface was built using **Vite + Web Serial API**, providing both manual and autonomous control modes. The site connects to the robot over USB serial, Bluetooth (HC-05), or through the Raspberry Pi network bridge (`http://192.168.1.62:5001`).

<p align="center">
  <img src="Images/Website_1.png" width="720"/>
</p>
<p align="center"><em>Main control panel</em></p>

<p align="center">
  <img src="Images/website_2.png" width="720"/>
</p>
<p align="center"><em>Joint sliders with calibrated physical-degree-to-PWM conversion</em></p>

<p align="center">
  <img src="Images/website_3.png" width="720"/>
</p>
<p align="center"><em>Platform directional controls and live camera feed</em></p>

<p align="center">
  <img src="Images/website_4.png" width="720"/>
</p>
<p align="center"><em>Connection settings — USB Serial, Bluetooth, or Autonomous Network mode</em></p>

**Key features:**
- Elbow and wrist sliders show **physical degrees** and convert to calibrated PWM ticks before sending
- Platform controls: forward, backward, left, right, stop, speed preset
- Suction cup ON / OFF toggle
- Home position and emergency stop
- Autonomous tracking toggle (delegates full control to `pi_receiver.py`)
- Live MJPEG camera feed embedded

```bash
# Run the website locally
cd "Website/arm-controller"
npm install
npm run dev
# Open http://localhost:5173 in Chrome or Edge (required for Web Serial)
```

---

## System Testing

<p align="center">
  <img src="Images/system_testing.gif" width="720"/>
</p>
<p align="center"><em>Full system integration test — detection, tracking, arm movement, and pick sequence</em></p>

Testing was conducted at both subsystem and full-system level:

| Test | Method | Outcome |
|------|--------|---------|
| Individual servo & joint calibration | Serial command interface, PWM sweep | All joints calibrated; elbow 150–600 ticks, wrist 570–1200 ticks |
| Motor & encoder verification | Differential drive test on flat surface | Straight-line motion and turning confirmed |
| YOLOv8 detection accuracy | Live camera, multiple objects, varied lighting | Reliable multi-class detection; confidence threshold tuned |
| HSV colour detection | Interactive trackbar calibration | Green ball isolated across viewing angles and lighting |
| IK workspace scan | 40-point Cartesian grid, MoveIt 2 | 100% reachability (40/40 points) |
| Wireless control link | HC-05 Bluetooth + website | Commands received and executed reliably |
| Platform autonomous tracking | Live object detection loop | Platform centres and approaches target |
| Full pick-and-place cycle | End-to-end run with egg and nut | Object detected → platform tracks → arm picks → places |

---

## Results

### Key Results Summary

| Component | Status | Outcome |
|----------|--------|---------|
| CAD Design | ✅ Completed | Full SolidWorks model; torque validated at 250 g payload |
| 3D Printing & Fabrication | ✅ Completed | All arm links, joints, and gripper printed in PLA |
| Electrical Integration | ✅ Completed | 3-rail power system; common ground; all components wired |
| Arduino Firmware | ✅ Completed | Joint control, relay, motor driver, serial command interface |
| Computer Vision (HSV) | ✅ Completed | Green ball detection with interactive calibration |
| Computer Vision (YOLOv8) | ✅ Completed | 100-epoch custom model; deployed on Raspberry Pi |
| ROS 2 Forward Kinematics | ✅ Completed | URDF validated in RViz; all joints move correctly |
| ROS 2 Inverse Kinematics | ✅ Completed | MoveIt 2 KDL solver; 100% reachability over test grid |
| Interactive Website | ✅ Completed | Full manual and autonomous control via Web Serial |
| Platform Autonomous Tracking | ✅ Completed | Real-time object following with dead-zone control |
| Full Pick-and-Place Pipeline | ✅ Completed | End-to-end autonomous operation demonstrated |

---

## Discussion

The system was successfully integrated and demonstrated end-to-end autonomous operation. The key architectural decisions — offloading YOLOv8 inference to the laptop, using the Raspberry Pi as a command bridge, and replacing the shoulder joint with platform yaw steering — all proved effective in practice, reducing cost and complexity without limiting capability.

The hybrid gripper design handled both rigid (nuts, bolts) and delicate (eggs) objects without hardware reconfiguration. The dual-mode vision pipeline (YOLOv8 + HSV) provided redundancy: HSV detection is faster and works without the TCP link, while YOLOv8 delivers more robust multi-class identification.

The IK workspace validation confirmed 100% solver reachability across the operating envelope, closing the loop from a Cartesian vision output to PWM joint commands on the physical arm.

### Lessons Learned

| Challenge | Impact | Resolution |
|----------|--------|------------|
| Shoulder joint found redundant during assembly | Reduced to 3-DOF arm | Platform yaw delivers equivalent rotation — fewer parts, less weight |
| Servo jitter on unused PCA9685 channels | Signal noise | Unused channels disabled in firmware |
| Initial MoveIt IK failure (`tool0` root link conflict) | IK solver crash | Removed extra root link from URDF export |
| Pi Camera driver issues on Ubuntu | Camera not detected | Switched to Logitech C270 USB webcam |
| Servo power sag under load | Arduino reset | Isolated 5 V logic rail from 6 V actuator rail |
| Long YOLOv8 training cycles | Slow iteration | Dataset cleaned and epoch count tuned to 100 |

---

## Project Management

The project was organized across four subsystem streams — mechanical, electrical, software, and system integration — with weekly progress reviews and clear ownership per member.

## Gantt Chart
[View the updated Gantt Chart](https://studentsaduac-my.sharepoint.com/:x:/g/personal/1087993_students_adu_ac_ae/IQCVl5X-gnVOTbJbda9AOzVBAQxvkQVJ4Exoq-0edEJwLJE?e=tAfXTX&wdLOR=cD9B9CDF9-E9B2-46DC-981F-AE0154DF6142)

---

## Code & Software

| Resource | Description |
|----------|-------------|
| [Computer Vision Scripts](Computer_Vision/) | `laptop_yolo_sender.py`, `pi_receiver.py`, `arm_calibration.py` |
| [Arduino Sketch](Arduino/2_motors_arduino_noross.ino) | Joint control, motor driver, relay, serial interface |
| [Interactive Website](Website/arm-controller/) | Vite web app — manual and autonomous robot control |
| [YOLO Training Results](Computer_Vision/Training_Results/train27/) | `best.pt` weights, loss curves, confusion matrix |
| [Dataset Labels](Dataset/labels/) | YOLO 1.1 format bounding box annotations |

---

## Appendix — Progress Reports

| Week | Format |
|------|--------|
| [Week 2](Files/Progress-W2.pdf) | PDF |
| [Week 3](Files/Progress-W3.pdf) | PDF |
| [Week 4](Files/Progress-W4.pdf) | PDF |
| [Week 5](Files/Progress-W5.pdf) | PDF · [Slides](Files/Progress-W5.pptx) |
| [Week 6](Files/Progress-W6.pdf) | PDF · [Slides](Files/Progress-W6.pptx) |
| [Week 7](Files/Progress-W7.pptx) | Slides |
| [Week 8](Files/Progress-W8.pptx) | Slides |
| [Week 10](Files/Progress-W10.pdf) | PDF |
| [Week 11](Files/Progress-W11.pptx) | Slides |
| [Week 12](Files/Progress-W12.pptx) | Slides |
