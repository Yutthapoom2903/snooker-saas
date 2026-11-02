// app_hwtest.cpp - step-by-step hardware bring-up firmware.
//
// Open the serial monitor at 115200 (pio device monitor) and follow the menu.
// Every step can be run on its own or skipped, so it is useful with only some
// parts connected. Results are printed and, once MQTT is up, also published to
// snk/dev/{deviceId}/log so they show up in Admin -> Devices.
//
// Settings (WiFi, MQTT host/port, deviceId, secret) are entered with menu `p`
// (WiFiManager captive portal) and are shared with the production firmware.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>

#include "common/buttons.h"
#include "common/config.h"
#include "common/display.h"
#include "common/io.h"
#include "common/net.h"
#include "common/settings.h"

enum Result : uint8_t { R_NOT_RUN, R_PASS, R_FAIL, R_SKIP };
static const char *RESULT_TEXT[] = {"-", "PASS", "FAIL", "SKIP"};

static const uint8_t STEP_COUNT = 7;
static const char *STEP_NAMES[STEP_COUNT] = {
    "WiFi connect", "MQTT connect", "Timer display", "Score display",
    "Buttons",      "Relay",        "Buzzer",
};
static Result g_results[STEP_COUNT];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Keep background work alive while waiting for the user.
static void idle() {
  netLoop();
  ioLoop();
  delay(2);
}

// Waits for one key on Serial (ignores CR/LF unless acceptEnter).
static char waitKey(bool acceptEnter = false) {
  while (true) {
    idle();
    if (!Serial.available()) continue;
    char c = Serial.read();
    if (c == '\r' || c == '\n') {
      if (acceptEnter) {
        // swallow the second char of CRLF
        delay(5);
        while (Serial.peek() == '\n' || Serial.peek() == '\r') Serial.read();
        return '\n';
      }
      continue;
    }
    return tolower(c);
  }
}

static bool askYesNo(const char *question) {
  Serial.printf("  %s [y/n] ", question);
  while (true) {
    char c = waitKey();
    if (c == 'y' || c == 'n') {
      Serial.println(c);
      return c == 'y';
    }
  }
}

static void waitMs(uint32_t ms) {
  uint32_t start = millis();
  while (millis() - start < ms) idle();
}

static Result report(uint8_t step, bool ok, const char *detail) {
  Result r = ok ? R_PASS : R_FAIL;
  g_results[step] = r;
  netLog(ok ? "info" : "error", "hwtest %d %s: %s - %s", step + 1, STEP_NAMES[step],
         RESULT_TEXT[r], detail);
  return r;
}

// Prints Parola text immediately (static, no animation).
static char g_timerBuf[32];
static void timerText(const char *t) {
  strlcpy(g_timerBuf, t, sizeof(g_timerBuf));
  timerParola().displayShutdown(false);
  timerParola().write(g_timerBuf);
}

static void timerScrollBlocking(const char *t) {
  strlcpy(g_timerBuf, t, sizeof(g_timerBuf));
  MD_Parola &p = timerParola();
  p.displayClear();
  p.displayText(g_timerBuf, PA_LEFT, 40, 0, PA_SCROLL_LEFT, PA_SCROLL_LEFT);
  while (!p.displayAnimate()) idle();
}

// Lights every LED of an MD_MAX72XX at a LOW intensity. (The MAX7219's own
// display-test mode is not used: it forces full brightness, ~1.3 A per 4-in-1.)
static void allOn(MD_MAX72XX &mx, uint8_t intensity) {
  mx.control(MD_MAX72XX::INTENSITY, intensity);
  mx.control(MD_MAX72XX::UPDATE, MD_MAX72XX::OFF);
  for (uint16_t c = 0; c < mx.getColumnCount(); c++) mx.setColumn(c, 0xFF);
  mx.control(MD_MAX72XX::UPDATE, MD_MAX72XX::ON);
}
static void allOff(MD_MAX72XX &mx, uint8_t intensity) {
  mx.clear();
  mx.control(MD_MAX72XX::INTENSITY, intensity);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

static Result stepWifi() {
  if (!settingsHasWifi()) return report(0, false, "no WiFi saved - use menu p (config portal)");
  Serial.printf("  connecting to '%s' ...\n", WiFi.SSID().length() ? WiFi.SSID().c_str() : "saved network");
  if (!netWifiConnect(20000)) {
    return report(0, false, "not connected after 20 s - check SSID/password, 2.4 GHz only");
  }
  char d[96];
  int rssi = WiFi.RSSI();
  snprintf(d, sizeof(d), "ip=%s rssi=%d dBm%s", WiFi.localIP().toString().c_str(), rssi,
           rssi < -75 ? " (weak signal: move closer / add AP)" : "");
  return report(0, true, d);
}

static Result stepMqtt() {
  settingsPrint(Serial);
  String err;
  if (!netMqttConnect(err)) {
    Serial.println("  hint: device must be registered in Admin -> Devices first, and");
    Serial.println("        Windows Firewall must allow inbound TCP 1883 to the PC.");
    return report(1, false, err.c_str());
  }
  Serial.println("  connected; waiting 3 s for the retained session cmd ...");
  JsonDocument st;
  st["online"] = true;
  st["fw"] = FW_VERSION "-hwtest";
  st["ip"] = WiFi.localIP().toString();
  st["rssi"] = WiFi.RSSI();
  st["uptime"] = millis() / 1000;
  st["light"] = relayGet();
  netPublish("status", st);
  waitMs(3000);
  char d[96];
  snprintf(d, sizeof(d), "connected to %s:%u as %s", settings.host, settings.port,
           settings.deviceId);
  return report(1, true, d);
}

static Result stepTimerDisplay() {
  Serial.println("  a) all LEDs on, low brightness (2 s)");
  MD_MAX72XX &tmx = *timerParola().getGraphicObject();
  allOn(tmx, 1);
  waitMs(2000);
  allOff(tmx, TIMER_INTENSITY);
  Serial.println("  b) text '1:23' centred (2 s)");
  timerText("1:23");
  waitMs(2000);
  Serial.println("  c) scrolling 'TIMER OK' right-to-left");
  timerScrollBlocking("TIMER OK");
  timerText("T1");
  Serial.println("  If letters are mirrored, upside-down or each 8x8 block is jumbled,");
  Serial.println("  change MATRIX_HW_TYPE in src/common/config.h (FC16_HW / PAROLA_HW /");
  Serial.println("  GENERIC_HW / ICSTATION_HW). If nothing lights: check 5V, GND, DIN=23,");
  Serial.println("  CLK=18, CS=5 and that you wired the module's INPUT side (DIN, not DOUT).");
  bool ok = askYesNo("Did all LEDs light, then '1:23', then readable scrolling text?");
  return report(2, ok, ok ? "user confirmed" : "user saw a problem");
}

static Result stepScoreDisplay() {
  MD_MAX72XX &mx = scoreMatrix();
  Serial.println("  a) all LEDs on, low brightness (2 s)");
  allOn(mx, 1);
  waitMs(2000);
  allOff(mx, SCORE_INTENSITY);
  Serial.println("  b) blocks 1..4 lit one by one, should go LEFT -> RIGHT");
  for (int blk = 0; blk < MATRIX_DEVICES; blk++) {
    scoreClear();
    char d[2] = {char('1' + blk), 0};
    scoreDrawText(blk * 8 + 2, d);
    scoreFlush();
    waitMs(700);
  }
  Serial.println("  c) score '34' (left) and '127' (right), underline under the left");
  scoreClear();
  scoreDrawText(14 - 9, "34");
  scoreDrawText(18, "127");
  for (int x = 0; x < 15; x++) mx.setPoint(7, 31 - x, true);
  scoreFlush();
  bool ok = askYesNo("Did all LEDs light, digits 1-4 go left->right, and '34  127' read correctly?");
  return report(3, ok, ok ? "user confirmed" : "user saw a problem (see MATRIX_HW_TYPE, CS=17)");
}

// Button step state (filled from the button callback)
static bool g_btnInStep = false;
static uint8_t g_btnSeenMask = 0;

static void onButton(ButtonEvent ev, uint8_t v) {
  if (!g_btnInStep) return;
  switch (ev) {
    case BTN_RAW_DOWN:
      g_btnSeenMask |= (1 << v);
      Serial.printf("  pressed  %-11s (GPIO %d)\n", buttonName(v), BUTTON_PINS[v]);
      beep(1, 30);
      scoreClear();
      { char d[2] = {char('1' + v), 0}; scoreDrawText(14, d); }
      scoreFlush();
      break;
    case BTN_RAW_UP: Serial.printf("  released %s\n", buttonName(v)); break;
    case BTN_POINTS: Serial.printf("    -> gesture: +%d points\n", v); break;
    case BTN_FOUL: Serial.printf("    -> gesture: FOUL %d (min 4) to opponent\n", v); break;
    case BTN_SWITCH: Serial.println("    -> gesture: SWITCH player"); break;
    case BTN_UNDO: Serial.println("    -> gesture: UNDO"); break;
    case BTN_NEW_FRAME: Serial.println("    -> gesture: NEW FRAME"); break;
    case BTN_HOLD_1S: Serial.println("    (held 1 s: release now = undo)"); break;
    case BTN_HOLD_3S: Serial.println("    (held 3 s: release now = new frame)"); break;
  }
}

static Result stepButtons() {
  // A button that reads "pressed" before anyone touches it is shorted or miswired.
  char stuck[96] = "";
  for (uint8_t i = 0; i < BTN_COUNT; i++) {
    if (buttonPressedRaw(i)) {
      strlcat(stuck, buttonName(i), sizeof(stuck));
      strlcat(stuck, " ", sizeof(stuck));
    }
  }
  if (stuck[0]) Serial.printf("  WARNING: reads pressed while idle: %s(shorted to GND?)\n", stuck);

  Serial.println("  Press every button once (try gestures too). Enter = finish.");
  g_btnSeenMask = 0;
  g_btnInStep = true;
  const uint8_t all = (1 << BTN_COUNT) - 1;
  while (true) {
    buttonsLoop();
    idle();
    if (g_btnSeenMask == all) {
      Serial.println("  all 8 buttons seen - press more or Enter to finish");
      while (true) {
        buttonsLoop();
        idle();
        if (Serial.available() && (Serial.peek() == '\r' || Serial.peek() == '\n')) break;
        if (Serial.available()) Serial.read();
      }
      break;
    }
    if (Serial.available()) {
      char c = Serial.read();
      if (c == '\r' || c == '\n') break;
    }
  }
  while (Serial.available()) Serial.read();
  g_btnInStep = false;

  char missing[128] = "";
  for (uint8_t i = 0; i < BTN_COUNT; i++) {
    if (!(g_btnSeenMask & (1 << i))) {
      strlcat(missing, buttonName(i), sizeof(missing));
      strlcat(missing, " ", sizeof(missing));
    }
  }
  bool ok = missing[0] == '\0' && stuck[0] == '\0';
  char d[200];
  if (ok) snprintf(d, sizeof(d), "all 8 buttons work");
  else snprintf(d, sizeof(d), "never pressed: %s%s%s", missing[0] ? missing : "-",
                stuck[0] ? " | stuck: " : "", stuck);
  return report(4, ok, d);
}

static Result stepRelay() {
  Serial.println("  Relay ON 1 s / OFF 1 s, three times (listen for the click,");
  Serial.println("  watch the module LED). Use a 12 V test lamp, NOT mains, for now.");
  for (int i = 0; i < 3; i++) {
    relaySet(true);
    Serial.println("  relay ON");
    waitMs(1000);
    relaySet(false);
    Serial.println("  relay OFF");
    waitMs(1000);
  }
  Serial.println("  If it never releases: the module may need 5 V on IN; see BOM/WIRING");
  Serial.println("  (JD-VCC jumper trick) or flip RELAY_ACTIVE_LOW in config.h.");
  bool ok = askYesNo("Did the relay click on and off 3 times (and the lamp follow)?");
  return report(5, ok, ok ? "user confirmed" : "no click / stuck");
}

static Result stepBuzzer() {
  Serial.println("  3 short beeps, then 1 long beep");
  beep(3, 80, 120);
  waitMs(800);
  beep(1, 500);
  waitMs(700);
  bool ok = askYesNo("Did you hear 3 short + 1 long beep? (n if no buzzer fitted)");
  return report(6, ok, ok ? "user confirmed" : "no sound (optional part)");
}

static Result runStep(uint8_t i) {
  Serial.printf("\n--- Step %d: %s ---\n", i + 1, STEP_NAMES[i]);
  switch (i) {
    case 0: return stepWifi();
    case 1: return stepMqtt();
    case 2: return stepTimerDisplay();
    case 3: return stepScoreDisplay();
    case 4: return stepButtons();
    case 5: return stepRelay();
    case 6: return stepBuzzer();
  }
  return R_NOT_RUN;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

static void printSummary() {
  Serial.println("\n  Step              Result");
  for (uint8_t i = 0; i < STEP_COUNT; i++) {
    Serial.printf("  %d %-15s %s\n", i + 1, STEP_NAMES[i], RESULT_TEXT[g_results[i]]);
  }
}

static void printMenu() {
  Serial.printf("\n==== Snooker HW test (fw %s) ====\n", FW_VERSION);
  Serial.printf("  WiFi: %s   MQTT: %s\n", netWifiUp() ? WiFi.localIP().toString().c_str() : "down",
                netMqttUp() ? "up" : "down");
  Serial.println("  1) WiFi connect      2) MQTT connect");
  Serial.println("  3) Timer display     4) Score display");
  Serial.println("  5) Buttons           6) Relay");
  Serial.println("  7) Buzzer");
  Serial.println("  a) run all (each step: Enter = run, s = skip)");
  Serial.println("  r) results   i) show settings   p) config portal (WiFi + server)");
  Serial.print("> ");
}

static void runAll() {
  for (uint8_t i = 0; i < STEP_COUNT; i++) {
    Serial.printf("\nStep %d: %s - Enter = run, s = skip, q = stop ", i + 1, STEP_NAMES[i]);
    char c = waitKey(true);
    Serial.println();
    if (c == 'q') break;
    if (c == 's') {
      g_results[i] = R_SKIP;
      continue;
    }
    runStep(i);
  }
  printSummary();
}

// Commands received while hwtest runs are printed and acknowledged, so
// Admin -> Devices "send test" can be tried before flashing the main firmware.
static void onCmd(const char *payload, size_t len) {
  Serial.printf("\n  [cmd received] %.*s\n", (int)len, payload);
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;
  const char *type = doc["type"] | "";
  if (!strcmp(type, "test")) {
    const char *action = doc["action"] | "";
    if (!strcmp(action, "relay")) relayPulse(2000);
    else if (!strcmp(action, "text")) timerText(doc["text"] | "TEST");
    else if (!strcmp(action, "blink")) beep(1);
    netLog("info", "hwtest got test %s ok", action);
  }
}

void setup() {
  ioBegin();
  Serial.begin(115200);
  delay(300);
  settingsLoad();
  displayBegin();
  timerText("TEST");
  scoreClear();
  scoreDrawText(6, "8888");   // quick visual "alive" check at power-on
  scoreFlush();
  buttonsBegin(onButton);
  netBegin(onCmd, nullptr, /*autoConnect=*/false);
  printMenu();
}

void loop() {
  idle();
  if (!Serial.available()) return;
  char c = tolower(Serial.read());
  if (c == '\r' || c == '\n' || c == ' ') return;
  Serial.println(c);
  if (c >= '1' && c <= '7') runStep(c - '1');
  else if (c == 'a') runAll();
  else if (c == 'r') printSummary();
  else if (c == 'i') settingsPrint(Serial);
  else if (c == 'p') {
    timerText("SETUP");
    settingsRunPortal();
    Serial.println("  restarting to apply settings ...");
    delay(500);
    ESP.restart();
  }
  printMenu();
}
