### ● Hardware Integration
The robotic system is built around a combination of a Raspberry Pi and an Arduino, which together enable both high-level processing and low-level control. The Raspberry Pi is responsible for vision processing, object detection, and decision-making using camera input, while the Arduino handles real-time control of the actuators by generating PWM signals for the motors. Communication between the two controllers is achieved through serial communication (USB or UART), allowing coordinated system operation.

The actuation system is based on multiple servo motors selected according to torque and functional requirements. MG995 servo motors (270° rotation) are used for standard joints, providing sufficient torque for base and intermediate movements. For heavier joints such as the elbow, a 20 kg·cm high-torque servo motor (270° rotation) is used to ensure stability and lifting capability. The gripper mechanism is controlled using an SG90 micro servo (180° rotation), which offers lightweight and precise motion for opening and closing actions. All motors are controlled using PWM signals from the Arduino, and no external encoders are required since the servos include built-in potentiometers, enabling closed-loop position control.
<div align="center">

<img src="https://raw.githubusercontent.com/maherrrrr99/Group1/main/Images/MG995%20Motor.webp" width="170"/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<img src="https://raw.githubusercontent.com/maherrrrr99/Group1/main/Images/20%20kg%C2%B7cm%20high-torque%20servo%20motor.jpg" width="170"/>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
<img src="https://raw.githubusercontent.com/maherrrrr99/Group1/main/Images/sg90%20micro%20servo.jpg" width="170"/>

<br>

<em>Figure: MG995 Servo Motor (left), 20 kg·cm High-Torque Servo (center), and SG90 Micro Servo (right)</em>

</div>

For sensing and object detection, the system integrates a camera connected to the Raspberry Pi. The current design considers either the Raspberry Pi Camera Module, which offers seamless integration and low latency, or a smartphone camera as an alternative for higher image quality. The camera provides real-time visual feedback, which is processed using computer vision and AI techniques to identify and locate objects for pick-and-place operations.
<p align="center">
  <img src="https://raw.githubusercontent.com/maherrrrr99/Group1/main/Images/Raspberry%20Pi%20Camera%20Module.jpg" width="200"/>
</p>
<p align="center"><em>Figure: Raspberry Pi Camera Module</em></p>

In terms of hardware layout and wiring, the servo motors are connected to the Arduino’s PWM pins and powered using an external power supply to ensure stable operation and prevent overloading the control board. The Raspberry Pi interfaces directly with the camera and communicates with the Arduino to send control commands based on processed visual data. This architecture allows efficient integration of mechanical, electronic, and intelligent subsystems, resulting in a flexible and scalable mechatronic system.
