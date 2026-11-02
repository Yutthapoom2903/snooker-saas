# MQTT contract (server ⇄ ESP32 table device)

Broker: Aedes, embedded in the NestJS API. Plain TCP `1883` on the API host
(`MQTT_PORT` env). One ESP32 per table drives the timer display, the score
display, the score buttons and the table-light relay.

## Auth

- MQTT `clientId` = `deviceId`
- MQTT `username` = `deviceId`, `password` = device secret (shown once in
  Admin → Devices when the device is registered)
- Unknown device / wrong secret → CONNACK refused.
- ACL: a device may only publish to and subscribe to `snk/dev/{its deviceId}/#`.

## Topics

| Topic | Direction | Retained | Payload |
|---|---|---|---|
| `snk/dev/{deviceId}/cmd` | server → device | yes (last `session` cmd) | JSON command, see below |
| `snk/dev/{deviceId}/status` | device → server | no | heartbeat, every 10 s and right after connect |
| `snk/dev/{deviceId}/score` | device → server | no | full score state after every change |
| `snk/dev/{deviceId}/log` | device → server | no | `{ "level": "info", "msg": "..." }` free text, used by hw-test |

QoS 1 for everything. All payloads are UTF-8 JSON objects. Times are Unix epoch
milliseconds.

LWT (last will): topic `snk/dev/{deviceId}/status`, payload `{"online":false}`.

## server → device: `cmd`

Every command has a `type`.

### `session` — what the timer shows (retained, re-sent on every state change and on device connect)

```json
{
  "type": "session",
  "state": "idle",          // idle | reserved | running | paused
  "table": "T1",            // short table label, ≤ 4 chars, for the display
  "startedAt": 1730000000000, // epoch ms, only when running/paused
  "elapsedMs": 754000,      // elapsed at serverTime (pauses already excluded)
  "serverTime": 1730000754000,
  "reservedAt": 1730003600000, // only when state=reserved: booking start
  "reservedLocal": "19:30",    // same, pre-formatted Bangkok time (device has no clock/NTP)
  "light": true             // relay on/off
}
```

Device behaviour:
- `idle` → show table label (e.g. `T1`), light per `light` (normally off).
- `reserved` → show `RSV` + booking start `HH:MM` alternately.
- `running` → show elapsed `H:MM` (colon blinks each second), counting
  locally from `elapsedMs` + (millis since receipt). Server is the source of
  truth for billing; the device only displays.
- `paused` → show frozen elapsed, blinking whole display.
- The device has **no** start/stop button. Sessions are only opened from the web.

### `score` — overwrite the score state (sent on device connect so a reboot restores, and when staff resets from the web)

```json
{ "type": "score", "p1": 0, "p2": 0, "f1": 0, "f2": 0, "active": 1, "brk": 0 }
```

### `test` — Admin → Devices → "ส่งคำสั่งทดสอบ"

```json
{ "type": "test", "action": "blink" }   // blink both displays 3x
{ "type": "test", "action": "relay" }   // toggle relay on 2 s, then back
{ "type": "test", "action": "text", "text": "HELLO" } // scroll text on timer display
```

Device must answer every `test` with a `log` message, e.g.
`{"level":"info","msg":"test blink ok"}`.

## device → server

### `status`

```json
{ "online": true, "fw": "1.0.0", "ip": "192.168.1.50", "rssi": -61, "uptime": 1234, "light": false }
```

### `score`

```json
{ "p1": 34, "p2": 12, "f1": 1, "f2": 0, "active": 2, "brk": 7 }
```

- `p1`/`p2` points in the current frame, `f1`/`f2` frames won,
  `active` = player at the table (1|2), `brk` = current break.
- The device owns score logic (buttons). The server stores the last state and
  pushes it to the web live view.

## Clarifications (v1.1)

- **Clock:** the device has no RTC/NTP. It never compares `serverTime` with its own
  time; it counts from `elapsedMs` using `millis()`. For `reserved` it shows
  `reservedLocal`.
- **Reconnect order:** on (re)connect the broker first delivers the old retained
  `session`; the server re-publishes a fresh `session` and a `score` within a few
  hundred ms of the device subscribing to its `cmd` topic.
- **Score ownership:** the board owns the score. If the board has unsent presses
  from while it was offline, it publishes its score first and ignores a `score`
  cmd for 5 s after connecting. A `score` cmd at any other time (staff pressed
  "ล้างคะแนน") overwrites. The device does not echo a `score` after receiving one.
- **LWT** is not retained. `log.level` ∈ `info | warn | error`.
- **Offline commands:** `test` commands are not queued (clean session); only the
  retained `session` survives an offline period.
- **One board per deviceId.** A second client with the same id kicks the first
  off the broker (MQTT clientId rule) — don't run the simulator with the id of a
  board that is powered on.
- **Denied subscriptions** (any topic other than the device's own `cmd`) get
  SUBACK `0x80`; the connection stays up.
