// io.h - relay (table light), buzzer and status LED. All non-blocking.
#pragma once
#include <Arduino.h>

void ioBegin();          // call first thing in setup(): forces relay OFF
void ioLoop();           // call every loop()

void relaySet(bool on);  // the light state the server asked for
bool relayGet();         // actual relay state right now
// Turn the relay on for `ms`, then return to the last relaySet() state.
void relayPulse(uint32_t ms);

// Beep `count` times, each `onMs` long with `offMs` gaps. No-op if no buzzer.
void beep(uint8_t count = 1, uint16_t onMs = 60, uint16_t offMs = 80);

void ledSet(bool on);
