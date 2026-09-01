// Repeatable regression coverage for emissionsParser.js's pure parsing logic
// (previously this kind of check only ever existed as throwaway scratch
// scripts). Run with: node --test tests/
//
// emissionsParser.js used to be regex-based (parseEmissionsRegexPure); it is
// now a genuine hand-rolled XML tokenizer/parser (parseEmissionsXML, backed
// by parseXMLDocument — see tests/xmlTokenizer.test.js for tokenizer-level
// coverage). That rewrite changed how malformed files behave in one
// deliberate way: a missing closing tag used to silently drop the next
// record's data; the tree-based parser instead auto-repairs the nesting and
// keeps every record it saw, while still reporting the repair as a warning.
// See CLAUDE.md's History section for the full writeup.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEmissionsXML } = require('../emissionsParser.js');

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
    const result = parseEmissionsXML(SAMPLE_TRIPINFO, 600, 2);
    assert.equal(result.tripCount, 2);
    assert.equal(result.foundAnyEmissions, true);
    // bus: 832000mg -> 0.832kg -> /0.832 density = 1.0 liter exactly
    assert.equal(result.busFuel, 1);
    // passenger_car: 745000mg -> 0.745kg -> /0.745 density = 1.0 liter exactly
    assert.equal(result.otherFuel, 1);
});

test('bins trips into the correct interval by depart time', () => {
    const result = parseEmissionsXML(SAMPLE_TRIPINFO, 600, 2);
    // depart=0 -> bin 0, depart=650 -> bin 1 (600s bins)
    assert.equal(result.netBins[0].tripCount, 1);
    assert.equal(result.netBins[1].tripCount, 1);
});

test('clamps a trip departing after the last bin into the final bin', () => {
    const late = SAMPLE_TRIPINFO.replace('depart="650.00"', 'depart="99999.00"');
    const result = parseEmissionsXML(late, 600, 2);
    assert.equal(result.netBins[1].tripCount, 1);
});

test('reports zero trips and no emissions for an empty/invalid file', () => {
    const result = parseEmissionsXML('<tripinfos></tripinfos>', 600, 10);
    assert.equal(result.tripCount, 0);
    assert.equal(result.foundAnyEmissions, false);
});

test('flags trips present but emissions missing (device not enabled)', () => {
    const noEmissions = `<tripinfos><tripinfo id="veh0" depart="0" vType="bus" timeLoss="1" waitingCount="0" routeLength="1" duration="1"/></tripinfos>`;
    const result = parseEmissionsXML(noEmissions, 600, 10);
    assert.equal(result.tripCount, 1);
    assert.equal(result.foundAnyEmissions, false);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /none contained <emissions> data/i);
});

test('single-quoted attribute values parse identically to double-quoted ones', () => {
    const xml = `<tripinfos><tripinfo id='v0' depart='0' vType='bus' timeLoss='1' waitingCount='0' routeLength='10' duration='5'><emissions CO_abs='1' CO2_abs='1000' HC_abs='1' PMx_abs='1' NOx_abs='1' fuel_abs='800000'/></tripinfo></tripinfos>`;
    const result = parseEmissionsXML(xml, 600, 10);
    assert.equal(result.tripCount, 1);
    assert.equal(result.foundAnyEmissions, true);
    assert.deepEqual(result.warnings, []);
});

// ---------------------------------------------------------------------
// Malformed-file hardening (post-parse validation). Several of these were
// written against the old regex-based parser and have been updated to
// reflect the tree-based parser's deliberately different (and better)
// recovery behavior — see this file's header.
// ---------------------------------------------------------------------

test('malformed file: empty file surfaces a clear "no records" warning instead of silent zeros', () => {
    const result = parseEmissionsXML('', 600, 10);
    assert.equal(result.tripCount, 0);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /No <tripinfo> records could be parsed/);
});

test('malformed file: truncated mid-attribute now recovers the partial record instead of reporting zero, and flags the truncation', () => {
    // Previously (regex-based): the file had no complete <tripinfo>...</tripinfo>
    // or self-closing match at all, so this reported tripCount=0 with a generic
    // "no records" warning. The tree-based tokenizer instead recognizes the
    // opening <tripinfo> tag as soon as it sees it, captures whatever
    // attributes appeared before the file cut off, and reports the truncation
    // itself as a structural warning rather than silently returning zero.
    const truncated = '<?xml version="1.0"?><tripinfos><tripinfo id="v0" depart="0.00" vType="bus" time';
    const result = parseEmissionsXML(truncated, 600, 10);
    assert.equal(result.tripCount, 1);
    assert.equal(result.foundAnyEmissions, false);
    assert.ok(result.warnings.some(w => /Malformed XML structure.*truncated/.test(w)), `expected a truncation warning, got: ${JSON.stringify(result.warnings)}`);
});

test('malformed file: a BOM-prefixed / declared-UTF-16 file that is still valid ASCII-compatible text parses cleanly with no warnings', () => {
    // Documents that this particular "unexpected encoding" case is already
    // handled fine today — a leading BOM character and a UTF-16 encoding
    // declaration don't stop the parser from reading real content when the
    // bytes themselves are still plain text (e.g. re-saved by a text editor).
    const withBom = '﻿<?xml version="1.0" encoding="UTF-16"?><tripinfos><tripinfo id="v0" depart="0.00" vType="bus" timeLoss="1.00" waitingCount="0" routeLength="10" duration="5"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo></tripinfos>';
    const result = parseEmissionsXML(withBom, 600, 10);
    assert.equal(result.tripCount, 1);
    assert.equal(result.foundAnyEmissions, true);
    assert.deepEqual(result.warnings, []);
});

test('malformed file: a record missing both depart and timeLoss is counted as skipped, not silently dropped', () => {
    const xml = `<tripinfos>
        <tripinfo id="ok" depart="0" vType="bus" timeLoss="1" waitingCount="0" routeLength="10" duration="5"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo>
        <tripinfo id="broken" vType="bus" waitingCount="0" routeLength="10" duration="5"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo>
    </tripinfos>`;
    const result = parseEmissionsXML(xml, 600, 10);
    assert.equal(result.tripCount, 2);
    assert.equal(result.skippedRecords, 1);
    assert.ok(result.warnings.some(w => /missing both 'depart' and 'timeLoss'/.test(w)));
});

test('malformed file: a <tripinfo> missing its own closing tag is now fully recovered — both records are counted, and the nesting repair is reported as a warning', () => {
    // This used to document a real, confirmed regex bug: the old parser's
    // non-greedy `.*?` bridged past the unclosed tag to the next available
    // </tripinfo>, merging two records into one match and completely
    // dropping the second trip's own data — detected only via a tag-count
    // mismatch, not actually fixed. The tree-based tokenizer instead treats
    // the mismatched </tripinfo> at the point where the SECOND record closes
    // as a genuine close of that record, and then encounters </tripinfos> at
    // the end while the FIRST record's <tripinfo> is still open — at which
    // point it auto-repairs the nesting (closing v0) rather than losing
    // anything. Both v0 and v1's own data end up in the tree and are found
    // independently, with a warning describing the repair.
    const missingClose = `<tripinfos>
        <tripinfo id="v0" depart="0.00" vType="bus" timeLoss="1.00" waitingCount="0" routeLength="10.00" duration="5.00">
        <emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/>
        <tripinfo id="v1" depart="600.00" vType="passenger_car" timeLoss="2.00" waitingCount="0" routeLength="20.00" duration="10.00">
        <emissions CO_abs="2" CO2_abs="2000" HC_abs="2" PMx_abs="2" NOx_abs="2" fuel_abs="700000"/>
        </tripinfo>
    </tripinfos>`;
    const result = parseEmissionsXML(missingClose, 600, 10);

    assert.equal(result.tripCount, 2, 'both v0 and v1 should be recovered, not just one');
    assert.equal(result.skippedRecords, 0);
    assert.equal(result.foundAnyEmissions, true);
    // v0's CO2 (1000mg) + v1's CO2 (2000mg), both /1e6 -> 0.003kg total.
    // Nothing should have been silently dropped.
    assert.equal(result.netTotals.CO2, 0.003);

    assert.ok(result.warnings.some(w => /Malformed XML structure.*not closed.*auto-repaired/.test(w)), `expected an auto-repair warning, got: ${JSON.stringify(result.warnings)}`);
});

test('well-formed file with no malformation has zero warnings', () => {
    const xml = `<tripinfos>
        <tripinfo id="v0" depart="0" vType="bus" timeLoss="1" waitingCount="0" routeLength="10" duration="5"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo>
        <tripinfo id="v1" depart="600" vType="passenger_car" timeLoss="2" waitingCount="0" routeLength="20" duration="10"><emissions CO_abs="2" CO2_abs="2000" HC_abs="2" PMx_abs="2" NOx_abs="2" fuel_abs="700000"/></tripinfo>
    </tripinfos>`;
    const result = parseEmissionsXML(xml, 600, 10);
    assert.equal(result.tripCount, 2);
    assert.equal(result.skippedRecords, 0);
    assert.deepEqual(result.warnings, []);
});

test('self-closing <tripinfo .../> records (no separate closing tag needed) parse cleanly with no warnings', () => {
    const xml = `<tripinfos>
        <tripinfo id="v0" depart="0" vType="bus" timeLoss="1" waitingCount="0" routeLength="10" duration="5"/>
        <tripinfo id="v1" depart="600" vType="bus" timeLoss="2" waitingCount="0" routeLength="20" duration="10"/>
    </tripinfos>`;
    const result = parseEmissionsXML(xml, 600, 10);
    assert.equal(result.tripCount, 2);
    assert.deepEqual(result.warnings, ['Trips were found but none contained <emissions> data — make sure the emissions device was enabled in SUMO (--device.emissions.probability).']);
});

// ---------------------------------------------------------------------
// Additional malformed-file cases (broadening beyond the ones above): a
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
    const result = parseEmissionsXML(xml, 600, 10);
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
    const result = parseEmissionsXML(xml, 600, 10);
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
    const result = parseEmissionsXML(xml, 600, 10);
    const elapsedMs = Date.now() - start;

    assert.equal(result.tripCount, N);
    assert.equal(result.foundAnyEmissions, true);
    assert.deepEqual(result.warnings, []);
    assert.ok(elapsedMs < 5000, `expected no pathological slowdown on a single long line, took ${elapsedMs}ms`);
});
