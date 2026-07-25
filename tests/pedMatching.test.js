// Regression coverage for pedMatching.js's pedestrian-crossing matching
// logic, extracted from App._applyParsedPedData. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { containsSeq, findNearestIntervalIndex, matchPedFlowToCrossing } = require('../pedMatching.js');

// ---- containsSeq ----

test('containsSeq: exact match', () => {
    assert.equal(containsSeq(['a', 'b', 'c'], ['a', 'b', 'c']), true);
});

test('containsSeq: needle as a contiguous subsequence in the middle (footpath edges before/after)', () => {
    assert.equal(containsSeq(['foot1', 'a', 'b', 'c', 'foot2'], ['a', 'b', 'c']), true);
});

test('containsSeq: needle present but NOT contiguous does not match', () => {
    assert.equal(containsSeq(['a', 'x', 'b', 'c'], ['a', 'b', 'c']), false);
});

test('containsSeq: empty needle never matches', () => {
    assert.equal(containsSeq(['a', 'b'], []), false);
});

test('containsSeq: needle longer than haystack never matches', () => {
    assert.equal(containsSeq(['a'], ['a', 'b']), false);
});

// ---- findNearestIntervalIndex ----

test('findNearestIntervalIndex: exact match', () => {
    assert.equal(findNearestIntervalIndex(600, [0, 600, 1200]), 1);
});

test('findNearestIntervalIndex: snaps to the closer of two neighbors', () => {
    assert.equal(findNearestIntervalIndex(650, [0, 600, 1200]), 1); // closer to 600 than 1200
    assert.equal(findNearestIntervalIndex(950, [0, 600, 1200]), 2); // closer to 1200 than 600
});

test('findNearestIntervalIndex: empty begins array returns -1, not a crash', () => {
    assert.equal(findNearestIntervalIndex(600, []), -1);
});

// ---- matchPedFlowToCrossing: <walk edges="..."> style ----

test('matchPedFlowToCrossing: walk edges containing a crossing\'s edges as a forward subsequence', () => {
    const flow = { id: 'ped0', edgesStr: 'footA edgeX edgeY footB' };
    const crossings = [{ id: 'c0' }];
    const crossingEdgesMap = { c0: 'edgeX edgeY' };
    const r = matchPedFlowToCrossing(flow, crossings, crossingEdgesMap);
    assert.equal(r.crossingIndex, 0);
    assert.equal(r.direction, 'fwd');
});

test('matchPedFlowToCrossing: walk edges containing a crossing\'s edges REVERSED is direction "rev"', () => {
    const flow = { id: 'ped0', edgesStr: 'footA edgeY edgeX footB' };
    const crossings = [{ id: 'c0' }];
    const crossingEdgesMap = { c0: 'edgeX edgeY' };
    const r = matchPedFlowToCrossing(flow, crossings, crossingEdgesMap);
    assert.equal(r.crossingIndex, 0);
    assert.equal(r.direction, 'rev');
});

test('matchPedFlowToCrossing: no crossing has a matching edge sequence returns crossingIndex -1', () => {
    const flow = { id: 'ped0', edgesStr: 'footA edgeZ footB' };
    const crossings = [{ id: 'c0' }];
    const crossingEdgesMap = { c0: 'edgeX edgeY' };
    const r = matchPedFlowToCrossing(flow, crossings, crossingEdgesMap);
    assert.equal(r.crossingIndex, -1);
});

test('matchPedFlowToCrossing: a crossing with no configured edges attribute is skipped, not matched', () => {
    const flow = { id: 'ped0', edgesStr: 'edgeX edgeY' };
    const crossings = [{ id: 'c0' }];
    const crossingEdgesMap = { c0: '' }; // blank/unconfigured
    const r = matchPedFlowToCrossing(flow, crossings, crossingEdgesMap);
    assert.equal(r.crossingIndex, -1);
});

test('matchPedFlowToCrossing: documents the "last match wins" quirk when a walk matches more than one crossing', () => {
    // This is the original app.js behavior preserved as-is (see the
    // function's own comment) — crossings.forEach doesn't stop at the
    // first match, so the LAST crossing whose edges appear in the walk
    // wins, not the first. Not "fixed" here, just confirmed and documented.
    const flow = { id: 'ped0', edgesStr: 'edgeA edgeB edgeC edgeD' };
    const crossings = [{ id: 'c0' }, { id: 'c1' }];
    const crossingEdgesMap = { c0: 'edgeA edgeB', c1: 'edgeC edgeD' };
    const r = matchPedFlowToCrossing(flow, crossings, crossingEdgesMap);
    assert.equal(r.crossingIndex, 1); // c1, the LAST match, not c0 the first
});

// ---- matchPedFlowToCrossing: <personTrip from= to=> id-pattern style ----

test('matchPedFlowToCrossing: personTrip-style id "c0_in_0" matches crossing 0, forward', () => {
    const flow = { id: 'c0_in_150' };
    const crossings = [{ id: 'c0' }];
    const r = matchPedFlowToCrossing(flow, crossings, {});
    assert.equal(r.crossingIndex, 0);
    assert.equal(r.direction, 'fwd');
});

test('matchPedFlowToCrossing: personTrip-style id "c1_out_600" matches crossing 1, reverse', () => {
    const flow = { id: 'c1_out_600' };
    const crossings = [{ id: 'c0' }, { id: 'c1' }];
    const r = matchPedFlowToCrossing(flow, crossings, {});
    assert.equal(r.crossingIndex, 1);
    assert.equal(r.direction, 'rev');
});

test('matchPedFlowToCrossing: personTrip id is case-insensitive ("C0_IN_0")', () => {
    const flow = { id: 'C0_IN_0' };
    const crossings = [{ id: 'c0' }];
    const r = matchPedFlowToCrossing(flow, crossings, {});
    assert.equal(r.crossingIndex, 0);
    assert.equal(r.direction, 'fwd');
});

test('matchPedFlowToCrossing: personTrip id referencing an out-of-range crossing index does not match', () => {
    const flow = { id: 'c5_in_0' };
    const crossings = [{ id: 'c0' }]; // only 1 crossing configured, index 5 is out of range
    const r = matchPedFlowToCrossing(flow, crossings, {});
    assert.equal(r.crossingIndex, -1);
});

test('matchPedFlowToCrossing: an id that does not follow the cN_in/out_ convention at all does not match', () => {
    const flow = { id: 'randomVehicle42' };
    const crossings = [{ id: 'c0' }];
    const r = matchPedFlowToCrossing(flow, crossings, {});
    assert.equal(r.crossingIndex, -1);
});

test('matchPedFlowToCrossing: a flow with neither edgesStr nor a matching id returns no match, not a throw', () => {
    const flow = {};
    const crossings = [{ id: 'c0' }];
    const r = matchPedFlowToCrossing(flow, crossings, {});
    assert.equal(r.crossingIndex, -1);
    assert.equal(r.direction, 'fwd');
});
