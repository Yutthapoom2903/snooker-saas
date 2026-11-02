# Hardware — อุปกรณ์ประจำโต๊ะสนุ้ก (ESP32)

1 โต๊ะ = ESP32 1 ตัว คุม จอเวลา + จอคะแนน (MAX7219 8x32) + ปุ่มนับแต้ม 8 ปุ่ม + รีเลย์ไฟโต๊ะ + buzzer
คุยกับ server ผ่าน MQTT ตามสัญญา `docs/mqtt-contract.md` (server เป็นเจ้าของเวลา, อุปกรณ์แค่แสดงผล; อุปกรณ์เป็นเจ้าของคะแนน)

| ไฟล์ | เนื้อหา |
|---|---|
| `BOM.md` | รายการซื้อของ + power budget + คำเตือนไฟ 220V + checklist ตรวจของ |
| `WIRING.md` | pin map, ผังต่อสาย, ผังปุ่ม, วิธีกดนับแต้ม |
| `firmware/` | PlatformIO project: env `esp32dev` (ใช้งานจริง) และ `hwtest` (ทดสอบฮาร์ดแวร์ทีละขั้น) |
| `simulator/` | โปรแกรมจำลองอุปกรณ์ใน terminal ใช้ทดสอบก่อนของมาถึง |

---

## ลำดับการทำงาน

### 1) ซื้อของ
ดู `BOM.md` สั่งตามรายการหลัก + ESP32 สำรอง 1 ตัว ได้ของแล้วไล่ checklist ข้อ 7 ใน `BOM.md`

### 2) ติดตั้ง PlatformIO

**ทางเลือก A (ง่ายสุด — แนะนำสำหรับ flash):** บน Windows
1. ติดตั้ง VS Code + extension **PlatformIO IDE**
2. ติดตั้ง driver USB-serial ตามชิปบนบอร์ด: **CP210x** (Silicon Labs) หรือ **CH340** (WCH)
3. เปิดโฟลเดอร์ `hardware/firmware` (ผ่าน `\\wsl$\...` ได้ หรือ clone repo ฝั่ง Windows)

**ทางเลือก B: ใน WSL2** (มี venv ทำไว้แล้วที่ `hardware/firmware/.venv`)
```bash
cd hardware/firmware
python3 -m venv .venv && .venv/bin/pip install platformio     # ครั้งแรกเท่านั้น
# เครือข่าย office ที่ทำ TLS inspection:
export REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
.venv/bin/pio run -e hwtest          # compile
```
WSL2 มองไม่เห็น USB เองต้องใช้ **usbipd-win** (PowerShell แบบ admin ฝั่ง Windows):
```powershell
winget install usbipd
usbipd list                          # หา BUSID ของ CP210x/CH340
usbipd bind --busid <BUSID>
usbipd attach --wsl --busid <BUSID>
```
แล้วใน WSL จะเห็น `/dev/ttyUSB0` (อาจต้อง `sudo usermod -aG dialout $USER` แล้ว login ใหม่)

### 3) Flash `hwtest` แล้วทดสอบทีละชิ้น
```bash
cd hardware/firmware
.venv/bin/pio run -e hwtest -t upload      # Windows/VS Code: เลือก env "hwtest" → Upload
.venv/bin/pio device monitor               # 115200 baud
```
(ถ้า upload ไม่ขึ้น `Connecting....` ค้าง: กดปุ่ม **BOOT** บนบอร์ดค้างไว้จนเริ่มเขียน)

เมนูใน Serial:
```
1) WiFi connect      2) MQTT connect
3) Timer display     4) Score display
5) Buttons           6) Relay
7) Buzzer
a) run all (Enter = run, s = skip)   r) results   i) settings   p) config portal
```
- ทุกขั้น **ข้ามได้** — ต่อของเท่าที่มี ทดสอบเท่าที่มี
- ทดสอบแบบ **ไม่ต้องมี WiFi** ได้เลย: 3 (จอเวลา), 4 (จอคะแนน), 5 (ปุ่ม — พิมพ์ชื่อปุ่ม+GPIO ทุกครั้งที่กด และบอกปุ่มที่ไม่เคยกด/ค้าง), 6 (รีเลย์ — **ใช้หลอด 12V**), 7 (buzzer)
- ถ้าจอกลับหัว/กลับด้าน/บล็อกสลับ → แก้ `MATRIX_HW_TYPE` ใน `src/common/config.h` (ลอง `FC16_HW` → `PAROLA_HW` → `GENERIC_HW` → `ICSTATION_HW`) แล้ว flash ใหม่
- ขั้น 2 (MQTT) จะผ่านได้หลังทำข้อ 4–6 ด้านล่าง — กลับมารันซ้ำได้
- เมื่อ MQTT ต่อได้ ผลแต่ละขั้นจะถูกส่งไป `snk/dev/{id}/log` ด้วย (เห็นใน Admin → Devices)

### 4) ตั้งค่า WiFi + server ผ่าน WiFiManager
- ใน `hwtest` กด `p` (หรือใน firmware จริง: **กดปุ่ม SWITCH ค้างตอนเสียบไฟ 3 วินาที** หรือ **กด BOOT ค้าง 3 วินาที** ตอนไหนก็ได้; ถ้ายังไม่เคยตั้งค่า จะเปิด portal เอง)
- จอเวลาขึ้น `SETUP` → ใช้มือถือต่อ WiFi ชื่อ **`SNK-Setup-XXXX`** รหัส **`snooker1`** → หน้าเว็บเด้งเอง (หรือเปิด `http://192.168.4.1`)
- กด **Configure WiFi** เลือก WiFi ร้าน (**2.4 GHz เท่านั้น** ESP32 ไม่รองรับ 5 GHz) แล้วกรอก:
  - **MQTT host** = IP วง LAN ของเครื่อง PC ที่รัน API (Windows: `ipconfig` → IPv4 ของการ์ด LAN/WiFi; WSL2 mirrored ใช้ IP เดียวกับ Windows) — แนะนำตั้ง **DHCP reservation** ให้ PC ใน router จะได้ IP ไม่เปลี่ยน
  - **MQTT port** = `1883`
  - **Device ID** และ **Device secret** = ค่าจาก Admin → Devices (ข้อ 6) — ถ้ายังไม่มี เว้นไว้ก่อน แล้วกลับมาตั้งใหม่
  - ช่อง secret เว้นว่าง = ใช้ค่าเดิม
- ค่าที่ตั้งใน `hwtest` ใช้ต่อได้ใน firmware จริง (เก็บใน NVS ที่เดียวกัน)

### 5) เปิด Windows Firewall port 1883 (ผู้ใช้รันเองใน PowerShell แบบ **Run as Administrator**)
```powershell
New-NetFirewallRule -DisplayName "Snooker MQTT 1883" -Direction Inbound -Protocol TCP -LocalPort 1883 -Action Allow -Profile Private
```
WSL2 แบบ **mirrored networking** มี Hyper-V firewall แยกอีกชั้น ต้องเปิดด้วย:
```powershell
New-NetFirewallHyperVRule -Name "WSL-MQTT-1883" -DisplayName "WSL MQTT 1883" -Direction Inbound -VMCreatorId '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}' -Protocol TCP -LocalPorts 1883
```
ตรวจว่าเครือข่ายเป็น Private: `Get-NetConnectionProfile` (ถ้าเป็น Public: `Set-NetConnectionProfile -InterfaceAlias "<ชื่อ>" -NetworkCategory Private` หรือเปลี่ยน `-Profile Private` เป็น `-Profile Private,Public` — ไม่แนะนำบน WiFi สาธารณะ)

ทดสอบจากเครื่องอื่นใน LAN: `Test-NetConnection <IP ของ PC> -Port 1883` ต้องได้ `TcpTestSucceeded : True`

### 6) ลงทะเบียนอุปกรณ์ในเว็บ
Admin → Devices → เพิ่มอุปกรณ์ → ผูกกับโต๊ะ → จด **Device ID** และ **secret** (secret แสดง **ครั้งเดียว**)
แล้วกลับไปตั้งค่าใน portal (ข้อ 4) → ใน `hwtest` รันขั้น 2 (MQTT) ให้ผ่าน

### 7) Flash firmware จริง (`main`)
```bash
.venv/bin/pio run -e esp32dev -t upload
.venv/bin/pio device monitor
```
Serial จะแสดง `[mqtt] connected` จอเวลาเปลี่ยนจาก `WIFI` → `MQTT` → `----` → ตามสถานะโต๊ะ
ไฟ LED สีฟ้าบนบอร์ด: **ติดค้าง** = ต่อ MQTT แล้ว, **กระพริบ** = offline

### 8) ทดสอบผ่าน Admin → Devices
- สถานะ online, fw `1.0.0`, IP, RSSI อัปเดตทุก 10 วินาที; ถอดปลั๊ก → ขึ้น offline ภายใน ~20 วินาที (LWT, keepalive 15 s)
- "ส่งคำสั่งทดสอบ": `blink` (จอกระพริบ 3 ครั้ง), `relay` (รีเลย์ติด 2 วินาทีแล้วกลับ), `text` (ข้อความวิ่งบนจอเวลา) — ทุกคำสั่งตอบกลับเป็น log
- เปิด session จากเว็บ → จอเวลาเดินตาม, ไฟโต๊ะตาม `light`
- กดปุ่มนับแต้ม → live view ในเว็บเปลี่ยนตาม (วิธีกดดู `WIRING.md` §4)

---

## ใช้ simulator ก่อนของมาถึง

simulator ทำตัวเหมือนบอร์ดจริงทุกอย่างตามสัญญา (LWT, status ทุก 10 วินาที, session/score/test cmd, ตอบ log)
และแสดง "จอ" ใน terminal ใช้คีย์บอร์ดแทนปุ่ม

```bash
# จาก root ของ repo (หลัง npm install ที่ root ซึ่งรวม workspace hardware/simulator)
npm run sim -- --host localhost --port 1883 --id <deviceId> --secret <secret>

# หรือเฉพาะโฟลเดอร์ simulator
cd hardware/simulator
export NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt   # เครือข่าย office
npm install --workspaces=false
npm start -- --host localhost --port 1883 --id <deviceId> --secret <secret>
```
ใช้ env แทน argument ได้: `SNK_MQTT_HOST`, `SNK_MQTT_PORT`, `SNK_DEVICE_ID`, `SNK_DEVICE_SECRET`

| คีย์ | ปุ่มจริง |
|---|---|
| `1`–`7` | ลูก แดง..ดำ (+1..+7) ให้ผู้เล่นที่ active |
| `s` | SWITCH กดสั้น (สลับผู้เล่น/จบ break) |
| `u` | undo (SWITCH ค้าง 1 วินาที) |
| `f` แล้ว `1`–`7` | foul (SWITCH ค้าง + ปุ่มสี) — max(4, n) ให้ฝ่ายตรงข้าม |
| `n` | new frame (SWITCH ค้าง 3 วินาที) — เสมอกันจะไม่ยอม |
| `x` | ตัดการเชื่อมต่อแบบไม่บอกลา (ทดสอบ LWT; จะต่อใหม่เอง) |
| `q` / Ctrl+C | ออก (ส่ง `{"online":false}` ก่อนออก) |

ตรวจ type: `cd hardware/simulator && npx tsc --noEmit`

---

## หมายเหตุพฤติกรรม (เกี่ยวกับสัญญา MQTT)
- **เวลาจอง (`reservedAt`)** แปลงเป็น HH:MM ด้วย offset คงที่ **UTC+7** (`TZ_OFFSET_MIN` ใน `config.h`) เพราะอุปกรณ์ไม่มี NTP
- **คะแนนที่กดตอน offline**: อุปกรณ์จะส่ง score ทันทีที่ต่อกลับ และ **ไม่สนใจ** `score` cmd ที่ server ส่งมาภายใน 5 วินาทีหลัง connect (ไม่งั้นค่าที่ server restore จะทับคะแนนที่กดไว้)
- อุปกรณ์ **ไม่ส่ง score ซ้ำ** หลังได้รับ `score` cmd (กันลูป)
- ถ้า relay กำลังทำ test pulse, `light` ใน status รายงานสถานะรีเลย์ **จริง** ณ ตอนนั้น
- ตั้งค่าอื่นๆ (ความสว่าง, ชนิดจอ, relay/buzzer active-low, ขา GPIO) อยู่ใน `firmware/src/common/config.h`
