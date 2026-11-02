// buttons.h - debounced scoring buttons and the gesture scheme.
//
// Button index 0..6 = colour buttons worth 1..7 points
//   (red, yellow, green, brown, blue, pink, black); index 7 = SWITCH.
//
// Gestures (see hardware/WIRING.md "Score-button scheme"):
//   colour press                 -> BTN_POINTS(n)   n = 1..7
//   SWITCH held + colour press   -> BTN_FOUL(n)     (SWITCH release is then ignored)
//   SWITCH released < 1 s        -> BTN_SWITCH      switch player / end break
//   SWITCH released 1 s .. 3 s   -> BTN_UNDO
//   SWITCH released >= 3 s       -> BTN_NEW_FRAME
//   While SWITCH is held, BTN_HOLD_1S / BTN_HOLD_3S fire once each so the
//   firmware can beep to tell the player what will happen on release.
//   BTN_RAW_DOWN / BTN_RAW_UP fire for every edge (used by hwtest).
#pragma once
#include <Arduino.h>

enum ButtonEvent : uint8_t {
  BTN_RAW_DOWN,   // value = button index 0..7
  BTN_RAW_UP,     // value = button index 0..7
  BTN_POINTS,     // value = 1..7
  BTN_FOUL,       // value = 1..7 (colour pressed while SWITCH held)
  BTN_SWITCH,
  BTN_UNDO,
  BTN_NEW_FRAME,
  BTN_HOLD_1S,
  BTN_HOLD_3S,
};

typedef void (*ButtonCallback)(ButtonEvent ev, uint8_t value);

void buttonsBegin(ButtonCallback cb);
void buttonsLoop();

// Raw level of a button right now (true = pressed), no debounce.
bool buttonPressedRaw(uint8_t index);
const char *buttonName(uint8_t index);

extern const uint8_t BUTTON_PINS[];
#define BTN_IDX_SWITCH 7
