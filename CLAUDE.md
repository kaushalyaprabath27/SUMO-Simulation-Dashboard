# SUMO Simulation Dashboard — Complete Reference

## What this actually is (read this first)

This is **not** a SUMO simulation/RL research project — there is no TraCI, no
libsumo, no Python, no bundled network/route files, and no control loop that
steps a simulation. It's an **Electron desktop GUI** (JS/HTML/CSS only) that
does two things for someone who already has their own SUMO project on disk:

1. **Builds demand XML** (routes/flows/pedestrian crossings/bus dwell/parking)
   through editable tables, instead of hand-writing `.rou.xml`.
2. **Runs SUMO as an external process** (`sumo` / `sumo-gui`, spawned via
   Node's `child_process`) and parses whatever output XML comes back
   (tripinfo, summary, detector, emissions, edgeData) into readable
   tables/charts — GEH validation, MAPE travel-time validation, emissions
   comparison across up to 5 scenarios, and a bus-dwell-time sweep.

The user's own `.net.xml` / `.rou.xml` / `.add.xml` / `.sumocfg` live in a
project folder **outside this repo**, loaded at runtime via a folder picker.
Nothing SUMO-specific is checked into this repo itself.

## Purpose & intended user

Built for one person's own thesis/study of a specific real road corridor —
a two-way road with detectors named `det_sec{1,2,3}_{galle,juul}_dir`,
referred to in early comments as "Galle–Julgaha" / "B130" — then generalized
so it works with any SUMO project folder. Intended user: a single
researcher/analyst iterating on their own SUMO scenario, not a multi-user
service, not an RL agent, not a city-planning platform. See `README.md` for
a quick-start; this file is the deeper technical reference.

## Stack

- Electron 31 (`main.js` = main process, `preload.js` = contextBridge,
  `index.html`/`app.js`/`data.js`/`detector.js`/`xmlBuilder.js` = renderer).
- No frontend framework — one large plain-object `App` (`app.js`, ~5400
  lines) driving direct DOM manipulation (`innerHTML` string templates).
- No backend/server, no database. All state lives in `localStorage` plus
  whatever files are read/written directly on disk via IPC.
- Vendored (not npm) libraries in `vendor/`: Chart.js (`chart.umd.min.js`),
  jsPDF (`jspdf.umd.min.js`), html2canvas (used for report generation).
- `electron-builder` → NSIS installer for Windows (`npm run dist`; the only
  target actually configured is `win`/`nsis`). Current version at last
  check: 1.0.31.
- No CI, no Docker, no lint config, no TypeScript. There is now `npm test`
  (Node's built-in `node --test`, no dependency added) covering four
  extracted pure modules — 46 tests total. See "Testing" below for exactly
  what's covered and what still isn't.
- Git repository, MIT-licensed (`LICENSE.txt`). `package.json`'s
  `"private": true` just opts out of `npm publish` (this isn't an npm
  package) — unrelated to the repo's own visibility.

## File map

| File | Lines | Role |
|---|---|---|
| `main.js` | ~254 | Electron main process. |
| `preload.js` | ~9 | contextBridge — exposes 5 IPC methods to the renderer. |
| `app.js` | ~5400 | Everything else: all 9 tabs, state, parsing, math, PDF report, undo/redo, persistence. One `const App = {...}`. |
| `data.js` | ~150 | Static data: 7 built-in vehicle-type defaults, param metadata, legacy `TIME_INTERVALS`. |
| `detector.js` | ~330 | `DetectorManager` — saved validation-run history + CSV export only; the dead calibration/GEH/Google-Sheets code that used to live here has been removed (see History). |
| `emissionsParser.js` | ~215 | `parseEmissionsRegexPure()` — the tripinfo/emissions regex parser, extracted into a plain `this`-free function so the exact same code can run either on the main thread or inside `emissionsWorker.js`. Also `module.exports`-guarded so `tests/` can `require()` it directly under Node. Now includes post-parse validation (see Formulas section). |
| `emissionsWorker.js` | ~15 | Web Worker entry point — `importScripts('emissionsParser.js')`, parses off the main thread so a large tripinfo file doesn't freeze the UI. |
| `graphDistance.js` | ~85 | `computeLaneGraphDistance()` — the Dijkstra lane-graph shortest-path calc behind MAPE's "📐 Auto" segment-distance button, extracted verbatim from `App._computeDetectorDistance` for Node testability. |
| `intervalAggregation.js` | ~50 | `aggregateRecordsByInterval()` — the interval-bucketing logic behind Validation/MAPE's "Interval (min)" control, extracted verbatim from `App._aggregateRecordsByInterval` (which was already `this`-free). |
| `gehMape.js` | ~85 | GEH and MAPE formulas/status-threshold functions, extracted verbatim from `App._buildGEHTables`/`App._renderMapeFromDetectorRaw`/`App._renderMapeFromRaw`. Deliberately keeps **two distinct** MAPE error/status/model-status function sets (detector-pair format vs. edge format) rather than unifying them — see Formulas section for why they actually differ. |
| `xmlBuilder.js` | ~127 | `App._buildFullXML()` — combined demand XML export. |
| `index.html` | ~845 | All 9 tabs' markup, splash screen, global error overlay. Loads `emissionsParser.js`/`graphDistance.js`/`intervalAggregation.js`/`gehMape.js` via `<script>` before `app.js`. |
| `styles.css` | ~389 | Plain CSS, light/dark via `body.dark-mode`. |
| `tests/*.test.js` | ~450 total | `node --test` coverage — 46 tests across 4 files, all passing. See "Testing" below. |

## `main.js` — IPC channels (exact contract)

Exposed to renderer via `preload.js`'s `window.electronAPI`:

- **`selectFolder()`** → `ipcMain.handle('select-folder', ...)`. Opens a
  native directory dialog. Reads only files ending in `.rou.xml`, `.add.xml`,
  `.net.xml`, `.sumocfg` from the chosen folder (non-recursive, top level
  only). Returns `{ name, folderPath, files: [{name, content}] }` or `null`
  if cancelled. Sets module-level `loadedFolderPath`.
- **`runSumo({ cfg, step, folderPath, freqSec })`** → `run-sumo` handler.
  Spawns `sumo-gui` **detached** (`{ detached: true, stdio: 'ignore' }`,
  `proc.unref()`), fire-and-forget — resolves after a fixed 300ms delay
  (just long enough to catch an immediate ENOENT) rather than waiting for
  the GUI window to close. Requests `--tripinfo-output`, `--summary-output`,
  `--device.emissions.probability 1.0`, plus whatever `prepareRunFiles()`
  computes for `--additional-files`.
- **`runSumoHeadless({ cfg, step, folderPath, freqSec })`** → 
  `run-sumo-headless` handler. Spawns `sumo` (no GUI) and **awaits** its
  `close` event. Rejects with `SUMO exited with code {code}` + last 2000
  chars of stderr if exit code ≠ 0. On success, reads back and returns
  `{ tripinfo, summary, travelTimes, notes }` (each `null` if the
  corresponding output file doesn't exist).
- **`writeProjectFile({ filename, content })`** / **`readProjectFile({ filename })`**
  → write/read a file inside the loaded project folder only. Guarded by
  `safeProjectPath()`: rejects any filename containing `/`, `\`, or `..`, and
  throws if no folder has been loaded yet. Used by "💾 Save Changes".

### `main.js` helper functions (not exposed directly, called internally)

- **`prepareAdditionalFiles(cfg, cwd)`** — reads the `.sumocfg`'s
  `<additional-files value="...">`, and for each listed additional file,
  scans its own `file="..."` attributes (e.g. detector/edgeData output
  paths). If a referenced output directory doesn't exist: tries to
  `mkdirSync` it in place first (leaves the original path untouched if that
  succeeds); only if that fails (e.g. it's another user's absolute path like
  `C:\Users\OtherUser\...`) does it write a `.local.add.xml` copy with the
  path redirected into a local `sumo_output/` folder, and points SUMO at
  that copy instead via `--additional-files` (never edits the user's
  original file). Returns `{ additionalFilesArg, notes }`.
- **`ensureEdgeDataFile(cwd, freqSec)`** — always writes
  `dashboard_edgedata.add.xml` (a dashboard-owned file, distinct from the
  user's own `.add.xml`) requesting `<edgeData file="dashboard_traveltimes_output.xml" freq="{freqSec}"/>`,
  so MAPE Validation always has travel-time data available without the user
  configuring anything. Default `freq` is 600s if `freqSec` isn't positive.
- **`prepareRunFiles(cfg, cwd, freqSec)`** — combines the two above; returns
  `{ additionalFilesArg, notes, travelTimesPath }`. Called by both
  `run-sumo` and `run-sumo-headless`.

## `app.js` — top-level state (the `App` object's data fields)

- `originalVehicleTypes` — deep clone of `data.js`'s `VEHICLE_TYPES`, kept
  for the "Reset Defaults" button.
- `_customVehicleTypes: {}` — vType ids from an uploaded project that don't
  match one of the 7 built-in categories; rendered as extra columns.
- `_extraVTypeParams: []` — vType XML attributes seen in an uploaded project
  that aren't in the fixed `VTYPE_PARAMS` list; rendered as extra rows.
- `_lastEmissionsRawXml` — array of `{xml, label}` for currently-loaded
  emissions scenarios, kept in memory so Sim Start/Duration changes can
  re-bin without re-uploading. Also written to disk in the project folder
  as `dashboard_emissions_cache.json` (via `_persistEmissionsRawXml()`,
  the existing `writeProjectFile` IPC channel) and restored on folder
  load (`_restoreEmissionsCache()`) — previously this was memory-only and
  silently lost on refresh; see Known Issues history.
- `undoStack` / `redoStack` / `isApplyingUndoRedo` — generic undo/redo.
- `_flowsState: { routes: [], intervals: 8, intervalDuration: 10, data: {} }`
  — the single source of truth for "interval duration" reused elsewhere
  (MAPE edgeData `freq`, Emissions bin width) via `_getIntervalFreqSec()`.
- `_pedState: { crossings: [], intervals: 8, intervalDuration: 10, data: {} }`
- `_busState: { stops: [], parkingAreas: [], parkingData: {}, dwellData: {} }`
- `project: {...}` — folder metadata: `name`, `folderPath`, `sumocfgName`,
  `simStartTime`, `simDuration`, `routes`, `vehicleTypes`, `busStops`,
  `parkingAreas`, `crossings`, `crossingEdges`, `detectors`, `flows`,
  `parkingFlows`, `pedFlows`, `busDwellFlows`.
- `_netLaneGraph` — `{ laneLength: {laneId: meters}, adjacency: {laneId: [laneId,...]} }`,
  built from the project's `.net.xml` on folder load; powers MAPE's
  automatic segment-distance calculation. In-memory only, not persisted
  (real networks can be large).
- `_mapeSegments`, `_lastMapeMode` (`'edge'`|`'detector'`), `_lastMapeRaw`,
  `_lastMapeDetectorRaw`, `_lastGEHRawData`, `_lastGEHRunName`,
  `_lastGEHDescription`, `_lastSimResults`, `_vTypeMap`, `_mapeNames`,
  `_validationNames`, `observedGEH`, `observedMAPE`.

## Complete `localStorage` key inventory

| Key | Written by | Holds |
|---|---|---|
| `sumoProject` | `_parseProjectFiles` | `App.project` (folder metadata) |
| `sumoSimSettings` | `saveSimSettings` | `{simStartTime, simDuration, simStep}` |
| `sumoDashboardState` | `saveToLocal` | `_flowsState`/`_pedState`/`_busState` bundle |
| `sumoDashboardVersion` | `init` | schema version int — bumping `App.STORAGE_VERSION` wipes `sumoDashboardState` on next load (a manual escape hatch for breaking state-shape changes) |
| `sumoDarkMode` | dark-mode toggle | `'true'`/`'false'` |
| `sumoVTypeMap` | vType-mapping modal | raw-type → category guesses for unknown vehicle types in uploaded flows |
| `sumoObservedGEH` | `saveObservedGEH` (explicit button, NOT auto-saved on type) | hand-entered Validation ground truth, keyed by detector id → interval index |
| `sumoObservedMAPE` | `saveObservedMAPE` (explicit button) | hand-entered MAPE ground truth |
| `sumoValidationNames` / `sumoMapeNames` | rename inputs | friendly display names, keyed by detector/edge id |
| `sumoLastGEHRawData` / `sumoLastGEHMeta` | validation upload | last uploaded raw detector data + `{runName, description}` |
| `sumoLastMapeRaw` | MAPE upload (edge format) | last uploaded edgeData/meandata |
| `sumoLastMapeDetectorRaw` / `sumoLastMapeMode` | MAPE upload (detector format) | last uploaded detector data + which mode is active |
| `sumoMapeSegments` | segment editor | user-defined from/to/distance/name/group segments |
| `sumoLastSimResults` | headless run | Simulation Results tab's last stats |
| `sumoFuelPriceMeta` / `sumoFuelPriceRegion` | fuel price inputs | diesel/petrol price + date, region |
| `validationRuns` (in `detector.js`) | `saveValidationToSheets` | saved validation-run history, **capped at 20** entries (older ones silently dropped via `.shift()`) — despite the name, this is a purely local save; the Google Sheets mirror this method used to also POST to has been removed (see History) |

Not a `localStorage` key, but the same "survive a refresh" role for one gap
`localStorage` couldn't cover: **`dashboard_emissions_cache.json`**, written
into the *project folder itself* (via the existing `writeProjectFile` IPC
channel, not a quota-limited browser key) every time Emissions Analysis data
is uploaded or auto-populated from a run, and read back by
`_restoreEmissionsCache()` when that same folder is loaded again. Tripinfo
XML can be far larger than `localStorage`'s ~5-10MB quota, which is why this
one piece of result data was never in the table above.

Note: **`sumoObservedGEH`/`sumoObservedMAPE` are never touched by a project
folder upload or a new detector-file upload** — only their own explicit Save
buttons write to them. This was a deliberate design decision (hand-entered
ground truth must survive re-uploads) and also the subject of a real bug
earlier in this project's history where the *render* was blocked by a
`QuotaExceededError` on an unrelated key, making it look like paste/upload
"did nothing" — fixed by reordering render-before-persist everywhere and
wrapping every persist in try/catch.

## Formulas & algorithms (exact)

- **GEH**: `sqrt(2 * (sim-obs)^2 / (sim+obs))`, extracted to `gehMape.js`'s
  `calculateGEH`/`getGEHStatus`/`getGEHModelStatus` and called from `app.js`'s
  `_buildGEHTables` — the only implementation now; `detector.js` no longer
  has its own duplicate (removed, see History). Thresholds: `<5` = Valid
  (Excellent), `<10` = Marginal (Acceptable), `≥10` = Invalid (Needs
  Calibration). Per-detector "model status": `≥85%` of intervals valid →
  Success; `≥50%` → Needs Calibration; else → Failed. Unit-tested in
  `tests/gehMape.test.js`, including the `M=C=0` division-by-zero guard.
- **MAPE % error — two DISTINCT implementations, not one.** There are two
  independent MAPE renderers in `app.js`, and their formulas genuinely
  differ (confirmed while extracting them — not something introduced here):
  - Detector-pair format (`_renderMapeFromDetectorRaw`, `gehMape.js`'s
    `calculateMapeError`/`getMapeStatus`/`getMapeModelStatus`): `errPct =
    (obs > 0 && sim > 0) ? |sim-obs|/obs*100 : 0` — a segment with no
    simulated value yet (`sim=0`) reads as "not yet comparable" (0%), not a
    100% miss. Status also has two pre-error configuration states ("Needs
    both detectors", "Needs distance") on top of the usual `≤10%`/`≤15%`
    thresholds.
  - Edge/meandata format (`_renderMapeFromRaw`, `gehMape.js`'s
    `calculateMapeErrorEdgeFormat`/`getMapeStatusEdgeFormat`/
    `getMapeModelStatusEdgeFormat`): `errPct = obs > 0 ? |sim-obs|/obs*100 :
    0` — **no** `sim > 0` guard, so `sim=0` with a real observed value *is*
    counted as a literal 100% error here. Its model-status rollup also has
    no "No data in this window" guard on an empty interval list — with
    `totalCount=0` it silently produces `"NaN%".toFixed` → `NaN >= 75` →
    `false` → falls through to `'Needs Calibration'` rather than erroring.
  Both were extracted **as-is** and kept deliberately separate rather than
  unified, since reconciling them would change behavior, not just relocate
  code — see `gehMape.js`'s own comments and `tests/gehMape.test.js` for
  both sets of cases side by side.
- **MAPE simulated travel time** (detector-pair segments): for a segment
  from detector A to detector B with user-entered `distance` (meters),
  `avgSpeed = (speedA + speedB) / 2` (falls back to whichever one is
  nonzero if only one detector has data that interval), using
  `harmonicMeanSpeed` if present else `speed`; `simulatedSeconds = round(distance / avgSpeed)`.
  `gehMape.js`'s `computeMapeAvgSpeed`/`computeMapeSimulatedTravelTime`.
- **MAPE segment distance auto-calc** (`App._computeDetectorDistance` →
  `graphDistance.js`'s `computeLaneGraphDistance`): builds a lane-level
  directed graph from `.net.xml` (`<lane id length>` for every edge
  including internal `:`-prefixed junction edges; `<connection from to
  fromLane toLane via>` becomes `fromLane→via→toLane` edges, or
  `fromLane→toLane` directly if no `via`). Runs Dijkstra (binary min-heap)
  from the start detector's position to the end detector's, bounded at
  8000m / 20000 visited nodes. Same-lane case is a direct subtraction, no
  graph traversal. Unit-tested in `tests/graphDistance.test.js`: normal
  multi-lane chains, same-lane forward/backward, disconnected detectors,
  unknown lane ids, a chain that exceeds the 8000m bound, a chain just
  under it, and a 25,000-node graph confirming the 20,000-visit cap
  actually bounds runtime (completes in ~35-50ms rather than hanging).
- **LOS (Level of Service) grade** (`_getLOSGrade`, Simulation Results tab),
  based on average per-vehicle delay (`avgTimeLoss`, seconds): `<10` → A
  (Free Flow), `<20` → B, `<35` → C, `<55` → D, `≤80` → E, else → F.
- **Emissions unit conversion** (`parseEmissionsRegexPure`, in
  `emissionsParser.js`): SUMO reports CO/HC/PMx/NOx in mg → divided by 1000
  for grams; CO2 in mg → divided by 1,000,000 for kg. Fuel: mg → kg
  (÷1,000,000), then ÷ density to get liters — **0.832 kg/L for
  bus/truck/van (diesel-class vehicles)**, **0.745 kg/L for everything else
  (petrol-class)**. This hardcoded density split is how the app decides
  "diesel" vs "petrol" cost — there's no `fuelType` field read from the
  vType itself. This parser runs regex over the raw tripinfo text rather
  than building a DOM tree, on purpose — corridor-scale tripinfo output can
  be large, and one regex pass avoids the memory/time cost of parsing it
  into a full document just to read it once. **The regex approach itself is
  intentionally unchanged** — the hardening below is a validation layer on
  top of it, not a replacement.
- **Emissions parser now validates its own output instead of silently
  returning zeros.** `parseEmissionsRegexPure` returns three new fields —
  `skippedRecords` (records matched but missing both `depart` and
  `timeLoss`, previously dropped with no trace), `openTagCount`/
  `tagCountMismatch` (a raw count of literal `<tripinfo` occurrences,
  compared against how many complete records actually matched), and
  `warnings` (an array of human-readable strings covering: zero records
  parsed, a tag-count mismatch, skipped records, and trips-with-no-
  emissions). `App._toastEmissionsParseWarnings(result)` surfaces every
  entry in `warnings` as a visible toast. **A real, confirmed pre-existing
  bug was found this way and is now surfaced (not fixed — the matching
  regex was deliberately left untouched):** a `<tripinfo>` missing its own
  closing tag causes the non-greedy `.*?` to bridge forward to the *next*
  available `</tripinfo>`, silently merging two records into one match and
  completely dropping the second trip's data with no error of any kind.
  `tests/emissionsParser.test.js` reproduces this exact case (2 open tags,
  only 1 matched record, the second trip's CO2 never appears in totals) and
  confirms the tag-count mismatch now catches it. Also tested: empty file,
  a truncated/mid-attribute file (both already correctly reported "no
  records" even before this change), and a BOM-prefixed/UTF-16-declared
  file that turned out to already parse cleanly with zero warnings (a case
  that *didn't* need hardening).
- **Emissions parsing runs off the main thread — confirmed live in a real
  Electron window, not just unit tests.** `App._parseEmissionsAsync()`
  (`app.js`) posts the raw XML to `emissionsWorker.js`, which
  `importScripts('emissionsParser.js')` and calls the same
  `parseEmissionsRegexPure` — so a large upload no longer freezes the UI
  while it's parsed. If `new Worker(...)` throws, or the worker errors out
  for any reason, `_parseEmissionsAsync` silently falls back to running
  `parseEmissionsRegex` (the synchronous wrapper, same file) in place — a
  Worker-loading failure degrades to blocking-but-correct, not broken. See
  "Testing" below for exactly how this was verified (real BrowserWindow,
  not the sandbox's plain-Node fallback).
- **Emissions time bins**: bin width = `App._getIntervalFreqSec()` (same
  "Interval Duration" as Flows/MAPE, default 10 min → 600s); bin count =
  `ceil(simDurationMinutes * 60 / binWidthSeconds)`. Bin index for a trip:
  `min(binCount-1, floor(depart / binWidthSeconds))`. Labels are clock times
  anchored to Sim Start Time, computed by `_emissionsBinLabels`.
- **Dwell Time Analysis regression** (`calculatePolyReg`): fits a quadratic
  (3 parameters: `y = ax² + bx + c`) across the sweep's data points, one per
  dwell value. Requires **all 5** of the fixed dwell values (0/10/20/45/90s)
  before it will report a curve/R² — a quadratic has only 3 parameters, so
  at exactly n=3 it fits every point perfectly and reports a meaningless
  R²≈1.0 that's an artefact of zero residual degrees of freedom, not
  evidence of a real relationship. Below n=5, `updateFormula` shows
  "Insufficient Data (Need all 5 dwell scenarios)" in place of a number
  (styled as a caution, via `reg.lowConfidence`) instead of a fabricated fit.
- **Interval aggregation** (`App._aggregateRecordsByInterval` →
  `intervalAggregation.js`'s `aggregateRecordsByInterval`): combines raw
  per-interval SUMO records into coarser buckets when Validation/MAPE's
  "Interval (min)" is set larger than the data's native interval size.
  Groups by a caller-supplied key (detector/edge id) first; within each
  group, records whose `begin` falls in the same `floor(begin/intervalSec)`
  bucket are summed (`sumFields`, e.g. vehicle counts) and/or averaged
  (`avgFields`, e.g. speed) together — this is also where two records with
  the exact same `begin` (duplicates) or unaligned begins that both land in
  the same bucket (overlapping) end up combined rather than double-counted.
  Unit-tested in `tests/intervalAggregation.test.js`: normal bucketing,
  empty input, records missing a usable key, exact-duplicate begins,
  boundary-unaligned/overlapping begins, multiple independent keys, and the
  average-of-zero-records guard.
- **Pedestrian crossing matching** (`_applyParsedPedData`): two independent
  strategies tried per personFlow — (a) if it has a `<walk edges="...">`
  child, check whether the crossing's own `edges` (from `.add.xml`) appear
  as a **contiguous subsequence** within the walk's edge list, forward or
  reversed (not exact-string equality — real walks include footpath edges
  before/after the actual crossing); (b) if it has a `<personTrip from= to=>`
  child instead (no explicit edge list to search), match by an id-naming
  convention `^c(\d+)_(in|out)_` where the number is a 0-based crossing
  index and in/out map to forward/reverse.

## The 9 tabs (UI element IDs worth knowing)

1. **Vehicle Params** (`tab-vehicles`) — table `#vehicle-type-table`. Folder
   upload: the 7 built-in categories (`passenger_car`, `motorcycle`,
   `tuk_tuk`, `van`, `heavy_bus`, `truck`, `fast_ped`) are blanked (except
   `vClass`, kept as structural) and refilled *only* from what the
   uploaded `.rou.xml`'s `<vType>` elements specify — a missing attribute
   stays blank (still editable), not defaulted. A `<vType>` id outside
   those 7 → extra column (`_customVehicleTypes`). An attribute outside
   `VTYPE_PARAMS` → extra row (`_extraVTypeParams`), grouped under "Other
   (from project)". `speedFactor="normc(mean,dev,0.2,2.0)"` is parsed back
   into separate `speedFactor`/`speedDev` fields. XML export
   (`App._buildVTypeXML(id)`, shared by this tab's "Copy as XML" and
   `xmlBuilder.js`) emits only non-blank attributes.
2. **Flows** (`tab-flows`) — `#flows-route-count`, `#flows-interval-count`,
   `#flows-interval-duration` (this is the interval duration reused
   elsewhere). One unified table (merged from an earlier Main-Road/Side-Road
   split).
3. **Pedestrians** (`tab-pedestrians`) — `#ped-crossing-count`,
   `#ped-interval-count`, `#ped-interval-duration`.
4. **Bus & Idling** (`tab-bus`) — bus stop dwell config + parking-area
   "idling" demand table.
5. **Simulation Results** (`tab-sim-results`) — `#sim-results-content`.
   Charts: `_simSpeedChart` (mean network speed over time, elapsed-minute
   labels, NOT clock time), `_simVtypeChart` (per-vehicle-type speed +
   waiting, dual y-axis bar).
6. **Validation** (`tab-validation`) — `#validation-results`,
   `#validation-interval-minutes` (combine raw intervals), 
   `#validation-range-from`/`#validation-range-to` (clock-time window
   filter — recalculates success rate from only the visible window; shows
   a diagnostic banner if the window excludes every row, comparing the
   typed range against the data's actual clock range and current Sim Start
   Time). Saved-run history via `detector.js` (`#saved-validation-runs`).
7. **MAPE Validation** (`tab-mape-validation`) — `#mape-validation-container`,
   `#mape-interval-minutes`, `#mape-range-from`/`#mape-range-to` (same
   pattern as Validation). Auto-detects input format from content
   (`interval[id]` → detector format; `interval edge`/`edge[traveltime]` →
   edgeData format). Detector-format segments UI: "+ Add Segment",
   "↺ Reset to Detected Defaults" (re-derives from
   `det_sec{N}_{direction}_dir` naming, only skips a pair already
   represented — never removes a user's existing segment), "📐 Auto" per
   segment (distance from `.net.xml`).
8. **Emissions Analysis** (`tab-emissions`) — 5 fixed file-input slots
   `#file-emissions-scenario-{a..e}` + `#scenario-{a..e}-name`, `#emissions-results`,
   `#fuel-price-diesel`/`#fuel-price-petrol`/`#fuel-price-date`. The 5-slot
   cap is structural (exactly 5 inputs exist), not a validated count.
9. **Dwell Time Analysis** (`tab-dwell-analysis`) — `#dwell-results`,
   "Run Dwell Sweep (5 runs, desktop app only)" — runs SUMO once per
   dwell value in `[0, 10, 20, 45, 90]` seconds, snapshotting/restoring
   `_busState.dwellData` around each run and writing each run's tripinfo to
   `dwell_sweep_{dwell}s_tripinfo.xml`. Charts indexed by dwell value, not
   time-of-day.

Every tab has a "❓ How to use" button (`App.showHelp('<topic>')`) — 9 help
topics defined in `App._helpContent`, rewritten several times this
project's history to stay accurate as features changed underneath them.

A **"Generate Report (PDF)"** button (`App.generateFullReport`) walks every
tab, embedding each chart as an image (via each Chart.js instance's own
canvas, not html2canvas) plus a data table under each chart and a plain-
paragraph caption. Footer on every page: app icon (loaded via
`_loadImageDataUrl('Icon.png')`, canvas round-trip to a data URL) on the
left, then "SUMO Simulation Analysis Report", then page number on the
right.

## Welcome splash screen

`index.html`, `#splash-screen`, right after `<body>`. Icon + "Welcome to
SUMO Simulation Dashboard" + "Built by the Traffic Data Collection Team",
dismissed by click-anywhere or any keypress (not on a timer). Styles in
`styles.css`'s `.splash-*` block.

## Data flow / control loop

There is no simulation stepping loop of any kind. The only "control" is:
`renderer (button click)` → `ipcRenderer.invoke(...)` → `main.js spawns
sumo/sumo-gui as a child process` → (for headless) `waits for exit, reads
output files back` → `renderer parses XML and renders tables/charts`.
`sumo-gui` runs are fire-and-forget (detached, unref'd) since there's no way
to know when the user will close that window; only headless runs are
awaited — this is *why* "▶ Run SUMO" and "📊 Run & Analyze" are two separate
buttons rather than one.

## Folder-reload reset behavior

Loading a new project folder (`_parseProjectFiles`) explicitly resets, in
order:
1. `_flowsState.data`, `_pedState.data`, `_busState.parkingData`,
   `_busState.dwellData`, `_netLaneGraph` → all cleared.
2. The 7 built-in vehicle categories blanked (keeping only `vClass`);
   `_customVehicleTypes`/`_extraVTypeParams` cleared.
3. `_resetResultsForNewProject()` — destroys every live Chart.js instance
   (Simulation Results, Emissions, Dwell), clears `_lastSimResults`,
   `_lastGEHRawData`/`_lastGEHRunName`/`_lastGEHDescription`, `_lastMapeRaw`,
   `_lastMapeDetectorRaw`, `_lastMapeMode` (→`'edge'`), `_mapeSegments`,
   `_lastEmissionsRawXml`; removes the corresponding localStorage keys;
   resets the Emissions/Dwell result containers and the 5 emissions file
   inputs to empty.

This was a real, multi-round bug earlier in the project's history — an
initial fix only cleared the *input* tables (Flows/Pedestrians/Bus/Parking)
and missed the *result* tabs (Simulation Results/Validation/MAPE/Emissions/
Dwell), so a previous project's charts kept showing after loading a new
one. If something looks like a previous project's data "isn't clearing,"
check whether it's a code path this reset doesn't reach yet.

## Testing — exactly what's covered, how, and what isn't

**`npm test`** (Node's built-in `node --test`, no dependency added) runs
46 tests across 4 files, all passing:

| File | Tests | Covers |
|---|---|---|
| `tests/emissionsParser.test.js` | 12 | Trip counting, fuel-density branch, bin assignment/clamping, missing-emissions warning, **plus malformed-file hardening**: empty file, truncated file, BOM/UTF-16-declared file (parses clean), a record missing both `depart`/`timeLoss` (now counted as skipped), and the confirmed unclosed-`<tripinfo>`-swallows-next-record case (now flagged via tag-count mismatch). |
| `tests/graphDistance.test.js` | 9 | Normal multi-lane chains, same-lane forward/backward, disconnected detectors, unknown lane ids, the 8000m bound (just over and just under), a 25,000-node graph confirming the 20,000-visit cap bounds runtime, custom bound options. |
| `tests/intervalAggregation.test.js` | 7 | Normal bucketing, empty input, missing keys, exact-duplicate begins, boundary-unaligned/overlapping begins, multiple independent keys, average-of-zero-records guard. |
| `tests/gehMape.test.js` | 18 | GEH (`M=C=0`, known-value check, perfect match, all 3 status thresholds, all 3 model-status thresholds), MAPE avg-speed/simulated-time, **both** MAPE error/status/model-status implementations (detector-pair and edge format) including their confirmed divergence at `sim=0`. |

**What this does NOT cover**: `calculatePolyReg` (Dwell regression fit),
the pedestrian subsequence/id-pattern matching in `_applyParsedPedData`,
the PDF report generator, and most of the remaining ~5000 lines of `app.js`
that manipulate the DOM directly rather than computing a value. Extracting
more of those into pure modules (the pattern used for all four files above)
is the way to extend coverage further, but wasn't in scope this round.

**Live-GUI verification (not just `node --test`).** Some restricted/CI-like
environments force Electron to run as plain Node via `ELECTRON_RUN_AS_NODE=1`,
which blocks `BrowserWindow`/`Worker`/all Chromium APIs — if that variable
is set, clear it for a single command invocation
(`Remove-Item Env:\ELECTRON_RUN_AS_NODE` immediately before launching
`electron.exe`, PowerShell) to get a real Electron window. Using a
disposable test harness (a throwaway `BrowserWindow` loading the project's
own `index.html` under an isolated **in-memory** session partition —
`partition: 'name'` with no `persist:` prefix, so it never touches the real
app's saved localStorage/userData) drove `App`'s real methods via
`webContents.executeJavaScript`, including injecting real `File` objects
into the actual `<input type="file">` elements via the `DataTransfer` API
(the same mechanism a user's file-picker selection produces). This
confirmed, in a real Chromium renderer:
- Worker output is **byte-identical** to the synchronous path for both a
  5-trip and a 40,000-trip synthetic tripinfo file.
- The main thread's own timer kept ticking at **~99% of its expected rate**
  while the Worker parsed the 40k-trip file (212ms), versus the synchronous
  path blocking for its full 227ms — direct evidence the parse actually
  runs off-thread, not just wrapped in a Promise that resolves the same tick.
- All 5 call sites that use `_parseEmissionsAsync` work end-to-end:
  `_autoPopulateEmissions` (direct string), `handleEmissionsParse` (2 real
  file inputs injected), `handleDwellParse` (2 of 5 dwell inputs injected —
  this incidentally also re-confirmed the `calculatePolyReg` n≥5 guard
  fires correctly: `"Insufficient Data (Need all 5 dwell scenarios)"`),
  `runDwellSweep`'s no-project-loaded guard clause (correctly bails with a
  toast rather than crashing — **the sweep's own SUMO-spawning path was
  NOT exercised**, since that needs a real installed SUMO binary and a
  configured project folder, out of scope for this check), and
  `onSimTimeChange`/`_rerenderEmissionsForTimeChange` (re-render after
  changing Sim Start/Duration, correct new bin count).
- Deliberately breaking `emissionsWorker.js` (renaming it on disk mid-run)
  confirmed the fallback engages correctly — 4ms, correct result matching
  the synchronous path, no hang, no crash — and that the Worker resumes
  normally once the file is restored.
- A separate pass confirmed the `graphDistance.js`/`intervalAggregation.js`/
  `gehMape.js` extraction is wired correctly end-to-end (not just correct in
  isolation): a real `_computeDetectorDistance` call returned the expected
  110m; `_buildGEHTables` returned GEH=0.49 matching hand calculation and
  the correct "Needs Calibration" model-status rollup; both
  `_renderMapeFromDetectorRaw` and `_renderMapeFromRaw` rendered valid HTML
  containing the expected segment/edge labels; the malformed-file warnings
  above were confirmed to reach real `App.showToast()` calls through the
  full async Worker path, not just the pure function in isolation.
- The new malformed-tripinfo warnings were separately confirmed to reach
  real `showToast()` calls through the full `_parseEmissionsAsync` → Worker
  → `_toastEmissionsParseWarnings` path, not just as return values from the
  pure function in isolation.

All scratch test harnesses used for the above were temporary (built in a
throwaway subfolder, deleted after use) — they are not part of the repo.

## Known issues / fragile parts

- **`app.js:2`** still has a stale header comment: "SUMO B130 Simulation
  Control Panel" — a leftover from the original hardcoded single-project
  version. Not user-visible, but confusing if searched for meaning.
- **`styles.css` theme system is inconsistent** — some rules reference
  `var(--accent-primary)` etc. with no matching `:root` definition anywhere
  in the stylesheet (resolves to nothing/inherited), a leftover from the
  project's history.
- **`electron-builder` can fail with a tiny broken output file** if the
  previous installer/app is still open when rebuilding (NSIS "Can't open
  output file") — the process still exits 0-ish/looks like it worked in a
  truncated log; the tell is the resulting `.exe` being ~270KB instead of
  ~79MB. Always check file size after a build, not just that a file exists.
- **Fuel type is inferred from vehicle category, not read from the vType.**
  "diesel" vs "petrol" cost in Emissions Analysis is decided purely by
  whether the category name matches bus/truck/van (0.832 kg/L) vs
  everything else (0.745 kg/L) — a custom vType added via the dynamic
  Vehicle Params system has no way to declare its own fuel density.
- **The two MAPE renderers genuinely disagree at `sim=0`** (see Formulas
  section) — the detector-pair path treats an unconfigured/not-yet-simulated
  segment as "not yet comparable" (0% error), the edge-format path treats
  it as a literal 100% miss. Confirmed while extracting both into
  `gehMape.js`, left as-is per "don't touch calculation logic" — worth
  knowing if the two tabs ever seem to disagree on a segment that should be
  equivalent.
- **A `<tripinfo>` missing its own closing tag silently merges with the
  next record** (see Formulas section) — a confirmed, pre-existing regex-
  matching behavior, now at least detected and surfaced as a warning
  (`tagCountMismatch`) rather than silently producing an incomplete result.
  The underlying regex was deliberately not changed.
- **The tool checks calibration arithmetic, not field-data quality.** GEH
  and MAPE only ever compare simulated output against whatever observed
  numbers get typed into `sumoObservedGEH`/`sumoObservedMAPE` — a model can
  pass every check this tool performs and still be wrong if the underlying
  observed counts/travel times were collected incorrectly. **This is not
  something code can fix** — it's a property of the input data, not the
  arithmetic — and no validation logic added here attempts to.

## History (why some things look the way they do)

This project started as a single hardcoded scenario for one specific real
corridor (detector ids like `det_sec1_galle_dir`, route ids like
`galle_orig`/`juulgaha_orig`, comments mentioning "B130"). It was then
generalized, tab by tab, into the fully project-driven, upload-anything
tool described above — most of `data.js`'s original hardcoded per-project
tables were deleted and replaced with dynamic discovery from whatever the
user uploads. Recurring theme across many rounds of fixes: a feature would
work for the *general* case but silently fail against this specific user's
*real* file (personFlows using `<personTrip from= to=>` instead of `<walk
edges=...>`; vType attributes the fixed table didn't have rows for; MAPE
needing detector-*pairs* not single-detector+length; oninput handlers that
re-rendered their own container on every keystroke, making multi-digit
values un-typeable). Expect similar edge cases if this app is pointed at a
genuinely different SUMO project's file conventions.

`detector.js` used to carry a second, unused implementation of GEH/
calibration/validation-comparison logic (`calculateGEH`, `getGEHRating`,
`getCalibrationComparison`, `getCalibrationSummary`, `getValidationSummary`,
`getValidationComparison`, `handleCalibrationUpload`,
`handleValidationUpload`, `parseInstantDetectorXML`, `deleteSavedRun`, and a
`calibrationData: { det_railway, det_julgaha }` object hardcoded to the
original single-corridor project) plus an unconfigurable Google Sheets
mirror (`setAppsScriptUrl`/`APPS_SCRIPT_URL`, no UI ever called it) — both
confirmed unreachable by grep across `app.js`/`index.html`, then removed
along with the `sumoAppsScriptUrl` localStorage key rather than left as
dead code. `detector.js` now only does what's actually live: E1/CSV
parsing, saved-run history, CSV export.

A later pass extracted three more pieces of pure logic out of `app.js` for
the same reason `emissionsParser.js` exists — Node-testability —
into `graphDistance.js` (Dijkstra), `intervalAggregation.js` (interval
bucketing), and `gehMape.js` (GEH/MAPE formulas). All three are verbatim
extractions with `app.js`'s own methods reduced to thin delegating
wrappers; none of the underlying arithmetic changed. Extracting the MAPE
formulas surfaced a real, previously-undocumented divergence between the
app's two independent MAPE renderers (detector-pair vs. edge/meandata
format disagree on how `sim=0` should read) — deliberately left as two
separate functions rather than unified, since reconciling them would be
changing behavior, not just relocating code. The same round also found and
fixed nothing in the calculation logic itself, but added a validation layer
to `emissionsParser.js` (`skippedRecords`/`openTagCount`/`tagCountMismatch`/
`warnings`) after discovering — via a deliberately malformed test file —
that an unclosed `<tripinfo>` tag causes the parser to silently swallow the
next record; that regex-matching quirk itself was left untouched, only
detection was added.

## Running it

```
npm start            # electron .  (dev)
npm run dist          # electron-builder → dist/*.exe (Windows NSIS installer)
```

Requires SUMO itself installed separately, with its `bin/` folder
(containing `sumo`/`sumo-gui`) on the system PATH — this app never installs
or bundles SUMO. No `SUMO_HOME` handling anywhere in the repo; relies
entirely on PATH resolution via `child_process.spawn('sumo', ...)` /
`spawn('sumo-gui', ...)`.

## Environment

No `.env`, no config files beyond `package.json`'s `build` block, no
environment variables read anywhere in `main.js`/`app.js`. No Docker.
