// Pure GEH/MAPE formulas and status thresholds, extracted verbatim from
// App._buildGEHTables and App._renderMapeFromDetectorRaw (app.js) so they're
// unit-testable under Node — see tests/gehMape.test.js. No `this`, no DOM.

// GEH = sqrt( 2*(sim-obs)^2 / (sim+obs) ). Guards sim+obs === 0 (both zero)
// to avoid a 0/0 division — matches the original inline check exactly.
function calculateGEH(sim, obs) {
    if (sim + obs <= 0) return 0;
    return Math.sqrt(2 * Math.pow(sim - obs, 2) / (sim + obs));
}

// TAG Unit M3.1's own GEH thresholds are defined for HOURLY flows. This
// tool's raw counts are often shorter intervals (10-minute SUMO/survey
// bins by default) — applying the 5/10 thresholds directly to a 10-minute
// count is not the same check, because GEH scales roughly with sqrt(count):
// a 10-minute count run through the formula unchanged reads systematically
// LOWER (more optimistic) than the same relative deviation would at hourly
// volumes, by very roughly sqrt(60/10) = sqrt(6) ~= 2.4x. Scaling a raw
// count up to its hourly-equivalent rate (count * 60/intervalMinutes)
// before computing GEH corrects for this. Found and fixed as part of the
// JSALT manuscript's round-8 revision — see CLAUDE.md's History section.
function scaleToHourly(count, intervalMinutes) {
    if (!(intervalMinutes > 0)) return count;
    return count * (60 / intervalMinutes);
}

// GEH < 5 "Good fit", 5-10 "Marginal - investigate", >=10 "Poor fit -
// recalibrate". Renamed from the earlier "Valid (Excellent)" / "Marginal
// (Acceptable)" / "Invalid (Needs Calibration)": calling a 5-10 reading
// "Acceptable" directly contradicted the paper's own stated description of
// that band as "needs a closer look" — the old wording sent two different
// messages about the same number in the same sentence.
function getGEHStatus(geh) {
    if (geh < 5) return 'Good fit';
    if (geh < 10) return 'Marginal - investigate';
    return 'Poor fit - recalibrate';
}

// Per-detector rollup shown under each Validation card. This is this
// dashboard's OWN three-tier convention (>=85% "Good fit" rows -> Success,
// >=50% -> Needs Calibration, else Failed), not TAG M3.1's own criterion,
// which is a plain pass/fail at 85% with no middle tier — see
// getTagM3RollupStatus below for that one. Kept because it's more
// informative for a single detector than a binary pass/fail, but must not
// be presented as "the TAG criterion" — it only shares TAG's 85% cutoff at
// the top end. No visible rows at all (e.g. the "Show from/to" window
// excluded everything) is its own case.
function getGEHModelStatus(validCount, totalCount) {
    if (!totalCount) return 'No data in this window';
    if (validCount >= Math.ceil(totalCount * 0.85)) return 'Success (Valid)';
    if (validCount >= Math.ceil(totalCount * 0.5)) return 'Needs Calibration';
    return 'Failed — Major Calibration Required';
}

// TAG Unit M3.1's actual acceptability criterion, applied literally: a
// model is acceptable when GEH < 5 for more than 85% of cases. Binary, no
// middle tier — unlike getGEHModelStatus above. Intended to be called with
// validCount/totalCount POOLED ACROSS ALL DETECTORS (TAG's own criterion is
// stated at the level of the model, not one detector), where
// getGEHModelStatus above is normally called per single detector; the
// caller decides which counts to pass in, this function only applies the
// threshold.
function getTagM3RollupStatus(validCount, totalCount) {
    if (!totalCount) return 'No data';
    return validCount >= Math.ceil(totalCount * 0.85)
        ? 'Meets TAG M3.1 criterion (>85% of cases GEH < 5)'
        : 'Does not meet TAG M3.1 criterion (>85% of cases GEH < 5)';
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

// Signed mean percentage error — same formula as calculateMapeError but
// without the Math.abs, so a systematic under- or over-estimate is visible
// instead of being folded into an always-positive average. A MAPE of 10.74%
// could be eight intervals scattered evenly above and below observed, or
// eight intervals all 10.74% low; MAPE alone cannot distinguish these, MPE
// can. Same zero-observed guard as calculateMapeError.
function calculateMpe(sim, obs) {
    return obs > 0 ? (sim - obs) / obs * 100 : 0;
}

// <=10% Valid (Excellent) (fixed, not user-editable — a tighter internal
// distinction within the pass zone), <= acceptance band Marginal
// (Acceptable), > band Invalid. `bandPct` is the user-editable acceptance
// band that decides Invalid vs. not (UI default 15, after the DMRB/TAG
// Unit M3.1 journey-time validation criterion: modelled journey times
// within 15% of surveyed times, or one minute if that is larger, for more
// than 85% of routes — this function implements only the percentage part;
// the "or one minute" absolute floor is not yet applied, see CLAUDE.md).
// "Success rate" elsewhere counts every non-Invalid row, i.e. everything
// at or under this band — that is the number this function's second
// argument actually controls. Omitting bandPct preserves the original
// hardcoded 15% exactly.
function getMapeStatusEdgeFormat(errPct, bandPct) {
    const band = (bandPct > 0) ? bandPct : 15;
    const excellent = Math.min(10, band); // never let "Excellent" reach above a band tighter than 10%
    return errPct <= excellent ? 'Valid (Excellent)' : errPct <= band ? 'Marginal (Acceptable)' : 'Invalid';
}

// Detector-pair segments have two configuration states edge/meandata
// doesn't (no second detector yet, no distance entered) — those are
// checked first since they mean "not configured," not "failing
// calibration." Once configured, uses the same thresholds as edge format.
function getMapeStatus(hasBoth, distance, errPct, bandPct) {
    if (!hasBoth) return 'Needs both detectors';
    if (distance <= 0) return 'Needs distance';
    return getMapeStatusEdgeFormat(errPct, bandPct);
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
        calculateGEH, scaleToHourly, getGEHStatus, getGEHModelStatus, getTagM3RollupStatus,
        computeMapeAvgSpeed, computeMapeSimulatedTravelTime, calculateMapeError, calculateMpe,
        getMapeStatus, getMapeModelStatus,
        getMapeStatusEdgeFormat, getMapeModelStatusEdgeFormat
    };
}
