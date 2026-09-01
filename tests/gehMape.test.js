// Regression coverage for gehMape.js's GEH/MAPE formulas — the Validation
// and MAPE Validation tabs' core arithmetic. Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateGEH, scaleToHourly, getGEHStatus, getGEHModelStatus, getTagM3RollupStatus,
    computeMapeAvgSpeed, computeMapeSimulatedTravelTime, calculateMapeError, calculateMpe,
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

test('GEH status thresholds: <5 Good fit, <10 Marginal - investigate, >=10 Poor fit - recalibrate', () => {
    // Renamed from "Valid (Excellent)" / "Marginal (Acceptable)" /
    // "Invalid (Needs Calibration)": the old "Marginal (Acceptable)" wording
    // called a 5-10 reading "Acceptable" in the same breath as "Marginal",
    // contradicting the paper's own description of that band as needing a
    // closer look. See CLAUDE.md's History section.
    assert.equal(getGEHStatus(4.99), 'Good fit');
    assert.equal(getGEHStatus(5), 'Marginal - investigate');
    assert.equal(getGEHStatus(9.99), 'Marginal - investigate');
    assert.equal(getGEHStatus(10), 'Poor fit - recalibrate');
});

test('GEH hourly-equivalent scaling: regression case from the JSALT manuscript (observed 138 / simulated 99 over a 10-minute interval)', () => {
    // Raw GEH on the unscaled 10-minute counts:
    const rawGeh = calculateGEH(99, 138);
    assert.ok(Math.abs(rawGeh - 3.58) < 0.005, `raw GEH: got ${rawGeh}`);

    // Scaled to hourly-equivalent (x6, since 60/10=6) before computing GEH:
    const simHourly = scaleToHourly(99, 10);
    const obsHourly = scaleToHourly(138, 10);
    assert.equal(simHourly, 594);
    assert.equal(obsHourly, 828);
    const hourlyGeh = calculateGEH(simHourly, obsHourly);
    assert.ok(Math.abs(hourlyGeh - 8.78) < 0.005, `hourly-equivalent GEH: got ${hourlyGeh}`);

    // The two are genuinely different verdicts under the 5/10 thresholds:
    assert.equal(getGEHStatus(rawGeh), 'Good fit');               // 3.58 < 5
    assert.equal(getGEHStatus(hourlyGeh), 'Marginal - investigate'); // 8.78 is 5-10
});

test('scaleToHourly: an interval already at 60 minutes scales by exactly 1 (the double-scaling guard)', () => {
    // This is the exact interaction flagged during review: if the data has
    // already been aggregated into 60-minute bins (e.g. via the
    // "Interval (min)" aggregation control), the hourly-equivalent scaling
    // factor applied on top of that must be 1, not still 6 — otherwise a
    // 10-minute count that was summed into an hourly bin gets multiplied by
    // 6 a second time.
    assert.equal(scaleToHourly(600, 60), 600);
    assert.equal(scaleToHourly(100, 10), 600); // the un-aggregated case, for contrast: x6
});

test('scaleToHourly: a non-positive or missing interval length is a no-op rather than dividing by zero', () => {
    assert.equal(scaleToHourly(100, 0), 100);
    assert.equal(scaleToHourly(100, undefined), 100);
    assert.equal(scaleToHourly(100, -5), 100);
});

test('TAG M3.1 rollup: binary pass/fail at 85%, no middle tier (unlike the dashboard\'s own three-tier getGEHModelStatus)', () => {
    assert.equal(getTagM3RollupStatus(0, 0), 'No data');
    assert.equal(getTagM3RollupStatus(9, 10), 'Meets TAG M3.1 criterion (>85% of cases GEH < 5)');   // 90%
    assert.equal(getTagM3RollupStatus(8, 10), 'Does not meet TAG M3.1 criterion (>85% of cases GEH < 5)'); // 80% - below 85%, and getGEHModelStatus would still call this "Success (Valid)" at >=85%... but 80% is below even that, so both would agree here; see the next test for where they diverge
});

test('TAG M3.1 rollup vs. the dashboard\'s own rollup genuinely diverge in the 50-85% band', () => {
    // 60%: the dashboard's own three-tier convention calls this "Needs
    // Calibration" (a middle tier), not a flat failure. TAG M3.1 has no
    // such middle tier — it is either >85% or it is not.
    assert.equal(getGEHModelStatus(6, 10), 'Needs Calibration');
    assert.equal(getTagM3RollupStatus(6, 10), 'Does not meet TAG M3.1 criterion (>85% of cases GEH < 5)');
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

test('MAPE status (edge format): same 10/15% thresholds when no band is given, no configuration states', () => {
    assert.equal(getMapeStatusEdgeFormat(10), 'Valid (Excellent)');
    assert.equal(getMapeStatusEdgeFormat(15), 'Marginal (Acceptable)');
    assert.equal(getMapeStatusEdgeFormat(15.01), 'Invalid');
});

test('MAPE status (edge format): acceptance band is user-editable, default preserved when omitted', () => {
    // A tighter 10% band: Marginal now caps at 10% too (Excellent is
    // min(10, band)), Invalid starts just above it.
    assert.equal(getMapeStatusEdgeFormat(10, 10), 'Valid (Excellent)');
    assert.equal(getMapeStatusEdgeFormat(10.01, 10), 'Invalid');
    // A looser 20% band: Excellent still caps at 10 (not user-editable),
    // Marginal now extends out to 20.
    assert.equal(getMapeStatusEdgeFormat(15, 20), 'Marginal (Acceptable)');
    assert.equal(getMapeStatusEdgeFormat(20, 20), 'Marginal (Acceptable)');
    assert.equal(getMapeStatusEdgeFormat(20.01, 20), 'Invalid');
});

test('MPE (signed mean percentage error): same magnitude as MAPE but keeps its sign', () => {
    // sim below obs -> negative (under-estimate)
    assert.equal(calculateMpe(90, 100), -10);
    // sim above obs -> positive (over-estimate)
    assert.equal(calculateMpe(110, 100), 10);
    // zero observed -> 0, not Infinity/NaN, same guard as calculateMapeError
    assert.equal(calculateMpe(50, 0), 0);
});

test('MPE regression case from the JSALT manuscript: obs [38,45,40,36,53,35,32,32], sim [34,41,35,31,48,33,28,28] gives MAPE 10.74% and MPE -10.74% (all simulated below observed)', () => {
    const obs = [38, 45, 40, 36, 53, 35, 32, 32];
    const sim = [34, 41, 35, 31, 48, 33, 28, 28];
    const mapeValues = sim.map((s, i) => calculateMapeError(s, obs[i]));
    const mpeValues = sim.map((s, i) => calculateMpe(s, obs[i]));
    const mape = mapeValues.reduce((a, b) => a + b, 0) / mapeValues.length;
    const mpe = mpeValues.reduce((a, b) => a + b, 0) / mpeValues.length;
    assert.ok(Math.abs(mape - 10.74) < 0.01, `MAPE: got ${mape}`);
    assert.ok(Math.abs(mpe - (-10.74)) < 0.01, `MPE: got ${mpe}`);
    // Every single interval is an under-estimate, so MAPE and |MPE| match
    // exactly here — that is the specific case this test is checking for
    // (a one-directional bias is invisible in MAPE alone but obvious in MPE).
    assert.ok(mpeValues.every(v => v <= 0), 'every interval should be an under-estimate (sim < obs)');
});

test('MAPE model status (edge format): division by zero total produces the pre-existing NaN-driven fallback, not a crash', () => {
    // Documents existing behavior rather than "fixing" it: with totalCount=0,
    // (0/0*100).toFixed(2) => "NaN%", parseFloat => NaN, NaN>=75 is false,
    // so it silently falls through to 'Needs Calibration' instead of the
    // detector-pair path's explicit "No data in this window".
    assert.equal(getMapeModelStatusEdgeFormat(0, 0), 'Needs Calibration');
});
