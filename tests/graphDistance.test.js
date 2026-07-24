// Regression coverage for graphDistance.js's computeLaneGraphDistance —
// the Dijkstra shortest-path calc behind MAPE's "📐 Auto" segment-distance
// button. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeLaneGraphDistance } = require('../graphDistance.js');

test('normal case: straight chain of lanes sums to the correct distance', () => {
    // laneA (100m) -> laneB (50m) -> laneC (200m), point 20m into laneA to
    // point 30m into laneC: (100-20) + 50 + 30 = 160
    const laneLength = { laneA: 100, laneB: 50, laneC: 200 };
    const adjacency = { laneA: ['laneB'], laneB: ['laneC'] };
    const d = computeLaneGraphDistance(laneLength, adjacency, 'laneA', 'laneC', 20, 30);
    assert.equal(d, 160);
});

test('normal case: same lane, to-position ahead of from-position', () => {
    const laneLength = { laneA: 100 };
    const d = computeLaneGraphDistance(laneLength, {}, 'laneA', 'laneA', 10, 60);
    assert.equal(d, 50);
});

test('same lane but to-position is behind from-position returns null (would mean going backwards)', () => {
    const laneLength = { laneA: 100 };
    const d = computeLaneGraphDistance(laneLength, {}, 'laneA', 'laneA', 60, 10);
    assert.equal(d, null);
});

test('disconnected detectors: no path exists between the two lanes', () => {
    const laneLength = { laneA: 100, laneB: 50, laneC: 200, laneX: 30 };
    // laneC is its own island, unreachable from laneA/laneB
    const adjacency = { laneA: ['laneB'] };
    const d = computeLaneGraphDistance(laneLength, adjacency, 'laneA', 'laneC', 0, 0);
    assert.equal(d, null);
});

test('unknown lane id (not in laneLength) returns null rather than throwing', () => {
    const laneLength = { laneA: 100 };
    const d = computeLaneGraphDistance(laneLength, {}, 'laneA', 'doesNotExist', 0, 0);
    assert.equal(d, null);
});

test('hits the 8000m max-distance bound: a chain longer than the bound returns null', () => {
    // 20 lanes of 500m each = 10,000m total, laid out as a straight chain —
    // exceeds the default 8000m cap before reaching the destination.
    const laneLength = {};
    const adjacency = {};
    const N = 20;
    for (let i = 0; i < N; i++) {
        laneLength['lane' + i] = 500;
        if (i > 0) adjacency['lane' + (i - 1)] = ['lane' + i];
    }
    const d = computeLaneGraphDistance(laneLength, adjacency, 'lane0', 'lane' + (N - 1), 0, 0);
    assert.equal(d, null);
});

test('a chain just under the 8000m bound still resolves correctly', () => {
    const laneLength = {};
    const adjacency = {};
    const N = 15; // 15 * 500 = 7500m, under the 8000m cap
    for (let i = 0; i < N; i++) {
        laneLength['lane' + i] = 500;
        if (i > 0) adjacency['lane' + (i - 1)] = ['lane' + i];
    }
    const d = computeLaneGraphDistance(laneLength, adjacency, 'lane0', 'lane' + (N - 1), 0, 0);
    // distance = sum of all lanes except the destination's own (toPos=0 means
    // 0 metres consumed into the final lane): 14 full lanes of 500m = 7000
    assert.equal(d, 7000);
});

test('hits the 20000-node visit cap: a huge disconnected graph does not hang and returns null', () => {
    const laneLength = {};
    const adjacency = {};
    const N = 25000; // exceeds MAX_VISITS
    for (let i = 0; i < N; i++) {
        laneLength['n' + i] = 1;
        if (i > 0) adjacency['n' + (i - 1)] = ['n' + i];
    }
    const start = Date.now();
    const d = computeLaneGraphDistance(laneLength, adjacency, 'n0', 'n' + (N - 1), 0, 0);
    const elapsedMs = Date.now() - start;
    assert.equal(d, null);
    // Bounded search — should terminate quickly rather than walking all 25000 nodes.
    assert.ok(elapsedMs < 2000, `expected the visit cap to bound runtime, took ${elapsedMs}ms`);
});

test('custom maxDist/maxVisits options are respected', () => {
    const laneLength = { laneA: 100, laneB: 100 };
    const adjacency = { laneA: ['laneB'] };
    // Default cap (8000m) would resolve this fine; a tiny custom cap should not.
    const d = computeLaneGraphDistance(laneLength, adjacency, 'laneA', 'laneB', 0, 0, { maxDist: 50 });
    assert.equal(d, null);
});
