// settings.h - runtime settings stored in NVS + WiFiManager captive portal.
//
// The portal (AP "SNK-Setup-XXXX", password PORTAL_AP_PASSWORD, page
// http://192.168.4.1) asks for WiFi plus four custom fields:
//   MQTT host (the PC's LAN IP), MQTT port (1883), Device ID, Device secret.
// Both firmware builds (main + hwtest) use the same NVS namespace, so values
// entered while running hwtest carry over to the production firmware.
#pragma once
#include <Arduino.h>

struct Settings {
  char host[64]     = "";
  uint16_t port     = 1883;
  char deviceId[48] = "";
  char secret[80]   = "";

  // true when everything needed for MQTT is filled in
  bool complete() const { return host[0] && deviceId[0] && secret[0] && port; }
};

extern Settings settings;

void settingsLoad();
void settingsSave();
void settingsPrint(Stream &out);   // prints values, secret masked

// True if WiFi credentials are stored in the ESP32's WiFi NVS.
bool settingsHasWifi();

// Blocking: opens the captive portal, saves the custom fields when the user
// presses Save, then returns (true = WiFi connected with the new values).
// Callers normally ESP.restart() afterwards.
bool settingsRunPortal();

// Name of the portal access point, e.g. "SNK-Setup-A1B2".
String settingsApName();
