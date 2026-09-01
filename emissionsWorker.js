// Runs the (potentially slow, on a large tripinfo or emission-output file)
// XML parse off the renderer's main thread so the UI doesn't freeze while it
// works. Two parsers share this one worker: the default (tripinfo, one
// <emissions> total per trip) and, when `mode: 'split'` is set, the
// idle/moving split (--emission-output, one row per vehicle per timestep —
// a different SUMO file with a different schema, see emissionsParser.js's
// own comments above parseEmissionSplitXML).
importScripts('emissionsParser.js');

self.onmessage = (e) => {
    const { reqId, xmlText, binDurSec, binCount, mode, idleThresholdMps } = e.data;
    try {
        const result = mode === 'split'
            ? parseEmissionSplitXML(xmlText, idleThresholdMps)
            : parseEmissionsXML(xmlText, binDurSec, binCount);
        self.postMessage({ reqId, result });
    } catch (err) {
        self.postMessage({ reqId, error: err.message || String(err) });
    }
};
