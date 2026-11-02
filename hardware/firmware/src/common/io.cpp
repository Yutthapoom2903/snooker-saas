// io.cpp - see io.h
#include "io.h"
#include "config.h"

static bool g_lightWanted = false;   // state requested by the server
static bool g_relayOn = false;       // state actually applied to the pin
static uint32_t g_pulseUntil = 0;    // relayPulse() end time, 0 = none

static uint8_t g_beepsLeft = 0;      // remaining beeps in the pattern
static uint16_t g_beepOn = 0, g_beepOff = 0;
static bool g_buzzerOn = false;
static uint32_t g_beepNext = 0;

static void writeRelay(bool on) {
  g_relayOn = on;
  digitalWrite(PIN_RELAY, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW);
}

static void writeBuzzer(bool on) {
  g_buzzerOn = on;
  digitalWrite(PIN_BUZZER, (on ^ BUZZER_ACTIVE_LOW) ? HIGH : LOW);
}

void ioBegin() {
  // Set the output level BEFORE switching the pin to output so the relay
  // does not click on at boot.
  digitalWrite(PIN_RELAY, RELAY_ACTIVE_LOW ? HIGH : LOW);
  pinMode(PIN_RELAY, OUTPUT);
  writeRelay(false);

  digitalWrite(PIN_BUZZER, BUZZER_ACTIVE_LOW ? HIGH : LOW);
  pinMode(PIN_BUZZER, OUTPUT);
  writeBuzzer(false);

  pinMode(PIN_LED, OUTPUT);
  ledSet(false);
}

void relaySet(bool on) {
  g_lightWanted = on;
  if (!g_pulseUntil) writeRelay(on);
}

bool relayGet() { return g_relayOn; }

void relayPulse(uint32_t ms) {
  g_pulseUntil = millis() + ms;
  if (g_pulseUntil == 0) g_pulseUntil = 1;
  writeRelay(true);
}

void beep(uint8_t count, uint16_t onMs, uint16_t offMs) {
  g_beepsLeft = count;
  g_beepOn = onMs;
  g_beepOff = offMs;
  g_beepNext = millis();
  writeBuzzer(false);
}

void ledSet(bool on) { digitalWrite(PIN_LED, on ? HIGH : LOW); }

void ioLoop() {
  uint32_t now = millis();

  if (g_pulseUntil && (int32_t)(now - g_pulseUntil) >= 0) {
    g_pulseUntil = 0;
    writeRelay(g_lightWanted);
  }

  if ((g_beepsLeft || g_buzzerOn) && (int32_t)(now - g_beepNext) >= 0) {
    if (g_buzzerOn) {
      writeBuzzer(false);
      g_beepNext = now + g_beepOff;
    } else if (g_beepsLeft) {
      g_beepsLeft--;
      writeBuzzer(true);
      g_beepNext = now + g_beepOn;
    }
  }
}
