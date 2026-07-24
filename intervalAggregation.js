// Pure interval-bucketing logic, extracted verbatim from
// App._aggregateRecordsByInterval (app.js) — combines raw per-interval SUMO
// output records into larger buckets when the user chooses a coarser
// interval than the data's own native size (Validation/MAPE's
// "Interval (min)" control). No `this`, no DOM — see
// tests/intervalAggregation.test.js.
//
// Records are grouped by keyFn (e.g. detector/edge id) first; within each
// group, records whose begin falls in the same bucket are summed
// (sumFields, e.g. vehicle counts) and/or averaged (avgFields, e.g. speed).
// Can only combine intervals into larger ones — the raw data's own
// granularity is the finest possible, there's nothing to subdivide.
function aggregateRecordsByInterval(records, keyFn, sumFields, avgFields, intervalSec) {
    const grouped = {};
    records.forEach(r => {
        const key = keyFn(r);
        if (key === null || key === undefined) return;
        (grouped[key] = grouped[key] || []).push(r);
    });

    const bucketedGrouped = {};
    const beginsSet = new Set();

    Object.keys(grouped).forEach(key => {
        const buckets = {};
        grouped[key].forEach(r => {
            const bucketStart = Math.floor(r.begin / intervalSec) * intervalSec;
            if (!buckets[bucketStart]) {
                buckets[bucketStart] = { begin: bucketStart, _count: 0 };
                sumFields.forEach(f => { buckets[bucketStart][f] = 0; });
                avgFields.forEach(f => { buckets[bucketStart][f] = 0; });
            }
            const b = buckets[bucketStart];
            b._count++;
            sumFields.forEach(f => { b[f] += (r[f] || 0); });
            avgFields.forEach(f => { b[f] += (r[f] || 0); });
        });
        const list = Object.values(buckets).map(b => {
            const out = { begin: b.begin };
            sumFields.forEach(f => { out[f] = b[f]; });
            avgFields.forEach(f => { out[f] = b._count ? b[f] / b._count : 0; });
            return out;
        }).sort((a, b) => a.begin - b.begin);
        bucketedGrouped[key] = list;
        list.forEach(r => beginsSet.add(r.begin));
    });

    return { grouped: bucketedGrouped, begins: Array.from(beginsSet).sort((a, b) => a - b) };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { aggregateRecordsByInterval };
}
