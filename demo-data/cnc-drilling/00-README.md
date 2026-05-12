# Optipeople DemoCNC D-2800M — Demo Knowledge Base

Fictional CNC drilling/milling machine used as test data for the Opti.AI.Chat
demo and QA flows. Inspired by a real machine class (Nanxing NCB2808M /
Nicho Machines NCB2808-M), but specifications, error codes, part numbers,
maintenance schedules and procedures here have been adjusted, invented, or
generalized. **None of this is operational guidance for any real machine.**

## Machine summary

- **Brand / model:** Optipeople DemoCNC D-2800M
- **Class:** CNC machining center for cabinet doors, drawer fronts and panel
  furniture
- **Category in admin:** CNC Drilling
- **Configuration:** 6-spindle (1× ATC vertical, 1× manual vertical,
  1× horizontal milling, 1× horizontal drilling, 2× bevel/Lamello),
  inline 8-slot tool magazine, twin work zones, auto movable beam
- **Working envelope:** 2,800 × 800 mm panels, 12–60 mm thick
- **Footprint:** 5,820 × 2,520 × 2,000 mm, 2,200 kg
- **Power:** 380 V / 3-phase / 50 Hz, 33.67 kW total connected load

## Documents in this knowledge base

| # | File | Purpose |
|---|------|---------|
| 01 | [01-technical-specifications.md](01-technical-specifications.md) | Full spec sheet, dimensions, electrical, pneumatics, performance |
| 02 | [02-technical-drawings.md](02-technical-drawings.md) | Layout drawings, axis diagrams, P&ID, electrical schematic overview |
| 03 | [03-installation-manual.md](03-installation-manual.md) | Site prep, rigging, anchoring, utilities, commissioning |
| 04 | [04-operator-manual.md](04-operator-manual.md) | Start-up, loading, jogging, tool setting, running jobs |
| 05 | [05-maintenance-manual.md](05-maintenance-manual.md) | Preventive maintenance, lubrication, inspection schedules |
| 06 | [06-error-codes.md](06-error-codes.md) | Alarm codes, causes, recovery procedures |
| 07 | [07-process-descriptions.md](07-process-descriptions.md) | Process & workflow descriptions for typical jobs |

## How to use this data

1. Create a machine in the admin panel called "CNC Drilling" (or "Optipeople
   DemoCNC D-2800M").
2. Pre-built PDFs for all 7 content documents live in [pdfs/](pdfs/). Drag
   them into the admin upload flow as-is.
3. Organize uploads into folders matching the document numbers (e.g.
   `Specifications/`, `Installation/`, `Operation/`, `Maintenance/`,
   `Errors/`, `Process/`).
4. Keep some uploads as `.md` source files alongside the PDFs — useful for
   exercising both the text-layer and OCR paths of the ingestion pipeline
   (though `.md` itself isn't ingested; only PDFs are).

### Regenerating PDFs

To rebuild PDFs after editing the source `.md` files:

```bash
npm install --no-save marked@15
node demo-data/cnc-drilling/build-pdfs.mjs
```

The script uses Microsoft Edge in headless mode for the print step (no
Puppeteer/Chromium download) and writes into `pdfs/`.

## Disclaimer

All technical values — torque figures, oil grades, error codes, part
numbers, voltages on specific terminals, sensor positions — are
**fabricated for demo content**. Do not use this material to commission,
service, or troubleshoot a real machine.
