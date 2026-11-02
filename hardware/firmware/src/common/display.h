// display.h - the two MAX7219 8x32 displays.
//
// Timer display (MD_Parola): session state - table label / RSV + HH:MM /
//   running H:MM with blinking colon / paused (whole display blinks) /
//   one-shot scrolling text (test cmd) / status messages.
// Score display (raw MD_MAX72XX with a 4x7 font so 3-digit scores fit):
//   page A "p1  p2" with an underline under the active player,
//   page F frames "F 1-0", page B current break "B 23" (only when brk > 0).
#pragma once
#include <Arduino.h>
#include <MD_MAX72xx.h>
#include <MD_Parola.h>
#include "score.h"

enum SessionState : uint8_t { SS_NONE, SS_IDLE, SS_RESERVED, SS_RUNNING, SS_PAUSED };

struct SessionView {
  SessionState state = SS_NONE;
  char table[8] = "";
  uint32_t elapsedMs = 0;     // elapsed at the moment the cmd was received
  uint32_t receivedAt = 0;    // millis() when the cmd was received
  int64_t reservedAt = 0;     // epoch ms of the booking start (reserved only)
  char reservedLocal[6] = ""; // "HH:MM" from the server; preferred over reservedAt
};

void displayBegin();
void displayLoop();

// Timer display
void timerShowSession(const SessionView &s);
void timerShowMessage(const char *msg);  // shown while no session is known
void timerScroll(const char *text);      // one-shot scroll, then back to normal
bool timerScrolling();

// Score display
void scoreShow(const ScoreState &s);
void scoreShowMessage(const char *msg);  // e.g. "AP" during the config portal

// Blink both displays `times` times (test cmd), non-blocking.
void displayBlinkAll(uint8_t times);

// Direct access for hwtest patterns.
MD_Parola &timerParola();
MD_MAX72XX &scoreMatrix();
void scoreDrawText(int x, const char *text);  // 4x7 font, x from the left
void scoreClear();
void scoreFlush();
