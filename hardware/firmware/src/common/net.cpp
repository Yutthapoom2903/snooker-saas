// net.cpp - see net.h
#include "net.h"
#include "config.h"
#include "settings.h"

#include <MQTT.h>
#include <WiFi.h>
#include <stdarg.h>

static WiFiClient g_tcp;
static MQTTClient g_mqtt(MQTT_BUFFER_SIZE);

static NetCmdCallback g_onCmd = nullptr;
static NetConnectCallback g_onConnect = nullptr;
static bool g_auto = true;

static char g_willTopic[96];
static const char *WILL_PAYLOAD = "{\"online\":false}";

static uint32_t g_backoff = MQTT_BACKOFF_MIN_MS;
static uint32_t g_nextAttempt = 0;
static uint32_t g_wifiLostAt = 0;
static bool g_wasMqttUp = false;

// The MQTT library forbids publishing from inside its message callback, so
// incoming commands are queued here and handled from netLoop().
static const uint8_t QUEUE_LEN = 4;
static char g_queue[QUEUE_LEN][MQTT_BUFFER_SIZE];
static size_t g_queueLenBytes[QUEUE_LEN];
static uint8_t g_qHead = 0, g_qCount = 0;

String netTopic(const char *sub) {
  return String("snk/dev/") + settings.deviceId + "/" + sub;
}

static void onMessage(MQTTClient *, char topic[], char bytes[], int length) {
  if (g_qCount >= QUEUE_LEN || length <= 0 || length >= MQTT_BUFFER_SIZE) {
    Serial.printf("[mqtt] dropped message on %s (%d bytes)\n", topic, length);
    return;
  }
  uint8_t slot = (g_qHead + g_qCount) % QUEUE_LEN;
  memcpy(g_queue[slot], bytes, length);
  g_queue[slot][length] = '\0';
  g_queueLenBytes[slot] = length;
  g_qCount++;
}

void netBegin(NetCmdCallback onCmd, NetConnectCallback onConnect, bool autoConnect) {
  g_onCmd = onCmd;
  g_onConnect = onConnect;
  g_auto = autoConnect;

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);   // lower latency for button -> publish
  if (g_auto && settingsHasWifi()) WiFi.begin();   // credentials saved by WiFiManager

  snprintf(g_willTopic, sizeof(g_willTopic), "snk/dev/%s/status", settings.deviceId);
  g_mqtt.begin(settings.host, settings.port, g_tcp);
  g_mqtt.setWill(g_willTopic, WILL_PAYLOAD, false, 1);
  g_mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
  g_mqtt.setCleanSession(true);
  g_mqtt.setTimeout(3000);
  g_mqtt.onMessageAdvanced(onMessage);
}

bool netWifiUp() { return WiFi.status() == WL_CONNECTED; }
bool netMqttUp() { return g_mqtt.connected(); }

bool netWifiConnect(uint32_t timeoutMs) {
  if (netWifiUp()) return true;
  WiFi.begin();
  uint32_t start = millis();
  while (!netWifiUp() && millis() - start < timeoutMs) delay(100);
  return netWifiUp();
}

static const char *returnCodeText(lwmqtt_return_code_t rc) {
  switch (rc) {
    case LWMQTT_CONNECTION_ACCEPTED: return "accepted";
    case LWMQTT_UNACCEPTABLE_PROTOCOL: return "unacceptable protocol";
    case LWMQTT_IDENTIFIER_REJECTED: return "client id rejected";
    case LWMQTT_SERVER_UNAVAILABLE: return "server unavailable";
    case LWMQTT_BAD_USERNAME_OR_PASSWORD: return "bad deviceId/secret";
    case LWMQTT_NOT_AUTHORIZED: return "not authorized (device not registered or wrong secret)";
    default: return "unknown";
  }
}

bool netMqttConnect(String &err) {
  if (!settings.complete()) {
    err = "settings incomplete (host/deviceId/secret) - run the config portal";
    return false;
  }
  if (!netWifiUp()) {
    err = "WiFi not connected";
    return false;
  }
  if (g_mqtt.connected()) return true;

  if (!g_mqtt.connect(settings.deviceId, settings.deviceId, settings.secret)) {
    if (g_mqtt.lastError() == LWMQTT_CONNECTION_DENIED) {
      err = String("broker refused: ") + returnCodeText(g_mqtt.returnCode());
    } else if (!g_tcp.connected()) {
      err = String("TCP connect to ") + settings.host + ":" + settings.port +
            " failed (wrong IP? API not running? Windows Firewall 1883 closed?)";
    } else {
      err = String("MQTT error ") + (int)g_mqtt.lastError();
    }
    return false;
  }
  if (!g_mqtt.subscribe(netTopic("cmd").c_str(), 1)) {
    err = "subscribe to cmd topic failed (ACL?)";
    g_mqtt.disconnect();
    return false;
  }
  return true;
}

bool netPublish(const char *sub, const JsonDocument &doc) {
  if (!g_mqtt.connected()) return false;
  char buf[MQTT_BUFFER_SIZE];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  return g_mqtt.publish(netTopic(sub).c_str(), buf, (int)n, false, 1);
}

void netLog(const char *level, const char *fmt, ...) {
  char msg[200];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(msg, sizeof(msg), fmt, ap);
  va_end(ap);
  Serial.printf("[%s] %s\n", level, msg);
  JsonDocument doc;
  doc["level"] = level;
  doc["msg"] = msg;
  netPublish("log", doc);
}

void netLoop() {
  uint32_t now = millis();

  // WiFi: the core reconnects on its own; nudge it if it stays down.
  if (!netWifiUp()) {
    if (!g_wifiLostAt) g_wifiLostAt = now;
    if (g_auto && now - g_wifiLostAt > 20000 && settingsHasWifi()) {
      Serial.println("[wifi] still down, reconnecting");
      WiFi.reconnect();
      g_wifiLostAt = now;
    }
  } else {
    g_wifiLostAt = 0;
  }

  g_mqtt.loop();
  bool up = g_mqtt.connected();
  if (g_wasMqttUp && !up) Serial.println("[mqtt] disconnected");
  g_wasMqttUp = up;

  // MQTT reconnect with exponential backoff.
  if (!up && g_auto && netWifiUp() && settings.complete() &&
      (int32_t)(now - g_nextAttempt) >= 0) {
    String err;
    Serial.printf("[mqtt] connecting to %s:%u as %s\n", settings.host, settings.port,
                  settings.deviceId);
    if (netMqttConnect(err)) {
      Serial.println("[mqtt] connected");
      g_backoff = MQTT_BACKOFF_MIN_MS;
      g_wasMqttUp = true;
      if (g_onConnect) g_onConnect();
    } else {
      Serial.printf("[mqtt] failed: %s (retry in %lu ms)\n", err.c_str(),
                    (unsigned long)g_backoff);
      g_nextAttempt = millis() + g_backoff;
      g_backoff = min<uint32_t>(g_backoff * 2, MQTT_BACKOFF_MAX_MS);
    }
  }

  // Deliver queued commands outside the MQTT callback.
  // Copy first: a QoS 1 publish inside the handler may receive (and queue) a
  // new message into the slot we just freed.
  static char work[MQTT_BUFFER_SIZE];
  while (g_qCount) {
    uint8_t slot = g_qHead;
    size_t len = g_queueLenBytes[slot];
    memcpy(work, g_queue[slot], len + 1);
    g_qHead = (g_qHead + 1) % QUEUE_LEN;
    g_qCount--;
    if (g_onCmd) g_onCmd(work, len);
  }
}
