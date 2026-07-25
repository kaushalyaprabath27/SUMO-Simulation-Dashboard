// Pure data-preparation helpers extracted from App.generateFullReport
// (app.js) — the PDF report generator itself is not unit-tested here (it
// drives jsPDF/html2canvas side effects and produces a binary/rendered
// output, not a value worth pixel-comparing), but these two functions are
// exactly the data-shaping logic that feeds the report's per-chart tables,
// and they're pure. No `this`, no DOM, no jsPDF. See
// tests/reportDataPrep.test.js.

// Formats a number for the report's compact data tables: blank/nullish
// values become an em-dash, non-numeric values pass through as-is, values
// >=100 in magnitude round to whole numbers, smaller values round to 2
// decimal places.
function fmtNum(v) {
    if (v === null || v === undefined || v === '') return '—';
    const n = Number(v);
    if (isNaN(n)) return String(v);
    return Math.abs(n) >= 100 ? Math.round(n).toString() : (Math.round(n * 100) / 100).toString();
}

// Turns a Chart.js chart's own data (labels + datasets) into a plain
// {headers, rows} table structure, the same numbers the chart displays,
// formatted via fmtNum. `chart` only needs the shape
// { data: { labels: [...], datasets: [{ label, data: [...] }, ...] } } —
// a real Chart.js instance satisfies this, but so does a plain object,
// which is what the tests construct.
function tableFromChart(chart) {
    const labels = chart.data.labels || [];
    const datasets = chart.data.datasets || [];
    const headers = [''].concat(datasets.map(ds => ds.label || ''));
    const rows = labels.map((lbl, i) => [lbl].concat(datasets.map(ds => fmtNum(ds.data[i]))));
    return { headers, rows };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { fmtNum, tableFromChart };
}
