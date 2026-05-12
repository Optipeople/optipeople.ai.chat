# Optipeople DemoCNC D-2800M — Process & Workflow Descriptions

Document: D2800M-PROC-001
Revision: 3.0
Effective date: 2026-04-01

This document describes the standard processes the D-2800M is built to
run, along with the typical workflow for each one. It is intended both
as training material and as the reference for what the machine can
realistically produce.

## 1. Process overview

The D-2800M is a machining center optimized for cabinet doors and drawer
fronts but capable of any rectangular panel work within its envelope.
Typical processes:

| ID | Process | Primary spindle | Typical tools |
|---|---|---|---|
| P1 | Recessed handle grooves (semicircle, rocket, horn) | S1 ATC vertical | Profile cutters Ø 8–16 mm |
| P2 | Trunking grooves (lighting / cable channels) | S1 ATC vertical | Straight cutter Ø 4–8 mm |
| P3 | Straightener relief grooves | S1 or S2 vertical | Straight cutter Ø 6 mm |
| P4 | 45° Lamello bevel groove | S5 bevel | Bevel cutter Ø 100 mm |
| P5 | Lamello / biscuit holes | S6 bevel | Slot drill Ø 4 mm |
| P6 | Hinge cup bores (top & bottom hinges) | S3 horizontal milling | Forstner-style Ø 35 mm |
| P7 | Lock pocket and key hole | S3 horizontal milling | End mill Ø 8 mm + drill |
| P8 | Side drilling (32 mm system) | S4 horizontal drilling | HSS drill Ø 5 / Ø 8 |
| P9 | Decorative top groove / V-cut | S1 ATC vertical | V-cutter 90° / 60° |
| P10 | Aluminium handle bar slots | S1 ATC vertical | Carbide upcut Ø 6 mm |

## 2. Job lifecycle

```
   CAD/CAM  ──► OptiPanel ──► Job queue ──► Operator ──► Machine ──► Reports
     (MPR/      (import,        (barcode      (load &      (cycle)     (CMMS,
     DXF, ...)   nest, NC)       lookup)       confirm)                ERP)
```

### 2.1 Where jobs come from

Three import paths are supported:

1. **MPR / MPR2 from Homag woodCAD/CAM** — most common for cabinet
   doors. Direct import preserves operation grouping and feeds.
2. **DXF + parameter file** — for jobs created in lighter CAD tools.
   The parameter file (CSV or XML) defines tool, depth, and feed per
   layer.
3. **OptiPanel native (.opt)** — created on the HMI or in OptiPanel
   Studio (desktop application).

### 2.2 Nesting and panel layout

For batches that don't fit a single panel, OptiPanel runs a rectangular
nesting algorithm. The output is a per-panel `.opt` file with a barcode
that links back to the source job.

## 3. Standard processes in detail

### P1 — Recessed handle grooves

Cabinet doors with finger-pull handle profiles. The cutter follows a
contour parallel to the top edge of the door at a depth of typically
13 mm.

**Toolpath outline:**
1. Plunge entry 50 mm from the door edge (avoid edge chipping).
2. Climb-mill toward the X− end of the door.
3. Lift, rapid back to start.
4. Repeat 2–3 passes to reach final depth.

**Recommended parameters:**

| Material | Tool Ø | Feed | Spindle | DOC (per pass) |
|---|---|---|---|---|
| MDF 18 mm | 12 mm | 6 m/min | 18,000 rpm | 5 mm |
| Solid oak | 12 mm | 4 m/min | 16,000 rpm | 3 mm |
| Painted MDF | 10 mm | 3 m/min | 18,000 rpm | 3 mm |

**Quality notes:**
- For painted doors, use a downcut tool to keep the painted face clean.
- Burn marks usually indicate dull cutter or insufficient feed.

### P2 — Trunking grooves

A shallower, wider variant of P1. Used for built-in cable management on
furniture sides.

**Quality notes:**
- Keep the groove ≥ 8 mm from any edge to avoid blow-out.
- For decorative furniture, dust extraction must be running well —
  loose chips will polish the surface inside the groove.

### P4 — 45° Lamello bevel groove

Bevel cutter S5 cuts a 45° groove along an edge for Lamello T-20
connectors.

**Operation sequence:**
1. Beam moves to align with the workpiece edge.
2. S5 head tilts to 45° (factory-set; checked at install).
3. The cutter plunges to depth, then traverses parallel to the edge.

**Common defects:**

| Defect | Likely cause |
|---|---|
| Uneven groove depth | Panel not properly clamped — check pressers |
| Burn at the start | Feed too slow at entry — adjust ramp |
| Width inconsistent | Cutter run-out > spec — recheck S5 collet |

### P6 — Hinge cup bores (top & bottom hinges)

Standard 35 mm Ø cup bores at fixed offsets from the door edges.

**Specification:**
- Diameter: 35 mm
- Depth: 12 mm
- Distance from top/bottom door edge: 100 mm (default; customizable per
  hinge brand)
- Distance from inner door edge: 22.5 mm centre

**Cycle:**
1. Door clamped, Z+offset auto-corrected for measured thickness.
2. S3 head positions, plunges, dwells 0.2 s, retracts.
3. Repeat for the second hinge cup.

**Quality notes:**
- A Ø 35 forstner bit must be sharp. Dull bits cause tear-out at the
  rim, especially on veneered doors.
- Hinge brand changes (Blum vs. Hettich vs. Salice) only change the
  offsets, not the diameter.

### P7 — Lock pocket & key hole

A rectangular pocket plus a smaller bore for the key cylinder. Used on
office furniture, lockable drawers, residential cabinets with locks.

**Cycle:**
1. End mill plunges and clears the pocket.
2. Bit change → drill.
3. Drill plunges for the cylinder hole.

### P8 — Side drilling (32 mm system)

Industry-standard line drilling at 32 mm pitch, used for shelf pin holes
and cabinet assembly. The S4 drilling spindle moves along the door's Y
edge.

**Specification:**
- Pitch: 32 mm
- Diameter: 5 mm (shelf pins) or 8 mm (cam-and-dowel)
- Depth: 13 mm typical
- Edge offset: 37 mm

**Cycle**: one plunge per hole, ~0.4 s each. A typical 800 mm tall side
panel takes 12 s for the full line of 25 holes.

## 4. Quality control workflow

After each cycle the operator should:

1. Visually inspect the part for obvious defects (burn marks, tear-out,
   missed operations).
2. Use a calibre on a representative dimension (handle groove depth,
   hinge cup spacing) at least once per shift, or once per setup change.
3. Tag any defective part with the job's barcode and an "NG" sticker so
   the rework workflow can find it.

A quarterly capability study (Cpk on hinge spacing, handle groove
position) is the recommended baseline.

## 5. Material handling guidelines

| Material | Notes |
|---|---|
| MDF | Most common. Dust is fine — extractor is mandatory |
| HDF | Harder, dulls tools 2× faster than MDF |
| Particle board | Vacuum hold is critical — porous panels need extra zones |
| Plywood | Reduce feed near the edges to prevent splintering |
| Solid wood | Grain direction matters — favour climb-milling |
| Lacquered MDF | Use downcut tools; cover the work zone to control overspray |
| Acrylic / PMMA | Reduce spindle speed and use a single-flute tool; otherwise melts |
| Aluminium handles | Pre-position; use carbide upcut with lubrication mist |

## 6. Throughput planning

The machine has two work zones. The throughput-optimal workflow is:

1. Operator loads zone A.
2. Machine starts zone A. Operator immediately begins loading zone B.
3. Machine finishes zone A → automatically starts zone B.
4. Operator unloads zone A, loads next panel.

This alternating pattern keeps spindle utilization > 80 % for cycles
longer than the operator's loading time (~25–35 s per panel for an
experienced operator).

For very short cycles (< 30 s), the operator can't keep up and
single-zone operation is acceptable.

### Typical cycle times (reference)

| Job profile | Cycle time |
|---|---|
| Plain MDF door, hinge cups + handle groove | 38 s |
| Decorative door with V-grooves + handle | 1 m 25 s |
| Drawer front with side drilling | 52 s |
| Full kitchen door (hinges, lock, handle, decorative) | 2 m 10 s |
| Cabinet side panel with 32mm pin line | 1 m 05 s |

Above figures assume MDF 18 mm, sharp tools, and warm machine.

## 7. Common workflows

### 7.1 First piece of a new batch

1. Operator scans the first panel's barcode.
2. HMI shows job preview. Operator confirms tool list matches the
   magazine (HMI flags any mismatch with a red dot).
3. Cycle runs. Operator watches it through.
4. Inspect the finished part. Adjust any per-job offsets if needed
   (e.g. hinge position) in **Jobs → Edit → Per-batch offsets**.
5. Saved offsets apply automatically to the rest of the batch.

### 7.2 Tool wear mid-batch

1. HMI raises `W-4001 Tool life expired` or operator notices burn marks.
2. Pause at end of current cycle (do not abort mid-cycle).
3. Change tool. Re-calibrate length (operator manual §6.2).
4. Reset the life counter.
5. Resume.

### 7.3 Panel reject and rerun

If a part comes off defective:
1. Mark it NG and remove from the line.
2. From **Jobs → History**, find the cycle, click **Rerun**.
3. The same NC is queued — load a fresh panel and proceed.
4. The original cycle is kept in history with a "rerun" link, so the
   shop floor can see why an extra panel was made.

### 7.4 End of day / start of day handover

The HMI's **End of Shift** report summarizes:
- Cycles completed
- Tool changes
- Alarms (warnings + errors + faults)
- Spindle hours added to each spindle's TBO counter
- Top 5 jobs by cycle count

This report can be auto-emailed to the production manager — configure
under **Settings → Reports → Shift Email**.

## 8. Integration scenarios

### 8.1 With Homag woodCAD/CAM

MPR/MPR2 export drops a file into a watched folder. OptiPanel imports,
generates the NC, and queues the job by barcode. Operator scans the
printed sticker on the panel to start.

### 8.2 With an ERP / MES

The machine exposes a Modbus TCP map (optional OP-OPT-IO module) with
current cycle, current job ID, total cycles today, and alarm state.
Some shops pull these once per minute into Power BI or a similar
dashboard.

### 8.3 With Opti.AI Chat / Optipeople platform

The machine is registered as "CNC Drilling" in the Optipeople admin
panel. Operators and supervisors can ask natural-language questions
("what does E-3210 mean?", "how often should I grease the X axis?")
and the assistant resolves answers against the documents in this
knowledge base.
