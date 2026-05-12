# Optipeople DemoCNC D-2800M — Installation Manual

Document: D2800M-INST-001
Revision: 2.4
Effective date: 2026-01-15

For factory technicians and qualified electrical contractors. Do not
attempt installation without a copy of the latest commissioning checklist
(D2800M-COMM-CHK-001) and at least one operator from the customer site
present for the acceptance test.

## 1. Pre-delivery site survey

Complete **before** the machine ships. The site survey form
(D2800M-SURV-001) must be returned to Optipeople at least 14 days before
the agreed delivery date.

### 1.1 Building access

- Door / corridor / lift width must be ≥ 2,200 mm.
- Floor along the route must be flat and free of ramps > 5 %.
- Crated machine: 6,100 × 2,650 × 2,150 mm, **2,520 kg gross**. Plan a
  forklift with ≥ 3 t capacity and 1,800 mm forks.

### 1.2 Final position

- Floor flatness: ≤ 3 mm over the 5,820 mm machine length, measured with
  a 2 m straight-edge.
- Floor strength: ≥ 1,500 kg/m² distributed load.
- Floor finish: sealed or epoxy-coated concrete recommended.
- Service clearances per drawing §10 of D2800M-DWG-001.

### 1.3 Utilities

| Utility | Requirement |
|---|---|
| Electrical | 380 V / 3-phase / 50 Hz, 80 A breaker, TN-S preferred |
| Compressed air | 6 bar, 380 NL/min, ISO 8573-1 class 4-4-3, G 1/2" fitting |
| Vacuum | 600 m³/h at -700 mbar (pump not included unless OP-OPT-VAC) |
| Dust extraction | 5,800 m³/h at 2,500 Pa, 3× Ø 200 mm + 1× Ø 150 mm |
| Network | 1× RJ-45 drop, gigabit, isolated VLAN preferred |

## 2. Unpacking

1. Position the crate within 2 m of the final machine location.
2. Inspect the crate for shock-witness labels. If any indicator has
   triggered, photograph it and contact Optipeople before unpacking.
3. Remove the lid first, then the side panels. **Do not cut straps with
   the machine still bolted to the crate floor** — the head assembly can
   shift when load is released.
4. Verify the packing list against contents. Standard supply:
   - Machine, base, integrated cabinet (1)
   - Tool kit (1) — see §11
   - Spare-parts kit OP-SPK-2800 (1) — see §11
   - User documentation USB stick (1)
   - Acceptance & training schedule (1)
   - Lift sling, single-use (2)

## 3. Rigging & placement

1. Attach slings to the four red M20 lifting eyes on the upper frame
   corners. Sling angle ≥ 60° from horizontal.
2. Lift slowly. Observe for binding on the safety enclosure — do not lift
   if any part of the enclosure is in contact with the frame.
3. Lower onto the four jacking pads. Final position must align with the
   pre-marked anchor pattern (drawing §8 of D2800M-DWG-001).
4. Level the machine by adjusting the eight footpads with a precision
   spirit level (≤ 0.05 mm/m) on the cross beam guideway. Check at
   eight positions along X. Tighten lock nuts to 80 Nm.
5. Mark and drill M16 chemical anchors. Cure per anchor manufacturer
   spec (typically 6–24 h at 20 °C) **before** energizing the machine.

## 4. Pneumatic connection

1. Confirm the shop air supply is dry and oil-free at the machine inlet.
2. Connect 6 bar supply to the G 1/2" inlet on the rear-left of the
   cabinet using the supplied flexible hose.
3. Open the manual ball valve V1 slowly. Verify the input pressure gauge
   reads 6.0 ± 0.2 bar.
4. With air on, listen for leaks at the FRL1 unit, manifolds M1–M3, and
   each presser cylinder. Soapy water test is acceptable.
5. Drain the FRL1 condensate bowl. The unit is fitted with an automatic
   float drain — confirm it cycles by briefly venting the supply.

## 5. Vacuum & dust connection

1. Connect the vacuum supply line (Ø 125 mm, reinforced rubber) to the
   inlet flange under work zone A. Use the supplied clamp.
2. Connect the three Ø 200 mm dust hoses to the spindle hoods, and the
   single Ø 150 mm hose to the horizontal drilling head. Use band clamps,
   not zip-ties.
3. With the dust extractor running, measure flow at each port using an
   anemometer. Minimum face velocity at the hood opening: 25 m/s. If
   below, check for blockage or undersized main duct.

## 6. Electrical connection

⚠️ Electrical work must be performed by a qualified electrician in
accordance with EN 60204-1 and local regulations. Lock-out / tag-out the
supply before opening the cabinet.

1. Verify supply is **dead** at the cabinet entry. Test with a verified
   voltmeter.
2. Route 4-core + PE cable through the cabinet's underside cable gland.
   Recommended cross-section: 4 × 25 mm² Cu for ≤ 30 m run length.
3. Connect L1, L2, L3 to terminals X1:1, X1:2, X1:3. Connect N to X1:4
   only if a neutral is provided (TN-S). Connect PE to the green/yellow
   bus bar.
4. Verify phase rotation using the in-cabinet phase monitor K1. The
   green "PHASE OK" lamp must illuminate. If "PHASE ERR" lights, swap
   any two phases.
5. Energize. Verify:
   - 24 V DC bus reads 24.0 ± 0.5 V at TB-24V-1.
   - IPC boots and shows the OptiPanel splash.
   - Cabinet fan starts when internal temperature exceeds 35 °C.

## 7. Software commissioning

1. Sign in to the HMI as `installer` (initial password on the welcome
   sheet — change immediately).
2. Open **Settings → Machine → Identity** and confirm the serial number
   matches the nameplate.
3. Run **Settings → Diagnostics → I/O Live** and verify every door
   switch, E-stop, and pressure sensor.
4. Run **Settings → Diagnostics → Axis Home**. Each axis should home
   without alarm. Observe the home reference, then jog ±50 mm and back
   to confirm position holds within ±0.05 mm.
5. Run **Settings → Maintenance → Spindle Run-In**. The HMI cycles each
   spindle through 30 / 60 / 80 / 100 % speed for 10 minutes each. Do
   not skip — bearings need this to settle.
6. Calibrate tool length (vertical setter) and tool diameter (laser
   setter) for at least one tool in S1.

## 8. Mechanical commissioning

1. Belt tension (S3 horizontal milling head): plucked frequency should
   be 110 ± 5 Hz. Adjust the eccentric mount if outside.
2. Backlash test, X axis: command a 100 mm move in each direction and
   compare to a dial indicator. Result must be ≤ 0.03 mm. If higher,
   adjust the pinion preload.
3. Squareness (X to Y): mount a square on the table, sweep a 600 mm
   line along X with a dial indicator on the head. Sweep tolerance
   ≤ 0.05 mm.
4. Vacuum zone test: command **All Zones On**. Place a Ø 200 mm rubber
   pad in the middle of each zone and verify it cannot be pushed off
   by hand.

## 9. Acceptance test

The standard acceptance program is the file `acceptance_v3.opt` on the
documentation USB. It runs a 30-minute mixed-operation job on a 600 × 400
× 18 mm MDF blank. Pass criteria:

- All cuts within ±0.10 mm of nominal.
- No spindle PT100 reading > 75 °C.
- No alarm or warning logged.
- Dust collection visually adequate at the cut zone.

The customer's appointed inspector signs the acceptance report at the
HMI's **Service → Acceptance** screen. A PDF copy is written to the
documentation USB and emailed to the address configured in
**Settings → Account**.

## 10. Operator training

A factory-certified trainer delivers two days of on-site training. Day
one covers safety, daily start-up/shutdown, panel loading, and running
existing jobs. Day two covers tool setting, job creation in OptiPanel,
import from MPR/DXF, and first-line troubleshooting.

The trainer signs off each operator on a printed competency card.
Operators not signed off may not run the machine unsupervised.

## 11. Supplied kits

### 11.1 Tool kit OP-TK-2800

- Hex keys 2–17 mm (1 set)
- Torx keys T8–T40 (1 set)
- Open-end spanners 8–24 mm (1 set)
- ER32 tightening wrench set (2)
- ISO30 tool holder loading lever (1)
- Manual grease gun, 14 oz cartridge (1)
- Anemometer (1)
- Feeler gauge set 0.05–1.00 mm (1)

### 11.2 Spare parts kit OP-SPK-2800

- Pneumatic seal kit OP-SK-CYL (1)
- Vacuum gasket strip 6×2 mm × 5 m (1)
- Drive belt PJ-940 (S3 horizontal) (2)
- Filter cartridge for FRL1 (2)
- Fuse kit (10× each of 1A, 2A, 4A, 10A 5×20 mm)
- Cabinet door key (2)
- ATC pull stud, ISO30 type B (8)
- ER32 collet kit, Ø 3 to Ø 20 mm (1)

## 12. Sign-off

Installation is considered complete when:

1. Anchors are cured.
2. All utilities pass §4 / §5 / §6 checks.
3. Acceptance program from §9 has been run and signed.
4. Operator training §10 has been delivered and signed.
5. The customer has signed the handover certificate at the HMI.

The warranty start date is the date on the signed handover certificate.
