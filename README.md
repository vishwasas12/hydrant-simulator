# Fire Hydrant Network Simulator

Draw a yard hydrant pipe network in the browser, run a steady-state hydraulic analysis, and see the flow and pressure at every point. It answers three questions:

1. What pressure and flow does each hydrant get?
2. How many hydrants can be open at once, and which combinations still meet the minimums?
3. How do pressures change when individual hydrants are switched on or off?

It runs fully offline, with no backend. Projects autosave to browser storage and can be saved as JSON files.

## Run it

```
npm i
npm run dev
```

Open the URL Vite prints. A reference project loads on first run.

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Run the Vitest suite |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run preview` | Serve the production build |

## Using it

**Drawing tools**

| Tool | Key | Behaviour |
|---|---|---|
| Select / move | V | Drag nodes. Double-click a hydrant or valve to toggle it. Drag empty space to pan. |
| Junction | J | Click to place. Clicking a pipe splits it. |
| Pipe | P | Click node A, then node B. Clicking empty space creates a node. Esc ends the chain. |
| Valve | A | Click a pipe to place a gate valve there. Change it to butterfly or non-return in the panel. |
| Hydrant | H | Marks a node, places one, or splits a pipe. |
| Hose reel | R | Same as Hydrant. |
| Pump | U | Marks a node as the pump outlet. |
| Toggle | T | Click a hydrant to switch it, or a valve or pipe to open or close it. |
| Delete | Del | Removes the selection. Deleting the pump keeps its node. |

Wheel zooms. Middle-drag or Space-drag pans. Ctrl+Z and Ctrl+Y undo and redo.

**Tracing a CAD drawing:** on the right-hand panel with nothing selected, use *Import image or PDF*, then *Calibrate scale*. Click two points and type the real distance. Pipe lengths then follow the drawing unless you type one in.

**Analysis tabs:** Manual (toggles and baseline delta), Nodes, Pipes, Hydrants, Critical path, Charts, Requirement check, Capacity, Scenarios, Assumptions. The *Report* button opens a printable report written for the client: summary, drawing, network inventory (junction schedule, tees, bends, end caps and pipe lengths read from the drawing), inputs, results and design basis. A capacity search or scenario comparison appears only once it has been run or saved, and sections are numbered from what is included. Its design basis lists only what the network uses.

**Tees and bends from the drawing:** with *Tees and bends from the drawing* on (Project panel, Solver), every junction is read from the drawing: three pipes make a tee, four a cross, two at an angle a bend, two sizes in line a reducer, and a hydrant on the main a branch tee. Their losses are added without typing them in: tee branch loss on the branch pipe, tee run loss on one run pipe, bends and reducers on the smaller pipe. The pipe panel lists them under *From the drawing*; add by hand only what the drawing does not show, such as bends on a riser. New projects start with it on. Files saved before it existed open with it off, so their results do not change; switching it on offers to remove hand-entered tees and elbows so they are not counted twice.

## Method

The solver is a pure function, `solve(network, scenario) → results`, in `src/solver/`. It has no UI imports.

It uses the **Global Gradient Algorithm** (Todini-Pilati, as in EPANET). Each iteration linearises every link around its current flow, solves one symmetric positive-definite system for node heads, then recovers flows from heads:

```
For each link:  p = 1 / (dh/dQ),   y = Q - p * h(Q)
Node system:    sum(p) H_i - sum(p H_j) = -d_i - sum_from(y) + sum_to(y)
Flow update:    Q = y + p (H_i - H_j)
```

The matrix uses a sparse LDLᵀ factorisation with minimum-degree ordering, analysed once per network. Pumps and emitters are links to a fixed-head node, so they are solved in the same iteration. A backtracking step guards the kinks in the pump and outlet laws. Iteration stops when the largest energy residual on any link is below the tolerance (default 1e-6 m). The iteration count and residual are shown in the status bar.

**Equations**

| Item | Equation |
|---|---|
| Hazen-Williams (SI) | `hf = 10.67 · L_eq · Q^1.852 / (C^1.852 · D^4.87)`, Q in m³/s, D in m |
| Darcy-Weisbach (optional) | `hf = f · (L_eq/D) · V²/2g` |
| Swamee-Jain | `f = 0.25 / [log10(ε/(3.7D) + 5.74/Re^0.9)]²`; laminar below Re 2000, linear blend to 4000 |
| Fittings, equivalent length | `L_eq = L + Σ(fitting equivalent lengths)` |
| Fittings, K method (optional) | `h = K · V²/2g` |
| Node pressure | `pressure head = total head − elevation` |
| Nozzle | `Q = K√P`, `K = Cd · A · √(2g)` |
| Emitter with hose | `P = Q²/K² + K_valve·V²/2g + hose friction`, outlets in parallel |
| Pump | `H(Q)` polynomial through the entered points, minus the suction loss |
| Units | 1 bar = 10.197 m of water; 1 LPM = 1/60000 m³/s |

## Capacity search

- Up to 15 hydrants: every combination is solved, in Gray-code order so each solve warm-starts from the last.
- Above 15: greedy best-first and worst-first searches run, ranked by hydraulic remoteness. Combination sizes with at most 100,000 members are still enumerated exactly. The results state which figures are exact and which are estimates.
- **Most hydrants open at once** is the largest k where at least one combination passes. **Any combination of up to** is the largest k where every combination passes. These answer different design questions.
- Hose reels stay in their current state during the search.
- The search runs in a Web Worker. By default it fails any combination that pushes the pump past the last point on its curve, because the head there is extrapolated. This can be switched off.

## Assumptions and defaults

The Assumptions tab lists every value used, its source, and any override. The choices below were made where the brief left a gap.

**Check these against the source documents before relying on results:**

- **Pipe internal diameters** (IS 1239 heavy; IS 3589 for 200 NB) and **NFPA 13 equivalent lengths** were entered from general knowledge. The brief's own values (154.3 mm ID, and the 25/80/150 mm elbow and tee figures) match, but the remaining cells have not been checked against the standards. All are editable.
- **Estimated fittings, not in NFPA 13:** tee (run) at one third of tee (branch), the Crane TP-410 ratio; reducer at K about 0.3; butterfly and gate valves below 50 mm.
- **K values** are Crane TP-410 multiples of the fully turbulent friction factor.
- **Minimum pressure and flow defaults** must be checked against the applicable code (NBC 2016 Part 4, TAC, IS 13039, NFPA 14/24).

**Choices made:**

| Item | Default | Reason |
|---|---|---|
| Hose lining C | 140 | Lined hose. Not in the brief |
| Landing valve K | 2.5, on valve bore | Oblique valve. Not in the brief |
| Hose reel discharge | Fixed 30 LPM | The brief gives flow and pressure only. Emitter fields default to a 6.5 mm nozzle and 30 m × 19 mm hose |
| Equivalent lengths at C ≠ 120 | Scaled by NFPA 13 multipliers | The table is only valid at C = 120. Can be switched off |
| Pump datum | Outlet node elevation | Water level is entered relative to it |
| Pump above last curve point | Straight-line extrapolation | A polynomial can turn back up outside its data |
| Critical outlet | Lowest pressure among open hydrants; hose reels only if no hydrant is open | |
| Critical path | Upstream from the critical outlet, taking the largest inflow at each node | |
| Hydrant with no path to the pump | Reported as an error and a failed outlet, while the rest still solves | |

**Emitter default against minimum flow.** The brief's emitter default (20 mm nozzle, Cd 0.97, 15 m hose) delivers about 468 LPM at 3.5 bar and needs about 12.9 bar to reach the default 900 LPM minimum. An emitter hydrant on these defaults therefore fails minimum flow on a 110 m pump. The properties panel warns about this. New hydrants keep the brief's defaults. The reference project uses fixed demand of 950 LPM, since 3 × 950 LPM matches the 2850 LPM pump.

**Pump curve shape.** A quadratic through the default three points rises slightly to about 132.8 m near 445 LPM before falling. The solver uses the fitted curve as entered and keeps a negative gradient there for stability.

## Limitations

- Steady state only. No transients or water hammer.
- A placed valve (Valve tool) works hydraulically: closed shuts its pipe, and a non-return valve blocks reverse flow (leakage under 0.1 LPM). A non-return valve added only as a *fitting* in the pipe's fittings list adds head loss and does not block flow.
- Valve position along a pipe is drawing only. Pressure-reducing valves are not modelled.
- One pump in the interface. The data model and solver accept more.
- Fixed demands are met regardless of pressure, as in demand-driven EPANET. A node at negative pressure is flagged and fails its check.
- The PDF import renders one page as an image. It does not read CAD geometry.
- Results need review by a qualified engineer.

## Validation

`npm test` runs these checks from the brief, along with solver robustness, editing, analysis and file-format tests:

| Check | Result |
|---|---|
| 100 m of 154.3 mm, C = 120, 2850 LPM | 4.78 m, 2.54 m/s |
| Same at C = 100 | 6.70 m |
| Two equal parallel pipes | Equal split, 1.32 m per 100 m |
| Simple loop against a hand Hardy-Cross solution | Closure below 0.01 m |
| Emitter at known pressure | `Q = K√P` within 0.5 % |
| Pump curve on a single pipe | `H_pump(Q) = losses + residual` |
| Reference project, 2850 LPM at farthest hydrant | About 20.8 m loss, 8.74 bar |

## Project layout

```
src/solver     Hydraulic engine: pure TypeScript, no UI imports
src/model      Types, JSON schema, defaults, tables, editing, seed project
src/analysis   Requirement check, capacity search and worker, scenarios
src/canvas     SVG drawing surface, legend, background import, calibration
src/panels     Properties, results tables, charts, analysis tabs
src/report     Assumptions list, drawing snapshot, printable report
src/state      Zustand store: undo/redo, autosave, solve cache
```

## JSON file format

A project file is one JSON object, validated on load against `src/model/project.schema.json`. Units are m, mm, LPM and bar.

```jsonc
{
  "schemaVersion": 1,
  "name": "Yard ring",
  "metersPerUnit": 1,              // metres per drawing unit
  "nodes": [{
    "id": "n1", "label": "HV 1", "x": 100, "y": 50,
    "elevationM": 0, "baseDemandLpm": 0,
    "kind": "hydrant",             // junction | hydrant | hoseReel
    "outlet": {                    // hydrant and hoseReel only
      "outlets": 1, "on": true,
      "model": "emitter",          // emitter | fixed
      "fixedFlowLpm": 950,
      "nozzleMm": 20, "cd": 0.97,
      "hoseLengthM": 15, "hoseDiameterMm": 63, "hoseC": 140,
      "valveDiameterMm": 63, "valveK": 2.5,
      "minPressureBar": 3.5, "minFlowLpm": 900
    }
  }],
  "pipes": [{
    "id": "p1", "label": "P1", "from": "n1", "to": "n2",
    "nominalMm": 150,              // or "custom"
    "internalDiameterMm": 154.3,
    "lengthM": 100, "lengthManual": false,
    "c": 120, "roughnessMm": 0.045,
    "status": "open",              // open | closed
    "valves": [{                   // optional
      "id": "v1", "label": "V1",
      "type": "gate",              // gate | butterfly | nonReturn
      "position": 0.5,             // 0 at "from", 1 at "to"; drawing only
      "status": "open",
      "forward": true              // nonReturn: true lets water flow from -> to
    }],
    "fittings": [
      { "id": "f1", "type": "elbow90", "quantity": 2 },
      { "id": "f2", "type": "custom", "quantity": 1, "customMode": "k", "customValue": 1.5 }
    ]
  }],
  "pumps": [{
    "id": "pump1", "label": "Fire pump", "nodeId": "n1",
    "suctionLossM": 0, "waterLevelM": 0,
    "curve": {                     // threePoint | table | constant
      "kind": "threePoint",
      "shutoffHeadM": 132,
      "ratedHeadM": 110, "ratedFlowLpm": 2850,
      "overloadHeadM": 75, "overloadFlowLpm": 4275
    }
  }],
  "settings": { "frictionModel": "hazenWilliams", "fittingMethod": "equivalentLength", "...": "..." },
  "tables": { "material": {}, "fittings": [], "cFactors": [] },
  "scenarios": [{
    "id": "s1", "name": "Aged pipe",
    "hydrantOn": { "n1": true },
    "pipeStatus": { "p1": "closed" },
    "valveStatus": { "v1": "closed" },
    "pipeC": { "p1": 100 },
    "globalC": 100
  }],
  "baseline": null,                // scenario the delta overlay compares against
  "background": null               // { dataUrl, name, x, y, width, height, opacity, visible }
}
```
