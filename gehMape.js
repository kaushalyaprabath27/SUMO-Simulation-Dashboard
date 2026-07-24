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

// MAPE % error = |sim-obs| / obs * 100. Zero if either side is zero/missing
// (matches the original: a 0 observed or 0 simulated value can't produce a
// meaningful percentage, so it's treated as "not yet comparable" rather than
// Infinity or NaN).
function calculateMapeError(sim, obs) {
    return (obs > 0 && sim > 0) ? Math.abs(sim - obs) / obs * 100 : 0;
}

// <=10% Valid (Excellent), <=15% Marginal (Acceptable), >15% Invalid — but
// only once the segment actually has both detectors and a real distance;
// otherwise it's still being configured, not failing calibration.
function getMapeStatus(hasBoth, distance, errPct) {
    if (!hasBoth) return 'Needs both detectors';
    if (distance <= 0) return 'Needs distance';
    return errPct <= 10 ? 'Valid (Excellent)' : errPct <= 15 ? 'Marginal (Acceptable)' : 'Invalid';
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

// ---------------------------------------------------------------------
// Edge/meandata-format MAPE (App._renderMapeFromRaw) — a SEPARATE, pre-
// existing implementation from the detector-pair one above, extracted
// as-is rather than unified with it, because the two genuinely differ:
// this one has no `sim > 0` guard, so a segment that hasn't produced any
// simulated travel time yet (sim=0) with a real observed value reads as a
// literal 100% error instead of "not yet comparable." Also has no
// "No data in this window" / NaN guard on an empty interval list. Both
// discrepancies predate this extraction — noted, not changed, since the
// task here is testability, not reconciling two independent code paths.
// ---------------------------------------------------------------------
function calculateMapeErrorEdgeFormat(sim, obs) {
    return obs > 0 ? Math.abs(sim - obs) / obs * 100 : 0;
}

function getMapeStatusEdgeFormat(errPct) {
    return errPct <= 10 ? 'Valid (Excellent)' : errPct <= 15 ? 'Marginal (Acceptable)' : 'Invalid';
}

function getMapeModelStatusEdgeFormat(validCount, totalCount) {
    const successRate = ((validCount / totalCount) * 100).toFixed(2) + '%';
    return parseFloat(successRate) >= 75 ? 'Success (Valid)' : 'Needs Calibration';
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        calculateGEH, getGEHStatus, getGEHModelStatus,
        computeMapeAvgSpeed, computeMapeSimulatedTravelTime, calculateMapeError,
        getMapeStatus, getMapeModelStatus,
        calculateMapeErrorEdgeFormat, getMapeStatusEdgeFormat, getMapeModelStatusEdgeFormat
    };
}
