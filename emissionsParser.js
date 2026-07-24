// Pure, side-effect-free tripinfo/emissions parser — shared between the main
// thread (app.js) and emissionsWorker.js via a plain <script>/importScripts
// include (no bundler in this project, so this file must stay dependency-free
// and must not reference `this`, `document`, `App`, or anything DOM-related).
//
// Regex-based rather than DOMParser-based on purpose: corridor-scale tripinfo
// output can be very large, and a single regex pass over the raw text avoids
// building a full DOM tree for a file that's read exactly once.
function parseEmissionsRegexPure(xmlText, binDurSec, binCount) {
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
    let tripCount = 0;
    let skippedRecords = 0;

    // More robust regex: extract all <tripinfo ...> ... </tripinfo> OR self-closing <tripinfo .../>
    // Using exec in a loop
    const tripRegex = /<tripinfo\s+([^>]*?)>(.*?)<\/tripinfo>|<tripinfo\s+([^>]*?)\/?>/gs;
    let match;

    const getAttr = (str, attr) => {
        const regex = new RegExp(`\\b${attr}="([^"]*)"`, 'i');
        const m = str.match(regex);
        return m ? m[1] : null;
    };

    while ((match = tripRegex.exec(xmlText)) !== null) {
        tripCount++;
        const attrs = match[1] || match[3] || '';
        const innerHtml = match[2] || '';

        const departStr = getAttr(attrs, 'depart');
        const vType = getAttr(attrs, 'vtype') || 'other';
        const timeLossStr = getAttr(attrs, 'timeloss');
        const waitingCountStr = getAttr(attrs, 'waitingcount');
        const routeLengthStr = getAttr(attrs, 'routeLength') || getAttr(attrs, 'routelength');
        const durationStr = getAttr(attrs, 'duration');

        if (!departStr && !timeLossStr) { skippedRecords++; continue; } // Safety check

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

        // Look for <emission .../> or <emissions .../> inside innerHtml OR inside the attributes if it was somehow flattened
        let emissionsStr = '';
        const eMatch = innerHtml.match(/<emissions?\s+([^>]*?)\/?>/i);
        if (eMatch) {
            emissionsStr = eMatch[1];
        } else {
            // Sometimes devices dump attributes directly into the tripinfo tag in older SUMO versions
            if (attrs.includes('fuel_abs')) {
                emissionsStr = attrs;
            }
        }

        if (!emissionsStr) continue;

        foundAnyEmissions = true;

        // SUMO outputs emissions and fuel in mg (milligrams). We need g and Liters.
        // mg -> g (divide by 1,000) for CO, HC, PMx, NOx
        // mg -> kg (divide by 1,000,000) for CO2
        const co = (parseFloat(getAttr(emissionsStr, 'CO_abs')) || 0) / 1000;
        const co2 = (parseFloat(getAttr(emissionsStr, 'CO2_abs')) || 0) / 1000000;
        const hc = (parseFloat(getAttr(emissionsStr, 'HC_abs')) || 0) / 1000;
        const pmx = (parseFloat(getAttr(emissionsStr, 'PMx_abs')) || 0) / 1000;
        const nox = (parseFloat(getAttr(emissionsStr, 'NOx_abs')) || 0) / 1000;

        // Fuel is in mg. Convert to kg, then divide by density to get Liters
        const fuel_mg = parseFloat(getAttr(emissionsStr, 'fuel_abs')) || 0;
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
    }

    // Post-parse validation: the regex above matches greedily/non-greedily
    // across the whole file, so a genuinely malformed file (e.g. a
    // <tripinfo> that's missing its own closing tag) can silently bridge
    // into a LATER <tripinfo>'s closing tag — swallowing that next record
    // entirely rather than raising any error. Comparing the number of
    // literal '<tripinfo' open-tag occurrences against how many complete
    // records actually got matched catches exactly this, without changing
    // the matching regex itself (kept deliberately as-is — see file header).
    const openTagCount = (xmlText.match(/<tripinfo[\s>]/gi) || []).length;
    const tagCountMismatch = openTagCount !== tripCount;

    const warnings = [];
    if (tripCount === 0) {
        warnings.push('No <tripinfo> records could be parsed from this file — it may be empty, truncated, or not a SUMO tripinfo/emissions output file.');
    } else {
        if (tagCountMismatch) {
            warnings.push(`Found ${openTagCount} '<tripinfo' tag(s) in the file but only matched ${tripCount} complete record(s) — the file may have an unclosed or malformed <tripinfo> tag, which can cause a record to be silently dropped or merged with the next one. Results may be incomplete.`);
        }
        if (skippedRecords > 0) {
            warnings.push(`${skippedRecords} of ${tripCount} matched record(s) were missing both 'depart' and 'timeLoss' and were skipped entirely.`);
        }
        if (!foundAnyEmissions) {
            warnings.push('Trips were found but none contained <emissions> data — make sure the emissions device was enabled in SUMO (--device.emissions.probability).');
        }
    }

    return {
        netTotals, netBins, busFuel, busTripCount, busTimeLoss, otherFuel,
        otherFuelBreakdown, otherTripCountBreakdown, otherTimeLossBreakdown,
        tripCount, foundAnyEmissions, skippedRecords, openTagCount, tagCountMismatch, warnings
    };
}

// Loaded via a plain <script> tag on the main thread (module.exports guarded
// for the case a bundler/Node context ever imports it instead).
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseEmissionsRegexPure };
}
