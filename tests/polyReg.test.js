// Regression coverage for polyReg.js's calculatePolyReg — the Dwell Time
// Analysis tab's sensitivity curve fit. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePolyReg } = require('../polyReg.js');

test('n<5 guard: fewer than 5 usable points reports insufficient data, not a fabricated fit', () => {
    const r = calculatePolyReg([0, 10, 20, 45], [1, 2, 3, 4]);
    assert.equal(r.eq, 'y = Insufficient Data (Need all 5 dwell scenarios)');
    assert.equal(r.r2, 'N/A');
    assert.equal(r.lowConfidence, true);
});

test('n<5 guard: null/NaN entries are filtered out before counting, so 5 raw points with 1 gap still reports insufficient data', () => {
    // Simulates a dwell sweep where one of the 5 scenarios never got data.
    const r = calculatePolyReg([0, 10, 20, 45, 90], [1, 2, null, 4, 5]);
    assert.equal(r.lowConfidence, true);
});

test('well-behaved 5-point fit: recovers a known quadratic (y = x^2) with R^2 = 1, and does not trigger the negative-value guard', () => {
    const x = [0, 10, 20, 45, 90];
    const y = x.map(v => v * v);
    const r = calculatePolyReg(x, y);
    assert.equal(r.lowConfidence, false);
    assert.equal(r.r2, '1.0000');
    // eq should be close to "y = 1.00x^2 + 0.00x + 0.00"
    assert.match(r.eq, /1\.00x²/);
    assert.equal(r.impliesNegative, false);
    assert.equal(r.warning, null);
});

test('well-behaved 5-point fit: a real-shaped noisy dataset produces a genuine R^2 between 0 and 1, no false-positive warning', () => {
    const x = [0, 10, 20, 45, 90];
    const y = [12, 14, 19, 30, 55]; // roughly increasing, mild curvature, not exact, always positive
    const r = calculatePolyReg(x, y);
    assert.equal(r.lowConfidence, false);
    const r2 = parseFloat(r.r2);
    assert.ok(r2 > 0.9 && r2 <= 1, `expected a strong but not necessarily perfect fit, got r2=${r2}`);
    assert.equal(r.impliesNegative, false);
    assert.equal(r.warning, null);
});

test('edge case: all-identical y-values (zero variance) does not throw or divide into NaN', () => {
    // ssTot = 0 here; the function guards this with `(ssTot || 1)` in the
    // denominator specifically to avoid a 0/0 division producing NaN.
    const r = calculatePolyReg([0, 10, 20, 45, 90], [5, 5, 5, 5, 5]);
    assert.equal(r.lowConfidence, false);
    assert.ok(!Number.isNaN(parseFloat(r.r2)), `r2 should not be NaN, got ${r.r2}`);
    assert.equal(r.impliesNegative, false); // flat at y=5, never dips below 0
});

test('domain-plausibility guard: a curve that dips negative WITHIN the sampled range is flagged with a visible warning', () => {
    // y = x^2 - 1000 exactly: vertex at x=0, y=-1000, well inside [0,90].
    const x = [0, 10, 20, 45, 90];
    const y = [-1000, -900, -600, 1025, 7100];
    const r = calculatePolyReg(x, y);
    assert.equal(r.lowConfidence, false);
    assert.equal(r.impliesNegative, true);
    assert.ok(typeof r.warning === 'string' && r.warning.length > 0);
    assert.match(r.warning, /negative value/);
    assert.match(r.warning, /-1000\.00/); // reports the actual minimum found
});

test('domain-plausibility guard: a sharp early-drop dataset also triggers the guard (dips negative in-range, not just on extrapolation)', () => {
    const x = [0, 10, 20, 45, 90];
    const y = [50, 10, 2, 1, 0.5]; // sharp early drop -> quadratic swings negative near x=0-20
    const r = calculatePolyReg(x, y);
    assert.equal(r.lowConfidence, false);
    assert.equal(r.impliesNegative, true);
    assert.match(r.warning, /negative value/);
});

test('degenerate case: a singular matrix (e.g. all x-values identical) reports "Linear/Constant" rather than crashing', () => {
    const r = calculatePolyReg([10, 10, 10, 10, 10], [1, 2, 3, 4, 5]);
    assert.equal(r.eq, 'y = Linear/Constant');
    assert.equal(r.r2, 'N/A');
});
