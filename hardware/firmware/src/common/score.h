// score.h - snooker score state machine (device owns the score logic).
//
// State matches the contract payload:
//   { "p1", "p2", "f1", "f2", "active", "brk" }
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

struct ScoreState {
  uint16_t p1 = 0, p2 = 0;   // points in the current frame
  uint8_t f1 = 0, f2 = 0;    // frames won
  uint8_t active = 1;        // player at the table, 1 or 2
  uint16_t brk = 0;          // current break of the active player
};

class Score {
 public:
  const ScoreState &state() const { return s_; }

  // Each mutator returns true if the state changed (caller then publishes).
  bool addPoints(uint8_t n);       // pot: +n to active player, break += n
  bool foul(uint8_t n);            // max(4,n) to the opponent, turn passes
  bool switchPlayer();             // end of visit: other player, break = 0
  bool newFrame();                 // frame to the leader; false on a tie
  bool undo();                     // restore the state before the last change
  void overwrite(const ScoreState &s);  // from server `score` cmd; clears undo

  void toJson(JsonDocument &doc) const;
  // Parses a contract payload; missing fields keep current values.
  static bool fromJson(const JsonDocument &doc, ScoreState &out, const ScoreState &base);

 private:
  void pushUndo();
  ScoreState s_;
  static const uint8_t UNDO_DEPTH = 20;
  ScoreState undo_[UNDO_DEPTH];
  uint8_t undoCount_ = 0, undoHead_ = 0;   // ring buffer
};
