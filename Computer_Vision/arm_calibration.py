import glob
import time

try:
    import serial
except ImportError:
    serial = None


SERIAL_CANDIDATES = ["/dev/ttyACM0", "/dev/ttyUSB0"]
SERIAL_BAUD = 9600
STEP_DEGREES = 5

elbow_angle = 90
wrist_angle = 0
gripper_angle = 90


def find_serial_port():
    ports = []
    for candidate in SERIAL_CANDIDATES:
        ports.extend(glob.glob(candidate))
    ports.extend(glob.glob("/dev/ttyACM*"))
    ports.extend(glob.glob("/dev/ttyUSB*"))
    return next(iter(dict.fromkeys(ports)), None)


def send_command(arduino, command):
    arduino.write(f"{command}\n".encode("utf-8"))
    arduino.flush()
    print(f"Arduino <- {command}")
    time.sleep(0.08)
    while arduino.in_waiting:
        print(f"Arduino -> {arduino.readline().decode(errors='replace').strip()}")


def clamp_angle(value):
    return max(0, min(180, value))


def print_help():
    print(
        """
Arm calibration controls
------------------------
e / E : elbow -5 / +5 degrees
w / W : wrist -5 / +5 degrees
g / G : gripper -5 / +5 degrees
s     : suction cup on
x     : suction cup off
h     : home
p     : platform stop
?     : print current values
q     : quit
"""
    )


def main():
    global elbow_angle, wrist_angle, gripper_angle

    if serial is None:
        print("pyserial is not installed. Run: python3 -m pip install pyserial")
        return

    port = find_serial_port()
    if not port:
        print("Arduino serial port not found.")
        return

    with serial.Serial(port, SERIAL_BAUD, timeout=0.4) as arduino:
        time.sleep(2)
        send_command(arduino, "PLATFORM_STOP")
        send_command(arduino, "SUCTION_CUP_OFF")
        print_help()

        while True:
            print(f"Current: elbow={elbow_angle}, wrist={wrist_angle}, gripper={gripper_angle}")
            choice = input("calibrate> ").strip()
            if not choice:
                continue

            if choice == "q":
                send_command(arduino, "PLATFORM_STOP")
                send_command(arduino, "SUCTION_CUP_OFF")
                break
            if choice == "?":
                continue
            if choice == "h":
                send_command(arduino, "HOME")
                elbow_angle, wrist_angle, gripper_angle = 90, 0, 90
                continue
            if choice == "p":
                send_command(arduino, "PLATFORM_STOP")
                continue
            if choice == "s":
                send_command(arduino, "SUCTION_CUP_ON")
                continue
            if choice == "x":
                send_command(arduino, "SUCTION_CUP_OFF")
                continue

            if choice == "e":
                elbow_angle = clamp_angle(elbow_angle - STEP_DEGREES)
                send_command(arduino, f"ELBOW_JOINT:{elbow_angle}")
            elif choice == "E":
                elbow_angle = clamp_angle(elbow_angle + STEP_DEGREES)
                send_command(arduino, f"ELBOW_JOINT:{elbow_angle}")
            elif choice == "w":
                wrist_angle = clamp_angle(wrist_angle - STEP_DEGREES)
                send_command(arduino, f"WRIST_JOINT:{wrist_angle}")
            elif choice == "W":
                wrist_angle = clamp_angle(wrist_angle + STEP_DEGREES)
                send_command(arduino, f"WRIST_JOINT:{wrist_angle}")
            elif choice == "g":
                gripper_angle = clamp_angle(gripper_angle - STEP_DEGREES)
                send_command(arduino, f"NORMAL_GRIPPER_ANGLE:{gripper_angle}")
            elif choice == "G":
                gripper_angle = clamp_angle(gripper_angle + STEP_DEGREES)
                send_command(arduino, f"NORMAL_GRIPPER_ANGLE:{gripper_angle}")
            else:
                print_help()


if __name__ == "__main__":
    main()
