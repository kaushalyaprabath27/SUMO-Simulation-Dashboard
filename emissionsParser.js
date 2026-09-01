// Pure, side-effect-free tripinfo/emissions parser — shared between the main
// thread (app.js) and emissionsWorker.js via a plain <script>/importScripts
// include (no bundler in this project, so this file must stay dependency-free
// and must not reference `this`, `document`, `App`, or anything DOM-related).
//
// A genuine hand-rolled XML tokenizer/parser — NOT regex/string-pattern
// matching. parseXMLDocument() below scans the text one character at a time
// (using charCodeAt comparisons, not regex) to recognize tags, attributes,
// comments, processing instructions and CDATA, and builds a small generic
// element tree ({name, attrs, children}). parseEmissionsXML() then walks
// that tree for <tripinfo>/<emissions> elements instead of pattern-matching
// substrings out of the raw text. This replaced an earlier regex-based
// version (see CLAUDE.md's History section for why, and what specifically
// changed as a result — most notably, a malformed/unclosed <tripinfo> tag
// used to silently drop the next record's data; the real parser recovers
// that data instead of losing it, and reports the malformed nesting via
// parserWarnings rather than via a "some record must be missing" inference).

// ---------------------------------------------------------------------
// Generic XML tokenizer/parser (dependency-free, no regex).
// ---------------------------------------------------------------------

function isWhitespaceCode(c) {
    return c === 32 || c === 9 || c === 10 || c === 13; // space, tab, \n, \r
}

function isNameCharCode(c) {
    return (c >= 65 && c <= 90) ||  // A-Z
        (c >= 97 && c <= 122) ||    // a-z
        (c >= 48 && c <= 57) ||     // 0-9
        c === 95 || c === 45 || c === 46 || c === 58; // _ - . :
}

// Parses xmlText into a lightweight generic tree: { name, attrs, children }.
// The synthetic root's name is '#document'; its children are the file's
// top-level elements (normally just one, e.g. <tripinfos>).
//
// Lenient by design (SUMO output is sometimes truncated by a killed run, and
// this project has previously found real files with an unclosed <tripinfo>
// tag): a closing tag that doesn't match the innermost open element searches
// outward for the nearest ancestor with that name and auto-closes everything
// in between; anything still open at end-of-file is auto-closed too. Both
// recovery paths are recorded in the returned parserWarnings array rather
// than silently "fixed" with no trace, and neither one discards any element
// that was actually seen — every open tag encountered ends up somewhere in
// the tree, even if the nesting had to be repaired to get it there.
function parseXMLDocument(xmlText) {
    // Strip a leading BOM, if present.
    const src = (xmlText.length && xmlText.charCodeAt(0) === 0xFEFF) ? xmlText.slice(1) : xmlText;
    const len = src.length;
    let pos = 0;

    const root = { name: '#document', attrs: {}, children: [] };
    const stack = [root];
    const parserWarnings = [];

    function skipWhitespace() {
        while (pos < len && isWhitespaceCode(src.charCodeAt(pos))) pos++;
    }

    function readName() {
        const start = pos;
        while (pos < len && isNameCharCode(src.charCodeAt(pos))) pos++;
        return src.slice(start, pos);
    }

    // Reads attribute list up to and including the tag's closing '>' (or
    // '/>'). Returns { attrs, selfClosing }.
    function readAttrs() {
        const attrs = {};
        let selfClosing = false;
        while (pos < len) {
            skipWhitespace();
            if (pos >= len) break;
            const c = src.charCodeAt(pos);
            if (c === 47 /* / */) {
                if (src.charCodeAt(pos + 1) === 62 /* > */) {
                    selfClosing = true;
                    pos += 2;
                }
                else pos++; // stray '/', ignore
                break;
            }
            if (c === 62 /* > */) { pos++; break; }
            const name = readName();
            if (!name) { pos++; continue; } // unexpected char; skip to avoid an infinite loop
            skipWhitespace();
            let value = '';
            if (src.charCodeAt(pos) === 61 /* = */) {
                pos++;
                skipWhitespace();
                const quote = src.charCodeAt(pos);
                if (quote === 34 || quote === 39 /* " or ' */) {
                    pos++;
                    const start = pos;
                    while (pos < len && src.charCodeAt(pos) !== quote) pos++;
                    value = src.slice(start, pos);
                    pos++; // closing quote
                } else {
                    // Unquoted value — not valid XML, but tolerate it rather
                    // than getting stuck: read until whitespace, '>', or '/'
                    // (so "foo=bar/>" doesn't swallow the self-close marker).
                    const start = pos;
                    while (pos < len && !isWhitespaceCode(src.charCodeAt(pos)) && src.charCodeAt(pos) !== 62 && src.charCodeAt(pos) !== 47) pos++;
                    value = src.slice(start, pos);
                }
            }
            attrs[name] = value;
        }
        return { attrs, selfClosing };
    }

    while (pos < len) {
        // Advance to the next '<' (plain text content between tags is
        // irrelevant to this app's data, which lives entirely in attributes).
        while (pos < len && src.charCodeAt(pos) !== 60 /* < */) pos++;
        if (pos >= len) break;

        const next1 = src.charCodeAt(pos + 1);

        if (next1 === 63 /* ? */) { // <?xml ... ?>
            pos += 2;
            while (pos < len && !(src.charCodeAt(pos) === 63 && src.charCodeAt(pos + 1) === 62)) pos++;
            pos += 2;
            continue;
        }

        if (next1 === 33 /* ! */) {
            if (src.charCodeAt(pos + 2) === 45 && src.charCodeAt(pos + 3) === 45) { // <!--
                pos += 4;
                while (pos < len && !(src.charCodeAt(pos) === 45 && src.charCodeAt(pos + 1) === 45 && src.charCodeAt(pos + 2) === 62)) pos++;
                pos += 3;
                continue;
            }
            if (src.slice(pos + 2, pos + 8) === '[CDATA') { // <![CDATA[ ... ]]>
                pos += 9;
                while (pos < len && !(src.charCodeAt(pos) === 93 && src.charCodeAt(pos + 1) === 93 && src.charCodeAt(pos + 2) === 62)) pos++;
                pos += 3;
                continue;
            }
            // DOCTYPE or other declaration — skip to the next '>'.
            pos++;
            while (pos < len && src.charCodeAt(pos) !== 62) pos++;
            pos++;
            continue;
        }

        if (next1 === 47 /* / */) { // closing tag </name>
            pos += 2;
            const name = readName();
            skipWhitespace();
            if (src.charCodeAt(pos) === 62) pos++;

            let matchIdx = -1;
            for (let s = stack.length - 1; s >= 1; s--) {
                if (stack[s].name === name) { matchIdx = s; break; }
            }
            if (matchIdx === -1) {
                parserWarnings.push(`Unexpected closing tag </${name}> with no matching open tag — ignored.`);
            } else if (matchIdx < stack.length - 1) {
                parserWarnings.push(`<${stack[stack.length - 1].name}> was not closed before </${name}> appeared — the nesting was auto-repaired, no element was dropped.`);
                stack.length = matchIdx;
            } else {
                stack.pop();
            }
            continue;
        }

        // Opening tag (possibly self-closing).
        pos += 1;
        const name = readName();
        if (!name) { pos++; continue; } // stray '<', not a real tag start
        const { attrs, selfClosing } = readAttrs();
        const node = { name, attrs, children: [] };
        stack[stack.length - 1].children.push(node);
        if (!selfClosing) stack.push(node);
    }

    if (stack.length > 1) {
        parserWarnings.push(`Reached end of file with ${stack.length - 1} tag(s) still open (innermost: <${stack[stack.length - 1].name}>) — the file may be truncated. Auto-closed at end of file.`);
    }

    return { root, parserWarnings };
}

// Case-insensitive attribute lookup (SUMO's own output is consistently
// cased, but this stays defensive the way the previous regex version was).
function getAttrCI(attrs, name) {
    const lower = name.toLowerCase();
    for (const k in attrs) {
        if (k.toLowerCase() === lower) return attrs[k];
    }
    return null;
}

// Recursively collects every element in the tree named one of `names`
// (case-sensitive — SUMO's own tags are always exactly-cased), in document
// order, regardless of nesting depth. Used both for <tripinfo> elements
// (which should normally be direct children of <tripinfos>, but a malformed/
// auto-repaired file can leave one nested inside another — see this file's
// header) and, per-tripinfo, for its own <emission>/<emissions> child.
function collectByName(node, names, out) {
    if (names.indexOf(node.name) !== -1) out.push(node);
    for (const child of node.children) collectByName(child, names, out);
    return out;
}

function findDirectChild(node, names) {
    for (const child of node.children) {
        if (names.indexOf(child.name) !== -1) return child;
    }
    return null;
}

function parseEmissionsXML(xmlText, binDurSec, binCount) {
    const BIN_SEC = binDurSec > 0 ? binDurSec : 600;
    const BIN_COUNT = binCount > 0 ? binCount : 10;
    let netTotals = { CO: 0, CO2: 0, HC: 0, PMx: 0, NOx: 0, fuel: 0, timeLoss: 0, waitingCount: 0, routeLength: 0, duration: 0 };
    let netBins = Array(BIN_COUNT).fill(null).map(() => ({ CO: 0, CO2: 0, HC: 0, PMx: 0, NOx: 0, fuel: 0, timeLoss: 0, waitingCount: 0, tripCount: 0, routeLength: 0, duration: 0 }));

    let busFuel = 0;
    let busTripCount = 0;
    let busTimeLoss = 0;
    let otherFuel = 0; // Will only store petrol fuel now
    let otherFuelBreakdown = { motorcycle: 0, tuk_tuk: 0, passenger_car: 0, van: 0, truck: 0, other: 0 };
    let otherTripCountBreakdown = { motorcycle: 0, tuk_tuk: 0, passenger_car: 0, van: 0, truck: 0, other: 0 };
    let otherTimeLossBreakdown = { motorcycle: 0, tuk_tuk: 0, passenger_car: 0, van: 0, truck: 0, other: 0 };

    let foundAnyEmissions = false;
    let skippedRecords = 0;

    const { root, parserWarnings } = parseXMLDocument(xmlText);
    const tripNodes = collectByName(root, ['tripinfo'], []);
    const tripCount = tripNodes.length;

    tripNodes.forEach(node => {
        const attrs = node.attrs;
        const departStr = getAttrCI(attrs, 'depart');
        const vType = getAttrCI(attrs, 'vtype') || 'other';
        const timeLossStr = getAttrCI(attrs, 'timeloss');
        const waitingCountStr = getAttrCI(attrs, 'waitingcount');
        const routeLengthStr = getAttrCI(attrs, 'routelength');
        const durationStr = getAttrCI(attrs, 'duration');

        if (!departStr && !timeLossStr) { skippedRecords++; return; } // Safety check

        const depart = parseFloat(departStr) || 0;
        const timeLoss = parseFloat(timeLossStr) || 0;
        const waitingCount = parseInt(waitingCountStr) || 0;
        const routeLength = parseFloat(routeLengthStr) || 0;
        const duration = parseFloat(durationStr) || 0;
        const binIdx = Math.min(BIN_COUNT - 1, Math.floor(depart / BIN_SEC));

        // Per-vehicle type time loss tracking
        if (vType.toLowerCase().includes('bus')) {
            busTimeLoss += timeLoss;
        } else if (vType.toLowerCase().includes('truck')) {
            otherTimeLossBreakdown.truck += timeLoss;
        } else if (vType.toLowerCase().includes('van')) {
            otherTimeLossBreakdown.van += timeLoss;
        } else if (vType.toLowerCase().includes('motorcycle')) {
            otherTimeLossBreakdown.motorcycle += timeLoss;
        } else if (vType.toLowerCase().includes('tuk')) {
            otherTimeLossBreakdown.tuk_tuk += timeLoss;
        } else if (vType.toLowerCase().includes('passenger_car')) {
            otherTimeLossBreakdown.passenger_car += timeLoss;
        } else {
            otherTimeLossBreakdown.other += timeLoss;
        }

        // ALWAYS accumulate non-emissions data
        netTotals.timeLoss += timeLoss;
        netTotals.waitingCount += waitingCount;
        netTotals.routeLength += routeLength;
        netTotals.duration += duration;
        netBins[binIdx].timeLoss += timeLoss;
        netBins[binIdx].waitingCount += waitingCount;
        netBins[binIdx].tripCount += 1;
        netBins[binIdx].routeLength += routeLength;
        netBins[binIdx].duration += duration;

        // <emission>/<emissions> as a real child element, or (some SUMO
        // versions/devices) the same attributes flattened directly onto the
        // <tripinfo> tag itself.
        const emissionsNode = findDirectChild(node, ['emission', 'emissions']);
        const emissionsAttrs = emissionsNode ? emissionsNode.attrs : (getAttrCI(attrs, 'fuel_abs') !== null ? attrs : null);

        if (!emissionsAttrs) return;

        foundAnyEmissions = true;

        // SUMO outputs emissions and fuel in mg (milligrams). We need g and Liters.
        // mg -> g (divide by 1,000) for CO, HC, PMx, NOx
        // mg -> kg (divide by 1,000,000) for CO2
        const co = (parseFloat(getAttrCI(emissionsAttrs, 'CO_abs')) || 0) / 1000;
        const co2 = (parseFloat(getAttrCI(emissionsAttrs, 'CO2_abs')) || 0) / 1000000;
        const hc = (parseFloat(getAttrCI(emissionsAttrs, 'HC_abs')) || 0) / 1000;
        const pmx = (parseFloat(getAttrCI(emissionsAttrs, 'PMx_abs')) || 0) / 1000;
        const nox = (parseFloat(getAttrCI(emissionsAttrs, 'NOx_abs')) || 0) / 1000;

        // Fuel is in mg. Convert to kg, then divide by density to get Liters
        const fuel_mg = parseFloat(getAttrCI(emissionsAttrs, 'fuel_abs')) || 0;
        const fuel_kg = fuel_mg / 1000000;

        let fuel_liters = 0;
        if (vType.toLowerCase().includes('bus')) {
            fuel_liters = fuel_kg / 0.832;
            busFuel += fuel_liters;
            busTripCount += 1;
        } else if (vType.toLowerCase().includes('truck')) {
            fuel_liters = fuel_kg / 0.832;
            otherFuelBreakdown.truck += fuel_liters;
            otherTripCountBreakdown.truck += 1;
        } else if (vType.toLowerCase().includes('van')) {
            fuel_liters = fuel_kg / 0.832;
            otherFuelBreakdown.van += fuel_liters;
            otherTripCountBreakdown.van += 1;
        } else {
            fuel_liters = fuel_kg / 0.745;
            otherFuel += fuel_liters;

            if (vType.toLowerCase().includes('motorcycle')) {
                otherFuelBreakdown.motorcycle += fuel_liters;
                otherTripCountBreakdown.motorcycle += 1;
            }
            else if (vType.toLowerCase().includes('tuk')) {
                otherFuelBreakdown.tuk_tuk += fuel_liters;
                otherTripCountBreakdown.tuk_tuk += 1;
            }
            else if (vType.toLowerCase().includes('passenger_car')) {
                otherFuelBreakdown.passenger_car += fuel_liters;
                otherTripCountBreakdown.passenger_car += 1;
            }
            else {
                otherFuelBreakdown.other += fuel_liters;
                otherTripCountBreakdown.other += 1;
            }
        }

        netTotals.CO += co;
        netTotals.CO2 += co2;
        netTotals.HC += hc;
        netTotals.PMx += pmx;
        netTotals.NOx += nox;
        netTotals.fuel += fuel_liters;

        netBins[binIdx].CO += co;
        netBins[binIdx].CO2 += co2;
        netBins[binIdx].HC += hc;
        netBins[binIdx].PMx += pmx;
        netBins[binIdx].NOx += nox;
        netBins[binIdx].fuel += fuel_liters;
    });

    // No openTagCount/tagCountMismatch diagnostic here anymore (the earlier
    // regex-based version had one) — with this tree-based parser, every
    // opening <tripinfo> tag the tokenizer sees becomes a node somewhere in
    // the tree, and collectByName() walks every depth to find it, so that
    // count can no longer diverge from tripCount the way it could when a
    // malformed tag silently bridged past a regex match. See this file's
    // header and CLAUDE.md's History section for what that replaces.

    const warnings = [];
    if (tripCount === 0) {
        warnings.push('No <tripinfo> records could be parsed from this file — it may be empty, truncated, or not a SUMO tripinfo/emissions output file.');
    } else {
        if (skippedRecords > 0) {
            warnings.push(`${skippedRecords} of ${tripCount} matched record(s) were missing both 'depart' and 'timeLoss' and were skipped entirely.`);
        }
        if (!foundAnyEmissions) {
            warnings.push('Trips were found but none contained <emissions> data — make sure the emissions device was enabled in SUMO (--device.emissions.probability).');
        }
    }
    parserWarnings.forEach(msg => warnings.push(`Malformed XML structure: ${msg}`));

    return {
        netTotals, netBins, busFuel, busTripCount, busTimeLoss, otherFuel,
        otherFuelBreakdown, otherTripCountBreakdown, otherTimeLossBreakdown,
        tripCount, foundAnyEmissions, skippedRecords, warnings
    };
}

// Loaded via a plain <script> tag on the main thread (module.exports guarded
// for the case a bundler/Node context ever imports it instead).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseEmissionsXML, parseXMLDocument };
}
