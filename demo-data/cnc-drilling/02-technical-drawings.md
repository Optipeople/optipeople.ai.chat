# Optipeople DemoCNC D-2800M — Technical Drawings & Diagrams

Document: D2800M-DWG-001
Revision: 3.0
Effective date: 2026-01-15

All dimensions in millimeters unless stated. Diagrams below are schematic
representations. For production drawings (DXF/STEP), see drawing pack
`D2800M-DWG-PACK-002` on the OptiCloud portal.

## 1. General arrangement — top view

```
                  ←————————————— 5,820 (L) —————————————→
        ┌──────────────────────────────────────────────────┐
        │                                                  │
        │                                                  │
   2,520│   ┌──────────────────────────────────────────┐   │
    (W) │   │   Cross beam (X-axis carriage)           │   │
        │   │   Vertical S1 (ATC) — S2 (manual)        │   │
        │   │   Horizontal S3 / S4 — Bevel S5 / S6     │   │
        │   └──────────────────────────────────────────┘   │
        │   ┌──────────────┐         ┌──────────────┐      │
        │   │ Work zone A  │         │ Work zone B  │      │
        │   │ 1,330 × 420  │ <— mid  │ 1,330 × 420  │      │
        │   │ 6 vac zones  │ bridge  │ 6 vac zones  │      │
        │   └──────────────┘         └──────────────┘      │
        │      ▲ side-ref bar              ▲ side-ref bar  │
        │ ┌──┐                                       ┌──┐  │
        │ │ E │  Operator console (HMI + IPC)        │ E │  ← E-stops
        │ └──┘                                       └──┘  │
        └──────────────────────────────────────────────────┘
              ▲                                     ▲
              │ Main electrical cabinet             │ Dust ports
              │ (operator side)                     │ (rear)
```

## 2. Side elevation (front view)

```
                  ←————————————— 5,820 (L) —————————————→
            ┌────────────────────────────────────────────┐
            │  ░░░░  Safety enclosure (sliding doors)    │ 2,000
            │  ░░░░                                      │
            │  ░░░░  ┌────────────────────────────────┐  │
            │  ░░░░  │ Cross beam + heads             │  │
            │  ░░░░  └────────────────────────────────┘  │
            │  ░░░░  ════════════════════════════════    │  ← table at 980
            │  ┌─────────────────────────────────────┐   │
            │  │ Welded steel base (annealed)        │   │
            │  └─────────────────────────────────────┘   │  ↓ floor
            └────────────────────────────────────────────┘
                ◯       ◯       ◯       ◯
                Foot 1  Foot 2  Foot 3  Foot 4 (×2 row, 8 total)
```

## 3. Axis convention

```
              Z (+ up, drill retract)
              │
              │
              │
              └──────── X (+ toward right end of machine)
             /
            /
           Y (+ toward operator)
```

- X = 0 at the home position on the left end of the cross-beam track.
- Y = 0 at the rear positioning bar.
- Z = 0 at the table top surface (auto-recalibrated by thickness sensor).
- Spindle axes (C5, C6 if installed) reported in degrees CCW.

## 4. Cross-beam head layout (looking at front face)

```
          ┌──────────────────────────────────────────────┐
          │   S2     S1        S3       S4    S5    S6   │
          │  man.   ATC      H-mill   H-drill bev1  bev2 │
          │  vert.  vert.    6 kW     3.5 kW 2.2k  2.2k  │
          │  7.5kW  7.5kW                                │
          └──────────────────────────────────────────────┘
              ↑       ↑         ↑        ↑     ↑     ↑
            -180    -120      -60        0   +60   +120  (Y offset from S4)

           Tool magazine (8 slots, travels with the beam):
                ┌─┬─┬─┬─┬─┬─┬─┬─┐
                │1│2│3│4│5│6│7│8│   ISO30 / ER32
                └─┴─┴─┴─┴─┴─┴─┴─┘
```

Spindles are mounted on a common Z-carriage and indexed in software.
Offsets listed are nominal and live in `machine.cfg → headOffsets[]`.

## 5. Pneumatic schematic (P&ID, simplified)

```
   Shop air ─┐
   6 bar     │  Ball valve V1   FRL1 (5µm + 0.3µm + reg)
             ├──────┤├──────────╱╱──────────┐
                                            │
                              ┌─────────────┼────────────┬───────────┐
                              │             │            │           │
                          Manifold M1   Manifold M2  Manifold M3   Vac eject
                          (pressers)   (movable      (side bar +   (kicker)
                           Y1..Y6        beam)        clamps)
                              │             │            │
                            6× cyl.        3-stage      Y10..Y14
                            (top press)    Y7..Y9
```

Sensors:
- PS1: input pressure, normally-open, trips < 4.5 bar
- PS2..PS7: confirm-extended on each presser cylinder
- PS8/PS9: beam-up / beam-down reed switches

## 6. Electrical block diagram

```
   3-phase 380V ─── Main isolator Q1 (80A)
                 ├── Phase monitor K1 ── (alarm to PLC if loss/reverse)
                 ├── Drive bus (3×) ─── VFD-S1 / VFD-S2 / VFD-S3..S6
                 ├── Servo bus ───────── X-servo / Y-servo / Z-servo
                 └── 24V DC PSU (10A) ── PLC + safety + I/O

   PLC (TwinCAT, FSoE master)
     │
     ├── EtherCAT trunk ─── Drives ─── Motion controller (loop closure)
     ├── Safety bus ─── Door switches, E-stops, brake monitor
     ├── I/O slice (EL1809/EL2809) ─── Pneumatic valves, sensors
     └── Ethernet ─── IPC (HMI) ─── Office network (isolated VLAN)
```

## 7. Vacuum table — zone layout

```
   Work zone A (1330 × 420)
   ┌─────┬─────┬─────┬─────┬─────┬─────┐
   │ A1  │ A2  │ A3  │ A4  │ A5  │ A6  │
   │     │     │     │     │     │     │
   │  ▢  │  ▢  │  ▢  │  ▢  │  ▢  │  ▢  │
   │     │     │     │     │     │     │
   └─────┴─────┴─────┴─────┴─────┴─────┘
   ← V1 → ← V2 → ← V3 → ← V4 → ← V5 → ← V6 →
   Each zone has its own 3/2 valve (V1..V6) and a non-return check.
   Zones are auto-selected based on workpiece outline in OptiPanel.
```

## 8. Foundation plan (anchor pattern)

```
   ┌────────────────────────────────────────────────────┐
   │                                                    │
   │   ●           ●           ●           ●            │  Front row
   │                                                    │
   │                                                    │
   │   ●           ●           ●           ●            │  Rear row
   │                                                    │
   └────────────────────────────────────────────────────┘
       ↑           ↑           ↑           ↑
       320       1,920       3,520       5,180   (X from datum, mm)

   Anchors: M16 chemical resin anchors, min embed 130 mm,
   concrete C25/30 or better, min slab 200 mm thick.
   Y-spacing: 1,820 mm centre-to-centre between front & rear row.
```

## 9. Hose & cable trench (recommended)

```
        ┌─────── Cable trench (300 mm wide × 200 mm deep) ────────┐
        │  Power 4×25mm² + PE  |  Air pipe Ø32  |  Vac pipe Ø125  │
        │  Data Cat6A          |                |  Dust Ø200 (×2) │
        └─────────────────────────────────────────────────────────┘
```

Maintain 200 mm clearance between power and data. Vacuum and dust pipes
should rise to the machine — never trap moisture in a low loop.

## 10. Service clearances

| Side | Min clearance | Reason |
|---|---|---|
| Front (operator) | 1,500 mm | Loading, HMI access |
| Rear | 800 mm | Dust hoses, electrical service |
| Left end (X−) | 1,200 mm | X-home reference, panel loading |
| Right end (X+) | 1,200 mm | Tool magazine service |
| Top | 500 mm above guard | Crane lift for spindle service |

## 11. Lift points

Use the four M20 lifting eyes on the upper frame corners (red-painted).
Recommended sling angle ≥ 60° from horizontal. Centre of gravity is
located ~2,400 mm from the X− end, ~1,150 mm from the rear, ~850 mm from
the floor (machine on its feet). Do **not** lift by the cross beam,
sheet-metal panels, or dust ducts.
