// Pure core of App._buildFullXML (xmlBuilder.js) — the literal "builds
// demand XML" deliverable this whole app exists for (see CLAUDE.md's
// opening description), extracted so it's unit-testable under Node. This
// was the largest remaining untested piece of pure logic in the app: given
// the same project/table state, it deterministically returns the combined
// <routes> XML string. No `this`, no DOM — every value app.js used to read
// directly off `App`/`document` is now an explicit parameter. See
// tests/xmlBuilderCore.test.js.
//
// Params:
//   vehicleTypeNames    — the fixed built-in category ids (data.js's VEHICLE_TYPE_NAMES)
//   customVehicleTypeNames — extra vType ids from an uploaded project (Object.keys(App._customVehicleTypes))
//   buildVTypeXML(id)   — returns a "<vType .../>" string for one type id (App._buildVTypeXML)
//   simStartTime        — "HH:MM" string (from #sim-start-time)
//   flowsState          — { intervals, intervalDuration, routes: [{id}], data: {} }
//   pedState            — { intervals, intervalDuration, crossings: [{id}], data: {} }
//   busState            — { busRouteId, stops: [{id}], intervalDuration, dwellData: {},
//                            intervals, parkingAreas: [{id,duration,routeId}], parkingData: {} }
//   crossingEdges       — { [crossingId]: "edge1 edge2 ..." } (App.project.crossingEdges)
//   now                 — pre-formatted generation timestamp string (so the output is
//                          deterministic/testable rather than depending on the real clock)
function buildFullXML(params) {
    const {
        vehicleTypeNames, customVehicleTypeNames, buildVTypeXML, simStartTime,
        flowsState, pedState, busState, crossingEdges, now
    } = params;

    const lines = [];
    const f = (n, d = 2) => Number(n).toFixed(d);
    const ind = '    '; // 4-space

    // -- Header --------------------------------------------------
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push('');
    lines.push(`<!-- generated on ${now} -->`);
    lines.push('');
    lines.push(`<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://sumo.dlr.de/xsd/routes_file.xsd">`);

    // -- vTypes ----------------------------------------------------
    lines.push(`${ind}<!-- VTypes -->`);
    const allVTypeNames = vehicleTypeNames.concat(customVehicleTypeNames || []);
    allVTypeNames.forEach(id => lines.push(`${ind}${buildVTypeXML(id)}`));

    lines.push(`${ind}<!-- Routes are assumed to already exist in your project's .rou.xml — this file only adds demand (flows/persons) referencing those route ids. -->`);

    // -- Collect all items, sorted by begin time ------------------
    const allItems = [];
    const add = (begin, xml) => allItems.push({ begin, xml });

    const [sh, sm] = simStartTime.split(':').map(Number);
    const simStartSec = sh * 3600 + sm * 60;

    const VTYPES = ['motorcycle', 'tuk_tuk', 'passenger_car', 'heavy_bus', 'van', 'truck'];

    // -- Vehicle flows (Flows tab) ---------------------------------
    const fs = flowsState;
    const busRouteId = busState.busRouteId || '';
    const stops = busState.stops || [];
    const busDwellIntervalDur = busState.intervalDuration;

    for (let i = 0; i < fs.intervals; i++) {
        const begin = simStartSec + i * fs.intervalDuration * 60;
        const end = begin + fs.intervalDuration * 60;
        fs.routes.forEach((r, ri) => {
            VTYPES.forEach(vt2 => {
                const count = parseInt(fs.data[`${ri}_${i}_${vt2}`] || 0);
                if (count <= 0) return;
                const id = `flow_${r.id}_${vt2}_${i}`;
                if (vt2 === 'heavy_bus' && r.id === busRouteId && stops.length) {
                    const busIdx = Math.floor(begin / (busDwellIntervalDur * 60));
                    let xml = `${ind}<flow id="${id}" type="${vt2}" begin="${f(begin)}" end="${f(end)}" number="${count}" departLane="best" departPos="free" departSpeed="max" route="${r.id}">\n`;
                    stops.forEach((s, si) => {
                        const dur = parseFloat(busState.dwellData[`${si}_${busIdx}`]) || 10;
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

    // -- Pedestrian crossings (Pedestrians tab) ---------------------
    const ps = pedState;
    const pedOffsets = [0, 150, 300, 450];
    const burstDuration = 5;
    for (let i = 0; i < ps.intervals; i++) {
        const b = simStartSec + i * ps.intervalDuration * 60;
        const e = b + ps.intervalDuration * 60;
        ps.crossings.forEach(c => {
            ['fwd', 'rev'].forEach(dir => {
                const total = parseInt(ps.data[`${ps.crossings.indexOf(c)}_${i}_${dir}`] || 0);
                if (!total) return;
                const edges = (crossingEdges && crossingEdges[c.id]) || '';
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

    // -- Parking / idling flows (Bus & Parking tab) ------------------
    const bs = busState;
    for (let i = 0; i < bs.intervals; i++) {
        const begin = simStartSec + i * bs.intervalDuration * 60;
        const end = begin + bs.intervalDuration * 60;
        (bs.parkingAreas || []).forEach((a, ai) => {
            VTYPES.forEach(vt2 => {
                const count = parseInt(bs.parkingData[`${ai}_${i}_${vt2}`] || 0);
                if (count <= 0) return;
                const dur = a.duration || 120;
                add(begin, `${ind}<flow id="park_${a.id}_${vt2}_${i}" type="${vt2}" begin="${f(begin)}" end="${f(end)}" number="${count}" route="${a.routeId || ''}"><stop parkingArea="${a.id}" duration="${f(dur)}"/></flow>`);
            });
        });
    }

    lines.push(`${ind}<!-- Vehicles, persons and containers (sorted by depart) -->`);
    allItems.sort((a, b) => a.begin - b.begin);
    allItems.forEach(item => lines.push(item.xml));

    lines.push(`</routes>`);
    return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildFullXML };
}
