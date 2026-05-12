# Optipeople DemoCNC D-2800M — Error & Alarm Code Reference

Document: D2800M-ERR-001
Revision: 6.3
Effective date: 2026-04-01

Codes are namespaced by subsystem. Format: `<S>-<NNNN>` where `S` is the
severity letter and `NNNN` is the four-digit identifier.

| Letter | Severity | Effect |
|---|---|---|
| W | Warning | Machine continues; HMI shows yellow badge |
| E | Error | Cycle aborted; machine stops in a safe state; can be acknowledged after fixing |
| F | Fault | Power-cycle required; usually a hardware failure |
| S | Safety | Safety-rated event; logged immutably; engineer sign-off may be required |

Number ranges:

| Range | Subsystem |
|---|---|
| 1000–1999 | Motion / axis |
| 2000–2999 | Safety / interlocks |
| 3000–3999 | Spindles |
| 4000–4999 | Tool change / magazine |
| 5000–5999 | Pneumatic / vacuum |
| 6000–6999 | Dust extraction |
| 7000–7999 | Control / HMI / IPC |
| 8000–8999 | Network / integration |
| 9000–9999 | Power / cabinet |

---

## Motion / axis (1000–1999)

### W-1001 — Soft limit approaching
**Cause:** Commanded position is within 5 mm of a soft limit.
**Recover:** Reduce travel or recheck job offsets. The cycle continues
unless the limit is reached, which escalates to `E-1101`.

### W-1010 — Following error rising
**Cause:** Servo following error trending up over the last 30 s, still
below the abort threshold.
**Recover:** Often the first sign of insufficient lubrication. Run the
manual grease procedure (maintenance §3) for the affected axis. If it
recurs, inspect the axis for binding.

### E-1101 — Soft limit reached, axis stopped
**Cause:** Axis hit a software-defined travel limit.
**Recover:** Switch to MAN mode, jog away from the limit, re-home,
re-run the job. Check job for incorrect zero offset.

### E-1102 — Hard limit reached
**Cause:** Physical limit switch tripped. Should not happen in normal
use — implies homing was lost or a mechanical issue.
**Recover:** Power cycle, re-home. If recurs, the limit switch may be
faulty or the home reference has drifted.

### E-1201 — Following error abort (X)
### E-1202 — Following error abort (Y)
### E-1203 — Following error abort (Z)
**Cause:** Servo could not follow the commanded trajectory. Likely
causes (in order of frequency): collision, dull tool, insufficient
lube, drive fault.
**Recover:**
1. Inspect for collision (panel shifted, tool broken).
2. Check the tool's wear state.
3. Run manual grease per maintenance §3.
4. Check drive diagnostics — see §7 below.

### E-1301 — Homing failed (X)
### E-1302 — Homing failed (Y)
### E-1303 — Homing failed (Z)
**Cause:** Home sensor not seen during the homing sweep.
**Recover:** Verify no obstruction. Check the home prox sensor LED — it
should briefly light as the axis crosses the dog. If sensor is dead,
replace (PN: OP-PRX-M12).

### F-1901 — Servo drive comm lost (X / Y / Z)
**Cause:** EtherCAT slave on the axis drive is offline.
**Recover:** Power cycle. If recurs, check the EtherCAT trunk LEDs on
the drive (top: link OK; bottom: pulses during traffic). If the bottom
LED is dark, replace the drive's EtherCAT cable.

---

## Safety / interlocks (2000–2999)

### E-2010 — Door open during cycle
**Cause:** A safety door was opened while in AUTO mode.
**Recover:** Close the door. Acknowledge the alarm. The cycle does not
auto-resume — operator must press CYCLE START again.

### E-2020 — Light curtain blocked
**Cause:** Optional finger-class light curtain triggered.
**Recover:** Clear the protected zone. Acknowledge. The HMI logs the
event with which beam(s) were blocked.

### E-2030 — Safety relay mismatch
**Cause:** The two channels of a safety circuit (E-stop or door) read
different states for > 200 ms.
**Recover:** Inspect for damaged switch or cable. Power cycle. If
recurs, **Service** — the switch may be failing.

### S-2090 — Override attempt detected
**Cause:** A door switch was bypassed or a key was left in the override
position.
**Recover:** Acknowledgment requires supervisor PIN. The event is
written to the immutable safety log and reviewed at audit.

### S-9001 — Emergency stop active (also under power)
**Cause:** An E-stop button is pressed.
**Recover:** Release the button (twist or pull, per type). Reset on the
HMI. CYCLE START requires fresh press.

---

## Spindles (3000–3999)

### W-3010 — Spindle temp high (S1..S6)
**Cause:** PT100 reading exceeds 70 °C (warning threshold).
**Recover:** Reduce duty / feed. If sustained for 5 minutes, escalates
to `E-3110`.

### W-3020 — Spindle vibration above baseline
**Cause:** Vibration measurement on the active spindle drifted > 30 %
above its 30-day baseline.
**Recover:** Tool may be unbalanced (chipped insert, gummed-up flutes)
or holder seated incorrectly. Replace / reseat the tool.

### E-3110 — Spindle overheated (S1..S6)
**Cause:** PT100 exceeded 85 °C.
**Recover:** Stop and let cool to < 50 °C before restarting. Inspect
cooling air paths (dust on hood, blocked exhaust). If recurs at light
load, spindle bearing degradation — schedule §9 TBO.

### E-3210 — VFD overcurrent (S1..S6)
**Cause:** Drive tripped on overcurrent. Often a stalled tool or chip
welded to the flute.
**Recover:** Stop, inspect the tool, check for stuck part. Acknowledge
and restart from the failed operation.

### E-3220 — VFD bus undervoltage
**Cause:** Mains voltage dropped or VFD bus cap is failing.
**Recover:** Check building voltage. If voltage is normal, **Service**.

### E-3310 — Spindle did not reach commanded speed
**Cause:** Spindle ramped to < 90 % of commanded RPM within 10 s.
**Recover:** Probable belt slip (S3) or motor coupling fault. Inspect
belt tension (maintenance §5.4) for S3. For other spindles: **Service**.

### F-3901 — Spindle encoder lost
**Cause:** Spindle encoder feedback flatlined.
**Recover:** Power cycle. If recurs, encoder cable or encoder board
failure — **Service**.

---

## Tool change / magazine (4000–4999)

### W-4001 — Tool life expired
**Cause:** Spindle hours on the loaded tool exceeded its configured
life.
**Recover:** Replace the tool. Reset the tool's life counter in
**Tools → Edit → Reset Life**.

### E-4101 — ATC pickup failed
**Cause:** Vertical spindle did not register the tool present after
pickup attempt.
**Recover:** Inspect the slot — chip in the taper, missing pull stud,
or holder loaded backwards. Manually purge in **Tools → Magazine →
Manual Purge** then retry.

### E-4102 — ATC return failed
**Cause:** Magazine slot did not register the tool home after return.
**Recover:** Open the magazine guard, verify the tool is correctly
seated. If holder is jammed, follow the manual extraction procedure
(maintenance app note D2800M-AN-04).

### E-4110 — ATC clamp/unclamp solenoid fault
**Cause:** The pull-stud solenoid did not change state in time.
**Recover:** Check air pressure (≥ 5.5 bar). If air OK, **Service**.

### E-4201 — Tool offset out of range
**Cause:** Calibrated tool length differs from previous value by > 2 mm,
or measured diameter differs by > 0.5 mm.
**Recover:** Tool may be broken or wrong tool loaded. Inspect and
recalibrate.

---

## Pneumatic / vacuum (5000–5999)

### W-5001 — Air pressure low
**Cause:** PS1 reading < 5.0 bar.
**Recover:** Check the building compressor, FRL bowl drain (water
accumulation), and FRL filter elements.

### E-5101 — Air pressure critical
**Cause:** PS1 < 4.5 bar.
**Recover:** Machine refuses to start a cycle until pressure is
restored. Find and fix the air supply issue. Common: shared compressor
at peak demand, leaking presser cylinder.

### E-5201 — Presser cylinder not extended (1..6)
**Cause:** PS2..PS7 sensor did not confirm extended state within 1.5 s.
**Recover:** Inspect the cylinder, the proximity sensor (LED on body
should light at extend), and the air line. The most common cause is a
panel that doesn't allow the presser to seat — wrong panel size or
warped material.

### E-5301 — Vacuum hold-down weak
**Cause:** Vacuum sensor on the active zone read pressure > -300 mbar
(weaker than spec) for 3 s during a cut move.
**Recover:** Stop the cycle. Brush gasket clean, look for tears,
confirm correct zones are selected for the panel size.

### E-5310 — Vacuum lost during cycle
**Cause:** Active zone reads atmospheric pressure.
**Recover:** Stop immediately. Likely a torn gasket strip — replace per
maintenance §6.2.

---

## Dust extraction (6000–6999)

### W-6001 — Dust extractor flow low
**Cause:** Flow sensor reading below 4,500 m³/h (warning).
**Recover:** Check that the extractor is on. Inspect filter cake on the
extractor — likely needs cleaning or replacement.

### E-6101 — Dust extractor offline
**Cause:** Dust extractor not detected.
**Recover:** Machine refuses to start a cycle. Turn on the extractor.
Confirm the auxiliary contact wiring at TB-EXT is intact.

---

## Control / HMI / IPC (7000–7999)

### W-7001 — IPC disk space low
**Cause:** OS drive has < 15 % free.
**Recover:** Archive old job files from **Jobs → Archive**. The HMI
auto-cleans `tmp` if free space falls below 5 %.

### W-7010 — IPC clock drift
**Cause:** RTC drifted > 60 s. Will affect job timestamps and CMMS sync.
**Recover:** Sync time at **Settings → System → Time**. If recurs every
power-up, replace the IPC RTC battery (PN: OP-IPC-BAT).

### E-7110 — Motion controller heartbeat lost
**Cause:** HMI lost contact with the OptiMotion controller.
**Recover:** Power cycle. If recurs, check the internal Ethernet patch
between IPC and motion controller, and the motion controller's status
LEDs.

### F-7901 — Configuration corrupted
**Cause:** `machine.cfg` failed checksum on boot.
**Recover:** HMI auto-restores from the daily backup (in
`C:\Optipeople\config\backup\`). If the backup also fails, **Service** —
config restore from USB.

---

## Network / integration (8000–8999)

### W-8001 — CMMS sync failed
**Cause:** Last scheduled upload to the configured CMMS endpoint
returned an error.
**Recover:** Check the URL & API token at **Settings → Integration →
CMMS**. Manual retry via **Test Connection**.

### W-8010 — Remote support tunnel offline
**Cause:** TeamViewer Tensor connection is down.
**Recover:** Check internet connectivity from the IPC. If LAN OK,
restart the Tensor service from **Settings → Remote Support**.

### E-8101 — Job import rejected (format)
**Cause:** Uploaded MPR / DXF / CSV failed parse.
**Recover:** Open the file in the source CAD/CAM tool and re-export.
Common causes: text in numeric fields, missing units header, MPR
revision mismatch.

---

## Power / cabinet (9000–9999)

### W-9001 — Cabinet temperature high
**Cause:** Internal cabinet > 45 °C.
**Recover:** Check the intake filter and the cabinet fan. Ambient over
35 °C reduces VFD headroom — consider improving shop ventilation.

### E-9101 — Phase loss
**Cause:** Phase monitor K1 detected loss or unbalance on one of L1/L2/L3.
**Recover:** Investigate building supply. Do not attempt to bypass the
phase monitor.

### E-9102 — Phase reversal
**Cause:** Phase rotation reversed (e.g. after a power infrastructure
change).
**Recover:** Qualified electrician swaps two phases at the supply
disconnect.

### F-9901 — 24 V DC rail fault
**Cause:** 24 V PSU has shut down (over-current or under-voltage).
**Recover:** Power cycle. If recurs, identify and disconnect the load
that's drawing too much (often a shorted I/O cable).

---

## Diagnostic tips

1. **Note the exact code and timestamp.** The HMI log under
   **Status → Alarm Log** keeps the last 5,000 events; export with
   **Export Log** before clearing.
2. **Look at what happened just before.** Many faults are downstream
   effects of an earlier warning — e.g. `W-1010` precedes `E-1201` by
   minutes or hours.
3. **Reproduce intentionally.** If a fault only occurs during a
   specific job step, isolate that step in MAN / SETUP mode.
4. **Open the support ticket with logs attached.** From
   **Settings → Support**, the "Create Ticket" button bundles the
   latest logs and snapshots into a single archive.

## Support contact

- support@optipeople.dk
- +45 70 70 70 70 (24/7 for production-down)
- Remote support via TeamViewer Tensor: machine ID is shown on the
  bottom-right of the HMI status bar.
