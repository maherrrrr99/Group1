from pathlib import Path
import socket
import time

import cv2
from ultralytics import YOLO


# Edit these settings when the Raspberry Pi address or robot geometry changes.
PI_IP = "192.168.1.62"
PI_TCP_PORT = 5000
CAMERA_STREAM_URL = f"http://{PI_IP}:8080/?action=stream"
MODEL_PATH = Path(__file__).parent / "train27-20260608T072150Z-3-001" / "train27" / "weights" / "best.pt"
BALL_CLASS_ID = 0
REAL_BALL_DIAMETER_CM = 6.57
FOCAL_VALUE = 376.07
SEND_INTERVAL_SECONDS = 0.3
SOCKET_RECONNECT_DELAY_SECONDS = 1.0
CAMERA_RECONNECT_DELAY_SECONDS = 1.0
SHOW_PREVIEW = True
ENABLE_GREEN_BALL_FALLBACK = True
GREEN_HSV_LOWER = (35, 45, 35)
GREEN_HSV_UPPER = (90, 255, 255)
GREEN_MIN_AREA_PIXELS = 600


def connect_to_pi():
    while True:
        try:
            sock = socket.create_connection((PI_IP, PI_TCP_PORT), timeout=3)
            sock.settimeout(3)
            print(f"Connected to Raspberry Pi at {PI_IP}:{PI_TCP_PORT}")
            return sock
        except OSError as error:
            print(f"Pi TCP connection failed: {error}. Retrying...")
            time.sleep(SOCKET_RECONNECT_DELAY_SECONDS)


def open_camera_stream():
    while True:
        capture = cv2.VideoCapture(CAMERA_STREAM_URL)
        if capture.isOpened():
            print(f"Opened camera stream: {CAMERA_STREAM_URL}")
            return capture

        capture.release()
        print("Camera stream is not available. Retrying...")
        time.sleep(CAMERA_RECONNECT_DELAY_SECONDS)


def get_best_ball_detection(result):
    best_detection = None
    best_confidence = -1.0

    if result.boxes is None:
        return None

    for box in result.boxes:
        class_id = int(box.cls[0])
        confidence = float(box.conf[0])
        if class_id != BALL_CLASS_ID or confidence <= best_confidence:
            continue

        x1, y1, x2, y2 = box.xyxy[0].tolist()
        width = max(x2 - x1, 1.0)
        center_x = int((x1 + x2) / 2)
        center_y = int((y1 + y2) / 2)
        distance = (REAL_BALL_DIAMETER_CM * FOCAL_VALUE) / width
        best_detection = (center_x, center_y, distance, confidence, (int(x1), int(y1), int(x2), int(y2)))
        best_confidence = confidence

    return best_detection


def get_green_ball_fallback(frame):
    if not ENABLE_GREEN_BALL_FALLBACK:
        return None

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, GREEN_HSV_LOWER, GREEN_HSV_UPPER)
    mask = cv2.medianBlur(mask, 7)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contour = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(contour)
    if area < GREEN_MIN_AREA_PIXELS:
        return None

    x, y, w, h = cv2.boundingRect(contour)
    diameter_pixels = max(w, h, 1)
    center_x = int(x + w / 2)
    center_y = int(y + h / 2)
    distance = (REAL_BALL_DIAMETER_CM * FOCAL_VALUE) / diameter_pixels
    return (center_x, center_y, distance, 1.0, (x, y, x + w, y + h), "green-fallback")


def send_detection(sock, detection):
    x, y, distance, confidence, *_ = detection
    message = f"ball,{x},{y},{distance:.2f}\n"
    sock.sendall(message.encode("utf-8"))
    source = detection[5] if len(detection) > 5 else "yolo"
    print(f"Sent {message.strip()} confidence={confidence:.2f} source={source}")


def main():
    model = YOLO(str(MODEL_PATH))
    sock = connect_to_pi()
    capture = open_camera_stream()
    last_send_time = 0.0

    while True:
        ok, frame = capture.read()
        if not ok:
            print("Camera frame read failed. Reopening stream...")
            capture.release()
            capture = open_camera_stream()
            continue

        result = model(frame, verbose=False)[0]
        detection = get_best_ball_detection(result)
        if detection is None:
            detection = get_green_ball_fallback(frame)
        now = time.monotonic()

        if detection and now - last_send_time >= SEND_INTERVAL_SECONDS:
            try:
                send_detection(sock, detection)
                last_send_time = now
            except OSError as error:
                print(f"Pi TCP send failed: {error}. Reconnecting...")
                try:
                    sock.close()
                except OSError:
                    pass
                sock = connect_to_pi()

        if SHOW_PREVIEW:
            preview = frame.copy()
            if detection:
                x, y, distance, confidence, (x1, y1, x2, y2), *source_data = detection
                source = source_data[0] if source_data else "yolo"
                cv2.rectangle(preview, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(
                    preview,
                    f"ball {source} {distance:.1f}cm",
                    (x1, max(20, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.45,
                    (0, 255, 0),
                    1,
                )
                cv2.circle(preview, (x, y), 3, (0, 255, 0), -1)

            cv2.imshow("YOLO ball sender", preview)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    capture.release()
    sock.close()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
