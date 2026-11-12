# Build: Fire Hydrant Network Simulator (web app)

## Goal
Build a browser-based tool to draw a fire hydrant pipe network, run a steady-state hydraulic analysis, and show the flow and pressure at every point. It should answer three questions:

1. What pressure and flow does each hydrant get?
2. How many hydrants can be open at once, and which combinations still meet the minimum requirements?
3. How do pressures change when I switch individual hydrants on or off?

The user is an engineer working on yard hydrant systems: a 150 mm ring main, 80 mm hydrant branches, 25 mm hose reels, and one fire pump of about 2850 LPM at 110 m head.

## Tech stack
- React + TypeScript + Vite, single-page app, runs fully offline (no backend).
- Canvas: SVG, or Konva/react-konva, with pan and zoom.
- Hydraulic solver in pure TypeScript, kept separate from the UI (`src/solver/`) so it can be unit-tested.
- Tests: Vitest.
- State: Zustand or React context; undo/redo is required.
- Save/load: a JSON project file. Autosave to localStorage.

## 1. Drawing the network (canvas)

**Tools** (toolbar plus keyboard shortcuts):

| Tool | Behaviour |
|---|---|
| Select / Move (V) | Drag nodes; pipes follow. |
| Junction (J) | Click to place a node. |
| Pipe (P) | Click node A, then node B, to connect them. Clicking empty space creates a new node and connects it. Optional orthogonal snapping. |
| Hydrant (H) | Mark a node as a hydrant, or place one. |
| Hose reel (R) | Mark a node as a hose reel. |
| Pump (U) | Mark one node as the pump outlet. One pump in v1; keep the data model open to more. |
| Delete (Del) | Remove the selected item. |

**Background drawing for tracing** — important, because the user works from CAD PDFs:
- Import an image or PDF page (pdf.js) as a locked background layer with adjustable opacity.
- Scale calibration: click two points and type the real distance in metres. From then on, pipe length defaults to the drawn length × scale, and the user can override it.

**Display:**
- Show labels (HV 1, HR 2, J5…) and a grid.
- Colour pipes by diameter.
- After a solve, colour by pressure or velocity (toggle), with a legend.

## 2. Properties panel (right side, opens for the selected item)

**Pipe**
- ID
- Nominal size: 25 / 32 / 40 / 50 / 65 / 80 / 100 / 150 / 200 mm, or custom.
- Internal diameter: auto-filled from a material table (MS heavy class IS 1239/3589 by default), editable.
- Length in m: from the drawing scale, or manual.
- Hazen-Williams C. Default 120; quick presets: New steel 120, Aged steel 100, HDPE 150, Cement-lined 140.
- **Fittings list.** Click a pipe → "Add fitting" → choose the type and quantity:
  - 90° elbow, 45° elbow, long-radius bend
  - tee (run), tee (branch)
  - butterfly valve, gate valve, non-return valve, reducer
  - custom (enter an equivalent length or a K value)
  - Show small icons on the pipe for each fitting.
- Status: open or closed (closed = an isolation valve shut).

**Junction**
- ID
- Elevation in m (default 0)
- Optional base demand in LPM

**Hydrant** (a junction with an outlet)
- ID
- Type: single or double outlet
- State: ON/OFF switch
- Discharge model, choose one:
  - *Emitter (default):* Q = K·√P, with K derived from the nozzle diameter and coefficient. Defaults: 63 mm landing valve, hose 15 m × 63 mm, nozzle 20 mm, Cd 0.97. Include hose friction.
  - *Fixed demand:* Q in LPM. Default 950 LPM per outlet.
- Required minimum residual pressure. Default 3.5 bar, editable.
- Required minimum flow. Default 900 LPM per outlet, editable.
- Note in the UI that these defaults must be checked against the applicable code (NBC 2016 Part 4, TAC, IS 13039, NFPA 14/24).

**Hose reel**
- Same as a hydrant, with defaults of 30 LPM and a 1.5 bar minimum.

**Pump**
- Node
- Curve entry, choose one:
  - Three points: shutoff, rated and 150 % flow. Default shutoff 132 m @ 0, rated 110 m @ 2850 LPM, 150 % point 75 m @ 4275 LPM.
  - Paste a multi-point table.
  - Constant head.
- Fit a smooth quadratic or cubic through the points; show the curve in a small chart.
- Suction / pump-room loss: an extra head deduction in m, default 0.
- Water level relative to pump datum in m.

## 3. Hydraulic engine (`src/solver/`)

**Method:**
- Steady-state solution using the Global Gradient Algorithm (Todini–Pilati, as in EPANET), or Newton–Raphson on node heads.
- Must converge for looped networks, closed pipes, multiple open hydrants and a pump curve.
- Report the iteration count and residual.
- Give a clear error message for disconnected parts or nodes with no path to the pump.

**Equations:**
- Pipe friction, Hazen-Williams in SI units:
  `hf = 10.67 · L_eq · Q^1.852 / (C^1.852 · D^4.87)` (Q in m³/s, D in m).
- Darcy-Weisbach with the Swamee-Jain friction factor as an optional switch, with roughness ε.
- Fittings, by equivalent length, from a table based on NFPA 13 (valid at C = 120):

  | Fitting | 25 mm | 80 mm | 150 mm |
  |---|---|---|---|
  | 90° elbow | 0.6 m | 2.1 m | 4.3 m |
  | Tee (branch) | 1.5 m | 4.6 m | 9.1 m |

  Fill in the rest of the table for all sizes and fitting types, show the table in an "Assumptions" view, and make it editable. `L_eq = L + Σ(fitting equivalent lengths)`. Optional K-value method instead: `h = K·V²/2g`.
- Elevation: node pressure head = total head − elevation.
- Emitter hydrants: `Q = K·√P`, solved inside the same iteration.
- Unit conversions: 1 bar = 10.197 m of water; 1 LPM = 1/60000 m³/s.

**Outputs, per node:**
- Total head (m)
- Pressure (m and bar)
- Demand / outflow (LPM)
- Pass/fail against the hydrant's minimum pressure and minimum flow

**Outputs, per pipe:**
- Flow (LPM) with an arrow showing direction
- Velocity (m/s), flagged if above a 5 m/s limit (editable)
- Head loss (m)
- Loss per 100 m
- L_eq

**Outputs, system:**
- Pump operating point: flow, head, pressure in bar
- The critical (lowest-pressure) hydrant
- Total flow

## 4. Analysis modes

- **Manual:** toggle any hydrant on or off (on the canvas or in a list). The network re-solves live, within 200 ms. Show a "delta vs baseline" overlay: the user pins a baseline configuration, and each node shows its pressure change compared with it.
- **Requirement check:** for each hydrant alone (all others off), report the residual pressure, the flow, and the pump head needed to meet the minimum. This also answers "what pressure does each hydrant need".
- **Simultaneous capacity:**
  - Find the maximum number of hydrants that can be open together while every open hydrant meets its minimum flow and pressure.
  - List the passing and failing combinations, sorted from worst to best margin.
  - Search: exhaustive for up to about 15 hydrants (show a progress bar and run it in a Web Worker). For larger networks, use a greedy search for the hydraulically remotest hydrants plus a user-chosen "k farthest" search.
  - Also report the worst-case combination for a chosen k (for example, the 2 or 3 remotest hydrants together).
- **Scenario compare:** save named scenarios (valve shut, aged pipe at C = 100, and so on) and compare them side by side in a table.

## 5. Results UI

- Results table with tabs for Nodes, Pipes and Hydrants: sortable, filterable, exportable to CSV.
- Critical path: highlight the path from the pump to the critical hydrant, and show a table along it with segment, L, L_eq, Q, hf and the pressure after each segment.
- Charts (Recharts or a similar library):
  - the pump curve with the system curve and operating point
  - a pressure profile along the critical path
- **Assumptions panel:** list every value the solver used, with its source — defaults, the material ID table, the fitting table, C values, hydrant model constants, unit conversions, and any value the user overrode (marked as such).
- Export a printable report (HTML, then print to PDF) containing the drawing snapshot, inputs, assumptions, results tables, charts and the pass/fail summary.

## 6. Validation (must pass, as Vitest tests)

1. **One-pipe check:** 100 m of 150 mm pipe (ID 154.3 mm), C = 120, 2850 LPM → hf = 4.78 m (±0.02). With C = 100 → 6.70 m. Velocity 2.54 m/s.
2. **Two equal parallel pipes:** each carries half the flow, and the head loss equals that of one pipe at half flow (1.32 m per 100 m at 1425 LPM).
3. **Simple loop:** compare with a hand Hardy-Cross solution. Loop energy closure below 0.01 m.
4. **Emitter:** at a known pressure, Q = K√P matches within 0.5 %.
5. **Pump curve:** with the default curve and a single pipe, the operating point satisfies H_pump(Q) = losses + residual.
6. **Reference project (seed file):** include an example project that loads on first run — a rectangular ring of 150 mm pipe, about 1.9 km total, with three cross headers, 26 hydrants and the pump at one corner. Expected result: with full 2850 LPM drawn at the farthest hydrant, loss of about 17–25 m and residual of about 8–9 bar. Use it as a smoke test, not an exact assertion.

## 7. Code quality

- Folder layout: `src/solver`, `src/model` (types plus JSON schema), `src/canvas`, `src/panels`, `src/analysis`, `src/report`.
- Strict TypeScript; no `any` in the solver.
- The solver is a pure function `solve(network, scenario) → results`. No UI imports inside it.
- README covering: how to run (`npm i && npm run dev`), the method with equations, the assumptions and their sources, limitations (steady state only; no transients or water hammer), and the JSON file format.
- Build incrementally and show me a working step at each stage:
  1. Data model + solver + tests
  2. Canvas drawing + properties panel
  3. Solve + results colouring
  4. Hydrant toggles + baseline delta
  5. Capacity / combination search
  6. Background import + scale calibration
  7. Report export

  Run the tests after each step.

## Clarify before starting
If anything above is ambiguous, ask me before building. Otherwise pick sensible defaults, list them in the README and the Assumptions panel, and go ahead.
