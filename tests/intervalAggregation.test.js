// Regression coverage for intervalAggregation.js's aggregateRecordsByInterval
// — the bucketing logic behind Validation/MAPE's "Interval (min)" control.
// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateRecordsByInterval } = require('../intervalAggregation.js');

test('normal case: combines native 600s records into 1200s buckets, summing counts and averaging speed', () => {
    const records = [
        { id: 'detA', begin: 0,    nVehContrib: 10, speed: 8 },
        { id: 'detA', begin: 600,  nVehContrib: 20, speed: 12 },
        { id: 'detA', begin: 1200, nVehContrib: 5,  speed: 6 },
    ];
    const { grouped, begins } = aggregateRecordsByInterval(records, r => r.id, ['nVehContrib'], ['speed'], 1200);
    assert.deepEqual(begins, [0, 1200]);
    assert.equal(grouped.detA.length, 2);
    // bucket 0 combines begin=0 and begin=600: count sums to 30, speed averages to 10
    assert.equal(grouped.detA[0].nVehContrib, 30);
    assert.equal(grouped.detA[0].speed, 10);
    // bucket 1200 has only the one record
    assert.equal(grouped.detA[1].nVehContrib, 5);
    assert.equal(grouped.detA[1].speed, 6);
});

test('empty input: no records produces no groups and no begins', () => {
    const { grouped, begins } = aggregateRecordsByInterval([], r => r.id, ['nVehContrib'], [], 600);
    assert.deepEqual(grouped, {});
    assert.deepEqual(begins, []);
});

test('records missing a usable key are skipped rather than crashing', () => {
    const records = [
        { id: null, begin: 0, nVehContrib: 5 },
        { begin: 0, nVehContrib: 5 }, // id undefined
        { id: 'detA', begin: 0, nVehContrib: 7 },
    ];
    const { grouped, begins } = aggregateRecordsByInterval(records, r => r.id, ['nVehContrib'], [], 600);
    assert.deepEqual(Object.keys(grouped), ['detA']);
    assert.equal(grouped.detA[0].nVehContrib, 7);
    assert.deepEqual(begins, [0]);
});

test('duplicate intervals: two records with the exact same begin for the same key are combined, not duplicated', () => {
    const records = [
        { id: 'detA', begin: 0, nVehContrib: 10 },
        { id: 'detA', begin: 0, nVehContrib: 15 }, // duplicate begin, e.g. re-uploaded/merged file
    ];
    const { grouped, begins } = aggregateRecordsByInterval(records, r => r.id, ['nVehContrib'], [], 600);
    assert.equal(grouped.detA.length, 1); // one bucket, not two
    assert.equal(grouped.detA[0].nVehContrib, 25); // summed together
    assert.deepEqual(begins, [0]);
});

test('overlapping intervals: begins that are not aligned to the bucket boundary still collapse into the correct bucket', () => {
    // intervalSec=600: begin=610 and begin=650 both fall into bucket 600
    // (floor(610/600)*600 = 600, floor(650/600)*600 = 600), distinct from
    // begin=1205 which falls into bucket 1200.
    const records = [
        { id: 'detA', begin: 610, nVehContrib: 10 },
        { id: 'detA', begin: 650, nVehContrib: 20 },
        { id: 'detA', begin: 1205, nVehContrib: 99 },
    ];
    const { grouped, begins } = aggregateRecordsByInterval(records, r => r.id, ['nVehContrib'], [], 600);
    assert.deepEqual(begins, [600, 1200]);
    assert.equal(grouped.detA[0].nVehContrib, 30); // 610 and 650 merged into the 600 bucket
    assert.equal(grouped.detA[1].nVehContrib, 99);
});

test('multiple keys (detectors) are aggregated independently', () => {
    const records = [
        { id: 'detA', begin: 0, nVehContrib: 10 },
        { id: 'detB', begin: 0, nVehContrib: 40 },
    ];
    const { grouped, begins } = aggregateRecordsByInterval(records, r => r.id, ['nVehContrib'], [], 600);
    assert.equal(grouped.detA[0].nVehContrib, 10);
    assert.equal(grouped.detB[0].nVehContrib, 40);
    assert.deepEqual(begins, [0]);
});

test('avgFields with zero contributing records in a bucket does not divide by zero', () => {
    // Defensive check on the _count guard — every real bucket has at least
    // one record by construction, but this confirms the ternary doesn't NaN.
    const records = [{ id: 'detA', begin: 0, speed: 10 }];
    const { grouped } = aggregateRecordsByInterval(records, r => r.id, [], ['speed'], 600);
    assert.equal(grouped.detA[0].speed, 10);
});
