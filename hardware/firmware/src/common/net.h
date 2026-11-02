// net.h - WiFi + MQTT client per docs/mqtt-contract.md.
//
//  - clientId = username = deviceId, password = device secret
//  - LWT on snk/dev/{id}/status = {"online":false}
//  - subscribes snk/dev/{id}/cmd (QoS 1, retained session cmd arrives on connect)
//  - all publishes QoS 1, not retained
//  - reconnect with exponential backoff (1 s .. 30 s), never blocks for long
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

typedef void (*NetCmdCallback)(const char *payload, size_t len);
typedef void (*NetConnectCallback)();

// autoConnect = false: netLoop() keeps WiFi/MQTT serviced but never starts a
// connection on its own (hwtest drives the steps by hand).
void netBegin(NetCmdCallback onCmd, NetConnectCallback onConnect, bool autoConnect = true);
void netLoop();

bool netWifiUp();
bool netMqttUp();

// One blocking WiFi attempt (hwtest). Returns true if connected within timeoutMs.
bool netWifiConnect(uint32_t timeoutMs);
// One blocking MQTT attempt. On failure `err` explains why.
bool netMqttConnect(String &err);

// Publishes JSON to snk/dev/{deviceId}/{sub} with QoS 1.
bool netPublish(const char *sub, const JsonDocument &doc);
// Publishes {"level":..,"msg":..} to snk/dev/{deviceId}/log and echoes to Serial.
void netLog(const char *level, const char *fmt, ...);

String netTopic(const char *sub);
