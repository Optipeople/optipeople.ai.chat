# Optipeople DemoCNC D-2800M — Maintenance Manual

Document: D2800M-MAINT-001
Revision: 4.0
Effective date: 2026-03-01

This manual is for maintenance technicians. Operator-level cleaning is in
[04-operator-manual.md §10](04-operator-manual.md). For any task marked
**Service**, contact authorized service or open a ticket with
support@optipeople.dk before proceeding.

## 1. Safety before any maintenance

⚠️ Before any task that requires opening the enclosure, removing a
guard, or working in the cabinet:

1. Park the machine and shut down via the HMI.
2. Turn isolator Q1 to OFF.
3. Apply your lock-out / tag-out device.
4. Bleed the pneumatic system: close V1, then open the bleed valve V2
   on the cabinet underside until the gauge reads 0 bar.
5. Wait 5 minutes after power-off for the IPC capacitors to discharge.
6. Test that the spindles cannot be commanded by trying CYCLE START. The
   HMI must show "Power Off".

## 2. Maintenance schedule overview

| Interval | Hours (typical 8 h/day, 5 d/week) | Section |
|---|---|---|
| Daily | every 8 h | §3 |
| Weekly | 40 h | §4 |
| Monthly | 160 h | §5 |
| Quarterly | 500 h | §6 |
| Semi-annual | 1,000 h | §7 |
| Annual | 2,000 h | §8 |
| Spindle TBO | 4,000 h | §9 |

The HMI shows a **Maintenance Due** badge when intervals come up; it
also logs every maintenance action against the technician's account.

## 3. Daily tasks (operator can perform)

| Task | Procedure |
|---|---|
| Visual check | Walk around. No leaks (oil/air), no loose panels, no foreign objects in the work zones |
| Vacuum table | Brush off all chips and dust. Inspect the gasket strip for tears |
| Dust drawer | Empty if > 1/2 full |
| Auto-grease level | HMI **Status → Lubrication**. Top up if < 25 % |
| Air filter bowl | Check FRL1 — drain if water visible, refill auto-oil reservoir if installed |
| HMI events | Skim the alarm log. Any repeated warning ≥ 3× this shift must be reported |

## 4. Weekly tasks

| # | Task | Notes |
|---|---|---|
| 4.1 | Linear guide wipe | Soft cloth with light oil along X-axis rails. Do NOT use compressed air |
| 4.2 | ATC magazine | Wipe slots, inspect pull-stud seats for chips |
| 4.3 | Top presser pads | Replace pads if compressed by > 30 % or surface is glazed |
| 4.4 | Side reference bar | Confirm pop-up cylinder cycles smoothly; lube the cylinder rod with PTFE spray |
| 4.5 | Vacuum gaskets | Visual inspection. Replace strip section if torn |
| 4.6 | Filter intake grille | Vacuum the cabinet intake grille; check fan operation |
| 4.7 | Dust hose clamps | Hand-test each clamp; re-tighten if loose |
| 4.8 | Spindle PT100 history | Open **Diagnostics → Spindle Temps**. No spindle should average > 65 °C |

## 5. Monthly tasks

| # | Task | Spec |
|---|---|---|
| 5.1 | Manual grease — X linear guides | OP-LUB-LGB grease, 2 strokes per nipple, 8 nipples total |
| 5.2 | Manual grease — Y/Z ball screws | OP-LUB-BSG grease, 1 stroke per nipple, 4 nipples |
| 5.3 | Manual grease — X rack | Thin film of OP-LUB-RACK across full rack length |
| 5.4 | Belt tension check (S3) | Plucked frequency 110 ± 5 Hz |
| 5.5 | Auto-grease pump output | Disconnect output line into a beaker; pump should deliver ≥ 0.3 cc/cycle |
| 5.6 | Pneumatic cylinder action | Cycle each manually via diagnostics; any cylinder slower than 0.5 s indicates seal wear |
| 5.7 | Cabinet door seals | Check seals close cleanly, no dust ingress |
| 5.8 | Earth bond | Megger test PE to chassis: < 0.1 Ω at 25 A |

ℹ️ Lubricants:
- OP-LUB-LGB — NLGI 2 lithium-complex grease (linear guide bearings)
- OP-LUB-BSG — NLGI 2 EP grease for ball screws
- OP-LUB-RACK — Adhesive open-gear lubricant
- OP-LUB-CYL — Pneumatic cylinder oil, ISO VG 32

Substitutes must match grade and base. **Do not** mix lithium-complex
with polyurea greases.

## 6. Quarterly tasks (500 h)

### 6.1 Linear guide block re-grease cycle

Pump the auto-grease reservoir manually until each block oozes a small
bead of grease. Wipe excess. This guarantees fresh grease has reached
every block (auto-grease occasionally bypasses a saturated block).

### 6.2 Vacuum gasket strip replacement

Even with daily care, the foam gasket compresses and loses seal. Quarterly
replacement is cheaper than fighting slipping parts.

1. Remove the old strip with a plastic scraper.
2. Clean the channel with IPA and a lint-free cloth.
3. Cut new strip (PN: OP-VAC-GAS-6X2) to length per channel.
4. Press in, butting joints tight. Do not stretch.
5. Run a vacuum hold-down test on a known-good panel.

### 6.3 Pneumatic FRL service

- Replace 5 µm pre-filter element (PN: OP-FLT-5UM).
- Replace 0.3 µm coalescing filter element (PN: OP-FLT-03UM).
- Inspect regulator diaphragm. Replace if puffing audibly at idle.

### 6.4 Spindle bearing thermal log

Export `spindle_temp_history.csv` from **Diagnostics → Export Logs**.
A bearing trending up by > 5 °C month-over-month under the same load
profile is an early-warning sign. Schedule §9 inspection sooner.

### 6.5 Backlash measurement

| Axis | Method | Pass |
|---|---|---|
| X | Dial indicator, 100 mm reversal, 5 cycles avg. | ≤ 0.03 mm |
| Y | Same | ≤ 0.02 mm |
| Z | Same | ≤ 0.02 mm |

Exceeding pass values: schedule §7.3 pinion adjust or ball-nut preload.

## 7. Semi-annual tasks (1,000 h)

### 7.1 Auto-grease reservoir refill

The pump reservoir (PN: OP-GRP-2L) holds 2 L. Top up with OP-LUB-LGB
through the fill port. Bleed any air via the pump's bleed nipple.

### 7.2 Brake test (Z gravity brake)

1. Park, then put machine in SETUP mode.
2. **Diagnostics → Drives → Brake Test**.
3. The HMI commands the Z drive to release the brake and apply a 1.2×
   rated holding torque. The Z position must not drift more than
   0.05 mm in 10 s.
4. Failure: replace brake disc (PN: OP-BRK-Z01) — **Service**.

### 7.3 X-axis pinion preload

The X rack-and-pinion uses a master-and-slave pinion configuration. The
slave is preloaded against the master to eliminate backlash. Preload
slackens over time.

1. SETUP mode. Lift X servo cover.
2. Loosen the slave-pinion clamp by 1/2 turn.
3. Use the supplied torque wrench (PN: OP-TQR-25) at the preload
   adjuster. Target 8 ± 0.5 Nm.
4. Re-tighten the clamp. Verify backlash per §6.5.

### 7.4 EtherCAT termination check

Inspect each EtherCAT connector for moisture or bent pins. Reseat. Verify
diagnostic LEDs are solid green at every slave.

## 8. Annual tasks (2,000 h)

| # | Task |
|---|---|
| 8.1 | Replace auto-grease pump filter (PN: OP-GRP-FLT) |
| 8.2 | Replace all FRL elements (even if not visually clogged) |
| 8.3 | Drain and refill VFD cabinet filter media |
| 8.4 | Service the dust hood seals (replace if compressed) |
| 8.5 | Verify all 4 E-stop circuits and 3 door switches — see §10 |
| 8.6 | Calibrate the laser tool setter against a master gauge ring (PN: OP-CAL-GR1) |
| 8.7 | Geometry survey — Service: laser interferometer X-axis, ballbar X-Y |
| 8.8 | Spindle vibration baseline — Service: vibration probe on each bearing |
| 8.9 | Export & archive the maintenance log to your CMMS |

## 9. Spindle TBO (4,000 spindle-hours each)

Spindles are factory-rebuildable. At each spindle's individual 4,000 h
mark (tracked per-spindle in **Maintenance → Spindle Hours**), schedule:

1. Spindle exchange — Service. Optipeople supplies an exchange unit; the
   old unit is sent for bearing replacement and recalibration.
2. Average lead time on exchange: 5 working days. Plan ahead. The HMI
   shows a yellow badge at 3,800 h and an orange at 3,950 h.

### 9.1 Symptoms suggesting early TBO

- Bearing temp > 80 °C sustained
- Audible whine that wasn't there last month
- Run-out at the collet face > 0.012 mm with a known-good holder
- Increased current draw at idle (VFD diagnostic)

## 10. Safety circuit verification (annual)

Tools: continuity meter, stopwatch.

1. **E-stop test, each station**:
   - Press the E-stop.
   - Time from press to spindle-stopped should be < 4 s for spindle
     running at 18,000 rpm.
   - HMI must show `E-9001 Emergency stop active`.
   - Verify both safety contactors K-SAFE-1 and K-SAFE-2 drop out
     (auxiliary aux contact reads NC).
2. **Door switch test, each door**:
   - With machine cycling at moderate speed, open the door slightly
     until interlock breaks.
   - Stop must occur within 1.5 s; HMI shows `E-2010`.
3. **Light curtain test** (if fitted):
   - Use the supplied test rod (PN: OP-LC-TST-14) — must trigger when
     placed anywhere in the protected plane.
4. Record results in the safety log. Failures must be rectified before
   returning the machine to service.

## 11. Consumables list

| Part | Description | Typical life |
|---|---|---|
| OP-LUB-LGB | Linear-guide grease, 400 g cartridge | 6 mo. |
| OP-LUB-BSG | Ball-screw grease, 400 g cartridge | 12 mo. |
| OP-LUB-RACK | Open-gear lubricant, 1 kg | 6 mo. |
| OP-VAC-GAS-6X2 | Vacuum gasket strip, 5 m | 3 mo. |
| OP-FLT-5UM / OP-FLT-03UM | FRL filter elements | 3 mo. / 6 mo. |
| OP-PRSR-PAD | Top presser pad, set of 6 | 12 mo. |
| OP-BELT-PJ940 | S3 spindle belt | 12–18 mo. |
| OP-DUST-HOSE-200 | Ø 200 mm flex hose, 1 m | 24 mo. |
| OP-CAB-FAN-FLT | Cabinet intake filter | 6 mo. |
| OP-IPC-BAT | IPC RTC battery (CR2032) | 5 yr. |

## 12. Maintenance log

Every maintenance action must be logged in the HMI under
**Maintenance → New Entry**, with technician initials, hours-at-action,
and any parts consumed. The log feeds the warranty / service record.

A monthly export should be archived in your CMMS or saved to the shared
network drive. The HMI auto-exports on the first Sunday of each month if
configured under **Settings → Integration → CMMS**.
