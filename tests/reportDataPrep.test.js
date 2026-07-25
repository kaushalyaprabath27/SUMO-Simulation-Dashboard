// Regression coverage for reportDataPrep.js — the pure data-shaping logic
// that feeds the PDF report's per-chart tables. The PDF rendering step
// itself (jsPDF/html2canvas calls in App.generateFullReport) is NOT covered
// here or anywhere in this test suite — see CLAUDE.md's Testing section for
// why a pixel/binary-output comparison wasn't attempted. Run with:
// node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const { fmtNum, tableFromChart } = require('../reportDataPrep.js');

// ---- fmtNum ----

test('fmtNum: null/undefined/empty string all become an em-dash', () => {
    assert.equal(fmtNum(null), '—');
    assert.equal(fmtNum(undefined), '—');
    assert.equal(fmtNum(''), '—');
});

test('fmtNum: values >=100 in magnitude round to whole numbers', () => {
    assert.equal(fmtNum(123.456), '123');
    assert.equal(fmtNum(-150.9), '-151');
    assert.equal(fmtNum(100), '100');
});

test('fmtNum: values under 100 in magnitude round to 2 decimal places', () => {
    assert.equal(fmtNum(12.3456), '12.35');
    assert.equal(fmtNum(0.005), '0.01');
    assert.equal(fmtNum(99.999), '100'); // rounds up to 100 exactly, past the >=100 branch boundary at input time
});

test('fmtNum: a non-numeric string passes through unchanged', () => {
    assert.equal(fmtNum('Success (Valid)'), 'Success (Valid)');
});

test('fmtNum: zero is formatted as a real number, not treated as "empty"', () => {
    assert.equal(fmtNum(0), '0');
});

// ---- tableFromChart ----

test('tableFromChart: builds headers from an empty leading column plus each dataset label', () => {
    const chart = {
        data: {
            labels: ['06:30', '06:40'],
            datasets: [{ label: 'Scenario A', data: [10, 20] }, { label: 'Scenario B', data: [15, 25] }]
        }
    };
    const { headers, rows } = tableFromChart(chart);
    assert.deepEqual(headers, ['', 'Scenario A', 'Scenario B']);
    assert.deepEqual(rows, [
        ['06:30', '10', '15'],
        ['06:40', '20', '25']
    ]);
});

test('tableFromChart: applies fmtNum formatting to every cell (large numbers rounded, small numbers to 2dp)', () => {
    const chart = {
        data: {
            labels: ['Row1'],
            datasets: [{ label: 'Big', data: [1234.5] }, { label: 'Small', data: [1.2345] }]
        }
    };
    const { rows } = tableFromChart(chart);
    assert.deepEqual(rows, [['Row1', '1235', '1.23']]);
});

test('tableFromChart: a chart with no datasets still returns a valid (empty-ish) table, not a throw', () => {
    const chart = { data: { labels: ['a', 'b'], datasets: [] } };
    const { headers, rows } = tableFromChart(chart);
    assert.deepEqual(headers, ['']);
    assert.deepEqual(rows, [['a'], ['b']]);
});

test('tableFromChart: a chart with no labels returns an empty rows array', () => {
    const chart = { data: { labels: [], datasets: [{ label: 'X', data: [] }] } };
    const { rows } = tableFromChart(chart);
    assert.deepEqual(rows, []);
});

test('tableFromChart: missing labels/datasets keys entirely (not just empty arrays) do not throw', () => {
    const chart = { data: {} };
    const { headers, rows } = tableFromChart(chart);
    assert.deepEqual(headers, ['']);
    assert.deepEqual(rows, []);
});

test('tableFromChart: a dataset missing its own label falls back to an empty string header, not "undefined"', () => {
    const chart = { data: { labels: ['a'], datasets: [{ data: [5] }] } };
    const { headers } = tableFromChart(chart);
    assert.deepEqual(headers, ['', '']);
});
