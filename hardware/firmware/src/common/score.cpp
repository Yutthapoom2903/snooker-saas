// score.cpp - see score.h
#include "score.h"

void Score::pushUndo() {
  undo_[undoHead_] = s_;
  undoHead_ = (undoHead_ + 1) % UNDO_DEPTH;
  if (undoCount_ < UNDO_DEPTH) undoCount_++;
}

bool Score::addPoints(uint8_t n) {
  if (n < 1 || n > 7) return false;
  pushUndo();
  if (s_.active == 1) s_.p1 += n; else s_.p2 += n;
  s_.brk += n;
  return true;
}

bool Score::foul(uint8_t n) {
  if (n < 1 || n > 7) return false;
  uint8_t pts = n < 4 ? 4 : n;   // minimum foul penalty is 4
  pushUndo();
  // The player at the table fouled: points go to the opponent, who is next
  // to play. (If the opponent makes the fouler play again, press SWITCH.)
  if (s_.active == 1) { s_.p2 += pts; s_.active = 2; }
  else                { s_.p1 += pts; s_.active = 1; }
  s_.brk = 0;
  return true;
}

bool Score::switchPlayer() {
  pushUndo();
  s_.active = s_.active == 1 ? 2 : 1;
  s_.brk = 0;
  return true;
}

bool Score::newFrame() {
  if (s_.p1 == s_.p2) return false;   // tie: cannot decide who won the frame
  pushUndo();
  if (s_.p1 > s_.p2) s_.f1++; else s_.f2++;
  s_.p1 = s_.p2 = 0;
  s_.brk = 0;
  // Players alternate breaking off: player 1 breaks frames 1, 3, 5 ...
  s_.active = ((s_.f1 + s_.f2) % 2 == 0) ? 1 : 2;
  return true;
}

bool Score::undo() {
  if (!undoCount_) return false;
  undoHead_ = (undoHead_ + UNDO_DEPTH - 1) % UNDO_DEPTH;
  undoCount_--;
  s_ = undo_[undoHead_];
  return true;
}

void Score::overwrite(const ScoreState &s) {
  s_ = s;
  if (s_.active != 1 && s_.active != 2) s_.active = 1;
  undoCount_ = undoHead_ = 0;
}

void Score::toJson(JsonDocument &doc) const {
  doc["p1"] = s_.p1;
  doc["p2"] = s_.p2;
  doc["f1"] = s_.f1;
  doc["f2"] = s_.f2;
  doc["active"] = s_.active;
  doc["brk"] = s_.brk;
}

bool Score::fromJson(const JsonDocument &doc, ScoreState &out, const ScoreState &base) {
  out = base;
  out.p1 = doc["p1"] | base.p1;
  out.p2 = doc["p2"] | base.p2;
  out.f1 = doc["f1"] | base.f1;
  out.f2 = doc["f2"] | base.f2;
  out.active = doc["active"] | base.active;
  out.brk = doc["brk"] | base.brk;
  return true;
}
