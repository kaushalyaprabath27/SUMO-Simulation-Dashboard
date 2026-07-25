// Regression coverage for gehMape.js's GEH/MAPE formulas — the Validation
// and MAPE Validation tabs' core arithmetic. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateGEH, getGEHStatus, getGEHModelStatus,
    computeMapeAvgSpeed, computeMapeSimulatedTravelTime, calculateMapeError,
    getMapeStatus, getMapeModelStatus,
    getMapeStatusEdgeFormat, getMapeModelStatusEdgeFormat
} = require('../gehMape.js');

test('GEH: M = C = 0 returns 0, not NaN (division-by-zero guard)', () => {
    assert.equal(calculateGEH(0, 0), 0);
});

test('GEH: matches the textbook formula for a known case', () => {
    // sqrt(2*(120-100)^2/(120+100)) = sqrt(2*400/220) = sqrt(3.6363..) = ~1.907
    const geh = calculateGEH(120, 100);
    assert.ok(Math.abs(geh - 1.9069) < 0.001, `got ${geh}`);
});

test('GEH: perfect match (sim === obs, both nonzero) is 0', () => {
    assert.equal(calculateGEH(50, 50), 0);
});

test('GEH status thresholds: <5 Valid, <10 Marginal, >=10 Invalid', () => {
    assert.equal(getGEHStatus(4.99), 'Valid (Excellent)');
    assert.equal(getGEHStatus(5), 'Marginal (Acceptable)');
    assert.equal(getGEHStatus(9.99), 'Marginal (Acceptable)');
    assert.equal(getGEHStatus(10), 'Invalid (Needs Calibration)');
});

test('GEH model status: no visible rows reports "No data in this window"', () => {
    assert.equal(getGEHModelStatus(0, 0), 'No data in this window');
});

test('GEH model status: >=85% valid is Success, >=50% is Needs Calibration, below is Failed', () => {
    assert.equal(getGEHModelStatus(9, 10), 'Success (Valid)');  // 90%
    assert.equal(getGEHModelStatus(5, 10), 'Needs Calibration'); // 50%
    assert.equal(getGEHModelStatus(4, 10), 'Failed — Major Calibration Required'); // 40%
});

test('MAPE: avg speed falls back to whichever single detector is nonzero', () => {
    assert.equal(computeMapeAvgSpeed(10, 20), 15);
    assert.equal(computeMapeAvgSpeed(0, 20), 20);
    assert.equal(computeMapeAvgSpeed(10, 0), 10);
    assert.equal(computeMapeAvgSpeed(0, 0), 0);
});

test('MAPE: simulated travel time requires both detectors, a real distance, and a real speed', () => {
    assert.equal(computeMapeSimulatedTravelTime(true, 500, 10), 50);
    assert.equal(computeMapeSimulatedTravelTime(false, 500, 10), 0); // missing a detector
    assert.equal(computeMapeSimulatedTravelTime(true, 0, 10), 0);    // missing distance
    assert.equal(computeMapeSimulatedTravelTime(true, 500, 0), 0);   // missing speed
});

test('MAPE error: zero observed value returns 0, not Infinity/NaN', () => {
    assert.equal(calculateMapeError(50, 0), 0);
});

test('MAPE error: zero simulated value with a real observed value IS a 100% error (standard MAPE — unified, no sim>0 guard)', () => {
    // Previously this returned 0 ("not yet comparable") for the
    // detector-pair path specifically, diverging from the edge-format path.
    // Unified onto the standard MAPE definition after an investigation
    // found the old guard could misclassify a fully-configured segment
    // with a genuine zero-speed interval as a false "Valid (Excellent)".
    assert.equal(calculateMapeError(0, 50), 100);
});

test('MAPE error: known case matches |sim-obs|/obs*100', () => {
    assert.equal(calculateMapeError(110, 100), 10);
});

test('MAPE status (detector-pair format): configuration states take priority over the error percentage', () => {
    assert.equal(getMapeStatus(false, 500, 2), 'Needs both detectors');
    assert.equal(getMapeStatus(true, 0, 2), 'Needs distance');
    assert.equal(getMapeStatus(true, 500, 10), 'Valid (Excellent)');
    assert.equal(getMapeStatus(true, 500, 15), 'Marginal (Acceptable)');
    assert.equal(getMapeStatus(true, 500, 15.01), 'Invalid');
});

test('REGRESSION: a fully-configured segment with a genuine zero-speed interval now correctly reports Invalid, not a false Valid (Excellent)', () => {
    // This is the exact scenario the earlier investigation found: hasBoth
    // and distance are both satisfied (segment IS fully configured), but
    // the average speed for this interval was genuinely 0 (e.g. both
    // detectors reporting real gridlock), so computeMapeSimulatedTravelTime
    // returns sim=0 — previously misread as "not yet comparable" (0% error,
    // status 'Valid (Excellent)') even though a real observed travel time
    // existed. It should now read as a real 100% miss.
    const hasBoth = true;
    const distance = 500; // fully configured — a real distance is entered
    const avgSpeed = 0;   // genuine zero-speed interval, not "missing data"
    const sim = computeMapeSimulatedTravelTime(hasBoth, distance, avgSpeed);
    assert.equal(sim, 0);

    const obs = 45; // a real observed travel time exists for this interval
    const errPct = calculateMapeError(sim, obs);
    assert.equal(errPct, 100);

    const status = getMapeStatus(hasBoth, distance, errPct);
    assert.equal(status, 'Invalid');
    assert.notEqual(status, 'Valid (Excellent)');
});

test('MAPE model status (detector-pair format): no rows reports "No data in this window"', () => {
    assert.equal(getMapeModelStatus(0, 0), 'No data in this window');
});

test('MAPE model status (detector-pair format): >=75% success rate is Success, else Needs Calibration', () => {
    assert.equal(getMapeModelStatus(3, 4), 'Success (Valid)');   // 75%
    assert.equal(getMapeModelStatus(2, 4), 'Needs Calibration'); // 50%
});

test('MAPE status: once a segment is configured, getMapeStatus delegates to the same threshold logic as getMapeStatusEdgeFormat (shared, not duplicated)', () => {
    for (const errPct of [0, 5, 10, 10.01, 15, 15.01, 100]) {
        assert.equal(getMapeStatus(true, 500, errPct), getMapeStatusEdgeFormat(errPct));
    }
});

test('MAPE status (edge format): same 10/15% thresholds, no configuration states', () => {
    assert.equal(getMapeStatusEdgeFormat(10), 'Valid (Excellent)');
    assert.equal(getMapeStatusEdgeFormat(15), 'Marginal (Acceptable)');
    assert.equal(getMapeStatusEdgeFormat(15.01), 'Invalid');
});

test('MAPE model status (edge format): division by zero total produces the pre-existing NaN-driven fallback, not a crash', () => {
    // Documents existing behavior rather than "fixing" it: with totalCount=0,
    // (0/0*100).toFixed(2) => "NaN%", parseFloat => NaN, NaN>=75 is false,
    // so it silently falls through to 'Needs Calibration' instead of the
    // detector-pair path's explicit "No data in this window".
    assert.equal(getMapeModelStatusEdgeFormat(0, 0), 'Needs Calibration');
});
