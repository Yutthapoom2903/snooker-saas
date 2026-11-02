// config.h - pin map and compile-time constants for the snooker table device.
//
// Board: ESP32 DevKit V1 (ESP32-WROOM-32). See hardware/WIRING.md for the
// wiring diagram. Runtime settings (WiFi, MQTT host/port, deviceId, secret)
// are NOT here: they are entered in the WiFiManager captive portal and stored
// in NVS (see settings.h).
#pragma once
#include <Arduino.h>

#define FW_VERSION "1.0.0"

// ---------------------------------------------------------------------------
// MAX7219 dot-matrix displays (two separate 8x32 "4-in-1" modules).
// Both share the hardware SPI bus (VSPI: CLK=18, MOSI=23) and each has its own
// CS/LOAD pin, so either display can be missing or tested on its own.
// ---------------------------------------------------------------------------
#define PIN_SPI_CLK   18   // -> CLK on both modules
#define PIN_SPI_MOSI  23   // -> DIN on both modules
#define PIN_CS_TIMER   5   // -> CS on the timer module
#define PIN_CS_SCORE  17   // -> CS on the score module

// Module type. The common blue "FC-16" 4-in-1 boards from Shopee/Lazada are
// FC16_HW. If text appears mirrored / upside-down / scrambled per 8x8 block,
// try PAROLA_HW, GENERIC_HW or ICSTATION_HW (hwtest step 3/4 helps decide).
#define MATRIX_HW_TYPE  MD_MAX72XX::FC16_HW
#define MATRIX_DEVICES  4      // 8x8 blocks per display (4-in-1 = 4)

// Brightness 0..15. Kept low on purpose: at 15 eight 8x8 blocks can draw >2 A.
// 3-5 is plenty indoors. Do not raise above MATRIX_INTENSITY_MAX.
#define TIMER_INTENSITY      4
#define SCORE_INTENSITY      4
#define MATRIX_INTENSITY_MAX 8

// ---------------------------------------------------------------------------
// Buttons: momentary push buttons between the GPIO and GND (internal pull-up,
// pressed = LOW). None of these are strapping pins or flash pins.
// ---------------------------------------------------------------------------
#define PIN_BTN_RED     13   // +1
#define PIN_BTN_YELLOW   4   // +2
#define PIN_BTN_GREEN   27   // +3
#define PIN_BTN_BROWN   26   // +4
#define PIN_BTN_BLUE    25   // +5
#define PIN_BTN_PINK    33   // +6
#define PIN_BTN_BLACK   32   // +7
#define PIN_BTN_SWITCH  16   // switch player / undo / new frame / foul modifier
#define PIN_BTN_BOOT     0   // on-board BOOT button: hold 3 s = config portal

#define BTN_COUNT 8          // 7 colours + SWITCH (BOOT handled separately)

#define BTN_DEBOUNCE_MS    30
#define BTN_HOLD_UNDO_MS   1000  // SWITCH held >= 1 s  -> undo
#define BTN_HOLD_FRAME_MS  3000  // SWITCH held >= 3 s  -> new frame
#define BOOT_HOLD_PORTAL_MS 3000 // BOOT/SWITCH held 3 s -> config portal

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
#define PIN_RELAY   21   // relay module IN (table light)
#define PIN_BUZZER  22   // active buzzer (via transistor/module), optional
#define PIN_LED      2   // on-board blue LED: solid = MQTT connected

// Most cheap 5 V optocoupler relay modules are "low level trigger":
// IN = LOW switches the relay ON. Set to false for a high-level-trigger module
// (or a module with the H/L jumper set to H).
#define RELAY_ACTIVE_LOW  true
// Most 3-pin active buzzer modules are also low-level trigger. A bare buzzer
// driven through an NPN transistor is active HIGH -> set false.
#define BUZZER_ACTIVE_LOW false

// ---------------------------------------------------------------------------
// Time / network
// ---------------------------------------------------------------------------
// The device has no NTP. `reservedAt` (epoch ms) is converted to local HH:MM
// with this fixed offset. Thailand = UTC+7 = 420 minutes, no DST.
#define TZ_OFFSET_MIN 420

#define STATUS_INTERVAL_MS   10000   // heartbeat period (contract: 10 s)
#define MQTT_KEEPALIVE_S     15
#define MQTT_BACKOFF_MIN_MS  1000
#define MQTT_BACKOFF_MAX_MS  30000
#define MQTT_BUFFER_SIZE     768

#define PORTAL_AP_PASSWORD   "snooker1"   // >= 8 chars, printed in README
#define PORTAL_TIMEOUT_S     300
