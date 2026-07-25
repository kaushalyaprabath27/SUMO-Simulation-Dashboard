// Regression coverage for xmlBuilderCore.js's buildFullXML — the combined
// demand-XML generator, and the literal "builds demand XML" deliverable
// this app exists for. Extracted from App._buildFullXML (xmlBuilder.js)
// with every App/document read replaced by an explicit parameter. Run with:
// node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFullXML } = require('../xmlBuilderCore.js');

// Shared minimal base params — each test overrides only what it needs.
function baseParams(overrides) {
    return Object.assign({
        vehicleTypeNames: [],
        customVehicleTypeNames: [],
        buildVTypeXML: (id) => `<vType id="${id}"/>`,
        simStartTime: '06:30',
        flowsState: { intervals: 0, intervalDuration: 10, routes: [], data: {} },
        pedState: { intervals: 0, intervalDuration: 10, crossings: [], data: {} },
        busState: { busRouteId: '', stops: [], intervalDuration: 10, dwellData: {}, intervals: 0, parkingAreas: [], parkingData: {} },
        crossingEdges: {},
        now: 'TESTTIME'
    }, overrides);
}

test('empty state: produces a well-formed, empty <routes> document with header and footer comments, no demand items', () => {
    const xml = buildFullXML(baseParams({ vehicleTypeNames: ['passenger_car'] }));
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<!-- generated on TESTTIME -->/);
    assert.match(xml, /<routes xmlns:xsi=/);
    assert.match(xml, /<vType id="passenger_car"\/>/);
    assert.match(xml, /<\/routes>$/);
    assert.equal(xml.includes('<flow'), false);
    assert.equal(xml.includes('<personFlow'), false);
});

test('vTypes: includes both built-in and custom (project-specific) type ids, via the injected buildVTypeXML', () => {
    const calledWith = [];
    const xml = buildFullXML(baseParams({
        vehicleTypeNames: ['passenger_car', 'heavy_bus'],
        customVehicleTypeNames: ['my_custom_type'],
        buildVTypeXML: (id) => { calledWith.push(id); return `<vType id="${id}"/>`; }
    }));
    assert.deepEqual(calledWith, ['passenger_car', 'heavy_bus', 'my_custom_type']);
    assert.match(xml, /<vType id="my_custom_type"\/>/);
});

test('basic vehicle flow: one route, one interval, one vtype count -> a single <flow> at the correct begin/end time', () => {
    const xml = buildFullXML(baseParams({
        flowsState: { intervals: 1, intervalDuration: 10, routes: [{ id: 'r1' }], data: { '0_0_passenger_car': 5 } }
    }));
    // 06:30 = 23400s; a 10-minute interval -> end = 24000s
    assert.match(xml, /<flow id="flow_r1_passenger_car_0" type="passenger_car" begin="23400\.00" end="24000\.00" number="5" departLane="best" departPos="free" departSpeed="max" route="r1"\/>/);
});

test('vehicle flow: a zero or missing count for a route/vtype/interval combination produces no flow at all', () => {
    const xml = buildFullXML(baseParams({
        flowsState: { intervals: 1, intervalDuration: 10, routes: [{ id: 'r1' }], data: { '0_0_passenger_car': 0 } }
    }));
    assert.equal(xml.includes('<flow'), false);
});

test('bus-stop-attached flow: heavy_bus on the configured bus route gets nested <stop> elements with the right dwell duration for that interval', () => {
    const xml = buildFullXML(baseParams({
        flowsState: { intervals: 1, intervalDuration: 10, routes: [{ id: 'busRoute' }], data: { '0_0_heavy_bus': 2 } },
        busState: { busRouteId: 'busRoute', stops: [{ id: 'stopA' }], intervalDuration: 10, dwellData: { '0_39': 20 }, intervals: 0, parkingAreas: [], parkingData: {} }
    }));
    // begin=23400s, busDwellIntervalDur=10min=600s -> busIdx = floor(23400/600) = 39
    assert.match(xml, /<flow id="flow_busRoute_heavy_bus_0"[^>]*>\s*<stop busStop="stopA" duration="20\.00"\/>\s*<\/flow>/);
});

test('bus-stop-attached flow: falls back to a 10s default dwell when no dwellData entry exists for this interval', () => {
    const xml = buildFullXML(baseParams({
        flowsState: { intervals: 1, intervalDuration: 10, routes: [{ id: 'busRoute' }], data: { '0_0_heavy_bus': 1 } },
        busState: { busRouteId: 'busRoute', stops: [{ id: 'stopA' }], intervalDuration: 10, dwellData: {}, intervals: 0, parkingAreas: [], parkingData: {} }
    }));
    assert.match(xml, /<stop busStop="stopA" duration="10\.00"\/>/);
});

test('bus-stop-attached flow: heavy_bus NOT on the bus route (or no stops configured) is a plain self-closing flow, no nested stops', () => {
    const xml = buildFullXML(baseParams({
        flowsState: { intervals: 1, intervalDuration: 10, routes: [{ id: 'otherRoute' }], data: { '0_0_heavy_bus': 1 } },
        busState: { busRouteId: 'busRoute', stops: [{ id: 'stopA' }], intervalDuration: 10, dwellData: {}, intervals: 0, parkingAreas: [], parkingData: {} }
    }));
    assert.match(xml, /<flow id="flow_otherRoute_heavy_bus_0"[^>]*\/>/); // self-closing
    assert.equal(xml.includes('<stop busStop'), false);
});

test('pedestrian crossing: a total is split across 4 timed bursts, remainder distributed to the earliest bursts first', () => {
    const xml = buildFullXML(baseParams({
        pedState: { intervals: 1, intervalDuration: 10, crossings: [{ id: 'c0' }], data: { '0_0_fwd': 10 } },
        crossingEdges: { c0: 'edgeA edgeB' }
    }));
    // total=10 across 4 bursts: base=2, rem=2 -> counts [3,3,2,2]
    const counts = [...xml.matchAll(/<personFlow id="ped_c0_fwd_0(\d)"[^>]*number="(\d+)"/g)].map(m => m[2]);
    assert.deepEqual(counts, ['3', '3', '2', '2']);
    assert.equal((xml.match(/<walk edges="edgeA edgeB"\/>/g) || []).length, 4);
});

test('pedestrian crossing: a crossing with no configured "edges" attribute is skipped entirely, not emitted with an empty walk', () => {
    const xml = buildFullXML(baseParams({
        pedState: { intervals: 1, intervalDuration: 10, crossings: [{ id: 'c0' }], data: { '0_0_fwd': 10 } },
        crossingEdges: {} // no edges defined for c0
    }));
    assert.equal(xml.includes('<personFlow'), false);
});

test('pedestrian crossing: forward and reverse directions are independent (a count in one does not require the other)', () => {
    const xml = buildFullXML(baseParams({
        pedState: { intervals: 1, intervalDuration: 10, crossings: [{ id: 'c0' }], data: { '0_0_fwd': 4 } }, // no '..._rev' entry at all
        crossingEdges: { c0: 'edgeA' }
    }));
    assert.equal((xml.match(/ped_c0_fwd_/g) || []).length, 4); // 4 bursts of 1 each
    assert.equal(xml.includes('ped_c0_rev_'), false);
});

test('parking/idling flow: a configured parking area with a count produces a <flow> with a nested <stop parkingArea>', () => {
    const xml = buildFullXML(baseParams({
        busState: { busRouteId: '', stops: [], intervalDuration: 10, dwellData: {}, intervals: 1, parkingAreas: [{ id: 'p1', duration: 45, routeId: 'pr1' }], parkingData: { '0_0_van': 3 } }
    }));
    assert.match(xml, /<flow id="park_p1_van_0" type="van" begin="23400\.00" end="24000\.00" number="3" route="pr1"><stop parkingArea="p1" duration="45\.00"\/><\/flow>/);
});

test('parking/idling flow: falls back to a 120s default duration when the parking area has none configured', () => {
    const xml = buildFullXML(baseParams({
        busState: { busRouteId: '', stops: [], intervalDuration: 10, dwellData: {}, intervals: 1, parkingAreas: [{ id: 'p1' }], parkingData: { '0_0_van': 1 } }
    }));
    assert.match(xml, /<stop parkingArea="p1" duration="120\.00"\/>/);
});

test('all demand items are sorted by begin time across categories, regardless of the order they were built in', () => {
    // Parking is constructed AFTER flows in the source, but begins earlier
    // here — the final output must still list it first.
    const xml = buildFullXML(baseParams({
        flowsState: { intervals: 2, intervalDuration: 10, routes: [{ id: 'r1' }], data: { '0_1_passenger_car': 1 } }, // interval 1 -> later begin
        busState: { busRouteId: '', stops: [], intervalDuration: 10, dwellData: {}, intervals: 1, parkingAreas: [{ id: 'p1', duration: 60, routeId: 'pr1' }], parkingData: { '0_0_van': 1 } } // interval 0 -> earlier begin
    }));
    const parkIdx = xml.indexOf('park_p1_van_0');
    const flowIdx = xml.indexOf('flow_r1_passenger_car_1');
    assert.ok(parkIdx > -1 && flowIdx > -1);
    assert.ok(parkIdx < flowIdx, 'parking (earlier begin) should appear before the later flow');
});
