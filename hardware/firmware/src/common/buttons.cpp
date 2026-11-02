// buttons.cpp - see buttons.h. Simple polling debounce, no interrupts.
#include "buttons.h"
#include "config.h"

const uint8_t BUTTON_PINS[BTN_COUNT] = {
    PIN_BTN_RED,  PIN_BTN_YELLOW, PIN_BTN_GREEN, PIN_BTN_BROWN,
    PIN_BTN_BLUE, PIN_BTN_PINK,   PIN_BTN_BLACK, PIN_BTN_SWITCH,
};

static const char *BUTTON_NAMES[BTN_COUNT] = {
    "RED(+1)", "YELLOW(+2)", "GREEN(+3)", "BROWN(+4)",
    "BLUE(+5)", "PINK(+6)", "BLACK(+7)", "SWITCH",
};

struct BtnState {
  bool stable = false;       // debounced state, true = pressed
  bool lastRaw = false;
  uint32_t changedAt = 0;    // time of last raw change
};

static BtnState g_btn[BTN_COUNT];
static ButtonCallback g_cb = nullptr;

// SWITCH gesture state
static uint32_t g_switchDownAt = 0;
static bool g_switchUsedForFoul = false;
static bool g_hold1Sent = false, g_hold3Sent = false;

bool buttonPressedRaw(uint8_t i) { return digitalRead(BUTTON_PINS[i]) == LOW; }

const char *buttonName(uint8_t i) { return i < BTN_COUNT ? BUTTON_NAMES[i] : "?"; }

void buttonsBegin(ButtonCallback cb) {
  g_cb = cb;
  for (uint8_t i = 0; i < BTN_COUNT; i++) {
    pinMode(BUTTON_PINS[i], INPUT_PULLUP);
  }
  delay(5);
  for (uint8_t i = 0; i < BTN_COUNT; i++) {
    g_btn[i].stable = g_btn[i].lastRaw = buttonPressedRaw(i);
    g_btn[i].changedAt = millis();
  }
  // A SWITCH held at boot (portal gesture) must not count as a press.
  g_switchUsedForFoul = g_btn[BTN_IDX_SWITCH].stable;
  g_switchDownAt = millis();
}

static void emit(ButtonEvent ev, uint8_t v) {
  if (g_cb) g_cb(ev, v);
}

static void onEdge(uint8_t i, bool pressed, uint32_t now) {
  emit(pressed ? BTN_RAW_DOWN : BTN_RAW_UP, i);

  if (i == BTN_IDX_SWITCH) {
    if (pressed) {
      g_switchDownAt = now;
      g_switchUsedForFoul = false;
      g_hold1Sent = g_hold3Sent = false;
    } else if (!g_switchUsedForFoul) {
      uint32_t held = now - g_switchDownAt;
      if (held >= BTN_HOLD_FRAME_MS) emit(BTN_NEW_FRAME, 0);
      else if (held >= BTN_HOLD_UNDO_MS) emit(BTN_UNDO, 0);
      else emit(BTN_SWITCH, 0);
    }
    return;
  }

  // Colour buttons act on press for snappy feedback.
  if (pressed) {
    if (g_btn[BTN_IDX_SWITCH].stable) {
      g_switchUsedForFoul = true;   // SWITCH is a modifier this time
      emit(BTN_FOUL, i + 1);
    } else {
      emit(BTN_POINTS, i + 1);
    }
  }
}

void buttonsLoop() {
  uint32_t now = millis();
  for (uint8_t i = 0; i < BTN_COUNT; i++) {
    BtnState &b = g_btn[i];
    bool raw = buttonPressedRaw(i);
    if (raw != b.lastRaw) {
      b.lastRaw = raw;
      b.changedAt = now;
    } else if (raw != b.stable && now - b.changedAt >= BTN_DEBOUNCE_MS) {
      b.stable = raw;
      onEdge(i, raw, now);
    }
  }

  // Hold feedback for SWITCH
  if (g_btn[BTN_IDX_SWITCH].stable && !g_switchUsedForFoul) {
    uint32_t held = now - g_switchDownAt;
    if (!g_hold1Sent && held >= BTN_HOLD_UNDO_MS) {
      g_hold1Sent = true;
      emit(BTN_HOLD_1S, 0);
    }
    if (!g_hold3Sent && held >= BTN_HOLD_FRAME_MS) {
      g_hold3Sent = true;
      emit(BTN_HOLD_3S, 0);
    }
  }
}
