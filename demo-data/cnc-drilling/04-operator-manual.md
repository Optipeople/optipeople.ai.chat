# Optipeople DemoCNC D-2800M — Operator Manual

Document: D2800M-OP-001
Revision: 5.1
Effective date: 2026-02-20
Language: English (Danish and German translations on the documentation USB)

Read this manual before operating the machine. Operators must have
completed factory training (see installation manual §10) and be signed
off on their competency card.

## 1. Safety summary

| Symbol | Meaning |
|---|---|
| ⚠️ DANGER | Action will cause injury if ignored |
| ⚠️ WARNING | Action may cause injury or damage |
| ℹ️ NOTE | Useful information, not safety-critical |

### 1.1 Required PPE

- Safety glasses (EN 166, grade B)
- Hearing protection (EN 352, SNR ≥ 28 dB)
- Cut-resistant gloves **for handling tools and panels only**. Remove
  gloves before pressing HMI buttons or touching the spindle area.
- Closed-toe safety footwear (S1P minimum)

### 1.2 General rules

1. Never reach inside the safety enclosure while a cycle is running.
2. Never override a door switch. The machine logs all override attempts.
3. Stop the machine with the E-stop before clearing a jammed panel.
4. Do not run the machine with any safety guard removed.
5. The machine produces fine wood dust — wear a P2 filter mask when
   cleaning out the dust extractor or working on the table.

## 2. Controls

### 2.1 Operator console

```
   ┌────────────────────────────────────────────────────┐
   │                                                    │
   │   ┌──────────────────────────────────────────────┐ │
   │   │                                              │ │
   │   │      15.6" HMI touchscreen                   │ │
   │   │      (OptiPanel)                             │ │
   │   │                                              │ │
   │   └──────────────────────────────────────────────┘ │
   │                                                    │
   │   ◯ POWER     ◯ CYCLE START   ◯ CYCLE STOP        │
   │   green        green            red                │
   │                                                    │
   │   [ E-STOP ]   ⊙ MODE SELECT   [ JOG ENABLE ]      │
   │    red mush.    AUTO/MAN/SETUP   yellow            │
   │                                                    │
   └────────────────────────────────────────────────────┘
   USB ports (4× A, 1× C) on the side panel.
   Barcode scanner Y-cable plugged into one USB-A by default.
```

### 2.2 Mode switch

- **AUTO** — runs jobs from the queue. Cycle Start enabled.
- **MAN** — manual jog, manual spindle. Used for setup and
  troubleshooting. Cycle Start disabled.
- **SETUP** — door interlocks allow opening at reduced speed (max 5
  m/min jog, max 1,500 rpm spindle). Requires a held enabling switch on
  the pendant.

## 3. Daily start-up

1. Visually inspect the machine and surrounding area. Remove offcuts,
   tools, or anything left on the table.
2. Confirm the dust extractor and vacuum pump are turned on at their own
   panels. Listen for normal sound.
3. Turn the main isolator Q1 (red handle, cabinet door) to ON.
4. The IPC boots. After ~90 s the OptiPanel HMI loads.
5. Sign in with your operator account. Card-tap login is supported if
   the optional reader is fitted.
6. The HMI shows the **Homing Required** banner. Press **Home All**.
   All axes home in this order: Z, X, Y. This takes about 25 s.
7. Open **Status → Diagnostics → Lubrication** and confirm:
   - Grease reservoir > 25 %
   - Last auto-grease cycle < 8 h ago
   If either is red, perform the grease procedure (maintenance §3) before
   running the machine.
8. Run a **15-minute warm-up** if the shop temperature is below 15 °C or
   if the machine has been idle > 12 h. The HMI offers this on the start
   screen and cycles each spindle from 30 % to 100 %.

## 4. Loading a panel

1. Open the front door of the work zone you intend to use.
2. Place the panel against the rear positioning bar. The bar rises
   automatically when you tap **Load Zone A** or **Load Zone B**.
3. Slide the panel left until it contacts the X-side reference stop.
4. Close the door. Press **Confirm Loaded** on the HMI.
5. The HMI commands the movable beam to descend, the top pressers to
   extend, and the rear bar to retract. You'll hear a sequence of clicks
   over ~3 s.
6. ℹ️ Min panel size 250 × 200 mm. Smaller pieces will not be held
   reliably — use the small-part jig (PN: OP-JIG-SP01).

## 5. Running a job

### 5.1 By barcode (preferred)

1. Scan the panel's barcode with the handheld scanner.
2. The HMI loads the job, shows a 3D preview, and highlights the
   machining operations.
3. Press **Cycle Start**.
4. Watch the first cuts through the safety window. If anything looks
   wrong (excessive vibration, smoke, wrong tool depth), press the
   nearest E-stop and call a supervisor.

### 5.2 By manual selection

1. Tap **Jobs → Browse**.
2. Filter by customer, date, or part name.
3. Select a job. The preview opens.
4. Confirm material thickness — the auto-thickness probe will verify
   when you press Cycle Start, but if you know the panel is non-standard
   you can pre-set it here.
5. Press **Cycle Start**.

### 5.3 During the cycle

- The HMI shows operation progress, current tool, and estimated
  remaining time.
- The opposite zone's door is unlocked — you can load the next panel
  while the current one is being machined. This is the main
  productivity feature.
- **Do not** open the active zone's door. The machine will halt with
  alarm `E-2010 Door open during cycle`.

### 5.4 End of cycle

1. The machine lifts the head, retracts pressers, and beeps.
2. The HMI shows **Cycle Complete**.
3. Open the door, remove the panel.
4. Clean offcuts and chips off the vacuum table with the supplied
   brush. Do **not** use compressed air on the table — it drives dust
   into the vacuum gaskets and shortens their life.

## 6. Setup mode operations

Setup mode (key-switch + held enabling button) is used to manually
position the head, test a single operation, or measure a tool. Door
interlocks are eased — opening the door drops speed but does not stop
the machine.

### 6.1 Manual jog

1. Switch to MAN mode.
2. Press JOG ENABLE.
3. Select the axis (X / Y / Z) on the HMI.
4. Use the jog wheel. Default increment is 0.1 mm — change with the
   x1 / x10 / x100 buttons.

### 6.2 Set tool length (vertical setter)

1. Load the tool in S1 (use ATC if it's already in the magazine).
2. From the HMI, **Tools → Calibrate → Length (Vertical)**.
3. The head moves over the laser setter and runs the calibration.
4. The new length is shown — confirm and save.

### 6.3 Set tool length (horizontal probes)

1. Load tool in S3 or S4.
2. **Tools → Calibrate → Length (Horizontal S3/S4)**.
3. The head moves to the touch probe and dabs it twice.
4. Save when complete.

## 7. Loading new tools into the ATC

1. Switch to SETUP mode.
2. **Tools → Magazine → Load Slot N**.
3. The magazine indexes; slot N is exposed at the front opening.
4. ⚠️ Wait for the green "READY" LED on the slot. The pull-stud
   solenoid is only released then.
5. Insert the tool holder, push until it clicks. The slot LED turns
   blue.
6. On the HMI, enter the tool data: type, diameter, length (or use
   calibrate from §6.2), feeds, and life counter target.
7. Repeat for additional slots.

## 8. End-of-shift shutdown

1. Finish the current cycle. Do not abort mid-cycle just to leave on
   time — partial parts must be removed from the table and the
   vacuum left running long enough to keep the panel held.
2. **HMI → Shutdown → Park**. The head moves to the parking position
   (X = 5,500, Y = 80, Z = 200).
3. Wait for the HMI to display **Safe to Power Off**.
4. Turn isolator Q1 to OFF.
5. Close the air supply ball valve V1 if leaving for the weekend or
   longer.
6. ℹ️ Leave the dust extractor running for 60 s after shutdown to clear
   the ducting. Most modern collectors have a built-in run-on timer.

## 9. Quick troubleshooting (operator level)

| Symptom | Try first | If that fails |
|---|---|---|
| Panel slips during cut | Check vacuum gasket strip, brush table clean | Replace gasket — maintenance §6.2 |
| Burn marks on edge | Check tool wear; reduce feed by 10 % | Replace tool, recalibrate length |
| Chatter / vibration | Confirm tool is properly seated and ER32 nut torque | Stop and call supervisor — could be spindle bearing |
| Dust escaping enclosure | Check Ø 200 dust hose clamps | Inspect filter on extractor — likely clogged |
| HMI frozen | Tap **Status → Lock screen → Unlock** | Restart HMI from **Shutdown → Restart HMI** (machine stays in safe state) |
| Will not home | Check no objects on table; ensure all doors closed | See error codes E-1xxx (errors doc) |

For any alarm code (E-xxxx, W-xxxx), look it up in document
[06-error-codes.md](06-error-codes.md).

## 10. Cleanliness habits

Operators are expected to keep the machine in good condition:

- Every cycle: brush offcuts off the table.
- Every 2 hours: open the dust drawer (front-left, push-to-release) and
  empty if more than 1/2 full.
- End of shift: wipe the HMI screen with the microfibre cloth.
- End of shift: clear chips from the ATC slots — chips packed into the
  taper cause the next tool change to fault.
- End of week: vacuum the cabinet intake filter grille (cabinet door,
  bottom).

## 11. When in doubt — STOP

The right behaviour for an operator who is unsure is always to stop and
ask. The machine, the parts, and your hands are all worth less than the
job. A two-minute supervisor call beats a damaged spindle every time.
