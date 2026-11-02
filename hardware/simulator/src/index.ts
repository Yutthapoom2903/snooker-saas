// snooker-simulator - behaves like the ESP32 table device (docs/mqtt-contract.md)
// so the API and web can be developed before the hardware arrives.
//
//   npm run sim -- --host localhost --port 1883 --id <deviceId> --secret <secret>
//   (or env SNK_MQTT_HOST, SNK_MQTT_PORT, SNK_DEVICE_ID, SNK_DEVICE_SECRET)
//
// Keys: 1-7 pot (red..black) | s switch player | u undo | f then 1-7 foul |
//       n new frame | x drop connection (LWT test) | q quit
import mqtt, { type MqttClient } from 'mqtt';
import os from 'node:os';
import readline from 'node:readline';
import { parseArgs } from 'node:util';

import { ScorePager, timerText, type SessionStateName, type SessionView } from './display.ts';
import { Score, type ScoreState } from './score.ts';

const FW = '1.0.0-sim';
const STATUS_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  options: {
    host: { type: 'string', default: process.env.SNK_MQTT_HOST ?? 'localhost' },
    port: { type: 'string', default: process.env.SNK_MQTT_PORT ?? '1883' },
    id: { type: 'string', default: process.env.SNK_DEVICE_ID },
    secret: { type: 'string', default: process.env.SNK_DEVICE_SECRET },
    help: { type: 'boolean', short: 'h', default: false },
  },
  allowPositionals: false,
});

if (args.help || !args.id || !args.secret) {
  console.log(`Usage: npm run sim -- --host <host> --port <port> --id <deviceId> --secret <secret>

  --host    MQTT broker host (env SNK_MQTT_HOST, default localhost)
  --port    MQTT broker port (env SNK_MQTT_PORT, default 1883)
  --id      device ID from Admin -> Devices (env SNK_DEVICE_ID)
  --secret  device secret shown once at registration (env SNK_DEVICE_SECRET)`);
  process.exit(args.help ? 0 : 1);
}

const deviceId = args.id;
const topic = (sub: string) => `snk/dev/${deviceId}/${sub}`;

// ---------------------------------------------------------------------------
// Device state
// ---------------------------------------------------------------------------
const startedAt = Date.now();
const score = new Score();
const pager = new ScorePager();
let session: SessionView | null = null;
let lightWanted = false;
let relayPulseUntil = 0;
let blinkUntil = 0;
let scroll: { text: string; start: number } | null = null;
let foulPending = false;
let scoreUnsent = false;
let ignoreScoreCmdUntil = 0;
const logLines: string[] = [];
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const relayOn = () => Date.now() < relayPulseUntil || lightWanted;

function log(msg: string): void {
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
  logLines.push(`${t}  ${msg}`);
  if (logLines.length > 10) logLines.shift();
  if (!interactive) console.log(`${t}  ${msg}`);
}

function lanIp(): string {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return '127.0.0.1';
}

// ---------------------------------------------------------------------------
// MQTT
// ---------------------------------------------------------------------------
const url = `mqtt://${args.host}:${args.port}`;
const client: MqttClient = mqtt.connect(url, {
  clientId: deviceId,
  username: deviceId,
  password: args.secret,
  clean: true,
  keepalive: 15,
  reconnectPeriod: 3000,
  connectTimeout: 5000,
  protocolVersion: 4,
  will: { topic: topic('status'), payload: Buffer.from('{"online":false}'), qos: 1, retain: false },
});

function publish(sub: string, obj: unknown): boolean {
  if (!client.connected) return false;
  client.publish(topic(sub), JSON.stringify(obj), { qos: 1, retain: false });
  return true;
}

function publishStatus(): void {
  publish('status', {
    online: true,
    fw: FW,
    ip: lanIp(),
    rssi: -55,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    light: relayOn(),
  });
}

function publishScore(): void {
  scoreUnsent = !publish('score', score.state);
}

function deviceLog(level: 'info' | 'warn' | 'error', msg: string): void {
  log(`[${level}] ${msg}`);
  publish('log', { level, msg });
}

client.on('connect', () => {
  log(`MQTT connected to ${url} as ${deviceId}`);
  client.subscribe(topic('cmd'), { qos: 1 }, (err) => {
    if (err) log(`subscribe failed: ${err.message}`);
  });
  publishStatus();
  if (scoreUnsent) {
    // Offline changes win over the server's restore cmd that follows a connect.
    publishScore();
    ignoreScoreCmdUntil = Date.now() + 5000;
  }
});
client.on('reconnect', () => log(`MQTT reconnecting to ${url} ...`));
client.on('close', () => log('MQTT connection closed'));
client.on('error', (err) => log(`MQTT error: ${err.message}`));
client.on('message', (_t, buf) => handleCmd(buf.toString('utf8')));

setInterval(() => {
  if (client.connected) publishStatus();
}, STATUS_INTERVAL_MS);

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
function handleCmd(raw: string): void {
  let cmd: Record<string, unknown>;
  try {
    cmd = JSON.parse(raw);
  } catch {
    deviceLog('error', 'cmd: bad JSON');
    return;
  }
  switch (cmd.type) {
    case 'session': {
      const st = cmd.state as SessionStateName;
      if (!['idle', 'reserved', 'running', 'paused'].includes(st)) {
        deviceLog('warn', `session: unknown state '${String(cmd.state)}'`);
        return;
      }
      session = {
        state: st,
        table: String(cmd.table ?? '').slice(0, 7),
        elapsedMs: Number(cmd.elapsedMs ?? 0),
        receivedAt: Date.now(),
        reservedAt: typeof cmd.reservedAt === 'number' ? cmd.reservedAt : undefined,
      };
      if (typeof cmd.light === 'boolean') {
        const before = relayOn();
        lightWanted = cmd.light;
        if (before !== relayOn()) publishStatus();
      }
      log(`cmd session ${st} table=${session.table} elapsed=${session.elapsedMs}`);
      return;
    }
    case 'score':
      if (Date.now() < ignoreScoreCmdUntil) {
        deviceLog('info', 'score cmd ignored: local changes made offline were just published');
        return;
      }
      score.overwrite(cmd as Partial<ScoreState>);
      pager.reset();
      log(`cmd score -> ${JSON.stringify(score.state)}`);
      return;
    case 'test': {
      const action = String(cmd.action ?? '');
      if (action === 'blink') {
        blinkUntil = Date.now() + 1800;
        deviceLog('info', 'test blink ok');
      } else if (action === 'relay') {
        relayPulseUntil = Date.now() + 2000;
        deviceLog('info', `test relay ok (on 2 s, then back to ${lightWanted ? 'on' : 'off'})`);
      } else if (action === 'text') {
        const text = String(cmd.text ?? 'TEST');
        scroll = { text, start: Date.now() };
        deviceLog('info', `test text ok: ${text}`);
      } else {
        deviceLog('warn', `test: unknown action '${action}'`);
      }
      return;
    }
    default:
      deviceLog('warn', `cmd: unknown type '${String(cmd.type)}'`);
  }
}

// ---------------------------------------------------------------------------
// Keyboard = score buttons
// ---------------------------------------------------------------------------
const COLOURS = ['red', 'yellow', 'green', 'brown', 'blue', 'pink', 'black'];

function changed(what: string): void {
  pager.reset();
  publishScore();
  log(`${what} -> ${JSON.stringify(score.state)}${scoreUnsent ? ' (offline, will send on reconnect)' : ''}`);
}

function onKey(key: string): void {
  if (foulPending) {
    foulPending = false;
    const n = Number(key);
    if (n >= 1 && n <= 7) {
      score.foul(n);
      changed(`FOUL ${COLOURS[n - 1]} (${Math.max(4, n)} to opponent)`);
    } else {
      log('foul cancelled');
    }
    return;
  }
  if (/^[1-7]$/.test(key)) {
    const n = Number(key);
    score.addPoints(n);
    changed(`+${n} ${COLOURS[n - 1]}`);
  } else if (key === 's') {
    score.switchPlayer();
    changed('SWITCH');
  } else if (key === 'u') {
    if (score.undo()) changed('UNDO');
    else log('nothing to undo');
  } else if (key === 'f') {
    foulPending = true;
    log('foul: press 1-7 for the ball value');
  } else if (key === 'n') {
    if (score.newFrame()) changed('NEW FRAME');
    else log('new frame refused: scores are tied');
  } else if (key === 'x') {
    log('dropping TCP connection without DISCONNECT (broker should fire LWT)');
    client.stream?.destroy();
  } else if (key === 'q') {
    quit();
  }
}

function quit(): void {
  // A clean disconnect does not fire the LWT, so send the same payload first.
  if (client.connected) client.publish(topic('status'), '{"online":false}', { qos: 1 });
  client.end(false, {}, () => {
    if (interactive) process.stdout.write('\x1b[?25h\n');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

if (interactive) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str: string | undefined, key: { ctrl?: boolean; name?: string }) => {
    if (key?.ctrl && key.name === 'c') return quit();
    if (str) onKey(str.toLowerCase());
  });
} else {
  log('stdin is not a TTY: keyboard scoring disabled, logging only');
}
process.on('SIGINT', quit);
process.on('SIGTERM', quit);

// ---------------------------------------------------------------------------
// Terminal "displays"
// ---------------------------------------------------------------------------
function currentTimerText(now: number): string {
  if (scroll) {
    const window = 8;
    const step = Math.floor((now - scroll.start) / 150);
    const strip = ' '.repeat(window) + scroll.text + ' '.repeat(window);
    if (step > strip.length - window) scroll = null;
    else return strip.slice(step, step + window);
  }
  const status = !client.connected ? 'MQTT' : '----';
  return timerText(session, status, now);
}

function render(): void {
  const now = Date.now();
  const blanked = now < blinkUntil && Math.floor((blinkUntil - now) / 300) % 2 === 1;
  const timer = blanked ? '' : currentTimerText(now);
  const scoreTxt = blanked ? '' : pager.text(score.state, now);
  const s = score.state;
  const conn = client.connected ? '\x1b[32mconnected\x1b[0m' : '\x1b[31moffline\x1b[0m';
  const light = relayOn() ? '\x1b[33mON \x1b[0m' : 'off';

  const lines = [
    `snooker-simulator  id=${deviceId}  broker=${args.host}:${args.port}  MQTT ${conn}  light ${light}`,
    '',
    `  TIMER  [ ${timer.padEnd(8).slice(0, 8)} ]   session: ${session ? `${session.state} ${session.table}` : '(none yet)'}`,
    `  SCORE  [ ${scoreTxt.padEnd(22).slice(0, 22)} ]`,
    `         P1 ${s.active === 1 ? '*' : ' '} ${s.p1}  |  P2 ${s.active === 2 ? '*' : ' '} ${s.p2}   frames ${s.f1}-${s.f2}   break ${s.brk}`,
    '',
    '  keys: 1-7 pot (red..black)  s switch  u undo  f+1..7 foul  n new frame  x drop conn  q quit',
    foulPending ? '  \x1b[33mFOUL: press 1-7\x1b[0m' : '',
    '  ---- log ----',
    ...logLines.map((l) => `  ${l}`),
  ];
  process.stdout.write('\x1b[?25l\x1b[H\x1b[J' + lines.join('\n') + '\n');
}

if (interactive) setInterval(render, 200);
log(`connecting to ${url} as ${deviceId} ...`);
