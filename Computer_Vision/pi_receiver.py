import glob
import json
import queue
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import serial
except ImportError:
    serial = None


# Edit these settings if the camera frame size or Arduino connection changes.
LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 5000
WEB_COMMAND_HOST = "0.0.0.0"
WEB_COMMAND_PORT = 5001
SERIAL_CANDIDATES = ["/dev/ttyACM0", "/dev/ttyUSB0"]
SERIAL_BAUD = 9600
FRAME_WIDTH = 320
CENTER_X = FRAME_WIDTH // 2
DEAD_ZONE = 20
BALL_TIMEOUT_SECONDS = 1.0
SERIAL_RETRY_SECONDS = 2.0
AUTONOMOUS_TRACKING_ENABLED = True
TARGET_DISTANCE_CM = 25.0
DISTANCE_DEAD_ZONE_CM = 4.0
PLATFORM_TRACKING_SPEED = "SLOW"
PICKUP_SEQUENCE_ENABLED = False
PICKUP_TRIGGER_DISTANCE_CM = 25.0
PICKUP_STABLE_DETECTIONS = 5
PICKUP_COOLDOWN_SECONDS = 8.0
PICKUP_ELBOW_ANGLE = 80
PICKUP_WRIST_ANGLE = 180
PICKUP_GRIPPER_ANGLE = 0
PICKUP_USE_SUCTION = False
WEB_COMMAND_PREFIXES = (
    "ELBOW_JOINT:",
    "WRIST_JOINT:",
    "NORMAL_GRIPPER_ANGLE:",
    "PLATFORM_LEFT_MOTOR_SPEED:",
    "PLATFORM_RIGHT_MOTOR_SPEED:",
    "PLATFORM_BOTH_MOTORS_SPEED:",
    "GRIPPING_TOOL:",
)
WEB_COMMAND_NAMES = {
    "HOME",
    "EMERGENCY_STOP",
    "RESET_EMERGENCY",
    "START_AUTO",
    "PAUSE",
    "RESUME",
    "STOP_AUTO",
    "SUCTION_CUP_ON",
    "SUCTION_CUP_OFF",
    "SUCTION_CUP_PULSE",
    "PLATFORM_LEFT",
    "PLATFORM_RIGHT",
    "PLATFORM_STOP",
    "PLATFORM_FORWARD",
    "PLATFORM_BACKWARD",
    "PLATFORM_FORWARD_RIGHT",
    "PLATFORM_FORWARD_LEFT",
    "PLATFORM_BACKWARD_RIGHT",
    "PLATFORM_BACKWARD_LEFT",
    "PLATFORM_MOTOR_TEST",
}
AUTONOMOUS_CONTROL_COMMANDS = {"START_AUTO", "PAUSE", "RESUME", "STOP_AUTO"}
WEB_COMMAND_QUEUE = queue.Queue()
BRIDGE_STATUS = {
    "arduino_connected": False,
    "serial_port": None,
    "last_serial_error": "not connected yet",
}


def is_web_command_allowed(command):
    if command in WEB_COMMAND_NAMES:
        return True
    return any(command.startswith(prefix) for prefix in WEB_COMMAND_PREFIXES)


class WebCommandHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(200, {"ok": True})

    def do_GET(self):
        if self.path != "/status":
            self._send_json(404, {"ok": False, "error": "unknown endpoint"})
            return

        self._send_json(
            200,
            {
                "ok": True,
                "queued_commands": WEB_COMMAND_QUEUE.qsize(),
                "arduino_connected": BRIDGE_STATUS["arduino_connected"],
                "serial_port": BRIDGE_STATUS["serial_port"],
                "last_serial_error": BRIDGE_STATUS["last_serial_error"],
            },
        )

    def do_POST(self):
        if self.path != "/command":
            self._send_json(404, {"ok": False, "error": "unknown endpoint"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length).decode("utf-8")
            payload = json.loads(raw_body) if raw_body else {}
            command = str(payload.get("command", "")).strip()
        except Exception as error:
            self._send_json(400, {"ok": False, "error": f"bad request: {error}"})
            return

        if not is_web_command_allowed(command):
            self._send_json(400, {"ok": False, "error": "command not allowed"})
            return

        WEB_COMMAND_QUEUE.put(command)
        print(f"Website queued command: {command}")
        self._send_json(202, {"ok": True, "command": command})

    def log_message(self, format_string, *args):
        # Keep robot logs focused on accepted/rejected commands.
        return


def start_web_command_server():
    server = ThreadingHTTPServer((WEB_COMMAND_HOST, WEB_COMMAND_PORT), WebCommandHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Website command bridge listening on {WEB_COMMAND_HOST}:{WEB_COMMAND_PORT}")
    return server


def find_serial_port():
    ports = []
    for candidate in SERIAL_CANDIDATES:
        ports.extend(glob.glob(candidate))
    ports.extend(glob.glob("/dev/ttyACM*"))
    ports.extend(glob.glob("/dev/ttyUSB*"))
    return next(iter(dict.fromkeys(ports)), None)


def open_arduino_serial():
    if serial is None:
        message = "pyserial is not installed. Install with: python3 -m pip install pyserial"
        BRIDGE_STATUS.update({"arduino_connected": False, "serial_port": None, "last_serial_error": message})
        print(message)
        return None

    port = find_serial_port()
    if not port:
        message = "Arduino serial port not found. Robot will stay stopped until serial is available."
        BRIDGE_STATUS.update({"arduino_connected": False, "serial_port": None, "last_serial_error": message})
        print(message)
        return None

    try:
        arduino = serial.Serial(port, SERIAL_BAUD, timeout=1)
        time.sleep(2)
        BRIDGE_STATUS.update({"arduino_connected": True, "serial_port": port, "last_serial_error": ""})
        print(f"Connected to Arduino on {port} at {SERIAL_BAUD} baud")
        return arduino
    except serial.SerialException as error:
        message = f"Could not open Arduino serial port {port}: {error}"
        BRIDGE_STATUS.update({"arduino_connected": False, "serial_port": port, "last_serial_error": message})
        print(message)
        return None


def write_arduino_command(arduino, command):
    if arduino is None or not arduino.is_open:
        return arduino, False

    try:
        arduino.write(f"{command}\n".encode("utf-8"))
        arduino.flush()
        print(f"Arduino <- {command}")
        return arduino, True
    except Exception as error:
        print(f"Serial write failed while sending {command}: {error}")
        try:
            arduino.close()
        except Exception:
            pass
        BRIDGE_STATUS.update(
            {
                "arduino_connected": False,
                "serial_port": BRIDGE_STATUS["serial_port"],
                "last_serial_error": f"Serial write failed: {error}",
            }
        )
        return None, False


def send_platform_command(arduino, command, last_command):
    if command == last_command:
        return arduino, last_command

    arduino, did_send = write_arduino_command(arduino, command)
    return arduino, command if did_send else last_command


def set_tracking_speed(arduino):
    # Object tracking starts slowly so first autonomous motion is predictable.
    command = f"PLATFORM_BOTH_MOTORS_SPEED:{PLATFORM_TRACKING_SPEED}"
    arduino, _ = write_arduino_command(arduino, command)
    return arduino


def safe_stop(arduino, last_command, reason):
    arduino, last_command = send_platform_command(arduino, "PLATFORM_STOP", last_command)
    print(f"Safe stop: {reason}")
    return arduino, last_command


def process_website_commands(arduino, last_command, tracking_enabled):
    while True:
        try:
            command = WEB_COMMAND_QUEUE.get_nowait()
        except queue.Empty:
            return arduino, last_command, tracking_enabled

        if command in {"START_AUTO", "RESUME"}:
            tracking_enabled = True
            arduino = set_tracking_speed(arduino)
            print(f"Autonomous tracking enabled by website command: {command}")
            continue

        if command in {"PAUSE", "STOP_AUTO"}:
            tracking_enabled = False
            arduino, last_command = safe_stop(arduino, last_command, f"website {command}")
            print(f"Autonomous tracking disabled by website command: {command}")
            continue

        if arduino is None or not arduino.is_open:
            print(f"Dropped website command because Arduino serial is unavailable: {command}")
            continue

        arduino, did_send = write_arduino_command(arduino, command)
        if did_send and command.startswith("PLATFORM_"):
            last_command = command

    return arduino, last_command, tracking_enabled


def send_arm_pickup_sequence(arduino):
    # Disabled until calibration finds safe values for your exact arm geometry.
    commands = [
        "PLATFORM_STOP",
        f"ELBOW_JOINT:{PICKUP_ELBOW_ANGLE}",
        f"WRIST_JOINT:{PICKUP_WRIST_ANGLE}",
        f"NORMAL_GRIPPER_ANGLE:{PICKUP_GRIPPER_ANGLE}",
    ]
    if PICKUP_USE_SUCTION:
        commands.append("SUCTION_CUP_ON")

    for command in commands:
        arduino, did_send = write_arduino_command(arduino, command)
        if not did_send:
            return arduino
        time.sleep(0.25)

    return arduino


def parse_ball_message(line):
    parts = line.strip().split(",")
    if len(parts) != 4 or parts[0] != "ball":
        return None

    try:
        return {
            "x": float(parts[1]),
            "y": float(parts[2]),
            "distance": float(parts[3]),
        }
    except ValueError:
        return None


def command_for_ball(ball, tracking_enabled):
    x = ball["x"]
    distance = ball["distance"]

    # Center before driving forward/backward to avoid chasing at an angle.
    if x < CENTER_X - DEAD_ZONE:
        return "PLATFORM_LEFT"
    if x > CENTER_X + DEAD_ZONE:
        return "PLATFORM_RIGHT"

    if not tracking_enabled:
        return "PLATFORM_STOP"

    if distance <= 0:
        return "PLATFORM_STOP"

    if distance > TARGET_DISTANCE_CM + DISTANCE_DEAD_ZONE_CM:
        return "PLATFORM_FORWARD"
    if distance < TARGET_DISTANCE_CM - DISTANCE_DEAD_ZONE_CM:
        return "PLATFORM_BACKWARD"

    return "PLATFORM_STOP"


def is_pickup_trigger_ready(ball):
    if not PICKUP_SEQUENCE_ENABLED:
        return False

    centered = abs(ball["x"] - CENTER_X) <= DEAD_ZONE
    close_enough = 0 < ball["distance"] <= PICKUP_TRIGGER_DISTANCE_CM
    return centered and close_enough


def accept_laptop_connection(server):
    print(f"Waiting for laptop YOLO sender on {LISTEN_HOST}:{LISTEN_PORT}...")
    connection, address = server.accept()
    connection.settimeout(0.1)
    print(f"Laptop connected from {address[0]}:{address[1]}")
    return connection


def main():
    start_web_command_server()
    arduino = open_arduino_serial()
    last_serial_retry = time.monotonic()
    last_command = ""
    tracking_enabled = AUTONOMOUS_TRACKING_ENABLED
    arduino = set_tracking_speed(arduino)
    arduino, last_command = safe_stop(arduino, last_command, "receiver startup")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((LISTEN_HOST, LISTEN_PORT))
        server.listen(1)
        server.settimeout(0.5)

        while True:
            arduino, last_command, tracking_enabled = process_website_commands(arduino, last_command, tracking_enabled)

            try:
                connection = accept_laptop_connection(server)
            except socket.timeout:
                now = time.monotonic()
                if arduino is None and now - last_serial_retry >= SERIAL_RETRY_SECONDS:
                    arduino = open_arduino_serial()
                    last_serial_retry = now
                    arduino = set_tracking_speed(arduino)
                    arduino, last_command = safe_stop(arduino, last_command, "serial reconnect while waiting")
                continue

            buffer = ""
            last_ball_time = time.monotonic()
            stable_pickup_count = 0
            last_pickup_time = 0.0
            arduino, last_command = safe_stop(arduino, last_command, "new laptop connection")

            with connection:
                while True:
                    now = time.monotonic()
                    arduino, last_command, tracking_enabled = process_website_commands(
                        arduino, last_command, tracking_enabled
                    )

                    if arduino is None and now - last_serial_retry >= SERIAL_RETRY_SECONDS:
                        arduino = open_arduino_serial()
                        last_serial_retry = now
                        arduino = set_tracking_speed(arduino)
                        arduino, last_command = safe_stop(arduino, last_command, "serial reconnect")

                    if now - last_ball_time > BALL_TIMEOUT_SECONDS:
                        arduino, last_command = safe_stop(arduino, last_command, "ball data timeout")
                        last_ball_time = now

                    try:
                        chunk = connection.recv(1024)
                    except socket.timeout:
                        continue
                    except OSError as error:
                        arduino, last_command = safe_stop(arduino, last_command, f"socket error: {error}")
                        break

                    if not chunk:
                        arduino, last_command = safe_stop(arduino, last_command, "laptop disconnected")
                        break

                    buffer += chunk.decode("utf-8", errors="replace")
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        ball = parse_ball_message(line)
                        if ball is None:
                            print(f"Ignored malformed laptop message: {line!r}")
                            continue

                        last_ball_time = time.monotonic()
                        now = time.monotonic()
                        if is_pickup_trigger_ready(ball):
                            stable_pickup_count += 1
                        else:
                            stable_pickup_count = 0

                        if (
                            stable_pickup_count >= PICKUP_STABLE_DETECTIONS
                            and now - last_pickup_time >= PICKUP_COOLDOWN_SECONDS
                        ):
                            arduino = send_arm_pickup_sequence(arduino)
                            last_command = "PLATFORM_STOP"
                            last_pickup_time = now
                            stable_pickup_count = 0
                            continue

                        command = command_for_ball(ball, tracking_enabled)
                        arduino, last_command = send_platform_command(arduino, command, last_command)


if __name__ == "__main__":
    main()
