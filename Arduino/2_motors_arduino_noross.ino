#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <SoftwareSerial.h>
#include <string.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);

// HC-05 Bluetooth
// HC-05 TXD -> Arduino D2
// HC-05 RXD -> Arduino D3
SoftwareSerial bluetooth(2, 3);

// PCA9685 channels
const byte ELBOW_CHANNEL = 3;
const byte WRIST_CHANNEL = 4;
const byte GRIPPER_CHANNEL = 15;

const int SERVO_FREQ = 50;

// Pump relay. D10 is the same signal wire previously used for the MOSFET.
const byte PUMP_PIN = 10;
const byte PUMP_RELAY_ON_LEVEL = HIGH;
const byte PUMP_RELAY_OFF_LEVEL = LOW;

// L298N platform pins
const byte MOTOR_A_IN1 = 6;
const byte MOTOR_A_IN2 = 7;
const byte MOTOR_B_IN1 = 8;
const byte MOTOR_B_IN2 = 9;
const byte MOTOR_A_EN  = 11;  // PWM
const byte MOTOR_B_EN  = 12;  // Not PWM on Uno, used ON/OFF

// Servo calibration
const int ELBOW_MIN_PULSE = 120;
const int ELBOW_MAX_PULSE = 600;

const int WRIST_MIN_TICKS = 400;
const int WRIST_MAX_TICKS = 600;

const int GRIPPER_MIN_PULSE = 150;
const int GRIPPER_MAX_PULSE = 550;

// Platform speeds
int platformLeftSpeed = 180;
int platformRightSpeed = 180;

// Servo smoothing. Smaller step and larger delay make motion softer but slower.
const int SERVO_SMOOTH_STEP = 2;
const int SERVO_SMOOTH_DELAY_MS = 12;
int currentElbowPulse = -1;
int currentWristTicks = -1;
int currentGripperPulse = -1;

bool emergencyActive = false;
bool pumpPulseActive = false;
unsigned long pumpPulseEndTime = 0;

// Calibrated physical home: elbow appears 90 deg, wrist appears 0 deg.
const int HOME_ELBOW_ANGLE = 55;
const int HOME_WRIST_ANGLE = 0;
const int HOME_GRIPPER_ANGLE = 90;

// Serial input buffers
char usbBuffer[50];
char btBuffer[50];
byte usbIndex = 0;
byte btIndex = 0;

// =============================
// Helpers
// =============================

void sendReply(const __FlashStringHelper *message) {
  Serial.println(message);
  bluetooth.println(message);
}

void sendReplyText(const char *message) {
  Serial.println(message);
  bluetooth.println(message);
}

int getValueAfterColon(char *command) {
  char *colon = strchr(command, ':');

  if (colon == NULL) {
    return 90;
  }

  return atoi(colon + 1);
}

char* getTextAfterColon(char *command) {
  char *colon = strchr(command, ':');

  if (colon == NULL) {
    return command;
  }

  return colon + 1;
}

bool commandStartsWith(char *command, const char *prefix) {
  return strncmp(command, prefix, strlen(prefix)) == 0;
}

int speedTextToPWM(char *speedText) {
  if (strcmp(speedText, "SLOW") == 0) return 120;
  if (strcmp(speedText, "MEDIUM") == 0) return 180;
  if (strcmp(speedText, "FAST") == 0) return 240;

  return 180;
}

// =============================
// Servo Mapping
// =============================

int elbowAngleToPulse(int angle) {
  angle = constrain(angle, 0, 180);
  return map(angle, 0, 180, ELBOW_MIN_PULSE, ELBOW_MAX_PULSE);
}

int wristAngleToTicks(int angle) {
  angle = constrain(angle, 0, 180);
  return map(angle, 0, 180, WRIST_MIN_TICKS, WRIST_MAX_TICKS);
}

int gripperAngleToPulse(int angle) {
  angle = constrain(angle, 0, 180);
  return map(angle, 0, 180, GRIPPER_MIN_PULSE, GRIPPER_MAX_PULSE);
}

// =============================
// Arm Control
// =============================

void stopAllOutputs();

void smoothPwmMove(byte channel, int &currentValue, int targetValue) {
  if (currentValue < 0) {
    currentValue = targetValue;
    pwm.setPWM(channel, 0, targetValue);
    return;
  }

  while (currentValue != targetValue) {
    if (emergencyActive) {
      stopAllOutputs();
      return;
    }

    int delta = targetValue - currentValue;
    if (abs(delta) <= SERVO_SMOOTH_STEP) {
      currentValue = targetValue;
    } else {
      currentValue += delta > 0 ? SERVO_SMOOTH_STEP : -SERVO_SMOOTH_STEP;
    }

    pwm.setPWM(channel, 0, currentValue);
    delay(SERVO_SMOOTH_DELAY_MS);
  }
}

void moveElbow(int angle) {
  angle = constrain(angle, 0, 180);
  int pulse = elbowAngleToPulse(angle);

  smoothPwmMove(ELBOW_CHANNEL, currentElbowPulse, pulse);

  Serial.print(F("OK ELBOW_JOINT "));
  Serial.print(angle);
  Serial.print(F(" PULSE "));
  Serial.println(pulse);

  bluetooth.print(F("OK ELBOW_JOINT "));
  bluetooth.print(angle);
  bluetooth.print(F(" PULSE "));
  bluetooth.println(pulse);
}

void moveWrist(int angle) {
  angle = constrain(angle, 0, 180);
  int ticks = wristAngleToTicks(angle);

  smoothPwmMove(WRIST_CHANNEL, currentWristTicks, ticks);

  Serial.print(F("OK WRIST_JOINT "));
  Serial.print(angle);
  Serial.print(F(" TICKS "));
  Serial.println(ticks);

  bluetooth.print(F("OK WRIST_JOINT "));
  bluetooth.print(angle);
  bluetooth.print(F(" TICKS "));
  bluetooth.println(ticks);
}

void moveGripper(int angle) {
  angle = constrain(angle, 0, 180);
  int pulse = gripperAngleToPulse(angle);

  smoothPwmMove(GRIPPER_CHANNEL, currentGripperPulse, pulse);

  Serial.print(F("OK NORMAL_GRIPPER_ANGLE "));
  Serial.print(angle);
  Serial.print(F(" PULSE "));
  Serial.println(pulse);

  bluetooth.print(F("OK NORMAL_GRIPPER_ANGLE "));
  bluetooth.print(angle);
  bluetooth.print(F(" PULSE "));
  bluetooth.println(pulse);
}

// =============================
// Pump Control
// =============================

void pumpOn() {
  pumpPulseActive = false;
  digitalWrite(PUMP_PIN, PUMP_RELAY_ON_LEVEL);
  sendReply(F("OK SUCTION_CUP_ON"));
}

void pumpOff() {
  pumpPulseActive = false;
  digitalWrite(PUMP_PIN, PUMP_RELAY_OFF_LEVEL);
  sendReply(F("OK SUCTION_CUP_OFF"));
}

void pumpPulse() {
  // Non-blocking pulse keeps USB/Bluetooth command handling responsive to EMERGENCY_STOP.
  sendReply(F("OK SUCTION_CUP_PULSE START"));
  pumpPulseActive = true;
  pumpPulseEndTime = millis() + 2000UL;
  digitalWrite(PUMP_PIN, PUMP_RELAY_ON_LEVEL);
}

void servicePumpPulse() {
  if (!pumpPulseActive) return;
  if ((long)(millis() - pumpPulseEndTime) < 0) return;

  pumpPulseActive = false;
  digitalWrite(PUMP_PIN, PUMP_RELAY_OFF_LEVEL);
  sendReply(F("OK SUCTION_CUP_PULSE COMPLETE"));
}

// =============================
// Platform Motor Control
// =============================

void setMotorA(int direction, int speedPWM) {
  if (direction > 0) {
    digitalWrite(MOTOR_A_IN1, HIGH);
    digitalWrite(MOTOR_A_IN2, LOW);
  } 
  else if (direction < 0) {
    digitalWrite(MOTOR_A_IN1, LOW);
    digitalWrite(MOTOR_A_IN2, HIGH);
  } 
  else {
    digitalWrite(MOTOR_A_IN1, LOW);
    digitalWrite(MOTOR_A_IN2, LOW);
  }

  analogWrite(MOTOR_A_EN, speedPWM);
}

void setMotorB(int direction, int speedPWM) {
  if (direction > 0) {
    digitalWrite(MOTOR_B_IN1, HIGH);
    digitalWrite(MOTOR_B_IN2, LOW);
  } 
  else if (direction < 0) {
    digitalWrite(MOTOR_B_IN1, LOW);
    digitalWrite(MOTOR_B_IN2, HIGH);
  } 
  else {
    digitalWrite(MOTOR_B_IN1, LOW);
    digitalWrite(MOTOR_B_IN2, LOW);
  }

  // D12 is not PWM on Uno, so Motor B enable is ON/OFF.
  digitalWrite(MOTOR_B_EN, speedPWM > 0 ? HIGH : LOW);
}

void movePlatform(int leftDirection, int rightDirection) {
  // With motor + wires on OUT1/OUT3 and - wires on OUT2/OUT4, 1 means IN1/IN3 HIGH.
  // If one side drives backward, change only that side's sign to -1.
  const int LEFT_MOTOR_DIRECTION_SIGN = 1;
  const int RIGHT_MOTOR_DIRECTION_SIGN = 1;

  setMotorA(leftDirection * LEFT_MOTOR_DIRECTION_SIGN, platformLeftSpeed);
  setMotorB(rightDirection * RIGHT_MOTOR_DIRECTION_SIGN, platformRightSpeed);
}

void stopPlatform() {
  setMotorA(0, 0);
  setMotorB(0, 0);
}

void runPlatformMotorTest() {
  // Short diagnostic pulses help verify L298N wiring without latching motion.
  sendReply(F("OK PLATFORM_MOTOR_TEST MOTOR_A"));
  setMotorA(1, 220);
  setMotorB(0, 0);
  delay(650);
  stopPlatform();
  delay(250);

  sendReply(F("OK PLATFORM_MOTOR_TEST MOTOR_B"));
  setMotorA(0, 0);
  setMotorB(1, 220);
  delay(650);
  stopPlatform();
  sendReply(F("OK PLATFORM_MOTOR_TEST COMPLETE"));
}

// =============================
// Safety / Home
// =============================

void stopAllOutputs() {
  pumpPulseActive = false;
  pwm.setPWM(ELBOW_CHANNEL, 0, 0);
  pwm.setPWM(WRIST_CHANNEL, 0, 0);
  pwm.setPWM(GRIPPER_CHANNEL, 0, 0);
  currentElbowPulse = -1;
  currentWristTicks = -1;
  currentGripperPulse = -1;

  stopPlatform();

  digitalWrite(PUMP_PIN, PUMP_RELAY_OFF_LEVEL);

  sendReply(F("OK ALL_OUTPUTS_STOPPED"));
}

void runHomeSequence() {
  sendReply(F("OK HOME START"));

  moveElbow(HOME_ELBOW_ANGLE);
  delay(700);

  moveWrist(HOME_WRIST_ANGLE);
  delay(700);

  moveGripper(HOME_GRIPPER_ANGLE);
  delay(500);

  sendReply(F("OK HOME COMPLETE"));
}

// =============================
// Command Handler
// =============================

void handleCommand(char *command, const char *source) {
  if (command[0] == '\0') return;

  Serial.print(F("Received from "));
  Serial.print(source);
  Serial.print(F(": "));
  Serial.println(command);

  if (strcmp(command, "EMERGENCY_STOP") == 0) {
    emergencyActive = true;
    stopAllOutputs();
    sendReply(F("OK EMERGENCY_STOP"));
    return;
  }

  if (strcmp(command, "RESET_EMERGENCY") == 0) {
    emergencyActive = false;
    sendReply(F("OK RESET_EMERGENCY"));
    return;
  }

  if (emergencyActive) {
    sendReply(F("ERROR EMERGENCY_ACTIVE"));
    return;
  }

  if (strcmp(command, "HOME") == 0) {
    runHomeSequence();
    return;
  }

  if (strcmp(command, "GRIPPING_TOOL:NORMAL_GRIPPER") == 0) {
    pumpOff();
    sendReply(F("OK GRIPPING_TOOL NORMAL_GRIPPER"));
    return;
  }

  if (strcmp(command, "GRIPPING_TOOL:PNEUMATIC_SUCTION_CUP") == 0) {
    sendReply(F("OK GRIPPING_TOOL PNEUMATIC_SUCTION_CUP"));
    return;
  }

  if (commandStartsWith(command, "ELBOW_JOINT:")) {
    moveElbow(getValueAfterColon(command));
    return;
  }

  if (commandStartsWith(command, "WRIST_JOINT:")) {
    moveWrist(getValueAfterColon(command));
    return;
  }

  if (commandStartsWith(command, "NORMAL_GRIPPER_ANGLE:")) {
    moveGripper(getValueAfterColon(command));
    return;
  }

  if (strcmp(command, "SUCTION_CUP_ON") == 0) {
    pumpOn();
    return;
  }

  if (strcmp(command, "SUCTION_CUP_OFF") == 0) {
    pumpOff();
    return;
  }

  if (strcmp(command, "SUCTION_CUP_PULSE") == 0) {
    pumpPulse();
    return;
  }

  if (strcmp(command, "PLATFORM_FORWARD") == 0) {
    movePlatform(1, 1);
    sendReply(F("OK PLATFORM_FORWARD"));
    return;
  }

  if (strcmp(command, "PLATFORM_BACKWARD") == 0) {
    movePlatform(-1, -1);
    sendReply(F("OK PLATFORM_BACKWARD"));
    return;
  }

  if (strcmp(command, "PLATFORM_LEFT") == 0) {
    movePlatform(-1, 1);
    sendReply(F("OK PLATFORM_LEFT"));
    return;
  }

  if (strcmp(command, "PLATFORM_RIGHT") == 0) {
    movePlatform(1, -1);
    sendReply(F("OK PLATFORM_RIGHT"));
    return;
  }

  if (strcmp(command, "PLATFORM_STOP") == 0) {
    stopPlatform();
    sendReply(F("OK PLATFORM_STOP"));
    return;
  }

  if (strcmp(command, "PLATFORM_MOTOR_TEST") == 0) {
    runPlatformMotorTest();
    return;
  }

  if (strcmp(command, "PLATFORM_FORWARD_RIGHT") == 0) {
    movePlatform(1, 0);
    sendReply(F("OK PLATFORM_FORWARD_RIGHT"));
    return;
  }

  if (strcmp(command, "PLATFORM_FORWARD_LEFT") == 0) {
    movePlatform(0, 1);
    sendReply(F("OK PLATFORM_FORWARD_LEFT"));
    return;
  }

  if (strcmp(command, "PLATFORM_BACKWARD_RIGHT") == 0) {
    movePlatform(-1, 0);
    sendReply(F("OK PLATFORM_BACKWARD_RIGHT"));
    return;
  }

  if (strcmp(command, "PLATFORM_BACKWARD_LEFT") == 0) {
    movePlatform(0, -1);
    sendReply(F("OK PLATFORM_BACKWARD_LEFT"));
    return;
  }

  if (commandStartsWith(command, "PLATFORM_LEFT_MOTOR_SPEED:")) {
    char *speedText = getTextAfterColon(command);
    platformLeftSpeed = speedTextToPWM(speedText);
    sendReply(F("OK PLATFORM_LEFT_MOTOR_SPEED"));
    return;
  }

  if (commandStartsWith(command, "PLATFORM_RIGHT_MOTOR_SPEED:")) {
    char *speedText = getTextAfterColon(command);
    platformRightSpeed = speedTextToPWM(speedText);
    sendReply(F("OK PLATFORM_RIGHT_MOTOR_SPEED"));
    return;
  }

  if (commandStartsWith(command, "PLATFORM_BOTH_MOTORS_SPEED:")) {
    char *speedText = getTextAfterColon(command);
    int pwmValue = speedTextToPWM(speedText);
    platformLeftSpeed = pwmValue;
    platformRightSpeed = pwmValue;
    sendReply(F("OK PLATFORM_BOTH_MOTORS_SPEED"));
    return;
  }

  // Backward compatibility with old website command names
  if (commandStartsWith(command, "PLATFORM_MOTOR_1_SPEED:")) {
    char *speedText = getTextAfterColon(command);
    platformLeftSpeed = speedTextToPWM(speedText);
    sendReply(F("OK PLATFORM_MOTOR_1_SPEED_AS_LEFT"));
    return;
  }

  if (commandStartsWith(command, "PLATFORM_MOTOR_2_SPEED:")) {
    char *speedText = getTextAfterColon(command);
    platformRightSpeed = speedTextToPWM(speedText);
    sendReply(F("OK PLATFORM_MOTOR_2_SPEED_AS_RIGHT"));
    return;
  }

  if (commandStartsWith(command, "PLATFORM_ALL_MOTORS_SPEED:")) {
    char *speedText = getTextAfterColon(command);
    int pwmValue = speedTextToPWM(speedText);
    platformLeftSpeed = pwmValue;
    platformRightSpeed = pwmValue;
    sendReply(F("OK PLATFORM_ALL_MOTORS_SPEED_AS_BOTH"));
    return;
  }

  sendReply(F("ERROR UNKNOWN_COMMAND"));
}

// =============================
// Serial Reading
// =============================

void readSerialLine(Stream &port, char *buffer, byte &index, const char *source) {
  while (port.available()) {
    char c = port.read();

    if (c == '\r') {
      continue;
    }

    if (c == '\n') {
      buffer[index] = '\0';
      handleCommand(buffer, source);
      index = 0;
      return;
    }

    if (index < 49) {
      buffer[index] = c;
      index++;
    } 
    else {
      buffer[index] = '\0';
      handleCommand(buffer, source);
      index = 0;
      return;
    }
  }
}

// =============================
// Setup
// =============================

void setup() {
  Serial.begin(9600);
  bluetooth.begin(9600);

  pinMode(PUMP_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, PUMP_RELAY_OFF_LEVEL);

  pinMode(MOTOR_A_IN1, OUTPUT);
  pinMode(MOTOR_A_IN2, OUTPUT);
  pinMode(MOTOR_B_IN1, OUTPUT);
  pinMode(MOTOR_B_IN2, OUTPUT);
  pinMode(MOTOR_A_EN, OUTPUT);
  pinMode(MOTOR_B_EN, OUTPUT);

  // Force safe output states before the PCA9685 starts or any command is accepted.
  stopPlatform();
  digitalWrite(PUMP_PIN, PUMP_RELAY_OFF_LEVEL);

  Wire.begin();

  pwm.begin();
  pwm.setOscillatorFrequency(27000000);
  pwm.setPWMFreq(SERVO_FREQ);

  delay(1000);

  sendReply(F("READY ARM PLATFORM PNEUMATIC"));

  moveElbow(HOME_ELBOW_ANGLE);
  delay(300);

  moveWrist(HOME_WRIST_ANGLE);
  delay(300);

  moveGripper(HOME_GRIPPER_ANGLE);
  delay(300);

  pumpOff();
  stopPlatform();
}

// =============================
// Loop
// =============================

void loop() {
  servicePumpPulse();
  readSerialLine(Serial, usbBuffer, usbIndex, "USB");
  readSerialLine(bluetooth, btBuffer, btIndex, "Bluetooth");
}
