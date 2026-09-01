# SUMO Simulation Dashboard

A desktop GUI for building [SUMO](https://eclipse.dev/sumo/) traffic-simulation
demand files and analyzing SUMO's simulation output — without hand-editing
XML or writing analysis scripts.

It does two things for anyone who already has a SUMO project on disk:

1. **Builds demand XML** — routes/flows, pedestrian crossings, bus dwell
   times, and parking-area demand — through editable tables instead of
   hand-writing `.rou.xml`.
2. **Runs SUMO as an external process** (`sumo` / `sumo-gui`) and turns
   whatever output it produces (tripinfo, summary, detector, emissions,
   edgeData) into readable tables and charts: GEH validation, MAPE
   travel-time validation, emissions comparison across multiple scenarios,
   and a bus-dwell-time sweep.

This app never bundles or installs SUMO itself, and no SUMO project data is
checked into this repository — you point it at your own project folder
(`.net.xml` / `.rou.xml` / `.add.xml` / `.sumocfg`) at runtime via a folder
picker.

## Prerequisites

- **[Node.js](https://nodejs.org/)** (v18 or later recommended)
- **[SUMO](https://eclipse.dev/sumo/)** installed separately, with its
  `bin/` folder (containing `sumo` and `sumo-gui`) on your system `PATH`.
  This app has no `SUMO_HOME` handling — it resolves `sumo`/`sumo-gui`
  purely via `PATH`.
- Windows is the only packaged/installer target currently configured
  (`electron-builder` → NSIS); running from source (`npm start`) works on
  any platform Electron supports, provided SUMO is installed for that
  platform too. This has only actually been run on Windows; it has not
  been tested on Linux or macOS.

### Versions this release (v1.0.0) was built and tested against

Recorded directly from the development machine, not aspirational:

| Component | Version |
|---|---|
| Node.js | v26.4.0 |
| Electron | 31.7.7 (`^31.0.0` in `package.json`) |
| electron-builder | 24.13.3 |
| SUMO | 1.27.1 (Windows build) |
| OS | Windows 10.0.17763 (Windows Server/10-class build) |

`package.json`'s `devDependencies` pin Electron and electron-builder by
semver range (`^31.0.0`, `^24.13.3`); `package-lock.json` pins the exact
resolved versions. Node itself is not pinned by this project (no
`.nvmrc`/`engines` field yet) — v18+ is the working assumption stated
above, not a value verified across multiple Node versions.

## Install

```bash
npm install
```

## Run

```bash
npm start
```

This launches the Electron app. Use the folder picker to load a SUMO
project, then work through the tabs to build demand data and run/analyze
simulations.

## How the tool invokes SUMO, and which output files it reads

When you press "Run" from the dashboard (Simulation Results tab), the app
spawns SUMO itself rather than asking you to run it separately. The two
commands it actually builds (read directly from `main.js`, not
paraphrased) are:

Interactive run (`sumo-gui`, launched detached — the dashboard does not
wait for it to exit):

```
sumo-gui -c <your .sumocfg> \
  --tripinfo-output _dashboard_tripinfo.xml \
  --summary-output _dashboard_summary.xml \
  --device.emissions.probability 1.0 \
  [--step-length <step>] \
  [--additional-files <your additional files>,dashboard_edgedata.add.xml]
```

Headless run (`sumo`, the dashboard waits for it to exit and reads the
result back):

```
sumo -c <your .sumocfg> \
  --tripinfo-output _dashboard_tripinfo.xml \
  --summary-output _dashboard_summary.xml \
  --no-step-log true \
  --device.emissions.probability 1.0 \
  [--step-length <step>] \
  [--additional-files <your additional files>,dashboard_edgedata.add.xml]
```

Three points worth being explicit about, since it is easy to assume
otherwise:

- **There is no separate `--emission-output` file.** `--device.emissions.probability 1.0`
  makes SUMO attach a per-vehicle `<emissions>` element as a *child* of
  each `<tripinfo>` element in the one tripinfo file, instead of writing a
  second emissions file. The Emissions Analysis tab reads that one
  tripinfo file and looks inside each `<tripinfo>` for its nested
  `<emissions>` child — it does not read a standalone SUMO
  `--emission-output` file. If you already have a separately-generated
  `--emission-output` file from a run you made outside the dashboard, that
  is a different XML schema (`<emission>` elements keyed by timestep, not
  one `<emissions>` child per trip) and this parser does not read it.
- **The edgeData/travel-time file is generated automatically, every run,
  whether you asked for it or not.** The dashboard always writes a small
  additional file, `dashboard_edgedata.add.xml`, requesting an `<edgeData>`
  output (`dashboard_traveltimes_output.xml`, aggregation interval taken
  from the dashboard's own "Interval Duration" setting) and folds it into
  whatever `--additional-files` list your project already specifies. This
  is what feeds the Validation/MAPE tab when you use "Run" from within the
  dashboard rather than uploading a file you produced separately. Your own
  `.add.xml` files are never edited in place; if the dashboard cannot
  write an output file to the folder your project's own `.add.xml` names
  (for example, because it points at an absolute path from a different
  machine), it writes a redirected copy alongside the original — see the
  comment above `prepareAdditionalFiles` in `main.js` for exactly when
  that happens.
- **GEH's own inputs are not auto-generated by the dashboard.** The
  Calibration tab computes GEH from an observed count you type in and a
  simulated count you upload from your own detector or edge output file
  (produced however your SUMO project already produces it, e.g. an E1
  induction-loop or edge-based output) — this is a plain file upload, not
  something `main.js` generates as part of the run above.

If you already have tripinfo/edgeData/detector output from a run you made
outside this dashboard, all three tabs also accept those files directly
through their own upload controls — you do not have to use the dashboard's
"Run" button at all.

## Run the tests

```bash
npm test
```

Runs the automated unit test suite (Node's built-in test runner, no extra
dependency) against the project's extracted pure-logic modules —
`emissionsParser.js` (including its own hand-rolled XML tokenizer and its
malformed-file recovery behaviour), `graphDistance.js`,
`intervalAggregation.js`, `gehMape.js`, and others. 113 tests across 9
files, all passing as of this release.

## Build a Windows installer

```bash
npm run dist
```

Produces an NSIS installer under `dist/` via `electron-builder`.

## Documentation

[`CLAUDE.md`](CLAUDE.md) is this project's complete technical reference —
architecture, every IPC channel, the full `localStorage` key inventory, the
exact formulas behind GEH/MAPE/emissions calculations, per-tab UI details,
and known issues. Start there for anything beyond a quick overview.

## License

MIT — see [`LICENSE.txt`](LICENSE.txt).
