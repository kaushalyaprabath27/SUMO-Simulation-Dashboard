/**
 * detector.js — Detector Data Handling for SUMO Simulation Control Panel
 *
 * Manages:
 *   1. Parsing detector data files (CSV and SUMO E1 XML) uploaded on the
 *      Validation tab — the live GEH calculation itself is inline in
 *      App._buildGEHTables (app.js), not here.
 *   2. Saved validation-run history (localStorage, capped at 20 runs).
 *   3. CSV export of a saved run.
 */

/* ------------------------------------------------------------------ */
/*  DetectorManager                                                    */
/* ------------------------------------------------------------------ */
const DetectorManager = {

  /** Array of complete validation run datasets.
   *  Each entry: { timestamp, filename, detectors: { [detId]: [...intervals] } } */
  validationRuns: [],

  /* ================================================================ */
  /*  PARSING                                                         */
  /* ================================================================ */

  /**
   * Parse SUMO E1 (induction-loop) detector XML output.
   *
   * Expected element format:
   *   <interval begin="0" end="600" id="det_sec1_juul_dir"
   *     nVehContrib="19" flow="114.00" occupancy="3.99" speed="9.67"
   *     harmonicMeanSpeed="8.12" length="4.50" nVehEntered="20" />
   *
   * @param  {string} xmlString  Raw XML content.
   * @return {Array<Object>}     Parsed interval records.
   */
  parseE1DetectorXML(xmlString) {
    if (!xmlString || typeof xmlString !== 'string') {
      throw new Error('parseE1DetectorXML: input must be a non-empty string');
    }

    const parser = new DOMParser();
    // Parse as text/html to completely ignore unclosed tags and truncation errors
    const doc = parser.parseFromString(xmlString, 'text/html');

    const intervals = doc.querySelectorAll('interval');
    if (intervals.length === 0) {
      throw new Error('parseE1DetectorXML: no <interval> elements found');
    }

    const results = [];
    intervals.forEach(el => {
      results.push({
        begin:             parseFloat(el.getAttribute('begin'))             || 0,
        end:               parseFloat(el.getAttribute('end'))               || 0,
        id:                el.getAttribute('id')                            || '',
        nVehContrib:       parseInt(el.getAttribute('nvehcontrib') || el.getAttribute('nVehContrib'), 10) || 0,
        flow:              parseFloat(el.getAttribute('flow'))              || 0,
        occupancy:         parseFloat(el.getAttribute('occupancy'))         || 0,
        speed:             parseFloat(el.getAttribute('speed'))             || 0,
        harmonicMeanSpeed: parseFloat(el.getAttribute('harmonicmeanspeed') || el.getAttribute('harmonicMeanSpeed')) || 0,
        length:            parseFloat(el.getAttribute('length'))            || 0,
        nVehEntered:       parseInt(el.getAttribute('nvehentered') || el.getAttribute('nVehEntered'), 10) || 0
      });
    });

    return results;
  },

  /**
   * Parse CSV detector data.
   *
   * Supported formats:
   *   Full:   begin,end,id,nVehContrib,flow,speed[,occupancy,harmonicMeanSpeed,length,nVehEntered]
   *   Simple: begin,end,count
   *
   * Both comma- and tab-separated files are handled.  Lines starting with
   * '#' or containing only whitespace are skipped.
   *
   * @param  {string} csvString  Raw CSV content.
   * @return {Array<Object>}     Parsed records.
   */
  parseCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') {
      throw new Error('parseCSV: input must be a non-empty string');
    }

    // Detect delimiter: if any line contains a tab, treat as TSV
    const delimiter = csvString.indexOf('\t') !== -1 ? '\t' : ',';

    const lines = csvString.split(/\r?\n/).filter(l => l.trim() !== '' && !l.trim().startsWith('#'));

    if (lines.length === 0) {
      throw new Error('parseCSV: file contains no data lines');
    }

    // Determine if the first non-comment line is a header
    const firstLineParts = lines[0].split(delimiter).map(s => s.trim());
    let startIndex = 0;
    const looksLikeHeader = firstLineParts.some(p => /^[a-zA-Z_]/.test(p) && isNaN(Number(p)));
    let headers = null;
    if (looksLikeHeader) {
      headers = firstLineParts.map(h => h.toLowerCase().replace(/\s+/g, ''));
      startIndex = 1;
    }

    const results = [];

    for (let i = startIndex; i < lines.length; i++) {
      const parts = lines[i].split(delimiter).map(s => s.trim());
      if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) continue;

      if (headers) {
        // Map by header names
        const record = {};
        headers.forEach((h, idx) => {
          const raw = parts[idx] !== undefined ? parts[idx] : '';
          // Attempt numeric coercion for known numeric fields
          if (['begin', 'end', 'nvehcontrib', 'flow', 'speed', 'occupancy',
               'harmonicmeanspeed', 'length', 'nvehentered', 'count'].includes(h)) {
            record[h] = raw === '' ? 0 : Number(raw);
          } else {
            record[h] = raw;
          }
        });
        // Normalise common aliases
        if (record.count !== undefined && record.nvehcontrib === undefined) {
          record.nVehContrib = record.count;
        }
        results.push(record);
      } else {
        // No header — infer by column count
        if (parts.length >= 6) {
          // Full format: begin, end, id, nVehContrib, flow, speed, ...
          results.push({
            begin:             Number(parts[0]) || 0,
            end:               Number(parts[1]) || 0,
            id:                parts[2],
            nVehContrib:       parseInt(parts[3], 10) || 0,
            flow:              Number(parts[4]) || 0,
            speed:             Number(parts[5]) || 0,
            occupancy:         parts[6] !== undefined ? Number(parts[6]) || 0 : 0,
            harmonicMeanSpeed: parts[7] !== undefined ? Number(parts[7]) || 0 : 0,
            length:            parts[8] !== undefined ? Number(parts[8]) || 0 : 0,
            nVehEntered:       parts[9] !== undefined ? parseInt(parts[9], 10) || 0 : 0
          });
        } else if (parts.length >= 3) {
          // Simple format: begin, end, count
          results.push({
            begin:       Number(parts[0]) || 0,
            end:         Number(parts[1]) || 0,
            nVehContrib: parseInt(parts[2], 10) || 0
          });
        } else {
          // Skip malformed lines silently
        }
      }
    }

    if (results.length === 0) {
      throw new Error('parseCSV: no valid data rows could be parsed');
    }

    return results;
  },

  /* ================================================================ */
  /*  SAVED VALIDATION RUNS                                           */
  /* ================================================================ */

  /**
   * Save a validation run to localStorage.
   * Stores the full GEH comparison tables so the saved-runs history can
   * reproduce the exact Observed / Simulated / GEH / Status layout later.
   *
   * @param  {Array}  rawData     Parsed E1 interval records.
   * @param  {Object} gehTables   Output of App._buildGEHTables().
   * @param  {string} runName     e.g. "Validation Run 3".
   * @param  {string} description Free-text note about what changed.
   */
  async saveValidationToSheets(rawData, gehTables, runName, description) {
    // Capped at the most recent 20 runs so this can never grow large enough
    // to hit localStorage's quota and start failing silently.
    const MAX_SAVED_RUNS = 20;
    const storageKey = 'validationRuns';
    let runs;
    try {
      runs = JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch (e) {
      runs = []; // corrupt/old data — start fresh rather than fail the whole save
    }
    runs.push({
      name: runName,
      date: new Date().toISOString(),
      description: description,
      gehTables: gehTables,
      data: rawData
    });
    while (runs.length > MAX_SAVED_RUNS) runs.shift();
    localStorage.setItem(storageKey, JSON.stringify(runs));
    return true;
  },

  /**
   * Load previously saved validation runs from localStorage.
   * @return {Array<Object>}  Array of { name, date, description, gehTables, data }.
   */
  loadSavedRuns() {
    try {
      return JSON.parse(localStorage.getItem('validationRuns') || '[]');
    } catch (err) {
      console.error('loadSavedRuns: corrupt localStorage data', err);
      return [];
    }
  },

  /**
   * Delete a saved validation run by index.
   * @param  {number}  index  Zero-based index into the saved runs array.
   */
  deleteRun(index) {
    const runs = this.loadSavedRuns();
    if (index < 0 || index >= runs.length) return false;
    runs.splice(index, 1);
    localStorage.setItem('validationRuns', JSON.stringify(runs));
    return true;
  },

  /* ================================================================ */
  /*  EXPORT                                                          */
  /* ================================================================ */

  /**
   * Export an array of objects as a CSV file and trigger a browser download.
   *
   * @param {Array<Object>} data      Array of flat objects (all same keys).
   * @param {string}        filename  Desired download filename (e.g. 'results.csv').
   */
  exportAsCSV(data, filename) {
    if (!data || data.length === 0) {
      console.warn('exportAsCSV: no data to export');
      return;
    }

    // Collect all unique keys across all rows for the header
    const keySet = new Set();
    data.forEach(row => {
      Object.keys(row).forEach(k => keySet.add(k));
    });
    const headers = Array.from(keySet);

    // Build CSV lines
    const csvLines = [];

    // Header row
    csvLines.push(headers.map(h => this._csvEscape(h)).join(','));

    // Data rows
    data.forEach(row => {
      const line = headers.map(h => {
        const val = row[h];
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') return this._csvEscape(JSON.stringify(val));
        return this._csvEscape(String(val));
      });
      csvLines.push(line.join(','));
    });

    const csvString = csvLines.join('\r\n');

    // Trigger download
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename || 'export.csv');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  /* ================================================================ */
  /*  INTERNAL HELPERS                                                */
  /* ================================================================ */

  /**
   * Convert simulation seconds to a HH:MM clock string.
   * @param  {number} seconds  Simulation time in seconds.
   * @return {string}          e.g. "07:30"
   */
  _secondsToClock(seconds) {
    const totalMinutes = Math.floor(seconds / 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  },

  /**
   * Escape a value for CSV output.  Wraps in double-quotes if the value
   * contains commas, quotes, or newlines.
   * @param  {string} value
   * @return {string}
   */
  _csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }
};
