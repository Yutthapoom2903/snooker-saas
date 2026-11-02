// display.cpp - see display.h
#include "display.h"
#include "config.h"
#include <SPI.h>

// Both objects use the hardware SPI bus (VSPI CLK=18, MOSI=23) with their own CS.
static MD_Parola g_timer(MATRIX_HW_TYPE, PIN_CS_TIMER, MATRIX_DEVICES);
static MD_MAX72XX g_score(MATRIX_HW_TYPE, PIN_CS_SCORE, MATRIX_DEVICES);

static const int SCORE_COLS = MATRIX_DEVICES * 8;

MD_Parola &timerParola() { return g_timer; }
MD_MAX72XX &scoreMatrix() { return g_score; }

// ---------------------------------------------------------------------------
// Timer display
// ---------------------------------------------------------------------------
// Custom glyphs for the default Parola font (column bytes, bit 0 = top row).
// A fixed-width '1' stops the time from jiggling when digits change, and a
// blank glyph the same width as ':' lets the colon blink without shifting.
static const char BLANK_COLON = '\x01';
static const uint8_t GLYPH_ONE[] = {5, 0x00, 0x42, 0x7f, 0x40, 0x00};
static const uint8_t GLYPH_COLON[] = {2, 0x6c, 0x6c};
static const uint8_t GLYPH_BLANK_COLON[] = {2, 0x00, 0x00};

enum TimerMode : uint8_t { TM_MESSAGE, TM_SESSION, TM_SCROLL };

static TimerMode g_tmode = TM_MESSAGE;
static SessionView g_session;
static char g_timerText[16] = "";      // what is currently printed
static char g_timerMsg[16] = "----";   // TM_MESSAGE text
static char g_scrollBuf[96] = "";
static bool g_timerOff = false;        // shutdown state for paused-blink

static void timerPrint(const char *txt) {
  if (strcmp(txt, g_timerText) == 0) return;   // avoid needless SPI traffic
  strlcpy(g_timerText, txt, sizeof(g_timerText));
  // MD_Parola::write(const char*) keeps a pointer to the text, so always pass
  // our own persistent buffer (Print::print() would pass a temporary copy).
  g_timer.write(g_timerText);
}

static void timerSetOff(bool off) {
  if (off == g_timerOff) return;
  g_timerOff = off;
  g_timer.displayShutdown(off);
}

void timerShowSession(const SessionView &s) {
  g_session = s;
  if (g_tmode != TM_SCROLL) g_tmode = TM_SESSION;
}

void timerShowMessage(const char *msg) {
  strlcpy(g_timerMsg, msg, sizeof(g_timerMsg));
  if (g_tmode == TM_MESSAGE) {
    timerSetOff(false);
    timerPrint(g_timerMsg);
  }
}

void timerScroll(const char *text) {
  strlcpy(g_scrollBuf, text, sizeof(g_scrollBuf));
  g_tmode = TM_SCROLL;
  g_timerText[0] = '\0';
  timerSetOff(false);
  g_timer.displayClear();
  g_timer.displayText(g_scrollBuf, PA_LEFT, 40, 0, PA_SCROLL_LEFT, PA_SCROLL_LEFT);
}

bool timerScrolling() { return g_tmode == TM_SCROLL; }

// Formats milliseconds as H:MM (hours may grow past 9).
static void fmtElapsed(char *out, size_t n, uint32_t ms, bool colon) {
  uint32_t totalMin = ms / 60000UL;
  snprintf(out, n, "%lu%c%02lu", (unsigned long)(totalMin / 60),
           colon ? ':' : BLANK_COLON, (unsigned long)(totalMin % 60));
}

static void timerRenderSession(uint32_t now) {
  char buf[16];
  const SessionView &s = g_session;

  switch (s.state) {
    case SS_IDLE:
      timerSetOff(false);
      timerPrint(s.table[0] ? s.table : "----");
      break;

    case SS_RESERVED: {
      // Alternate "RSV" and the booking start time every 2 s.
      timerSetOff(false);
      if ((now / 2000) % 2 == 0) {
        timerPrint("RSV");
      } else if (s.reservedLocal[0]) {
        timerPrint(s.reservedLocal);
      } else {
        // Older servers: convert epoch with the fixed Bangkok offset.
        int64_t localMin = s.reservedAt / 60000LL + TZ_OFFSET_MIN;
        int minOfDay = (int)(((localMin % 1440) + 1440) % 1440);
        snprintf(buf, sizeof(buf), "%02d:%02d", minOfDay / 60, minOfDay % 60);
        timerPrint(buf);
      }
      break;
    }

    case SS_RUNNING: {
      uint32_t elapsed = s.elapsedMs + (now - s.receivedAt);
      bool colon = (elapsed / 1000) % 2 == 0;   // colon blinks each second
      timerSetOff(false);
      fmtElapsed(buf, sizeof(buf), elapsed, colon);
      timerPrint(buf);
      break;
    }

    case SS_PAUSED:
      fmtElapsed(buf, sizeof(buf), s.elapsedMs, true);
      timerPrint(buf);
      timerSetOff((now / 500) % 2 == 1);   // whole display blinks
      break;

    default:
      timerSetOff(false);
      timerPrint(g_timerMsg);
      break;
  }
}

// ---------------------------------------------------------------------------
// Score display: 4x7 font drawn pixel by pixel.
// Each glyph = 7 rows, low 4 bits used, bit 3 = leftmost column.
// ---------------------------------------------------------------------------
static const uint8_t FONT4X7_DIGITS[10][7] = {
    {0x6, 0x9, 0x9, 0x9, 0x9, 0x9, 0x6},  // 0
    {0x2, 0x6, 0x2, 0x2, 0x2, 0x2, 0x7},  // 1
    {0x6, 0x9, 0x1, 0x2, 0x4, 0x8, 0xF},  // 2
    {0x6, 0x9, 0x1, 0x6, 0x1, 0x9, 0x6},  // 3
    {0x2, 0x6, 0xA, 0xA, 0xF, 0x2, 0x2},  // 4
    {0xF, 0x8, 0xE, 0x1, 0x1, 0x9, 0x6},  // 5
    {0x6, 0x8, 0xE, 0x9, 0x9, 0x9, 0x6},  // 6
    {0xF, 0x1, 0x2, 0x2, 0x4, 0x4, 0x4},  // 7
    {0x6, 0x9, 0x9, 0x6, 0x9, 0x9, 0x6},  // 8
    {0x6, 0x9, 0x9, 0x7, 0x1, 0x1, 0x6},  // 9
};

static const uint8_t *glyph4x7(char c) {
  static const uint8_t F[7] = {0xF, 0x8, 0x8, 0xE, 0x8, 0x8, 0x8};
  static const uint8_t B[7] = {0xE, 0x9, 0x9, 0xE, 0x9, 0x9, 0xE};
  static const uint8_t A[7] = {0x6, 0x9, 0x9, 0xF, 0x9, 0x9, 0x9};
  static const uint8_t P[7] = {0xE, 0x9, 0x9, 0xE, 0x8, 0x8, 0x8};
  static const uint8_t DASH[7] = {0x0, 0x0, 0x0, 0x6, 0x0, 0x0, 0x0};
  static const uint8_t BLANK[7] = {0, 0, 0, 0, 0, 0, 0};
  if (c >= '0' && c <= '9') return FONT4X7_DIGITS[c - '0'];
  switch (c) {
    case 'F': return F;
    case 'B': return B;
    case 'A': return A;
    case 'P': return P;
    case '-': return DASH;
    default: return BLANK;
  }
}

// x = 0 is the leftmost column as seen from the front, y = 0 the top row.
static inline void scorePixel(int x, int y, bool on) {
  if (x < 0 || x >= SCORE_COLS || y < 0 || y > 7) return;
  g_score.setPoint(y, SCORE_COLS - 1 - x, on);
}

void scoreClear() {
  g_score.control(MD_MAX72XX::UPDATE, MD_MAX72XX::OFF);
  g_score.clear();
}

void scoreFlush() {
  g_score.control(MD_MAX72XX::UPDATE, MD_MAX72XX::ON);
}

void scoreDrawText(int x, const char *text) {
  for (; *text; text++, x += 5) {
    const uint8_t *g = glyph4x7(*text);
    for (int row = 0; row < 7; row++)
      for (int col = 0; col < 4; col++)
        if (g[row] & (0x8 >> col)) scorePixel(x + col, row, true);
  }
}

static int textWidth(const char *t) {
  int n = strlen(t);
  return n ? n * 5 - 1 : 0;
}

enum ScorePage : uint8_t { PAGE_POINTS, PAGE_FRAMES, PAGE_BREAK, PAGE_MESSAGE };

static ScoreState g_scoreState;
static ScorePage g_page = PAGE_MESSAGE;
static uint32_t g_pageSince = 0;
static char g_scoreMsg[8] = "";
static bool g_scoreDirty = true;

static void scoreRender() {
  char a[8], b[8];
  const int half = SCORE_COLS / 2;   // 16
  scoreClear();
  switch (g_page) {
    case PAGE_POINTS:
      // p1 right-aligned to column 13, p2 left-aligned from column 18.
      snprintf(a, sizeof(a), "%u", g_scoreState.p1 % 1000);
      snprintf(b, sizeof(b), "%u", g_scoreState.p2 % 1000);
      scoreDrawText(half - 2 - textWidth(a), a);
      scoreDrawText(half + 2, b);
      // Underline (row 7) under the active player's half.
      for (int x = 0; x < half - 1; x++)
        scorePixel(g_scoreState.active == 1 ? x : half + 1 + x, 7, true);
      break;
    case PAGE_FRAMES:
      snprintf(a, sizeof(a), "%u", g_scoreState.f1);
      snprintf(b, sizeof(b), "%u", g_scoreState.f2);
      scoreDrawText(0, "F");
      scoreDrawText(half - 2 - textWidth(a), a);
      scoreDrawText(half - 2, "-");    // dash centred at columns 13..16
      scoreDrawText(half + 2, b);
      break;
    case PAGE_BREAK:
      snprintf(a, sizeof(a), "%u", g_scoreState.brk % 1000);
      scoreDrawText(0, "B");
      scoreDrawText(SCORE_COLS - textWidth(a), a);
      // Small marker in row 7 under the "B" showing which player is on the break
      for (int x = 0; x < 4; x++) scorePixel(g_scoreState.active == 1 ? x : SCORE_COLS - 4 + x, 7, true);
      break;
    case PAGE_MESSAGE:
      scoreDrawText((SCORE_COLS - textWidth(g_scoreMsg)) / 2, g_scoreMsg);
      break;
  }
  scoreFlush();
}

void scoreShow(const ScoreState &s) {
  g_scoreState = s;
  g_page = PAGE_POINTS;   // any change jumps back to the main page
  g_pageSince = millis();
  g_scoreDirty = true;
}

void scoreShowMessage(const char *msg) {
  strlcpy(g_scoreMsg, msg, sizeof(g_scoreMsg));
  g_page = PAGE_MESSAGE;
  g_scoreDirty = true;
}

// Page rotation: points 5 s -> frames 1.5 s -> break 1.5 s (if brk > 0).
static void scoreRotate(uint32_t now) {
  uint32_t onPage = now - g_pageSince;
  ScorePage next = g_page;
  if (g_page == PAGE_POINTS && onPage >= 5000) next = PAGE_FRAMES;
  else if (g_page == PAGE_FRAMES && onPage >= 1500) next = g_scoreState.brk ? PAGE_BREAK : PAGE_POINTS;
  else if (g_page == PAGE_BREAK && onPage >= 1500) next = PAGE_POINTS;
  if (next != g_page) {
    g_page = next;
    g_pageSince = now;
    g_scoreDirty = true;
  }
}

// ---------------------------------------------------------------------------
// Blink-all effect (test cmd)
// ---------------------------------------------------------------------------
static uint8_t g_blinkToggles = 0;   // remaining on/off toggles
static uint32_t g_blinkNext = 0;
static bool g_blinkDark = false;

void displayBlinkAll(uint8_t times) {
  g_blinkToggles = times * 2;
  g_blinkNext = millis();
  g_blinkDark = false;
}

static void blinkLoop(uint32_t now) {
  if (!g_blinkToggles || (int32_t)(now - g_blinkNext) < 0) return;
  g_blinkDark = !g_blinkDark;
  g_blinkToggles--;
  g_blinkNext = now + 300;
  g_timer.displayShutdown(g_blinkDark);
  g_score.control(MD_MAX72XX::SHUTDOWN, g_blinkDark ? MD_MAX72XX::ON : MD_MAX72XX::OFF);
  if (!g_blinkToggles) g_timerOff = false;   // shutdown released above
}

// ---------------------------------------------------------------------------

void displayBegin() {
  g_timer.begin();
  g_timer.setIntensity(min(TIMER_INTENSITY, MATRIX_INTENSITY_MAX));
  g_timer.setTextAlignment(PA_CENTER);
  g_timer.addChar('1', GLYPH_ONE);
  g_timer.addChar(':', GLYPH_COLON);
  g_timer.addChar(BLANK_COLON, GLYPH_BLANK_COLON);
  g_timer.displayClear();
  timerPrint(g_timerMsg);

  g_score.begin();
  g_score.control(MD_MAX72XX::INTENSITY, min(SCORE_INTENSITY, MATRIX_INTENSITY_MAX));
  scoreShowMessage("");
}

void displayLoop() {
  uint32_t now = millis();

  if (g_blinkToggles) {
    blinkLoop(now);
    return;   // freeze content while blinking
  }

  if (g_tmode == TM_SCROLL) {
    if (g_timer.displayAnimate()) {   // true when the scroll has finished
      g_tmode = g_session.state == SS_NONE ? TM_MESSAGE : TM_SESSION;
      g_timerText[0] = '\0';
      g_timer.displayClear();
      if (g_tmode == TM_MESSAGE) timerPrint(g_timerMsg);
    }
  } else if (g_tmode == TM_SESSION) {
    timerRenderSession(now);
  }

  if (g_page != PAGE_MESSAGE) scoreRotate(now);
  if (g_scoreDirty) {
    g_scoreDirty = false;
    scoreRender();
  }
}
