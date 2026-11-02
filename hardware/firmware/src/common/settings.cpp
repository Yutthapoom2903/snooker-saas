// settings.cpp - see settings.h
#include "settings.h"
#include "config.h"

#include <Preferences.h>
#include <WiFi.h>
#include <WiFiManager.h>

Settings settings;

static const char *NVS_NS = "snk";

void settingsLoad() {
  Preferences p;
  p.begin(NVS_NS, true);  // read-only
  p.getString("host", settings.host, sizeof(settings.host));
  settings.port = p.getUShort("port", 1883);
  p.getString("devId", settings.deviceId, sizeof(settings.deviceId));
  p.getString("secret", settings.secret, sizeof(settings.secret));
  p.end();
}

void settingsSave() {
  Preferences p;
  p.begin(NVS_NS, false);
  p.putString("host", settings.host);
  p.putUShort("port", settings.port);
  p.putString("devId", settings.deviceId);
  p.putString("secret", settings.secret);
  p.end();
}

void settingsPrint(Stream &out) {
  out.printf("  MQTT host : %s\n", settings.host[0] ? settings.host : "(not set)");
  out.printf("  MQTT port : %u\n", settings.port);
  out.printf("  Device ID : %s\n", settings.deviceId[0] ? settings.deviceId : "(not set)");
  out.printf("  Secret    : %s\n", settings.secret[0] ? "******** (set)" : "(not set)");
  WiFiManager wm;
  out.printf("  WiFi SSID : %s\n", wm.getWiFiIsSaved() ? wm.getWiFiSSID(true).c_str() : "(not set)");
}

bool settingsHasWifi() {
  WiFiManager wm;
  return wm.getWiFiIsSaved();
}

String settingsApName() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[24];
  snprintf(buf, sizeof(buf), "SNK-Setup-%04X", (uint16_t)(mac >> 32));
  return String(buf);
}

// Set by WiFiManager when the user presses "Save" on the portal page.
static bool g_paramsSaved = false;
static void onSaveParams() { g_paramsSaved = true; }

bool settingsRunPortal() {
  char portBuf[8];
  snprintf(portBuf, sizeof(portBuf), "%u", settings.port);

  WiFiManager wm;
  WiFiManagerParameter hdr("<hr><b>Snooker server</b>");
  WiFiManagerParameter pHost("host", "MQTT host (PC LAN IP, e.g. 192.168.1.20)",
                             settings.host, sizeof(settings.host) - 1);
  WiFiManagerParameter pPort("port", "MQTT port", portBuf, 6,
                             "type='number' min='1' max='65535'");
  WiFiManagerParameter pId("devid", "Device ID (from Admin - Devices)",
                           settings.deviceId, sizeof(settings.deviceId) - 1);
  WiFiManagerParameter pSecret("secret", "Device secret (leave blank = keep)", "",
                               sizeof(settings.secret) - 1, "type='password'");

  wm.addParameter(&hdr);
  wm.addParameter(&pHost);
  wm.addParameter(&pPort);
  wm.addParameter(&pId);
  wm.addParameter(&pSecret);
  // Depending on WiFiManager's menu layout either callback fires on "Save".
  wm.setSaveParamsCallback(onSaveParams);
  wm.setSaveConfigCallback(onSaveParams);
  wm.setBreakAfterConfig(true);          // return even if WiFi connect fails
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);
  wm.setTitle("Snooker table device");

  g_paramsSaved = false;
  Serial.printf("[portal] AP '%s' password '%s' -> http://192.168.4.1\n",
                settingsApName().c_str(), PORTAL_AP_PASSWORD);
  bool connected = wm.startConfigPortal(settingsApName().c_str(), PORTAL_AP_PASSWORD);

  if (g_paramsSaved) {
    strlcpy(settings.host, pHost.getValue(), sizeof(settings.host));
    long port = atol(pPort.getValue());
    settings.port = (port > 0 && port < 65536) ? (uint16_t)port : 1883;
    strlcpy(settings.deviceId, pId.getValue(), sizeof(settings.deviceId));
    // Blank secret field = keep the stored secret (it is never echoed back).
    if (strlen(pSecret.getValue()) > 0) {
      strlcpy(settings.secret, pSecret.getValue(), sizeof(settings.secret));
    }
    settingsSave();
    Serial.println("[portal] settings saved");
  } else {
    Serial.println("[portal] closed without saving custom settings");
  }
  return connected;
}
