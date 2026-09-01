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
  (Node's built-in `node --test`, no dependency added) covering nine
  extracted pure modules — 113 tests total — plus a separate
  `npm run test:pdf-smoke` that needs a real Electron window (can't run
  under plain Node). See "Testing" below for exactly what's covered and
  what still isn't.
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
| `emissionsParser.js` | ~330 | `parseEmissionsXML()` — the tripinfo/emissions parser, extracted into a plain `this`-free function so the exact same code can run either on the main thread or inside `emissionsWorker.js`. No longer regex-based (see History): `parseXMLDocument()` in the same file is a genuine hand-rolled XML tokenizer (character-by-character, no regex/pattern matching for tag/attribute extraction) that builds a small generic element tree, which `parseEmissionsXML()` then walks for `<tripinfo>`/`<emissions>` elements. Also `module.exports`-guarded so `tests/` can `require()` it directly under Node. Includes post-parse validation (see Formulas section). |
| `emissionsWorker.js` | ~15 | Web Worker entry point — `importScripts('emissionsParser.js')`, parses off the main thread so a large tripinfo file doesn't freeze the UI. |
| `graphDistance.js` | ~85 | `computeLaneGraphDistance()` — the Dijkstra lane-graph shortest-path calc behind MAPE's "📐 Auto" segment-distance button, extracted verbatim from `App._computeDetectorDistance` for Node testability. |
| `intervalAggregation.js` | ~50 | `aggregateRecordsByInterval()` — the interval-bucketing logic behind Validation/MAPE's "Interval (min)" control, extracted verbatim from `App._aggregateRecordsByInterval` (which was already `this`-free). |
| `gehMape.js` | ~90 | GEH and MAPE formulas/status-threshold functions, extracted verbatim from `App._buildGEHTables`/`App._renderMapeFromDetectorRaw`/`App._renderMapeFromRaw`. The two MAPE renderers' error/status logic — previously two diverging implementations — has since been **unified** onto the standard-MAPE formula; see Formulas section for the full writeup of what diverged and why. |
| `polyReg.js` | ~110 | `calculatePolyReg()` — the Dwell Time Analysis tab's quadratic sensitivity-curve fit, extracted verbatim from `App.calculatePolyReg` for Node testability. Now includes a domain-plausibility guard (see Formulas section) that flags a fitted curve predicting a physically-impossible negative value. |
| `pedMatching.js` | ~90 | `matchPedFlowToCrossing()`/`containsSeq()`/`findNearestIntervalIndex()` — the pedestrian-crossing matching decision logic extracted from `App._applyParsedPedData` (the DOM/state side effects — table rebuilds, `_pedState` writes, toasts — stay in `app.js`; only the "which crossing/direction does this personFlow match" decision moved out). |
| `reportDataPrep.js` | ~30 | `fmtNum()`/`tableFromChart()` — the pure data-shaping helpers that feed the PDF report's per-chart tables, extracted from `App.generateFullReport`. The PDF rendering itself (jsPDF/html2canvas calls) is smoke-tested separately — see "Testing" below. |
| `xmlBuilderCore.js` | ~140 | `buildFullXML()` — the combined demand-XML generator (vTypes + flows + pedestrian crossings + bus dwell + parking), extracted from `App._buildFullXML` (`xmlBuilder.js`) with every implicit `App`/`document` read replaced by an explicit parameter. This is the literal "builds demand XML" deliverable the whole app exists for (see this file's opening section) — previously entirely untested. |
| `xmlBuilder.js` | ~30 | `App._buildFullXML()` — now a thin wrapper that gathers `App`'s live state (`_flowsState`/`_pedState`/`_busState`/`_customVehicleTypes`/`project.crossingEdges`, the `#sim-start-time` input, `App._buildVTypeXML`) and delegates to `xmlBuilderCore.js`. |
| `index.html` | ~845 | All 9 tabs' markup, splash screen, global error overlay. Loads `emissionsParser.js`/`graphDistance.js`/`intervalAggregation.js`/`gehMape.js`/`polyReg.js`/`pedMatching.js`/`reportDataPrep.js`/`xmlBuilderCore.js` via `<script>` before `app.js`. |
| `styles.css` | ~389 | Plain CSS, light/dark via `body.dark-mode`. |
| `tests/*.test.js` | ~1050 total | `node --test` coverage — 113 tests across 9 files, all passing. See "Testing" below. |
| `tests/pdfSmoke/index.js` | ~140 | A separate, non-`node --test` smoke test for `App.generateFullReport` — needs a real Electron window (jsPDF/Chart.js/DOM), run via `npm run test:pdf-smoke`. See "Testing" below. |

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
- **MAPE % error — now ONE unified formula** (previously two diverging
  implementations; this was fixed after an investigation found a real
  misclassification, not just a theoretical inconsistency — see History).
  `gehMape.js`'s `calculateMapeError(sim, obs) = obs > 0 ? |sim-obs|/obs*100
  : 0` — the standard MAPE definition, undefined only when the *observed*
  (actual) value is zero. A zero *simulated* value is a normal data point
  meaning a 100% miss, not a special case. Used by both MAPE renderers
  (`_renderMapeFromDetectorRaw` and `_renderMapeFromRaw`). Threshold
  classification (`≤10%` Valid (Excellent), `≤15%` Marginal (Acceptable),
  `>15%` Invalid) is shared via `getMapeStatusEdgeFormat(errPct)`;
  `getMapeStatus(hasBoth, distance, errPct)` (detector-pair segments) checks
  its two extra configuration states first ("Needs both detectors", "Needs
  distance" — not configured yet, not a calibration failure) and otherwise
  delegates to the same shared threshold function, so the two paths can no
  longer drift apart on the numeric classification itself.

  **What was wrong, concretely** (found while investigating, fixed after
  confirming it — not a hypothetical): the detector-pair formula used to
  also require `sim > 0`, on the theory that `sim=0` always meant "segment
  not configured yet." But `computeMapeSimulatedTravelTime` also returns
  `0` for a **fully-configured** segment whose average speed happened to be
  exactly zero for one interval (real gridlock, or a missing sample) — and
  in that case the old formula silently reported `0%` error → `'Valid
  (Excellent)'`, a false positive: a segment where the model produced zero
  simulated travel time against a real nonzero observed value was reported
  as a perfect match. The render template's own `${row.sim ? row.err :
  '—'}` cell-hiding logic (`_renderMapeFromDetectorRaw`'s row rendering)
  compounded this by hiding the (wrong) number entirely, so the visible
  symptom was a green "Valid" status sitting next to a dash. Both are now
  fixed: the formula no longer special-cases `sim=0`, and the display now
  keys off the row's *configuration* status (`Needs both detectors`/`Needs
  distance`) rather than off `sim` being falsy, so a genuinely-configured
  zero-speed row shows its real (now-correct) number instead of a dash.
  Regression test: `tests/gehMape.test.js`'s "REGRESSION: a fully-configured
  segment with a genuine zero-speed interval..." case, plus a live-window
  check confirming the rendered row shows `Invalid` and `100.00%`, not a
  false `Valid (Excellent)` next to a dash.

  **One residual ambiguity, explicitly not resolved by this fix** (flagged
  during the original investigation, confirmed still open, and confirmed
  *not* to be a fork that changes which formula is correct): `sim=0` in the
  detector-pair path can still mean either "both detectors read genuine 0
  speed" (real gridlock) or "no detector sample exists for this interval at
  all" (a data gap) — `computeMapeAvgSpeed` collapses both to the same `0`,
  and unifying the error formula treats them identically (both now
  correctly read as a 100% miss against a real observed value, regardless
  of which of the two actually caused it). Whether a missing sample should
  instead be excluded from the comparison entirely, rather than compared as
  if speed were 0, is a separate, deeper question about upstream
  missing-data handling — orthogonal to the formula fix, and left open.
  Both `getMapeModelStatus`/`getMapeModelStatusEdgeFormat` (the per-segment
  success-rate rollups) remain intentionally separate — that divergence is
  about a different, unrelated quirk (an empty-interval-list/`totalCount=0`
  guard that only one of the two has), not the `sim=0` case this fix
  addressed, and was out of scope here.
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
- **Emissions unit conversion** (`parseEmissionsXML`, in
  `emissionsParser.js`): SUMO reports CO/HC/PMx/NOx in mg → divided by 1000
  for grams; CO2 in mg → divided by 1,000,000 for kg. Fuel: mg → kg
  (÷1,000,000), then ÷ density to get liters — **0.832 kg/L for
  bus/truck/van (diesel-class vehicles)**, **0.745 kg/L for everything else
  (petrol-class)**. This hardcoded density split is how the app decides
  "diesel" vs "petrol" cost — there's no `fuelType` field read from the
  vType itself.
- **The tripinfo/emissions parser is a genuine hand-rolled XML parser, not
  regex/string matching** (see History for why it changed). `parseXMLDocument()`
  in `emissionsParser.js` is a small, dependency-free tokenizer: it scans the
  raw text one character at a time (`charCodeAt` comparisons, no regex) to
  recognize opening/closing/self-closing tags, quoted or unquoted attribute
  values, comments, CDATA sections and processing instructions, and builds a
  generic element tree (`{name, attrs, children}`). `parseEmissionsXML()`
  then walks that tree for `<tripinfo>` elements (via `collectByName`,
  recursively, regardless of nesting depth) and each one's own `<emission>`/
  `<emissions>` child, instead of pattern-matching substrings out of the raw
  text. It's still a single pass with no external DOM/XML library — this
  project's "no added dependency" rule (see Stack) held, it just moved from
  regex to a purpose-built tokenizer. Direct tokenizer-level tests live in
  `tests/xmlTokenizer.test.js`; the malformed-file tests below exercise the
  combination of both layers.
- **Malformed input is repaired, not just detected — a deliberate behavior
  change from the regex-based version.** The tokenizer is lenient by design
  (SUMO output is sometimes truncated by a killed run, and a real file with
  an unclosed `<tripinfo>` tag has already been seen in this project's
  history): a closing tag that doesn't match the innermost open element
  searches outward for the nearest ancestor with that name and auto-closes
  everything in between; anything still open at end-of-file is auto-closed
  too. Both recovery paths are recorded in a `parserWarnings` array (folded
  into `parseEmissionsXML`'s own `warnings`, prefixed `Malformed XML
  structure:`) rather than silently "fixed" with no trace — but critically,
  **no element the tokenizer actually saw is ever dropped**, because every
  opening tag becomes a node somewhere in the tree and `collectByName` walks
  every depth to find it. This closes a real, previously-documented bug
  outright rather than merely flagging it: the old regex's non-greedy `.*?`
  used to bridge past an unclosed `<tripinfo>` tag to the next available
  `</tripinfo>`, silently merging two records into one match and completely
  dropping the second trip's data. With the tree-based parser, that same
  malformed file still produces a warning (the auto-repair message) but
  **both trips' data are now present and correct in the totals** —
  `tests/emissionsParser.test.js`'s "a `<tripinfo>` missing its own closing
  tag is now fully recovered" test reproduces the exact case and confirms
  both records' CO2 contributions are counted. One consequence: the old
  `openTagCount`/`tagCountMismatch` diagnostic fields are gone — they existed
  specifically to detect the old data-loss bug via a count mismatch, and
  with a recovering tree parser that count can no longer diverge from
  `tripCount` by construction, so the fields would only ever have read
  `false`/equal. `skippedRecords` (records matched but missing both `depart`
  and `timeLoss`) is unchanged. One other file also changed behavior as a
  side effect of the rewrite, not by design: a file truncated mid-attribute
  used to report a flat "no records" (the old regex never had a complete
  match at all); the tokenizer instead recognizes the partial `<tripinfo>`
  tag as soon as it sees it, keeps whatever attributes appeared before the
  cutoff, and reports the truncation itself as a structural warning — see
  `tests/emissionsParser.test.js`'s "truncated mid-attribute" test for the
  updated expectation.
- **Emissions parsing runs off the main thread — confirmed live in a real
  Electron window, not just unit tests.** `App._parseEmissionsAsync()`
  (`app.js`) posts the raw XML to `emissionsWorker.js`, which
  `importScripts('emissionsParser.js')` and calls the same
  `parseEmissionsXML` — so a large upload no longer freezes the UI while
  it's parsed. If `new Worker(...)` throws, or the worker errors out for any
  reason, `_parseEmissionsAsync` silently falls back to running
  `parseEmissionsRegex` (`app.js`'s own synchronous wrapper method — the
  name predates this rewrite and was left as-is, since it's just an internal
  method name, not the parser itself) in place — a Worker-loading failure
  degrades to blocking-but-correct, not broken. See "Testing" below for
  exactly how this was verified (real BrowserWindow, not the sandbox's
  plain-Node fallback).
- **Emissions time bins**: bin width = `App._getIntervalFreqSec()` (same
  "Interval Duration" as Flows/MAPE, default 10 min → 600s); bin count =
  `ceil(simDurationMinutes * 60 / binWidthSeconds)`. Bin index for a trip:
  `min(binCount-1, floor(depart / binWidthSeconds))`. Labels are clock times
  anchored to Sim Start Time, computed by `_emissionsBinLabels`.
- **Dwell Time Analysis regression** (`App.calculatePolyReg` →
  `polyReg.js`'s `calculatePolyReg`): fits a quadratic (3 parameters: `y =
  ax² + bx + c`) across the sweep's data points, one per dwell value.
  Requires **all 5** of the fixed dwell values (0/10/20/45/90s) before it
  will report a curve/R² — a quadratic has only 3 parameters, so at exactly
  n=3 it fits every point perfectly and reports a meaningless R²≈1.0 that's
  an artefact of zero residual degrees of freedom, not evidence of a real
  relationship. Below n=5, `updateFormula` shows "Insufficient Data (Need
  all 5 dwell scenarios)" in place of a number (styled as a caution, via
  `reg.lowConfidence`) instead of a fabricated fit.
  **Domain-plausibility guard**: every quantity this fit is used for (time
  loss, emissions, fuel, stop counts, speed) is physically non-negative, so
  a fitted curve dipping below zero *within the sampled/displayed x-range*
  (checked at both endpoints and at the quadratic's vertex, if the vertex
  falls inside that range — sufficient since a quadratic's extreme value
  over an interval only ever occurs at one of those points) is flagged via
  `impliesNegative`/`warning` fields, surfaced as a visible red caption
  under the formula (same "don't hide a gap, flag it" pattern as the
  tripinfo parser's warnings) rather than silently displayed as a normal
  result. Deliberately does **not** check extrapolation beyond the sampled
  range (e.g. far past x=90) — only what's actually shown. Unit-tested in
  `tests/polyReg.test.js`: the n<5 guard (including with null/NaN gaps), a
  recovered known quadratic (R²=1, no false-positive warning), a noisy
  realistic fit (no false positive), an all-identical-y-values zero-variance
  case, a singular-matrix "Linear/Constant" case, and two guard-triggering
  cases (an exact `y=x²-1000` curve dipping to -1000 at its vertex, and a
  sharp early-drop dataset) — both confirmed to report the expected warning
  text and minimum value. Confirmed live in a real Electron window: a
  constructed dataset that dips to -1000 renders the red warning caption
  under the Dwell tab's actual formula display, not just in the return value.
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
- **Pedestrian crossing matching** (`App._applyParsedPedData` → `pedMatching.js`'s
  `matchPedFlowToCrossing`): two independent strategies tried per personFlow
  — (a) if it has a `<walk edges="...">` child, check whether the
  crossing's own `edges` (from `.add.xml`) appear as a **contiguous
  subsequence** within the walk's edge list, forward or reversed (not
  exact-string equality — real walks include footpath edges before/after
  the actual crossing); (b) if it has a `<personTrip from= to=>` child
  instead (no explicit edge list to search), match by an id-naming
  convention `^c(\d+)_(in|out)_` where the number is a 0-based crossing
  index and in/out map to forward/reverse. Unit-tested in
  `tests/pedMatching.test.js`: exact/subsequence/reversed edge matches, no
  match, a crossing with no configured edges (skipped, not matched),
  personTrip id matching (including case-insensitivity and an out-of-range
  index), and a flow with neither an edge list nor a matching id. **A real,
  previously-undocumented quirk found and confirmed while extracting this**:
  when matching by edge list, the code checks *every* crossing rather than
  stopping at the first match, so if a walk's edges contain more than one
  crossing's edges as a subsequence, the **last** matching crossing wins,
  not the first — preserved as-is (see `pedMatching.js`'s own comment),
  not "fixed," since this wasn't reported as a problem and changing match-
  priority order is a behavior change, not a testability one.
- **Combined demand XML generation** (`App._buildFullXML` →
  `xmlBuilderCore.js`'s `buildFullXML`): the literal "builds demand XML"
  deliverable this app exists for — combines vTypes, vehicle flows (Flows
  tab), pedestrian crossings (Pedestrians tab, split into 4 timed bursts
  per interval at `+0/+150/+300/+450s` offsets with any remainder count
  going to the earliest bursts first), bus-stop-attached flows (a
  `heavy_bus` flow on the configured bus route gets nested `<stop
  busStop= duration=>` elements per stop, dwell time looked up from
  `_busState.dwellData` by `floor(begin / (busDwellIntervalDuration*60))`,
  defaulting to 10s if that interval has no entry), and parking/idling
  flows (nested `<stop parkingArea= duration=>`, defaulting to 120s) — all
  merged and sorted by `begin` time into one document regardless of which
  category they came from. Previously entirely untested despite being the
  core deliverable; unit-tested in `tests/xmlBuilderCore.test.js`: empty
  state, built-in/custom vType inclusion, basic flows, zero/missing counts
  producing no flow, the bus-stop-attached case (including its 10s default-
  dwell fallback and the "not on the bus route" plain-flow case), the
  pedestrian 4-burst split (including the no-configured-edges skip and
  fwd/rev independence), the parking case (including its 120s default-
  duration fallback), and the final cross-category sort order.

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
9. **Dwell Time Analysis** (`tab-dwell-analysis`) — `#dwell-results`, 5 file
   inputs (`#dwell-file-{0,10,20,45,90}`) for manually uploading each
   dwell-value scenario's own tripinfo output. Charts indexed by dwell
   value, not time-of-day. `App.runDwellSweep()` (automating all 5 SUMO
   runs itself — once per dwell value in `[0, 10, 20, 45, 90]` seconds,
   snapshotting/restoring `_busState.dwellData` around each run) still
   exists in `app.js` but its only button was removed from `index.html` at
   the user's request — it's currently **dead/unreachable code**, not
   deleted outright since removing the method itself wasn't asked for.

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
113 tests across 9 files, all passing:

| File | Tests | Covers |
|---|---|---|
| `tests/emissionsParser.test.js` | 16 | Domain-level (`parseEmissionsXML`) coverage: trip counting, fuel-density branch, bin assignment/clamping, missing-emissions warning, single- vs double-quoted attributes, and **malformed-file hardening**: empty file, a truncated/mid-attribute file (now recovers the partial record and flags the truncation, rather than reporting zero — a deliberate behavior change, see Formulas section), BOM/UTF-16-declared file (parses clean), a record missing both `depart`/`timeLoss` (counted as skipped), the previously-documented unclosed-`<tripinfo>`-loses-data bug (now fully recovered — both records counted, correct totals — with the auto-repair reported as a warning), a non-UTF-8 file misread as UTF-8 (mojibake, parses clean), mixed Windows/Unix line endings (parses clean), and one pathologically long line with no breaks at all, 20,000 trips, ~225ms (parses clean, no slowdown). |
| `tests/xmlTokenizer.test.js` | 12 | Tokenizer-level (`parseXMLDocument`) coverage, independent of the emissions domain logic: tree shape for a well-formed document, self-closing tags, single/double-quoted and unquoted attribute values, comments and CDATA sections skipped without disrupting siblings, XML declaration/DOCTYPE skipped, a leading BOM handled cleanly, a closing tag with no matching open tag (ignored + reported), a closing tag that matches an ancestor while skipping an unclosed descendant (auto-repaired + reported, descendant preserved), tags still open at end-of-file (auto-closed + reported as likely truncation), and a fully well-formed document producing zero parser warnings. |
| `tests/graphDistance.test.js` | 9 | Normal multi-lane chains, same-lane forward/backward, disconnected detectors, unknown lane ids, the 8000m bound (just over and just under), a 25,000-node graph confirming the 20,000-visit cap bounds runtime, custom bound options. |
| `tests/intervalAggregation.test.js` | 7 | Normal bucketing, empty input, missing keys, exact-duplicate begins, boundary-unaligned/overlapping begins, multiple independent keys, average-of-zero-records guard. |
| `tests/gehMape.test.js` | 18 | GEH (`M=C=0`, known-value check, perfect match, all 3 status thresholds, all 3 model-status thresholds), MAPE avg-speed/simulated-time, the unified MAPE error/status formula, and the **regression test for the exact misclassification found and fixed** — a fully-configured segment with a genuine zero-speed interval now correctly reports `Invalid`, not a false `Valid (Excellent)` — plus a test confirming `getMapeStatus` delegates to the same shared threshold logic as `getMapeStatusEdgeFormat` rather than duplicating it. |
| `tests/polyReg.test.js` | 8 | The n<5 insufficient-data guard (including with null/NaN gaps counted out), a recovered known quadratic (R²=1, no false-positive warning), a realistic noisy fit (no false positive), an all-identical-y zero-variance case, a singular-matrix degenerate case, and **two cases that trigger the new domain-plausibility guard** (an exact `y=x²-1000` curve and a sharp early-drop dataset), confirming the warning text and reported minimum value. |
| `tests/pedMatching.test.js` | 19 | `containsSeq` (exact, subsequence, non-contiguous, empty/oversized needle), `findNearestIntervalIndex`, and `matchPedFlowToCrossing` for both matching strategies — including the confirmed "last match wins, not first" quirk when a walk's edges overlap more than one crossing. |
| `tests/reportDataPrep.test.js` | 11 | `fmtNum`'s rounding/formatting rules (including zero-vs-empty, the >=100 magnitude threshold) and `tableFromChart`'s header/row assembly, including missing datasets/labels/dataset-label edge cases. |
| `tests/xmlBuilderCore.test.js` | 13 | The combined demand-XML generator: empty state, built-in/custom vType inclusion, basic flows, zero/missing counts, the bus-stop-attached-flow case (with its default-dwell fallback and the not-on-the-bus-route plain-flow case), the pedestrian 4-burst split (with the no-edges skip and fwd/rev independence), the parking case (with its default-duration fallback), and cross-category sort order. |

**Separately, `npm run test:pdf-smoke`** (NOT part of `node --test` — needs
a real Electron window; jsPDF/Chart.js/DOM don't exist under plain Node)
runs 20 checks against `App.generateFullReport` for a minimal (empty) and a
realistic (populated) project state: confirms it completes without
throwing (including catching the function's *own* internal try/catch,
which otherwise swallows errors into a toast — a naive check that only
looks for a thrown exception would have missed real internal failures),
produces non-empty PDF output, and that the PDF's own `.text()` calls
actually included every expected section heading plus (for the realistic
case) a real data-derived value (a detector id from the constructed GEH
data). See "Live-GUI verification" below for the discovery journey behind
its interception technique.

**What this does NOT cover**: the PDF report generator's actual *rendering*
fidelity (whether the resulting PDF looks right, has correct layout, etc.)
— the smoke test above confirms it runs and contains the right content,
not that it renders correctly; a pixel/binary-output comparison was
deliberately not attempted, as instructed. Also still uncovered: most of
the remaining ~5000 lines of `app.js` that manipulate the DOM directly
rather than computing a value (rendering functions, tab-switching, undo/
redo, localStorage persistence glue), and `_processSimResults`' tripinfo/
summary-XML aggregation logic (used by the PDF smoke test's realistic case,
but not unit-tested on its own — it's on the shortlist for a future pass,
not the largest remaining gap). Extracting more of those into pure modules
(the pattern used for all eight files above) is the way to extend coverage
further, but wasn't in scope this round.

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
- A later pass confirmed the `polyReg.js`/`pedMatching.js`/`reportDataPrep.js`
  extraction is also wired correctly end-to-end: a real `App.calculatePolyReg`
  call with a synthetic 5-point quadratic dataset returned the expected
  `R²=1.0000`; a 3-point call correctly returned the insufficient-data
  message; a real `App._applyParsedPedData` call with one `<walk edges>`-
  style flow and one personTrip-id-style flow (`c0_out_600`) populated
  `_pedState.data` with exactly the expected keys (`0_0_fwd`, `0_1_rev`)
  and counts; and the global `tableFromChart` function (as `app.js`'s PDF
  report code calls it) produced the expected headers/rows with `fmtNum`
  formatting applied.
- **The MAPE fix was confirmed live, not just via unit test.** A real
  `App._renderMapeFromDetectorRaw` call with a fully-configured segment
  (`distance=500`) and both detectors reporting 0 speed for the interval
  rendered `Invalid` in the status cell and `100.00%` in the error cell —
  not the old false `Valid (Excellent)` next to a hidden dash.
- **The `calculatePolyReg` domain-plausibility guard was confirmed live.**
  A real `App.renderDwellCharts` call with a dataset constructed to dip to
  -1000 rendered the actual red warning caption under the Dwell tab's
  formula display element, not just as a return-value field.
- **The `xmlBuilderCore.js` wiring was confirmed live.** A real
  `App._buildFullXML()` call (after setting `_flowsState`/`_pedState`/
  `_busState` to a small synthetic scenario) produced a well-formed XML
  document containing the expected `<vType>` and `<flow>` elements.
- **The PDF smoke test's interception technique required a real discovery,
  not a first-try success — worth documenting since it reveals something
  about how the vendored jsPDF build works.** Patching `jsPDF.prototype.text`/
  `.save` (the obvious approach) silently intercepted nothing — 0 calls
  captured despite the report completing "successfully." Investigating with
  a call-counting instrument confirmed jsPDF assigns `.text`/`.save` as
  **own instance properties** (a plugin/API pattern), not shared prototype
  methods, so patching the prototype has no effect on real instances. The
  working fix wraps the `jsPDF` **constructor** itself, so each real
  instance's own methods get wrapped immediately after construction, before
  `app.js` ever touches them — confirmed via the same instrumentation
  (23 `.text()` calls, 1 `.save()` call captured) before being written into
  the permanent test.

All scratch test harnesses used for the above were temporary (built in a
throwaway subfolder, deleted after use) — they are not part of the repo.
`tests/pdfSmoke/index.js` is the one exception: a **permanent** Electron-
based test (not throwaway), since the task asked for a repeatable smoke
test, not just a one-off manual verification.

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
- **~~The two MAPE renderers disagreed at `sim=0`~~ — fixed.** See the MAPE
  % error note in the Formulas section for the full writeup of what
  diverged, the concrete misclassification it caused, and how it was fixed
  (unified onto the standard MAPE formula, plus a display fix). One
  residual ambiguity remains open by design (not a fork in which formula is
  correct) — see that same section.
- **~~A `<tripinfo>` missing its own closing tag silently merges with the
  next record~~ — fixed.** This was a confirmed, pre-existing regex-matching
  bug (see Formulas section for the full writeup). It's now fixed outright,
  not just detected: the emissions/tripinfo parser was rewritten from regex
  to a real hand-rolled XML tokenizer that auto-repairs malformed nesting
  instead of silently dropping data, while still reporting the repair as a
  warning.
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

A third pass extended the same extraction pattern to the three remaining
named test-coverage gaps: `polyReg.js` (Dwell regression fit),
`pedMatching.js` (pedestrian crossing matching — the DOM/state side effects
stayed in `app.js`, only the matching decision moved out), and
`reportDataPrep.js` (the PDF report's `fmtNum`/`tableFromChart` data-shaping
helpers; the PDF rendering step itself was deliberately not unit-tested at
that point, since a binary/pixel-output comparison would be brittle for
little value — a non-pixel smoke test was added in the next pass instead).
This pass also investigated — but did not yet change — the MAPE `sim=0`
divergence found earlier: the edge-format formula matches the standard
MAPE definition, and the detector-pair path's deviation was traced to a
real, previously-unnoticed consequence (a fully-configured segment with a
genuine zero-speed interval reads as a false "Valid (Excellent)" today,
not just "differs in theory"). A fix was proposed (unify onto the edge-
format formula) but intentionally left unimplemented pending a decision,
since it's a real behavior change, not a testability refactor. Finally,
three more deliberately-malformed tripinfo cases were tested against the
existing parser (a non-UTF-8 encoding misread as UTF-8, mixed Windows/Unix
line endings, and one 4.4-million-character line with no breaks at all) —
none of the three turned out to be a gap; all three parse cleanly and
quickly, and are now permanent regression tests rather than one-off checks.

A fourth, final pre-submission pass acted on the previous round's proposal
and closed the remaining named gaps. The MAPE divergence's "residual
ambiguity" (whether `sim=0` means genuine gridlock or a missing sample) was
first assessed and confirmed to be a separate, orthogonal question — not a
fork that changes which error formula is correct — so the fix proceeded:
both MAPE call sites now share one formula (`calculateMapeError`, the
standard-MAPE one), `getMapeStatus` delegates its threshold classification
to the same shared function, and the render template's cell-hiding logic
was corrected to key off configuration status rather than `sim` being
falsy — the exact regression case (a fully-configured, genuine-zero-speed
segment) is now unit-tested and was confirmed live to render `Invalid`/
`100.00%` instead of a false `Valid (Excellent)`/dash. `calculatePolyReg`
gained a domain-plausibility guard: a fitted curve dipping negative within
the sampled range (checked at both endpoints and the vertex, if it falls
inside that range) now surfaces a visible warning instead of silently
displaying an impossible number, following the same pattern as the
tripinfo parser's warnings. A permanent (not throwaway) PDF-generation
smoke test was added (`tests/pdfSmoke/`, run via `npm run test:pdf-smoke`)
confirming `generateFullReport` completes and produces the expected section
headings for both an empty and a populated project state — building it
surfaced a real technical wrinkle worth remembering: the vendored jsPDF
build assigns `.text`/`.save` as own-instance properties, not shared
prototype methods, so the obvious prototype-patching interception silently
captured nothing until the constructor itself was wrapped instead. Finally,
`xmlBuilderCore.js` was extracted from `xmlBuilder.js`'s `App._buildFullXML`
— the literal "builds demand XML" deliverable this app exists for, and the
largest remaining untested piece of pure logic in the codebase — covering
vType assembly, vehicle flows, the bus-stop-dwell-attachment special case,
the pedestrian 4-burst-split logic, parking flows, and final cross-category
sort ordering.

A fifth pass, at explicit user request, replaced `emissionsParser.js`'s
regex-based tripinfo/emissions extraction with a genuine hand-rolled XML
parser — the user asked specifically to remove string/pattern matching from
this file rather than keep it as a documented, deliberately-unfixed quirk.
`parseXMLDocument()` is a dependency-free, character-by-character tokenizer
(no regex anywhere in the tag/attribute-reading logic) that builds a small
generic element tree; `parseEmissionsXML()` (renamed from
`parseEmissionsRegexPure`, which was no longer an accurate name) walks that
tree instead of pattern-matching the raw text. Two real things came out of
doing this properly rather than as a drop-in replacement: (1) a genuine bug
in the first draft, caught by a direct tokenizer unit test rather than the
domain-level emissions tests — an unquoted attribute value's scanner didn't
stop at `/`, so `foo=bar/>` read `bar/` as the value and missed the
self-close marker; fixed by also stopping the scan at `/`. (2) The tokenizer
being lenient about malformed nesting (auto-repairing a mismatched/missing
closing tag rather than erroring out, since real truncated SUMO output has
already been seen in this project) turned the previously-documented
"unclosed `<tripinfo>` silently drops the next record" bug into something
actually fixed, not merely detected — every element the tokenizer sees ends
up in the tree even after a repair, so nothing is lost, and the repair
itself is still reported as a warning. That made the old
`openTagCount`/`tagCountMismatch` diagnostic fields meaningless (they can no
longer diverge from `tripCount` by construction) and they were removed
rather than kept as dead weight. One side effect of the rewrite that wasn't
the point of the exercise but is worth knowing about: a file truncated
mid-attribute now reports a recovered partial record plus a truncation
warning, instead of the old flat "no records" (the old regex simply never
had a complete match to report). All of this was re-verified live in a real
Electron window — direct calls, the full `_parseEmissionsAsync` Worker path
through the actual `emissionsWorker.js` file (not just the synchronous
fallback), and the malformed-nesting recovery case, confirming the toast
that reaches `App.showToast` reads "auto-repaired, no element was dropped"
rather than the old silent data loss.

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
