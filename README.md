# Pick-and-Place Robot Workflow

This project uses a laptop for YOLO detection, a Raspberry Pi as the camera and command bridge, and an Arduino for the arm, suction pump, and platform motors.

The suction pump is controlled through a relay on Arduino pin `D10`. The command names are unchanged: `SUCTION_CUP_ON` energizes the relay and `SUCTION_CUP_OFF` releases it.

## Expected Network Setup

- Raspberry Pi IP: `192.168.1.62`
- Pi camera stream: `http://192.168.1.62:8080/?action=stream`
- Pi receiver TCP port: `5000`
- Pi website command bridge: `http://192.168.1.62:5001`
- Laptop sender message format: `ball,x,y,distance`
- Arduino serial: `/dev/ttyACM0` or `/dev/ttyUSB0`, baud `9600`

## Start Camera Stream On Raspberry Pi

From the `mjpg_streamer` folder on the Raspberry Pi:

```bash
./mjpg_streamer -i "./input_uvc.so -d /dev/video0 -r 240x180 -f 7 -q 25" -o "./output_http.so -w ./www -p 8080"
```

Verify from the laptop:

```text
http://192.168.1.62:8080/?action=stream
```

## Start Raspberry Pi Receiver

Copy or keep `pi_receiver.py` on the Raspberry Pi, then run:

```bash
python3 -m pip install pyserial
python3 pi_receiver.py
```

The receiver listens on `0.0.0.0:5000` for laptop YOLO data and `0.0.0.0:5001` for website manual commands. It auto-detects `/dev/ttyACM0` or `/dev/ttyUSB0`, and sends `PLATFORM_STOP` whenever data is lost, the laptop disconnects, or the receiver starts.

Verify the website command bridge from the laptop:

```powershell
Invoke-WebRequest http://192.168.1.62:5001/status
```

Object tracking is enabled in `pi_receiver.py` with these safe defaults:

- Platform speed command on startup: `PLATFORM_BOTH_MOTORS_SPEED:SLOW`
- Centering dead zone: `20` pixels around frame center X `160`
- Target ball distance: `25 cm`
- Distance dead zone: `4 cm`
- Tracking command order: turn left/right first, then move forward/backward only after the ball is centered

To make tracking more cautious, increase `TARGET_DISTANCE_CM`, increase `DISTANCE_DEAD_ZONE_CM`, or set `AUTONOMOUS_TRACKING_ENABLED = False` in `pi_receiver.py`.

Calibrated physical home:

- Elbow command `55` = physical elbow `90` degrees
- Wrist command `0` = physical wrist `0` degrees
- Gripper command `90` = home gripper angle

Calibrated elbow endpoints for website control:

- Physical elbow `0` degrees sends Arduino command `10`
- Physical elbow `90` degrees sends Arduino command `55`
- Physical elbow `180` degrees sends Arduino command `115`

The website elbow slider shows physical degrees. It converts those physical degrees to the calibrated Arduino command before sending `ELBOW_JOINT:<angle>`.

Calibrated wrist endpoints for website control:

- Physical wrist `0` degrees sends Arduino command `0`
- Physical wrist `80` degrees sends Arduino command `110`

The wrist is capped at physical `80` degrees because Arduino command `110` is the measured safe maximum.

Arm pickup is guarded by `PICKUP_SEQUENCE_ENABLED = False` until calibration is complete. Use `arm_calibration.py` on the Raspberry Pi to find safe values first, then copy those values into:

- `PICKUP_TRIGGER_DISTANCE_CM`
- `PICKUP_ELBOW_ANGLE`
- `PICKUP_WRIST_ANGLE`
- `PICKUP_GRIPPER_ANGLE`
- `PICKUP_USE_SUCTION`

## Calibrate Arm Angles On Raspberry Pi

Stop autonomous tracking first so no platform commands are active:

```powershell
Get-Process python,py | Stop-Process -Force
```

Then on the Raspberry Pi:

```bash
pkill -f pi_receiver.py
python3 ~/arm_calibration.py
```

Calibration controls:

```text
e / E : elbow -5 / +5 degrees
w / W : wrist -5 / +5 degrees
g / G : gripper -5 / +5 degrees
s     : suction cup on
x     : suction cup off
h     : home
p     : platform stop
?     : print current values
q     : quit
```

Record the elbow, wrist, and gripper values that place the tool safely at the egg.

## Live Feed Delay

The website preview can lag because browser MJPEG display buffers frames. Use the laptop YOLO sender log and Pi receiver log for control timing. For less delay, keep the stream low resolution and refresh/restart `mjpg_streamer` if the browser preview falls behind.

## Run Laptop YOLO Sender

From this project folder on the laptop:

```bash
python -m pip install ultralytics opencv-python
python laptop_yolo_sender.py
```

The script uses:

```text
train27-20260608T072150Z-3-001/train27/weights/best.pt
```

It sends only the most confident `ball` detection every `0.3` seconds.

For autonomous object tracking, start the Raspberry Pi receiver first, then run this laptop sender. The receiver will stop the platform automatically if ball data stops for more than `1` second.

## Run Website

From the website folder:

```bash
cd "pick and place website/pick and place website/2026-05-19/i-am-working-on-a-mechatronics/arm-controller"
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Use Chrome or Edge for Web Serial.

### HC-05 Bluetooth manual control

The Arduino sketch uses `SoftwareSerial bluetooth(2, 3)` at `9600` baud:

```text
HC-05 TXD -> Arduino D2  (Arduino software RX)
HC-05 RXD -> Arduino D3  (Arduino software TX, use a voltage divider)
HC-05 VCC -> Arduino 5V
HC-05 GND -> Arduino GND
```

Pair the HC-05 in Windows first, then open the website, choose `Bluetooth`, click connect, and select the HC-05/SPP COM port. The website sends the same command names used by USB serial, such as `HOME`, `PLATFORM_STOP`, `ELBOW_JOINT:<angle>`, and `SUCTION_CUP_ON`.

To control the Arduino through the Raspberry Pi instead of HC-05/USB, choose `Autonomous Network`; the website sends commands to `http://192.168.1.62:5001/command`.

Keep the existing Arduino command names, including `PLATFORM_LEFT`, `PLATFORM_RIGHT`, `PLATFORM_STOP`, `HOME`, `EMERGENCY_STOP`, `RESET_EMERGENCY`, `SUCTION_CUP_ON`, and `SUCTION_CUP_OFF`.
