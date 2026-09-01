// Runs the (potentially slow, on a large tripinfo file) XML parse off the
// renderer's main thread so the UI doesn't freeze while it works.
importScripts('emissionsParser.js');

self.onmessage = (e) => {
    const { reqId, xmlText, binDurSec, binCount } = e.data;
    try {
        const result = parseEmissionsXML(xmlText, binDurSec, binCount);
        self.postMessage({ reqId, result });
    } catch (err) {
        self.postMessage({ reqId, error: err.message || String(err) });
    }
};
