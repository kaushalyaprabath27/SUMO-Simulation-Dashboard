// PDF-generation smoke test for App.generateFullReport (app.js).
//
// NOT a pixel/rendering comparison — generateFullReport drives jsPDF,
// Chart.js canvases, and (for the MAPE section) html2canvas, none of which
// exist under plain Node, so this can't run inside `node --test` like the
// rest of tests/*.test.js. Instead this launches a real Electron window
// (the same technique used throughout this project's manual verification
// passes — see CLAUDE.md's Testing section) and checks two things without
// ever comparing pixels:
//   1. generateFullReport() completes without throwing, for both an empty
//      ("minimal") project state and a populated ("realistic") one.
//   2. The PDF's own text-drawing calls were actually made with the
//      expected section headings (and, for the realistic case, real
//      data-derived values), and the final PDF byte output is non-empty.
//
// jsPDF's own `.save()` normally triggers a browser/OS download prompt —
// unsuitable for an automated check — so this wraps the `jsPDF` constructor
// for the duration of the call, intercepting each real instance's own
// `.text()`/`.save()` methods right after construction (jsPDF assigns these
// as own-instance properties via its plugin/API system, not shared
// prototype methods, so patching `jsPDF.prototype` directly has no effect —
// confirmed by testing that approach first and finding it silently
// intercepted nothing). `.save()` is replaced to capture the output instead
// of downloading it; the constructor is restored afterward either way.
//
// Run with: npm run test:pdf-smoke  (requires a real window; see the
// ELECTRON_RUN_AS_NODE note in CLAUDE.md if that variable is set in your
// shell — it forces Electron into plain-Node mode and this test needs a
// real Chromium renderer).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const PROJECT_ROOT = path.join(__dirname, '..', '..');

const REQUIRED_HEADINGS = [
    'SUMO Simulation Analysis Report',
    'Simulation Results',
    'Validation (GEH)',
    'MAPE Validation',
    'Emissions Analysis',
    'Dwell Time Analysis'
];

let failures = 0;
function check(label, cond) {
    if (cond) {
        console.log('PASS: ' + label);
    } else {
        console.log('FAIL: ' + label);
        failures++;
    }
}

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 1200, height: 800, show: false,
        webPreferences: {
            preload: path.join(PROJECT_ROOT, 'preload.js'),
            contextIsolation: true, nodeIntegration: false,
            partition: 'sumo-pdf-smoke-test'
        }
    });
    win.webContents.on('console-message', (e, l, m) => { if (/error/i.test(l) || /Error/.test(m)) console.log('[RENDERER]', m); });
    win.loadFile(path.join(PROJECT_ROOT, 'index.html'));
    await new Promise(r => win.webContents.once('did-finish-load', r));

    let waited = 0;
    while (waited < 20000) {
        const ready = await win.webContents.executeJavaScript(`typeof App !== 'undefined' && typeof App.generateFullReport === 'function' && typeof window.jspdf !== 'undefined'`).catch(() => false);
        if (ready) break;
        await new Promise(r => setTimeout(r, 100));
        waited += 100;
    }

    try {
        // ---- Case A: minimal (fresh, empty) project state ----
        const minimal = await win.webContents.executeJavaScript(`
            (async () => {
                // jsPDF assigns .text/.save as OWN instance properties (a
                // plugin/API pattern), not shared prototype methods —
                // patching jsPDF.prototype directly has no effect on real
                // instances. Instead, wrap the constructor itself so each
                // newly-created instance's own methods get wrapped right
                // after construction, before app.js ever touches them.
                const capturedTexts = [];
                let capturedBytes = null;
                const OriginalJsPDF = jspdf.jsPDF;
                jspdf.jsPDF = function(...args) {
                    const instance = new OriginalJsPDF(...args);
                    const origInstText = instance.text.bind(instance);
                    instance.text = function(text) {
                        if (Array.isArray(text)) capturedTexts.push(...text); else capturedTexts.push(String(text));
                        return origInstText.apply(instance, arguments);
                    };
                    // Do NOT call the original .save() — that would trigger a real download.
                    instance.save = function() {
                        capturedBytes = instance.output('arraybuffer');
                    };
                    return instance;
                };

                // generateFullReport has its OWN internal try/catch that
                // swallows errors and just shows a toast — spy on showToast
                // to see the real failure instead of a false "didn't throw".
                let internalError = null;
                const origToast = App.showToast.bind(App);
                App.showToast = (msg, type) => { if (type === 'error') internalError = msg; return origToast(msg, type); };

                let threw = null;
                try {
                    await App.generateFullReport();
                } catch (e) {
                    threw = e.message + '\\n' + (e.stack || '');
                }
                App.showToast = origToast;
                jspdf.jsPDF = OriginalJsPDF;

                return {
                    threw,
                    internalError,
                    byteLength: capturedBytes ? capturedBytes.byteLength : 0,
                    capturedTexts
                };
            })()
        `);
        check('minimal dataset: generateFullReport does not throw', minimal.threw === null && !minimal.internalError);
        if (minimal.internalError) console.log('  internal error: ' + minimal.internalError);
        if (minimal.threw) console.log('  error: ' + minimal.threw);
        check('minimal dataset: produced non-empty PDF output', minimal.byteLength > 0);
        for (const heading of REQUIRED_HEADINGS) {
            check(`minimal dataset: contains heading "${heading}"`, minimal.capturedTexts.includes(heading));
        }
        check('minimal dataset: contains a "no data yet" note for an empty section',
            minimal.capturedTexts.some(t => /has been run yet|has been uploaded yet/.test(t)));

        // ---- Case B: realistic (populated) project state ----
        const realistic = await win.webContents.executeJavaScript(`
            (async () => {
                // Simulation Results: real tripinfo + summary XML.
                const tripinfo = '<tripinfos>' +
                    '<tripinfo id="v0" depart="0" duration="120" waitingTime="5" timeLoss="8" routeLength="1200" vType="passenger_car"/>' +
                    '<tripinfo id="v1" depart="30" duration="90" waitingTime="2" timeLoss="4" routeLength="900" vType="bus"/>' +
                    '</tripinfos>';
                const summary = '<summary>' +
                    '<step time="0" meanSpeed="8.0" teleports="0" collisions="0" loaded="2" running="2" waiting="0"/>' +
                    '<step time="60" meanSpeed="9.5" teleports="0" collisions="0" loaded="2" running="1" waiting="0"/>' +
                    '</summary>';
                App._processSimResults(tripinfo, summary);

                // Validation (GEH): real detector interval records.
                App._lastGEHRawData = [
                    { id: 'det_realistic_1', begin: 0, nVehContrib: 42 },
                    { id: 'det_realistic_1', begin: 600, nVehContrib: 55 }
                ];
                App.observedGEH = { det_realistic_1: { 0: 40, 1: 50 } };

                // Emissions Analysis: drives window.chart1 via the real async path.
                const emissionsXml = '<?xml version="1.0"?><tripinfos><tripinfo id="e0" depart="0.00" vType="bus" timeLoss="1.00" waitingCount="0" routeLength="10.00" duration="5.00"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo></tripinfos>';
                await App._autoPopulateEmissions(emissionsXml);

                // Dwell Time Analysis: drives window.chartDwellTimeloss via a real file-input flow.
                function injectFile(inputId, filename, content) {
                    const input = document.getElementById(inputId);
                    const file = new File([content], filename, { type: 'text/xml' });
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    input.files = dt.files;
                }
                const dwellXml = (t) => '<?xml version="1.0"?><tripinfos><tripinfo id="d' + t + '" depart="0.00" vType="bus" timeLoss="' + t + '.00" waitingCount="0" routeLength="10.00" duration="5.00"><emissions CO_abs="1" CO2_abs="1000" HC_abs="1" PMx_abs="1" NOx_abs="1" fuel_abs="800000"/></tripinfo></tripinfos>';
                injectFile('dwell-file-0', 'd0.xml', dwellXml(1));
                injectFile('dwell-file-10', 'd10.xml', dwellXml(2));
                injectFile('dwell-file-20', 'd20.xml', dwellXml(3));
                injectFile('dwell-file-45', 'd45.xml', dwellXml(4));
                injectFile('dwell-file-90', 'd90.xml', dwellXml(5));
                await App.handleDwellParse();

                const capturedTexts = [];
                let capturedBytes = null;
                const OriginalJsPDF = jspdf.jsPDF;
                jspdf.jsPDF = function(...args) {
                    const instance = new OriginalJsPDF(...args);
                    const origInstText = instance.text.bind(instance);
                    instance.text = function(text) {
                        if (Array.isArray(text)) capturedTexts.push(...text); else capturedTexts.push(String(text));
                        return origInstText.apply(instance, arguments);
                    };
                    instance.save = function() {
                        capturedBytes = instance.output('arraybuffer');
                    };
                    return instance;
                };

                let internalError = null;
                const origToast = App.showToast.bind(App);
                App.showToast = (msg, type) => { if (type === 'error') internalError = msg; return origToast(msg, type); };

                let threw = null;
                try {
                    await App.generateFullReport();
                } catch (e) {
                    threw = e.message + '\\n' + (e.stack || '');
                }
                App.showToast = origToast;
                jspdf.jsPDF = OriginalJsPDF;

                return {
                    threw,
                    internalError,
                    byteLength: capturedBytes ? capturedBytes.byteLength : 0,
                    capturedTexts,
                    hasChart1: !!window.chart1,
                    hasChartDwellTimeloss: !!window.chartDwellTimeloss
                };
            })()
        `);
        check('realistic dataset: emissions chart (window.chart1) was actually created', realistic.hasChart1);
        check('realistic dataset: dwell chart (window.chartDwellTimeloss) was actually created', realistic.hasChartDwellTimeloss);
        check('realistic dataset: generateFullReport does not throw', realistic.threw === null && !realistic.internalError);
        if (realistic.internalError) console.log('  internal error: ' + realistic.internalError);
        if (realistic.threw) console.log('  error: ' + realistic.threw);
        check('realistic dataset: produced non-empty PDF output, larger than the minimal case', realistic.byteLength > minimal.byteLength);
        for (const heading of REQUIRED_HEADINGS) {
            check(`realistic dataset: contains heading "${heading}"`, realistic.capturedTexts.includes(heading));
        }
        check('realistic dataset: contains the real detector id from GEH data',
            realistic.capturedTexts.some(t => t.includes('det_realistic_1')));

    } catch (err) {
        console.log('HARNESS_ERROR: ' + err.message + '\n' + (err.stack || ''));
        failures++;
    }

    console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
    app.exit(failures === 0 ? 0 : 1);
});

setTimeout(() => { console.log('TIMEOUT'); app.exit(1); }, 60000);
