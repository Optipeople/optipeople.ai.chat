# Optipeople DemoCNC D-2800M — Technical Specifications

Document: D2800M-SPEC-001
Revision: 4.2
Effective date: 2026-01-15
Supersedes: D2800M-SPEC-001 rev 4.1 (2025-09)

## 1. Machine description

The Optipeople DemoCNC D-2800M is a 6-spindle CNC machining center designed
for the wood and panel industry, with a focus on cabinet doors, drawer
fronts, MDF panels, and solid wood components up to 2,800 mm length. It
combines vertical milling with automatic tool change, manual vertical
milling, horizontal hinge/lock-hole drilling and side drilling, and two
bevel spindles for 45° Lamello and biscuit operations.

The machine has two alternating work zones, an auto movable cross beam,
6 top pressers, and an automatic back positioning bar. Control is via an
industrial PC running the OptiPanel HMI on Windows 11 IoT LTSC, with
support for online 3D editing, MPR/DXF/CSV/BAN/XML/EXCEL import, and
barcode-scanned job recall.

## 2. Working envelope

| Parameter | Value |
|---|---|
| Max workpiece length (X) | 2,800 mm (extended frame to 3,000 mm with reduced clamping) |
| Workpiece width (Y) | 80–800 mm (width ≥ 80 mm required for vacuum hold) |
| Workpiece thickness (Z) | 12–60 mm |
| Min workpiece footprint | 250 × 200 mm |
| Drilling depth, max | 60 mm |
| Working table size | 2,660 × 420 mm |
| Working table height | 980 mm from floor |
| Movable beam stroke | 0–160 mm |
| Number of work zones | 2 (alternating) |

## 3. Axis system

| Axis | Drive | Rapid traverse | Repeatability | Positioning accuracy |
|---|---|---|---|---|
| X | Helical rack & pinion, iDIN6 class | 90 m/min | ±0.05 mm | ±0.10 mm / 1,000 mm |
| Y | Pre-tensioned ball screw, C5 class | 90 m/min | ±0.03 mm | ±0.05 mm / 1,000 mm |
| Z | Ball screw, C5 class | 20 m/min | ±0.02 mm | ±0.05 mm / 1,000 mm |

Drives are AC servos with absolute encoders (24-bit). The X axis is driven
by a 3.0 kW servo with planetary gearbox (ratio 10:1). Y and Z axes use
1.5 kW servos.

## 4. Processing unit

| # | Spindle | Power | Speed | Tool change | Notes |
|---|---|---|---|---|---|
| S1 | Vertical, automatic tool change | 7.5 kW | 18,000 rpm | ATC, ISO30, ER32 | Handle slots, hinge slots, decorative grooves |
| S2 | Vertical, manual tool change | 7.5 kW | 18,000 rpm | Manual | Backup vertical operations, long-run tools |
| S3 | Horizontal milling | 6.0 kW | 18,000 rpm | Manual collet | Top and bottom hinge cups, lock pockets |
| S4 | Horizontal drilling | 3.5 kW | 18,000 rpm | Manual collet | Side drilling |
| S5 | Bevel (45°) | 2.2 kW | 12,000 rpm | Manual collet | Lamello bevel groove |
| S6 | Bevel (45°) | 2.2 kW | 12,000 rpm | Manual collet | Lamello holes / biscuit slots |

All spindles run on 380 V 3-phase via dedicated Delta MS300 series VFDs.
Spindle bearings are angular contact, lifetime-greased, with built-in PT100
temperature monitoring.

### 4.1 Tool magazine

| Parameter | Value |
|---|---|
| Type | Inline pickup, traveling with vertical head |
| Slots | 8 |
| Holder | ISO30 |
| Collet | ER32 |
| Max tool diameter | 100 mm |
| Max tool length | 140 mm |
| Max tool weight | 1.5 kg |
| Tool-to-tool change time | 6.5 s |
| Chip-to-chip time, typical | 10–12 s |

### 4.2 Tool measurement

- 1× vertical laser tool setter (Renishaw-class, fabricated PN: OP-TS-V1)
- 2× horizontal touch probes for S3/S4 setting (PN: OP-TS-H1, OP-TS-H2)
- Auto length & diameter calibration accuracy: ±0.01 mm

## 5. Workholding

| Item | Detail |
|---|---|
| Table material | High-density phenolic with replaceable HPL surface |
| Vacuum zones | 12 (6 per work zone), independently valved |
| Side reference bar | Pneumatic pop-up, repeatability ±0.05 mm |
| Top pressers | 6× pneumatic, force 2,800 N each at 6 bar |
| Movable beam force | 3-stage cylinder, 0–160 mm stroke |

Vacuum supply must be 600 m³/h minimum, supplied by external vacuum pump
(not included). Recommended: dry-running rotary vane, 5.5 kW.

## 6. Pneumatics

| Parameter | Value |
|---|---|
| Supply pressure | 6.0 bar (min 5.5, max 8.0) |
| Air consumption, peak | 380 NL/min |
| Air quality | ISO 8573-1 class 4-4-3 minimum |
| Filtration | 5 µm, 0.3 µm coalescing, on machine |
| Input fitting | G 1/2" female |

## 7. Electrical

| Parameter | Value |
|---|---|
| Supply voltage | 380 V AC, 3-phase + N + PE |
| Frequency | 50 Hz (60 Hz available on request) |
| Total connected load | 33.67 kW |
| Recommended branch breaker | 80 A, type D, IΔn 30 mA Type B RCD |
| Power factor (typ) | 0.88 |
| Standby load | ~0.8 kW |

Internal logic uses 24 V DC. The main control cabinet (PN: OP-CAB-2800) is
IP54, mounted on the operator-side end of the frame, with 230 V single
phase service outlet for the IPC and a separate 24 V DC ELV bus.

## 8. Dust extraction

| Port | Diameter | Required flow |
|---|---|---|
| Main spindle hood (×2) | Ø 200 mm | 2,200 m³/h each |
| Drilling head hood | Ø 150 mm | 1,400 m³/h |
| Total | — | ~5,800 m³/h at 2,500 Pa |

## 9. Control system

- **IPC**: OptiPanel IPC-15 (Intel Core i5-12500T, 16 GB RAM, 512 GB SSD)
- **Display**: 15.6" projected-capacitive touchscreen, 1920×1080
- **OS**: Windows 11 IoT LTSC 24H2
- **Motion controller**: OptiMotion MC-6X (EtherCAT, 250 µs cycle, 8 axes)
- **HMI**: OptiPanel software v7.4.x
- **PLC**: Beckhoff TwinCAT 3.1, fail-safe Safety over EtherCAT (FSoE)
- **Network**: 2× 1 Gb Ethernet (one isolated for shop floor)
- **Input**: USB-A ×4, USB-C ×1, barcode scanner Y-cable
- **Remote support**: TeamViewer Tensor (whitelisted to optipeople.dk)

### 9.1 Supported file formats

- Native: `.opt` (OptiPanel job)
- Import: MPR, MPR2 (Homag), DXF, CSV, BAN, XML, XLSX
- Export: NC (G-code, ISO 6983 dialect), PDF report, CSV log

## 10. Safety

| Item | Detail |
|---|---|
| Standards | EN ISO 12100, EN ISO 13849-1 PL d, EN 60204-1 |
| Guarding | Full perimeter fence with 3 interlocked access doors |
| Door switches | Pilz PSEN-cs, coded magnetic (PN: OP-SF-D1..D3) |
| E-stop | 4 mushroom-button stations, dual-channel |
| Light curtains | Optional, finger-class type 4, 14 mm resolution |
| Brake test | Auto on power-up (Z gravity brake) |
| Stop category | Cat 1 on E-stop, Cat 2 on door open during cycle |

## 11. Physical

| Parameter | Value |
|---|---|
| Machine length (L) | 5,820 mm |
| Machine depth (W) | 2,520 mm |
| Machine height (H) | 2,000 mm |
| Loading height | 980 mm |
| Total weight | 2,200 kg |
| Floor anchor points | 8× M16 chemical anchor |
| Floor flatness | < 3 mm over machine length |
| Floor loading | Min 1,500 kg/m² |

## 12. Environmental

| Parameter | Value |
|---|---|
| Ambient temperature, operating | +5 to +40 °C |
| Storage temperature | -20 to +60 °C |
| Humidity, non-condensing | 30 to 85 % RH |
| Altitude | < 1,000 m without derating |
| Vibration class (ISO 10816) | < 2.8 mm/s RMS at the foot |
| Noise level, idle | 68 dB(A) @ 1 m |
| Noise level, cutting | 86 dB(A) @ 1 m (hearing protection required) |

## 13. Options

- OP-OPT-DCB — Dust removal belt under the work zones
- OP-OPT-HHS — Hinge hole spindle group (adds 5× 3.0 kW horizontal drills)
- OP-OPT-LC2 — Type-4 light curtains in lieu of physical doors
- OP-OPT-VAC — Integrated 5.5 kW vacuum pump skid
- OP-OPT-BC2 — Industrial 2D barcode scanner with stand
- OP-OPT-IO — Modbus TCP I/O coupler for MES/ERP integration

## 14. Warranty

3-year limited mechanical, 1-year electrical, 1-year wear parts. Spindles
covered 12 months / 4,000 spindle-hours, whichever first. See contract
T&Cs for exclusions.
