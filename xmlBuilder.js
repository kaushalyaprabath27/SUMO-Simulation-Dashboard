// ============================================================
// xmlBuilder.js — Overrides App._buildFullXML()
// Generates a combined <routes> demand file (vTypes + flows +
// pedestrians + bus dwell + parking) from the generic, project-driven
// state (App._flowsState / App._pedState / App._busState). It does NOT
// redefine <route> elements — those already exist in the user's own
// uploaded .rou.xml, and this file is meant to be merged alongside it
// (or used as a standalone "additional demand" file referencing the
// same route ids).
// Loaded AFTER app.js.
// ============================================================

App._buildFullXML = function () {
    const now = new Date().toLocaleString('sv').replace(' ', 'T') + '+05:30';
    const lines = [];
    const f = (n, d = 2) => Number(n).toFixed(d);
    const ind = '    '; // 4-space

    // ── Header ──────────────────────────────────────────────
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push('');
    lines.push(`<!-- generated on ${now} -->`);
    lines.push('');
    lines.push(`<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/routes_file.xsd">`);

    // ── vTypes ────────────────────────────────────────────────
    // Built by the same App._buildVTypeXML() the Vehicle Params tab's "Copy
    // as XML" button uses, so a project-driven type (or a blank attribute
    // this project didn't define) is represented identically in both places.
    lines.push(`${ind}<!-- VTypes -->`);
    const allVTypeNames = VEHICLE_TYPE_NAMES.concat(Object.keys(App._customVehicleTypes || {}));
    allVTypeNames.forEach(id => lines.push(`${ind}${App._buildVTypeXML(id)}`));

    lines.push(`${ind}<!-- Routes are assumed to already exist in your project's .rou.xml — this file only adds demand (flows/persons) referencing those route ids. -->`);

    // ── Collect all items, sorted by begin time ─────────────
    const allItems = [];
    const add = (begin, xml) => allItems.push({ begin, xml });

    const simStart = document.getElementById('sim-start-time')?.value || '06:30';
    const [sh, sm] = simStart.split(':').map(Number);
    const simStartSec = sh * 3600 + sm * 60;

    const VTYPES = ['motorcycle', 'tuk_tuk', 'passenger_car', 'heavy_bus', 'van', 'truck'];

    // ── Vehicle flows (Flows tab) ────────────────────────────
    const fs = App._flowsState;
    const busRouteId = App._busState.busRouteId || '';
    const stops = App._busState.stops || [];
    const busDwellIntervalDur = App._busState.intervalDuration;

    for (let i = 0; i < fs.intervals; i++) {
        const begin = simStartSec + i * fs.intervalDuration * 60;
        const end = begin + fs.intervalDuration * 60;
        fs.routes.forEach((r, ri) => {
            VTYPES.forEach(vt2 => {
                const count = parseInt(fs.data[`${ri}_${i}_${vt2}`] || 0);
                if (count <= 0) return;
                const id = `flow_${r.id}_${vt2}_${i}`;
                if (vt2 === 'heavy_bus' && r.id === busRouteId && stops.length) {
                    // Attach the configured bus stops (in order) with dwell times for
                    // the interval that overlaps this flow's begin time.
                    const busIdx = Math.floor(begin / (busDwellIntervalDur * 60));
                    let xml = `${ind}<flow id="${id}" type="${vt2}" begin="${f(begin)}" end="${f(end)}" number="${count}" departLane="best" departPos="free" departSpeed="max" route="${r.id}">\n`;
                    stops.forEach((s, si) => {
                        const dur = parseFloat(App._busState.dwellData[`${si}_${busIdx}`]) || 10;
                        xml += `${ind}${ind}<stop busStop="${s.id}" duration="${f(dur)}"/>\n`;
                    });
                    xml += `${ind}</flow>`;
                    add(begin, xml);
                } else {
                    add(begin, `${ind}<flow id="${id}" type="${vt2}" begin="${f(begin)}" end="${f(end)}" number="${count}" departLane="best" departPos="free" departSpeed="max" route="${r.id}"/>`);
                }
            });
        });
    }

    // ── Pedestrian crossings (Pedestrians tab) ───────────────
    const ps = App._pedState;
    const pedOffsets = [0, 150, 300, 450];
    const burstDuration = 5;
    for (let i = 0; i < ps.intervals; i++) {
        const b = simStartSec + i * ps.intervalDuration * 60;
        const e = b + ps.intervalDuration * 60;
        ps.crossings.forEach(c => {
            ['fwd', 'rev'].forEach(dir => {
                const total = parseInt(ps.data[`${ps.crossings.indexOf(c)}_${i}_${dir}`] || 0);
                if (!total) return;
                const edges = (App.project.crossingEdges && App.project.crossingEdges[c.id]) || '';
                if (!edges) return; // no edge data available for this crossing — skip
                const base = Math.floor(total / 4);
                let rem = total % 4;
                pedOffsets.forEach((offset, bIdx) => {
                    const count = base + (rem > 0 ? 1 : 0);
                    if (rem > 0) rem--;
                    if (count <= 0) return;
                    const start = b + offset;
                    if (start >= e) return;
                    const end = Math.min(start + burstDuration, e);
                    add(start, `${ind}<personFlow id="ped_${c.id}_${dir}_${i}${bIdx}" type="fast_ped" begin="${f(start)}" end="${f(end)}" number="${count}">\n${ind}${ind}<walk edges="${edges}"/>\n${ind}</personFlow>`);
                });
            });
        });
    }

    // ── Parking / idling flows (Bus & Parking tab) ───────────
    const bs = App._busState;
    for (let i = 0; i < bs.intervals; i++) {
        const begin = simStartSec + i * bs.intervalDuration * 60;
        const end = begin + bs.intervalDuration * 60;
        (bs.parkingAreas || []).forEach((a, ai) => {
            VTYPES.forEach(vt2 => {
                const count = parseInt(bs.parkingData[`${ai}_${i}_${vt2}`] || 0);
                if (count <= 0) return;
                const dur = a.duration || 120;
                add(begin, `${ind}<flow id="park_${a.id}_${vt2}_${i}" type="${vt2}" begin="${f(begin)}" end="${f(end)}" number="${count}" route="${a.routeId||''}"><stop parkingArea="${a.id}" duration="${f(dur)}"/></flow>`);
            });
        });
    }

    lines.push(`${ind}<!-- Vehicles, persons and containers (sorted by depart) -->`);
    allItems.sort((a, b) => a.begin - b.begin);
    allItems.forEach(item => lines.push(item.xml));

    lines.push(`</routes>`);
    return lines.join('\n');
};
