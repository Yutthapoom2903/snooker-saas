// app_main.cpp - production firmware for one snooker table.
//
// Implements docs/mqtt-contract.md:
//   cmd session -> timer display + table light relay
//   cmd score   -> overwrite local score (restore after reboot / staff reset)
//   cmd test    -> blink / relay / text, answered with a `log` message
//   buttons     -> score logic, full state published to `score` after every change
//   status      -> right after connect and every 10 s; LWT {"online":false}
//
// Config portal: hold SWITCH (or the on-board BOOT button) while powering on,
// or hold BOOT for 3 s at any time.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>

#include "common/buttons.h"
#include "common/config.h"
#include "common/display.h"
#include "common/io.h"
#include "common/net.h"
#include "common/score.h"
#include "common/settings.h"

static Score g_score;
static SessionView g_session;
static uint32_t g_lastStatus = 0;

// Score changes made while offline are published on reconnect, and the
// server's restore `score` cmd that follows a connect is then ignored so it
// does not wipe those changes (see README "contract notes").
static bool g_scoreUnsent = false;
static uint32_t g_ignoreScoreCmdUntil = 0;

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------
static void publishStatus() {
  JsonDocument doc;
  doc["online"] = true;
  doc["fw"] = FW_VERSION;
  doc["ip"] = WiFi.localIP().toString();
  doc["rssi"] = WiFi.RSSI();
  doc["uptime"] = millis() / 1000;
  doc["light"] = relayGet();
  netPublish("status", doc);
  g_lastStatus = millis();
}

static void publishScore() {
  JsonDocument doc;
  g_score.toJson(doc);
  if (!netPublish("score", doc)) g_scoreUnsent = true;
  else g_scoreUnsent = false;
}

static void onScoreChanged() {
  scoreShow(g_score.state());
  publishScore();
}

// ---------------------------------------------------------------------------
// Commands from the server
// ---------------------------------------------------------------------------
static SessionState parseState(const char *s) {
  if (!s) return SS_NONE;
  if (!strcmp(s, "idle")) return SS_IDLE;
  if (!strcmp(s, "reserved")) return SS_RESERVED;
  if (!strcmp(s, "running")) return SS_RUNNING;
  if (!strcmp(s, "paused")) return SS_PAUSED;
  return SS_NONE;
}

static void handleSession(JsonDocument &doc) {
  SessionState st = parseState(doc["state"]);
  if (st == SS_NONE) {
    netLog("warn", "session: unknown state '%s'", (const char *)(doc["state"] | ""));
    return;
  }
  g_session.state = st;
  strlcpy(g_session.table, doc["table"] | "", sizeof(g_session.table));
  g_session.elapsedMs = doc["elapsedMs"] | 0UL;
  g_session.receivedAt = millis();
  g_session.reservedAt = doc["reservedAt"] | (int64_t)0;
  strlcpy(g_session.reservedLocal, doc["reservedLocal"] | "", sizeof(g_session.reservedLocal));
  timerShowSession(g_session);

  if (!doc["light"].isNull()) {
    bool before = relayGet();
    relaySet(doc["light"].as<bool>());
    if (before != relayGet()) publishStatus();   // report the new light state now
  }
  Serial.printf("[cmd] session %s table=%s elapsed=%lu\n", (const char *)doc["state"],
                g_session.table, (unsigned long)g_session.elapsedMs);
}

static void handleScore(JsonDocument &doc) {
  if ((int32_t)(millis() - g_ignoreScoreCmdUntil) < 0) {
    netLog("info", "score cmd ignored: local changes made offline were just published");
    return;
  }
  ScoreState s;
  Score::fromJson(doc, s, g_score.state());
  g_score.overwrite(s);
  scoreShow(g_score.state());
  Serial.println("[cmd] score overwritten");
}

static void handleTest(JsonDocument &doc) {
  const char *action = doc["action"] | "";
  if (!strcmp(action, "blink")) {
    displayBlinkAll(3);
    beep(1);
    netLog("info", "test blink ok");
  } else if (!strcmp(action, "relay")) {
    relayPulse(2000);
    netLog("info", "test relay ok (on 2 s, then back to %s)", relayGet() ? "on" : "off");
  } else if (!strcmp(action, "text")) {
    const char *text = doc["text"] | "TEST";
    timerScroll(text);
    netLog("info", "test text ok: %s", text);
  } else {
    netLog("warn", "test: unknown action '%s'", action);
  }
}

static void onCmd(const char *payload, size_t len) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, len);
  if (err) {
    netLog("error", "cmd: bad JSON (%s)", err.c_str());
    return;
  }
  const char *type = doc["type"] | "";
  if (!strcmp(type, "session")) handleSession(doc);
  else if (!strcmp(type, "score")) handleScore(doc);
  else if (!strcmp(type, "test")) handleTest(doc);
  else netLog("warn", "cmd: unknown type '%s'", type);
}

static void onConnect() {
  publishStatus();
  if (g_scoreUnsent) {
    publishScore();
    g_ignoreScoreCmdUntil = millis() + 5000;
  }
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
static void onButton(ButtonEvent ev, uint8_t v) {
  switch (ev) {
    case BTN_POINTS:
      if (g_score.addPoints(v)) { beep(1, 40); onScoreChanged(); }
      break;
    case BTN_FOUL:
      if (g_score.foul(v)) { beep(2, 80); onScoreChanged(); }
      break;
    case BTN_SWITCH:
      if (g_score.switchPlayer()) { beep(1, 120); onScoreChanged(); }
      break;
    case BTN_UNDO:
      if (g_score.undo()) { beep(2, 40); onScoreChanged(); }
      else beep(1, 400);   // nothing to undo
      break;
    case BTN_NEW_FRAME:
      if (g_score.newFrame()) { beep(3, 60); onScoreChanged(); }
      else beep(1, 600);   // tie: cannot award the frame
      break;
    case BTN_HOLD_1S: beep(1, 30); break;      // "release now = undo"
    case BTN_HOLD_3S: beep(2, 30, 60); break;  // "release now = new frame"
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Config portal
// ---------------------------------------------------------------------------
static void runPortalAndRestart() {
  timerShowMessage("SETUP");
  scoreShowMessage("AP");
  displayLoop();
  settingsRunPortal();
  ESP.restart();
}

// True if SWITCH or BOOT is held for 3 s right after power-on.
static bool portalRequestedAtBoot() {
  pinMode(PIN_BTN_SWITCH, INPUT_PULLUP);
  pinMode(PIN_BTN_BOOT, INPUT_PULLUP);
  delay(10);
  auto held = []() {
    return digitalRead(PIN_BTN_SWITCH) == LOW || digitalRead(PIN_BTN_BOOT) == LOW;
  };
  if (!held()) return false;
  timerShowMessage("HOLD");
  uint32_t start = millis();
  while (held()) {
    if (millis() - start >= BOOT_HOLD_PORTAL_MS) return true;
    delay(20);
  }
  timerShowMessage("BOOT");
  return false;
}

static void checkBootButtonRuntime() {
  static uint32_t downSince = 0;
  if (digitalRead(PIN_BTN_BOOT) == LOW) {
    if (!downSince) downSince = millis();
    if (millis() - downSince >= BOOT_HOLD_PORTAL_MS) runPortalAndRestart();
  } else {
    downSince = 0;
  }
}

// ---------------------------------------------------------------------------

void setup() {
  ioBegin();   // relay OFF before anything else
  Serial.begin(115200);
  delay(50);
  Serial.printf("\n=== Snooker table device fw %s ===\n", FW_VERSION);

  settingsLoad();
  displayBegin();
  timerShowMessage("BOOT");
  displayLoop();

  if (portalRequestedAtBoot()) {
    Serial.println("[boot] portal requested by button");
    runPortalAndRestart();
  }
  if (!settingsHasWifi() || !settings.complete()) {
    Serial.println("[boot] settings incomplete -> config portal");
    runPortalAndRestart();
  }
  settingsPrint(Serial);

  buttonsBegin(onButton);
  netBegin(onCmd, onConnect);
  scoreShow(g_score.state());
  timerShowMessage("WIFI");
}

void loop() {
  buttonsLoop();
  netLoop();
  ioLoop();
  checkBootButtonRuntime();

  uint32_t now = millis();
  bool wifi = netWifiUp(), mqtt = netMqttUp();

  // Status text on the timer until the first session cmd arrives.
  if (g_session.state == SS_NONE) {
    timerShowMessage(!wifi ? "WIFI" : !mqtt ? "MQTT" : "----");
  }

  if (mqtt && now - g_lastStatus >= STATUS_INTERVAL_MS) publishStatus();

  // LED: solid = MQTT connected, slow blink = offline.
  ledSet(mqtt || (now / 500) % 2);

  displayLoop();
}
