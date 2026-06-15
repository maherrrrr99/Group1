// Main robotic arm/platform dashboard logic: modes, commands, safety behavior, and live status display.
import { useEffect, useMemo, useRef, useState } from "react";

const BLUETOOTH_METHOD = "Bluetooth";
const USB_SERIAL_METHOD = "USB Serial";
const AUTONOMOUS_NETWORK_METHOD = "Autonomous Network";
const SIMULATION_METHOD = "Simulation Mode";
const SITE_TITLE = "Pick and Place Robot Controller";
const COMMUNICATION_METHODS = [AUTONOMOUS_NETWORK_METHOD, BLUETOOTH_METHOD, USB_SERIAL_METHOD, SIMULATION_METHOD];
const SERIAL_BAUD_RATE = 9600;
const CONNECTION_STATES = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  error: "Error",
};
// Web Serial filters only support USB IDs. Bluetooth SPP/HC-05 ports cannot be reliably filtered by name.
const USB_SERIAL_PORT_FILTERS = [
  { usbVendorId: 0x2341 },
  { usbVendorId: 0x2a03 },
  { usbVendorId: 0x1a86 },
  { usbVendorId: 0x0403 },
  { usbVendorId: 0x10c4 },
  { usbVendorId: 0x1b4f },
  { usbVendorId: 0x239a },
  { usbVendorId: 0x03eb },
  { usbVendorId: 0x2e8a },
];
const MODE_OPTIONS = ["Off", "Manual", "Automatic"];
const MODE_MESSAGES = {
  serialNoSupport: "Web Serial is not supported in this browser.",
  disconnected: "Connect first before changing modes.",
  manualArm: "Manual Arm control is active.",
  manualPlatform: "Manual Platform control is active.",
  automatic: "Arm Mode and Platform Mode changed to Automatic together.",
  off: "Automatic Mode stopped for both systems.",
};

const CONNECTION_GUIDES = {
  [BLUETOOTH_METHOD]: {
    actionLabel: "Open Bluetooth Port List",
  },
  [USB_SERIAL_METHOD]: {
    actionLabel: "Open USB Port List",
  },
  [AUTONOMOUS_NETWORK_METHOD]: {
    actionLabel: "Open Autonomous Dashboard",
  },
  [SIMULATION_METHOD]: {
    actionLabel: "Connect",
  },
};

const CONNECTION_TOOLTIPS = {
  [BLUETOOTH_METHOD]: "Connects to the HC-05 Bluetooth module through a Bluetooth serial COM port.",
  [USB_SERIAL_METHOD]: "Connects directly to the Arduino or other serial device using a USB cable.",
  [AUTONOMOUS_NETWORK_METHOD]: "Sends website commands to the Raspberry Pi bridge and uses the Pi/laptop autonomous workflow.",
  [SIMULATION_METHOD]: "Runs the dashboard without hardware for interface testing and demonstrations.",
};

const CAMERA_SOURCE_OPTIONS = [
  { value: "browser", label: "Browser Camera" },
  { value: "urlStream", label: "URL Streaming" },
  { value: "raspberryPiRaw", label: "Raspberry Pi Raw Stream" },
  { value: "raspberryPiModel", label: "Raspberry Pi Model Stream" },
];
// Raspberry Pi stream defaults match the current robot network address.
const DEFAULT_RASPBERRY_PI_STREAM_URL = "http://192.168.1.62:8080/?action=stream";
const DEFAULT_RASPBERRY_PI_MODEL_STREAM_URL = "http://192.168.1.62:8080/?action=stream";
const PI_RECEIVER_ADDRESS = "192.168.1.62:5000";
const PI_COMMAND_BRIDGE_URL = "http://192.168.1.62:5001";
const AUTONOMOUS_TARGET_OBJECT = "ball";
const AUTONOMOUS_TARGET_DISTANCE_CM = 25;

const MODE_EXPLANATIONS = {
  arm: {
    Off: "Arm Mode is Off. Arm controls are disabled.",
    Manual: "Manual Arm Mode enabled. You can control the arm joints directly.",
    Automatic: "Automatic Mode enabled for the arm and platform system.",
  },
  platform: {
    Off: "Platform Mode is Off. Platform controls are disabled.",
    Manual: "Manual Platform Mode enabled. Use WASD controls for movement.",
    Automatic: "Automatic Mode enabled for the arm and platform system.",
  },
};

const TOAST_DURATION = 2600;
const MODE_TOAST_DURATION = 4800;
const ROBOT_IMAGE_SRC = "/images/robotic-arm.png?v=20260521";

const COURSE_INFO = {
  course: "Mechatronics System Design",
  code: "MEC483",
  instructor: "Dr. Claudio Vignola",
};

const TEAM_MEMBERS = [
  { name: "Maher Abo Abed", id: "1087993" },
  { name: "Sabeeha Zainab Hasham", id: "1089042" },
  { name: "Basel Feras Ghunaim", id: "1088912" },
  { name: "Ahmad Nasser Alshehhi", id: "1090882" },
];

const HOME_POSITION = {
  baseRotation: 90,
  elbowJoint: 90,
  wristJoint: 0,
  armAngle: 90,
  normalGripperAngle: 90,
};

const ARM_HOME_COMMANDS = {
  elbowJoint: 55,
  wristJoint: 0,
  normalGripperAngle: 90,
};

const MOTOR_ANGLE_LIMITS = [0, 270];
const NORMAL_GRIPPER_LIMITS = [0, 180];
const LEGACY_GRIPPER_LIMITS = [0, 100];
const PLATFORM_SPEED_LIMITS = [0, 100];
const DEFAULT_PLATFORM_SPEED = 50;
const EMERGENCY_COMMANDS = new Set(["EMERGENCY_STOP", "RESET_EMERGENCY"]);

const JOINT_SLIDERS = [
  {
    key: "baseRotation",
    label: "Base Rotation",
    commandPrefix: "BASE_ROTATION",
    description: "Rotates the full arm left and right around the bottom base joint.",
  },
  {
    key: "elbowJoint",
    label: "Elbow Joint",
    commandPrefix: "ELBOW_JOINT",
    range: [0, 180],
    // Calibrated from the real arm: physical 0/90/180 deg maps to Arduino 10/55/115.
    commandCalibration: [
      [0, 10],
      [90, 55],
      [180, 115],
    ],
    description: "Controls the elbow movement for bending the main arm link.",
  },
  {
    key: "wristJoint",
    label: "Wrist Joint",
    commandPrefix: "WRIST_JOINT",
    range: [0, 80],
    // Calibrated safe wrist range: physical 0/80 deg maps to Arduino 0/110.
    commandCalibration: [
      [0, 0],
      [80, 110],
    ],
    description: "Controls the wrist movement for adjusting the next arm link angle.",
  },
  {
    key: "armAngle",
    label: "Arm Angle",
    commandPrefix: "ARM_ANGLE",
    description: "Adjusts the arm angle used to position the end-effector direction.",
  },
];

const GRIPPING_TOOLS = [
  { label: "Normal Gripper", value: "NORMAL_GRIPPER" },
  { label: "Pneumatic Suction Cup", value: "PNEUMATIC_SUCTION_CUP" },
];

const NORMAL_GRIPPER_QUICK_ACTIONS = [
  { label: "Fully Open", value: 180 },
  { label: "Half Open / Close", value: 90 },
  { label: "Fully Close", value: 0 },
];

const AUTOMATIC_CONTROLS = [
  { label: "Arm Tracking", command: "START_AUTO", state: "Running" },
  { label: "Pause Status", command: "PAUSE", state: "Paused", activeWhen: "Paused" },
  { label: "Resume Status", command: "RESUME", state: "Running", activeWhen: "Running" },
  { label: "Stop Status", command: "STOP_AUTO", state: "Stopped", activeWhen: "Stopped" },
];

// Manual platform controls are mapped to the current L298N orientation on the robot.
const PLATFORM_CONTROLS = [
  { key: "w", letter: "W", label: "Forward", command: "PLATFORM_LEFT", className: "platform-forward" },
  { key: "a", letter: "A", label: "Left", command: "PLATFORM_FORWARD", className: "platform-left" },
  { key: "s", letter: "S", label: "Backward", command: "PLATFORM_RIGHT", className: "platform-backward" },
  { key: "d", letter: "D", label: "Right", command: "PLATFORM_BACKWARD", className: "platform-right" },
];

const PLATFORM_COMMAND_KEYS = {
  PLATFORM_LEFT: ["w"],
  PLATFORM_FORWARD: ["a"],
  PLATFORM_RIGHT: ["s"],
  PLATFORM_BACKWARD: ["d"],
  PLATFORM_BACKWARD_LEFT: ["w", "d"],
  PLATFORM_FORWARD_LEFT: ["w", "a"],
  PLATFORM_BACKWARD_RIGHT: ["s", "d"],
  PLATFORM_FORWARD_RIGHT: ["s", "a"],
};

const PLATFORM_STOP_CONTROL = {
  key: " ",
  letter: "Space",
  label: "Stop",
  command: "PLATFORM_STOP",
};

const PLATFORM_MOTOR_TEST_CONTROL = {
  letter: "Test",
  label: "Pulse motors",
  command: "PLATFORM_MOTOR_TEST",
};

const PLATFORM_MOVEMENT_KEYS = new Set(["w", "a", "s", "d"]);

const PLATFORM_SPEED_LEVELS = [
  { label: "Slow", value: 0, commandValue: "SLOW" },
  { label: "Medium", value: 50, commandValue: "MEDIUM" },
  { label: "Fast", value: 100, commandValue: "FAST" },
];

const PLATFORM_SPEED_MOTORS = [
  { key: "leftMotor", label: "Left Motor Speed", commandPrefix: "PLATFORM_LEFT_MOTOR_SPEED" },
  { key: "rightMotor", label: "Right Motor Speed", commandPrefix: "PLATFORM_RIGHT_MOTOR_SPEED" },
];

const DEFAULT_PLATFORM_SPEEDS = {
  leftMotor: DEFAULT_PLATFORM_SPEED,
  rightMotor: DEFAULT_PLATFORM_SPEED,
};

const HOME_CONTROL = { label: "Arm Home Position", command: "HOME" };
const ARM_HOME_SEQUENCE_DELAY_MS = 650;

const ANGLE_COMMAND_LABELS = {
  BASE_ROTATION: "Base Rotation",
  ELBOW_JOINT: "Elbow Joint",
  WRIST_JOINT: "Wrist Joint",
  ARM_ANGLE: "Arm Angle",
  NORMAL_GRIPPER_ANGLE: "Normal Gripper Angle",
};

const COMMAND_LABELS = {
  GRIPPER_OPEN: "Gripper Open",
  GRIPPER_CLOSE: "Gripper Close",
  HOME: "Arm Home Position",
  STOP: "Stop",
  START_AUTO: "Automatic Mode Started",
  PAUSE: "Automatic Mode Paused",
  RESUME: "Automatic Mode Resumed",
  STOP_AUTO: "Automatic Mode Stopped",
  SUCTION_CUP_ON: "Pneumatic Suction Cup: ON",
  SUCTION_CUP_OFF: "Pneumatic Suction Cup: OFF",
  PLATFORM_FORWARD: "Platform Forward",
  PLATFORM_BACKWARD: "Platform Backward",
  PLATFORM_LEFT: "Platform Turn Left",
  PLATFORM_RIGHT: "Platform Turn Right",
  PLATFORM_FORWARD_RIGHT: "Platform Forward Right",
  PLATFORM_FORWARD_LEFT: "Platform Forward Left",
  PLATFORM_BACKWARD_RIGHT: "Platform Backward Right",
  PLATFORM_BACKWARD_LEFT: "Platform Backward Left",
  PLATFORM_STOP: "Platform Stop",
  PLATFORM_MOTOR_TEST: "Platform Motor Test",
  EMERGENCY_STOP: "Emergency Stop Activated",
  RESET_EMERGENCY: "Emergency Stop Reset",
  None: "None",
};

function clamp(value, [min, max]) {
  return Math.min(Math.max(value, min), max);
}

function mapRange(value, [sourceMin, sourceMax], [targetMin, targetMax]) {
  const sourceSpan = sourceMax - sourceMin;
  if (sourceSpan === 0) return targetMin;

  const ratio = (value - sourceMin) / sourceSpan;
  return targetMin + ratio * (targetMax - targetMin);
}

function getJointCommandAngle(joint, uiAngle) {
  if (joint.commandCalibration) {
    const points = joint.commandCalibration;
    const boundedAngle = clamp(uiAngle, joint.range || MOTOR_ANGLE_LIMITS);

    for (let index = 0; index < points.length - 1; index += 1) {
      const [sourceMin, targetMin] = points[index];
      const [sourceMax, targetMax] = points[index + 1];

      if (boundedAngle >= sourceMin && boundedAngle <= sourceMax) {
        return Math.round(mapRange(boundedAngle, [sourceMin, sourceMax], [targetMin, targetMax]));
      }
    }

    return Math.round(points[points.length - 1][1]);
  }

  if (!joint.commandRange) return uiAngle;

  return Math.round(mapRange(uiAngle, joint.range || MOTOR_ANGLE_LIMITS, joint.commandRange));
}

function formatTime(date) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getJointFromCommand(command) {
  return JOINT_SLIDERS.find((joint) => command.startsWith(`${joint.commandPrefix}:`));
}

function getGrippingToolLabel(value) {
  return GRIPPING_TOOLS.find((tool) => tool.value === value)?.label || value;
}

// Converts currently held WASD keys into a movement command; empty means stop on release.
function getPlatformMovementCommand(pressedKeys) {
  const forward = pressedKeys.has("w") && !pressedKeys.has("s");
  const backward = pressedKeys.has("s") && !pressedKeys.has("w");
  const left = pressedKeys.has("a") && !pressedKeys.has("d");
  const right = pressedKeys.has("d") && !pressedKeys.has("a");

  if (forward && right) return "PLATFORM_BACKWARD_LEFT";
  if (forward && left) return "PLATFORM_FORWARD_LEFT";
  if (backward && right) return "PLATFORM_BACKWARD_RIGHT";
  if (backward && left) return "PLATFORM_FORWARD_RIGHT";
  if (forward) return "PLATFORM_LEFT";
  if (backward) return "PLATFORM_RIGHT";
  if (left) return "PLATFORM_FORWARD";
  if (right) return "PLATFORM_BACKWARD";
  return "";
}

function isPlatformButtonActive(activeCommand, key) {
  return PLATFORM_COMMAND_KEYS[activeCommand]?.includes(key);
}

function createPlatformSpeedMap(speed) {
  return Object.fromEntries(PLATFORM_SPEED_MOTORS.map((motor) => [motor.key, speed]));
}

// Platform speed selectors snap to Slow, Medium, or Fast only.
function normalizePlatformSpeed(value) {
  const speedText = String(value).toUpperCase();
  const matchingLevel = PLATFORM_SPEED_LEVELS.find(
    (level) => level.commandValue === speedText || level.label.toUpperCase() === speedText
  );

  if (matchingLevel) return matchingLevel.value;

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_PLATFORM_SPEED;
  if (numericValue <= 25) return 0;
  if (numericValue >= 75) return 100;
  return DEFAULT_PLATFORM_SPEED;
}

function getPlatformSpeedLevel(value) {
  const speed = normalizePlatformSpeed(value);
  return PLATFORM_SPEED_LEVELS.find((level) => level.value === speed) || PLATFORM_SPEED_LEVELS[1];
}

function formatPlatformSpeedLevel(value) {
  return getPlatformSpeedLevel(value).label;
}

function getPlatformSpeedCommandValue(value) {
  return getPlatformSpeedLevel(value).commandValue;
}

function getPlatformSpeedMotor(commandName) {
  return PLATFORM_SPEED_MOTORS.find((motor) => motor.commandPrefix === commandName);
}

// Makes technical robot commands readable in the command log and status bar.
function formatCommandForDisplay(command) {
  const [commandName, value] = command.split(":");

  if (ANGLE_COMMAND_LABELS[commandName] && value !== undefined) {
    return `${ANGLE_COMMAND_LABELS[commandName]}: ${value}\u00b0`;
  }

  if (commandName === "GRIPPER_POSITION" && value !== undefined) {
    return `Gripper Position: ${value}%`;
  }

  if (commandName === "GRIPPING_TOOL" && value !== undefined) {
    return `Gripping Tool: ${getGrippingToolLabel(value)}`;
  }

  if (commandName === "PLATFORM_BOTH_MOTORS_SPEED" && value !== undefined) {
    return `Both Motors Speed: ${formatPlatformSpeedLevel(value)}`;
  }

  const platformSpeedMotor = getPlatformSpeedMotor(commandName);
  if (platformSpeedMotor && value !== undefined) {
    return `${platformSpeedMotor.label}: ${formatPlatformSpeedLevel(value)}`;
  }

  return COMMAND_LABELS[command] || command;
}

function createSimulationTransport(method) {
  return {
    async send(commandText) {
      console.info(`[${method}] ${commandText.trim()}`);
    },
  };
}

function createPiNetworkTransport() {
  return {
    async send(commandText) {
      const command = commandText.trim();
      if (!command) return;

      const response = await fetch(`${PI_COMMAND_BRIDGE_URL}/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });

      if (!response.ok) {
        throw new Error(`Pi command bridge rejected ${command}: ${response.status}`);
      }
    },
  };
}

async function checkPiCommandBridge() {
  const response = await fetch(`${PI_COMMAND_BRIDGE_URL}/status`);
  if (!response.ok) {
    throw new Error(`Pi command bridge status failed: ${response.status}`);
  }

  return response.json();
}

function createSerialTransport(writer) {
  const encoder = new TextEncoder();

  return {
    async send(commandText) {
      await writer.write(encoder.encode(commandText));
    },
  };
}

function isBluetoothMethod(method) {
  return method === BLUETOOTH_METHOD;
}

function isUsbSerialMethod(method) {
  return method === USB_SERIAL_METHOD;
}

function isSerialMethod(method) {
  return isBluetoothMethod(method) || isUsbSerialMethod(method);
}

function isSimulationMethod(method) {
  return method === SIMULATION_METHOD;
}

function getConnectionGuide(method) {
  return CONNECTION_GUIDES[method] || CONNECTION_GUIDES[SIMULATION_METHOD];
}

function getDisconnectedDetail(method) {
  if (isBluetoothMethod(method)) return "Bluetooth selected - not connected";
  if (isUsbSerialMethod(method)) return "USB Serial selected - not connected";
  if (method === AUTONOMOUS_NETWORK_METHOD) return `Pi command bridge ready at ${PI_COMMAND_BRIDGE_URL}`;
  return `Disconnected from ${method}`;
}

function getConnectedDetail(method, portSummary = "") {
  if (portSummary) return portSummary;
  if (isBluetoothMethod(method)) return "Connected via Bluetooth";
  if (isUsbSerialMethod(method)) return "Connected via USB Serial";
  if (method === AUTONOMOUS_NETWORK_METHOD) return `Connected to Pi command bridge at ${PI_COMMAND_BRIDGE_URL}`;
  return `Connected via ${method}`;
}

function getConnectionDetail(method, connectionState, portSummary = "") {
  if (connectionState === CONNECTION_STATES.connecting) {
    if (isBluetoothMethod(method)) return "Opening Bluetooth serial port...";
    if (isUsbSerialMethod(method)) return "Opening USB serial port...";
    return `Connecting to ${method}...`;
  }

  if (connectionState === CONNECTION_STATES.error) {
    if (isBluetoothMethod(method)) return "Bluetooth connection error";
    if (isUsbSerialMethod(method)) return "USB Serial connection error";
    return `${method} connection error`;
  }

  if (connectionState === CONNECTION_STATES.connected) {
    return getConnectedDetail(method, portSummary);
  }

  return getDisconnectedDetail(method);
}

function getSerialPickerGuidance(method) {
  if (isBluetoothMethod(method)) {
    return "Select the HC-05 / SPP Bluetooth serial port. Do not select Arduino Uno USB.";
  }

  if (isUsbSerialMethod(method)) {
    return "Select the Arduino USB serial port. Do not select HC-05 / SPP Bluetooth.";
  }

  return "";
}

function getSerialCancelMessage(method) {
  if (isBluetoothMethod(method)) return "Bluetooth connection cancelled.";
  if (isUsbSerialMethod(method)) return "USB Serial connection cancelled.";
  return `${method} connection cancelled.`;
}

function getSerialOpenFailureMessage(method) {
  if (isBluetoothMethod(method)) return "Could not open Bluetooth serial port.";
  if (isUsbSerialMethod(method)) return "Could not open USB serial port.";
  return `Could not open ${method} port.`;
}

function getSerialNoPortMessage(method) {
  return `${method} is selected but no serial port is connected.`;
}

function getUnexpectedSerialDisconnectMessage(method) {
  if (isBluetoothMethod(method)) return "Bluetooth disconnected.";
  if (isUsbSerialMethod(method)) return "USB Serial disconnected.";
  return `${method} disconnected.`;
}

function getConnectionSuccessMessage(method) {
  if (isBluetoothMethod(method)) return "Bluetooth serial port connected.";
  if (isUsbSerialMethod(method)) return "USB serial port connected.";
  if (method === AUTONOMOUS_NETWORK_METHOD) return "Raspberry Pi command bridge connected.";
  return `${method} connected successfully.`;
}

function getSerialPortInfoSummary(method) {
  return getConnectedDetail(method);
}

function hasUsbPortInfo(portInfo = {}) {
  return Boolean(portInfo.usbVendorId || portInfo.usbProductId);
}

function hasBluetoothPortInfo(portInfo = {}) {
  return Boolean(portInfo.bluetoothServiceClassId);
}

function getWrongSerialPortMessage(method) {
  if (isBluetoothMethod(method)) {
    return "Wrong port selected. Please choose the HC-05 Bluetooth serial port.";
  }

  if (isUsbSerialMethod(method)) {
    return "Wrong port selected. Please choose the Arduino USB serial port.";
  }

  return "Wrong serial port selected.";
}

function confirmAmbiguousSerialPort(method) {
  if (isBluetoothMethod(method)) {
    return window.confirm(
      "Chrome cannot verify whether this is an HC-05 / SPP Bluetooth serial port. Continue only if you selected the HC-05 Bluetooth port."
    );
  }

  if (isUsbSerialMethod(method)) {
    return window.confirm(
      "Chrome cannot verify whether this is an Arduino USB serial port. Continue only if you selected the Arduino USB port."
    );
  }

  return true;
}

function validateSelectedSerialPort(method, portInfo = {}) {
  // Chrome exposes reliable USB IDs more often than Bluetooth SPP details, so this is best-effort validation.
  if (isBluetoothMethod(method)) {
    if (hasBluetoothPortInfo(portInfo)) return { isValid: true };

    if (hasUsbPortInfo(portInfo)) {
      return { isValid: false, message: getWrongSerialPortMessage(method) };
    }

    return { isValid: true };
  }

  if (isUsbSerialMethod(method)) {
    if (hasUsbPortInfo(portInfo)) return { isValid: true };

    if (hasBluetoothPortInfo(portInfo)) {
      return { isValid: false, message: getWrongSerialPortMessage(method) };
    }

    return {
      isValid: confirmAmbiguousSerialPort(method),
      message: getWrongSerialPortMessage(method),
    };
  }

  return { isValid: true };
}

function getSerialRequestOptions(method) {
  if (isUsbSerialMethod(method)) {
    return { filters: USB_SERIAL_PORT_FILTERS };
  }

  return undefined;
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function resetPlatformKeyboardState(pressedKeysRef, lastCommandRef, sendStop) {
  const hadMovement = pressedKeysRef.current.size > 0 || Boolean(lastCommandRef.current);
  pressedKeysRef.current.clear();
  lastCommandRef.current = "";

  if (hadMovement && sendStop) {
    sendStop();
  }
}

// Custom slider prevents track-click jumps and sends the command only on release.
function PrecisionCommitSlider({
  id,
  label,
  value,
  range,
  unit,
  displayValue,
  description,
  rangeLabels,
  onCommit,
  onPreview,
  className = "",
  disabled = false,
}) {
  const trackRef = useRef(null);
  const dragRef = useRef({ active: false, offset: 0, pointerId: null, value });
  const [isDragging, setIsDragging] = useState(false);
  const progress = ((value - range[0]) / (range[1] - range[0])) * 100;
  const sliderDisplayValue = displayValue ?? `${value}${unit}`;
  const sliderRangeLabels = rangeLabels ?? [`${range[0]}${unit}`, `${range[1]}${unit}`];

  function getValueFromPointer(clientX) {
    const track = trackRef.current;
    if (!track) return value;

    const rect = track.getBoundingClientRect();
    const pointerX = clientX - rect.left - dragRef.current.offset;
    const ratio = clamp(pointerX / rect.width, [0, 1]);
    return Math.round(range[0] + ratio * (range[1] - range[0]));
  }

  function handleThumbPointerDown(event) {
    if (disabled) return;

    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const thumbCenter = rect.left + (progress / 100) * rect.width;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      offset: event.clientX - thumbCenter,
      pointerId: event.pointerId,
      value,
    };
    setIsDragging(true);
  }

  function handleThumbPointerMove(event) {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) return;

    const nextValue = getValueFromPointer(event.clientX);
    if (nextValue !== dragRef.current.value) {
      dragRef.current.value = nextValue;
      onPreview(nextValue);
    }
  }

  function handleThumbPointerUp(event) {
    if (dragRef.current.pointerId !== event.pointerId) return;

    const finalValue = dragRef.current.value;
    dragRef.current = { active: false, offset: 0, pointerId: null, value: finalValue };
    setIsDragging(false);
    onCommit(finalValue);
  }

  function handleThumbPointerCancel(event) {
    if (dragRef.current.pointerId === event.pointerId) {
      dragRef.current = { active: false, offset: 0, pointerId: null, value };
      setIsDragging(false);
    }
  }

  return (
    <div className={`motor-slider-card ${className} ${disabled ? "disabled" : ""}`}>
      <div className="slider-header">
        <label id={`${id}-label`} htmlFor={`${id}-thumb`}>
          {label}
        </label>
        <strong>{sliderDisplayValue}</strong>
      </div>

      <div
        className={`precision-slider ${isDragging ? "dragging" : ""}`}
        ref={trackRef}
        style={{ "--slider-progress": `${progress}%` }}
      >
        <div className="slider-track" aria-hidden="true">
          <div className="slider-fill" />
        </div>
        <button
          aria-disabled={disabled}
          aria-labelledby={`${id}-label`}
          aria-valuemax={range[1]}
          aria-valuemin={range[0]}
          aria-valuenow={value}
          className="slider-thumb"
          disabled={disabled}
          id={`${id}-thumb`}
          onPointerCancel={handleThumbPointerCancel}
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={handleThumbPointerUp}
          role="slider"
          type="button"
        />
      </div>

      <div className="range-labels" aria-hidden="true">
        {sliderRangeLabels.map((rangeLabel) => (
          <span key={rangeLabel}>{rangeLabel}</span>
        ))}
      </div>
      {description && <p className="joint-description">{description}</p>}
    </div>
  );
}

function JointAngleSlider({ disabled, joint, value, onCommit, onPreview }) {
  return (
    <PrecisionCommitSlider
      description={joint.description}
      disabled={disabled}
      id={joint.key}
      label={joint.label}
      onCommit={onCommit}
      onPreview={onPreview}
      range={joint.range || MOTOR_ANGLE_LIMITS}
      unit=" deg"
      value={value}
    />
  );
}

// Three-position platform speed control; only the thumb can be dragged.
function PlatformSpeedSlider({ disabled, id, label, value, onCommit, onPreview }) {
  const trackRef = useRef(null);
  const dragRef = useRef({ active: false, offset: 0, pointerId: null, startValue: value, currentValue: value });
  const [isDragging, setIsDragging] = useState(false);
  const selectedLevel = getPlatformSpeedLevel(value);
  const selectedIndex = PLATFORM_SPEED_LEVELS.findIndex((level) => level.value === selectedLevel.value);
  const speedProgress = (selectedIndex / (PLATFORM_SPEED_LEVELS.length - 1)) * 100;

  function getSpeedFromPointer(clientX) {
    const track = trackRef.current;
    if (!track) return selectedLevel.value;

    const rect = track.getBoundingClientRect();
    const pointerX = clientX - rect.left - dragRef.current.offset;
    const ratio = clamp(pointerX / rect.width, [0, 1]);
    const levelIndex = Math.round(ratio * (PLATFORM_SPEED_LEVELS.length - 1));
    return PLATFORM_SPEED_LEVELS[levelIndex].value;
  }

  function previewSpeed(nextValue) {
    const speed = normalizePlatformSpeed(nextValue);
    if (dragRef.current.currentValue === speed) return;

    dragRef.current.currentValue = speed;
    onPreview(speed);
  }

  function commitSpeed(nextValue, previousValue) {
    const speed = normalizePlatformSpeed(nextValue);
    if (speed !== normalizePlatformSpeed(previousValue)) {
      onCommit(speed);
    }
  }

  function handlePointerDown(event) {
    if (disabled) return;

    const track = trackRef.current;
    if (!track) return;

    const startValue = normalizePlatformSpeed(value);
    const rect = track.getBoundingClientRect();
    const currentRatio = selectedIndex / (PLATFORM_SPEED_LEVELS.length - 1);
    const thumbCenter = rect.left + currentRatio * rect.width;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      offset: event.clientX - thumbCenter,
      pointerId: event.pointerId,
      startValue,
      currentValue: startValue,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event) {
    if (!dragRef.current.active || dragRef.current.pointerId !== event.pointerId) return;

    previewSpeed(getSpeedFromPointer(event.clientX));
  }

  function handlePointerUp(event) {
    if (dragRef.current.pointerId !== event.pointerId) return;

    const finalValue = dragRef.current.currentValue;
    const startValue = dragRef.current.startValue;
    dragRef.current = { active: false, offset: 0, pointerId: null, startValue: finalValue, currentValue: finalValue };
    setIsDragging(false);
    commitSpeed(finalValue, startValue);
  }

  function handlePointerCancel(event) {
    if (dragRef.current.pointerId !== event.pointerId) return;

    const startValue = dragRef.current.startValue;
    dragRef.current = { active: false, offset: 0, pointerId: null, startValue, currentValue: startValue };
    setIsDragging(false);
    onPreview(startValue);
  }

  function handleKeyDown(event) {
    if (disabled) return;

    const currentIndex = PLATFORM_SPEED_LEVELS.findIndex((level) => level.value === normalizePlatformSpeed(value));
    let nextIndex = currentIndex;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      nextIndex = Math.max(0, currentIndex - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      nextIndex = Math.min(PLATFORM_SPEED_LEVELS.length - 1, currentIndex + 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = PLATFORM_SPEED_LEVELS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextValue = PLATFORM_SPEED_LEVELS[nextIndex].value;
    if (nextValue === normalizePlatformSpeed(value)) return;

    onPreview(nextValue);
    onCommit(nextValue);
  }

  return (
    <div className={`motor-slider-card platform-speed-slider-card ${disabled ? "disabled" : ""}`}>
      <div className="slider-header">
        <label id={`${id}-label`} htmlFor={`${id}-thumb`}>
          {label}
        </label>
        <strong>{selectedLevel.label}</strong>
      </div>

      <div
        className={`platform-speed-selector ${isDragging ? "dragging" : ""}`}
        style={{ "--speed-progress": `${speedProgress}%` }}
      >
        <div className="platform-speed-rail" ref={trackRef}>
          <span className="platform-speed-track" aria-hidden="true">
            <span className="platform-speed-fill" />
          </span>
          <span className="platform-speed-stops" aria-hidden="true">
            {PLATFORM_SPEED_LEVELS.map((level) => (
              <span
                className={`platform-speed-stop ${level.value === selectedLevel.value ? "active" : ""}`}
                key={level.value}
              />
            ))}
          </span>
          <button
            aria-disabled={disabled}
            aria-labelledby={`${id}-label`}
            aria-valuemax={PLATFORM_SPEED_LEVELS.length - 1}
            aria-valuemin={0}
            aria-valuenow={selectedIndex}
            aria-valuetext={selectedLevel.label}
            className="platform-speed-thumb"
            disabled={disabled}
            id={`${id}-thumb`}
            onKeyDown={handleKeyDown}
            onPointerCancel={handlePointerCancel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            role="slider"
            type="button"
          />
        </div>
      </div>

      <div className="range-labels platform-speed-labels" aria-hidden="true">
        {PLATFORM_SPEED_LEVELS.map((level) => (
          <span className={level.value === selectedLevel.value ? "active" : ""} key={level.value}>
            {level.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SuctionCupToggle({ disabled, isActive, onToggle }) {
  return (
    <button
      aria-checked={isActive}
      aria-disabled={disabled}
      className={`suction-toggle ${isActive ? "on" : "off"}`}
      disabled={disabled}
      onClick={() => onToggle(!isActive)}
      role="switch"
      type="button"
    >
      <span className="suction-toggle-track">
        <span className="suction-toggle-knob" />
      </span>
      <span className="suction-toggle-copy">
        <strong>Pneumatic Suction Cup: {isActive ? "ON" : "OFF"}</strong>
        <small>{isActive ? "Vacuum engaged" : "Vacuum released"}</small>
      </span>
    </button>
  );
}

function WelcomeScreen({ onSelectMethod }) {
  return (
    <main className="welcome-shell">
      <div className="welcome-flow">
        <ScrollRevealSection
          ariaLabel="Robotic arm controller introduction"
          className="welcome-hero-section"
        >
          <div className="welcome-hero-copy">
            <div className="title-block welcome-title">
              <h1>{SITE_TITLE}</h1>
            </div>
            <p className="welcome-message">
              Welcome. Scroll through the project overview, then select a communication method to open the robot
              control dashboard.
            </p>
          </div>
          <div className="welcome-robot-visual">
            <img src={ROBOT_IMAGE_SRC} alt="Pick and place robotic arm" />
          </div>
        </ScrollRevealSection>

        <ScrollRevealSection className="welcome-section course-section">
          <CourseCard />
        </ScrollRevealSection>

        <ScrollRevealSection className="welcome-section team-section">
          <TeamCard />
        </ScrollRevealSection>

        <ScrollRevealSection className="welcome-section connection-section">
          <div className="welcome-connect-card">
            <h2>How would you like to connect to the robot?</h2>
            <div className="welcome-options">
              {COMMUNICATION_METHODS.map((method) => (
                <button
                  className="connection-choice"
                  key={method}
                  onClick={() => onSelectMethod(method)}
                  type="button"
                >
                  <span>{method}</span>
                  <span className="connection-tooltip" role="tooltip">
                    {CONNECTION_TOOLTIPS[method]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </ScrollRevealSection>
      </div>
    </main>
  );
}

function ScrollRevealSection({ ariaLabel, children, className = "" }) {
  const sectionRef = useRef(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;

    if (!("IntersectionObserver" in window)) {
      setIsActive(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsActive(entry.isIntersecting && entry.intersectionRatio >= 0.34);
      },
      { rootMargin: "-12% 0px -12% 0px", threshold: [0, 0.18, 0.34, 0.5, 0.72] }
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      aria-label={ariaLabel}
      ref={sectionRef}
      className={`scroll-reveal ${isActive ? "visible" : ""} ${className}`}
    >
      {children}
    </section>
  );
}

function CourseCard() {
  return (
    <div className="course-card" aria-label="Course information">
      <h2>Course</h2>
      <div className="course-grid course-layout">
        <div className="course-detail instructor-detail">
          <span>Instructor</span>
          <strong>{COURSE_INFO.instructor}</strong>
        </div>
        <div className="course-detail course-name-detail">
          <span>Course</span>
          <strong>{COURSE_INFO.course}</strong>
        </div>
        <div className="course-detail course-code-detail">
          <span>Course Code</span>
          <strong>{COURSE_INFO.code}</strong>
        </div>
      </div>
    </div>
  );
}

function TeamCard() {
  return (
    <div className="team-card" aria-label="Project team members">
      <h2>Team</h2>
      <div className="team-grid">
        {TEAM_MEMBERS.map((member) => (
          <div className="team-member" key={member.id}>
            <strong>{member.name}</strong>
            <span>{member.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardHeader({ connectionLabel, isEmergencyActive, statusTone, onReturnHome }) {
  return (
    <section className="dashboard-header">
      <button className="header-home-button" onClick={onReturnHome} type="button">
        Welcome Page
      </button>
      <div className="title-block">
        <h1>{SITE_TITLE}</h1>
      </div>
      <div className={`system-pill ${statusTone}`}>
        <span className="status-dot" />
        {isEmergencyActive ? "Emergency Active" : connectionLabel}
      </div>
    </section>
  );
}

function EmergencyLockNotice({ isVisible }) {
  if (!isVisible) return null;

  return (
    <div className="emergency-lock-notice" role="alert">
      Emergency Stop active. Controls are locked until the system is in Safe Mode again.
    </div>
  );
}

function RobotOperationCenter({
  armMode,
  communicationMethod,
  connectionDetail,
  connectionState,
  deviceFeedbackLog,
  deviceReply,
  isConnected,
  isArmOperationMode,
  isEmergencyActive,
  isOperationMode,
  modeConflictMessage,
  platformMode,
  showSafetyControls,
  onConnect,
  onDisconnect,
  onEmergencyToggle,
  onHome,
  onArmModeChange,
  onMethodChange,
  onPlatformModeChange,
}) {
  const hasHomeCard = isArmOperationMode;
  const operationLayoutClassName = [
    "operation-layout",
    !isOperationMode && !isEmergencyActive ? "mode-selection-layout" : "",
    !hasHomeCard ? "full-width-operation" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={`panel operation-center ${isEmergencyActive ? "emergency-active" : ""}`}>
      <div className="panel-heading">
        <h2>Robot Operation Center</h2>
      </div>

      <div className={operationLayoutClassName}>
        <div className="operation-left-stack">
          <ConnectionControls
            communicationMethod={communicationMethod}
            connectionDetail={connectionDetail}
            connectionState={connectionState}
            deviceFeedbackLog={deviceFeedbackLog}
            deviceReply={deviceReply}
            isConnected={isConnected}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
            onMethodChange={onMethodChange}
          />

          <SafetyAndModeControls
            armMode={armMode}
            isConnected={isConnected}
            isEmergencyActive={isEmergencyActive}
            modeConflictMessage={modeConflictMessage}
            platformMode={platformMode}
            showSafetyControls={showSafetyControls}
            onEmergencyToggle={onEmergencyToggle}
            onArmModeChange={onArmModeChange}
            onPlatformModeChange={onPlatformModeChange}
          />
        </div>

        <HomePositionCard
          disabled={isEmergencyActive}
          isVisible={isArmOperationMode}
          onHome={onHome}
        />
      </div>
    </article>
  );
}

function ConnectionControls({
  communicationMethod,
  connectionDetail,
  connectionState,
  deviceFeedbackLog,
  deviceReply,
  isConnected,
  onConnect,
  onDisconnect,
  onMethodChange,
}) {
  const isConnecting = connectionState === CONNECTION_STATES.connecting;
  const hasError = connectionState === CONNECTION_STATES.error;
  const connectLabel = isConnecting
    ? "Connecting..."
    : isConnected
      ? "Connected"
      : getConnectionGuide(communicationMethod).actionLabel;
  const disconnectLabel = isConnected ? "Disconnect" : hasError ? "Error" : "Disconnected";
  const connectClassName = [
    "control-button",
    "connection-slot",
    isConnected ? "state-connected" : "",
    isConnecting ? "state-connecting" : "",
    !isConnected && !isConnecting ? "secondary" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const disconnectClassName = [
    "control-button",
    "connection-slot",
    !isConnected && !hasError ? "state-disconnected" : "",
    hasError ? "state-error" : "",
    isConnected ? "secondary" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className="operation-card connection-controls">
      <h3>Connection</h3>
      <div className="method-status-grid">
        <div className="selected-method">
          <span>Selected Method</span>
          <strong>{communicationMethod}</strong>
        </div>
        <div className="selected-method">
          <span>Connection Status</span>
          <strong>{connectionDetail}</strong>
        </div>
      </div>

      <label className="field-label" htmlFor="communication-method">
        Change Connection Method
      </label>
      <ConnectionMethodDropdown
        id="communication-method"
        options={COMMUNICATION_METHODS}
        value={communicationMethod}
        onChange={onMethodChange}
      />

      <div className="button-row connection-action-row">
        <button
          aria-disabled={isConnected || isConnecting}
          className={connectClassName}
          disabled={isConnected || isConnecting}
          onClick={isConnected || isConnecting ? undefined : onConnect}
          type="button"
        >
          {connectLabel}
        </button>
        <button
          aria-disabled={!isConnected}
          className={disconnectClassName}
          disabled={!isConnected}
          onClick={isConnected ? onDisconnect : undefined}
          type="button"
        >
          {disconnectLabel}
        </button>
      </div>

      <DeviceFeedbackPanel feedbackLog={deviceFeedbackLog} latestReply={deviceReply} />
    </section>
  );
}

function DeviceFeedbackPanel({ feedbackLog, latestReply }) {
  return (
    <div className="device-feedback">
      <div className="device-feedback-heading">
        <span>Device Feedback</span>
        <strong>{latestReply || "No reply yet"}</strong>
      </div>
      {feedbackLog.length > 0 ? (
        <div className="device-feedback-log" aria-label="Recent Arduino replies">
          {feedbackLog.map((entry) => (
            <div className="device-feedback-entry" key={entry.id}>
              <span>{entry.message}</span>
              <small>{entry.timestamp}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="device-feedback-empty">Arduino replies will appear here after connection.</p>
      )}
    </div>
  );
}

function ConnectionMethodDropdown({ id, options, value, onChange }) {
  const dropdownRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(Math.max(0, options.indexOf(value)));
  const selectedIndex = Math.max(0, options.indexOf(value));
  const highlightedMethod = options[highlightedIndex] || options[selectedIndex];
  const menuId = `${id}-menu`;

  function selectMethod(method) {
    onChange({ target: { value: method } });
    setHighlightedIndex(Math.max(0, options.indexOf(method)));
    setIsOpen(false);
  }

  function openMenu() {
    setHighlightedIndex(selectedIndex);
    setIsOpen(true);
  }

  function moveHighlight(direction) {
    setIsOpen(true);
    setHighlightedIndex((currentIndex) => {
      const nextIndex = (currentIndex + direction + options.length) % options.length;
      return nextIndex;
    });
  }

  function handleTriggerKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (isOpen) {
        selectMethod(highlightedMethod);
      } else {
        openMenu();
      }
    }

    if (event.key === "Escape") {
      setIsOpen(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (!dropdownRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div className={`custom-select ${isOpen ? "open" : ""}`} ref={dropdownRef}>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="custom-select-trigger"
        id={id}
        onClick={() => (isOpen ? setIsOpen(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        type="button"
      >
        <span>{value}</span>
        <span className="custom-select-arrow" aria-hidden="true" />
      </button>

      {isOpen && (
        <div className="custom-select-menu" id={menuId} role="listbox" aria-labelledby={id}>
          {options.map((method, index) => (
            <button
              aria-selected={value === method}
              className={`custom-select-option ${value === method ? "selected" : ""} ${
                highlightedIndex === index ? "highlighted" : ""
              }`}
              key={method}
              onClick={() => selectMethod(method)}
              onMouseEnter={() => setHighlightedIndex(index)}
              role="option"
              type="button"
            >
              <span>{method}</span>
              {value === method && <strong>Selected</strong>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SafetyAndModeControls({
  armMode,
  isConnected,
  isEmergencyActive,
  modeConflictMessage,
  platformMode,
  showSafetyControls,
  onEmergencyToggle,
  onArmModeChange,
  onPlatformModeChange,
}) {
  return (
    <section className={`operation-card safety-motion-card ${!showSafetyControls ? "mode-only-card" : ""}`}>
      {showSafetyControls && (
        <div className="safety-switch-wrap mode-panel-enter">
          <h3>Safety</h3>
          <EmergencySwitch isActive={isEmergencyActive} onToggle={onEmergencyToggle} />
        </div>
      )}

      <div className={`mode-control-column ${!showSafetyControls ? "mode-control-standalone" : ""}`}>
        <ModeSelector
          isConnected={isConnected}
          label="Arm Mode"
          selectedMode={armMode}
          onModeChange={onArmModeChange}
        />
        <ModeSelector
          isConnected={isConnected}
          label="Platform Mode"
          selectedMode={platformMode}
          onModeChange={onPlatformModeChange}
        />
        {modeConflictMessage && (
          <p className="mode-conflict-warning" role="alert">
            {modeConflictMessage}
          </p>
        )}
      </div>
    </section>
  );
}

// Emergency Stop remains available so the user can reset the locked state.
function EmergencySwitch({ isActive, onToggle }) {
  return (
    <button
      aria-checked={isActive}
      className={`emergency-switch ${isActive ? "active" : ""}`}
      onClick={onToggle}
      role="switch"
      type="button"
    >
      <span className="emergency-switch-track">
        <span className="emergency-switch-knob" />
      </span>
      <span className="emergency-switch-copy">
        <strong>{isActive ? "Emergency Stop Active" : "Normal / Safe"}</strong>
        <small>{isActive ? "Return switch to reset" : "Toggle to halt robot motion"}</small>
      </span>
    </button>
  );
}

function ModeSelector({ isConnected, label, selectedMode, onModeChange }) {
  return (
    <div className="mode-selector-group">
      <h3>{label}</h3>
      <div className={`mode-selector mode-${selectedMode.toLowerCase()}`} role="tablist" aria-label={`${label} selector`}>
        <span className="mode-selector-indicator" aria-hidden="true" />
        {MODE_OPTIONS.map((mode) => {
          // Locked options still call the handler so the user sees the connection warning.
          const isModeLocked = !isConnected && mode !== "Off";

          return (
            <button
              aria-disabled={isModeLocked || undefined}
              aria-selected={selectedMode === mode}
              className={`mode-option ${selectedMode === mode ? "active" : ""}`}
              key={mode}
              onClick={() => onModeChange(mode)}
              role="tab"
              tabIndex={isModeLocked ? -1 : 0}
              type="button"
            >
              {mode}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HomePositionCard({ disabled, isVisible, onHome }) {
  if (!isVisible) return null;

  return (
    <section className="operation-card home-position-card mode-panel-enter">
      <h3>Arm Home Position</h3>
      <button className="control-button home-button" disabled={disabled} onClick={onHome} type="button">
        {HOME_CONTROL.label}
      </button>
    </section>
  );
}

// Manual arm controls update values while dragging, then send commands on release.
function MotorControls({
  animationDelay = 0,
  armPosition,
  isEmergencyActive,
  isNormalGripper,
  selectedGrippingTool,
  suctionCupActive,
  onGrippingToolChange,
  onJointCommit,
  onJointPreview,
  onNormalGripperCommit,
  onNormalGripperPreview,
  onSuctionCupCommand,
}) {
  return (
    <article className="panel manual-panel mode-panel-enter" style={{ "--panel-delay": `${animationDelay}ms` }}>
      <div className="panel-heading">
        <h2>Motor Controls</h2>
        <span className="panel-subtitle">Robotic arm joint angles</span>
      </div>

      <div className="slider-grid">
        {JOINT_SLIDERS.map((joint) => (
          <JointAngleSlider
            disabled={isEmergencyActive}
            joint={joint}
            key={joint.key}
            onCommit={(angle) => onJointCommit(joint, angle)}
            onPreview={(angle) => onJointPreview(joint, angle)}
            value={armPosition[joint.key]}
          />
        ))}
      </div>

      <EndEffectorControl
        armPosition={armPosition}
        isEmergencyActive={isEmergencyActive}
        isNormalGripper={isNormalGripper}
        selectedGrippingTool={selectedGrippingTool}
        suctionCupActive={suctionCupActive}
        onGrippingToolChange={onGrippingToolChange}
        onNormalGripperCommit={onNormalGripperCommit}
        onNormalGripperPreview={onNormalGripperPreview}
        onSuctionCupCommand={onSuctionCupCommand}
      />
    </article>
  );
}

// Gripper tool selection swaps between servo gripper angle and suction control.
function EndEffectorControl({
  armPosition,
  isEmergencyActive,
  isNormalGripper,
  selectedGrippingTool,
  suctionCupActive,
  onGrippingToolChange,
  onNormalGripperCommit,
  onNormalGripperPreview,
  onSuctionCupCommand,
}) {
  const gripperStatus = isNormalGripper
    ? `Normal Gripper Angle - ${armPosition.normalGripperAngle} deg`
    : `Pneumatic Suction Cup - ${suctionCupActive ? "ON" : "OFF"}`;

  function handleNormalGripperQuickAction(angle) {
    if (isEmergencyActive) return;

    onNormalGripperPreview(angle);
    onNormalGripperCommit(angle);
  }

  return (
    <div className="gripper-section">
      <div className="gripper-heading">
        <h3>End-Effector Control</h3>
        <span>{gripperStatus}</span>
      </div>

      <ToolSelector
        disabled={isEmergencyActive}
        selectedGrippingTool={selectedGrippingTool}
        onChange={onGrippingToolChange}
      />

      <div className="tool-control-switcher mode-panel-enter" key={selectedGrippingTool}>
        {isNormalGripper ? (
          <div className="normal-gripper-control">
            <PrecisionCommitSlider
              className="normal-gripper-slider-card"
              description="0 deg is fully closed. 180 deg is fully open. Command is sent only when the slider is released."
              disabled={isEmergencyActive}
              id="normalGripperAngle"
              label="Normal Gripper Angle"
              onCommit={onNormalGripperCommit}
              onPreview={onNormalGripperPreview}
              range={NORMAL_GRIPPER_LIMITS}
              unit=" deg"
              value={armPosition.normalGripperAngle}
            />
            <div className="normal-gripper-actions" aria-label="Normal gripper quick actions">
              {NORMAL_GRIPPER_QUICK_ACTIONS.map((action) => (
                <button
                  aria-label={`Set normal gripper angle to ${action.value} degrees (${action.label})`}
                  className={`control-button normal-gripper-action ${
                    armPosition.normalGripperAngle === action.value ? "active" : ""
                  }`}
                  disabled={isEmergencyActive}
                  key={action.value}
                  onClick={() => handleNormalGripperQuickAction(action.value)}
                  type="button"
                >
                  <span>{action.label}</span>
                  <strong>{action.value} deg</strong>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <SuctionCupToggle
            disabled={isEmergencyActive}
            isActive={suctionCupActive}
            onToggle={onSuctionCupCommand}
          />
        )}
      </div>
    </div>
  );
}

function ToolSelector({ disabled, selectedGrippingTool, onChange }) {
  return (
    <div className="tool-section">
      <div className="tool-section-heading">
        <h3>Gripping Tool</h3>
        <span>Selected: {getGrippingToolLabel(selectedGrippingTool)}</span>
      </div>
      <div className="tool-options" role="radiogroup" aria-label="Gripping tool selection">
        {GRIPPING_TOOLS.map((tool) => (
          <button
            aria-checked={selectedGrippingTool === tool.value}
            className={`tool-option ${selectedGrippingTool === tool.value ? "active" : ""}`}
            disabled={disabled}
            key={tool.value}
            onClick={() => onChange(tool.value)}
            role="radio"
            type="button"
          >
            {tool.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function getCameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Camera permission was denied. Allow camera access in the browser to use the preview.";
  }

  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No camera was found. Make sure the phone webcam app is running and connected.";
  }

  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return "The selected camera cannot start. It may already be used by another app.";
  }

  if (error?.name === "OverconstrainedError" || error?.name === "ConstraintNotSatisfiedError") {
    return "The selected camera is unavailable. Choose another camera source and try again.";
  }

  return "Camera could not start. Check the phone webcam app and browser permissions.";
}

function VisionStatusPanel({ animationDelay = 0, autoStartPiStream = false, preferredSource = "browser" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraSource, setCameraSource] = useState(preferredSource);
  const [cameraDevices, setCameraDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [urlStreamUrl, setUrlStreamUrl] = useState("");
  const [raspberryPiRawStreamUrl, setRaspberryPiRawStreamUrl] = useState(DEFAULT_RASPBERRY_PI_STREAM_URL);
  const [raspberryPiModelStreamUrl, setRaspberryPiModelStreamUrl] = useState(DEFAULT_RASPBERRY_PI_MODEL_STREAM_URL);
  const [activeRaspberryPiStreamUrl, setActiveRaspberryPiStreamUrl] = useState("");
  const [isPiStreamActive, setIsPiStreamActive] = useState(false);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");

  function stopCurrentCameraStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  function stopRaspberryPiStream() {
    setActiveRaspberryPiStreamUrl("");
    setIsPiStreamActive(false);
  }

  function stopAllCameraSources() {
    stopCurrentCameraStream();
    stopRaspberryPiStream();
    setIsCameraActive(false);
    setIsCameraLoading(false);
  }

  function cleanupCameraSources() {
    stopCurrentCameraStream();
  }

  async function refreshCameraDevices(showEmptyMessage = false) {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setCameraMessage("Camera device listing is not supported in this browser.");
      return [];
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter((device) => device.kind === "videoinput");
      setCameraDevices(videoDevices);

      setSelectedCameraId((currentId) => {
        if (currentId && videoDevices.some((device) => device.deviceId === currentId)) {
          return currentId;
        }

        return videoDevices[0]?.deviceId || "";
      });

      if (showEmptyMessage && videoDevices.length === 0) {
        setCameraMessage("No camera found. Start your phone webcam app, then try again.");
      }

      return videoDevices;
    } catch (error) {
      console.error("Camera device listing failed:", error);
      setCameraMessage("Could not list camera devices. Check browser camera permissions.");
      return [];
    }
  }

  async function startCamera(cameraId = selectedCameraId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage("Camera preview is not supported in this browser.");
      return;
    }

    setIsCameraLoading(true);
    setCameraMessage("");

    try {
      stopCurrentCameraStream();
      stopRaspberryPiStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      setIsCameraActive(true);
      const activeDeviceId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
      await refreshCameraDevices();

      if (activeDeviceId) {
        setSelectedCameraId(activeDeviceId);
      }
    } catch (error) {
      console.error("Camera start failed:", error);
      stopCurrentCameraStream();
      setIsCameraActive(false);
      setCameraMessage(getCameraErrorMessage(error));
      await refreshCameraDevices(true);
    } finally {
      setIsCameraLoading(false);
    }
  }

  function stopCamera() {
    stopCurrentCameraStream();
    setIsCameraActive(false);
    setIsCameraLoading(false);
    setCameraMessage("");
  }

  function getSelectedPiStreamConfig() {
    if (cameraSource === "urlStream") {
      return {
        activeStatus: "URL Stream Active",
        defaultUrl: "http://example.local:8080/video",
        errorMessage: "Could not load URL stream. Check the address and make sure the stream allows browser access.",
        inputId: "url-stream-url",
        inputLabel: "Stream URL",
        isModelStream: false,
        isUrlStream: true,
        note: "URL streaming can preview any browser-accessible MJPEG/image stream.",
        statusOff: "URL Stream Off",
        url: urlStreamUrl,
        setUrl: setUrlStreamUrl,
      };
    }

    const isModelStream = cameraSource === "raspberryPiModel";

    return {
      activeStatus: isModelStream ? "Model Stream Active" : "Raw Stream Active",
      defaultUrl: isModelStream ? DEFAULT_RASPBERRY_PI_MODEL_STREAM_URL : DEFAULT_RASPBERRY_PI_STREAM_URL,
      errorMessage: isModelStream
        ? "Could not load model stream. Make sure the Raspberry Pi model server is running."
        : "Could not load Raspberry Pi stream. Check that the Pi is on the same Wi-Fi and the stream server is running.",
      inputId: isModelStream ? "pi-model-stream-url" : "pi-raw-stream-url",
      inputLabel: isModelStream ? "Model Stream URL" : "Raw Stream URL",
      isModelStream,
      isUrlStream: false,
      note: "Pi camera stream is used by the laptop YOLO sender for autonomous ball tracking.",
      statusOff: isModelStream ? "Model Stream Off" : "Raw Stream Off",
      url: isModelStream ? raspberryPiModelStreamUrl : raspberryPiRawStreamUrl,
      setUrl: isModelStream ? setRaspberryPiModelStreamUrl : setRaspberryPiRawStreamUrl,
    };
  }

  function startRaspberryPiStream() {
    const streamConfig = getSelectedPiStreamConfig();
    const nextStreamUrl = streamConfig.url.trim();

    if (!nextStreamUrl) {
      setCameraMessage(
        streamConfig.isUrlStream
          ? "Enter a stream URL before starting URL streaming."
          : "Enter the Raspberry Pi stream URL before starting the stream."
      );
      return;
    }

    stopCurrentCameraStream();
    setIsCameraActive(false);
    setIsCameraLoading(false);
    setCameraMessage("");
    setActiveRaspberryPiStreamUrl(nextStreamUrl);
    setIsPiStreamActive(true);
  }

  function stopPiStream() {
    stopRaspberryPiStream();
    setCameraMessage("");
  }

  function handlePiStreamError() {
    if (!isPiStreamActive) return;

    stopRaspberryPiStream();
    setCameraMessage(getSelectedPiStreamConfig().errorMessage);
  }

  function handleCameraSourceChange(event) {
    const nextSource = event.target.value;
    setCameraSource(nextSource);
    stopAllCameraSources();
    setCameraMessage("");

    if (nextSource === "browser") {
      void refreshCameraDevices(true);
    }
  }

  async function handleCameraDeviceChange(event) {
    const nextCameraId = event.target.value;
    setSelectedCameraId(nextCameraId);

    if (isCameraActive) {
      await startCamera(nextCameraId);
    }
  }

  useEffect(() => {
    refreshCameraDevices();
    return () => cleanupCameraSources();
  }, []);

  useEffect(() => {
    if (preferredSource === cameraSource) return;

    stopAllCameraSources();
    setCameraMessage("");
    setCameraSource(preferredSource);
  }, [preferredSource]);

  useEffect(() => {
    if (!autoStartPiStream || !["raspberryPiRaw", "raspberryPiModel"].includes(cameraSource) || isPiStreamActive) return;

    // Autonomous mode previews the Pi stream that the laptop YOLO sender consumes.
    setActiveRaspberryPiStreamUrl(getSelectedPiStreamConfig().url.trim() || DEFAULT_RASPBERRY_PI_STREAM_URL);
    setIsPiStreamActive(true);
  }, [autoStartPiStream, cameraSource, isPiStreamActive]);

  const isPiSource = cameraSource === "raspberryPiRaw" || cameraSource === "raspberryPiModel";
  const isUrlStreamSource = cameraSource === "urlStream";
  const isImageStreamSource = isPiSource || isUrlStreamSource;
  const selectedPiStreamConfig = getSelectedPiStreamConfig();
  const isPreviewActive = isCameraActive || isPiStreamActive;
  const cameraStatus = isPiStreamActive
    ? selectedPiStreamConfig.activeStatus
    : isImageStreamSource
      ? selectedPiStreamConfig.statusOff
      : isCameraActive
        ? "Camera Active"
        : "Camera Off";

  return (
    <article className="panel vision-panel mode-panel-enter" style={{ "--panel-delay": `${animationDelay}ms` }}>
      <div className="panel-heading">
        <h2>Camera / YOLOv8 Status</h2>
        <span className={`panel-subtitle camera-status ${isPreviewActive ? "active" : ""}`}>
          {isCameraLoading ? "Starting Camera" : cameraStatus}
        </span>
      </div>
      <div className="camera-panel-body">
        <div className="camera-control-grid">
          <label className="field-label" htmlFor="camera-source">
            Camera Input
          </label>
          <select
            disabled={isCameraLoading}
            id="camera-source"
            onChange={handleCameraSourceChange}
            value={cameraSource}
          >
            {CAMERA_SOURCE_OPTIONS.map((source) => (
              <option key={source.value} value={source.value}>
                {source.label}
              </option>
            ))}
          </select>
        </div>

        {cameraSource === "browser" ? (
          <>
            <div className="camera-control-grid">
              <label className="field-label" htmlFor="camera-device">
                Device
              </label>
              <select
                disabled={isCameraLoading}
                id="camera-device"
                onChange={handleCameraDeviceChange}
                value={selectedCameraId}
              >
                {cameraDevices.length === 0 ? (
                  <option value="">No camera devices found</option>
                ) : (
                  cameraDevices.map((device, index) => (
                    <option key={device.deviceId || `camera-${index}`} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="camera-button-row">
              <button
                className="control-button camera-start-button"
                disabled={isCameraActive || isCameraLoading}
                onClick={() => startCamera()}
                type="button"
              >
                {isCameraLoading ? "Starting..." : "Start Camera"}
              </button>
              <button
                className="control-button secondary"
                disabled={!isCameraActive}
                onClick={stopCamera}
                type="button"
              >
                Stop Camera
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="camera-control-grid">
              <label className="field-label" htmlFor={selectedPiStreamConfig.inputId}>
                {selectedPiStreamConfig.inputLabel}
              </label>
              <input
                className="camera-url-input"
                id={selectedPiStreamConfig.inputId}
                onChange={(event) => selectedPiStreamConfig.setUrl(event.target.value)}
                placeholder={selectedPiStreamConfig.defaultUrl}
                type="url"
                value={selectedPiStreamConfig.url}
              />
            </div>

            <div className="camera-button-row">
              <button
                className="control-button camera-start-button"
                disabled={isPiStreamActive}
                onClick={startRaspberryPiStream}
                type="button"
              >
                Start Stream
              </button>
              <button
                className="control-button secondary"
                disabled={!isPiStreamActive}
                onClick={stopPiStream}
                type="button"
              >
                Stop Stream
              </button>
            </div>
          </>
        )}

        <div className={`camera-preview ${isPreviewActive ? "active" : ""}`}>
          {cameraSource === "browser" && (
            <video
              aria-label="Live camera preview"
              autoPlay
              className="camera-video"
              muted
              playsInline
              ref={videoRef}
            />
          )}
          {isImageStreamSource && isPiStreamActive && (
            <img
              alt={
                selectedPiStreamConfig.isUrlStream
                  ? "URL stream preview"
                  : selectedPiStreamConfig.isModelStream
                    ? "Raspberry Pi model output stream"
                    : "Raspberry Pi raw camera stream"
              }
              className="camera-video camera-stream-image"
              onError={handlePiStreamError}
              onLoad={() => setCameraMessage("")}
              src={activeRaspberryPiStreamUrl}
            />
          )}
          {!isPreviewActive && <div className="camera-empty-preview">Camera preview will appear here.</div>}
        </div>

        {cameraMessage && (
          <p className="camera-message" role="alert">
            {cameraMessage}
          </p>
        )}

        <p className="camera-note">{selectedPiStreamConfig.note}</p>
      </div>
    </article>
  );
}

function AutomaticControlsPanel({
  animationDelay = 0,
  autoError,
  automaticModeActive,
  automaticStatus,
  autoPaused,
  autoStep,
  detectionConfidence,
  detectedObject,
  disabled,
  selectedTargetObject,
  onControl,
}) {
  const confidenceText = detectionConfidence === null ? "Not available yet" : `${Math.round(detectionConfidence * 100)}%`;
  const controlState = autoError || (autoPaused ? "Paused" : automaticModeActive ? "Running" : automaticStatus);
  const receiverState = automaticModeActive ? "Pi receiver listening" : "Ready";

  return (
    <article className="panel automatic-action-panel mode-panel-enter" style={{ "--panel-delay": `${animationDelay}ms` }}>
      <div className="panel-heading">
        <h2>Automatic Mode Status</h2>
        <span className={`panel-subtitle auto-state-${automaticStatus.toLowerCase()}`}>{automaticStatus}</span>
      </div>

      <div className="automatic-status-grid">
        <StatusLine label="Automatic Mode" value={automaticStatus} />
        <StatusLine label="Pi Receiver" value={`${receiverState} (${PI_RECEIVER_ADDRESS})`} />
        <StatusLine label="Command Bridge" value={PI_COMMAND_BRIDGE_URL} />
        <StatusLine label="Camera Stream" value={DEFAULT_RASPBERRY_PI_STREAM_URL} />
        <StatusLine label="Target Object" value={selectedTargetObject || AUTONOMOUS_TARGET_OBJECT} />
        <StatusLine label="Target Distance" value={`${AUTONOMOUS_TARGET_DISTANCE_CM} cm`} />
        <StatusLine label="Detected Object" value={detectedObject || "Not available yet"} />
        <StatusLine label="Confidence" value={confidenceText} />
        <StatusLine label="Current Step" value={autoStep || "Waiting"} />
        <StatusLine label="Auto Control" value={controlState} />
      </div>

      <div className="automatic-button-row">
        {AUTOMATIC_CONTROLS.map((control) => (
          <button
            className={`control-button auto-state-button ${
              control.activeWhen === automaticStatus ? `active-${control.state.toLowerCase()}` : ""
            }`}
            disabled={disabled}
            key={control.command}
            onClick={() => onControl(control.command, control.state)}
            type="button"
          >
            {control.label}
          </button>
        ))}
      </div>

      <div className="automatic-workflow-note">
        Start the Pi receiver for website commands. Start the laptop YOLO sender when autonomous tracking should control the platform.
      </div>
    </article>
  );
}

function StatusLine({ label, value }) {
  return (
    <div className="automatic-status-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// Manual platform panel supports mouse WASD buttons and keyboard movement.
function PlatformManualPanel({
  activeCommand,
  animationDelay = 0,
  disabled,
  onPlatformCommand,
  onPointerState,
}) {
  const isPlatformIdle = !activeCommand || activeCommand === PLATFORM_STOP_CONTROL.command;
  const stopPlatform = () => {
    onPointerState("");
    onPlatformCommand(PLATFORM_STOP_CONTROL.command);
  };

  const renderMovementButton = (control) => (
    <button
      className={`control-button platform-control-button ${control.className} ${
        activeCommand === control.command || isPlatformButtonActive(activeCommand, control.key) ? "active" : ""
      }`}
      disabled={disabled}
      key={control.command}
      onBlur={stopPlatform}
      onPointerCancel={stopPlatform}
      onPointerDown={() => {
        onPointerState(control.command);
        onPlatformCommand(control.command);
      }}
      onPointerLeave={stopPlatform}
      onPointerUp={stopPlatform}
      type="button"
    >
      <strong>{control.letter}</strong>
      <span>{control.label}</span>
    </button>
  );

  return (
    <article className="panel platform-panel mode-panel-enter" style={{ "--panel-delay": `${animationDelay}ms` }}>
      <div className="panel-heading">
        <h2>Platform Manual Control</h2>
        <span className="panel-subtitle">WASD mobile base movement</span>
      </div>
      <div className="platform-wasd-pad" aria-label="Manual platform WASD controls">
        {PLATFORM_CONTROLS.map(renderMovementButton)}
      </div>
      <button
        className={`control-button platform-stop-button ${isPlatformIdle ? "idle" : ""}`}
        disabled={disabled}
        onClick={() => onPlatformCommand(PLATFORM_STOP_CONTROL.command)}
        onPointerCancel={stopPlatform}
        onPointerDown={() => onPointerState(PLATFORM_STOP_CONTROL.command)}
        onPointerLeave={stopPlatform}
        onPointerUp={stopPlatform}
        type="button"
      >
        <strong>{PLATFORM_STOP_CONTROL.letter}</strong>
        <span>{PLATFORM_STOP_CONTROL.label}</span>
      </button>
      <button
        className="control-button platform-stop-button"
        disabled={disabled}
        onClick={() => onPlatformCommand(PLATFORM_MOTOR_TEST_CONTROL.command)}
        type="button"
      >
        <strong>{PLATFORM_MOTOR_TEST_CONTROL.letter}</strong>
        <span>{PLATFORM_MOTOR_TEST_CONTROL.label}</span>
      </button>
      <div className="platform-key-hint" aria-hidden="true">
        Keyboard enabled in Manual Platform Mode: W / A / S / D and Spacebar
      </div>
    </article>
  );
}

function PlatformSpeedPanel({
  animationDelay = 0,
  disabled,
  platformMotorSpeeds,
  platformSharedSpeed,
  useSamePlatformSpeed,
  onPlatformSpeedCommit,
  onPlatformSpeedPreview,
  onPlatformSharedSpeedCommit,
  onPlatformSharedSpeedPreview,
  onPlatformSpeedModeChange,
}) {
  return (
    <article className="panel platform-speed-panel mode-panel-enter" style={{ "--panel-delay": `${animationDelay}ms` }}>
      <div className="panel-heading">
        <h2>Platform Motor Speed</h2>
        <span className="panel-subtitle">Slow / Medium / Fast</span>
      </div>
      <PlatformSpeedControls
        disabled={disabled}
        platformMotorSpeeds={platformMotorSpeeds}
        platformSharedSpeed={platformSharedSpeed}
        useSamePlatformSpeed={useSamePlatformSpeed}
        onPlatformSpeedCommit={onPlatformSpeedCommit}
        onPlatformSpeedPreview={onPlatformSpeedPreview}
        onPlatformSharedSpeedCommit={onPlatformSharedSpeedCommit}
        onPlatformSharedSpeedPreview={onPlatformSharedSpeedPreview}
        onPlatformSpeedModeChange={onPlatformSpeedModeChange}
      />
    </article>
  );
}

// Platform motor speed can be controlled independently or linked together.
function PlatformSpeedControls({
  disabled,
  platformMotorSpeeds,
  platformSharedSpeed,
  useSamePlatformSpeed,
  onPlatformSpeedCommit,
  onPlatformSpeedPreview,
  onPlatformSharedSpeedCommit,
  onPlatformSharedSpeedPreview,
  onPlatformSpeedModeChange,
}) {
  return (
    <div className="platform-speed-section">
      <div className="platform-speed-heading">
        <button
          aria-checked={useSamePlatformSpeed}
          className={`platform-speed-toggle ${useSamePlatformSpeed ? "active" : ""}`}
          disabled={disabled}
          onClick={() => onPlatformSpeedModeChange(!useSamePlatformSpeed)}
          role="switch"
          type="button"
        >
          <span className="speed-toggle-track">
            <span className="speed-toggle-knob" />
          </span>
          <span>Use same speed for both motors</span>
        </button>
      </div>

      {useSamePlatformSpeed ? (
        <PlatformSpeedSlider
          disabled={disabled}
          id="platformBothMotorsSpeed"
          label="Both Motors Speed"
          onCommit={onPlatformSharedSpeedCommit}
          onPreview={onPlatformSharedSpeedPreview}
          value={platformSharedSpeed}
        />
      ) : (
        <div className="platform-speed-grid">
          {PLATFORM_SPEED_MOTORS.map((motor) => (
            <PlatformSpeedSlider
              disabled={disabled}
              id={motor.key}
              key={motor.key}
              label={motor.label}
              onCommit={(speed) => onPlatformSpeedCommit(motor, speed)}
              onPreview={(speed) => onPlatformSpeedPreview(motor, speed)}
              value={platformMotorSpeeds[motor.key]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Shows the recent commands sent by the interface with timestamps.
function CommandLogPanel({ animationDelay = 0, commandLog, subtitle = "Recent commands" }) {
  return (
    <article className="panel command-log-panel mode-panel-enter" style={{ "--panel-delay": `${animationDelay}ms` }}>
      <div className="panel-heading">
        <h2>Command Log</h2>
        <span className="panel-subtitle">{subtitle}</span>
      </div>
      <div className="log-list">
        {commandLog.length === 0 ? (
          <p className="empty-state">No commands sent yet.</p>
        ) : (
          commandLog.map((entry) => (
            <div className="log-entry" key={entry.id}>
              <span className="command-label">{formatCommandForDisplay(entry.command)}</span>
              <span>{entry.timestamp}</span>
            </div>
          ))
        )}
      </div>
    </article>
  );
}

// Keeps the robot state visible at the bottom of the screen.
function RobotStatusBar({
  armPosition,
  automaticStatus,
  isEmergencyActive,
  isNormalGripper,
  lastCommand,
  platformMotorSpeeds,
  selectedGrippingTool,
  suctionCupActive,
}) {
  return (
    <aside className="robot-status-bar" aria-label="Robot status">
      <div className="status-bar-heading">
        <h2>Robot Status</h2>
      </div>
      <div className="status-bar-grid">
        <StatusChip label="Emergency" value={isEmergencyActive ? "Emergency Active" : "Emergency Safe"} wide />
        <StatusChip label="Automatic Mode" value={automaticStatus} />
        <StatusChip label="Last Command" value={formatCommandForDisplay(lastCommand)} wide />
        {JOINT_SLIDERS.map((joint) => (
          <StatusChip key={joint.key} label={joint.label} value={`${armPosition[joint.key]} deg`} />
        ))}
        {isNormalGripper ? (
          <StatusChip label="Normal Gripper Angle" value={`${armPosition.normalGripperAngle} deg`} />
        ) : (
          <StatusChip label="Pneumatic Suction Cup" value={suctionCupActive ? "ON" : "OFF"} />
        )}
        {PLATFORM_SPEED_MOTORS.map((motor) => (
          <StatusChip key={motor.key} label={motor.label} value={formatPlatformSpeedLevel(platformMotorSpeeds[motor.key])} />
        ))}
        <StatusChip label="Gripping Tool" value={getGrippingToolLabel(selectedGrippingTool)} wide />
      </div>
    </aside>
  );
}

function StatusChip({ label, value, wide = false }) {
  return (
    <div className={`status-chip ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NotificationToast({ notification }) {
  if (!notification) return null;

  return (
    <div
      className={`notification-toast ${notification.type}`}
      role={notification.type === "error" ? "alert" : "status"}
      style={{ "--toast-duration": `${notification.duration}ms` }}
    >
      {notification.message}
    </div>
  );
}

export default function RoboticArmController() {
  const [hasSelectedMethod, setHasSelectedMethod] = useState(false);
  const [communicationMethod, setCommunicationMethod] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState(CONNECTION_STATES.disconnected);
  const [armMode, setArmMode] = useState("Off");
  const [platformMode, setPlatformMode] = useState("Off");
  const [modeConflictMessage, setModeConflictMessage] = useState("");
  const [lastCommand, setLastCommand] = useState("None");
  const [armPosition, setArmPosition] = useState(HOME_POSITION);
  const [commandLog, setCommandLog] = useState([]);
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [selectedGrippingTool, setSelectedGrippingTool] = useState("NORMAL_GRIPPER");
  const [suctionCupActive, setSuctionCupActive] = useState(false);
  const [automaticModeActive, setAutomaticModeActive] = useState(false);
  const [automaticStatus, setAutomaticStatus] = useState("Off");
  const [selectedTargetObject, setSelectedTargetObject] = useState("");
  const [detectedObject, setDetectedObject] = useState("");
  const [detectionConfidence, setDetectionConfidence] = useState(null);
  const [autoStep, setAutoStep] = useState("Waiting");
  const [autoPaused, setAutoPaused] = useState(true);
  const [autoError, setAutoError] = useState("");
  const [activePlatformCommand, setActivePlatformCommand] = useState("");
  const [platformMotorSpeeds, setPlatformMotorSpeeds] = useState(DEFAULT_PLATFORM_SPEEDS);
  const [platformSharedSpeed, setPlatformSharedSpeed] = useState(DEFAULT_PLATFORM_SPEED);
  const [useSamePlatformSpeed, setUseSamePlatformSpeed] = useState(false);
  const [notification, setNotification] = useState(null);
  const [serialPortSummary, setSerialPortSummary] = useState("");
  const [deviceReply, setDeviceReply] = useState("");
  const [deviceFeedbackLog, setDeviceFeedbackLog] = useState([]);

  const transportRef = useRef(null);
  const serialPortRef = useRef(null);
  const serialWriterRef = useRef(null);
  const serialReaderRef = useRef(null);
  const activeSerialMethodRef = useRef("");
  const isClosingSerialIntentionallyRef = useRef(false);
  const serialDisconnectHandledRef = useRef(false);
  const connectionFailureStateRef = useRef(CONNECTION_STATES.error);
  const isConnectedRef = useRef(false);
  const isEmergencyActiveRef = useRef(false);
  const pressedPlatformKeysRef = useRef(new Set());
  const lastKeyboardPlatformCommandRef = useRef("");

  const connectionLabel = connectionState;
  const connectionDetail = getConnectionDetail(communicationMethod, connectionState, serialPortSummary);
  const isManualMode = armMode === "Manual";
  const isAutomaticMode = armMode === "Automatic";
  const isPlatformManualMode = platformMode === "Manual";
  const isCombinedManualMode = isManualMode && isPlatformManualMode;
  const isPlatformActive = platformMode !== "Off";
  const canControlPlatformManually = isPlatformManualMode && !isEmergencyActive && isConnected;
  const isNormalGripper = selectedGrippingTool === "NORMAL_GRIPPER";
  const isArmOperationMode = armMode !== "Off";
  const isOperationMode = isArmOperationMode || isPlatformActive;
  const showSafetyControls = isOperationMode || isEmergencyActive;

  const statusTone = useMemo(() => {
    if (isEmergencyActive) return "danger";
    if (connectionState === CONNECTION_STATES.error) return "danger";
    if (isConnected) return "ok";
    return "idle";
  }, [connectionState, isConnected, isEmergencyActive]);

  const dashboardClassName = `dashboard-grid ${armMode.toLowerCase()}-dashboard ${
    isPlatformManualMode ? "platform-active-dashboard" : ""
  } ${isCombinedManualMode ? "combined-manual-dashboard" : ""}`;

  useEffect(() => {
    if (!modeConflictMessage) return undefined;

    const timeoutId = window.setTimeout(() => {
      setModeConflictMessage("");
    }, 2000);

    return () => window.clearTimeout(timeoutId);
  }, [modeConflictMessage]);

  // Top-screen notifications keep connection and mode messages temporary.
  useEffect(() => {
    if (!notification) return undefined;

    const timeoutId = window.setTimeout(() => {
      setNotification(null);
    }, notification.duration);

    return () => window.clearTimeout(timeoutId);
  }, [notification]);

  useEffect(() => {
    if (canControlPlatformManually) return undefined;

    setActivePlatformCommand("");
    return undefined;
  }, [canControlPlatformManually]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  useEffect(() => {
    isEmergencyActiveRef.current = isEmergencyActive;
  }, [isEmergencyActive]);

  useEffect(() => () => {
    void closeSerialConnection();
  }, []);

  // Web Serial disconnect events catch unplugged USB devices or closed Bluetooth serial ports when the browser reports them.
  useEffect(() => {
    if (!navigator.serial?.addEventListener) return undefined;

    function handleSerialDisconnect(event) {
      const activePort = serialPortRef.current;
      if (activePort && event.target !== activePort) return;

      void handleUnexpectedSerialDisconnect(activeSerialMethodRef.current || communicationMethod);
    }

    navigator.serial.addEventListener("disconnect", handleSerialDisconnect);

    return () => {
      navigator.serial.removeEventListener("disconnect", handleSerialDisconnect);
    };
  }, []);

  // Keyboard WASD control sends a new command only when the movement direction changes.
  useEffect(() => {
    if (!canControlPlatformManually) {
      resetPlatformKeyboardState(pressedPlatformKeysRef, lastKeyboardPlatformCommandRef, () => {
        handlePlatformCommand("PLATFORM_STOP");
      });
      return undefined;
    }

    function isTextInputTarget(target) {
      const tagName = target?.tagName?.toLowerCase();
      return target?.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
    }

    function sendKeyboardPlatformCommand(command) {
      if (!command) {
        setActivePlatformCommand("");
        if (lastKeyboardPlatformCommandRef.current) {
          lastKeyboardPlatformCommandRef.current = "PLATFORM_STOP";
          handlePlatformCommand("PLATFORM_STOP");
        }
        return;
      }

      setActivePlatformCommand(command);

      if (lastKeyboardPlatformCommandRef.current === command) return;

      lastKeyboardPlatformCommandRef.current = command;
      handlePlatformCommand(command);
    }

    function syncMovementCommand() {
      sendKeyboardPlatformCommand(getPlatformMovementCommand(pressedPlatformKeysRef.current));
    }

    function handlePlatformKeyDown(event) {
      if (event.repeat || isTextInputTarget(event.target)) return;

      const key = event.key === " " ? " " : event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        pressedPlatformKeysRef.current.clear();
        sendKeyboardPlatformCommand("PLATFORM_STOP");
        return;
      }

      if (!PLATFORM_MOVEMENT_KEYS.has(key)) return;

      event.preventDefault();
      pressedPlatformKeysRef.current.add(key);
      syncMovementCommand();
    }

    function handlePlatformKeyUp(event) {
      const key = event.key === " " ? " " : event.key.toLowerCase();
      if (!PLATFORM_MOVEMENT_KEYS.has(key)) return;

      event.preventDefault();
      pressedPlatformKeysRef.current.delete(key);
      syncMovementCommand();
    }

    window.addEventListener("keydown", handlePlatformKeyDown);
    window.addEventListener("keyup", handlePlatformKeyUp);

    return () => {
      window.removeEventListener("keydown", handlePlatformKeyDown);
      window.removeEventListener("keyup", handlePlatformKeyUp);
      resetPlatformKeyboardState(pressedPlatformKeysRef, lastKeyboardPlatformCommandRef, () => {
        handlePlatformCommand("PLATFORM_STOP");
      });
    };
  }, [canControlPlatformManually]);

  // Connection handling keeps Simulation local and uses Web Serial for Bluetooth or USB COM ports.
  async function selectCommunicationMethod(method) {
    await closeSerialConnection();
    const canConnectImmediately = isSimulationMethod(method);

    setCommunicationMethod(method);
    setHasSelectedMethod(true);
    setIsConnected(canConnectImmediately);
    isConnectedRef.current = canConnectImmediately;
    setConnectionState(canConnectImmediately ? CONNECTION_STATES.connected : CONNECTION_STATES.disconnected);
    setSerialPortSummary("");
    setDeviceReply("");
    setDeviceFeedbackLog([]);
    activeSerialMethodRef.current = "";
    serialDisconnectHandledRef.current = false;
    transportRef.current = canConnectImmediately ? createSimulationTransport(method) : null;

    if (method === AUTONOMOUS_NETWORK_METHOD) {
      setArmMode("Automatic");
      setPlatformMode("Automatic");
      setSelectedTargetObject(AUTONOMOUS_TARGET_OBJECT);
      setDetectedObject("");
      setDetectionConfidence(null);
      resetAutomaticModeState("Paused", { active: false, paused: true, step: "Pi receiver and YOLO sender ready" });
      return;
    }

    resetModesToOff();
  }

  function handleCommunicationMethodChange(event) {
    void selectCommunicationMethod(event.target.value);
  }

  function showNotification(message, type = "info", duration = TOAST_DURATION) {
    setNotification({ id: `${Date.now()}-${message}`, message, type, duration });
  }

  // Device feedback is separate from the command log: it shows Arduino replies.
  function appendDeviceFeedback(message) {
    const cleanMessage = String(message || "").trim();
    if (!cleanMessage) return;

    const entry = {
      id: `${Date.now()}-${cleanMessage}`,
      message: cleanMessage,
      timestamp: formatTime(new Date()),
    };

    setDeviceReply(cleanMessage);
    setDeviceFeedbackLog((previous) => [entry, ...previous].slice(0, 6));
  }

  function showModeNotification(system, mode) {
    showNotification(MODE_EXPLANATIONS[system][mode], "success", MODE_TOAST_DURATION);
  }

  function resetModesToOff(message = "") {
    setArmMode("Off");
    setPlatformMode("Off");
    resetAutomaticModeState("Off");
    setModeConflictMessage(message);
  }

  function enterCombinedAutomaticMode() {
    setArmMode("Automatic");
    setPlatformMode("Automatic");
    setSelectedTargetObject(AUTONOMOUS_TARGET_OBJECT);
    setDetectedObject("");
    setDetectionConfidence(null);
    resetAutomaticModeState("Paused", { active: false, paused: true, step: "Pi receiver and YOLO sender ready" });
    setModeConflictMessage("");
    showModeNotification("arm", "Automatic");
  }

  function enterManualArmMode() {
    if (platformMode === "Automatic") {
      setPlatformMode("Off");
    }

    setArmMode("Manual");
    resetAutomaticModeState("Off");
    setModeConflictMessage("");
    showModeNotification("arm", "Manual");
  }

  function enterManualPlatformMode() {
    if (armMode === "Automatic") {
      setArmMode("Off");
    }

    setPlatformMode("Manual");
    resetAutomaticModeState("Off");
    setModeConflictMessage("");
    showModeNotification("platform", "Manual");
  }

  function leaveAutomaticMode(message = "") {
    resetAutomaticModeState("Off");
    setModeConflictMessage(message === MODE_MESSAGES.off ? "" : message);
  }

  function resetAutomaticModeState(status = "Off", options = {}) {
    setAutomaticModeActive(options.active || false);
    setAutomaticStatus(status);
    setAutoPaused(options.paused ?? true);
    setAutoStep(options.step || "Waiting");
    setAutoError("");
  }

  // Future Raspberry Pi model data can call this once WebSocket or HTTP polling is added.
  function handleModelDetectionUpdate(data = {}) {
    const confidence = Number(data.confidence);

    setSelectedTargetObject(data.selectedTargetObject || data.targetObject || "");
    setDetectedObject(data.label || data.objectLabel || data.object || "");
    setDetectionConfidence(Number.isFinite(confidence) ? confidence : null);
    setAutoStep(data.robotActionSuggestion || data.suggestedAction || data.action || "Detection received");

    if (data.error) {
      setAutoError(String(data.error));
      setAutomaticStatus("Error");
    }
  }

  // Disconnected mode lock keeps both systems safely Off until a connection is active.
  function blockDisconnectedModeChange() {
    resetModesToOff();
    showNotification(MODE_MESSAGES.disconnected, "warning");
  }

  // Manual arm and platform controls can run together; automatic mode still runs both together.
  function handleArmModeChange(mode) {
    if (!isConnected && mode !== "Off") {
      blockDisconnectedModeChange();
      return;
    }

    if (mode === "Automatic") {
      enterCombinedAutomaticMode();
      return;
    }

    if (mode === "Manual") {
      enterManualArmMode();
      return;
    }

    if (platformMode === "Automatic") {
      setPlatformMode("Off");
      leaveAutomaticMode(MODE_MESSAGES.off);
    } else if (modeConflictMessage) {
      setModeConflictMessage("");
    }

    setArmMode(mode);
    resetAutomaticModeState("Off");
    showModeNotification("arm", "Off");
  }

  function handlePlatformModeChange(mode) {
    if (!isConnected && mode !== "Off") {
      blockDisconnectedModeChange();
      return;
    }

    if (mode === "Automatic") {
      enterCombinedAutomaticMode();
      return;
    }

    if (mode === "Manual") {
      enterManualPlatformMode();
      return;
    }

    if (armMode === "Automatic") {
      setArmMode("Off");
      leaveAutomaticMode(MODE_MESSAGES.off);
    } else if (modeConflictMessage) {
      setModeConflictMessage("");
    }

    setPlatformMode(mode);
    showModeNotification("platform", "Off");
  }

  // Read/write failures and browser disconnect events use the same safe shutdown path.
  async function handleUnexpectedSerialDisconnect(method = activeSerialMethodRef.current) {
    if (!isSerialMethod(method) || isClosingSerialIntentionallyRef.current || serialDisconnectHandledRef.current) return;

    const hadActiveSerialConnection = serialPortRef.current || serialWriterRef.current || serialReaderRef.current;
    if (!hadActiveSerialConnection) return;

    serialDisconnectHandledRef.current = true;

    await closeSerialConnection({ intentional: false });
    transportRef.current = null;
    activeSerialMethodRef.current = "";
    setIsConnected(false);
    isConnectedRef.current = false;
    setConnectionState(CONNECTION_STATES.disconnected);
    setActivePlatformCommand("");
    resetPlatformKeyboardState(pressedPlatformKeysRef, lastKeyboardPlatformCommandRef);
    resetModesToOff();

    const message = getUnexpectedSerialDisconnectMessage(method);
    appendDeviceFeedback(message);
    showNotification(message, "info");
  }

  // Reads Arduino/HC-05 replies such as READY, OK ..., or ERROR ... after a serial connection opens.
  async function startSerialReader(port, method) {
    if (!port.readable) {
      appendDeviceFeedback(`${method} connected. No readable feedback stream available.`);
      return;
    }

    const reader = port.readable.getReader();
    const decoder = new TextDecoder();
    let pendingText = "";
    let detectedUnexpectedClose = false;

    serialReaderRef.current = reader;

    try {
      while (serialReaderRef.current === reader) {
        const { value, done } = await reader.read();
        if (done) {
          detectedUnexpectedClose = !isClosingSerialIntentionallyRef.current;
          break;
        }

        pendingText += decoder.decode(value, { stream: true });
        const lines = pendingText.split(/\r?\n/);
        pendingText = lines.pop() || "";
        lines.forEach(appendDeviceFeedback);
      }

      pendingText += decoder.decode();
      appendDeviceFeedback(pendingText);
    } catch (error) {
      if (serialReaderRef.current === reader) {
        console.warn(`${method} feedback reader stopped:`, error);
        detectedUnexpectedClose = !isClosingSerialIntentionallyRef.current;
      }
    } finally {
      if (serialReaderRef.current === reader) {
        serialReaderRef.current = null;
      }

      try {
        reader.releaseLock();
      } catch (error) {
        console.warn("Serial reader lock release failed:", error);
      }
    }

    if (detectedUnexpectedClose) {
      void handleUnexpectedSerialDisconnect(method);
    }
  }

  async function connectSerialPort(method) {
    if (!("serial" in navigator)) {
      connectionFailureStateRef.current = CONNECTION_STATES.error;
      resetModesToOff();
      showNotification(MODE_MESSAGES.serialNoSupport, "error");
      return false;
    }

    try {
      if (serialPortRef.current || serialWriterRef.current) {
        await closeSerialConnection();
      }

      activeSerialMethodRef.current = "";
      serialDisconnectHandledRef.current = false;
      setDeviceReply("");
      setDeviceFeedbackLog([]);

      const pickerGuidance = getSerialPickerGuidance(method);
      if (pickerGuidance) {
        showNotification(pickerGuidance, "info", 3600);
        await wait(650);
      }

      const requestOptions = getSerialRequestOptions(method);
      const port = requestOptions
        ? await navigator.serial.requestPort(requestOptions)
        : await navigator.serial.requestPort();
      const portInfo = port.getInfo?.() || {};
      const validation = validateSelectedSerialPort(method, portInfo);

      if (!validation.isValid) {
        connectionFailureStateRef.current = CONNECTION_STATES.disconnected;
        resetModesToOff();
        setSerialPortSummary("");
        showNotification(validation.message, "warning", 4200);
        return false;
      }

      serialPortRef.current = port;
      await port.open({ baudRate: SERIAL_BAUD_RATE });

      if (!port.writable) {
        throw new Error("Selected serial port is not writable.");
      }

      const writer = port.writable.getWriter();
      serialWriterRef.current = writer;
      activeSerialMethodRef.current = method;
      serialDisconnectHandledRef.current = false;
      transportRef.current = createSerialTransport(writer);
      setSerialPortSummary(getSerialPortInfoSummary(method));
      setModeConflictMessage("");
      void startSerialReader(port, method);
      return true;
    } catch (error) {
      console.error(`${method} connection failed:`, error);
      await closeSerialConnection();
      transportRef.current = null;
      setSerialPortSummary("");

      const wasCancelled = error?.name === "NotFoundError";
      connectionFailureStateRef.current = wasCancelled ? CONNECTION_STATES.disconnected : CONNECTION_STATES.error;
      const message = wasCancelled ? getSerialCancelMessage(method) : getSerialOpenFailureMessage(method);
      resetModesToOff();
      showNotification(message, wasCancelled ? "warning" : "error");
      return false;
    }
  }

  async function closeSerialConnection({ intentional = true } = {}) {
    // Disconnect cleanup releases reader, writer, and port locks before closing the serial port.
    if (intentional) {
      isClosingSerialIntentionallyRef.current = true;
    }

    const reader = serialReaderRef.current;
    const writer = serialWriterRef.current;
    const port = serialPortRef.current;

    serialReaderRef.current = null;
    serialWriterRef.current = null;
    serialPortRef.current = null;
    setSerialPortSummary("");

    try {
      if (reader) {
        try {
          await reader.cancel();
        } catch (error) {
          console.warn("Serial reader cancel failed:", error);
        }

        try {
          reader.releaseLock();
        } catch (error) {
          console.warn("Serial reader lock release failed:", error);
        }
      }

      if (writer) {
        try {
          await writer.close();
        } catch (error) {
          console.warn("Serial writer close failed:", error);
        }

        try {
          writer.releaseLock();
        } catch (error) {
          console.warn("Serial writer lock release failed:", error);
        }
      }

      if (port) {
        await port.close();
      }
    } catch (error) {
      console.error("Serial disconnect failed:", error);
    } finally {
      if (intentional) {
        activeSerialMethodRef.current = "";
        serialDisconnectHandledRef.current = false;
        isClosingSerialIntentionallyRef.current = false;
      }
    }
  }

  async function connectToTransport(method = communicationMethod) {
    if (method === AUTONOMOUS_NETWORK_METHOD) {
      await closeSerialConnection();

      try {
        const bridgeStatus = await checkPiCommandBridge();
        if (bridgeStatus.arduino_connected === false) {
          throw new Error(bridgeStatus.last_serial_error || "Arduino serial port is not connected to the Pi.");
        }

        transportRef.current = createPiNetworkTransport();
        const serialDetail = bridgeStatus.serial_port ? ` Arduino on ${bridgeStatus.serial_port}.` : "";
        appendDeviceFeedback(`Pi command bridge ready at ${PI_COMMAND_BRIDGE_URL}.${serialDetail}`);
        return true;
      } catch (error) {
        console.error("Pi command bridge connection failed:", error);
        transportRef.current = null;
        resetModesToOff();
        showNotification(`Pi network is not ready: ${error.message}`, "error");
        return false;
      }
    }

    if (isSimulationMethod(method)) {
      await closeSerialConnection();
      transportRef.current = createSimulationTransport(method);
      appendDeviceFeedback("Simulation transport ready.");
      return true;
    }

    if (isSerialMethod(method)) {
      return connectSerialPort(method);
    }

    return false;
  }

  async function handleConnect() {
    connectionFailureStateRef.current = CONNECTION_STATES.error;
    setConnectionState(CONNECTION_STATES.connecting);
    const didConnect = await connectToTransport();

    setIsConnected(didConnect);
    isConnectedRef.current = didConnect;
    if (didConnect) {
      setConnectionState(CONNECTION_STATES.connected);
      showNotification(getConnectionSuccessMessage(communicationMethod), "success");
    } else {
      setConnectionState(connectionFailureStateRef.current);
    }
  }

  async function handleDisconnect() {
    const hadActiveMode = armMode !== "Off" || platformMode !== "Off";

    await closeSerialConnection();
    transportRef.current = null;
    setIsConnected(false);
    isConnectedRef.current = false;
    setConnectionState(CONNECTION_STATES.disconnected);
    resetModesToOff(hadActiveMode ? MODE_MESSAGES.disconnected : "");
    showNotification("Disconnected successfully.", "info");
  }

  async function returnToEntryPage() {
    await closeSerialConnection();
    transportRef.current = null;
    resetPlatformKeyboardState(pressedPlatformKeysRef, lastKeyboardPlatformCommandRef);
    setHasSelectedMethod(false);
    setCommunicationMethod("");
    setIsConnected(false);
    isConnectedRef.current = false;
    setConnectionState(CONNECTION_STATES.disconnected);
    setIsEmergencyActive(false);
    isEmergencyActiveRef.current = false;
    setActivePlatformCommand("");
    setNotification(null);
    resetModesToOff();
  }

  // Updates the simulated arm status values after commands are accepted.
  function updatePositionForCommand(command) {
    setArmPosition((previous) => {
      const joint = getJointFromCommand(command);
      const [commandName, value] = command.split(":");

      if (joint) {
        return { ...previous, [joint.key]: clamp(Number(value), joint.range || MOTOR_ANGLE_LIMITS) };
      }

      if (commandName === "NORMAL_GRIPPER_ANGLE") {
        return { ...previous, normalGripperAngle: clamp(Number(value), NORMAL_GRIPPER_LIMITS) };
      }

      if (commandName === "GRIPPER_POSITION") {
        const legacyPosition = clamp(Number(value), LEGACY_GRIPPER_LIMITS);
        return { ...previous, normalGripperAngle: Math.round((legacyPosition / 100) * 180) };
      }

      if (command === "GRIPPER_OPEN") {
        return { ...previous, normalGripperAngle: 180 };
      }

      if (command === "GRIPPER_CLOSE") {
        return { ...previous, normalGripperAngle: 0 };
      }

      if (command === "HOME") {
        return HOME_POSITION;
      }

      return previous;
    });
  }

  // Command log keeps the newest user actions at the top.
  function appendCommandLog(command) {
    const entry = {
      id: `${Date.now()}-${command}`,
      command,
      timestamp: formatTime(new Date()),
    };

    setCommandLog((previous) => [entry, ...previous].slice(0, 12));
  }

  // Motor angle controls preview while dragging and send once the slider is released.
  function previewJointAngle(joint, value) {
    setArmPosition((previous) => ({
      ...previous,
      [joint.key]: clamp(Number(value), joint.range || MOTOR_ANGLE_LIMITS),
    }));
  }

  function commitJointAngle(joint, value) {
    if (!isManualMode || isEmergencyActive) return;

    const uiAngle = clamp(Number(value), joint.range || MOTOR_ANGLE_LIMITS);
    const commandAngle = getJointCommandAngle(joint, uiAngle);

    sendCommand(`${joint.commandPrefix}:${commandAngle}`, {
      displayCommand: `${joint.commandPrefix}:${uiAngle}`,
      statusCommand: `${joint.commandPrefix}:${uiAngle}`,
    });
  }

  function previewNormalGripperAngle(value) {
    setArmPosition((previous) => ({
      ...previous,
      normalGripperAngle: clamp(Number(value), NORMAL_GRIPPER_LIMITS),
    }));
  }

  function commitNormalGripperAngle(value) {
    if (!isManualMode || !isNormalGripper || isEmergencyActive) return;

    const angle = clamp(Number(value), NORMAL_GRIPPER_LIMITS);
    sendCommand(`NORMAL_GRIPPER_ANGLE:${angle}`);
  }

  // Gripper tool selection switches between the normal gripper and suction cup controls.
  function handleSuctionCupCommand(nextState) {
    if (!isManualMode || isNormalGripper || isEmergencyActive) return;

    sendCommand(nextState ? "SUCTION_CUP_ON" : "SUCTION_CUP_OFF");
  }

  function handleGrippingToolChange(toolValue) {
    if (!isManualMode || selectedGrippingTool === toolValue || isEmergencyActive) return;

    setSelectedGrippingTool(toolValue);
    // The relay pump is forced off when returning to the normal gripper.
    if (toolValue === "NORMAL_GRIPPER") {
      setSuctionCupActive(false);
    }
    sendCommand(`GRIPPING_TOOL:${toolValue}`);
  }

  // Automatic controls now command the Pi bridge; PAUSE/STOP force the receiver to stop the platform.
  async function handleAutomaticControl(command, state) {
    if (isEmergencyActive) return;
    if (!isConnected) {
      blockDisconnectedModeChange();
      return;
    }

    await sendCommand(command);
    setAutomaticModeActive(command !== "STOP_AUTO");
    setAutomaticStatus(state);
    setAutoPaused(state !== "Running");
    setSelectedTargetObject(AUTONOMOUS_TARGET_OBJECT);
    setDetectedObject(command === "STOP_AUTO" ? "" : AUTONOMOUS_TARGET_OBJECT);
    setDetectionConfidence(command === "STOP_AUTO" ? null : detectionConfidence);
    setAutoStep(
      command === "START_AUTO" || command === "RESUME"
        ? "Tracking ball through Pi receiver"
        : command === "PAUSE"
          ? "Tracking paused; Pi receiver is holding platform stop"
          : "Waiting"
    );
    setAutoError("");
    showNotification(
      command === "START_AUTO"
        ? "Autonomous tracking started through the Pi receiver."
        : command === "STOP_AUTO"
          ? "Autonomous tracking stopped and platform stop sent."
          : "Autonomous status updated.",
      command === "STOP_AUTO" ? "warning" : "info",
      MODE_TOAST_DURATION
    );
  }

  function handlePlatformCommand(command) {
    if (!canControlPlatformManually) return;

    sendCommand(command);
  }

  function previewPlatformSpeed(motor, value) {
    const speed = normalizePlatformSpeed(value);
    setPlatformMotorSpeeds((previous) => ({ ...previous, [motor.key]: speed }));
  }

  function commitPlatformSpeed(motor, value) {
    if (!canControlPlatformManually) return;

    sendCommand(`${motor.commandPrefix}:${getPlatformSpeedCommandValue(value)}`);
  }

  function previewPlatformSharedSpeed(value) {
    const speed = normalizePlatformSpeed(value);
    setPlatformSharedSpeed(speed);
    setPlatformMotorSpeeds(createPlatformSpeedMap(speed));
  }

  function commitPlatformSharedSpeed(value) {
    if (!canControlPlatformManually) return;

    sendCommand(`PLATFORM_BOTH_MOTORS_SPEED:${getPlatformSpeedCommandValue(value)}`);
  }

  // Same-speed mode links the left and right platform motor speed selectors.
  function handlePlatformSpeedModeChange(nextUseSameSpeed) {
    if (!canControlPlatformManually) return;

    if (nextUseSameSpeed) {
      const speeds = Object.values(platformMotorSpeeds);
      const averagedSpeed = normalizePlatformSpeed(
        Math.round(speeds.reduce((total, speed) => total + speed, 0) / speeds.length)
      );
      previewPlatformSharedSpeed(averagedSpeed);
    }

    setUseSamePlatformSpeed(nextUseSameSpeed);
  }

  // Emergency Stop locks movement commands but still allows the reset command.
  function handleEmergencyToggle() {
    const nextEmergencyState = !isEmergencyActive;

    if (nextEmergencyState) {
      if (isAutomaticMode) {
        resetAutomaticModeState("Paused", { active: true, paused: true, step: "Emergency Stop" });
      }

      setActivePlatformCommand("");
      setSuctionCupActive(false);
      resetPlatformKeyboardState(pressedPlatformKeysRef, lastKeyboardPlatformCommandRef);
    }

    setIsEmergencyActive(nextEmergencyState);
    isEmergencyActiveRef.current = nextEmergencyState;
    sendCommand(nextEmergencyState ? "EMERGENCY_STOP" : "RESET_EMERGENCY");
  }

  async function handleArmHomePosition() {
    if (isEmergencyActiveRef.current) return;

    if (!isConnectedRef.current) {
      blockDisconnectedModeChange();
      return;
    }

    await sendCommand(`ELBOW_JOINT:${ARM_HOME_COMMANDS.elbowJoint}`, {
      displayCommand: `ELBOW_JOINT:${HOME_POSITION.elbowJoint}`,
      statusCommand: `ELBOW_JOINT:${HOME_POSITION.elbowJoint}`,
    });
    await wait(ARM_HOME_SEQUENCE_DELAY_MS);

    if (isEmergencyActiveRef.current || !isConnectedRef.current) return;

    await sendCommand(`WRIST_JOINT:${ARM_HOME_COMMANDS.wristJoint}`, {
      displayCommand: `WRIST_JOINT:${HOME_POSITION.wristJoint}`,
      statusCommand: `WRIST_JOINT:${HOME_POSITION.wristJoint}`,
    });
    await wait(ARM_HOME_SEQUENCE_DELAY_MS);

    if (isEmergencyActiveRef.current || !isConnectedRef.current) return;

    await sendCommand(`NORMAL_GRIPPER_ANGLE:${ARM_HOME_COMMANDS.normalGripperAngle}`);
  }

  // All robot commands pass through here before being logged or sent to the transport.
  async function sendCommand(command, options = {}) {
    const displayCommand = options.displayCommand || command;
    const statusCommand = options.statusCommand || displayCommand;
    const canSendDuringEmergency = EMERGENCY_COMMANDS.has(command);

    if (isEmergencyActiveRef.current && !canSendDuringEmergency) {
      console.warn(`Blocked ${command} while Emergency Stop is active.`);
      return;
    }

    if (isSerialMethod(communicationMethod) && (!isConnected || !transportRef.current?.send)) {
      setIsConnected(false);
      setConnectionState(CONNECTION_STATES.error);
      resetModesToOff();
      showNotification(getSerialNoPortMessage(communicationMethod), "error");
      return;
    }

    if (!canSendDuringEmergency && !isConnected) {
      return;
    }

    try {
      if (transportRef.current?.send) {
        // Arduino and HC-05 sketches can read each command with readStringUntil('\n').
        await transportRef.current.send(`${command}\n`);
      } else {
        console.info(`[Local] ${command}`);
      }

      if (command === "SUCTION_CUP_ON") {
        setSuctionCupActive(true);
      }

      if (command === "SUCTION_CUP_OFF" || command === "EMERGENCY_STOP" || command === "HOME") {
        setSuctionCupActive(false);
      }

      setLastCommand(displayCommand);
      updatePositionForCommand(statusCommand);
      appendCommandLog(displayCommand);
    } catch (error) {
      console.error(`Failed to send ${command}:`, error);
      if (isSerialMethod(communicationMethod)) {
        await handleUnexpectedSerialDisconnect(communicationMethod);
      }
    }
  }

  if (!hasSelectedMethod) {
    return <WelcomeScreen onSelectMethod={selectCommunicationMethod} />;
  }

  return (
    <main className={`dashboard-shell dashboard-enter ${isEmergencyActive ? "emergency-screen" : ""}`}>
      <NotificationToast key={notification?.id || "empty-toast"} notification={notification} />
      <DashboardHeader
        connectionLabel={connectionLabel}
        isEmergencyActive={isEmergencyActive}
        onReturnHome={returnToEntryPage}
        statusTone={statusTone}
      />

      <EmergencyLockNotice isVisible={isEmergencyActive} />

      <section className={dashboardClassName}>
        <RobotOperationCenter
          armMode={armMode}
          communicationMethod={communicationMethod}
          connectionDetail={connectionDetail}
          connectionState={connectionState}
          deviceFeedbackLog={deviceFeedbackLog}
          deviceReply={deviceReply}
          isConnected={isConnected}
          isArmOperationMode={isArmOperationMode}
          isEmergencyActive={isEmergencyActive}
          isOperationMode={isOperationMode}
          modeConflictMessage={modeConflictMessage}
          platformMode={platformMode}
          showSafetyControls={showSafetyControls}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
          onEmergencyToggle={handleEmergencyToggle}
          onHome={handleArmHomePosition}
          onArmModeChange={handleArmModeChange}
          onMethodChange={handleCommunicationMethodChange}
          onPlatformModeChange={handlePlatformModeChange}
        />

        {isManualMode && (
          <MotorControls
            animationDelay={0}
            armPosition={armPosition}
            isEmergencyActive={isEmergencyActive}
            isNormalGripper={isNormalGripper}
            selectedGrippingTool={selectedGrippingTool}
            suctionCupActive={suctionCupActive}
            onGrippingToolChange={handleGrippingToolChange}
            onJointCommit={commitJointAngle}
            onJointPreview={previewJointAngle}
            onNormalGripperCommit={commitNormalGripperAngle}
            onNormalGripperPreview={previewNormalGripperAngle}
            onSuctionCupCommand={handleSuctionCupCommand}
          />
        )}

        {isAutomaticMode && (
          <>
            <VisionStatusPanel animationDelay={0} autoStartPiStream preferredSource="raspberryPiRaw" />
            <AutomaticControlsPanel
              animationDelay={120}
              autoError={autoError}
              automaticModeActive={automaticModeActive}
              automaticStatus={automaticStatus}
              autoPaused={autoPaused}
              autoStep={autoStep}
              detectionConfidence={detectionConfidence}
              detectedObject={detectedObject}
              disabled={isEmergencyActive}
              selectedTargetObject={selectedTargetObject}
              onControl={handleAutomaticControl}
            />
            <CommandLogPanel animationDelay={240} commandLog={commandLog} subtitle="Automatic command history" />
          </>
        )}

        {isPlatformManualMode && (
          <>
            <PlatformManualPanel
              activeCommand={activePlatformCommand}
              animationDelay={isCombinedManualMode ? 120 : 0}
              disabled={!canControlPlatformManually}
              onPlatformCommand={handlePlatformCommand}
              onPointerState={setActivePlatformCommand}
            />
            <PlatformSpeedPanel
              animationDelay={isCombinedManualMode ? 240 : 120}
              disabled={!canControlPlatformManually}
              platformMotorSpeeds={platformMotorSpeeds}
              platformSharedSpeed={platformSharedSpeed}
              useSamePlatformSpeed={useSamePlatformSpeed}
              onPlatformSpeedCommit={commitPlatformSpeed}
              onPlatformSpeedPreview={previewPlatformSpeed}
              onPlatformSharedSpeedCommit={commitPlatformSharedSpeed}
              onPlatformSharedSpeedPreview={previewPlatformSharedSpeed}
              onPlatformSpeedModeChange={handlePlatformSpeedModeChange}
            />
          </>
        )}

        {!isAutomaticMode && (isManualMode || isPlatformManualMode) && (
          <>
            <VisionStatusPanel animationDelay={isCombinedManualMode ? 360 : 120} />
            <CommandLogPanel
              animationDelay={isCombinedManualMode ? 480 : isPlatformManualMode ? 240 : 240}
              commandLog={commandLog}
            />
          </>
        )}
      </section>

      <RobotStatusBar
        armPosition={armPosition}
        automaticStatus={automaticStatus}
        isEmergencyActive={isEmergencyActive}
        isNormalGripper={isNormalGripper}
        lastCommand={lastCommand}
        platformMotorSpeeds={platformMotorSpeeds}
        platformSharedSpeed={platformSharedSpeed}
        selectedGrippingTool={selectedGrippingTool}
        suctionCupActive={suctionCupActive}
        useSamePlatformSpeed={useSamePlatformSpeed}
      />
    </main>
  );
}
