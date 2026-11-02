# WIRING — ESP32 DevKit V1 table device

All GPIO numbers below are the **GPIO numbers** (what the firmware uses), not
the physical pin position. On most 30-pin DevKit V1 boards the silk-screen
label is `D13`, `D4`, `RX2` (=GPIO16), `TX2` (=GPIO17), etc.
The single source of truth for pins is `firmware/src/common/config.h`.

## 1. Pin map

| Function | GPIO | DevKit label | Direction | Notes |
|---|---|---|---|---|
| SPI CLK (both displays) | **18** | D18 | out | VSPI hardware SPI clock |
| SPI MOSI → DIN (both displays) | **23** | D23 | out | VSPI hardware SPI data |
| CS / LOAD — **timer** display | **5** | D5 | out | strapping pin, fine as output (idles HIGH) |
| CS / LOAD — **score** display | **17** | TX2 | out | |
| Button RED (+1) | **13** | D13 | in, pull-up | |
| Button YELLOW (+2) | **4** | D4 | in, pull-up | |
| Button GREEN (+3) | **27** | D27 | in, pull-up | |
| Button BROWN (+4) | **26** | D26 | in, pull-up | |
| Button BLUE (+5) | **25** | D25 | in, pull-up | |
| Button PINK (+6) | **33** | D33 | in, pull-up | |
| Button BLACK (+7) | **32** | D32 | in, pull-up | |
| Button SWITCH | **16** | RX2 | in, pull-up | hold at power-on 3 s = config portal |
| Relay IN (table light) | **21** | D21 | out | set to OFF before pinMode at boot |
| Buzzer (optional) | **22** | D22 | out | via NPN transistor or buzzer module |
| On-board LED | 2 | D2 / "LED" | out | solid = MQTT connected, blinking = offline |
| BOOT button (on-board) | 0 | BOOT | in | hold 3 s any time = config portal |
| 5V in | — | **VIN** | power | from the 5V 3A supply |
| GND | — | GND | power | common ground for everything |

Why these pins:
- Buttons avoid the strapping pins **0, 2, 5, 12, 15** (a button held during
  reset on those can stop the board from booting), the flash pins **6–11**, and
  the input-only pins **34–39** (no internal pull-ups). GPIO14 is also avoided
  because it outputs PWM during boot.
- Buttons use the ESP32 **internal pull-ups**: one leg to the GPIO, the other to
  GND. Pressed = LOW. No resistors needed for short wires.
- Free for later: GPIO 14, 19, 34, 35, 36 (VP), 39 (VN).

### Two displays: separate CS (chosen) vs. daisy-chain

Both 8x32 modules share CLK and DIN, each has **its own CS** (GPIO5 timer,
GPIO17 score). Chosen because:
- each display can be tested alone and a missing/broken one does not affect the other;
- no long DOUT→DIN jumper between the two modules (they usually sit apart).

(Daisy-chaining DOUT→DIN on one CS with 8 devices and two Parola zones would
also work, but would need firmware changes.)

## 2. Wiring diagram

```
                     +-------------------------------+
   5V 3A adapter     |        ESP32 DevKit V1        |
   (+)----+----------| VIN                       D23 |----------+------------> DIN  (timer)
          |    +-----| GND                       D18 |-------+--|------------> CLK  (timer)
          |    |     |                           D5  |-------|--|------------> CS   (timer)
          |    |     |                           TX2 |---+   |  |
          |    |     |                         (GPIO17)  |   |  +------------> DIN  (score)
          |    |     |                               |   |   +---------------> CLK  (score)
          |    |     |                               |   +-------------------> CS   (score)
          |    |     |                           D21 |------> Relay IN
          |    |     |                           D22 |------> Buzzer (via NPN)
          |    |     |                               |
          |    |     | D13 D4 D27 D26 D25 D33 D32 RX2|
          |    |     +--+---+---+---+---+---+---+--+-+
          |    |        |   |   |   |   |   |   |  |
          |    |       RED YEL GRN BRN BLU PNK BLK SWITCH   (each button: GPIO <-> GND)
          |    |        |   |   |   |   |   |   |  |
          |    +--------+---+---+---+---+---+---+--+------- GND bus
          |    |
          |    +--------------------- GND ---- timer VCC/GND ---- score VCC/GND ---- relay GND
          +-------------------------- 5V  ---- timer VCC     ---- score VCC     ---- relay VCC
                                               (+1000uF)          (+1000uF)
```

MAX7219 module pins (input side, labelled `VCC GND DIN CS CLK`):

| Module pin | Timer display | Score display |
|---|---|---|
| VCC | 5V | 5V |
| GND | GND | GND |
| DIN | GPIO23 | GPIO23 |
| CS | GPIO5 | GPIO17 |
| CLK | GPIO18 | GPIO18 |

Wire the **input** side (DIN), not the output side (DOUT). On FC-16 boards
the input is on the right when the text reads correctly (chip side down),
but check the silk-screen.

### Optional level shifter (74AHCT125, powered from 5V)

```
 74AHCT125 (DIP-14)        pin 14 = 5V, pin 7 = GND
   1OE (1) -> GND   1A (2) <- GPIO23   1Y (3) -> DIN (both displays)
   2OE (4) -> GND   2A (5) <- GPIO18   2Y (6) -> CLK (both displays)
   3OE (10)-> GND   3A (9) <- GPIO5    3Y (8) -> CS  timer
   4OE (13)-> GND   4A (12)<- GPIO17   4Y (11)-> CS  score
   + 100nF between pin 14 and pin 7
```
Use it if a display shows garbage/freezes, or when the display cables are
longer than ~30 cm.

### Relay (table light) — low-voltage test first

```
 Relay module          ESP32 / supply                 Load side (TEST: 12 V lamp)
   VCC  <------------- 5V                              12V adapter (+) ---- COM
   GND  <------------- GND                             NO ---------------- lamp (+)
   IN   <------------- GPIO21                          lamp (-) ---------- 12V adapter (-)
```
- `COM` + `NO` = light is **off** when the ESP32 is off/booting (fail-safe off).
  Use `NC` instead only if the light must stay on when the controller dies.
- Low-level-trigger module (default, `RELAY_ACTIVE_LOW true`). If the relay never
  releases, see BOM.md §5 (H/L jumper → `RELAY_ACTIVE_LOW false`, or the JD-VCC trick:
  remove jumper, `VCC`→3V3, `JD-VCC`→5V).
- **220 V mains wiring is done by a licensed electrician only**, inside a closed
  box, with a breaker/fuse and a manual bypass switch. See BOM.md §6.

### Buzzer (optional)

```
 GPIO22 --[1k]--> B  (S8050 / 2N2222 NPN)
                  E --> GND
                  C --> buzzer (-)      buzzer (+) --> 5V
```
This is active-HIGH → `BUZZER_ACTIVE_LOW false` (default). A 3-pin "active
buzzer module" is usually active-LOW → set `BUZZER_ACTIVE_LOW true`.

### Power notes
- Bench (flashing/testing): ESP32 powered by **USB**, displays + relay from the
  **5V 3A adapter**, and **GND of adapter connected to ESP32 GND**. Do not also
  connect the adapter's 5V to VIN while USB is plugged in.
- Installed: adapter 5V → VIN (no USB).
- Buttons on long cables (> 1 m): add 100 nF across each button, or an external
  4.7 kΩ pull-up to 3V3, to stop false presses from noise.

## 3. Button layout

Panel next to the table (or on the wall by the scoreboard), left to right in
ball-value order so staff never need to look at labels:

```
 +--------------------------------------------------------------------+
 |  (1)    (2)     (3)    (4)    (5)    (6)    (7)        [ SWITCH ]  |
 |  RED   YELLOW  GREEN  BROWN  BLUE   PINK  BLACK       (big/white)  |
 +--------------------------------------------------------------------+
```
Arcade buttons do not come in brown/pink: use white buttons with colour stickers.
Make SWITCH bigger or set apart so it is not hit by accident.

## 4. Score-button scheme

The device owns the score. "Active" = the player at the table (underlined on the
score display).

| Action | Gesture | Effect | Beep |
|---|---|---|---|
| Pot a ball | press colour button (1..7) | +n to active player, break += n | short |
| End of visit / miss | short press SWITCH (< 1 s) | other player becomes active, break = 0 | 1 medium |
| Undo | hold SWITCH 1–3 s, release | restore the state before the last action (20 levels) | tick at 1 s, then 2 short |
| New frame | hold SWITCH ≥ 3 s, release | frame to the player who leads; points & break reset; breaker alternates (P1 breaks frames 1, 3, 5 …) | double tick at 3 s, then 3 short. **Tie = refused** (long beep) |
| Foul | **hold SWITCH + press colour** of the ball involved | max(4, n) points to the **opponent**, opponent becomes active, break = 0. Releasing SWITCH afterwards does nothing. | 2 beeps |

Notes / design choices:
- Undo and new-frame act on **release**, with a beep when each threshold is
  passed, so the player knows what will happen before letting go.
- After a foul the opponent is active (normal rule: the fouler's turn ends). If
  the opponent asks the fouler to play again, just press SWITCH.
- A tied frame (re-spotted black) is finished by potting the black (+7) first,
  then the new-frame gesture.
- Staff can always correct/reset the score from the web (server sends a `score` cmd).

## 5. What the displays show

Timer (8x32, MD_Parola):

| Session state | Display |
|---|---|
| no session cmd yet | `WIFI` (no WiFi) / `MQTT` (no broker) / `----` (connected, waiting) |
| `idle` | table label e.g. `T1` |
| `reserved` | `RSV` and booking start `HH:MM` alternating every 2 s (UTC+7) |
| `running` | `H:MM` elapsed, colon blinks each second (counts locally from `elapsedMs`) |
| `paused` | frozen `H:MM`, whole display blinks |
| test `text` | scrolls the text once, then back |
| config portal | `SETUP` |

Score (8x32, 4x7 font, fits 3-digit scores):
- main page: `p1` on the left half, `p2` on the right half, underline under the active player
- every 5 s for 1.5 s: frames page `F 1-0`, then (only during a break) `B 23`
- any score change jumps straight back to the main page
