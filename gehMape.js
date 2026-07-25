// Pure GEH/MAPE formulas and status thresholds, extracted verbatim from
// App._buildGEHTables and App._renderMapeFromDetectorRaw (app.js) so they're
// unit-testable under Node — see tests/gehMape.test.js. No `this`, no DOM.

// GEH = sqrt( 2*(sim-obs)^2 / (sim+obs) ). Guards sim+obs === 0 (both zero)
// to avoid a 0/0 division — matches the original inline check exactly.
function calculateGEH(sim, obs) {
    if (sim + obs <= 0) return 0;
    return Math.sqrt(2 * Math.pow(sim - obs, 2) / (sim + obs));
}

// <5 Valid (Excellent), <10 Marginal (Acceptable), >=10 Invalid (Needs Calibration).
function getGEHStatus(geh) {
    if (geh < 5) return 'Valid (Excellent)';
    if (geh < 10) return 'Marginal (Acceptable)';
    return 'Invalid (Needs Calibration)';
}

// Per-detector rollup shown under each Validation card. >=85% valid rows ->
// Success, >=50% -> Needs Calibration, else Failed. No visible rows at all
// (e.g. the "Show from/to" window excluded everything) is its own case.
function getGEHModelStatus(validCount, totalCount) {
    if (!totalCount) return 'No data in this window';
    if (validCount >= Math.ceil(totalCount * 0.85)) return 'Success (Valid)';
    if (validCount >= Math.ceil(totalCount * 0.5)) return 'Needs Calibration';
    return 'Failed — Major Calibration Required';
}

// A single detector only measures speed at one point, not travel time — MAPE
// estimates a segment's average speed from its two endpoint detectors,
// falling back to whichever single one is nonzero if only one has data.
function computeMapeAvgSpeed(speedFrom, speedTo) {
    return (speedFrom > 0 && speedTo > 0) ? (speedFrom + speedTo) / 2 : (speedFrom || speedTo);
}

// simulatedSeconds = round(distance / avgSpeed), or 0 if the segment isn't
// fully configured yet (missing a detector pair, no distance, or no speed).
function computeMapeSimulatedTravelTime(hasBoth, distance, avgSpeed) {
    return (hasBoth && distance > 0 && avgSpeed > 0) ? Math.round(distance / avgSpeed) : 0;
}

// MAPE % error = |sim-obs| / obs * 100 — the standard MAPE definition,
// undefined only when the observed (actual) value is zero. A zero
// simulated value is a normal data point meaning a 100% miss, not a
// special case. This was previously two diverging implementations (one of
// which also required sim>0, silently reporting 0% — "not yet comparable"
// — instead of a real 100% miss); unified onto this one after an
// investigation found the sim>0 guard could misclassify a fully-configured
// segment with a genuine zero-speed interval as a false "Valid (Excellent)"
// instead of correctly flagging it. See tests/gehMape.test.js for the
// specific regression case.
function calculateMapeError(sim, obs) {
    return obs > 0 ? Math.abs(sim - obs) / obs * 100 : 0;
}

// <=10% Valid (Excellent), <=15% Marginal (Acceptable), >15% Invalid.
// Shared by both call sites (detector-pair segments and raw edge/meandata)
// — the underlying threshold logic was always identical between the two;
// only the detector-pair path has extra pre-configuration states layered
// on top (see getMapeStatus below).
function getMapeStatusEdgeFormat(errPct) {
    return errPct <= 10 ? 'Valid (Excellent)' : errPct <= 15 ? 'Marginal (Acceptable)' : 'Invalid';
}

// Detector-pair segments have two configuration states edge/meandata
// doesn't (no second detector yet, no distance entered) — those are
// checked first since they mean "not configured," not "failing
// calibration." Once configured, uses the same thresholds as edge format.
function getMapeStatus(hasBoth, distance, errPct) {
    if (!hasBoth) return 'Needs both detectors';
    if (distance <= 0) return 'Needs distance';
    return getMapeStatusEdgeFormat(errPct);
}

// Per-segment rollup. Note this replicates the original's exact rounding
// behavior — the success rate is formatted to 2 decimals and re-parsed
// before the >=75% comparison (rather than compared as a raw float) — kept
// as-is per "don't touch calculation logic," not something introduced here.
function getMapeModelStatus(validCount, totalCount) {
    if (!totalCount) return 'No data in this window';
    const successRate = ((validCount / totalCount) * 100).toFixed(2) + '%';
    return parseFloat(successRate) >= 75 ? 'Success (Valid)' : 'Needs Calibration';
}

// Edge/meandata-format model-status rollup (App._renderMapeFromRaw). Still
// kept separate from getMapeModelStatus above — this one has no
// "No data in this window" guard on an empty interval list (a pre-existing,
// different quirk from the sim=0 divergence that was unified above; with
// totalCount=0 it silently produces "NaN%" -> NaN>=75 is false -> falls
// through to 'Needs Calibration'). Not touched here — out of scope for the
// MAPE-formula unification, which was specifically about the sim=0 case.
function getMapeModelStatusEdgeFormat(validCount, totalCount) {
    const successRate = ((validCount / totalCount) * 100).toFixed(2) + '%';
    return parseFloat(successRate) >= 75 ? 'Success (Valid)' : 'Needs Calibration';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateGEH, getGEHStatus, getGEHModelStatus,
        computeMapeAvgSpeed, computeMapeSimulatedTravelTime, calculateMapeError,
        getMapeStatus, getMapeModelStatus,
        getMapeStatusEdgeFormat, getMapeModelStatusEdgeFormat
    };
}
