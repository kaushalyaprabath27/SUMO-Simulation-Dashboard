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
  platform too.

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

## Run the tests

```bash
npm test
```

Runs the automated unit test suite (Node's built-in test runner, no extra
dependency) against the project's extracted pure-logic modules
(`emissionsParser.js`, `graphDistance.js`, `intervalAggregation.js`,
`gehMape.js`).

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
