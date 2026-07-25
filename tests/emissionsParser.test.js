// Repeatable regression coverage for emissionsParser.js's pure parsing logic
// (previously this kind of check only ever existed as throwaway scratch
// scripts). Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmissionsRegexPure } = require('../emissionsParser.js');

const SAMPLE_TRIPINFO = `<?xml version="1.0"?>
<tripinfos>
    <tripinfo id="veh0" depart="0.00" vType="bus" timeLoss="12.00" waitingCount="1" routeLength="500.00" duration="60.00">
        <emissions CO_abs="1000" CO2_abs="2000000" HC_abs="50" PMx_abs="20" NOx_abs="300" fuel_abs="832000"/>
    </tripinfo>
    <tripinfo id="veh1" depart="650.00" vType="passenger_car" timeLoss="5.00" waitingCount="0" routeLength="400.00" duration="40.00">
        <emissions CO_abs="500" CO2_abs="1000000" HC_abs="25" PMx_abs="10" NOx_abs="150" fuel_abs="745000"/>
    </tripinfo>
</tripinfos>`;

test('parses trip count and per-vehicle-type fuel density correctly', () => {
    const result = parseEmissionsRegexPure(SAMPLE_TRIPINFO, 600, 2);
    assert.equal(result.tripCount, 2);
    assert.equal(result.foundAnyEmissions, true);
    // bus: 832000mg -> 0.832kg -> /0.832 density = 1.0 liter exactly
    assert.equal(result.busFuel, 1);
    // passenger_car: 745000mg -> 0.745kg -> /0.745 density = 1.0 liter exactly
    assert.equal(result.otherFuel, 1);
});

test('bins trips into the correct interval by depart time', () => {
    const result = parseEmissionsRegexPure(SAMPLE_TRIPINFO, 600, 2);
    // depart=0 -> bin 0, depart=650 -> bin 1 (600s bins)
    assert.equal(result.netBins[0].tripCount, 1);
    assert.equal(result.netBins[1].tripCount, 1);
});

test('clamps a trip departing after the last bin into the final bin', () => {
    const late = SAMPLE_TRIPINFO.replace('depart="650.00"', 'depart="99999.00"');
    const result = parseEmissionsRegexPure(late, 600, 2);
    assert.equal(result.netBins[1].tripCount, 1);
});

test('reports zero trips and no emissions for an empty/invalid file', () => {
    const result = parseEmissionsRegexPure('<tripinfos></tripinfos>', 600, 10);
    assert.equal(result.tripCount, 0);
    assert.equal(result.foundAnyEmissions, false);
});

test('flags trips present but emissions missing (device not enabled)', () => {
    const noEmissions = `<tripinfos><tripinfo id="veh0" depart="0" vType="bus" timeLoss="1" waitingCount="0" routeLength="1" duration="1"/></tripinfos>`;
    const result = parseEmissionsRegexPure(noEmissions, 600, 10);
    assert.equal(result.tripCount, 1);
    assert.equal(result.foundAnyEmissions, false);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /none contained <emissions> data/i);
});

// ---------------------------------------------------------------------
// Malformed-file hardening (post-parse validation, added without changing
// the regex matching itself — see emissionsParser.js's header comment).
// ---------------------------------------------------------------------

test('malformed file: empty file surfaces a clear "no records" warning instead of silent zeros', () => {
    const result = parseEmissionsRegexPure('', 600, 10);
    assert.equal(result.tripCount, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /No <tripinfo> records could be parsed/);
});

test('malformed file: truncated mid-attribute (no complete tag at all) also surfaces the "no records" warning', () => {
    const truncated = '<?xml version="1.0"?><tripinfos><tripinfo id="v0" depart="0.00" vType="bus" time';
    const result = parseEmissionsRegexPure(truncated, 600, 10);
    assert.equal(result.tripCount, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /No <tripinfo> records could be parsed/);
});

test('malformed file: a BOM-prefixed / declared-UTF-16 file that is still valid ASCII-compatible text parses cleanly with no warnings', () => {
    // Documents that this particular "unexpected encoding" case is already
    // handled fine today — a leading BOM character and a UTF-16 encoding
    // declaration don't stop the regex from matching real content when the
    // bytes themselves are still plain text (e.g. re-saved by a text editor).
    const withBom = '﻿<?xml version="1.0" encoding="UTF-16"?><tripinfos><tripinfo id="v0" depart="0.00" vType="bus" timeLoss="1.00" waitingCount="0" routeLength="10" duration="5"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo></tripinfos>';
    const result = parseEmissionsRegexPure(withBom, 600, 10);
    assert.equal(result.tripCount, 1);
    assert.equal(result.foundAnyEmissions, true);
    assert.deepEqual(result.warnings, []);
});

test('malformed file: a record missing both depart and timeLoss is counted as skipped, not silently dropped', () => {
    const xml = `<tripinfos>
        <tripinfo id="ok" depart="0" vType="bus" timeLoss="1" waitingCount="0" routeLength="10" duration="5"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo>
        <tripinfo id="broken" vType="bus" waitingCount="0" routeLength="10" duration="5"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo>
    </tripinfos>`;
    const result = parseEmissionsRegexPure(xml, 600, 10);
    assert.equal(result.tripCount, 2);
    assert.equal(result.skippedRecords, 1);
    assert.ok(result.warnings.some(w => /missing both 'depart' and 'timeLoss'/.test(w)));
});

test('malformed file: a <tripinfo> missing its own closing tag silently swallows the NEXT record — now flagged via a tag-count mismatch warning', () => {
    // This documents a real, confirmed pre-existing behavior: the regex's
    // non-greedy `.*?` bridges past the unclosed tag to the next available
    // </tripinfo>, merging two records into one match and completely
    // dropping the second trip's own data. That parsing behavior is left
    // exactly as it was (per instructions: keep the regex approach, don't
    // touch the matching logic) — what's new is that this is now DETECTED
    // and surfaced instead of returning an incomplete result with no warning.
    const missingClose = `<tripinfos>
        <tripinfo id="v0" depart="0.00" vType="bus" timeLoss="1.00" waitingCount="0" routeLength="10.00" duration="5.00">
        <emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/>
        <tripinfo id="v1" depart="600.00" vType="passenger_car" timeLoss="2.00" waitingCount="0" routeLength="20.00" duration="10.00">
        <emissions CO_abs="2" CO2_abs="2000" HC_abs="2" PMx_abs="2" NOx_abs="2" fuel_abs="700000"/>
        </tripinfo>
    </tripinfos>`;
    const result = parseEmissionsRegexPure(missingClose, 600, 10);

    // Confirms the swallow actually happens (2 opening tags in the raw text,
    // but only 1 complete record matched, and v1's own CO2 contribution of
    // 2000mg / 1e6 = 0.002kg never shows up in totals).
    assert.equal(result.openTagCount, 2);
    assert.equal(result.tripCount, 1);
    assert.equal(result.tagCountMismatch, true);
    assert.ok(result.netTotals.CO2 < 0.002, 'v1 should have been swallowed, not counted');

    // The gap is now surfaced rather than silent.
    assert.ok(result.warnings.some(w => /unclosed or malformed <tripinfo> tag/.test(w)));
});

test('well-formed file with no malformation has zero warnings and no false-positive tag mismatch', () => {
    const xml = `<tripinfos>
        <tripinfo id="v0" depart="0" vType="bus" timeLoss="1" waitingCount="0" routeLength="10" duration="5"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo>
        <tripinfo id="v1" depart="600" vType="passenger_car" timeLoss="2" waitingCount="0" routeLength="20" duration="10"><emissions CO_abs="2" CO2_abs="2000" HC_abs="2" PMx_abs="2" NOx_abs="2" fuel_abs="700000"/></tripinfo>
    </tripinfos>`;
    const result = parseEmissionsRegexPure(xml, 600, 10);
    assert.equal(result.tripCount, 2);
    assert.equal(result.openTagCount, 2);
    assert.equal(result.tagCountMismatch, false);
    assert.equal(result.skippedRecords, 0);
    assert.deepEqual(result.warnings, []);
});

test('self-closing <tripinfo .../> records (no separate closing tag needed) are not flagged as a mismatch', () => {
    const xml = `<tripinfos>
        <tripinfo id="v0" depart="0" vType="bus" timeLoss="1" waitingCount="0" routeLength="10" duration="5"/>
        <tripinfo id="v1" depart="600" vType="bus" timeLoss="2" waitingCount="0" routeLength="20" duration="10"/>
    </tripinfos>`;
    const result = parseEmissionsRegexPure(xml, 600, 10);
    assert.equal(result.tripCount, 2);
    assert.equal(result.tagCountMismatch, false);
});

// ---------------------------------------------------------------------
// Additional malformed-file cases (broadening beyond the 7 above): a
// non-UTF-8 source misread as UTF-8, mixed Windows/Unix line endings, and
// one pathologically long line. None of these turned out to be a gap —
// documented here as passing regression tests, not bug reports.
// ---------------------------------------------------------------------

test('malformed file: bytes from a non-UTF-8 encoding (misread as UTF-8, producing mojibake) do not disrupt tag matching', () => {
    // Simulates what happens if a file wasn't actually UTF-8 (e.g. saved as
    // Windows-1252/Latin-1 with an accented comment) and got decoded as UTF-8
    // anyway, the way FileReader.readAsText() would with no encoding hint.
    // The mojibake lands inside an XML comment, well away from any
    // <tripinfo>/<emissions> tag or attribute — which are pure ASCII by
    // construction in SUMO's own output — so it has no effect on parsing.
    const latin1Bytes = Buffer.from('<!-- Café, région, note dépôt -->', 'latin1');
    const mojibakeComment = latin1Bytes.toString('utf8');
    const xml = `<?xml version="1.0"?><tripinfos>${mojibakeComment}<tripinfo id="v0" depart="0.00" vType="bus" timeLoss="1.00" waitingCount="0" routeLength="10.00" duration="5.00"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo></tripinfos>`;
    const result = parseEmissionsRegexPure(xml, 600, 10);
    assert.equal(result.tripCount, 1);
    assert.equal(result.foundAnyEmissions, true);
    assert.deepEqual(result.warnings, []);
});

test('malformed file: mixed Windows (\\r\\n) and Unix (\\n) line endings within the same file parse identically to a clean file', () => {
    const xml = '<?xml version="1.0"?>\r\n<tripinfos>\n' +
        '<tripinfo id="v0" depart="0.00" vType="bus" timeLoss="1.00" waitingCount="0" routeLength="10.00" duration="5.00">\r\n' +
        '<emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/>\n</tripinfo>\r\n' +
        '<tripinfo id="v1" depart="600.00" vType="bus" timeLoss="2.00" waitingCount="0" routeLength="20.00" duration="10.00">\n' +
        '<emissions CO_abs="2" CO2_abs="2000" HC_abs="2" PMx_abs="2" NOx_abs="2" fuel_abs="700000"/>\r\n</tripinfo>\n</tripinfos>';
    const result = parseEmissionsRegexPure(xml, 600, 10);
    assert.equal(result.tripCount, 2);
    assert.equal(result.foundAnyEmissions, true);
    assert.equal(result.netTotals.CO2, 0.003); // (1000+2000)mg / 1e6
    assert.deepEqual(result.warnings, []);
});

test('malformed file: one pathologically long line with no line breaks at all parses correctly and stays fast', () => {
    let xml = '<?xml version="1.0"?><tripinfos>';
    const N = 20000;
    for (let i = 0; i < N; i++) {
        xml += `<tripinfo id="v${i}" depart="${i % 5000}.00" vType="bus" timeLoss="1.00" waitingCount="0" routeLength="10.00" duration="5.00"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo>`;
    }
    xml += '</tripinfos>';
    assert.equal(xml.includes('\n'), false); // confirm the test actually constructed one unbroken line

    const start = Date.now();
    const result = parseEmissionsRegexPure(xml, 600, 10);
    const elapsedMs = Date.now() - start;

    assert.equal(result.tripCount, N);
    assert.equal(result.foundAnyEmissions, true);
    assert.deepEqual(result.warnings, []);
    assert.ok(elapsedMs < 5000, `expected no pathological slowdown on a single long line, took ${elapsedMs}ms`);
});
