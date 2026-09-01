// Regression coverage for polyReg.js's calculatePolyReg — the Dwell Time
// Analysis tab's sensitivity curve fit. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculatePolyReg, fitLinearModel, compareModels, formatSigFig, computeAdjustedR2, computeAIC } = require('../polyReg.js');

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
    // eq should be close to "y = 1.000x² + 0.000x + 0.000" (4 sig figs)
    assert.match(r.eq, /1\.000x²/);
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

test('formatSigFig: 4 significant figures, does not round a small coefficient away to "0.00"', () => {
    // The exact regression this guards against: a real fitted quadratic
    // 'a' coefficient of ~2.2e-3 used to render as "0.00x²" under the old
    // .toFixed(2), erasing the term that defines the curve's shape.
    assert.equal(formatSigFig(0.0022), '0.002200');
    assert.equal(formatSigFig(252.12), '252.1');
    assert.equal(formatSigFig(0), '0.000');
    assert.equal(formatSigFig(1), '1.000');
});

test('fitLinearModel: recovers a known exact line (y = 2x + 5) with R^2 = 1', () => {
    const x = [0, 10, 20, 30, 40];
    const y = x.map(v => 2 * v + 5);
    const r = fitLinearModel(x, y);
    assert.equal(r.lowConfidence, false);
    assert.equal(r.r2, '1.0000');
    assert.match(r.eq, /2\.000x/);
    assert.match(r.eq, /5\.000/);
    assert.equal(r.impliesNegative, false);
});

test('fitLinearModel: fewer than 2 points cannot fit a line at all', () => {
    const r = fitLinearModel([5], [10]);
    assert.equal(r.lowConfidence, true);
    assert.equal(r.r2, null);
    assert.match(r.eq, /Insufficient Data/);
});

test('fitLinearModel: n<=3 (order 1 + 2) is fitted but flagged low-confidence, unlike the quadratic\'s hard n<5 block', () => {
    const r2pt = fitLinearModel([0, 10], [5, 25]);
    assert.equal(r2pt.lowConfidence, true);
    assert.notEqual(r2pt.r2, null); // it DOES fit, just flagged
    assert.match(r2pt.warning, /2 points/);

    const r4pt = fitLinearModel([0, 10, 20, 30], [5, 25, 45, 65]);
    assert.equal(r4pt.lowConfidence, false); // n=4 > order(1)+2=3
});

test('fitLinearModel: all-identical x-values (vertical line) is reported as undefined, not a crash', () => {
    const r = fitLinearModel([10, 10, 10], [1, 2, 3]);
    assert.match(r.eq, /Undefined/);
});

test('computeAdjustedR2: known case, and null when there are no residual degrees of freedom left', () => {
    // 1-(1-0.9)*(10-1)/(10-1-1) = 1-0.1*9/8 = 0.8875
    const adj = computeAdjustedR2(0.9, 10, 1);
    assert.ok(Math.abs(adj - 0.8875) < 1e-9, `got ${adj}`);
    assert.equal(computeAdjustedR2(0.9, 3, 2), null); // n-p-1 = 0
});

test('computeAIC: known case, and -Infinity (not NaN) for a genuine zero-residual perfect fit', () => {
    // 5*ln(10/5) + 2*2 = 5*ln(2) + 4
    const aic = computeAIC(10, 5, 2);
    assert.ok(Math.abs(aic - (5 * Math.log(2) + 4)) < 1e-9, `got ${aic}`);
    assert.equal(computeAIC(0, 5, 2), -Infinity);
});

test('compareModels: prefers the linear fit (lower AIC) when the true relationship is a straight line', () => {
    const x = [0, 10, 20, 30, 40, 50, 60];
    const y = x.map(v => 3 * v + 1); // exactly linear, no curvature at all
    const cmp = compareModels(x, y);
    assert.equal(cmp.preferred, 'Linear (lower AIC)');
});

test('compareModels: reports "Linear (quadratic not fitted)" when n is below the quadratic\'s hard minimum', () => {
    const x = [0, 10, 20, 30]; // n=4, quadratic needs >=5
    const y = x.map(v => 2 * v + 1);
    const cmp = compareModels(x, y);
    assert.equal(cmp.quadratic.lowConfidence, true);
    assert.equal(cmp.preferred, 'Linear (quadratic not fitted)');
});
