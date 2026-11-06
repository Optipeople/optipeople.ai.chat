"use client";

import { useState } from "react";
import { Markdown } from "@/components/ui/markdown";

const SAMPLE = String.raw`**Alarm 731** means the tool changer did not reach its home position, so the spindle is blocked until it is reset.

# Heading 1
## Heading 2
### Heading 3
#### Heading 4

A paragraph with **bold**, *italic*, ~~strikethrough~~, inline \`program.nc\` and a [web link](https://optipeople.com).

## Key term chips

On [CNC Mill 2](opti:term/machine), alarm [731](opti:term/alarm) clears with [RESET](opti:term/button). Check part [FX-2041](opti:term/part), set [Spindle Override](opti:term/param) to [80 %](opti:term/value) and compare with the [shift log](opti:term/data).

> [!WARNING]
> Lock out the main switch before opening the tool changer door. The arm can move without warning.

> [!CAUTION]
> Running at full feed with a worn insert will scrap the part.

> [!IMPORTANT]
> Home the axes before restarting the program.

> [!TIP]
> Hold **CYCLE START** for 2 seconds to resume from the last block.

> [!NOTE]
> This applies to controller firmware 4.2 and later.

## Steps

1. Press [E-STOP](opti:term/button) and wait for the spindle to stop.
2. Open the door and check the tool arm for chips.
3. Close the door and press [RESET](opti:term/button).
   - If the alarm returns, check the proximity sensor.
   - If it clears, run a tool change in MDI.
4. Restart the program.

## Options

- Clean the sensor face
- Replace the sensor
  - Part **FX-2041**
  - Part **FX-2042**
- Call service

## Checklist

- [x] Air pressure above 6 bar
- [x] Door interlock closed
- [ ] Tool table verified
- [ ] Test cut done

## Table

| Parameter | Value | Unit | Note |
| --- | --- | --- | --- |
| Spindle speed | 12,000 | rpm | Max for this tool |
| Feed rate | 1,450 | mm/min | Roughing |
| Coolant pressure | 6.5 | bar | |
| Tolerance | ±0.02 | mm | Finishing pass |

## KPIs

\`\`\`kpi
[{"label":"Uptime","value":97.2,"unit":"%","delta":"+1.4 pts vs last week","trend":"up","status":"good","hint":"last 7 days"},
 {"label":"Stops","value":14,"delta":"+3","trend":"up","status":"bad"},
 {"label":"OEE","value":81,"unit":"%","delta":"0.0","trend":"flat","status":"neutral"},
 {"label":"Scrap","value":2.1,"unit":"%","delta":"-0.4 pts","trend":"down","status":"good"}]
\`\`\`

## Charts

\`\`\`chart
{"type":"bar","title":"Stops per shift","unit":"stops","x":["Mon","Tue","Wed","Thu","Fri"],"series":[{"name":"Line 1","data":[4,2,5,3,1]},{"name":"Line 2","data":[2,3,1,4,2]}]}
\`\`\`

\`\`\`chart
{"type":"line","title":"Spindle temperature","unit":"°C","x":["08","09","10","11","12","13"],"series":[{"name":"Spindle","data":[31,34,38,41,40,39]}]}
\`\`\`

\`\`\`chart
{"type":"pie","title":"Stop causes","x":["Tool change","Material","Operator","Other"],"series":[{"name":"Stops","data":[9,5,3,2]}]}
\`\`\`

## Math

Cutting speed is $$v_c = \frac{\pi \cdot D \cdot n}{1000}$$ in m/min. For a 10 mm cutter at 12,000 rpm:

$$
v_c = \frac{\pi \cdot 10 \cdot 12000}{1000} \approx 377\ \text{m/min}
$$

A price of $20 to $30 stays plain text.

## Code

\`\`\`gcode
G90 G54 G00 X0 Y0
M06 T12 ; tool change
S12000 M03
G01 Z-2.0 F1450
\`\`\`

\`\`\`python
def cutting_speed(d_mm: float, rpm: int) -> float:
    return 3.1416 * d_mm * rpm / 1000
\`\`\`

## Quote and rule

> The manual says the arm must be homed after every power cycle.

---

See the [Operator manual, page 12](opti:doc/demo?page=12) for details.[^1]

[^1]: Operator manual rev. C, section 7.3.

\`\`\`questions
How do I replace the proximity sensor?
What causes alarm 731 to come back?
Show me the stop trend for last month
\`\`\`
`.replace(/\\`/g, "`");

export function FormattingPreview() {
  const [asked, setAsked] = useState<string | null>(null);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Markdown onAsk={setAsked}>{SAMPLE}</Markdown>
      {asked && (
        <p className="mt-6 text-[14px] text-[var(--color-muted-foreground)]">
          Would send: {asked}
        </p>
      )}
    </main>
  );
}
