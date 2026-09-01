// ============================================================
// SUMO B130 Simulation Control Panel - Main Application Logic
// ============================================================

const App = {
    // Deep clone of original data for reset functionality
    originalVehicleTypes: JSON.parse(JSON.stringify(VEHICLE_TYPES)),

    // Vehicle types found in an uploaded project that don't match one of the
    // 7 built-in category ids — kept separate from VEHICLE_TYPES (which stays
    // reserved for those built-in categories) but rendered as extra columns in
    // the same table and included in the same XML output.
    _customVehicleTypes: {},
    // vType attribute names seen in an uploaded project that aren't part of
    // the interface's own fixed VTYPE_PARAMS list — rendered as extra rows so
    // nothing from the original file is silently dropped.
    _extraVTypeParams: [],

    // Raw tripinfo XML text (+ label) for every currently-loaded emissions
    // scenario, kept so the 10 time bins can be re-parsed at the correct
    // width and re-labeled in clock time whenever Sim Start/Duration changes
    // — not just re-labeled, since the bin width itself depends on Duration.
    _lastEmissionsRawXml: null,

    // --- UNDO / REDO STATE ---
    undoStack: [],
    redoStack: [],
    isApplyingUndoRedo: false,
    
    pushUndo(action) {
        if (this.isApplyingUndoRedo) return;
        this.undoStack.push(action);
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.redoStack = [];
    },
    
    undo() {
        if (this.undoStack.length === 0) {
            this.showToast('Nothing to undo', 'info');
            return;
        }
        const action = this.undoStack.pop();
        this.redoStack.push(action);
        this.applyAction(action, true);
        this.showToast('Undo successful', 'success');
    },

    redo() {
        if (this.redoStack.length === 0) {
            this.showToast('Nothing to redo', 'info');
            return;
        }
        const action = this.redoStack.pop();
        this.undoStack.push(action);
        this.applyAction(action, false);
        this.showToast('Redo successful', 'success');
    },

    applyAction(action, isUndo) {
        this.isApplyingUndoRedo = true;
        const val = isUndo ? action.oldValue : action.newValue;
        switch (action.type) {
            case 'vehicleParam':
                VEHICLE_TYPES[action.typeName][action.param] = val;
                this.renderVehicleTypeTable();
                break;
        }
        this.saveToLocal();
        this.isApplyingUndoRedo = false;
    },

    // --- EXPORT VIEW ---
    async exportToPDF() {
        if (!window.html2canvas || !window.jspdf) {
            this.showToast('Export libraries not loaded yet.', 'error');
            return;
        }
        this.showToast('Generating PDF...', 'info');
        try {
            const activePane = document.querySelector('.tab-pane.active');
            const canvas = await html2canvas(activePane, { scale: 2 });
            const imgData = canvas.toDataURL('image/png');
            
            // Calculate height proportionally to standard A4 width (210mm)
            const pdfWidth = 210; 
            const pdfHeight = Math.max(297, (canvas.height * pdfWidth) / canvas.width);
            
            // Create a custom-sized PDF so the whole tab fits on one continuous, unbroken page
            const pdf = new jspdf.jsPDF('p', 'mm', [pdfWidth, pdfHeight]);
            
            pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save('SUMO_Dashboard_View.pdf');
            this.showToast('PDF Exported Successfully', 'success');
        } catch (e) {
            console.error(e);
            this.showToast('Failed to export PDF', 'error');
        }
    },
    
    // Chart.js instances that exist across the 5 result tabs, grouped by tab.
    // Each entry references its live chart via a getter (so it's read at
    // report-generation time, not page-load time) plus a fixed title/caption.
    // Charts that were never rendered (tab not yet run/uploaded) resolve to
    // null/undefined and are skipped rather than breaking the report.
    _reportChartSpecs: {
        'Simulation Results': [
            { get: () => App._simSpeedChart, title: 'Mean Network Speed Over Time', caption: 'Average speed across all vehicles in the network, sampled at regular intervals over the simulated period. A falling trend usually points to growing congestion.' },
            { get: () => App._simVtypeChart, title: 'Avg Speed & Waiting by Vehicle Type', caption: 'Average speed and average waiting time broken down by vehicle type, showing how each category of vehicle was affected differently by the simulated traffic conditions.' }
        ],
        'Emissions Analysis': [
            { get: () => window.chart1, title: 'Total Emissions by Pollutant', caption: 'Total CO, HC, PMx and NOx emitted across the whole network, in grams, compared across every scenario that was uploaded.' },
            { get: () => window.chart2, title: 'Network Fuel Consumption Over Time', caption: 'Total fuel consumed across the network in each interval, in liters, for every uploaded scenario.' },
            { get: () => window.chartDelay, title: 'Average Delay per Vehicle Over Time', caption: 'Average time lost per vehicle (delay) in each interval, in seconds, for every uploaded scenario.' },
            { get: () => window.chartStops, title: 'Stop-and-Go Occurrences Over Time', caption: 'Total number of stop-and-go events recorded across the network in each interval, for every uploaded scenario.' },
            { get: () => window.chart3, title: 'PMx Emissions Over Time', caption: 'Total particulate matter (PMx) emitted across the network in each interval, in grams, for every uploaded scenario.' },
            { get: () => window.chart4, title: 'NOx Emissions Over Time', caption: 'Total nitrogen oxides (NOx) emitted across the network in each interval, in grams, for every uploaded scenario.' },
            { get: () => window.chartCO, title: 'CO Emissions Over Time', caption: 'Total carbon monoxide (CO) emitted across the network in each interval, in grams, for every uploaded scenario.' },
            { get: () => window.chartHC, title: 'HC Emissions Over Time', caption: 'Total hydrocarbon (HC) emissions across the network in each interval, in grams, for every uploaded scenario.' },
            { get: () => window.chartCO2, title: 'CO2 Emissions Over Time', caption: 'Total carbon dioxide (CO2) emitted across the network in each interval, in kilograms, for every uploaded scenario.' },
            { get: () => window.chartPie, title: 'Fuel Penalty Breakdown by Vehicle Type (Petrol)', caption: 'Extra petrol fuel consumed by each vehicle category compared to the baseline scenario, in liters.' },
            { get: () => window.chartFuelBarPetrol, title: 'Avg Financial Penalty per Trip (Petrol)', caption: 'Extra fuel cost per trip compared to the baseline scenario for petrol-fuelled vehicle types, in LKR.' },
            { get: () => window.chartFuelBarDiesel, title: 'Avg Financial Penalty per Trip (Diesel)', caption: 'Extra fuel cost per trip compared to the baseline scenario for diesel-fuelled vehicle types, in LKR.' },
            { get: () => window.chartTimePenalty, title: 'Avg Time Penalty per Trip by Vehicle Type', caption: 'Average delay per trip for each vehicle type, in seconds, for every uploaded scenario.' }
        ],
        'Dwell Time Analysis': [
            { get: () => window.chartDwellTimeloss, title: 'Network Time Loss vs Dwell Time', caption: 'Total network-wide delay, in hours, as the simulated bus dwell time increases.' },
            { get: () => window.chartDwellCo2, title: 'Total CO2 Emissions vs Dwell Time', caption: 'Total CO2 emitted across the network, in kilograms, as the simulated bus dwell time increases.' },
            { get: () => window.chartDwellNox, title: 'Total NOx Emissions vs Dwell Time', caption: 'Total NOx emitted across the network, in grams, as the simulated bus dwell time increases.' },
            { get: () => window.chartDwellPmx, title: 'Total PMx Emissions vs Dwell Time', caption: 'Total PMx emitted across the network, in grams, as the simulated bus dwell time increases.' },
            { get: () => window.chartDwellCo, title: 'Total CO Emissions vs Dwell Time', caption: 'Total CO emitted across the network, in grams, as the simulated bus dwell time increases.' },
            { get: () => window.chartDwellHc, title: 'Total HC Emissions vs Dwell Time', caption: 'Total HC emitted across the network, in grams, as the simulated bus dwell time increases.' },
            { get: () => window.chartDwellFuel, title: 'Total Fuel Consumption vs Dwell Time', caption: 'Total fuel consumed across the network, in liters, as the simulated bus dwell time increases.' },
            { get: () => window.chartDwellStops, title: 'Total Stop-and-Go Occurrences vs Dwell Time', caption: 'Total stop-and-go events recorded across the network as the simulated bus dwell time increases.' },
            { get: () => window.chartDwellFinancial, title: 'Financial Drain vs Dwell Time', caption: 'Estimated total fuel cost, in LKR, across the network as the simulated bus dwell time increases.' },
            { get: () => window.chartDwellSpeed, title: 'Average Speed vs Dwell Time', caption: 'Average network speed, in km/h, at each simulated bus dwell time.' },
            { get: () => window.chartDwellTipping, title: 'Tipping Point — Fleet Loaded vs Total Delay', caption: 'Total vehicles loaded into the network compared against total network delay, in hours, across dwell times — used to spot the dwell time where delay starts increasing sharply.' },
            { get: () => window.chartDwellRelative, title: 'Relative Increase vs 20s Baseline', caption: 'Percentage increase in NOx, delay and fuel cost at each dwell time, relative to the 20-second baseline scenario.' }
        ]
    },

    // Builds one multi-page PDF covering all 5 result tabs: Simulation Results,
    // Validation, MAPE Validation, Emissions Analysis, Dwell Time Analysis.
    // Every chart gets its title, a caption paragraph, and a native (text,
    // not screenshotted) data table of the numbers behind it. A tab that
    // hasn't been run/uploaded yet is noted as skipped rather than omitted
    // silently.
    _loadImageDataUrl(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            img.onerror = () => reject(new Error('Could not load ' + src));
            img.src = src;
        });
    },

    async generateFullReport() {
        if (!window.jspdf) {
            this.showToast('PDF library not loaded yet.', 'error');
            return;
        }
        this.showToast('Generating report — this can take a few seconds...', 'info');

        try {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageW = 210, pageH = 297, margin = 15;
            const contentW = pageW - margin * 2;
            let y = margin;

            const ensureSpace = (needed) => {
                if (y + needed > pageH - margin) { pdf.addPage(); y = margin; }
            };
            const addCoverTitle = (text) => {
                pdf.setFontSize(20); pdf.setFont('helvetica', 'bold');
                pdf.text(text, margin, y);
                y += 10;
                pdf.setFont('helvetica', 'normal');
            };
            const addTabHeading = (text) => {
                ensureSpace(14);
                pdf.setFontSize(15); pdf.setFont('helvetica', 'bold');
                pdf.setTextColor(37, 99, 235);
                pdf.text(text, margin, y);
                y += 8;
                pdf.setDrawColor(37, 99, 235);
                pdf.line(margin, y - 5.5, pageW - margin, y - 5.5);
                pdf.setTextColor(0, 0, 0);
                pdf.setFont('helvetica', 'normal');
            };
            const addChartTitle = (text) => {
                ensureSpace(9);
                pdf.setFontSize(11.5); pdf.setFont('helvetica', 'bold');
                pdf.text(text, margin, y);
                y += 6;
                pdf.setFont('helvetica', 'normal');
            };
            const addCaption = (text) => {
                pdf.setFontSize(9); pdf.setTextColor(90, 90, 90); pdf.setFont('helvetica', 'italic');
                const lines = pdf.splitTextToSize(text, contentW);
                ensureSpace(lines.length * 4 + 2);
                pdf.text(lines, margin, y);
                y += lines.length * 4 + 3;
                pdf.setTextColor(0, 0, 0); pdf.setFont('helvetica', 'normal');
            };
            const addNote = (text) => {
                pdf.setFontSize(9.5); pdf.setTextColor(150, 60, 30);
                ensureSpace(6);
                pdf.text(text, margin, y);
                y += 7;
                pdf.setTextColor(0, 0, 0);
            };
            const addChartImage = (chart) => {
                if (!chart || !chart.canvas) return false;
                let img;
                try { img = chart.toBase64Image(); } catch (e) { return false; }
                const canvas = chart.canvas;
                if (!canvas.width || !canvas.height) return false;
                const maxW = contentW, maxH = 80;
                let w = maxW, h = (canvas.height / canvas.width) * w;
                if (h > maxH) { h = maxH; w = (canvas.width / canvas.height) * h; }
                ensureSpace(h + 4);
                pdf.addImage(img, 'PNG', margin, y, w, h);
                y += h + 4;
                return true;
            };
            // Simple native (non-screenshotted) data table so the numbers stay
            // crisp, selectable text rather than a raster image.
            const addDataTable = (headers, rows) => {
                if (!rows.length) return;
                const colW = contentW / headers.length;
                const rowH = 5.5;
                const drawRow = (cells, bold) => {
                    ensureSpace(rowH);
                    pdf.setFontSize(7.5);
                    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
                    let x = margin;
                    cells.forEach(c => {
                        const text = String(c);
                        pdf.text(text.length > 22 ? text.slice(0, 21) + '…' : text, x + 1, y + 3.8);
                        x += colW;
                    });
                    pdf.setDrawColor(200);
                    pdf.rect(margin, y, contentW, rowH);
                    for (let i = 1; i < headers.length; i++) pdf.line(margin + colW * i, y, margin + colW * i, y + rowH);
                    y += rowH;
                };
                drawRow(headers, true);
                rows.forEach(r => drawRow(r, false));
                y += 4;
            };
            // fmtNum/tableFromChart live in reportDataPrep.js (unit-tested in
            // tests/reportDataPrep.test.js) so the exact same code can run
            // in isolation under Node.
            const addChartSection = (spec) => {
                const chart = spec.get();
                addChartTitle(spec.title);
                addCaption(spec.caption);
                const drew = addChartImage(chart);
                if (!drew) { addNote('(Not available — this chart has not been generated yet.)'); return; }
                const { headers, rows } = tableFromChart(chart);
                if (headers.length > 1 && rows.length) addDataTable(headers, rows);
            };

            // ---- Cover ----
            addCoverTitle('SUMO Simulation Analysis Report');
            pdf.setFontSize(10); pdf.setTextColor(90, 90, 90);
            const projectName = (this.project && this.project.name) || 'Untitled project';
            pdf.text(`Project: ${projectName}`, margin, y); y += 5;
            pdf.text(`Generated: ${new Date().toLocaleString()}`, margin, y); y += 8;
            pdf.setTextColor(0, 0, 0);

            // ---- Simulation Results ----
            addTabHeading('Simulation Results');
            if (!this._lastSimResults) {
                addNote('No simulation has been run yet — this section is empty.');
            } else {
                this._reportChartSpecs['Simulation Results'].forEach(addChartSection);
            }

            // ---- Validation (GEH) — native tables, reusing the same math as the tab itself ----
            pdf.addPage(); y = margin;
            addTabHeading('Validation (GEH)');
            if (!this._lastGEHRawData || !this._lastGEHRawData.length) {
                addNote('No validation data has been uploaded yet — this section is empty.');
            } else {
                const gehTables = this._buildGEHTables(this._lastGEHRawData);
                Object.keys(gehTables).sort().forEach(detId => {
                    const t = gehTables[detId];
                    addChartTitle(`${t.label} (${detId})`);
                    addCaption(`GEH comparison of observed vs simulated vehicle counts per interval. Success rate: ${t.successRate} — ${t.modelStatus}.`);
                    addDataTable(
                        ['Interval', 'Observed', 'Simulated', 'GEH', 'Status'],
                        t.rows.map(r => [r.clock, r.observed, r.simulated, r.geh, r.status])
                    );
                });
            }

            // ---- MAPE Validation — existing rendered tables, screenshotted (no
            // separate structured-data path exists for this yet) ----
            pdf.addPage(); y = margin;
            addTabHeading('MAPE Validation');
            const mapeContainer = document.getElementById('mape-validation-container');
            const hasMapeData = this._lastMapeDetectorRaw || this._lastMapeRaw;
            if (!hasMapeData || !mapeContainer) {
                addNote('No MAPE data has been uploaded yet — this section is empty.');
            } else {
                addCaption('Travel-time comparison between observed and simulated values, per detector segment or edge. See the MAPE Validation tab for the live, editable version of this data.');
                try {
                    const canvas = await html2canvas(mapeContainer, { scale: 2 });
                    const imgW = contentW, imgH = (canvas.height / canvas.width) * imgW;
                    let remaining = imgH, srcY = 0;
                    const pxPerMm = canvas.width / imgW;
                    while (remaining > 0) {
                        const sliceMm = Math.min(pageH - margin * 2, remaining);
                        const sliceCanvas = document.createElement('canvas');
                        sliceCanvas.width = canvas.width;
                        sliceCanvas.height = sliceMm * pxPerMm;
                        sliceCanvas.getContext('2d').drawImage(canvas, 0, srcY * pxPerMm, canvas.width, sliceMm * pxPerMm, 0, 0, canvas.width, sliceMm * pxPerMm);
                        ensureSpace(sliceMm);
                        pdf.addImage(sliceCanvas.toDataURL('image/png'), 'PNG', margin, y, imgW, sliceMm);
                        y += sliceMm + 2;
                        srcY += sliceMm;
                        remaining -= sliceMm;
                        if (remaining > 0) { pdf.addPage(); y = margin; }
                    }
                } catch (e) {
                    console.error(e);
                    addNote('(Could not capture the MAPE tables for this report.)');
                }
            }

            // ---- Emissions Analysis ----
            pdf.addPage(); y = margin;
            addTabHeading('Emissions Analysis');
            if (!window.chart1) {
                addNote('No emissions scenario has been uploaded yet — this section is empty.');
            } else {
                this._reportChartSpecs['Emissions Analysis'].forEach(addChartSection);
            }

            // ---- Dwell Time Analysis ----
            pdf.addPage(); y = margin;
            addTabHeading('Dwell Time Analysis');
            if (!window.chartDwellTimeloss) {
                addNote('No dwell time sweep has been run yet — this section is empty.');
            } else {
                this._reportChartSpecs['Dwell Time Analysis'].forEach(addChartSection);
            }

            // ---- Footer on every page: logo, then title, then page number ----
            let logoDataUrl = null;
            try { logoDataUrl = await this._loadImageDataUrl('Icon.png'); } catch (e) { /* footer just skips the logo */ }
            const totalPages = pdf.internal.getNumberOfPages();
            const footerY = pageH - 8;
            for (let p = 1; p <= totalPages; p++) {
                pdf.setPage(p);
                let textX = margin;
                if (logoDataUrl) {
                    pdf.addImage(logoDataUrl, 'PNG', margin, footerY - 4.5, 6, 6);
                    textX = margin + 8;
                }
                pdf.setFontSize(8.5); pdf.setFont('helvetica', 'normal'); pdf.setTextColor(120, 120, 120);
                pdf.text('SUMO Simulation Analysis Report', textX, footerY);
                pdf.text(`Page ${p} of ${totalPages}`, pageW - margin - 22, footerY);
                pdf.setTextColor(0, 0, 0);
            }

            pdf.save('SUMO_Analysis_Report.pdf');
            this.showToast('Report generated.', 'success');
        } catch (e) {
            console.error(e);
            this.showToast('Failed to generate report: ' + e.message, 'error');
        }
    },

    STORAGE_VERSION: 6,

        // --- EDITABLE OBSERVED DATA (MAPE edges + GEH detectors) ---
    // Both are dynamic, keyed by whatever edge/detector ids appear in the uploaded
    // data — no hardcoded route/detector names. Shape: { [id]: { [intervalIdx]: value } }
    observedMAPE: {},
    observedGEH: {},
    _mapeNames: {},
    _validationNames: {},
    _lastMapeRaw: null,
    // MAPE can also be computed from the user's own existing E1 detector
    // output (the same file format used in the Validation tab) instead of a
    // separate <edgeData> file. A single detector only measures speed at one
    // point, not travel time, so the user defines "segments" pairing two
    // detectors with the real distance between them — simulated travel time is
    // (distance ÷ average of the two detectors' mean speed). _lastMapeMode
    // tracks which input format is currently active so re-renders/restores use
    // the right one.
    _lastMapeDetectorRaw: null,
    _mapeSegments: [],
    _lastMapeMode: 'edge',
    _netLaneGraph: null,
    _lastGEHRawData: null,
    _lastGEHRunName: '',
    _lastGEHDescription: '',
    // Maps a project's own vType ids (e.g. "car", "moto") to this tool's 6 fixed
    // categories (motorcycle/tuk_tuk/passenger_car/heavy_bus/van/truck) so existing
    // <flow> demand can be auto-imported even when the project doesn't use those
    // exact ids. Persisted per-browser so it's only asked once.
    _vTypeMap: {},
    _pendingFlowImport: null,

    loadObservedData() {
        const loadJSON = (key, fallback) => {
            try { return JSON.parse(localStorage.getItem(key)) || fallback; }
            catch (e) { return fallback; }
        };
        this.observedMAPE = loadJSON('sumoObservedMAPE', {});
        this.observedGEH = loadJSON('sumoObservedGEH', {});
        this._mapeNames = loadJSON('sumoMapeNames', {});
        this._validationNames = loadJSON('sumoValidationNames', {});
        this._lastMapeRaw = loadJSON('sumoLastMapeRaw', null);
        this._lastMapeDetectorRaw = loadJSON('sumoLastMapeDetectorRaw', null);
        this._mapeSegments = loadJSON('sumoMapeSegments', []);
        this._lastMapeMode = loadJSON('sumoLastMapeMode', 'edge');
        this._lastGEHRawData = loadJSON('sumoLastGEHRawData', null);
        const meta = loadJSON('sumoLastGEHMeta', {});
        this._lastGEHRunName = meta.runName || '';
        this._lastGEHDescription = meta.description || '';
        this._lastSimResults = loadJSON('sumoLastSimResults', null);
        this._vTypeMap = loadJSON('sumoVTypeMap', {});
    },

    saveObservedMAPE() {
        localStorage.setItem('sumoObservedMAPE', JSON.stringify(this.observedMAPE));
        this.showToast('Observed MAPE data saved.', 'success');
    },

    updateObservedMAPE(edgeId, intervalIdx, value) {
        let val = parseFloat(value);
        if (isNaN(val) || val < 0) val = 0;
        if (!this.observedMAPE[edgeId]) this.observedMAPE[edgeId] = {};
        this.observedMAPE[edgeId][intervalIdx] = val;
        if (this._lastMapeMode === 'detector' && this._lastMapeDetectorRaw) this._renderMapeFromDetectorRaw(this._lastMapeDetectorRaw);
        else if (this._lastMapeRaw) this._renderMapeFromRaw(this._lastMapeRaw);
    },

    renameMapeEdge(edgeId, name) {
        this._mapeNames[edgeId] = name;
        localStorage.setItem('sumoMapeNames', JSON.stringify(this._mapeNames));
    },

    saveObservedGEH() {
        localStorage.setItem('sumoObservedGEH', JSON.stringify(this.observedGEH));
        this.showToast('Observed GEH data saved.', 'success');
    },

    updateObservedGEH(detId, intervalIdx, value) {
        let val = parseFloat(value);
        if (isNaN(val) || val < 0) val = 0;
        if (!this.observedGEH[detId]) this.observedGEH[detId] = {};
        this.observedGEH[detId][intervalIdx] = val;
        if (this._lastGEHRawData) {
            const gehTables = this._buildGEHTables(this._lastGEHRawData);
            this.renderValidationResult(gehTables, this._lastGEHRunName || 'Current', this._lastGEHDescription || '');
        }
    },

    renameValidationDetector(detId, name) {
        this._validationNames[detId] = name;
        localStorage.setItem('sumoValidationNames', JSON.stringify(this._validationNames));
    },

    init() {
        // Invalidate stale localStorage if the storage schema version changed
        const storedVer = parseInt(localStorage.getItem('sumoDashboardVersion') || '0');
        if (storedVer < this.STORAGE_VERSION) {
            localStorage.removeItem('sumoDashboardState');
            localStorage.setItem('sumoDashboardVersion', String(this.STORAGE_VERSION));
            console.log(`[Dashboard] Storage version upgraded from ${storedVer} → ${this.STORAGE_VERSION}. State cleared.`);
        }
        this.loadFromLocal();
        this.loadObservedData();
        this.initTabs();
        this.initArrowKeys();
        if (typeof this.initHotkeys === 'function') this.initHotkeys();
        this.initPaste();
        this.renderVehicleTypeTable();
        this.loadValidationRuns();
        if (typeof this.updateQuickStats === 'function') this.updateQuickStats();
        this.renderLastValidation();
        if (typeof this.renderMapeValidation === 'function') this.renderMapeValidation();
        if (typeof this.renderSimResults === 'function') this.renderSimResults();
        this.loadSimSettings();
        this.rebuildFlowsSetup();
        this.rebuildPedSetup();
        this.rebuildBusSetup();
        this.rebuildParkingSetup();
        if (typeof this.loadFuelPriceMeta === 'function') this.loadFuelPriceMeta();

        // Initial tab load fixes
        const activeTab = document.querySelector('.tab-btn.active');
        if (activeTab) {
            document.getElementById(activeTab.dataset.tab).classList.add('active');
        }
        
        document.addEventListener('contextmenu', (e) => {
            if (e.target.tagName === 'CANVAS') {
                e.preventDefault();
                const link = document.createElement('a');
                link.download = (e.target.id || 'chart') + '.png';
                link.href = e.target.toDataURL('image/png');
                link.click();
                App.showToast('Chart exported as PNG', 'success');
            }
        });
    },


    // =====================================================================
    // SUMO PROJECT FOLDER LOADING
    // =====================================================================
    project: {
        routes: [],
        vehicleTypes: [],
        busStops: [],
        parkingAreas: [],
        crossings: [],
        simStartTime: '06:30',
        simDuration: 100,
        simStep: 0.1,
        name: '',
        sumocfgName: '',
        folderPath: ''
    },

    // Writes the current Flows/Pedestrians/Bus/Parking demand as a real SUMO XML
    // file into the loaded project folder, and makes sure the project's .sumocfg
    // actually references it (appending to <route-files>, backing up the original
    // first) so that clicking "Run SUMO" afterward picks up these exact changes.
    // Desktop (Electron) only — a browser tab can't write into your project folder.
    async saveChangesToProject() {
        if (!window.electronAPI || typeof window.electronAPI.writeProjectFile !== 'function') {
            this.showToast('Saving directly into the project folder requires the desktop app.', 'error');
            return;
        }
        if (!this.project.folderPath) {
            this.showToast('Load a SUMO project folder first.', 'error');
            return;
        }

        try {
            const xml = this._buildFullXML();
            const demandFile = 'dashboard_demand.rou.xml';
            await window.electronAPI.writeProjectFile({ filename: demandFile, content: xml });

            let cfgNote = '';
            if (this.project.sumocfgName) {
                const cfgText = await window.electronAPI.readProjectFile({ filename: this.project.sumocfgName });
                if (cfgText != null) {
                    const updated = this._ensureRouteFileReferenced(cfgText, demandFile);
                    if (updated !== cfgText) {
                        await window.electronAPI.writeProjectFile({ filename: this.project.sumocfgName + '.bak', content: cfgText });
                        await window.electronAPI.writeProjectFile({ filename: this.project.sumocfgName, content: updated });
                        cfgNote = ` and added it to ${this.project.sumocfgName} (backup saved as .bak)`;
                    }
                }
            }

            this.showToast(`Saved ${demandFile} to your project folder${cfgNote}.`, 'success');
        } catch (e) {
            this.showToast('Save failed: ' + e.message, 'error');
        }
    },

    // Adds demandFile to the .sumocfg's <route-files value="..."/> list if it
    // isn't already referenced there. Leaves everything else in the file untouched.
    _ensureRouteFileReferenced(cfgText, demandFile) {
        if (cfgText.includes(demandFile)) return cfgText;

        const match = cfgText.match(/<route-files\s+value="([^"]*)"\s*\/>/);
        if (match) {
            const newList = match[1] ? `${match[1]},${demandFile}` : demandFile;
            return cfgText.replace(match[0], `<route-files value="${newList}"/>`);
        }
        if (cfgText.includes('<input>')) {
            return cfgText.replace('<input>', `<input>\n        <route-files value="${demandFile}"/>`);
        }
        if (cfgText.includes('</configuration>')) {
            return cfgText.replace('</configuration>', `    <input>\n        <route-files value="${demandFile}"/>\n    </input>\n</configuration>`);
        }
        return cfgText; // unrecognized structure — leave it alone rather than guess
    },

    // Runs the loaded project in SUMO. Browsers can't launch local processes, so
    // in-browser this shows the exact command to run manually; the desktop
    // (Electron) build wires window.electronAPI.runSumo to actually execute it.
    // Pair with saveChangesToProject() first so Run picks up your latest edits.
    // Seconds per interval, used to size the auto-generated edgeData (MAPE)
    // output — falls back to a sensible 10-minute default if Flows isn't set up.
    _getIntervalFreqSec() {
        return Math.max(60, (this._flowsState.intervalDuration || 10) * 60);
    },

    async runSumo() {
        const cfg = this.project.sumocfgName || '<your-project>.sumocfg';
        const step = document.getElementById('sim-step')?.value || '0.1';
        const command = `sumo-gui -c ${cfg} --step-length ${step}`;

        if (window.electronAPI && typeof window.electronAPI.runSumo === 'function') {
            if (!this.project.sumocfgName) {
                this.showToast('Load a SUMO project folder (with a .sumocfg file) first.', 'error');
                return;
            }
            this.showToast('Launching SUMO...', 'info');
            try {
                const result = await window.electronAPI.runSumo({ cfg, step, folderPath: this.project.folderPath, freqSec: this._getIntervalFreqSec() });
                if (result && result.notes && result.notes.length) {
                    this.showToast('Redirected unwritable detector output(s): ' + result.notes.join('; '), 'info');
                }
            } catch (e) {
                this.showToast('Failed to launch SUMO: ' + e.message, 'error');
            }
            return;
        }

        try {
            await navigator.clipboard.writeText(command);
            this.showToast(`Command copied to clipboard: ${command}`, 'success');
        } catch (e) {
            this.showToast(`Run in your terminal: ${command}`, 'info');
        }
        alert(`Browser apps can't launch local programs directly.\n\nRun this in a terminal from your project folder:\n\n${command}\n\n(Command copied to your clipboard if permitted.)\n\nThe installable desktop version of this tool will run SUMO directly.`);
    },

    // Runs SUMO headless (no GUI) so it finishes on its own, then parses its
    // tripinfo/summary output into the Simulation Results tab. Desktop only —
    // sumo-gui (used by runSumo()) never tells us when the user is done driving it,
    // so there's no reliable moment to grab results from that interactive path.
    async runSumoAndAnalyze() {
        if (!window.electronAPI || typeof window.electronAPI.runSumoHeadless !== 'function') {
            this.showToast('Run & Analyze requires the desktop app.', 'error');
            return;
        }
        if (!this.project.sumocfgName) {
            this.showToast('Load a SUMO project folder (with a .sumocfg file) first.', 'error');
            return;
        }

        const cfg = this.project.sumocfgName;
        const step = document.getElementById('sim-step')?.value || '0.1';
        const btn = document.getElementById('btn-run-analyze');
        if (btn) { btn.disabled = true; btn.textContent = 'Running...'; }
        this.showToast('Running simulation in the background — this can take a while for larger scenarios...', 'info');

        try {
            const { tripinfo, summary, travelTimes, notes } = await window.electronAPI.runSumoHeadless({ cfg, step, folderPath: this.project.folderPath, freqSec: this._getIntervalFreqSec() });
            if (notes && notes.length) {
                this.showToast('Redirected unwritable detector output(s): ' + notes.join('; '), 'info');
            }
            this._processSimResults(tripinfo, summary);
            await this._autoPopulateEmissions(tripinfo);
            this._autoPopulateMape(travelTimes);
            this.showToast('Simulation finished — see the Simulation Results tab.', 'success');
            document.getElementById('btn-tab-sim-results')?.click();
        } catch (e) {
            this.showToast('Run failed: ' + e.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Run & Analyze'; }
        }
    },

    // If a new user never exports/pastes a tripinfo_data.xml by hand, this fills
    // the Emissions Analysis tab automatically from the same run's tripinfo
    // output (SUMO attaches per-vehicle <emissions> when the emission device is
    // enabled — see --device.emissions.probability in main.js's headless run).
    async _autoPopulateEmissions(tripinfoXml) {
        if (!tripinfoXml) return;
        try {
            const data = await this._parseEmissionsAsync(tripinfoXml, this._getIntervalFreqSec(), this._emissionsBinCount());
            if (!data || (data.netTotals.CO2 <= 0 && data.busFuel <= 0 && data.otherFuel <= 0)) return;
            data._label = 'Latest Run (' + new Date().toLocaleTimeString() + ')';
            this._lastEmissionsRawXml = [{ xml: tripinfoXml, label: data._label }];
            this._persistEmissionsRawXml();
            const dieselPrice = parseFloat(document.getElementById('fuel-price-diesel')?.value) || 382;
            const petrolPrice = parseFloat(document.getElementById('fuel-price-petrol')?.value) || 414;
            const resultsEl = document.getElementById('emissions-results');
            if (resultsEl) resultsEl.style.display = 'block';
            this.renderEmissionsDashboard([data], dieselPrice, petrolPrice);
            this.showToast('Emissions Analysis tab auto-filled from this run.', 'info');
        } catch (e) {
            console.warn('Could not auto-populate emissions from run:', e);
        }
    },

    // If a new user never sets up their own <edgeData> element or exports a
    // travel_times_output.xml by hand, this fills the MAPE Validation tab
    // automatically from the same run — main.js's prepareRunFiles() always
    // writes a small dashboard-owned edgeData additional-file requesting this
    // output, without ever touching the user's own .add.xml.
    _autoPopulateMape(travelTimesXml) {
        if (!travelTimesXml) return;
        try {
            let cleanedText = travelTimesXml.replace(/<!--[\s\S]*?-->/g, '').trim();
            if (!cleanedText.endsWith('</meandata>')) cleanedText += '\n</meandata>';

            const parser = new DOMParser();
            let xmlDoc = parser.parseFromString(cleanedText, 'text/xml');
            if (xmlDoc.querySelector('parsererror')) {
                xmlDoc = parser.parseFromString(cleanedText, 'text/html');
            }
            const intervals = Array.from(xmlDoc.querySelectorAll('interval'));
            if (!intervals.length) return;

            const raw = intervals.map(intv => {
                const begin = parseFloat(intv.getAttribute('begin')) || 0;
                const edges = {};
                intv.querySelectorAll('edge').forEach(e => {
                    edges[e.getAttribute('id')] = parseFloat(e.getAttribute('traveltime') || 0);
                });
                return { begin, edges };
            });

            this._lastMapeRaw = raw;
            this._renderMapeFromRaw(raw);
            try { localStorage.setItem('sumoLastMapeRaw', JSON.stringify(raw)); } catch (e) { /* best effort */ }
            this.showToast('MAPE Validation tab auto-filled from this run.', 'info');
        } catch (e) {
            console.warn('Could not auto-populate MAPE from run:', e);
        }
    },

    // Automates the Dwell Time Analysis tab's 5-scenario workflow: temporarily
    // forces every bus stop's dwell time to each of 0/10/20/45/90s in turn,
    // writes the demand file, runs SUMO headless, and collects each run's
    // tripinfo — without the user manually re-running SUMO 5 times by hand.
    async runDwellSweep() {
        if (!window.electronAPI || typeof window.electronAPI.runSumoHeadless !== 'function') {
            this.showToast('Dwell Sweep requires the desktop app.', 'error');
            return;
        }
        if (!this.project.sumocfgName) {
            this.showToast('Load a SUMO project folder (with a .sumocfg file) first.', 'error');
            return;
        }
        if (!this._busState.stops.length) {
            this.showToast('Add at least one bus stop in the Bus & Parking tab first.', 'error');
            return;
        }

        const DWELL_VALUES = [0, 10, 20, 45, 90];
        const cfg = this.project.sumocfgName;
        const step = document.getElementById('sim-step')?.value || '0.1';
        const btn = document.getElementById('btn-dwell-sweep');
        if (btn) btn.disabled = true;

        // Snapshot the user's real dwell data so it can always be restored,
        // even if a run in the middle of the sweep fails.
        const originalDwellData = JSON.parse(JSON.stringify(this._busState.dwellData));
        const intervals = this._busState.intervals || 8;
        const demandFile = 'dashboard_demand.rou.xml';
        const results = {};

        try {
            for (let i = 0; i < DWELL_VALUES.length; i++) {
                const dwell = DWELL_VALUES[i];
                if (btn) btn.textContent = `Running ${dwell}s dwell (${i + 1}/${DWELL_VALUES.length})...`;
                this.showToast(`Dwell Sweep: running ${dwell}s scenario (${i + 1}/${DWELL_VALUES.length})...`, 'info');

                this._busState.stops.forEach((s, si) => {
                    for (let ii = 0; ii < intervals; ii++) {
                        this._busState.dwellData[`${si}_${ii}`] = dwell;
                    }
                });

                const xml = this._buildFullXML();
                await window.electronAPI.writeProjectFile({ filename: demandFile, content: xml });

                const cfgText = await window.electronAPI.readProjectFile({ filename: cfg });
                if (cfgText != null) {
                    const updated = this._ensureRouteFileReferenced(cfgText, demandFile);
                    if (updated !== cfgText) {
                        await window.electronAPI.writeProjectFile({ filename: cfg, content: updated });
                    }
                }

                const { tripinfo } = await window.electronAPI.runSumoHeadless({ cfg, step, folderPath: this.project.folderPath });
                results[dwell] = tripinfo ? await this._parseEmissionsAsync(tripinfo) : null;

                // Leave each scenario's raw tripinfo behind on disk too, not just
                // in the charts — so it can be inspected or reused later.
                if (tripinfo) {
                    try {
                        await window.electronAPI.writeProjectFile({ filename: `dwell_sweep_${dwell}s_tripinfo.xml`, content: tripinfo });
                    } catch (e) { /* best effort */ }
                }
            }

            this.renderDwellCharts(results);
            const resultsDiv = document.getElementById('dwell-results');
            if (resultsDiv) resultsDiv.style.display = 'block';
            this.showToast('Dwell Sweep complete — see the charts below.', 'success');
        } catch (e) {
            this.showToast('Dwell Sweep failed: ' + e.message, 'error');
        } finally {
            // Always put the user's real dwell data back, both in memory and in
            // the demand file on disk — the sweep must never leave the project
            // pointed at throwaway test values.
            this._busState.dwellData = originalDwellData;
            try {
                const xml = this._buildFullXML();
                await window.electronAPI.writeProjectFile({ filename: demandFile, content: xml });
            } catch (e) { /* best-effort restore */ }
            if (btn) { btn.disabled = false; btn.textContent = 'Run Dwell Sweep (5 runs, desktop app only)'; }
        }
    },

    _processSimResults(tripinfoXml, summaryXml) {
        const parser = new DOMParser();
        const stats = {
            totalTrips: 0, avgSpeedKmh: 0, avgDuration: 0, avgWaiting: 0, avgTimeLoss: 0,
            totalDistanceKm: 0, throughputPerHour: 0, maxSpeedKmh: 0, minSpeedKmh: 0,
            loaded: 0, running: 0, waiting: 0,
            teleports: 0, collisions: 0, byType: {}, timeSeries: [], speedSeries: []
        };

        if (tripinfoXml) {
            const doc = parser.parseFromString(tripinfoXml, 'text/xml');
            const trips = Array.from(doc.querySelectorAll('tripinfo'));
            stats.totalTrips = trips.length;
            let sumDur = 0, sumWait = 0, sumLoss = 0, sumSpeed = 0, speedCount = 0, sumDist = 0;
            let maxSpeed = 0, minSpeed = Infinity, lastDepart = 0, firstDepart = Infinity;

            trips.forEach(t => {
                const duration = parseFloat(t.getAttribute('duration')) || 0;
                const waiting = parseFloat(t.getAttribute('waitingTime')) || 0;
                const timeLoss = parseFloat(t.getAttribute('timeLoss')) || 0;
                const routeLength = parseFloat(t.getAttribute('routeLength')) || 0;
                const depart = parseFloat(t.getAttribute('depart')) || 0;
                const vType = t.getAttribute('vType') || 'unknown';
                const speedKmh = duration > 0 ? (routeLength / duration) * 3.6 : 0;

                sumDur += duration; sumWait += waiting; sumLoss += timeLoss; sumDist += routeLength;
                if (duration > 0) {
                    sumSpeed += speedKmh; speedCount++;
                    if (speedKmh > maxSpeed) maxSpeed = speedKmh;
                    if (speedKmh < minSpeed) minSpeed = speedKmh;
                }
                if (depart > lastDepart) lastDepart = depart;
                if (depart < firstDepart) firstDepart = depart;

                if (!stats.byType[vType]) stats.byType[vType] = { count: 0, sumDuration: 0, sumSpeed: 0, sumWaiting: 0 };
                const b = stats.byType[vType];
                b.count++; b.sumDuration += duration; b.sumSpeed += speedKmh; b.sumWaiting += waiting;
            });

            if (trips.length) {
                stats.avgDuration = sumDur / trips.length;
                stats.avgWaiting = sumWait / trips.length;
                stats.avgTimeLoss = sumLoss / trips.length;
                stats.totalDistanceKm = sumDist / 1000;
                const spanHours = Math.max(1 / 3600, (lastDepart - firstDepart) / 3600);
                stats.throughputPerHour = trips.length / spanHours;
            }
            if (speedCount) {
                stats.avgSpeedKmh = sumSpeed / speedCount;
                stats.maxSpeedKmh = maxSpeed;
                stats.minSpeedKmh = minSpeed === Infinity ? 0 : minSpeed;
            }
        }

        if (summaryXml) {
            const doc = parser.parseFromString(summaryXml, 'text/xml');
            const steps = Array.from(doc.querySelectorAll('step'));
            const stride = Math.max(1, Math.floor(steps.length / 200));
            steps.forEach((s, i) => {
                if (i % stride !== 0) return;
                stats.timeSeries.push(parseFloat(s.getAttribute('time')) || 0);
                stats.speedSeries.push((parseFloat(s.getAttribute('meanSpeed')) || 0) * 3.6);
            });
            const last = steps[steps.length - 1];
            if (last) {
                stats.teleports = parseInt(last.getAttribute('teleports')) || 0;
                stats.collisions = parseInt(last.getAttribute('collisions')) || 0;
                stats.loaded = parseInt(last.getAttribute('loaded')) || 0;
                stats.running = parseInt(last.getAttribute('running')) || 0;
                stats.waiting = parseInt(last.getAttribute('waiting')) || 0;
            }
        }

        this._lastSimResults = stats;
        localStorage.setItem('sumoLastSimResults', JSON.stringify(stats));
        this.renderSimResults();
    },

    renderSimResults() {
        const container = document.getElementById('sim-results-content');
        if (!container) return;
        const stats = this._lastSimResults;
        if (!stats) {
            container.innerHTML = '<p class="placeholder-text">No simulation results yet — click "Run & Analyze" in the header to run SUMO and see vehicle speeds and other characteristics here.</p>';
            return;
        }

        const card = (label, value) => `<div class="card" style="padding:1rem; text-align:center;">
            <div style="font-size:0.8rem; color:var(--text-secondary,#888);">${label}</div>
            <div style="font-size:1.6rem; font-weight:700;">${value}</div>
        </div>`;

        // Guard every field with a fallback — stats may have been saved by an
        // older version of this app that didn't collect all of these yet.
        const n = (v) => (typeof v === 'number' && !isNaN(v)) ? v : 0;
        const los = this._getLOSGrade(n(stats.avgTimeLoss));
        const vTypes = Object.keys(stats.byType);

        container.innerHTML = `
            <div class="stat-box" style="text-align:center; border-top:4px solid ${los.color}; background:${los.color}15; margin-bottom:1.5rem; padding:1rem; border-radius:8px;">
                <div style="font-size:0.8rem; color:var(--text-secondary,#888);">Network Level of Service</div>
                <div style="font-size:2.2rem; font-weight:800; color:${los.color};">${los.grade}</div>
                <div style="font-size:0.85rem; color:var(--text-secondary,#888);">${los.label} — ${n(stats.avgTimeLoss).toFixed(1)}s avg delay/vehicle</div>
            </div>
            <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:1rem; margin-bottom:1rem;">
                ${card('Total Vehicles', n(stats.totalTrips))}
                ${card('Avg Speed', n(stats.avgSpeedKmh).toFixed(1) + ' km/h')}
                ${card('Avg Travel Time', n(stats.avgDuration).toFixed(1) + ' s')}
                ${card('Avg Waiting Time', n(stats.avgWaiting).toFixed(1) + ' s')}
                ${card('Avg Time Loss', n(stats.avgTimeLoss).toFixed(1) + ' s')}
            </div>
            <div style="display:grid; grid-template-columns: repeat(5, 1fr); gap:1rem; margin-bottom:1.5rem;">
                ${card('Total Distance', n(stats.totalDistanceKm).toFixed(1) + ' km')}
                ${card('Throughput', Math.round(n(stats.throughputPerHour)) + ' veh/h')}
                ${card('Speed Range', n(stats.minSpeedKmh).toFixed(0) + '–' + n(stats.maxSpeedKmh).toFixed(0) + ' km/h')}
                ${card('Still Running', n(stats.running))}
                ${card('Still Waiting', n(stats.waiting))}
            </div>
            ${(stats.teleports || stats.collisions) ? `<p style="color:#b91c1c; font-weight:600;">${stats.teleports} teleport(s), ${stats.collisions} collision(s) detected during the run.</p>` : ''}
            <div class="card" style="margin-bottom:1.5rem;">
                <div class="card-header"><h3 class="card-title">By Vehicle Type</h3></div>
                <div class="card-body table-wrapper">
                    <table class="data-table">
                        <thead><tr><th>Type</th><th>Count</th><th>Avg Speed (km/h)</th><th>Avg Travel Time (s)</th><th>Avg Waiting (s)</th></tr></thead>
                        <tbody>
                            ${vTypes.map(vt => {
                                const b = stats.byType[vt];
                                return `<tr><td>${vt}</td><td>${b.count}</td><td>${(b.sumSpeed / b.count).toFixed(1)}</td><td>${(b.sumDuration / b.count).toFixed(1)}</td><td>${(b.sumWaiting / b.count).toFixed(1)}</td></tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.5rem;">
                <div class="card">
                    <div class="card-header"><h3 class="card-title">Mean Network Speed Over Time</h3></div>
                    <div class="card-body" style="position:relative; height:320px;"><canvas id="chart-sim-speed"></canvas></div>
                </div>
                <div class="card">
                    <div class="card-header"><h3 class="card-title">Avg Speed &amp; Waiting by Vehicle Type</h3></div>
                    <div class="card-body" style="position:relative; height:320px;"><canvas id="chart-sim-vtype"></canvas></div>
                </div>
            </div>
        `;

        if (stats.timeSeries.length && window.Chart) {
            const ctx = document.getElementById('chart-sim-speed');
            if (this._simSpeedChart) this._simSpeedChart.destroy();
            this._simSpeedChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: stats.timeSeries.map(t => (t / 60).toFixed(0) + 'm'),
                    datasets: [{
                        label: 'Mean Speed (km/h)', data: stats.speedSeries,
                        borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.1)',
                        tension: 0.2, pointRadius: 0
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: 'km/h' } },
                        x: { title: { display: true, text: 'Simulation time' } }
                    }
                }
            });
        }

        if (vTypes.length && window.Chart) {
            const ctxVt = document.getElementById('chart-sim-vtype');
            if (this._simVtypeChart) this._simVtypeChart.destroy();
            this._simVtypeChart = new Chart(ctxVt, {
                type: 'bar',
                data: {
                    labels: vTypes,
                    datasets: [
                        { label: 'Avg Speed (km/h)', data: vTypes.map(vt => stats.byType[vt].sumSpeed / stats.byType[vt].count), backgroundColor: '#2563eb', yAxisID: 'y' },
                        { label: 'Avg Waiting (s)', data: vTypes.map(vt => stats.byType[vt].sumWaiting / stats.byType[vt].count), backgroundColor: '#ef4444', yAxisID: 'y1' }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        y: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'km/h' } },
                        y1: { type: 'linear', position: 'right', beginAtZero: true, title: { display: true, text: 'seconds' }, grid: { drawOnChartArea: false } }
                    }
                }
            });
        }
    },

    // Same Level-of-Service grading scale used in Emissions Analysis, applied
    // here to the network-wide average delay (time loss) per vehicle.
    _getLOSGrade(delaySec) {
        if (delaySec < 10) return { grade: 'A', color: '#10b981', label: 'Free Flow' };
        if (delaySec < 20) return { grade: 'B', color: '#84cc16', label: 'Stable Flow' };
        if (delaySec < 35) return { grade: 'C', color: '#eab308', label: 'Stable, More Restricted' };
        if (delaySec < 55) return { grade: 'D', color: '#f97316', label: 'Approaching Unstable' };
        if (delaySec <= 80) return { grade: 'E', color: '#ef4444', label: 'Unstable Flow' };
        return { grade: 'F', color: '#991b1b', label: 'Forced / Breakdown Flow' };
    },

    async loadSumoProject() {
        // Desktop (Electron) build: use the native folder dialog + Node fs, which
        // avoids the browser's directory-picker quirks entirely.
        if (window.electronAPI && typeof window.electronAPI.selectFolder === 'function') {
            try {
                const result = await window.electronAPI.selectFolder();
                if (!result) return; // user cancelled
                this.project.name = result.name;
                this.project.folderPath = result.folderPath;
                const files = result.files.map(f => ({ name: f.name, text: async () => f.content }));
                await this._parseProjectFiles(files);
            } catch (e) {
                this.showToast('Could not read folder: ' + e.message, 'error');
            }
            return;
        }

        if (!window.showDirectoryPicker) {
            // Fallback: use webkitdirectory file input
            document.getElementById('file-project-fallback').click();
            return;
        }
        try {
            const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
            this.project.name = dirHandle.name;
            await this._readSumoFolder(dirHandle);
        } catch (e) {
            if (e.name !== 'AbortError') {
                this.showToast('Could not read folder: ' + e.message, 'error');
            }
        }
    },

    handleFolderFallback(event) {
        const files = Array.from(event.target.files);
        if (!files.length) return;
        const folderName = files[0].webkitRelativePath.split('/')[0];
        this.project.name = folderName;
        this._parseProjectFiles(files);
    },

    async _readSumoFolder(dirHandle) {
        const files = [];
        for await (const [name, handle] of dirHandle.entries()) {
            if (handle.kind === 'file') {
                const file = await handle.getFile();
                files.push(file);
            }
        }
        await this._parseProjectFiles(files);
    },

    // Wipes every run/upload RESULT tied to whatever project was previously
    // loaded: Simulation Results, Validation (GEH), MAPE Validation, Emissions
    // Analysis, Dwell Time Analysis. Called right before a new folder's data
    // is applied. Observed GEH/MAPE values are intentionally left alone —
    // they're hand-entered ground truth, not something the app derived from
    // the old folder — but the raw runs/charts they were compared against are
    // cleared since they belonged to the old project's detectors/routes.
    _resetResultsForNewProject() {
        const destroy = (name) => {
            const c = this[name] !== undefined ? this[name] : window[name];
            if (c && typeof c.destroy === 'function') { try { c.destroy(); } catch (e) {} }
        };
        ['_simSpeedChart', '_simVtypeChart'].forEach(n => { destroy(n); this[n] = null; });
        ['chart1', 'chart2', 'chartDelay', 'chartStops', 'chart3', 'chart4', 'chartCO', 'chartHC', 'chartCO2',
         'chartPie', 'chartFuelBarPetrol', 'chartFuelBarDiesel', 'chartTimePenalty',
         'chartDwellTimeloss', 'chartDwellCo2', 'chartDwellNox', 'chartDwellPmx', 'chartDwellCo', 'chartDwellHc',
         'chartDwellFuel', 'chartDwellStops', 'chartDwellFinancial', 'chartDwellSpeed', 'chartDwellTipping', 'chartDwellRelative']
            .forEach(n => { destroy(n); window[n] = null; });

        this._lastSimResults = null;
        this._lastGEHRawData = null;
        this._lastGEHRunName = '';
        this._lastGEHDescription = '';
        this._lastMapeRaw = null;
        this._lastMapeDetectorRaw = null;
        this._lastMapeMode = 'edge';
        this._mapeSegments = [];
        this._lastEmissionsRawXml = null;

        ['sumoLastSimResults', 'sumoLastGEHRawData', 'sumoLastGEHMeta',
         'sumoLastMapeRaw', 'sumoLastMapeDetectorRaw', 'sumoLastMapeMode', 'sumoMapeSegments']
            .forEach(key => { try { localStorage.removeItem(key); } catch (e) {} });

        const clearEl = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
        clearEl('sim-results-content', '<p class="placeholder-text">No simulation results yet — run a project folder through "Run &amp; Analyze".</p>');
        clearEl('validation-results', '<p class="placeholder-text" style="color:var(--text-secondary,#888);">No validation data yet — upload or paste a detector_output.xml file above.</p>');
        clearEl('mape-validation-container', '<p class="placeholder-text" style="color:var(--text-secondary,#888);">No MAPE data yet — upload or paste a detector_output.xml or edgeData file above.</p>');

        const emissionsResults = document.getElementById('emissions-results');
        if (emissionsResults) emissionsResults.style.display = 'none';
        ['a', 'b', 'c', 'd', 'e'].forEach(slot => {
            const fileInput = document.getElementById('file-emissions-scenario-' + slot);
            if (fileInput) fileInput.value = '';
        });

        const dwellResults = document.getElementById('dwell-results');
        if (dwellResults) dwellResults.style.display = 'none';
    },

    async _parseProjectFiles(files) {
        const result = {
            routes: [], vehicleTypes: [], vehicleTypeAttrs: {}, busStops: [], parkingAreas: [], crossings: [],
            crossingEdges: {}, detectors: [], flows: [], parkingFlows: [], pedFlows: [], busDwellFlows: []
        };
        const interesting = files.filter(f =>
            f.name.endsWith('.rou.xml') || f.name.endsWith('.add.xml') ||
            f.name.endsWith('.net.xml') || f.name.endsWith('.sumocfg')
        );

        if (interesting.length === 0) {
            this.showToast('No SUMO files (.rou.xml, .add.xml, .sumocfg) found in folder.', 'error');
            return;
        }

        // A new folder replaces the previous one entirely — clear every
        // folder-derived table/state first so nothing from the old project
        // lingers or gets added on top of the new numbers. This does NOT
        // touch Validation/MAPE observed values or saved runs, since those are
        // separate ground-truth data entered by hand, not derived from a
        // project folder.
        this._flowsState.data = {};
        this._pedState.data = {};
        this._busState.parkingData = {};
        this._busState.dwellData = {};
        this._netLaneGraph = null;

        // Blank every built-in vehicle category back to "nothing defined" (kept
        // vClass only, since that's what makes each category structurally what
        // it is) and drop any project-specific type/param columns from a
        // previous project — _applyProjectToVehicleTypes() below then fills in
        // only what this new project's .rou.xml actually defines.
        VEHICLE_TYPE_NAMES.forEach(id => {
            const blank = { vClass: this.originalVehicleTypes[id].vClass };
            VTYPE_PARAMS.forEach(p => { if (p !== 'vClass') blank[p] = null; });
            VEHICLE_TYPES[id] = blank;
        });
        this._customVehicleTypes = {};
        this._extraVTypeParams = [];

        // A previous project's run RESULTS (Simulation Results, Validation,
        // MAPE, Emissions, Dwell Time Analysis) are just as much "previous
        // folder data" as the input tables above — a new project's detector
        // ids/routes won't match, so leaving old charts/tables on screen is
        // actively misleading, not just stale.
        this._resetResultsForNewProject();

        const parser = new DOMParser();
        for (const file of interesting) {
            try {
                const text = await file.text();
                const xml = parser.parseFromString(text, 'text/xml');

                if (file.name.endsWith('.sumocfg')) {
                    result.sumocfgName = file.name;
                    const startEl = xml.querySelector('[value]');
                    const beginEl = xml.querySelector('begin');
                    const endEl   = xml.querySelector('end');
                    if (beginEl) {
                        const beginSec = parseFloat(beginEl.getAttribute('value') || 0);
                        const hrs = Math.floor(beginSec / 3600);
                        const mins = Math.floor((beginSec % 3600) / 60);
                        this.project.simStartTime = String(hrs).padStart(2,'0') + ':' + String(mins).padStart(2,'0');
                    }
                    if (beginEl && endEl) {
                        const dur = Math.round((parseFloat(endEl.getAttribute('value')) - parseFloat(beginEl.getAttribute('value'))) / 60);
                        this.project.simDuration = dur;
                    }
                }

                if (file.name.endsWith('.rou.xml')) {
                    xml.querySelectorAll('route[id]').forEach(el => {
                        const id = el.getAttribute('id');
                        if (id && !result.routes.includes(id)) result.routes.push(id);
                    });
                    xml.querySelectorAll('vType[id]').forEach(el => {
                        const id = el.getAttribute('id');
                        if (!id) return;
                        if (!result.vehicleTypes.includes(id)) result.vehicleTypes.push(id);
                        // Capture every attribute the project actually defines for this
                        // vType (whatever it may be) so the Vehicle Params tab can be
                        // built from the project's real data instead of this app's
                        // built-in defaults — see _applyProjectToVehicleTypes().
                        const attrs = {};
                        for (const attr of el.attributes) {
                            if (attr.name === 'id') continue;
                            attrs[attr.name] = attr.value;
                        }
                        result.vehicleTypeAttrs[id] = attrs;
                    });
                    // Existing <flow> demand already in the project — used to auto-fill
                    // the Flows/Parking interval tables instead of leaving them blank.
                    xml.querySelectorAll('flow').forEach(el => {
                        const routeId = el.getAttribute('route');
                        const type = el.getAttribute('type');
                        const begin = parseFloat(el.getAttribute('begin'));
                        const end = parseFloat(el.getAttribute('end'));
                        const number = el.getAttribute('number');
                        if (!routeId || !type || isNaN(begin) || isNaN(end) || number === null) return;
                        const stopEl = el.querySelector('stop[parkingArea]');
                        if (stopEl) {
                            result.parkingFlows.push({
                                parkingArea: stopEl.getAttribute('parkingArea'),
                                route: routeId, type, begin, end,
                                number: parseInt(number) || 0,
                                duration: parseFloat(stopEl.getAttribute('duration')) || null
                            });
                        } else {
                            result.flows.push({ route: routeId, type, begin, end, number: parseInt(number) || 0 });
                        }
                    });
                    // Existing pedestrian personFlows. Two SUMO shapes are in use
                    // across projects: an explicit <walk edges="..."> (matched to a
                    // crossing by comparing edge lists) or a <personTrip from=".."
                    // to=".."/> where SUMO computes the path itself, leaving no edge
                    // list to compare — for that shape we fall back to the
                    // personFlow's own id (e.g. "c0_in_600", 0-based crossing index
                    // + in/out direction) in _applyParsedPedData.
                    xml.querySelectorAll('personFlow').forEach(el => {
                        const id = el.getAttribute('id') || '';
                        const begin = parseFloat(el.getAttribute('begin'));
                        const end = parseFloat(el.getAttribute('end'));
                        const number = parseInt(el.getAttribute('number')) || 0;
                        if (isNaN(begin) || number <= 0) return;
                        const walk = el.querySelector('walk[edges]');
                        if (walk) {
                            const edgesStr = (walk.getAttribute('edges') || '').trim();
                            if (!edgesStr) return;
                            result.pedFlows.push({ id, edgesStr, begin, end: isNaN(end) ? begin : end, number });
                            return;
                        }
                        const trip = el.querySelector('personTrip[from][to]');
                        if (trip) {
                            result.pedFlows.push({
                                id,
                                fromEdge: trip.getAttribute('from'),
                                toEdge: trip.getAttribute('to'),
                                begin, end: isNaN(end) ? begin : end, number
                            });
                        }
                    });
                    // Existing bus dwell durations — <stop busStop="..."> nested in a flow/vehicle.
                    xml.querySelectorAll('flow > stop[busStop], vehicle > stop[busStop]').forEach(el => {
                        const parent = el.parentElement;
                        const begin = parseFloat(parent.getAttribute('begin'));
                        const duration = parseFloat(el.getAttribute('duration'));
                        const busStop = el.getAttribute('busStop');
                        if (!busStop || isNaN(begin) || isNaN(duration)) return;
                        result.busDwellFlows.push({ busStop, begin, duration });
                    });
                }

                if (file.name.endsWith('.add.xml')) {
                    xml.querySelectorAll('busStop[id]').forEach(el => {
                        const id = el.getAttribute('id');
                        if (id && !result.busStops.some(b => b.id === id)) {
                            result.busStops.push({
                                id,
                                lane: el.getAttribute('lane') || '',
                                startPos: parseFloat(el.getAttribute('startPos')) || 0,
                                endPos: parseFloat(el.getAttribute('endPos')) || 0,
                                lines: el.getAttribute('lines') || ''
                            });
                        }
                    });
                    xml.querySelectorAll('parkingArea[id]').forEach(el => {
                        const id = el.getAttribute('id');
                        if (id && !result.parkingAreas.some(p => p.id === id)) {
                            result.parkingAreas.push({
                                id,
                                lane: el.getAttribute('lane') || '',
                                startPos: parseFloat(el.getAttribute('startPos')) || 0,
                                endPos: parseFloat(el.getAttribute('endPos')) || 0,
                                angle: parseFloat(el.getAttribute('angle')) || 0,
                                capacity: parseInt(el.getAttribute('roadsideCapacity')) || 0
                            });
                        }
                    });
                    xml.querySelectorAll('crossing[id], walkingArea[id]').forEach(el => {
                        const id = el.getAttribute('id');
                        if (id && !result.crossings.includes(id)) {
                            result.crossings.push(id);
                            result.crossingEdges[id] = el.getAttribute('edges') || '';
                        }
                    });
                    xml.querySelectorAll('e1Detector[id], inductionLoop[id], e2Detector[id], laneAreaDetector[id]').forEach(el => {
                        const id = el.getAttribute('id');
                        if (id && !result.detectors.some(d => d.id === id)) {
                            result.detectors.push({
                                id,
                                lane: el.getAttribute('lane') || '',
                                pos: parseFloat(el.getAttribute('pos')) || 0
                            });
                        }
                    });
                }

                // .net.xml: build a lane-level distance graph (lane length +
                // legal lane-to-lane connections, including internal junction
                // lanes via the connection's `via` attribute) so segment
                // distances between two detectors can be computed automatically
                // instead of requiring manual entry. Kept in memory only
                // (not persisted) since real networks can be large.
                if (file.name.endsWith('.net.xml')) {
                    const laneLength = {};
                    xml.querySelectorAll('edge > lane[id]').forEach(el => {
                        const id = el.getAttribute('id');
                        const len = parseFloat(el.getAttribute('length'));
                        if (id && !isNaN(len)) laneLength[id] = len;
                    });
                    const adjacency = {};
                    const addEdge = (a, b) => { if (!a || !b) return; (adjacency[a] = adjacency[a] || []).push(b); };
                    xml.querySelectorAll('connection[from][to][fromLane][toLane]').forEach(el => {
                        const fromId = `${el.getAttribute('from')}_${el.getAttribute('fromLane')}`;
                        const toId = `${el.getAttribute('to')}_${el.getAttribute('toLane')}`;
                        const via = el.getAttribute('via');
                        if (via) { addEdge(fromId, via); addEdge(via, toId); }
                        else addEdge(fromId, toId);
                    });
                    if (Object.keys(laneLength).length) {
                        this._netLaneGraph = { laneLength, adjacency };
                    }
                }
            } catch (e) {
                console.warn('Could not parse', file.name, e);
            }
        }

        Object.assign(this.project, result);
        localStorage.setItem('sumoProject', JSON.stringify(this.project));

        // Update header
        const nameEl = document.getElementById('project-name-display');
        if (nameEl) nameEl.textContent = this.project.name;
        document.getElementById('sim-start-time').value = this.project.simStartTime;
        document.getElementById('sim-duration').value   = this.project.simDuration;

        // Auto-populate tabs
        this._applyProjectToVehicleTypes(result.vehicleTypeAttrs);
        this._applyProjectToFlows();
        this._applyProjectToPedestrians();
        this._applyProjectToBus();
        this._applyProjectToParking();

        const usedTypes = new Set();
        result.flows.forEach(f => usedTypes.add(f.type));
        result.parkingFlows.forEach(f => usedTypes.add(f.type));
        const unmapped = Array.from(usedTypes).filter(t => !FLOW_VEHICLE_TYPES.includes(t) && !this._vTypeMap[t]);

        if (unmapped.length) {
            this._pendingFlowImport = { flows: result.flows, parkingFlows: result.parkingFlows };
            this._openVTypeMapModal(unmapped);
            // Bus dwell has no vehicle type, so it doesn't need to wait on the modal.
            this._applyParsedFlowData([], [], result.busDwellFlows);
        } else {
            this._applyParsedFlowData(result.flows, result.parkingFlows, result.busDwellFlows);
        }
        // Pedestrian walks carry no vehicle type either — apply right away.
        this._applyParsedPedData(result.pedFlows);

        // If this same project folder previously had Emissions Analysis data
        // uploaded, restore it from disk (see _persistEmissionsRawXml) — this
        // is the one result tab whose raw data isn't already in localStorage.
        this._restoreEmissionsCache();

        const summary = [
            result.routes.length + ' routes',
            result.vehicleTypes.length + ' vehicle types',
            result.busStops.length + ' bus stops',
            result.parkingAreas.length + ' parking areas',
            result.crossings.length + ' crossings',
        ].filter(s => !s.startsWith('0')).join(', ');

        this.showToast('Project loaded: ' + (summary || 'no items found'), result.routes.length > 0 ? 'success' : 'info');
    },

    // Fills the Flows/Parking interval tables directly from <flow> demand that
    // already exists in the uploaded .rou.xml, instead of leaving cells blank
    // and forcing the user to re-type counts the project already has.
    _applyParsedFlowData(flows, parkingFlows, busDwellFlows) {
        flows = flows || [];
        parkingFlows = parkingFlows || [];
        busDwellFlows = busDwellFlows || [];
        if (!flows.length && !parkingFlows.length && !busDwellFlows.length) return;

        const beginSet = new Set();
        flows.forEach(f => beginSet.add(f.begin));
        parkingFlows.forEach(f => beginSet.add(f.begin));
        busDwellFlows.forEach(f => beginSet.add(f.begin));
        const begins = Array.from(beginSet).sort((a, b) => a - b);
        if (!begins.length) return;

        const findInterval = (begin) => {
            let best = -1, bestDiff = Infinity;
            begins.forEach((b, i) => {
                const diff = Math.abs(b - begin);
                if (diff < bestDiff) { bestDiff = diff; best = i; }
            });
            return best;
        };

        const first = flows[0] || parkingFlows[0];
        // Bus dwell entries carry no 'end', so interval duration falls back to
        // whatever's already configured when only dwell data is present.
        const durationMin = first ? Math.max(1, Math.round((first.end - first.begin) / 60)) : (this._busState.intervalDuration || 10);

        let appliedFlows = 0, appliedParking = 0, appliedDwell = 0;

        if (flows.length) {
            const countEl = document.getElementById('flows-interval-count');
            const durEl = document.getElementById('flows-interval-duration');
            if (countEl) countEl.value = begins.length;
            if (durEl) durEl.value = durationMin;

            const routeIdx = {};
            this._flowsState.routes.forEach((r, i) => { routeIdx[r.id] = i; });

            flows.forEach(f => {
                const ri = routeIdx[f.route];
                const bucket = FLOW_VEHICLE_TYPES.includes(f.type) ? f.type : this._vTypeMap[f.type];
                if (ri === undefined || !bucket) return;
                const ii = findInterval(f.begin);
                if (ii < 0) return;
                const key = `${ri}_${ii}_${bucket}`;
                this._flowsState.data[key] = (parseInt(this._flowsState.data[key]) || 0) + f.number;
                appliedFlows++;
            });
            this.rebuildFlowsTable();
        }

        if (parkingFlows.length || busDwellFlows.length) {
            this._busState.intervals = begins.length;
            this._busState.intervalDuration = durationMin;
            const countEl = document.getElementById('bus-interval-count');
            const durEl = document.getElementById('bus-interval-duration');
            if (countEl) countEl.value = begins.length;
            if (durEl) durEl.value = durationMin;
        }

        if (parkingFlows.length) {
            const areaIdx = {};
            this._busState.parkingAreas.forEach((a, i) => { areaIdx[a.id] = i; });

            parkingFlows.forEach(f => {
                const ai = areaIdx[f.parkingArea];
                const bucket = FLOW_VEHICLE_TYPES.includes(f.type) ? f.type : this._vTypeMap[f.type];
                if (ai === undefined || !bucket) return;
                const ii = findInterval(f.begin);
                if (ii < 0) return;
                const key = `${ai}_${ii}_${bucket}`;
                this._busState.parkingData[key] = (parseInt(this._busState.parkingData[key]) || 0) + f.number;
                if (f.route) this._busState.parkingAreas[ai].routeId = f.route;
                if (f.duration) this._busState.parkingAreas[ai].duration = f.duration;
                appliedParking++;
            });
            this.rebuildParkingTable();
        }

        if (busDwellFlows.length) {
            const stopIdx = {};
            this._busState.stops.forEach((s, i) => { stopIdx[s.id] = i; });

            busDwellFlows.forEach(f => {
                const si = stopIdx[f.busStop];
                if (si === undefined) return;
                const ii = findInterval(f.begin);
                if (ii < 0) return;
                this._busState.dwellData[`${si}_${ii}`] = f.duration;
                appliedDwell++;
            });
            this.rebuildBusDwellTable();
        }

        if (appliedFlows || appliedParking || appliedDwell) {
            this.saveToLocal();
            const parts = [];
            if (appliedFlows) parts.push(`${appliedFlows} flow cell${appliedFlows === 1 ? '' : 's'}`);
            if (appliedParking) parts.push(`${appliedParking} parking cell${appliedParking === 1 ? '' : 's'}`);
            if (appliedDwell) parts.push(`${appliedDwell} bus dwell cell${appliedDwell === 1 ? '' : 's'}`);
            this.showToast(`Auto-filled ${parts.join(', ')} from existing SUMO data.`, 'success');
        }
    },

    // Pedestrian personFlows have no vehicle type, so unlike flows/parking/dwell
    // they never need the vType mapping step — matched to a crossing by checking
    // whether the crossing's own edges appear (forward or reversed) in the walk.
    _applyParsedPedData(pedFlows) {
        pedFlows = pedFlows || [];
        if (!pedFlows.length) return;

        const beginSet = new Set();
        pedFlows.forEach(f => beginSet.add(f.begin));
        const begins = Array.from(beginSet).sort((a, b) => a - b);
        if (!begins.length) return;

        // Nearest-interval and crossing-matching logic live in
        // pedMatching.js (unit-tested in tests/pedMatching.test.js) so the
        // exact same code can run in isolation under Node.
        const findInterval = (begin) => findNearestIntervalIndex(begin, begins);

        const first = pedFlows[0];
        const durationMin = Math.max(1, Math.round((first.end - first.begin) / 60));

        const countEl = document.getElementById('ped-interval-count');
        const durEl = document.getElementById('ped-interval-duration');
        if (countEl) countEl.value = begins.length;
        if (durEl) durEl.value = durationMin;

        // Grow the crossing list first if any personFlow references an index
        // beyond what's currently configured, so that data is never silently
        // dropped just because "Number of crossings" was set too low.
        let maxIdIndex = -1;
        pedFlows.forEach(f => {
            const m = (f.id || '').match(ID_PATTERN);
            if (m) maxIdIndex = Math.max(maxIdIndex, parseInt(m[1], 10));
        });
        if (maxIdIndex >= this._pedState.crossings.length) {
            const countEl2 = document.getElementById('ped-crossing-count');
            if (countEl2) countEl2.value = maxIdIndex + 1;
            this.rebuildPedSetup();
        }

        const crossings = this._pedState.crossings;
        let applied = 0;

        pedFlows.forEach(f => {
            // Which crossing/direction this personFlow belongs to (via a
            // <walk edges="..."> subsequence match or a personTrip id-naming
            // convention) is decided by pedMatching.js's
            // matchPedFlowToCrossing() — unit-tested in tests/pedMatching.test.js.
            const { crossingIndex: ci, direction: dir } = matchPedFlowToCrossing(f, crossings, this.project.crossingEdges);

            if (ci < 0) return;
            const ii = findInterval(f.begin);
            if (ii < 0) return;
            const key = `${ci}_${ii}_${dir}`;
            this._pedState.data[key] = (parseInt(this._pedState.data[key]) || 0) + f.number;
            applied++;
        });

        this.rebuildPedTable();
        if (applied) {
            this.saveToLocal();
            this.showToast(`Auto-filled ${applied} pedestrian cell${applied === 1 ? '' : 's'} from existing SUMO data.`, 'success');
        } else {
            this.showToast(`Found ${pedFlows.length} pedestrian flow(s) in the .rou.xml, but none matched a crossing — check that walk edges cover your crossing's "edges" attribute, or that personTrip-based flow ids follow the "cN_in/out_..." pattern.`, 'info');
        }
    },

    _guessVTypeCategory(rawId) {
        const s = (rawId || '').toLowerCase();
        if (/(moto|bike|cycle)/.test(s)) return 'motorcycle';
        if (/(tuk|three.?wheel|trishaw|auto.?rick)/.test(s)) return 'tuk_tuk';
        if (/(bus|coach)/.test(s)) return 'heavy_bus';
        if (/(truck|lorry|hgv)/.test(s)) return 'truck';
        if (/(van|minibus|mini.?bus)/.test(s)) return 'van';
        return 'passenger_car';
    },

    _openVTypeMapModal(types) {
        const list = document.getElementById('vtype-map-list');
        if (!list) { this.closeVTypeMapModal(); return; }
        const CATEGORY_LABELS = { motorcycle: 'Bike/Motorcycle', tuk_tuk: 'Tuk-Tuk', passenger_car: 'Car', heavy_bus: 'Bus', van: 'Van', truck: 'Truck' };
        list.innerHTML = types.map(t => {
            const guess = this._guessVTypeCategory(t);
            return `<label style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; font-size:0.85rem;">
                <span><code>${t}</code></span>
                <select data-raw-type="${t}" style="padding:0.3rem 0.5rem; border:1px solid #ccc; border-radius:4px;">
                    ${FLOW_VEHICLE_TYPES.map(c => `<option value="${c}" ${c === guess ? 'selected' : ''}>${CATEGORY_LABELS[c]}</option>`).join('')}
                </select>
            </label>`;
        }).join('');
        document.getElementById('vtype-map-modal').style.display = 'flex';
    },

    closeVTypeMapModal() {
        const modal = document.getElementById('vtype-map-modal');
        if (modal) modal.style.display = 'none';
        if (this._pendingFlowImport) {
            this._applyParsedFlowData(this._pendingFlowImport.flows, this._pendingFlowImport.parkingFlows);
            this._pendingFlowImport = null;
        }
    },

    saveVTypeMapModal() {
        document.querySelectorAll('#vtype-map-list select[data-raw-type]').forEach(sel => {
            this._vTypeMap[sel.dataset.rawType] = sel.value;
        });
        localStorage.setItem('sumoVTypeMap', JSON.stringify(this._vTypeMap));
        document.getElementById('vtype-map-modal').style.display = 'none';
        if (this._pendingFlowImport) {
            this._applyParsedFlowData(this._pendingFlowImport.flows, this._pendingFlowImport.parkingFlows);
            this._pendingFlowImport = null;
        }
    },

    // Reads whatever vTypes the project's .rou.xml actually defines and uses
    // them to populate the Vehicle Params tab — a category matching one of
    // the 7 built-in ids gets its real values (attributes it doesn't define
    // stay blank, already reset to null by _parseProjectFiles above); a vType
    // id that doesn't match any built-in category becomes an extra column;
    // an attribute this interface doesn't already have a row for becomes an
    // extra row. Never invents a value the project didn't actually specify.
    _applyProjectToVehicleTypes(vehicleTypeAttrs) {
        if (!vehicleTypeAttrs || !Object.keys(vehicleTypeAttrs).length) {
            this.renderVehicleTypeTable();
            return;
        }

        const STRING_PARAMS = new Set(['vClass', 'emissionClass', 'color', 'latAlignment']);
        const parseSpeedFactor = (raw) => {
            const m = /normc\(\s*([\d.]+)\s*,\s*([\d.]+)/.exec(raw || '');
            if (m) return { speedFactor: parseFloat(m[1]), speedDev: parseFloat(m[2]) };
            const num = parseFloat(raw);
            return isNaN(num) ? {} : { speedFactor: num };
        };

        Object.keys(vehicleTypeAttrs).forEach(id => {
            const attrs = vehicleTypeAttrs[id] || {};
            const isKnownCategory = Object.prototype.hasOwnProperty.call(VEHICLE_TYPES, id);
            const target = isKnownCategory ? VEHICLE_TYPES[id] : {};
            if (!isKnownCategory) VTYPE_PARAMS.forEach(p => { target[p] = null; });

            Object.keys(attrs).forEach(attrName => {
                if (attrName === 'speedFactor') {
                    const sf = parseSpeedFactor(attrs.speedFactor);
                    if (sf.speedFactor !== undefined) target.speedFactor = sf.speedFactor;
                    if (sf.speedDev !== undefined) target.speedDev = sf.speedDev;
                    return;
                }
                const raw = attrs[attrName];
                const isKnownParam = VTYPE_PARAMS.includes(attrName);
                if (!isKnownParam && !this._extraVTypeParams.includes(attrName)) {
                    this._extraVTypeParams.push(attrName);
                }
                const useString = STRING_PARAMS.has(attrName) || isNaN(parseFloat(raw));
                target[attrName] = useString ? raw : parseFloat(raw);
            });

            if (isKnownCategory) VEHICLE_TYPES[id] = target;
            else this._customVehicleTypes[id] = target;
        });

        this.renderVehicleTypeTable();
    },

    // These always rebuild (even with an empty list) rather than returning
    // early when a newly-loaded folder has nothing for this category — a
    // folder that has no crossings, say, should clear the Pedestrians tab
    // back to blank, not leave the previous folder's crossings sitting there.
    _applyProjectToFlows() {
        const routes = this.project.routes || [];
        const countEl = document.getElementById('flows-route-count');
        if (countEl) { countEl.value = routes.length; }
        this.rebuildFlowsSetup(routes);
    },

    _applyProjectToPedestrians() {
        const crossings = this.project.crossings || [];
        const countEl = document.getElementById('ped-crossing-count');
        if (countEl) { countEl.value = crossings.length; }
        this.rebuildPedSetup(crossings);
    },

    _applyProjectToBus() {
        const stops = this.project.busStops || [];
        const countEl = document.getElementById('bus-stop-count');
        if (countEl) { countEl.value = stops.length; }
        this.rebuildBusSetup(stops);
    },

    _applyProjectToParking() {
        const areas = this.project.parkingAreas || [];
        const countEl = document.getElementById('parking-area-count');
        if (countEl) { countEl.value = areas.length; }
        this.rebuildParkingSetup(areas);
    },

    // =====================================================================
    // SIM SETTINGS SAVE/LOAD
    // =====================================================================
    saveSimSettings() {
        const settings = {
            simStartTime: document.getElementById('sim-start-time')?.value || '06:30',
            simDuration: document.getElementById('sim-duration')?.value || '100',
            simStep: document.getElementById('sim-step')?.value || '0.1',
        };
        localStorage.setItem('sumoSimSettings', JSON.stringify(settings));
    },

    // Called when the header's Sim Start / Duration fields change — every table's
    // time-interval labels are computed from these, so they all need a re-render.
    onSimTimeChange() {
        this.saveSimSettings();
        if (typeof this.rebuildFlowsTable === 'function') this.rebuildFlowsTable();
        if (typeof this.rebuildPedTable === 'function') this.rebuildPedTable();
        if (typeof this.rebuildBusDwellTable === 'function') this.rebuildBusDwellTable();
        if (typeof this.rebuildParkingTable === 'function') this.rebuildParkingTable();
        if (this._lastGEHRawData) this.renderLastValidation();
        // MAPE has two independent data paths (edge/meandata vs. detector-pair
        // segments) — re-render whichever one is actually active, not just the
        // edge one, since both display Sim Start Time-derived clock labels.
        if (this._lastMapeMode === 'detector' && this._lastMapeDetectorRaw) this._renderMapeFromDetectorRaw(this._lastMapeDetectorRaw);
        else if (this._lastMapeRaw) this._renderMapeFromRaw(this._lastMapeRaw);
        // Emissions time bins are re-parsed (not just relabeled) since bin
        // width itself depends on Duration, not just Sim Start Time.
        this._rerenderEmissionsForTimeChange().catch(e => console.warn('Emissions re-render failed:', e));
    },

    loadSimSettings() {
        try {
            const stored = localStorage.getItem('sumoProject');
            if (stored) {
                const proj = JSON.parse(stored);
                if (proj.name) {
                    const nameEl = document.getElementById('project-name-display');
                    if (nameEl) nameEl.textContent = proj.name;
                    Object.assign(this.project, proj);
                }
            }
            const ss = localStorage.getItem('sumoSimSettings');
            if (ss) {
                const s = JSON.parse(ss);
                if (document.getElementById('sim-start-time')) document.getElementById('sim-start-time').value = s.simStartTime || '06:30';
                if (document.getElementById('sim-duration'))   document.getElementById('sim-duration').value   = s.simDuration || '100';
                if (document.getElementById('sim-step'))       document.getElementById('sim-step').value       = s.simStep || '0.1';
            }
        } catch(e) { console.warn('loadSimSettings error', e); }
    },

    // =====================================================================
    // DYNAMIC FLOWS TABLE
    // =====================================================================
    _flowsState: { routes: [], intervals: 8, intervalDuration: 10, data: {} },

    // Shared by rebuildFlowsSetup/rebuildPedSetup/rebuildBusSetup/rebuildParkingSetup.
    // When a folder re-upload changes which ids exist (or their order), this carries
    // each item's entered data cells over by matching id — not by index — and drops
    // cells for ids that no longer exist, so stale data from a previous/different
    // project never shows up under the wrong route/crossing/stop/area.
    _remapIndexedData(existingItems, newIds, dataObjects) {
        const oldIdToIndex = {};
        existingItems.forEach((item, i) => { oldIdToIndex[item.id] = i; });
        const oldIdxForNewIdx = {};
        newIds.forEach((id, newIdx) => {
            if (oldIdToIndex[id] !== undefined) oldIdxForNewIdx[newIdx] = oldIdToIndex[id];
        });
        return dataObjects.map(oldData => {
            const newData = {};
            Object.keys(oldData).forEach(key => {
                const sep = key.indexOf('_');
                const oldIdx = parseInt(key.slice(0, sep));
                const rest = key.slice(sep);
                Object.keys(oldIdxForNewIdx).forEach(newIdx => {
                    if (oldIdxForNewIdx[newIdx] === oldIdx) newData[`${newIdx}${rest}`] = oldData[key];
                });
            });
            return newData;
        });
    },

    rebuildFlowsSetup(routeIds) {
        const count = routeIds ? routeIds.length : parseInt(document.getElementById('flows-route-count')?.value || 2);
        const config = document.getElementById('flows-route-config');
        if (!config) return;

        const existing = this._flowsState.routes;
        const newIds = [];
        for (let i = 0; i < count; i++) {
            newIds.push(routeIds ? routeIds[i] : (existing[i]?.id || ('route_' + (i+1))));
        }
        if (routeIds) {
            [this._flowsState.data] = this._remapIndexedData(existing, newIds, [this._flowsState.data]);
        }

        const oldIdToName = {};
        existing.forEach(r => { oldIdToName[r.id] = r.name; });
        const newRoutes = newIds.map((id, i) => ({
            id,
            name: oldIdToName[id] || (routeIds ? id : ('Route ' + (i+1)))
        }));
        this._flowsState.routes = newRoutes;

        config.innerHTML = '';
        newRoutes.forEach((r, i) => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; flex-direction:column; gap:0.3rem; min-width:160px;';
            div.innerHTML = `
                <label style="font-size:0.78rem; color:var(--text-secondary,#888); font-weight:500;">Route ${i+1} ID: <code style="font-size:0.78rem;">${r.id}</code></label>
                <input type="text" value="${r.name}" placeholder="Friendly name"
                    style="padding:0.3rem 0.5rem; border:1px solid #ccc; border-radius:4px; font-size:0.85rem; width:160px;"
                    oninput="App._flowsState.routes[${i}].name = this.value; App.rebuildFlowsTable();">
            `;
            config.appendChild(div);
        });

        this.rebuildFlowsTable();
    },

    rebuildFlowsTable() {
        const wrapper = document.getElementById('flows-table-wrapper');
        if (!wrapper) return;
        const intervals = parseInt(document.getElementById('flows-interval-count')?.value || 8);
        const duration  = parseInt(document.getElementById('flows-interval-duration')?.value || 10);
        this._flowsState.intervals = intervals;
        this._flowsState.intervalDuration = duration;

        const routes = this._flowsState.routes;
        if (!routes.length) { wrapper.innerHTML = '<p class="placeholder-text">Add routes above first.</p>'; return; }

        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        let totalMin = sh * 60 + sm;

        const VTYPES = ['motorcycle', 'tuk_tuk', 'passenger_car', 'heavy_bus', 'van', 'truck'];
        const VLABELS = ['Bike', 'Tuk-Tuk', 'Car', 'Bus', 'Van', 'Truck'];

        let html = '<table class="data-table" style="font-size:0.82rem; min-width:700px;"><thead><tr><th>Interval</th>';
        routes.forEach(r => {
            html += `<th colspan="${VTYPES.length}" style="text-align:center; border-left:2px solid #ccc;">${r.name}</th>`;
        });
        html += '</tr><tr><th></th>';
        routes.forEach(() => {
            VLABELS.forEach(vl => { html += `<th style="font-weight:500; font-size:0.78rem;">${vl}</th>`; });
        });
        html += '</tr></thead><tbody>';

        for (let i = 0; i < intervals; i++) {
            const hh = Math.floor(totalMin / 60);
            const mm = totalMin % 60;
            const nextMin = totalMin + duration;
            const nh = Math.floor(nextMin / 60);
            const nm = nextMin % 60;
            const label = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} - ${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
            totalMin += duration;

            html += `<tr><td style="white-space:nowrap; font-weight:500;">${label}</td>`;
            routes.forEach((r, ri) => {
                VTYPES.forEach((vt, vi) => {
                    const key = `${ri}_${i}_${vt}`;
                    const val = this._flowsState.data[key] || '';
                    html += `<td style="border-left: ${vi===0?'2px solid #ccc':'none'};"><input type="number" min="0" value="${val}"
                        oninput="App._flowsState.data['${key}'] = this.value"
                        style="width:52px; padding:2px 4px; text-align:center; border:1px solid #ddd; border-radius:3px; font-size:0.8rem;"></td>`;
                });
            });
            html += '</tr>';
        }
        html += '</tbody></table>';
        wrapper.innerHTML = html;
    },

    copyFlowsXML() {
        const routes = this._flowsState.routes;
        const intervals = this._flowsState.intervals;
        const duration  = this._flowsState.intervalDuration;
        const VTYPES = ['motorcycle', 'tuk_tuk', 'passenger_car', 'heavy_bus', 'van', 'truck'];
        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        let totalSec = sh * 3600 + sm * 60;
        const durSec = duration * 60;

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<routes>\n';
        for (let i = 0; i < intervals; i++) {
            const begin = totalSec, end = totalSec + durSec;
            routes.forEach((r, ri) => {
                VTYPES.forEach(vt => {
                    const val = parseInt(this._flowsState.data[`${ri}_${i}_${vt}`] || 0);
                    if (val > 0) {
                        xml += `  <flow id="flow_${r.id}_${vt}_${i}" route="${r.id}" type="${vt}" begin="${begin}" end="${end}" number="${val}"/>
`;
                    }
                });
            });
            totalSec += durSec;
        }
        xml += '</routes>';
        navigator.clipboard.writeText(xml).then(() => this.showToast('Flow XML copied!', 'success'))
            .catch(() => this.showToast('Copy failed — check browser permissions.', 'error'));
    },

    resetFlowsTable() {
        this._flowsState.data = {};
        this.rebuildFlowsTable();
        this.showToast('Flow table cleared.', 'info');
    },

    // =====================================================================
    // DYNAMIC PEDESTRIANS TABLE
    // =====================================================================
    _pedState: { crossings: [], intervals: 8, intervalDuration: 10, data: {} },

    rebuildPedSetup(crossingIds) {
        const count = crossingIds ? crossingIds.length : parseInt(document.getElementById('ped-crossing-count')?.value || 3);
        const config = document.getElementById('ped-crossing-config');
        if (!config) return;

        const existing = this._pedState.crossings;
        const newIds = [];
        for (let i = 0; i < count; i++) {
            newIds.push(crossingIds ? crossingIds[i] : (existing[i]?.id || ('crossing_' + (i+1))));
        }
        if (crossingIds) {
            [this._pedState.data] = this._remapIndexedData(existing, newIds, [this._pedState.data]);
        }

        const oldIdToName = {};
        existing.forEach(c => { oldIdToName[c.id] = c.name; });
        const newCrossings = newIds.map((id, i) => ({
            id,
            name: oldIdToName[id] || (crossingIds ? id : ('Crossing ' + (i+1)))
        }));
        this._pedState.crossings = newCrossings;

        config.innerHTML = '';
        newCrossings.forEach((c, i) => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; flex-direction:column; gap:0.3rem; min-width:160px;';
            div.innerHTML = `
                <label style="font-size:0.78rem; color:var(--text-secondary,#888); font-weight:500;">Crossing ${i+1} ID: <code style="font-size:0.78rem;">${c.id}</code></label>
                <input type="text" value="${c.name}" placeholder="Friendly name"
                    style="padding:0.3rem 0.5rem; border:1px solid #ccc; border-radius:4px; font-size:0.85rem; width:160px;"
                    oninput="App._pedState.crossings[${i}].name = this.value; App.rebuildPedTable();">
            `;
            config.appendChild(div);
        });

        this.rebuildPedTable();
    },

    rebuildPedTable() {
        const wrapper = document.getElementById('ped-dynamic-table-wrapper');
        if (!wrapper) return;
        const intervals = parseInt(document.getElementById('ped-interval-count')?.value || 8);
        const duration  = parseInt(document.getElementById('ped-interval-duration')?.value || 10);
        this._pedState.intervals = intervals;
        this._pedState.intervalDuration = duration;

        const crossings = this._pedState.crossings;
        if (!crossings.length) { wrapper.innerHTML = ''; return; }

        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        let totalMin = sh * 60 + sm;

        let html = '<table class="data-table" style="font-size:0.82rem;"><thead><tr><th>Interval</th>';
        crossings.forEach(c => {
            html += `<th colspan="2" style="text-align:center; border-left:2px solid #ccc;">${c.name}</th>`;
        });
        html += '</tr><tr><th></th>';
        crossings.forEach(() => {
            html += '<th style="font-size:0.78rem;">→ Forward</th><th style="font-size:0.78rem;">← Reverse</th>';
        });
        html += '</tr></thead><tbody>';

        for (let i = 0; i < intervals; i++) {
            const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
            const nm = totalMin + duration;
            const label = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} - ${String(Math.floor(nm/60)).padStart(2,'0')}:${String(nm%60).padStart(2,'0')}`;
            totalMin += duration;
            html += `<tr><td style="white-space:nowrap; font-weight:500;">${label}</td>`;
            crossings.forEach((c, ci) => {
                ['fwd','rev'].forEach(dir => {
                    const key = `${ci}_${i}_${dir}`;
                    const val = this._pedState.data[key] || '';
                    html += `<td style="border-left:${dir==='fwd'?'2px solid #ccc':'none'};"><input type="number" min="0" value="${val}"
                        oninput="App._pedState.data['${key}']=this.value"
                        style="width:52px; padding:2px 4px; text-align:center; border:1px solid #ddd; border-radius:3px; font-size:0.8rem;"></td>`;
                });
            });
            html += '</tr>';
        }
        html += '</tbody></table>';
        wrapper.innerHTML = html;
    },

    // =====================================================================
    // HELP SYSTEM
    // =====================================================================
    _helpContent: {
        vehicles: {
            title: 'Vehicle Type Parameters — How to Use',
            body: `<ol>
<li><strong>Load a project</strong> using the "Load SUMO Project Folder" button in the header to auto-detect vehicle types from your .rou.xml file.</li>
<li>Edit any parameter (max speed, acceleration, length, etc.) directly in the table cells.</li>
<li>Click <strong>"Copy as XML"</strong> to copy the full &lt;vType&gt; block, ready to paste into your SUMO .rou.xml file.</li>
<li>Click <strong>"Reset Defaults"</strong> to revert all values to the built-in defaults.</li>
<li>You can also paste a full Vehicles.rou.xml file into the text area above the table to import all parameters and flows at once.</li>
</ol>`
        },
        flows: {
            title: 'Flows Tab — How to Use',
            body: `<ol>
<li><strong>Load a SUMO project folder</strong> using the header button. Route IDs from your .rou.xml file will be detected and populated automatically — side roads, junction movements, and main corridors are all just "routes" here, in one table.</li>
<li>If no project is loaded, set the number of routes manually and click "Apply".</li>
<li>Assign a <strong>friendly name</strong> to each route (e.g., "Towards City Centre").</li>
<li>Set the <strong>number of intervals</strong> and <strong>interval duration</strong> to match your survey period (e.g., 8 intervals × 10 minutes = 80 minutes). Intervals are timed from the "Sim Start" field in the header.</li>
<li>Fill in observed vehicle counts per cell (each cell = one vehicle type in one time interval on one route).</li>
<li>Click <strong>"Copy as SUMO XML"</strong> to export a &lt;flow&gt; XML block ready for your SUMO scenario.</li>
</ol>`
        },
        pedestrians: {
            title: 'Pedestrians Tab — How to Use',
            body: `<ol>
<li><strong>Load a SUMO project folder</strong> from the header. Crossing IDs from your .add.xml file will appear automatically, and existing pedestrian counts from your .rou.xml are auto-filled — whether they're written as <code>&lt;walk edges="..."/&gt;</code> or as <code>&lt;personTrip from=".." to=".."/&gt;</code> with ids following a "c0_in_...", "c1_out_..." pattern (0-based crossing index + direction). The crossing count grows automatically if your data references more crossings than are currently configured.</li>
<li>If not auto-detected, set the number of crossings and click "Apply".</li>
<li>Assign a <strong>friendly name</strong> to each crossing (e.g., "School Crossing", "Market Entrance").</li>
<li>Set the number of intervals and interval duration.</li>
<li>Fill in pedestrian counts for each crossing in the Forward (→) and Reverse (←) directions per interval.</li>
<li>Click <strong>"Copy as SUMO XML"</strong> to export &lt;personFlow&gt; elements. This needs each crossing's road "edges" attribute (auto-captured from .add.xml) — crossings without it are skipped with a warning.</li>
</ol>`
        },
        bus: {
            title: 'Bus & Parking Tab — How to Use',
            body: `<ol>
<li><strong>Load a SUMO project folder</strong> from the header to auto-detect bus stop and parking area IDs from .add.xml files, or add them manually and click "Apply".</li>
<li>Assign a <strong>friendly name</strong> to each stop/area. Edit lane, position, and lines directly in the Bus Stop Definitions table.</li>
<li>Fill in <strong>dwell times</strong> (seconds) per stop and interval in the single Bus Dwell Times table.</li>
<li>If your project has one main bus route, enter its route ID in the setup card — "Copy Full XML" (header) will then attach these stops/dwell times to that route's bus flows automatically. Otherwise, merge the dwell times into your bus flow's &lt;stop&gt; elements by hand.</li>
<li>Fill in <strong>parking/idling vehicle counts</strong> per area, vehicle type, and interval in the Parking table. Give each parking area a Route ID and stop duration so its exported XML is valid.</li>
<li>Use the <strong>"Copy XML"</strong> buttons to export each section as SUMO-compatible XML.</li>
<li>Click <strong>"Reset"</strong> to clear all dwell times back to 0s.</li>
</ol>`
        },
        validation: {
            title: 'Validation Tab — How to Use & Get the Best Results',
            body: `<h4 style="margin-top:0;">What GEH measures</h4>
<p>GEH compares your simulated vehicle counts to real, observed counts at the same location. <strong>GEH &lt; 5</strong> = good match, <strong>5–10</strong> = acceptable but worth a look, <strong>&gt; 10</strong> = that location needs recalibration.</p>
<h4>How to get detector data to paste here</h4>
<ol>
<li>Add one <code>&lt;e1Detector id="..." lane="..." freq="600" file="detector_output.xml"/&gt;</code> per real-world count location to your project's <code>.add.xml</code> — set <code>freq</code> (seconds) to match the interval length you actually surveyed (e.g. 600 for 10-minute counts).</li>
<li>Run the simulation (Run SUMO or Run & Analyze). SUMO writes each detector's results to the <code>file</code> path you gave it, inside your project folder — or into a <code>sumo_output/</code> folder there if that exact path couldn't be created (you'll see a toast if that happens).</li>
<li>Open that XML file and upload it here, or paste its contents into the text box, then click <strong>"Process Validation Data"</strong>. One table appears per detector found in the file — this adjusts automatically.</li>
<li>Rename each detector's friendly label directly above its table (kept even after re-uploading).</li>
<li>Edit the <strong>Observed</strong> column directly — GEH recalculates immediately as you type. Click <strong>"Save Observed GEH"</strong> to persist it; you can keep editing afterward.</li>
<li>If you only have real observed counts for part of the simulated period, use the <strong>"Show from / to"</strong> fields above the tables (e.g. 07:00 to 08:00) to hide every other interval row — the success rate and status then reflect only that window instead of the full run.</li>
</ol>
<h4>Getting the best results</h4>
<ul>
<li>Place a detector everywhere you have a real observed count — GEH only means something where the comparison is like-for-like.</li>
<li>Enter Observed values for every interval, not just the peak hour — a model that only matches at peak isn't validated.</li>
<li>If most detectors show GEH &gt; 10, don't just edit Observed values to make the color turn green — go back to the Flows tab, adjust the actual demand, and re-run.</li>
</ul>`
        },
        mape: {
            title: 'MAPE Validation — How to Use & Get the Best Results',
            body: `<h4 style="margin-top:0;">What MAPE measures</h4>
<p>MAPE compares simulated travel time on a route/edge to real, measured travel time. <strong>≤10%</strong> = Valid (Excellent), <strong>≤ the acceptance band</strong> (default 15%, editable above — after the DMRB/TAG Unit M3.1 journey-time criterion) = Marginal (Acceptable), <strong>above the band</strong> = Invalid — the model doesn't reflect that edge yet. Signed % Error (MPE) shows whether the model is consistently over- or under-estimating, which the absolute % Error alone cannot.</p>
<p>This tab accepts <strong>either</strong> of two file types, auto-detected from what you paste/upload:</p>
<h4>Option A — your existing E1 detector output (same file as the Validation tab)</h4>
<ol>
<li>If you already have <code>e1Detector</code> definitions in your <code>.add.xml</code> for the Validation tab, you can reuse that exact same output file here — no extra SUMO setup needed.</li>
<li>Upload or paste it, then click <strong>"Process MAPE Data"</strong>. A detector only measures speed at one point, not travel time, so you then define <strong>Travel-Time Segments</strong>: click "+ Add Segment", pick a "From" and "To" detector, and enter the real distance between them (meters). Simulated travel time = distance ÷ average of the two detectors' mean speed.</li>
<li>Distance doesn't have to be typed by hand: if you loaded your project folder (with its <code>.net.xml</code>), click <strong>"Auto"</strong> next to any segment to trace the actual road path between the two detectors' lanes (following legal lane connections through junctions) and fill the distance in automatically. It's still just a starting value — overwrite it if you know the real distance is different.</li>
<li>Name each segment (e.g. "Detector 1-2") and optionally give it a Group (e.g. "Galle Direction") to organize segments under headers — segments with the same group are shown together.</li>
<li>If your detector ids follow a recognizable "<code>det_secN_direction_dir</code>" naming pattern, segments are proposed automatically the first time. If you've since added a stray segment by hand (or want to start over), click <strong>"Reset to Detected Defaults"</strong> above the segment list to wipe the current segments and regenerate the detected ones (with distances auto-filled too, if the network is loaded) — it asks for confirmation first since it replaces whatever's already configured.</li>
</ol>
<h4>Option B — a dedicated edgeData/travel-time file</h4>
<ol>
<li>Add <code>&lt;edgeData id="..." file="travel_times_output.xml" freq="600"/&gt;</code> to your <code>.add.xml</code> — this reports average travel time per edge per interval directly, so no segments are needed. (The app now also auto-generates its own version of this on every run — see <code>dashboard_traveltimes_output.xml</code> in your project folder.)</li>
<li>Run the simulation, then upload or paste that file here. One table appears per edge found.</li>
</ol>
<p>Either way: edit the <strong>Observed (s)</strong> column directly — % Error and Status recalculate as you type. Click <strong>"Save Observed MAPE"</strong> to persist it. Use the <strong>Interval (min)</strong> field above the upload area to combine several raw intervals into larger rows if you want a coarser comparison, and the <strong>"Show from / to"</strong> fields next to it to only display a specific real-world time window (e.g. 07:00 to 08:00) instead of the full simulated period.</p>
<h4>Getting the best results</h4>
<ul>
<li>Only fill in Observed times you actually measured by hand or GPS — never guess a value just to make the status green.</li>
<li>If using detector segments, get each distance as accurately as possible (e.g. from your network file) — a wrong distance throws off every simulated value for that segment.</li>
<li>Use the same edge/segment(s) across every interval so the comparison stays consistent over the full period.</li>
<li>A few segments with careful real measurements beat many with rough guesses.</li>
<li>If a row is consistently Invalid, check its geometry/speed limit in the network before assuming the demand data is wrong.</li>
</ul>`
        },
        emissions: {
            title: 'Emissions Analysis — How to Use',
            body: `<ol>
<li>Enter current <strong>fuel prices</strong> (diesel and petrol in LKR per litre) and the date the prices apply to.</li>
<li>Upload up to <strong>5 tripinfo_data.xml</strong> files — one per scenario. You can name each scenario using the text field above each file input.</li>
<li>You only need to upload 2 files minimum to compare. Slots 3-5 are optional.</li>
<li>Click <strong>"Parse & Compare Scenarios"</strong> to process the files and render all charts.</li>
<li>Charts will show emissions (CO₂, NOx, PMx, CO, HC), fuel consumption, financial penalties, and time losses — all compared across uploaded scenarios.</li>
<li>Right-click any chart to save it as a PNG image.</li>
<li>Click "Export PDF" to export the current view as a PDF.</li>
</ol>`
        },
        dwell: {
            title: 'Dwell Time Analysis — How to Use',
            body: `<ol>
<li>Upload up to <strong>5 tripinfo_data.xml</strong> files, one for each bus dwell time scenario you simulated (e.g., 0s, 10s, 20s, 45s, 90s dwell).</li>
<li>Name each scenario using the editable label above each file input.</li>
<li>Charts will automatically generate after each upload — no button required.</li>
<li>The <strong>Evaluation Matrix</strong> table summarises all key metrics (delay, CO₂, NOx, PMx, fuel) per dwell time scenario.</li>
<li>Charts include: Gridlock Tipping Point, Speed Collapse, Financial Drain, Relative Domino Effect, CO₂ Emissions, and more.</li>
<li>Regression formulas (R² values) are shown below relevant charts for reference.</li>
<li>Right-click any chart to download it as a PNG.</li>
</ol>`
        },
        simResults: {
            title: 'Simulation Results — How to Use',
            body: `<ol>
<li>Load a SUMO project folder and click <strong>"Save Changes"</strong> first so your Flows/Pedestrians/Bus/Parking edits are written into the project.</li>
<li>Click <strong>"Run & Analyze"</strong> in the header. This runs SUMO in the background (no window) with tripinfo and summary output enabled, waits for it to finish, then fills in this tab automatically.</li>
<li>Shows total vehicles, average speed, travel time, waiting time, and time loss, plus a breakdown per vehicle type and a mean network speed chart over the simulation.</li>
<li>Requires the desktop app and SUMO's "sumo" (headless) executable on your system PATH — the interactive "Run SUMO" button (sumo-gui) doesn't report results back since it stays open until you close it yourself.</li>
</ol>`
        },
        xmlGuide: {
            title: 'How Your Edits Become XML',
            body: `<p>This is a single combined reference for how each input tab's fields turn into the demand XML that <strong>"Copy Full Vehicles.rou.xml"</strong> / <strong>"Download .xml"</strong> produce. The output/analysis tabs (Simulation Results, Validation, MAPE Validation, Emissions Analysis, Dwell Time Analysis) are covered separately at the end — they read SUMO's own output files rather than generating XML.</p>

<h4>Vehicle Params</h4>
<p>Each of the 7 built-in vehicle categories (fast_ped, heavy_bus, motorcycle, passenger_car, truck, tuk_tuk, van) becomes exactly one <code>&lt;vType id="..."&gt;</code> element. Every field in the table (length, minGap, maxSpeed, accel, decel, sigma, tau, lane-changing parameters, etc.) maps 1:1 to the identically-named XML attribute — a blank cell means that attribute is left out of the generated XML entirely rather than filled with a guessed value. "Copy as XML" on this tab exports these plus any extra columns/rows loaded from your project (a vType id outside the 7 built-in ones becomes an extra column; an attribute your project uses that isn't already a row here becomes an extra row) — nothing your uploaded .rou.xml defines is dropped.</p>

<h4>Flows</h4>
<p>Each filled-in cell (Route × Interval × Vehicle type) becomes one <code>&lt;flow id="flow_{route}_{type}_{intervalIndex}" route="{route}" type="{type}" begin="{intervalStart}" end="{intervalEnd}" number="{count}"/&gt;</code>. Routes themselves are <strong>not</strong> redefined here — the exported file only references the <code>route</code> ids that already exist in your uploaded <code>.rou.xml</code>, so that file must stay in the same project folder alongside the exported one.</p>

<h4>Pedestrians</h4>
<p>Each filled-in cell (Crossing × Interval × Forward/Reverse) becomes a <code>&lt;personFlow&gt;</code> containing a <code>&lt;walk edges="..."&gt;</code>, split into up to 4 short 5-second sub-bursts spread across the interval (at +0s, +150s, +300s, +450s) rather than one flow spanning the whole interval. <strong>This requires the crossing to have a known <code>edges</code> attribute</strong> (from a <code>&lt;crossing id=".." edges="..-/&gt;</code> in your <code>.add.xml</code>) — a crossing without one is silently skipped during export (produces no XML for that crossing), even if its table cells have counts. If your project defines crossings a different way (e.g. the <code>personTrip from=".." to=".."</code> + "cN_in/out" id convention some of your files use for reading data back in), the export path does not currently generate that alternate form — it only ever writes <code>&lt;walk edges="..."&gt;</code>.</p>

<h4>Bus & Idling</h4>
<p>Dwell times: for the vehicle flow whose route matches the configured bus route, each bus stop gets a nested <code>&lt;stop busStop="{stopId}" duration="{seconds}"/&gt;</code> inside that interval's <code>&lt;flow&gt;</code>, using the dwell time you entered for that stop/interval (falls back to 10s if blank). Parking/idling counts: each filled cell (Parking Area × Interval × Vehicle type) becomes its own <code>&lt;flow id="park_{area}_{type}_{intervalIndex}"&gt;</code> with a nested <code>&lt;stop parkingArea="{area}" duration="{seconds}"/&gt;</code>, using that area's configured stop duration (falls back to 120s if blank).</p>

<h4>Output/analysis tabs — not XML generators</h4>
<p>Simulation Results, Validation, MAPE Validation, Emissions Analysis, and Dwell Time Analysis don't produce input XML at all. They read SUMO's <em>output</em> files after a run — tripinfo/summary output (Simulation Results, Emissions), your own E1 detector output (Validation, MAPE), or the dashboard's auto-generated edgeData travel-time file (MAPE). Editing the Observed columns there only updates the comparison numbers on screen and, if saved, in your browser's local storage — it never writes back into any SUMO input file.</p>`
        },
    },

    showHelp(tabKey) {
        const content = this._helpContent[tabKey];
        if (!content) return;
        document.getElementById('help-title').textContent = content.title;
        document.getElementById('help-body').innerHTML = content.body;
        const modal = document.getElementById('help-modal');
        modal.style.display = 'flex';
    },

    closeHelp() {
        document.getElementById('help-modal').style.display = 'none';
    },

        saveToLocal() {
        const state = {
            VEHICLE_TYPES,
            flowsState: this._flowsState,
            pedState: this._pedState,
            busState: this._busState
        };
        localStorage.setItem('sumoDashboardState', JSON.stringify(state));
        if (typeof this.updateQuickStats === 'function') this.updateQuickStats();
    },

    loadFromLocal() {
        const stored = localStorage.getItem('sumoDashboardState');
        if (stored) {
            try {
                const state = JSON.parse(stored);
                if (state.VEHICLE_TYPES) Object.assign(VEHICLE_TYPES, state.VEHICLE_TYPES);
                if (state.flowsState) Object.assign(this._flowsState, state.flowsState);
                if (state.pedState) Object.assign(this._pedState, state.pedState);
                if (state.busState) Object.assign(this._busState, state.busState);

                // Sync the restored counts/durations into their input fields so the
                // upcoming rebuild*Setup() calls in init() don't clobber them back to
                // the static HTML defaults.
                const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
                const setCount = (id, len) => { if (len > 0) setVal(id, len); };
                setCount('flows-route-count', this._flowsState.routes.length);
                setVal('flows-interval-count', this._flowsState.intervals);
                setVal('flows-interval-duration', this._flowsState.intervalDuration);
                setCount('ped-crossing-count', this._pedState.crossings.length);
                setVal('ped-interval-count', this._pedState.intervals);
                setVal('ped-interval-duration', this._pedState.intervalDuration);
                setCount('bus-stop-count', this._busState.stops.length);
                setVal('bus-interval-count', this._busState.intervals);
                setVal('bus-interval-duration', this._busState.intervalDuration);
                setVal('bus-route-id', this._busState.busRouteId);
                setCount('parking-area-count', this._busState.parkingAreas.length);
            } catch (err) {
                console.error('Error loading state from localStorage', err);
            }
        }

        // Also load dark mode — defaults to light on first run (no stored
        // preference yet); an explicit past choice (either way) is respected.
        if (localStorage.getItem('sumoDarkMode') === 'true') {
            this.setDarkMode(true);
        } else {
            this.setDarkMode(false);
        }
    },

    resetBusDwells() {
        this._busState.dwellData = {};
        this.rebuildBusDwellTable();
        this.saveToLocal();
        this.showToast('Reset bus dwell times to defaults (0s)', 'info');
    },
    toggleDarkMode() {
        const isDark = document.body.classList.contains('dark-mode');
        this.setDarkMode(!isDark);
        localStorage.setItem('sumoDarkMode', (!isDark).toString());
    },

    setDarkMode(isDark) {
        if (isDark) {
            document.body.classList.add('dark-mode');
            Chart.defaults.color = '#e0e0e0';
            Chart.defaults.borderColor = '#444444';
        } else {
            document.body.classList.remove('dark-mode');
            Chart.defaults.color = '#666'; // default Chart.js color
            Chart.defaults.borderColor = '#ddd'; // default Chart.js grid color
        }
        if (window.Chart && Chart.instances) {
            Object.values(Chart.instances).forEach(chart => {
                if (chart.options.scales) {
                    Object.values(chart.options.scales).forEach(scale => {
                        if (scale.ticks) scale.ticks.color = Chart.defaults.color;
                        if (scale.grid) scale.grid.color = Chart.defaults.borderColor;
                    });
                }
                if (chart.options.plugins && chart.options.plugins.legend && chart.options.plugins.legend.labels) {
                    chart.options.plugins.legend.labels.color = Chart.defaults.color;
                }
                chart.update();
            });
        }
    },

    // ─── IMPORT GLOBAL XML ───────────────────────────────────
    handleImportXML(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => this.parseFullXML(e.target.result);
        reader.readAsText(file);
        event.target.value = ''; // Reset input
    },

    parseFullXML(text) {
        try {
            const cleanText = text.replace(/<\?xml.*?\?>/i, '');
            const xmlString = `<root>${cleanText}</root>`;
            const parser = new DOMParser();

            // We MUST use application/xml. text/html breaks self-closing XML tags (it nests them infinitely)
            const doc = parser.parseFromString(xmlString, 'application/xml');

            const parseError = doc.querySelector('parsererror');
            if (parseError) {
                throw new Error('Invalid XML structure. Please ensure you copied the ENTIRE file, including the final </routes> tag. Browser error: ' + parseError.textContent.substring(0, 100));
            }

            // 1. vTypes
            const missingEmissionClass = [];
            doc.querySelectorAll('vType').forEach(node => {
                const id = node.getAttribute('id');
                if (id && VEHICLE_TYPES[id]) {
                    VTYPE_PARAMS.forEach(param => {
                        if (node.hasAttribute(param)) {
                            const val = node.getAttribute(param);
                            const numVal = parseFloat(val);
                            VEHICLE_TYPES[id][param] = isNaN(numVal) ? val : numVal;
                        }
                    });
                    // Checked against the FILE being imported, not this
                    // dashboard's own in-memory default -- the real risk is
                    // that the underlying SUMO project (e.g. a route file
                    // authored outside this dashboard) has no emissionClass
                    // at all, so running it directly with plain SUMO (not
                    // through this dashboard's own export) falls back to
                    // SUMO's own fleet-composition default, which may not
                    // match a South Asian fleet -- see CLAUDE.md's History
                    // section and the JSALT manuscript's Section 5/6.1 for
                    // a real case of exactly this going unnoticed for the
                    // dashboard's own built-in defaults.
                    if (!node.hasAttribute('emissionClass')) {
                        missingEmissionClass.push(id);
                    }
                }
            });
            if (missingEmissionClass.length) {
                this.showToast(
                    `${missingEmissionClass.length} vehicle type${missingEmissionClass.length === 1 ? '' : 's'} (${missingEmissionClass.join(', ')}) have no emissionClass set. SUMO will assign its own default emission class per vType, which may not match your fleet -- see SUMO's own emissions-model documentation (https://sumo.dlr.de/docs/Models/Emissions.html) and set an explicit emissionClass per vehicle type on the Vehicle Params tab.`,
                    'error'
                );
            }

            const flows = doc.querySelectorAll('flow');
            if (flows.length === 0) {
                alert("WARNING: No <flow> tags were found in the XML! Check if your XML has unclosed <!-- comments --> at the top.");
            }

            // Reset generic tables before re-importing so stale cells don't linger
            this._flowsState.data = {};
            this._pedState.data = {};
            this._busState.dwellData = {};
            this._busState.parkingData = {};

            const idxFor = (beginSec, intervalDurationMin) => Math.floor(beginSec / (intervalDurationMin * 60));

            let importedFlows = 0, importedPed = 0, importedDwell = 0, importedParking = 0;

            // 2. Flows — vehicle flows (routes), bus dwell stops, and parking stops
            flows.forEach(node => {
                const type = node.getAttribute('type') || node.getAttribute('vType') || node.getAttribute('vtype') || 'unknown';
                const num = parseInt(node.getAttribute('number')) || 0;
                const begin = parseFloat(node.getAttribute('begin')) || 0;
                const routeId = node.getAttribute('route');
                const stopNode = node.querySelector('stop');

                if (stopNode) {
                    const parkingArea = stopNode.getAttribute('parkingArea') || stopNode.getAttribute('parkingarea');
                    const busStop = stopNode.getAttribute('busStop') || stopNode.getAttribute('busstop');
                    const dur = parseFloat(stopNode.getAttribute('duration')) || 0;

                    if (parkingArea) {
                        const areaIdx = this._busState.parkingAreas.findIndex(a => a.id === parkingArea);
                        const idx = idxFor(begin, this._busState.intervalDuration);
                        if (areaIdx >= 0 && idx >= 0 && idx < this._busState.intervals) {
                            this._busState.parkingData[`${areaIdx}_${idx}_${type}`] = num;
                            importedParking++;
                        }
                        return;
                    }
                    if (busStop) {
                        const stopIdx = this._busState.stops.findIndex(s => s.id === busStop);
                        const idx = idxFor(begin, this._busState.intervalDuration);
                        if (stopIdx >= 0 && idx >= 0 && idx < this._busState.intervals) {
                            this._busState.dwellData[`${stopIdx}_${idx}`] = dur;
                            importedDwell++;
                        }
                        return;
                    }
                }

                if (routeId) {
                    const routeIdx = this._flowsState.routes.findIndex(r => r.id === routeId);
                    const idx = idxFor(begin, this._flowsState.intervalDuration);
                    if (routeIdx >= 0 && idx >= 0 && idx < this._flowsState.intervals) {
                        this._flowsState.data[`${routeIdx}_${idx}_${type}`] = num;
                        importedFlows++;
                    }
                }
            });

            // 3. Person Flows — pedestrian crossing bursts, ids shaped ped_{crossingId}_{fwd|rev}_...
            doc.querySelectorAll('personFlow').forEach(node => {
                const num = parseInt(node.getAttribute('number')) || 0;
                const begin = parseFloat(node.getAttribute('begin')) || 0;
                const id = node.getAttribute('id') || '';
                const m = id.match(/^ped_(.+)_(fwd|rev)_\d+$/);
                if (!m) return;
                const cIdx = this._pedState.crossings.findIndex(c => c.id === m[1]);
                if (cIdx < 0) return;
                const idx = idxFor(begin, this._pedState.intervalDuration);
                if (idx < 0 || idx >= this._pedState.intervals) return;
                const key = `${cIdx}_${idx}_${m[2]}`;
                this._pedState.data[key] = (parseInt(this._pedState.data[key]) || 0) + num;
                importedPed++;
            });

            // CRITICAL: Save BEFORE calling init(), because init() calls loadFromLocal()
            // which would otherwise overwrite the freshly parsed data with old values.
            this.saveToLocal();
            this.init(); // Refresh UI

            this.showToast(`Imported ${importedFlows} flow cells, ${importedPed} pedestrian bursts, ${importedDwell} dwell times, ${importedParking} parking cells.`, 'success');
        } catch (err) {
            alert(`CRITICAL ERROR in parseFullXML:\n${err.message}\n${err.stack}`);
            console.error(err);
        }
    },

    initArrowKeys() {
        if (this._arrowKeysInitialized) return;
        this._arrowKeysInitialized = true;
        
        document.addEventListener('keydown', (e) => {
            // Undo / Redo
            if (e.ctrlKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                App.undo();
                return;
            }
            if (e.ctrlKey && e.key.toLowerCase() === 'y') {
                e.preventDefault();
                App.redo();
                return;
            }

            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return;
            const active = document.activeElement;
            
            if (!active || (!active.classList.contains('editable-cell') && active.tagName !== 'INPUT')) return;

            const cell = active.tagName === 'INPUT' ? active.closest('td') : active;
            if (!cell) return;
            const row = cell.closest('tr');
            if (!row) return;
            const tbody = row.closest('tbody') || row.closest('table');
            if (!tbody) return;

            // Check caret position for Left/Right in contenteditable
            if (active.tagName !== 'INPUT') {
                const sel = window.getSelection();
                if (sel.rangeCount > 0) {
                    const range = sel.getRangeAt(0);
                    const textLen = active.textContent.length;
                    
                    if (e.key === 'ArrowLeft') {
                        // Only jump left if caret is at the beginning
                        if (range.startOffset > 0 || range.endOffset > 0) return;
                    } else if (e.key === 'ArrowRight') {
                        // Only jump right if caret is at the end
                        // Note: If there's a single text node, endContainer is the text node and endOffset is length.
                        // If it's the element itself, endOffset is childNodes length.
                        const isAtEnd = (range.endContainer === active && range.endOffset === active.childNodes.length) || 
                                        (range.endContainer.nodeType === 3 && range.endOffset === range.endContainer.length);
                        if (!isAtEnd && textLen > 0) return;
                    }
                }
            } else {
                if (e.key === 'ArrowLeft' && active.selectionStart > 0) return;
                if (e.key === 'ArrowRight' && active.selectionEnd < active.value.length) return;
            }

            const colIndex = Array.from(row.children).indexOf(cell);
            const rows = Array.from(tbody.querySelectorAll('tr'));
            const rowIndex = rows.indexOf(row);

            let targetCell = null;

            if (e.key === 'ArrowUp' && rowIndex > 0) {
                targetCell = rows[rowIndex - 1].children[colIndex];
            } else if ((e.key === 'ArrowDown' || e.key === 'Enter') && rowIndex < rows.length - 1) {
                targetCell = rows[rowIndex + 1].children[colIndex];
            } else if (e.key === 'ArrowLeft') {
                let prevCol = colIndex - 1;
                let targetRow = rowIndex;
                while (targetRow >= 0 && !targetCell) {
                    while (prevCol >= 0) {
                        if (rows[targetRow].children[prevCol].classList.contains('editable-cell')) {
                            targetCell = rows[targetRow].children[prevCol];
                            break;
                        }
                        prevCol--;
                    }
                    if (!targetCell) {
                        targetRow--;
                        if (targetRow >= 0) prevCol = rows[targetRow].children.length - 1;
                    }
                }
            } else if (e.key === 'ArrowRight') {
                let nextCol = colIndex + 1;
                let targetRow = rowIndex;
                while (targetRow < rows.length && !targetCell) {
                    while (nextCol < rows[targetRow].children.length) {
                        if (rows[targetRow].children[nextCol].classList.contains('editable-cell')) {
                            targetCell = rows[targetRow].children[nextCol];
                            break;
                        }
                        nextCol++;
                    }
                    if (!targetCell) {
                        targetRow++;
                        nextCol = 0;
                    }
                }
            }

            if (targetCell) {
                // If the target is an input, focus the input instead of the cell
                const input = targetCell.querySelector('input');
                const finalTarget = input || targetCell;
                
                if (finalTarget.classList.contains('editable-cell') || finalTarget.tagName === 'INPUT') {
                    e.preventDefault();
                    finalTarget.focus();
                    if (finalTarget.tagName === 'INPUT') {
                        finalTarget.select();
                    } else {
                        const selection = window.getSelection();
                        const range = document.createRange();
                        range.selectNodeContents(finalTarget);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    }
                }
            }
        });
    },

    initHotkeys() {
        if (this._hotkeysInitialized) return;
        this._hotkeysInitialized = true;
        
        document.addEventListener('keydown', (e) => {
            const tag = document.activeElement ? document.activeElement.tagName : '';
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement.isContentEditable;
            
            // ? or Shift+/
            if (e.key === '?' && !isInput) {
                e.preventDefault();
                const modal = document.getElementById('hotkeys-modal');
                if (modal) modal.style.display = 'flex';
            }
            
            // 1 through 7
            if (e.key >= '1' && e.key <= '7' && !isInput) {
                e.preventDefault();
                const tabs = document.querySelectorAll('.tab-btn');
                const idx = parseInt(e.key) - 1;
                if (tabs[idx]) {
                    tabs[idx].click();
                }
            }
            
            // Ctrl+S
            if (e.ctrlKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                App.saveToLocal();
                App.showToast('Progress saved!', 'success');
            }
        });
    },

    updateQuickStats() {
        let totalVehicles = 0;
        const routeTotals = {};

        Object.entries(this._flowsState.data || {}).forEach(([key, val]) => {
            const n = parseInt(val) || 0;
            if (!n) return;
            totalVehicles += n;
            const routeIdx = key.split('_')[0];
            routeTotals[routeIdx] = (routeTotals[routeIdx] || 0) + n;
        });

        let busiestRouteIdx = null;
        let maxFlow = -1;
        for (const routeIdx in routeTotals) {
            if (routeTotals[routeIdx] > maxFlow) {
                maxFlow = routeTotals[routeIdx];
                busiestRouteIdx = routeIdx;
            }
        }

        const elTotal = document.getElementById('stat-total-vehicles');
        const elBusiest = document.getElementById('stat-busiest-intersection');

        if (elTotal) elTotal.textContent = totalVehicles;
        if (elBusiest) {
            const route = busiestRouteIdx !== null ? this._flowsState.routes[busiestRouteIdx] : null;
            elBusiest.textContent = (route && maxFlow > 0) ? route.name + ' (' + maxFlow + ')' : 'None';
        }
    },

    initPaste() {
        if (this._pasteInitialized) return;
        this._pasteInitialized = true;
        document.addEventListener('paste', this.handleTablePaste.bind(this));
    },

    handleTablePaste(e) {
        const active = document.activeElement;
        if (!active) return;
        const isEditableCell = active.classList && active.classList.contains('editable-cell');
        const isTableInput = active.tagName === 'INPUT' && active.closest('.data-table');
        if (!isEditableCell && !isTableInput) return;

        const table = active.closest('.data-table');
        if (!table) return;

        const clipboardData = e.clipboardData || window.clipboardData;
        const pastedData = clipboardData.getData('Text');
        if (!pastedData) return;

        e.preventDefault();

        const rows = pastedData.split(/\r\n|\n|\r/).filter(r => r !== '').map(r => r.split('\t'));
        const tbody = active.closest('tbody');
        if (!tbody) return;

        const allRows = Array.from(tbody.querySelectorAll('tr'));
        const activeRow = active.closest('tr');
        const startRowIdx = allRows.indexOf(activeRow);

        // Input-based tables (Flows/Pedestrians/Bus dwell/Parking) can have a
        // non-input label cell first, so index by position among <input>s in
        // the row rather than among all <td>s.
        const startColIdx = isTableInput
            ? Array.from(activeRow.querySelectorAll('input')).indexOf(active)
            : Array.from(activeRow.children).indexOf(active);

        let updatedCells = [];

        for (let i = 0; i < rows.length; i++) {
            if (startRowIdx + i >= allRows.length) break;
            const targetRow = allRows[startRowIdx + i];
            const targetCells = isTableInput
                ? Array.from(targetRow.querySelectorAll('input'))
                : Array.from(targetRow.children);

            for (let j = 0; j < rows[i].length; j++) {
                if (startColIdx + j >= targetCells.length) break;
                const targetCell = targetCells[startColIdx + j];
                const val = rows[i][j].trim();
                if (val === '') continue;

                if (isTableInput) {
                    targetCell.value = val;
                    targetCell.dispatchEvent(new Event('input', { bubbles: true }));
                    updatedCells.push(targetCell);
                } else if (targetCell.classList.contains('editable-cell')) {
                    targetCell.textContent = val;
                    updatedCells.push(targetCell);
                }
            }
        }

        if (!isTableInput) {
            updatedCells.forEach(cell => {
                const onblurAttr = cell.getAttribute('onblur');
                if (onblurAttr) {
                    const funcMatch = onblurAttr.match(/App\.([a-zA-Z0-9_]+)\(this\)/);
                    if (funcMatch && funcMatch[1] && typeof App[funcMatch[1]] === 'function') {
                        App[funcMatch[1]](cell);
                    }
                }
            });
        }
        App.saveToLocal();
    },

    // ─── TAB NAVIGATION ─────────────────────────────────────
    initTabs() {
        if (this._tabsInitialized) return;
        this._tabsInitialized = true;
        
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });
    },

    // ─── TOAST NOTIFICATIONS ────────────────────────────────
    showToast(message, type = 'success') {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            container.style.position = 'fixed';
            container.style.bottom = '20px';
            container.style.right = '20px';
            container.style.zIndex = '999999';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    // ─── UTILITY: Copy to Clipboard ─────────────────────────
    copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            this.showToast('Copied to clipboard!');
        }).catch(() => {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            this.showToast('Copied to clipboard!');
        });
    },

    // ─── UTILITY: Format type name for display ──────────────
    formatTypeName(name) {
        return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    },

    // ═══════════════════════════════════════════════════════
    // TAB 1: VEHICLE PARAMETERS
    // ═══════════════════════════════════════════════════════
    // typeName -> its data object, whether it's one of the 7 built-in
    // categories or an extra column discovered in an uploaded project.
    _vehicleTypeData(typeName) {
        return Object.prototype.hasOwnProperty.call(VEHICLE_TYPES, typeName)
            ? VEHICLE_TYPES[typeName]
            : this._customVehicleTypes[typeName];
    },

    renderVehicleTypeTable() {
        const table = document.getElementById('vehicle-type-table');
        const allTypeNames = VEHICLE_TYPE_NAMES.concat(Object.keys(this._customVehicleTypes || {}));
        const allParams = VTYPE_PARAMS.concat(this._extraVTypeParams || []);

        let html = '<thead><tr><th class="sticky-col" style="min-width:180px;">Parameter</th>';
        allTypeNames.forEach(name => {
            html += `<th>${this.formatTypeName(name)}</th>`;
        });
        html += '</tr></thead><tbody>';

        // Group params by category
        const categoryColors = {
            'Identity': '#6366f1', 'Physical': '#3b82f6', 'Dynamics': '#10b981',
            'Driver Behavior': '#f59e0b', 'Spacing': '#8b5cf6',
            'Lane Changing': '#ec4899', 'Junction Behavior': '#ef4444',
            'Other (from project)': '#6b7280'
        };
        let lastCategory = '';

        allParams.forEach(param => {
            const meta = (typeof VTYPE_PARAM_META !== 'undefined' && VTYPE_PARAM_META[param]) ? VTYPE_PARAM_META[param] : null;
            // A param this interface doesn't already know about (i.e. one found
            // in the uploaded project beyond the fixed list) has no metadata —
            // group those under one clearly-labeled catch-all category instead
            // of leaving them floating with no header at all.
            const category = meta ? meta.category : 'Other (from project)';

            // Category separator row
            if (category !== lastCategory) {
                lastCategory = category;
                const catColor = categoryColors[category] || '#6b7280';
                html += `<tr><td colspan="${allTypeNames.length + 1}" style="background: ${catColor}15; border-left: 4px solid ${catColor}; padding: 0.5rem 0.75rem; font-weight: 700; font-size: 0.8rem; color: ${catColor}; text-transform: uppercase; letter-spacing: 0.05em;">${category}</td></tr>`;
            }

            // Build tooltip
            let tooltipText = param;
            let unitLabel = '';
            if (meta) {
                tooltipText = meta.description;
                if (meta.unit && meta.unit !== '—') unitLabel = meta.unit;
                if (meta.min !== null && meta.max !== null) tooltipText += ` | Range: ${meta.min} – ${meta.max}`;
                if (meta.unit) tooltipText += ` | Unit: ${meta.unit}`;
            } else {
                tooltipText = `${param} — not one of this interface's built-in parameters; kept as-is from your uploaded project.`;
            }

            html += `<tr><td class="sticky-col param-name" title="${tooltipText}" style="cursor: help;">`;
            html += `<span>${param}</span>`;
            if (unitLabel) html += `<span style="display:block; font-size:0.7rem; color: var(--text-muted); font-weight: 400;">(${unitLabel})</span>`;
            html += `</td>`;

            allTypeNames.forEach(typeName => {
                const data = this._vehicleTypeData(typeName) || {};
                const val = data[param] === undefined ? null : data[param];
                const isBlank = val === null || val === '';
                const isEditable = param !== 'vClass';
                // Check out-of-range
                let outOfRange = false;
                if (meta && meta.min !== null && meta.max !== null && !isBlank && !isNaN(parseFloat(val))) {
                    const numVal = parseFloat(val);
                    outOfRange = numVal < meta.min || numVal > meta.max;
                }
                const rangeStyle = outOfRange ? 'background: rgba(239,68,68,0.12); color: #b91c1c;' : '';

                if (param === 'color') {
                    html += `<td class="color-cell" style="text-align: center; padding: 0.2rem;">
                        <input type="color" data-type="${typeName}" data-param="${param}"
                        value="${val || '#000000'}" onchange="App.updateVehicleParam(this)"
                        style="width: 100%; height: 2.5rem; border: none; cursor: pointer; padding: 0; background: transparent;">
                    </td>`;
                } else if (isEditable) {
                    html += `<td class="editable-cell" contenteditable="true"
                        data-type="${typeName}" data-param="${param}"
                        onblur="App.updateVehicleParam(this)" style="${rangeStyle}">${isBlank ? '' : val}</td>`;
                } else {
                    html += `<td class="readonly-cell">${isBlank ? '—' : val}</td>`;
                }
            });
            html += '</tr>';
        });
        html += '</tbody>';
        table.innerHTML = html;
    },

    handleFullXMLPaste() {
        const text = document.getElementById('paste-full-xml').value.trim();
        if(!text) return;
        this.parseFullXML(text);
        document.getElementById('paste-full-xml').value = '';
    },

    updateVehicleParam(cell) {
        if (App.isApplyingUndoRedo) return;
        const typeName = cell.dataset.type;
        const param = cell.dataset.param;
        const val = cell.tagName === 'INPUT' ? cell.value.trim() : cell.textContent.trim();
        const numVal = parseFloat(val);
        // An emptied cell goes back to "not specified" (blank) rather than an
        // empty string, so XML generation correctly omits the attribute again.
        const newVal = val === '' ? null : (param === 'color' || isNaN(numVal)) ? val : numVal;

        const target = App._vehicleTypeData(typeName);
        if (!target) return;
        const oldVal = target[param];
        if (oldVal !== newVal) {
            App.pushUndo({ type: 'vehicleParam', typeName, param, oldValue: oldVal, newValue: newVal });
            target[param] = newVal;
            App.saveToLocal();
        }
    },

    resetVehicleTypes() {
        Object.keys(this.originalVehicleTypes).forEach(key => {
            VEHICLE_TYPES[key] = JSON.parse(JSON.stringify(this.originalVehicleTypes[key]));
        });
        this._customVehicleTypes = {};
        this._extraVTypeParams = [];
        this.renderVehicleTypeTable();
        App.saveToLocal();
        this.showToast('Vehicle types reset to defaults');
    },

    // Builds one <vType> element for the given type id from whatever fields
    // it actually has values for — null/undefined/blank fields are omitted
    // entirely rather than written as fabricated defaults. Shared by
    // copyVehicleTypesXML() here and xmlBuilder.js's full-demand export, so
    // there's exactly one place that decides what counts as "blank".
    _buildVTypeXML(id) {
        const t = this._vehicleTypeData(id) || {};
        const present = (v) => v !== null && v !== undefined && v !== '';
        const fmt = (v) => (typeof v === 'number' ? Number(v).toFixed(2) : v);

        let attrs = `id="${id}"`;
        if (present(t.vClass)) attrs += ` vClass="${t.vClass}"`;
        if (present(t.length)) attrs += ` length="${fmt(t.length)}"`;
        if (present(t.width)) attrs += ` width="${fmt(t.width)}"`;
        if (present(t.maxSpeed)) attrs += ` maxSpeed="${fmt(t.maxSpeed)}"`;
        if (present(t.emissionClass)) attrs += ` emissionClass="${t.emissionClass}"`;
        if (present(t.color)) attrs += ` color="${t.color}"`;
        if (present(t.accel)) attrs += ` accel="${fmt(t.accel)}"`;
        if (present(t.decel)) attrs += ` decel="${fmt(t.decel)}"`;
        if (present(t.sigma)) attrs += ` sigma="${fmt(t.sigma)}"`;
        if (present(t.tau)) attrs += ` tau="${fmt(t.tau)}"`;
        if (present(t.minGap)) attrs += ` minGap="${fmt(t.minGap)}"`;
        if (present(t.minGapLat)) attrs += ` minGapLat="${fmt(t.minGapLat)}"`;
        if (present(t.latAlignment)) attrs += ` latAlignment="${t.latAlignment}"`;
        if (present(t.speedFactor)) {
            const dev = present(t.speedDev) ? fmt(t.speedDev) : '0.00';
            attrs += ` speedFactor="normc(${fmt(t.speedFactor)},${dev},0.20,2.00)"`;
        }
        if (present(t.lcStrategic)) attrs += ` lcStrategic="${fmt(t.lcStrategic)}"`;
        if (present(t.lcCooperative)) attrs += ` lcCooperative="${fmt(t.lcCooperative)}"`;
        if (present(t.lcOpposite)) attrs += ` lcOpposite="${fmt(t.lcOpposite)}"`;
        if (present(t.lcSpeedGain)) attrs += ` lcSpeedGain="${fmt(t.lcSpeedGain)}"`;
        if (present(t.lcAssertive)) attrs += ` lcAssertive="${fmt(t.lcAssertive)}"`;
        if (present(t.lcPushy)) attrs += ` lcPushy="${fmt(t.lcPushy)}"`;
        if (present(t.jmCrossingGap)) attrs += ` jmCrossingGap="${fmt(t.jmCrossingGap)}"`;
        if (present(t.jmIgnoreFoeProb)) attrs += ` jmIgnoreFoeProb="${fmt(t.jmIgnoreFoeProb)}"`;
        if (present(t.jmIgnoreKeepClearTime)) attrs += ` jmIgnoreKeepClearTime="${fmt(t.jmIgnoreKeepClearTime)}"`;
        (this._extraVTypeParams || []).forEach(p => {
            if (present(t[p])) attrs += ` ${p}="${fmt(t[p])}"`;
        });
        return `<vType ${attrs}/>`;
    },

    copyVehicleTypesXML() {
        const allTypeNames = VEHICLE_TYPE_NAMES.concat(Object.keys(this._customVehicleTypes || {}));
        const xml = allTypeNames.map(name => '    ' + this._buildVTypeXML(name)).join('\n') + '\n';
        this.copyToClipboard(xml);
    },

    // ═══════════════════════════════════════════════════════
    // TAB 4: PEDESTRIAN FLOWS — generic XML export
    // ═══════════════════════════════════════════════════════
    copyPedestrianXML() {
        const crossings = this._pedState.crossings;
        const intervals = this._pedState.intervals;
        const duration = this._pedState.intervalDuration;
        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        const simStartSec = sh * 3600 + sm * 60;
        const durSec = duration * 60;
        const pedOffsets = [0, 150, 300, 450];
        const burstDuration = 5;

        let xml = '';
        let skipped = 0;
        for (let i = 0; i < intervals; i++) {
            const b = simStartSec + i * durSec, e = b + durSec;
            crossings.forEach((c, ci) => {
                ['fwd', 'rev'].forEach(dir => {
                    const total = parseInt(this._pedState.data[`${ci}_${i}_${dir}`] || 0);
                    if (!total) return;
                    const edges = (this.project.crossingEdges && this.project.crossingEdges[c.id]) || '';
                    if (!edges) { skipped += total; return; }
                    const base = Math.floor(total / 4);
                    let rem = total % 4;
                    pedOffsets.forEach((offset, bIdx) => {
                        const count = base + (rem > 0 ? 1 : 0);
                        if (rem > 0) rem--;
                        if (count <= 0) return;
                        const start = b + offset;
                        if (start >= e) return;
                        const end = Math.min(start + burstDuration, e);
                        xml += `    <personFlow id="ped_${c.id}_${dir}_${i}${bIdx}" type="fast_ped" begin="${start.toFixed(2)}" end="${end.toFixed(2)}" number="${count}">\n        <walk edges="${edges}"/>\n    </personFlow>\n`;
                    });
                });
            });
        }
        this.copyToClipboard(xml);
        if (skipped > 0) {
            this.showToast(`${skipped} pedestrian entries skipped — no crossing edge data available. Re-upload a folder with crossing "edges" defined, or add them manually.`, 'error');
        } else {
            this.showToast('Pedestrian XML copied!', 'success');
        }
    },

    // ═══════════════════════════════════════════════════════
    // TAB 5: BUS STOPS, DWELL TIMES & PARKING — generic, project-driven
    // ═══════════════════════════════════════════════════════
    _busState: { stops: [], parkingAreas: [], intervals: 8, intervalDuration: 10, dwellData: {}, parkingData: {}, busRouteId: '' },

    rebuildBusSetup(stopData) {
        const count = stopData ? stopData.length : parseInt(document.getElementById('bus-stop-count')?.value || 2);
        const config = document.getElementById('bus-stop-config');
        if (!config) return;

        const existing = this._busState.stops;
        const newIds = [];
        for (let i = 0; i < count; i++) {
            const src = stopData ? stopData[i] : null;
            newIds.push(src ? src.id : (existing[i]?.id || ('stop_' + (i + 1))));
        }
        if (stopData) {
            [this._busState.dwellData] = this._remapIndexedData(existing, newIds, [this._busState.dwellData]);
        }

        const oldIdToItem = {};
        existing.forEach(s => { oldIdToItem[s.id] = s; });
        const newStops = newIds.map((id, i) => {
            const src = stopData ? stopData[i] : null;
            const old = oldIdToItem[id];
            return {
                id,
                name: old?.name || (src ? src.id : ('Stop ' + (i + 1))),
                lane: src ? src.lane : (old?.lane || ''),
                startPos: src ? src.startPos : (old?.startPos ?? 0),
                endPos: src ? src.endPos : (old?.endPos ?? 0),
                lines: src ? src.lines : (old?.lines || '')
            };
        });
        this._busState.stops = newStops;

        config.innerHTML = '';
        newStops.forEach((s, i) => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; flex-direction:column; gap:0.3rem; min-width:160px;';
            div.innerHTML = `
                <label style="font-size:0.78rem; color:var(--text-secondary,#888); font-weight:500;">Stop ${i+1} ID: <code style="font-size:0.78rem;">${s.id}</code></label>
                <input type="text" value="${s.name}" placeholder="Friendly name"
                    style="padding:0.3rem 0.5rem; border:1px solid #ccc; border-radius:4px; font-size:0.85rem; width:160px;"
                    oninput="App._busState.stops[${i}].name = this.value; App.rebuildBusStopTable(); App.rebuildBusDwellTable(); App.saveToLocal();">
            `;
            config.appendChild(div);
        });

        this.rebuildBusStopTable();
        this.rebuildBusDwellTable();
    },

    rebuildBusStopTable() {
        const table = document.getElementById('bus-stop-table');
        if (!table) return;
        let html = '<thead><tr><th>Stop ID</th><th>Name</th><th>Lane</th><th>Start Pos</th><th>End Pos</th><th>Lines</th></tr></thead><tbody>';
        this._busState.stops.forEach((stop, i) => {
            html += `<tr>
                <td>${stop.id}</td>
                <td>${stop.name}</td>
                <td class="editable-cell" contenteditable="true" data-stop-idx="${i}" data-field="lane" onblur="App.updateBusStopField(this)">${stop.lane}</td>
                <td class="editable-cell" contenteditable="true" data-stop-idx="${i}" data-field="startPos" onblur="App.updateBusStopField(this)">${stop.startPos}</td>
                <td class="editable-cell" contenteditable="true" data-stop-idx="${i}" data-field="endPos" onblur="App.updateBusStopField(this)">${stop.endPos}</td>
                <td class="editable-cell" contenteditable="true" data-stop-idx="${i}" data-field="lines" onblur="App.updateBusStopField(this)">${stop.lines}</td>
            </tr>`;
        });
        html += '</tbody>';
        table.innerHTML = html;
    },

    updateBusStopField(cell) {
        const i = parseInt(cell.dataset.stopIdx);
        const field = cell.dataset.field;
        const stop = this._busState.stops[i];
        if (!stop) return;
        const raw = cell.textContent.trim();
        if (field === 'startPos' || field === 'endPos') {
            const val = parseFloat(raw);
            stop[field] = isNaN(val) ? 0 : val;
        } else {
            stop[field] = raw;
        }
        this.saveToLocal();
    },

    rebuildBusDwellTable() {
        const wrapper = document.getElementById('bus-dwell-table-wrapper');
        if (!wrapper) return;
        const stops = this._busState.stops;
        if (!stops.length) { wrapper.innerHTML = '<p class="placeholder-text">Add bus stops above first.</p>'; return; }

        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        let totalMin = sh * 60 + sm;
        const duration = this._busState.intervalDuration;
        const intervals = this._busState.intervals;

        let html = '<table class="data-table" style="font-size:0.82rem;"><thead><tr><th>Interval</th>';
        stops.forEach(s => { html += `<th>${s.name}</th>`; });
        html += '</tr></thead><tbody>';

        for (let i = 0; i < intervals; i++) {
            const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
            const nm = totalMin + duration;
            const label = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} - ${String(Math.floor(nm/60)).padStart(2,'0')}:${String(nm%60).padStart(2,'0')}`;
            totalMin += duration;
            html += `<tr><td style="white-space:nowrap; font-weight:500;">${label}</td>`;
            stops.forEach((s, si) => {
                const key = `${si}_${i}`;
                const val = this._busState.dwellData[key] ?? '';
                html += `<td><input type="number" min="0" step="0.1" value="${val}"
                    oninput="App._busState.dwellData['${key}'] = this.value; App.saveToLocal();"
                    style="width:64px; padding:2px 4px; text-align:center; border:1px solid #ddd; border-radius:3px; font-size:0.8rem;"></td>`;
            });
            html += '</tr>';
        }
        html += '</tbody></table>';
        wrapper.innerHTML = html;
    },

    copyBusStopsXML() {
        let xml = '';
        this._busState.stops.forEach(s => {
            let attrs = `id="${s.id}" lane="${s.lane}" startPos="${s.startPos}" endPos="${s.endPos}" friendlyPos="1"`;
            if (s.lines) attrs += ` lines="${s.lines}"`;
            xml += `    <busStop ${attrs}/>\n`;
        });
        this._busState.parkingAreas.forEach(p => {
            xml += `    <parkingArea id="${p.id}" lane="${p.lane}" startPos="${p.startPos}" endPos="${p.endPos}" angle="${p.angle||0}" roadsideCapacity="${p.capacity||0}"/>\n`;
        });
        this.copyToClipboard(xml);
    },

    // Parking flows
    rebuildParkingSetup(areaData) {
        const count = areaData ? areaData.length : parseInt(document.getElementById('parking-area-count')?.value || 1);
        const config = document.getElementById('parking-area-config');
        if (!config) return;

        const existing = this._busState.parkingAreas;
        const defaultRoute = this._flowsState.routes[0]?.id || '';
        const newIds = [];
        for (let i = 0; i < count; i++) {
            const src = areaData ? areaData[i] : null;
            newIds.push(src ? src.id : (existing[i]?.id || ('parking_' + (i + 1))));
        }
        if (areaData) {
            [this._busState.parkingData] = this._remapIndexedData(existing, newIds, [this._busState.parkingData]);
        }

        const oldIdToItem = {};
        existing.forEach(a => { oldIdToItem[a.id] = a; });
        const newAreas = newIds.map((id, i) => {
            const src = areaData ? areaData[i] : null;
            const old = oldIdToItem[id];
            return {
                id,
                name: old?.name || (src ? src.id : ('Parking Area ' + (i + 1))),
                lane: src ? src.lane : (old?.lane || ''),
                startPos: src ? src.startPos : (old?.startPos ?? 0),
                endPos: src ? src.endPos : (old?.endPos ?? 0),
                angle: src ? src.angle : (old?.angle ?? 0),
                capacity: src ? src.capacity : (old?.capacity ?? 0),
                routeId: old?.routeId || defaultRoute,
                duration: old?.duration ?? 120
            };
        });
        this._busState.parkingAreas = newAreas;

        config.innerHTML = '';
        newAreas.forEach((a, i) => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex; flex-direction:column; gap:0.3rem; min-width:170px;';
            div.innerHTML = `
                <label style="font-size:0.78rem; color:var(--text-secondary,#888); font-weight:500;">Area ${i+1} ID: <code style="font-size:0.78rem;">${a.id}</code></label>
                <input type="text" value="${a.name}" placeholder="Friendly name"
                    style="padding:0.3rem 0.5rem; border:1px solid #ccc; border-radius:4px; font-size:0.85rem;"
                    oninput="App._busState.parkingAreas[${i}].name = this.value; App.rebuildParkingTable(); App.saveToLocal();">
                <label style="font-size:0.72rem; color:var(--text-secondary,#888);">Route id (for export)
                    <input type="text" value="${a.routeId}" placeholder="e.g. route_1"
                        style="padding:0.25rem 0.4rem; border:1px solid #ccc; border-radius:4px; font-size:0.78rem; width:100%;"
                        oninput="App._busState.parkingAreas[${i}].routeId = this.value; App.saveToLocal();">
                </label>
                <label style="font-size:0.72rem; color:var(--text-secondary,#888);">Stop duration (s)
                    <input type="number" min="1" value="${a.duration}"
                        style="padding:0.25rem 0.4rem; border:1px solid #ccc; border-radius:4px; font-size:0.78rem; width:100%;"
                        oninput="App._busState.parkingAreas[${i}].duration = parseFloat(this.value)||120; App.saveToLocal();">
                </label>
            `;
            config.appendChild(div);
        });

        this.rebuildParkingTable();
    },

    rebuildParkingTable() {
        const wrapper = document.getElementById('parking-table-wrapper');
        if (!wrapper) return;
        const areas = this._busState.parkingAreas;
        if (!areas.length) { wrapper.innerHTML = '<p class="placeholder-text">Add parking areas above first.</p>'; return; }

        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        let totalMin = sh * 60 + sm;
        const duration = this._busState.intervalDuration;
        const intervals = this._busState.intervals;
        const VTYPES = ['motorcycle', 'tuk_tuk', 'passenger_car', 'heavy_bus', 'van', 'truck'];
        const VLABELS = ['Bike', 'Tuk-Tuk', 'Car', 'Bus', 'Van', 'Truck'];

        let html = '<table class="data-table" style="font-size:0.82rem; min-width:700px;"><thead><tr><th>Interval</th>';
        areas.forEach(a => { html += `<th colspan="${VTYPES.length}" style="text-align:center; border-left:2px solid #ccc;">${a.name}</th>`; });
        html += '</tr><tr><th></th>';
        areas.forEach(() => { VLABELS.forEach(vl => { html += `<th style="font-weight:500; font-size:0.78rem;">${vl}</th>`; }); });
        html += '</tr></thead><tbody>';

        for (let i = 0; i < intervals; i++) {
            const hh = Math.floor(totalMin / 60), mm = totalMin % 60;
            const nm = totalMin + duration;
            const label = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')} - ${String(Math.floor(nm/60)).padStart(2,'0')}:${String(nm%60).padStart(2,'0')}`;
            totalMin += duration;
            html += `<tr><td style="white-space:nowrap; font-weight:500;">${label}</td>`;
            areas.forEach((a, ai) => {
                VTYPES.forEach((vt, vi) => {
                    const key = `${ai}_${i}_${vt}`;
                    const val = this._busState.parkingData[key] || '';
                    html += `<td style="border-left: ${vi===0?'2px solid #ccc':'none'};"><input type="number" min="0" value="${val}"
                        oninput="App._busState.parkingData['${key}'] = this.value; App.saveToLocal();"
                        style="width:52px; padding:2px 4px; text-align:center; border:1px solid #ddd; border-radius:3px; font-size:0.8rem;"></td>`;
                });
            });
            html += '</tr>';
        }
        html += '</tbody></table>';
        wrapper.innerHTML = html;
    },

    copyParkingXML() {
        let xml = '';
        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        let totalSec = sh * 3600 + sm * 60;
        const durSec = this._busState.intervalDuration * 60;
        const areas = this._busState.parkingAreas;
        for (let i = 0; i < this._busState.intervals; i++) {
            const begin = totalSec, end = totalSec + durSec;
            areas.forEach((a, ai) => {
                FLOW_VEHICLE_TYPES.forEach(vt => {
                    const count = parseInt(this._busState.parkingData[`${ai}_${i}_${vt}`] || 0);
                    if (count > 0) {
                        const dur = a.duration || 120;
                        xml += `    <flow id="park_${a.id}_${vt}_${i}" type="${vt}" begin="${begin.toFixed(2)}" end="${end.toFixed(2)}" number="${count}" route="${a.routeId||''}"><stop parkingArea="${a.id}" duration="${dur.toFixed(1)}"/></flow>\n`;
                    }
                });
            });
            totalSec += durSec;
        }
        this.copyToClipboard(xml);
    },

    // ═══════════════════════════════════════════════════════
    // TAB 7: VALIDATION
    // ═══════════════════════════════════════════════════════
    handleValidationFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            document.getElementById('paste-validation').value = text;
            this.handleValidationPaste('paste-validation');
            event.target.value = '';
        };
        reader.onerror = () => {
            this.showToast('Error reading file', 'error');
        };
        reader.readAsText(file);
    },

    handleValidationPaste(textareaId) {
        const text = document.getElementById(textareaId).value.trim();
        if (!text) return;
        this.processValidationText(text);
    },

    async processValidationText(text) {
        try {
            let rawData;
            if (text.startsWith('<')) {
                rawData = DetectorManager.parseE1DetectorXML(text);
            } else {
                rawData = DetectorManager.parseCSV(text);
            }

            if (!rawData || !rawData.length) {
                this.showToast('No detector records found in the uploaded data.', 'error');
                return;
            }

            // window.prompt() is not supported in the Electron desktop app (it
            // always returns null there), so this no longer blocks on it —
            // each run just gets an automatic, timestamped description.
            const description = 'Processed ' + new Date().toLocaleString();
            const runNumber = DetectorManager.loadSavedRuns().length + 1;
            const runName = `Validation Run ${runNumber}`;

            // Build GEH comparison tables — detector list is discovered from the
            // uploaded data itself, so the number of tables adjusts automatically.
            const gehTables = this._buildGEHTables(rawData);

            this._lastGEHRawData = rawData;
            this._lastGEHRunName = runName;
            this._lastGEHDescription = description;

            // Render first — this is what the user actually came here to see.
            // Saving run history below is a best-effort side effect and must
            // never be able to block the tables from appearing.
            this.renderValidationResult(gehTables, runName, description);
            document.getElementById('paste-validation').value = '';
            this.showToast(`${runName} processed — ${Object.keys(gehTables).length} detector(s) found.`, 'success');

            try {
                localStorage.setItem('sumoLastGEHRawData', JSON.stringify(rawData));
                localStorage.setItem('sumoLastGEHMeta', JSON.stringify({ runName, description }));
                await DetectorManager.saveValidationToSheets(rawData, gehTables, runName, description);
                this.loadValidationRuns();
            } catch (saveErr) {
                console.warn('Could not save validation run history:', saveErr);
                this.showToast('Processed, but saving run history failed (storage may be full) — your results are still shown above.', 'info');
            }
        } catch (err) {
            this.showToast(`Error: ${err.message}`, 'error');
        }
    },

    // Delegates to intervalAggregation.js's aggregateRecordsByInterval(),
    // extracted verbatim so it's unit-testable under Node
    // (tests/intervalAggregation.test.js). Used by Validation and MAPE's
    // "Interval (min)" control to combine raw records into larger buckets.
    _aggregateRecordsByInterval(records, keyFn, sumFields, avgFields, intervalSec) {
        return aggregateRecordsByInterval(records, keyFn, sumFields, avgFields, intervalSec);
    },

    onValidationIntervalChange() {
        if (this._lastGEHRawData) {
            const gehTables = this._buildGEHTables(this._lastGEHRawData);
            this.renderValidationResult(gehTables, this._lastGEHRunName || 'Current', this._lastGEHDescription || '');
        }
    },

    onMapeIntervalChange() {
        if (this._lastMapeMode === 'detector' && this._lastMapeDetectorRaw) this._renderMapeFromDetectorRaw(this._lastMapeDetectorRaw);
        else if (this._lastMapeRaw) this._renderMapeFromRaw(this._lastMapeRaw);
    },

    // Parses "HH:MM" into seconds-since-midnight, or null if blank/invalid.
    _parseClockToSec(s) {
        const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
        if (!m) return null;
        return (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60) % 86400;
    },

    // Build GEH comparison tables from raw SUMO detector output. The detector list
    // and interval count/labels are both discovered from the data itself. An
    // optional "Show from/to" clock-time window (set above the table) limits
    // which interval rows are displayed and which are counted toward the
    // success rate — useful when the simulation covers more time than you have
    // real observed data for.
    _buildGEHTables(rawData) {
        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        const simStartSec = sh * 3600 + sm * 60;

        // Fallback interval length, used only when the uploaded data has a
        // single row and its native spacing can't be inferred from
        // consecutive timestamps. Previously a silent, undocumented 600s
        // (10-minute) assumption; now an explicit, user-visible input
        // (default 60 minutes) so the assumption is never invisible. This
        // does NOT double up with the aggregation input below: whichever of
        // the two actually determines a row's width, that same width is
        // what the hourly-equivalent scaling reads back out afterward, so
        // there is exactly one source of truth for "how wide is this row."
        const fallbackMinutes = parseFloat(document.getElementById('geh-interval-length-minutes')?.value);
        const fallbackDur = (fallbackMinutes > 0 ? fallbackMinutes : 60) * 60;

        const nativeBegins = Array.from(new Set(rawData.map(r => r.begin))).sort((a, b) => a - b);
        const nativeDur = nativeBegins.length > 1 ? (nativeBegins[1] - nativeBegins[0]) : fallbackDur;
        const minutesInput = parseFloat(document.getElementById('validation-interval-minutes')?.value);
        const intervalDur = (minutesInput > 0) ? Math.max(nativeDur, minutesInput * 60) : nativeDur;
        const intervalMinutes = intervalDur / 60;

        let grouped, begins;
        if (intervalDur > nativeDur) {
            const agg = this._aggregateRecordsByInterval(rawData, r => r.id, ['nVehContrib'], [], intervalDur);
            grouped = agg.grouped;
            begins = agg.begins;
        } else {
            grouped = {};
            rawData.forEach(r => { (grouped[r.id] = grouped[r.id] || []).push(r); });
            begins = nativeBegins;
        }

        const fmt = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2,'0')}:${String(Math.floor((t % 3600) / 60)).padStart(2,'0')}`;
        const clockFor = (beginSec) => {
            const startTotal = simStartSec + beginSec;
            const endTotal = startTotal + intervalDur;
            return `${fmt(startTotal)} - ${fmt(endTotal)}`;
        };

        const rangeFromSec = this._parseClockToSec(document.getElementById('validation-range-from')?.value);
        const rangeToSec = this._parseClockToSec(document.getElementById('validation-range-to')?.value);

        const tables = {};
        Object.keys(grouped).sort().forEach(detId => {
            const records = grouped[detId];
            const label = this._validationNames[detId] || detId;
            const rows = [];

            begins.forEach((beginSec, i) => {
                const rec = records.find(r => Math.abs(r.begin - beginSec) < 1);
                const sim = rec ? rec.nVehContrib : 0;
                const obs = (this.observedGEH[detId] && this.observedGEH[detId][i]) || 0;

                // GEH/status formulas live in gehMape.js (unit-tested in
                // tests/gehMape.test.js). TAG Unit M3.1's 5/10 thresholds
                // assume hourly flows, so the STATUS (and every rollup built
                // from it) is driven by the hourly-equivalent GEH, not the
                // raw-interval one — see gehMape.js's scaleToHourly. Both
                // values are kept on the row so the raw one is still visible.
                const gehRaw = calculateGEH(sim, obs);
                const simHourly = scaleToHourly(sim, intervalMinutes);
                const obsHourly = scaleToHourly(obs, intervalMinutes);
                const gehHourly = calculateGEH(simHourly, obsHourly);
                const status = getGEHStatus(gehHourly);

                const clockSec = (simStartSec + beginSec) % 86400;
                rows.push({
                    index: i, clock: clockFor(beginSec), clockSec, observed: obs, simulated: sim,
                    geh: gehRaw.toFixed(2), gehHourly: gehHourly.toFixed(2), status
                });
            });

            let visibleRows = rows;
            if (rangeFromSec !== null || rangeToSec !== null) {
                visibleRows = rows.filter(r => {
                    if (rangeFromSec !== null && r.clockSec < rangeFromSec) return false;
                    if (rangeToSec !== null && r.clockSec >= rangeToSec) return false;
                    return true;
                });
            }

            const validCount = visibleRows.filter(r => r.status === 'Good fit').length;
            const successRate = visibleRows.length ? ((validCount / visibleRows.length) * 100).toFixed(2) + '%' : '—';
            const modelStatus = getGEHModelStatus(validCount, visibleRows.length);

            tables[detId] = { label, rows: visibleRows, successRate, modelStatus, intervalMinutes, validCount, totalCount: visibleRows.length };
        });

        return tables;
    },

    renderValidationResult(gehTables, runName, description) {
        const container = document.getElementById('validation-results');
        if (!container) return;
        const ids = Object.keys(gehTables);

        if (!ids.length) {
            container.innerHTML = '<p class="placeholder-text" style="color:var(--text-secondary,#888);">No detectors found in the uploaded data.</p>';
            return;
        }

        let html = `
            <div class="validation-run-header">
                <h3 style="color:var(--accent-primary);margin:1rem 0">${runName} — GEH Validation Results (${ids.length} detector${ids.length === 1 ? '' : 's'})</h3>
                <p style="color:var(--text-secondary);margin-bottom:1.5rem;font-style:italic">${description}</p>
            </div>`;

        // TAG Unit M3.1's own rollup: % of detector-intervals GEH < 5,
        // pooled across ALL detectors (not one at a time) — a different
        // scope from each card's own "Success Rate" below, which is a
        // per-detector, three-tier LOCAL convention, not the TAG criterion
        // itself. Status here is driven by the hourly-equivalent GEH.
        const tagValidCount = ids.reduce((sum, id) => sum + gehTables[id].validCount, 0);
        const tagTotalCount = ids.reduce((sum, id) => sum + gehTables[id].totalCount, 0);
        const tagStatus = getTagM3RollupStatus(tagValidCount, tagTotalCount);
        const tagPct = tagTotalCount ? ((tagValidCount / tagTotalCount) * 100).toFixed(2) + '%' : '—';
        const tagMeets = tagStatus.startsWith('Meets');
        html += `<div style="background:${tagMeets ? '#ecfdf5' : '#fef2f2'};border:1px solid ${tagMeets ? '#a7f3d0' : '#fecaca'};color:${tagMeets ? '#065f46' : '#991b1b'};padding:0.75rem 1rem;border-radius:6px;margin-bottom:1rem;font-size:0.85rem;">
            <strong>TAG Unit M3.1 rollup (all detectors pooled):</strong> ${tagValidCount} of ${tagTotalCount} detector-intervals have GEH &lt; 5 (${tagPct}) — ${tagStatus}.
            Each card's own "Success Rate" below is this dashboard's own per-detector convention (three tiers at 85%/50%), not this criterion; both use the hourly-equivalent GEH.
        </div>`;

        // If a "Show from/to" window is set and it wiped out every single row,
        // that's almost always a mismatch between the typed range and the
        // simulation's actual clock (Sim Start Time in Vehicle Params), rather
        // than genuinely-missing data — spell that out instead of leaving
        // every card reading "No data in this window" with no explanation.
        const rangeFromVal = (document.getElementById('validation-range-from')?.value || '').trim();
        const rangeToVal = (document.getElementById('validation-range-to')?.value || '').trim();
        const totalVisible = ids.reduce((sum, id) => sum + gehTables[id].rows.length, 0);
        if ((rangeFromVal || rangeToVal) && totalVisible === 0 && this._lastGEHRawData && this._lastGEHRawData.length) {
            const simStart = document.getElementById('sim-start-time')?.value || '06:30';
            const [sh, sm] = simStart.split(':').map(Number);
            const simStartSec = sh * 3600 + sm * 60;
            const fmt = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2,'0')}:${String(Math.floor((t % 3600) / 60)).padStart(2,'0')}`;
            const begins = this._lastGEHRawData.map(r => r.begin);
            const dataFrom = fmt(simStartSec + Math.min(...begins));
            const dataTo = fmt(simStartSec + Math.max(...begins));
            html += `<div style="background:#fef3c7;border:1px solid #f59e0b;color:#78350f;padding:0.75rem 1rem;border-radius:6px;margin-bottom:1.25rem;font-size:0.85rem;">
                The "Show from / to" window (${rangeFromVal || '—'} to ${rangeToVal || '—'}) doesn't overlap this data's actual time range (<strong>${dataFrom}</strong> to <strong>${dataTo}</strong>, based on Sim Start Time = <strong>${simStart}</strong> in Vehicle Params). Clear the window above, or fix Sim Start Time if it's wrong.
            </div>`;
        }

        html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem;margin-bottom:2rem">`;

        ids.forEach(detId => {
            const t = gehTables[detId];
            const isSuccess = t.modelStatus === 'Success (Valid)';
            const statusColor = isSuccess ? '#22c55e' : t.modelStatus === 'Needs Calibration' ? '#f59e0b' : '#ef4444';

            html += `<div class="table-wrapper" style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden">`;
            html += `<div style="padding:0.6rem 1rem;background:var(--bg-card);border-bottom:1px solid var(--border-color)">
                <input type="text" value="${t.label}" placeholder="Friendly name" oninput="App.renameValidationDetector('${detId}', this.value)"
                    style="font-weight:bold;border:1px dashed var(--border-subtle,#ccc);background:transparent;color:inherit;font:inherit;width:100%;padding:2px;">
                <div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">id: ${detId}</div>
            </div>`;
            html += `<table class="data-table" style="font-size:0.8rem">
                <thead><tr>
                    <th>Time Interval</th>
                    <th>Observed</th>
                    <th>Simulated</th>
                    <th>GEH (raw interval)</th>
                    <th>GEH (hourly equiv.)</th>
                    <th>Status</th>
                </tr></thead><tbody>`;

            t.rows.forEach(row => {
                const gehHourlyNum = parseFloat(row.gehHourly);
                const gehColor = gehHourlyNum < 5 ? '#22c55e' : gehHourlyNum < 10 ? '#f59e0b' : '#ef4444';
                html += `<tr>
                    <td style="white-space:nowrap">${row.clock}</td>
                    <td style="text-align:center;"><input type="number" min="0" value="${row.observed}" onchange="App.updateObservedGEH('${detId}', ${row.index}, this.value)" style="width:56px;text-align:center;padding:2px;border:1px solid #ccc;border-radius:3px;"></td>
                    <td style="text-align:center;font-weight:bold">${row.simulated}</td>
                    <td style="text-align:center;color:var(--text-secondary);">${row.geh}</td>
                    <td style="text-align:center;font-weight:bold;color:${gehColor}">${row.gehHourly}</td>
                    <td style="font-size:0.72rem;color:${gehColor}">${row.status}</td>
                </tr>`;
            });

            html += `</tbody></table>`;
            html += `<div style="padding:0.3rem 1rem 0;font-size:0.68rem;color:var(--text-secondary);">Status is driven by the hourly-equivalent GEH (this interval = ${t.intervalMinutes.toFixed(0)} min, scaled ×${(60 / t.intervalMinutes).toFixed(2)}), not the raw-interval one.</div>`;
            html += `<div style="padding:0.5rem 1rem;background:var(--bg-card);border-top:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;font-size:0.78rem;">
                <span style="color:var(--text-secondary);">Success Rate (local convention): <strong>${t.successRate}</strong></span>
                <span style="color:${statusColor};font-weight:600;">${t.modelStatus}</span>
            </div>`;
            html += `</div>`;
        });

        html += `</div>`;
        container.innerHTML = html;
    },

    renderLastValidation() {
        const container = document.getElementById('validation-results');
        if (!container) return;
        if (this._lastGEHRawData && this._lastGEHRawData.length) {
            const gehTables = this._buildGEHTables(this._lastGEHRawData);
            this.renderValidationResult(gehTables, this._lastGEHRunName || 'Restored', this._lastGEHDescription || '');
        } else {
            container.innerHTML = '<p class="placeholder-text" style="color:var(--text-secondary,#888);">No validation data yet — upload or paste a detector_output.xml file above.</p>';
        }
    },

    renderMapeValidation() {
        // Restores the last uploaded/pasted MAPE result, or shows a placeholder
        // if nothing has been uploaded yet — never shows made-up numbers.
        const container = document.getElementById('mape-validation-container');
        if (!container) return;
        if (this._lastMapeMode === 'detector' && this._lastMapeDetectorRaw && this._lastMapeDetectorRaw.length) {
            this._renderMapeFromDetectorRaw(this._lastMapeDetectorRaw);
        } else if (this._lastMapeRaw && this._lastMapeRaw.length) {
            this._renderMapeFromRaw(this._lastMapeRaw);
        } else {
            container.innerHTML = '<p class="placeholder-text" style="color:var(--text-secondary,#888);">No MAPE data yet — upload or paste a travel_times_output.xml (or your own E1 detector_output.xml) file above.</p>';
        }
    },

    handleMapeFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            this._processMapeText(e.target.result);
            // Reset input so the same file can be selected again if needed
            event.target.value = '';
        };
        reader.onerror = () => {
            this.showToast('Error reading file', 'error');
        };
        reader.readAsText(file);
    },

    handleMapePaste() {
        const text = document.getElementById('paste-mape').value.trim();
        if (!text) {
            this.showToast('Please paste the XML data first', 'error');
            return;
        }
        this._processMapeText(text);
        document.getElementById('paste-mape').value = '';
    },

    // MAPE accepts two different SUMO output formats, auto-detected from the
    // content itself:
    //  - <edgeData>/<meandata> output: <interval begin=".." end=".."><edge id=".."
    //    traveltime=".."/></interval> — travel time is read directly.
    //  - Your own existing E1 detector_output.xml (same format as the
    //    Validation tab): <interval id=".." begin=".." speed=".." .../> — travel
    //    time isn't reported directly, so it's estimated per detector as
    //    (segment length you enter ÷ mean speed).
    _processMapeText(text) {
        text = (text || '').trim();
        if (!text) return;

        try {
            let cleanedText = text.replace(/<!--[\s\S]*?-->/g, '').trim();

            const parser = new DOMParser();
            const sniffDoc = parser.parseFromString(cleanedText, 'text/html');
            const isDetectorFormat = !!sniffDoc.querySelector('interval[id]');
            const isEdgeFormat = !!sniffDoc.querySelector('interval edge, edge[traveltime]');

            if (isDetectorFormat && !isEdgeFormat) {
                const raw = DetectorManager.parseE1DetectorXML(cleanedText);
                if (!raw || !raw.length) {
                    this.showToast('No detector records found in the pasted data', 'error');
                    return;
                }

                // Top up any recognized default pairs (e.g. det_sec1_galle_dir →
                // det_sec2_galle_dir) that aren't already represented among the
                // configured segments — runs on every upload/paste, not just the
                // first time, so a stray manually-added segment (or a partial
                // set from an earlier session) never permanently blocks the rest
                // of the detected defaults from appearing. Never touches or
                // removes an existing segment, so custom names/groups/distances
                // are always preserved.
                let autoDistanceCount = 0, addedSegmentCount = 0;
                const detIds = Array.from(new Set(raw.map(r => r.id))).filter(Boolean);
                const autoSegments = this._autoDetectMapeSegments(detIds);
                if (autoSegments.length) {
                    if (!this._mapeSegments) this._mapeSegments = [];
                    autoSegments.forEach(autoSeg => {
                        const alreadyExists = this._mapeSegments.some(s => s.fromDet === autoSeg.fromDet && s.toDet === autoSeg.toDet);
                        if (alreadyExists) return;
                        if (this._netLaneGraph) {
                            const d = this._computeDetectorDistance(autoSeg.fromDet, autoSeg.toDet);
                            if (d !== null && d > 0) { autoSeg.distance = d; autoDistanceCount++; }
                        }
                        this._mapeSegments.push(autoSeg);
                        addedSegmentCount++;
                    });
                    if (addedSegmentCount) this._saveMapeSegments();
                }

                // Render first — persisting this must never be able to block it.
                this._lastMapeDetectorRaw = raw;
                this._lastMapeMode = 'detector';
                this._renderMapeFromDetectorRaw(raw);
                let note = '';
                if (addedSegmentCount) {
                    note += ` Added ${addedSegmentCount} detected segment(s)${autoDistanceCount ? ` (distance auto-filled for ${autoDistanceCount})` : ''}.`;
                } else if (!(this._mapeSegments || []).length) {
                    note = ' Enter each segment\'s length below to compute travel time (or click Auto if your project\'s .net.xml is loaded).';
                }
                this.showToast(`MAPE table updated from ${raw.length} detector record(s).${note}`, 'success');

                try {
                    localStorage.setItem('sumoLastMapeDetectorRaw', JSON.stringify(raw));
                    localStorage.setItem('sumoLastMapeMode', JSON.stringify('detector'));
                } catch (saveErr) {
                    console.warn('Could not persist MAPE detector data:', saveErr);
                    this.showToast('Processed, but this result may not be restored next time you open the app (storage may be full).', 'info');
                }
                return;
            }

            // Otherwise, fall back to edgeData/meandata format.
            // SUMO outputs often miss the closing root tag if aborted or read mid-simulation
            if (!cleanedText.endsWith('</meandata>')) {
                cleanedText += '\n</meandata>';
            }

            let xmlDoc = parser.parseFromString(cleanedText, "text/xml");
            if (xmlDoc.querySelector('parsererror')) {
                // Strict XML parsing failed (e.g. stray characters, encoding
                // quirks) — retry in lenient HTML mode before giving up. Safe
                // here since 'begin'/'id'/'traveltime' are already lowercase.
                xmlDoc = parser.parseFromString(cleanedText, "text/html");
            }

            const intervals = Array.from(xmlDoc.querySelectorAll('interval'));
            if (intervals.length === 0) {
                this.showToast('No <interval> elements found in the pasted data', 'error');
                return;
            }

            // Edge ids and travel times are read directly from the file — no
            // hardcoded edge sequences, so this works for any network.
            const raw = intervals.map(intv => {
                const begin = parseFloat(intv.getAttribute('begin')) || 0;
                const edges = {};
                intv.querySelectorAll('edge').forEach(e => {
                    edges[e.getAttribute('id')] = parseFloat(e.getAttribute('traveltime') || 0);
                });
                return { begin, edges };
            });

            // Render first — a failure persisting this to localStorage (e.g. a
            // very large file hitting storage quota) must never be able to
            // block the tables from appearing.
            this._lastMapeRaw = raw;
            this._lastMapeMode = 'edge';
            this._renderMapeFromRaw(raw);
            this.showToast(`MAPE table updated from ${intervals.length} intervals!`, 'success');

            try {
                localStorage.setItem('sumoLastMapeRaw', JSON.stringify(raw));
                localStorage.setItem('sumoLastMapeMode', JSON.stringify('edge'));
            } catch (saveErr) {
                console.warn('Could not persist MAPE data:', saveErr);
                this.showToast('Processed, but this result may not be restored next time you open the app (storage may be full).', 'info');
            }
        } catch (err) {
            this.showToast(`Error: ${err.message}`, 'error');
        }
    },

    // Renders the MAPE table from raw parsed meandata (begin + per-edge traveltime).
    // Edge list and interval count are discovered from the data — no hardcoded edges.
    _renderMapeFromRaw(raw) {
        const container = document.getElementById('mape-validation-container');
        if (!container) return;

        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        const simStartSec = sh * 3600 + sm * 60;

        const nativeBegins = Array.from(new Set(raw.map(r => r.begin))).sort((a, b) => a - b);
        const nativeDur = nativeBegins.length > 1 ? (nativeBegins[1] - nativeBegins[0]) : 600;
        const minutesInput = parseFloat(document.getElementById('mape-interval-minutes')?.value);
        const intervalDur = (minutesInput > 0) ? Math.max(nativeDur, minutesInput * 60) : nativeDur;

        const edgeIdsSet = new Set();
        raw.forEach(r => Object.keys(r.edges).forEach(id => edgeIdsSet.add(id)));
        const edgeIds = Array.from(edgeIdsSet).sort();

        if (!edgeIds.length) {
            container.innerHTML = '<p class="placeholder-text" style="color:var(--text-secondary,#888);">No edges found in the uploaded data.</p>';
            return;
        }

        let grouped, begins;
        if (intervalDur > nativeDur) {
            const flat = [];
            raw.forEach(r => { Object.keys(r.edges).forEach(id => flat.push({ begin: r.begin, id, traveltime: r.edges[id] })); });
            const agg = this._aggregateRecordsByInterval(flat, r => r.id, [], ['traveltime'], intervalDur);
            grouped = agg.grouped;
            begins = agg.begins;
        } else {
            grouped = {};
            edgeIds.forEach(id => { grouped[id] = []; });
            raw.forEach(r => {
                Object.keys(r.edges).forEach(id => {
                    grouped[id].push({ begin: r.begin, traveltime: r.edges[id] });
                });
            });
            begins = nativeBegins;
        }

        const clockFor = (beginSec) => {
            const startTotal = simStartSec + beginSec;
            const endTotal = startTotal + intervalDur;
            const fmt = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2,'0')}:${String(Math.floor((t % 3600) / 60)).padStart(2,'0')}`;
            return `${fmt(startTotal)} - ${fmt(endTotal)}`;
        };
        let html = `
            <div class="validation-run-header">
                <h3 style="color:var(--accent-primary);margin:1rem 0">MAPE Time Gather Validation (${edgeIds.length} edge${edgeIds.length === 1 ? '' : 's'})</h3>
                <p style="color:var(--text-secondary);margin-bottom:1.5rem;font-style:italic">Mean Absolute Percentage Error between observed and simulated travel times.</p>
            </div>`;

        html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem;margin-bottom:2rem">`;

        const bandPct = parseFloat(document.getElementById('mape-acceptance-band')?.value) || 15;

        edgeIds.forEach(edgeId => {
            const label = this._mapeNames[edgeId] || edgeId;
            let validCount = 0;
            const records = grouped[edgeId] || [];
            const rows = begins.map((beginSec, i) => {
                const rec = records.find(r => r.begin === beginSec);
                const sim = Math.round((rec && rec.traveltime) || 0);
                const obs = (this.observedMAPE[edgeId] && this.observedMAPE[edgeId][i]) || 0;
                // Edge-format MAPE formulas live in gehMape.js (unit-tested in
                // tests/gehMape.test.js, kept distinct from the detector-pair
                // path's — see that file's comment for why).
                const errPct = calculateMapeError(sim, obs);
                const mpePct = calculateMpe(sim, obs);
                const status = getMapeStatusEdgeFormat(errPct, bandPct);
                if (status !== 'Invalid') validCount++;
                return { index: i, clock: clockFor(beginSec), obs, sim, err: errPct.toFixed(2) + '%', mpe: mpePct, status };
            });
            const successRate = ((validCount / begins.length) * 100).toFixed(2) + '%';
            const meanPercentageError = rows.length ? (rows.reduce((s, r) => s + r.mpe, 0) / rows.length) : 0;
            const modelStatus = getMapeModelStatusEdgeFormat(validCount, begins.length);
            const statusColor = modelStatus === 'Success (Valid)' ? '#22c55e' : '#f59e0b';

            html += `<div class="table-wrapper" style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden">`;
            html += `<div style="padding:0.6rem 1rem;background:var(--bg-card);border-bottom:1px solid var(--border-color)">
                <input type="text" value="${label}" placeholder="Friendly name" oninput="App.renameMapeEdge('${edgeId}', this.value)"
                    style="font-weight:bold;border:1px dashed var(--border-subtle,#ccc);background:transparent;color:inherit;font:inherit;width:100%;padding:2px;">
                <div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">edge: ${edgeId}</div>
            </div>`;
            html += `<table class="data-table" style="font-size:0.8rem">
                <thead><tr>
                    <th>Time Interval</th>
                    <th>Observed (s)</th>
                    <th>Simulated (s)</th>
                    <th>% Error (abs.)</th>
                    <th>Signed % Error</th>
                    <th>Status</th>
                </tr></thead><tbody>`;

            rows.forEach(row => {
                const sl = row.status.toLowerCase();
                const rc = sl.includes('excellent') ? '#22c55e' : sl.includes('marginal') ? '#f59e0b' : '#ef4444';
                html += `<tr>
                    <td style="white-space:nowrap">${row.clock}</td>
                    <td style="text-align:center;"><input type="number" min="0" value="${row.obs}" onchange="App.updateObservedMAPE('${edgeId}', ${row.index}, this.value)" style="width:56px;text-align:center;padding:2px;border:1px solid #ccc;border-radius:3px;"></td>
                    <td style="text-align:center;font-weight:bold">${row.sim}</td>
                    <td style="text-align:center;font-weight:bold;color:${rc}">${row.err}</td>
                    <td style="text-align:center;color:var(--text-secondary);">${row.mpe >= 0 ? '+' : ''}${row.mpe.toFixed(2)}%</td>
                    <td style="font-size:0.72rem;color:${rc}">${row.status}</td>
                </tr>`;
            });

            html += `</tbody></table>`;
            html += `<div style="padding:0.5rem 1rem;background:var(--bg-card);border-top:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;font-size:0.78rem;">
                <span style="color:var(--text-secondary);">Success Rate (&le;${bandPct}% band): <strong>${successRate}</strong> &nbsp;|&nbsp; MPE: <strong>${meanPercentageError >= 0 ? '+' : ''}${meanPercentageError.toFixed(2)}%</strong></span>
                <span style="color:${statusColor};font-weight:600;">${modelStatus}</span>
            </div>`;
            html += `</div>`;
        });

        html += `</div>`;
        container.innerHTML = html;
    },

    // Renders MAPE from raw E1 detector records (same shape DetectorManager.
    // parseE1DetectorXML returns for the Validation tab: begin/end/id/speed/
    // harmonicMeanSpeed/... per interval). A detector only reports speed at one
    // point, not travel time, so simulated travel time is estimated per
    // detector as (segment length you enter, in meters) ÷ (mean speed, m/s).
    _renderMapeFromDetectorRaw(raw) {
        const container = document.getElementById('mape-validation-container');
        if (!container) return;

        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        const simStartSec = sh * 3600 + sm * 60;

        const nativeBegins = Array.from(new Set(raw.map(r => r.begin))).sort((a, b) => a - b);
        const nativeDur = nativeBegins.length > 1 ? (nativeBegins[1] - nativeBegins[0]) : 600;
        const minutesInput = parseFloat(document.getElementById('mape-interval-minutes')?.value);
        const intervalDur = (minutesInput > 0) ? Math.max(nativeDur, minutesInput * 60) : nativeDur;

        let grouped, begins;
        if (intervalDur > nativeDur) {
            const agg = this._aggregateRecordsByInterval(raw, r => r.id, [], ['speed', 'harmonicMeanSpeed'], intervalDur);
            grouped = agg.grouped;
            begins = agg.begins;
        } else {
            grouped = {};
            raw.forEach(r => {
                if (!r.id) return;
                (grouped[r.id] = grouped[r.id] || []).push(r);
            });
            begins = nativeBegins;
        }
        const detIds = Object.keys(grouped).sort();

        if (!detIds.length) {
            container.innerHTML = '<p class="placeholder-text" style="color:var(--text-secondary,#888);">No detectors found in the uploaded data.</p>';
            return;
        }

        const clockFor = (beginSec) => {
            const startTotal = simStartSec + beginSec;
            const endTotal = startTotal + intervalDur;
            const fmt = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2,'0')}:${String(Math.floor((t % 3600) / 60)).padStart(2,'0')}`;
            return `${fmt(startTotal)} - ${fmt(endTotal)}`;
        };
        const rangeFromSec = this._parseClockToSec(document.getElementById('mape-range-from')?.value);
        const rangeToSec = this._parseClockToSec(document.getElementById('mape-range-to')?.value);

        let html = `
            <div class="validation-run-header">
                <h3 style="color:var(--accent-primary);margin:1rem 0">MAPE Time Gather Validation — Detector-to-Detector Travel Time (${detIds.length} detector${detIds.length === 1 ? '' : 's'})</h3>
                <p style="color:var(--text-secondary);margin-bottom:1.5rem;font-style:italic">A single detector only measures speed at one point — define a segment between two detectors (e.g. "Detector 1 → Detector 2") with the real distance between them; simulated travel time is computed as distance ÷ average of the two detectors' mean speed.</p>
            </div>`;

        if ((document.getElementById('mape-range-from')?.value || document.getElementById('mape-range-to')?.value) && begins.every(beginSec => {
            const clockSec = (simStartSec + beginSec) % 86400;
            return (rangeFromSec !== null && clockSec < rangeFromSec) || (rangeToSec !== null && clockSec >= rangeToSec);
        })) {
            const fmt = (t) => `${String(Math.floor(t / 3600) % 24).padStart(2,'0')}:${String(Math.floor((t % 3600) / 60)).padStart(2,'0')}`;
            const dataFrom = fmt(simStartSec + Math.min(...begins));
            const dataTo = fmt(simStartSec + Math.max(...begins));
            html += `<div style="background:#fef3c7;border:1px solid #f59e0b;color:#78350f;padding:0.75rem 1rem;border-radius:6px;margin-bottom:1.25rem;font-size:0.85rem;">
                The "Show from / to" window doesn't overlap this data's actual time range (<strong>${dataFrom}</strong> to <strong>${dataTo}</strong>, based on Sim Start Time = <strong>${simStart}</strong> in Vehicle Params). Clear the window above, or fix Sim Start Time if it's wrong.
            </div>`;
        }

        html += this._renderMapeSegmentConfigHtml(detIds);

        const segments = this._mapeSegments || [];
        if (!segments.length) {
            html += '<p class="placeholder-text" style="color:var(--text-secondary,#888);">No travel-time segments defined yet — click "+ Add Segment" above.</p>';
            container.innerHTML = html;
            return;
        }

        const bandPct = parseFloat(document.getElementById('mape-acceptance-band')?.value) || 15;

        const cardHtml = (seg) => {
            const fromRecords = grouped[seg.fromDet] || [];
            const toRecords = grouped[seg.toDet] || [];
            const hasBoth = !!(seg.fromDet && seg.toDet);

            const allRows = begins.map((beginSec, i) => {
                const fr = fromRecords.find(r => r.begin === beginSec);
                const tr = toRecords.find(r => r.begin === beginSec);
                const speedFrom = fr ? (fr.harmonicMeanSpeed || fr.speed || 0) : 0;
                const speedTo = tr ? (tr.harmonicMeanSpeed || tr.speed || 0) : 0;
                // MAPE formulas live in gehMape.js (unit-tested in
                // tests/gehMape.test.js) — same values as before, just extracted.
                const avgSpeed = computeMapeAvgSpeed(speedFrom, speedTo);
                const sim = computeMapeSimulatedTravelTime(hasBoth, seg.distance, avgSpeed);
                const obs = (this.observedMAPE[seg.id] && this.observedMAPE[seg.id][i]) || 0;
                const errPct = calculateMapeError(sim, obs);
                const mpePct = calculateMpe(sim, obs);
                const status = getMapeStatus(hasBoth, seg.distance, errPct, bandPct);
                const clockSec = (simStartSec + beginSec) % 86400;
                return { index: i, clock: clockFor(beginSec), clockSec, obs, sim, err: errPct.toFixed(2) + '%', mpe: mpePct, status };
            });

            let rows = allRows;
            if (rangeFromSec !== null || rangeToSec !== null) {
                rows = allRows.filter(r => {
                    if (rangeFromSec !== null && r.clockSec < rangeFromSec) return false;
                    if (rangeToSec !== null && r.clockSec >= rangeToSec) return false;
                    return true;
                });
            }

            const validCount = rows.filter(r => r.status !== 'Invalid' && r.status !== 'Needs distance' && r.status !== 'Needs both detectors').length;
            const configuredRows = rows.filter(r => r.status !== 'Needs distance' && r.status !== 'Needs both detectors');
            const successRate = rows.length ? ((validCount / rows.length) * 100).toFixed(2) + '%' : '—';
            const meanPercentageError = configuredRows.length ? (configuredRows.reduce((s, r) => s + r.mpe, 0) / configuredRows.length) : 0;
            const modelStatus = getMapeModelStatus(validCount, rows.length);
            const statusColor = modelStatus === 'Success (Valid)' ? '#22c55e' : modelStatus === 'No data in this window' ? '#ef4444' : '#f59e0b';

            let card = `<div class="table-wrapper" style="border:1px solid var(--border-color);border-radius:8px;overflow:hidden">`;
            card += `<div style="padding:0.6rem 1rem;background:var(--bg-card);border-bottom:1px solid var(--border-color)">
                <div style="font-weight:bold;">${seg.name || seg.id}</div>
                <div style="font-size:0.72rem;color:var(--text-secondary);margin-top:2px;">${seg.fromDet || '(from?)'} → ${seg.toDet || '(to?)'} · ${seg.distance || 0} m</div>
            </div>`;
            card += `<table class="data-table" style="font-size:0.8rem">
                <thead><tr>
                    <th>Time Interval</th>
                    <th>Observed (s)</th>
                    <th>Simulated (s)</th>
                    <th>% Error (abs.)</th>
                    <th>Signed % Error</th>
                    <th>Status</th>
                </tr></thead><tbody>`;

            rows.forEach(row => {
                const sl = row.status.toLowerCase();
                const rc = sl.includes('excellent') ? '#22c55e' : sl.includes('marginal') ? '#f59e0b' : (sl.includes('needs')) ? '#9ca3af' : '#ef4444';
                // % Error is only meaningless while the segment isn't fully
                // configured yet ("Needs both detectors"/"Needs distance") —
                // once configured, show the real number even when it's 0
                // (previously this hid the error whenever sim happened to be
                // 0, which also hid a genuine 100% miss on a fully-configured
                // zero-speed interval; see gehMape.js's calculateMapeError).
                const notConfigured = row.status === 'Needs both detectors' || row.status === 'Needs distance';
                card += `<tr>
                    <td style="white-space:nowrap">${row.clock}</td>
                    <td style="text-align:center;"><input type="number" min="0" value="${row.obs}" onchange="App.updateObservedMAPE('${seg.id}', ${row.index}, this.value)" style="width:56px;text-align:center;padding:2px;border:1px solid #ccc;border-radius:3px;"></td>
                    <td style="text-align:center;font-weight:bold">${notConfigured ? '—' : row.sim}</td>
                    <td style="text-align:center;font-weight:bold;color:${rc}">${notConfigured ? '—' : row.err}</td>
                    <td style="text-align:center;color:var(--text-secondary);">${notConfigured ? '—' : (row.mpe >= 0 ? '+' : '') + row.mpe.toFixed(2) + '%'}</td>
                    <td style="font-size:0.72rem;color:${rc}">${row.status}</td>
                </tr>`;
            });

            card += `</tbody></table>`;
            card += `<div style="padding:0.5rem 1rem;background:var(--bg-card);border-top:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;font-size:0.78rem;">
                <span style="color:var(--text-secondary);">Success Rate (&le;${bandPct}% band): <strong>${successRate}</strong> &nbsp;|&nbsp; MPE: <strong>${meanPercentageError >= 0 ? '+' : ''}${meanPercentageError.toFixed(2)}%</strong></span>
                <span style="color:${statusColor};font-weight:600;">${modelStatus}</span>
            </div>`;
            card += `</div>`;
            return card;
        };

        const groupOrder = [];
        const byGroup = {};
        segments.forEach(seg => {
            const g = seg.group || '';
            if (!byGroup[g]) { byGroup[g] = []; groupOrder.push(g); }
            byGroup[g].push(seg);
        });

        const gridOpen = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:1rem;margin-bottom:1.5rem">';
        if (groupOrder.length === 1 && groupOrder[0] === '') {
            // No one has set a group yet — just one flat grid, no headers.
            html += gridOpen + segments.map(cardHtml).join('') + '</div>';
        } else {
            groupOrder.forEach(g => {
                html += `<h4 style="margin:1.5rem 0 0.75rem;color:var(--text-primary);">${g || 'Ungrouped'}</h4>`;
                html += gridOpen + byGroup[g].map(cardHtml).join('') + '</div>';
            });
        }

        container.innerHTML = html;
    },

    // Builds the "Travel-Time Segments" config panel: each segment pairs two
    // detectors (from/to) with the real distance between them.
    // Computes the real road distance (meters) between two detectors using
    // the lane graph built from the project's .net.xml (lane lengths +
    // legal connections, including internal junction lanes). Returns null
    // if the network wasn't loaded, either detector is unknown, or no path
    // exists within the search bounds — callers should fall back to asking
    // the user to enter the distance manually in that case.
    // Core Dijkstra graph traversal lives in graphDistance.js's
    // computeLaneGraphDistance() — extracted so it's unit-testable under
    // Node (tests/graphDistance.test.js). This method just resolves the two
    // detector ids to lane/position via project state, then delegates.
    _computeDetectorDistance(fromDetId, toDetId) {
        const graph = this._netLaneGraph;
        if (!graph) return null;
        const detMap = {};
        (this.project.detectors || []).forEach(d => { detMap[d.id] = d; });
        const fromDet = detMap[fromDetId], toDet = detMap[toDetId];
        if (!fromDet || !toDet || !fromDet.lane || !toDet.lane) return null;
        return computeLaneGraphDistance(
            graph.laneLength, graph.adjacency,
            fromDet.lane, toDet.lane,
            fromDet.pos || 0, toDet.pos || 0
        );
    },

    autoCalcMapeSegmentDistance(id) {
        const seg = (this._mapeSegments || []).find(s => s.id === id);
        if (!seg) return;
        if (!seg.fromDet || !seg.toDet) {
            this.showToast('Select both a From and To detector first.', 'error');
            return;
        }
        if (!this._netLaneGraph) {
            this.showToast('Load your SUMO project folder (with the .net.xml) to auto-calculate distance.', 'error');
            return;
        }
        const d = this._computeDetectorDistance(seg.fromDet, seg.toDet);
        if (d === null || d <= 0) {
            this.showToast('Could not trace a road path between these detectors — enter the distance manually.', 'error');
            return;
        }
        seg.distance = d;
        this._saveMapeSegments();
        if (this._lastMapeDetectorRaw) this._renderMapeFromDetectorRaw(this._lastMapeDetectorRaw);
        this.showToast(`Auto-calculated distance: ${d} m`, 'success');
    },

    _renderMapeSegmentConfigHtml(detIds) {
        const segments = this._mapeSegments || [];
        const detOptions = (selected) => detIds.map(id => `<option value="${id}" ${id === selected ? 'selected' : ''}>${id}</option>`).join('');

        let html = `<div style="background:var(--bg-surface-hover,#f4f4f4); border:1px solid var(--border-subtle,#ccc); border-radius:8px; padding:1rem; margin-bottom:1.5rem;">`;
        html += `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
            <strong style="font-size:0.9rem;">Travel-Time Segments</strong>
            <div style="display:flex; gap:0.5rem;">
                <button class="btn btn-secondary" style="padding:0.3rem 0.7rem; font-size:0.8rem;" onclick="App.resetMapeSegmentsToDefaults()" title="Re-detect segments from your detector naming pattern (e.g. det_sec1_galle_dir) and replace whatever is configured now">Reset to Detected Defaults</button>
                <button class="btn btn-secondary" style="padding:0.3rem 0.7rem; font-size:0.8rem;" onclick="App.addMapeSegment()">+ Add Segment</button>
            </div>
        </div>`;

        if (!segments.length) {
            html += `<p style="font-size:0.82rem; color:var(--text-secondary,#888); margin:0;">No segments yet. Add one to define travel time between two detectors (e.g. "Detector 1 → Detector 2").</p>`;
        } else {
            html += `<div style="display:flex; flex-direction:column; gap:0.5rem;">`;
            segments.forEach(seg => {
                html += `<div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; background:var(--bg-card,#fff); padding:0.5rem; border-radius:6px; border:1px solid var(--border-subtle,#ddd);">
                    <input type="text" value="${seg.name || ''}" placeholder="Segment name (e.g. Detector 1-2)" onchange="App.updateMapeSegmentField('${seg.id}','name',this.value)"
                        style="width:170px; padding:0.3rem 0.4rem; border:1px solid #ccc; border-radius:4px; font-size:0.82rem;">
                    <input type="text" value="${seg.group || ''}" placeholder="Group (e.g. Galle Direction)" onchange="App.updateMapeSegmentField('${seg.id}','group',this.value)"
                        style="width:150px; padding:0.3rem 0.4rem; border:1px solid #ccc; border-radius:4px; font-size:0.82rem;">
                    <label style="font-size:0.78rem; color:var(--text-secondary);">From:
                        <select onchange="App.updateMapeSegmentField('${seg.id}','fromDet',this.value)" style="padding:0.25rem; border:1px solid #ccc; border-radius:4px; font-size:0.8rem;">
                            <option value="">—</option>${detOptions(seg.fromDet)}
                        </select>
                    </label>
                    <label style="font-size:0.78rem; color:var(--text-secondary);">To:
                        <select onchange="App.updateMapeSegmentField('${seg.id}','toDet',this.value)" style="padding:0.25rem; border:1px solid #ccc; border-radius:4px; font-size:0.8rem;">
                            <option value="">—</option>${detOptions(seg.toDet)}
                        </select>
                    </label>
                    <label style="font-size:0.78rem; color:var(--text-secondary);">Distance (m):
                        <input type="number" min="0" value="${seg.distance || ''}" placeholder="e.g. 800" onchange="App.updateMapeSegmentField('${seg.id}','distance',this.value)"
                            style="width:80px; padding:0.25rem 0.4rem; border:1px solid #ccc; border-radius:4px; font-size:0.8rem;">
                    </label>
                    <button class="btn btn-secondary" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="App.autoCalcMapeSegmentDistance('${seg.id}')" title="Calculate distance from the loaded .net.xml road network">Auto</button>
                    <button class="btn btn-secondary" style="padding:0.2rem 0.5rem; font-size:0.75rem; margin-left:auto;" onclick="App.removeMapeSegment('${seg.id}')">Remove</button>
                </div>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    },

    // Recognizes the "det_sec{N}_{direction}_dir" naming convention (e.g.
    // det_sec1_galle_dir, det_sec2_juul_dir) and, if so, proposes one segment
    // per consecutive pair of sections within each direction — e.g. sections
    // 1,2,3 become "Detector 1-2" and "Detector 2-3". This only ever primes
    // an EMPTY segment list as a convenient starting point; it never overwrites
    // segments that already exist, and every field stays fully editable
    // afterward (rename, regroup, re-pair, change distance, add/remove).
    _autoDetectMapeSegments(detIds) {
        const pattern = /^det_sec(\d+)_(.+)_dir$/i;
        const byDirection = {};
        detIds.forEach(id => {
            const m = id.match(pattern);
            if (!m) return;
            const section = parseInt(m[1], 10);
            const direction = m[2].toLowerCase();
            if (!byDirection[direction]) byDirection[direction] = {};
            byDirection[direction][section] = id;
        });

        const DIRECTION_LABELS = { galle: 'Galle Direction', juul: 'Julgaha Direction' };
        const segments = [];
        Object.keys(byDirection).forEach(direction => {
            const sections = Object.keys(byDirection[direction]).map(Number).sort((a, b) => a - b);
            if (sections.length < 2) return;
            const groupLabel = DIRECTION_LABELS[direction] || (direction.charAt(0).toUpperCase() + direction.slice(1) + ' Direction');
            // "juul" runs the opposite way to traffic flow in this project's
            // convention (paired 3→2, 2→1) — any other direction name defaults
            // to increasing section order, adjustable by the user either way.
            const order = direction === 'juul' ? sections.slice().reverse() : sections;
            for (let i = 0; i < order.length - 1; i++) {
                const fromSec = order[i], toSec = order[i + 1];
                segments.push({
                    id: 'seg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '_' + i,
                    name: `Detector ${fromSec}-${toSec}`,
                    group: groupLabel,
                    fromDet: byDirection[direction][fromSec],
                    toDet: byDirection[direction][toSec],
                    distance: 0
                });
            }
        });
        return segments;
    },

    // Manually re-runs auto-detection and overwrites whatever segments are
    // currently configured. Needed because the automatic first-time detection
    // only fires when the segment list is completely empty — once even one
    // segment exists (e.g. a leftover manually-added one from earlier
    // testing), it's permanently skipped otherwise, with no way back to the
    // detected defaults except this explicit action.
    resetMapeSegmentsToDefaults() {
        const raw = this._lastMapeDetectorRaw;
        if (!raw || !raw.length) {
            this.showToast('Upload or paste your detector data first.', 'error');
            return;
        }
        const detIds = Array.from(new Set(raw.map(r => r.id))).filter(Boolean);
        const autoSegments = this._autoDetectMapeSegments(detIds);
        if (!autoSegments.length) {
            this.showToast('None of your detector ids match the recognized "det_secN_direction_dir" pattern — add segments manually with "+ Add Segment".', 'error');
            return;
        }
        if ((this._mapeSegments || []).length && !window.confirm('Replace the current segments with the auto-detected defaults? Any manual names, groups or distances you\'ve set will be lost.')) {
            return;
        }
        let autoDistanceCount = 0;
        if (this._netLaneGraph) {
            autoSegments.forEach(seg => {
                const d = this._computeDetectorDistance(seg.fromDet, seg.toDet);
                if (d !== null && d > 0) { seg.distance = d; autoDistanceCount++; }
            });
        }
        this._mapeSegments = autoSegments;
        this._saveMapeSegments();
        this._renderMapeFromDetectorRaw(raw);
        const distanceNote = autoDistanceCount ? ` Distance auto-calculated for ${autoDistanceCount} segment(s).` : ' Load your project folder (.net.xml) and use the Auto button to fill in distances.';
        this.showToast(`Reset to ${autoSegments.length} auto-detected segment(s).${distanceNote}`, 'success');
    },

    addMapeSegment() {
        if (!this._mapeSegments) this._mapeSegments = [];
        const id = 'seg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        this._mapeSegments.push({ id, name: 'Segment ' + (this._mapeSegments.length + 1), group: '', fromDet: '', toDet: '', distance: 0 });
        this._saveMapeSegments();
        if (this._lastMapeDetectorRaw) this._renderMapeFromDetectorRaw(this._lastMapeDetectorRaw);
    },

    removeMapeSegment(id) {
        this._mapeSegments = (this._mapeSegments || []).filter(s => s.id !== id);
        this._saveMapeSegments();
        if (this._lastMapeDetectorRaw) this._renderMapeFromDetectorRaw(this._lastMapeDetectorRaw);
    },

    updateMapeSegmentField(id, field, value) {
        const seg = (this._mapeSegments || []).find(s => s.id === id);
        if (!seg) return;
        seg[field] = field === 'distance' ? (parseFloat(value) || 0) : value;
        this._saveMapeSegments();
        if (this._lastMapeDetectorRaw) this._renderMapeFromDetectorRaw(this._lastMapeDetectorRaw);
    },

    _saveMapeSegments() {
        try { localStorage.setItem('sumoMapeSegments', JSON.stringify(this._mapeSegments || [])); } catch (e) { /* best effort */ }
    },

    loadValidationRuns() {
        const container = document.getElementById('saved-validation-runs');
        const runs = DetectorManager.loadSavedRuns();

        if (runs.length === 0) {
            container.innerHTML = '<p class="placeholder-text">No validation runs saved yet. Upload detector data above.</p>';
            return;
        }

        let html = '<div class="validation-run-list">';
        runs.forEach((run, idx) => {
            const date = new Date(run.date).toLocaleString();
            const desc = run.description ? `<span class="run-desc" style="color:var(--text-secondary);font-size:0.78rem;font-style:italic;display:block;margin-top:2px">${run.description}</span>` : '';
            html += `<div class="validation-run-item">
                <div>
                    <span class="run-name">${run.name}</span>
                    <span class="run-date">${date}</span>
                    ${desc}
                </div>
                <div style="display:flex;gap:0.5rem;align-items:center">
                    <button class="btn btn-secondary btn-sm" onclick="App.viewValidationRun(${idx})">View</button>
                    <button class="btn btn-danger btn-sm" onclick="App.deleteValidationRun(${idx})">Delete</button>
                </div>
            </div>`;
        });
        html += '</div>';
        container.innerHTML = html;
    },

    viewValidationRun(idx) {
        const runs = DetectorManager.loadSavedRuns();
        if (runs[idx]) {
            this.renderValidationResult(runs[idx].gehTables, runs[idx].name, runs[idx].description || '');
        }
    },

    deleteValidationRun(idx) {
        if (confirm('Delete this validation run from local storage?')) {
            DetectorManager.deleteRun(idx);
            this.loadValidationRuns();
            this.showToast('Run deleted.');
        }
    },

    exportValidationRun(idx) {
        const runs = DetectorManager.loadSavedRuns();
        if (runs[idx]) {
            DetectorManager.exportAsCSV(runs[idx].data, `${runs[idx].name}.csv`);
            this.showToast('CSV exported!');
        }
    },

    // ═══════════════════════════════════════════════════════
    // COPY FULL XML — Complete Vehicles.rou.xml in time order
    // ═══════════════════════════════════════════════════════
    copyFullXML() {
        const xml = this._buildFullXML();
        this.copyToClipboard(xml);
        this.showToast(`Full XML copied! (${xml.split('\n').length} lines)`);
    },

    downloadFullXML() {
        const xml = this._buildFullXML();
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Vehicles.rou.xml';
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('Vehicles.rou.xml downloaded!');
    },


    // TAB 8: EMISSIONS ANALYSIS

    // --- FUEL PRICE FRESHNESS REMINDER ---
    // There's no free/reliable live fuel-price API, so prices stay manual —
    // this just reminds the user (with their region, if they opt in) when the
    // stored date is getting old. Never fetches prices automatically.
    saveFuelPriceMeta() {
        const meta = {
            diesel: document.getElementById('fuel-price-diesel')?.value,
            petrol: document.getElementById('fuel-price-petrol')?.value,
            date: document.getElementById('fuel-price-date')?.value
        };
        localStorage.setItem('sumoFuelPriceMeta', JSON.stringify(meta));
        this.renderFuelPriceReminder();
    },

    loadFuelPriceMeta() {
        try {
            const meta = JSON.parse(localStorage.getItem('sumoFuelPriceMeta'));
            if (meta) {
                if (meta.diesel !== undefined) document.getElementById('fuel-price-diesel').value = meta.diesel;
                if (meta.petrol !== undefined) document.getElementById('fuel-price-petrol').value = meta.petrol;
                if (meta.date !== undefined) document.getElementById('fuel-price-date').value = meta.date;
            }
        } catch (e) {}
        this.renderFuelPriceReminder();
    },

    async detectLocationForFuelPrices() {
        if (!navigator.onLine) {
            this.showToast('You appear to be offline — try again once connected.', 'error');
            return;
        }
        if (!navigator.geolocation) {
            this.showToast('Geolocation is not available in this browser.', 'error');
            return;
        }
        this.showToast('Requesting location permission...', 'info');
        navigator.geolocation.getCurrentPosition(async (pos) => {
            try {
                const { latitude, longitude } = pos.coords;
                const resp = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`);
                const data = await resp.json();
                const country = data.countryName || '';
                localStorage.setItem('sumoFuelPriceRegion', JSON.stringify({ country, detectedAt: new Date().toISOString() }));
                this.showToast(country ? `Region detected: ${country}` : 'Could not determine your region.', country ? 'success' : 'error');
                this.renderFuelPriceReminder();
            } catch (e) {
                this.showToast('Could not reach the location lookup service.', 'error');
            }
        }, () => {
            this.showToast('Location permission denied.', 'error');
        }, { timeout: 8000 });
    },

    renderFuelPriceReminder() {
        const el = document.getElementById('fuel-price-reminder');
        if (!el) return;

        let region = null;
        try { region = JSON.parse(localStorage.getItem('sumoFuelPriceRegion')); } catch (e) {}

        const dateStr = document.getElementById('fuel-price-date')?.value;
        const setDate = dateStr ? new Date(dateStr) : null;
        const daysOld = setDate && !isNaN(setDate) ? Math.floor((Date.now() - setDate.getTime()) / 86400000) : null;

        if (daysOld === null) { el.innerHTML = ''; return; }

        const where = region && region.country ? ` for ${region.country}` : '';
        if (daysOld > 14) {
            el.innerHTML = `<p style="margin:0.5rem 0 0; font-size:0.8rem; color:#b45309;">Fuel prices${where} were last set ${daysOld} days ago — consider checking current prices and updating the fields above.</p>`;
        } else if (daysOld >= 0) {
            el.innerHTML = `<p style="margin:0.5rem 0 0; font-size:0.78rem; color:var(--text-secondary,#888);">Fuel prices${where} set ${daysOld} day${daysOld === 1 ? '' : 's'} ago.</p>`;
        } else {
            el.innerHTML = '';
        }
    },

    async handleEmissionsParse() {
        const SLOTS = ['a', 'b', 'c', 'd', 'e'];
        const dieselPrice = parseFloat(document.getElementById('fuel-price-diesel')?.value) || 382;
        const petrolPrice = parseFloat(document.getElementById('fuel-price-petrol')?.value) || 414;

        const readFile = (file) => new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = e => resolve(e.target.result);
            reader.onerror = () => reject(new Error('File read error'));
            reader.readAsText(file);
        });

        const binDurSec = this._getIntervalFreqSec();
        const binCount = this._emissionsBinCount();
        const loaded = [];
        const rawEntries = [];
        for (const slot of SLOTS) {
            const inp = document.getElementById('file-emissions-scenario-' + slot);
            if (inp && inp.files[0]) {
                try {
                    const xml = await readFile(inp.files[0]);
                    const data = await this._parseEmissionsAsync(xml, binDurSec, binCount);
                    const nameEl = document.getElementById('scenario-' + slot + '-name');
                    data._label = nameEl ? nameEl.value : ('Scenario ' + slot.toUpperCase());
                    loaded.push(data);
                    rawEntries.push({ xml, label: data._label });
                } catch(e) {
                    this.showToast('Error reading Scenario ' + slot.toUpperCase() + ': ' + e.message, 'error');
                }
            }
        }
        this._lastEmissionsRawXml = rawEntries;
        this._persistEmissionsRawXml();

        if (loaded.length === 0) {
            this.showToast('Upload at least one tripinfo_data.xml file.', 'error');
            return;
        }

        this.showToast('Parsing ' + loaded.length + ' scenario(s)...', 'info');

        // renderEmissionsDashboard takes every scenario that actually has a file
        // browsed — it never invents a second scenario out of the first one.
        const resultsEl = document.getElementById('emissions-results');
        if (resultsEl) resultsEl.style.display = 'block';

        requestAnimationFrame(() => {
            try {
                this.renderEmissionsDashboard(loaded, dieselPrice, petrolPrice);
                this.showToast('Emissions comparison ready (' + loaded.length + ' scenario' + (loaded.length > 1 ? 's' : '') + ').', 'success');
            } catch(err) {
                console.error(err);
                this.showToast('Render error: ' + err.message, 'error');
            }
        });
    },

    async handleDwellParse() {
        try {

            const file0  = document.getElementById('dwell-file-0');
            const file10 = document.getElementById('dwell-file-10');
            const file20 = document.getElementById('dwell-file-20');
            const file45 = document.getElementById('dwell-file-45');
            const file90 = document.getElementById('dwell-file-90');

            const hasAny = (file0 && file0.files[0]) ||
                           (file10 && file10.files[0]) ||
                           (file20 && file20.files[0]) ||
                           (file45 && file45.files[0]) ||
                           (file90 && file90.files[0]);
            if (!hasAny) return;


            const readFile = f => new Promise((res, rej) => {
                const r = new FileReader();
                r.onload  = e => res(e.target.result);
                r.onerror = () => rej(new Error('read fail'));
                r.readAsText(f);
            });

            const data = { 0: null, 10: null, 20: null, 45: null, 90: null };

            const inputs = [[file0,0],[file10,10],[file20,20],[file45,45],[file90,90]];
            for (const [inp, key] of inputs) {
                if (inp && inp.files && inp.files[0]) {
                    const xml = await readFile(inp.files[0]);
                    data[key] = await this._parseEmissionsAsync(xml);
                }
            }


            const resultsDiv = document.getElementById('dwell-results');
            if (resultsDiv) resultsDiv.style.display = 'block';


            this.renderDwellCharts(data);


        } catch (err) {
            alert('ERROR CAUGHT: ' + err.message + '\n\nStack: ' + (err.stack || 'none'));
            console.error('[DwellParse]', err);
        }
    },

    // Delegates to polyReg.js's calculatePolyReg(), extracted verbatim so
    // it's unit-testable under Node (tests/polyReg.test.js).
    calculatePolyReg(xData, yData) {
        return calculatePolyReg(xData, yData);
    },

    // Delegates to polyReg.js's compareModels() — fits linear AND quadratic
    // and reports which AIC prefers, rather than only ever fitting the
    // quadratic the coding agent chose unreviewed (see CLAUDE.md's History
    // section and Section 6.2 of the JSALT manuscript).
    compareRegressionModels(xData, yData) {
        return compareModels(xData, yData);
    },

    renderDwellCharts(data) {
        const keys   = [0, 10, 20, 45, 90];
        const labels = [
            (document.getElementById('dwell-name-0')  || {}).value || 'Scenario 1: 0s',
            (document.getElementById('dwell-name-10') || {}).value || 'Scenario 2: 10s',
            (document.getElementById('dwell-name-20') || {}).value || 'Scenario 3: 20s',
            (document.getElementById('dwell-name-45') || {}).value || 'Scenario 4: 45s',
            (document.getElementById('dwell-name-90') || {}).value || 'Scenario 5: 90s',
        ];
        const petrolPrice = parseFloat((document.getElementById('fuel-price-petrol') || {}).value) || 414;

        // ---------- data series ----------
        const timeLossData  = keys.map(k => data[k] ? data[k].netTotals.timeLoss / 3600 : null);
        const co2Data       = keys.map(k => data[k] ? data[k].netTotals.CO2          : null);
        const noxData       = keys.map(k => data[k] ? data[k].netTotals.NOx          : null);
        const pmxData       = keys.map(k => data[k] ? data[k].netTotals.PMx          : null);
        const coData        = keys.map(k => data[k] ? data[k].netTotals.CO           : null);
        const hcData        = keys.map(k => data[k] ? data[k].netTotals.HC           : null);
        const fuelData      = keys.map(k => data[k] ? data[k].netTotals.fuel         : null);
        const stopsData     = keys.map(k => data[k] ? data[k].netTotals.waitingCount : null);

        const throughputData = [], speedData = [], financialData = [];
        keys.forEach(k => {
            if (data[k]) {
                let trips = 0;
                for (let i = 0; i < 10; i++) trips += data[k].netBins[i].tripCount;
                throughputData.push(trips);
                const avg = data[k].netTotals.duration > 0
                    ? (data[k].netTotals.routeLength / data[k].netTotals.duration) * 3.6 : 0;
                speedData.push(avg);
                financialData.push(data[k].otherFuel * petrolPrice);
            } else {
                throughputData.push(null);
                speedData.push(null);
                financialData.push(null);
            }
        });

        const mySpeedData = keys.map(k => data[k]
            ? (data[k].netTotals.routeLength / 1000) / (data[k].netTotals.duration / 3600) || 0
            : null);

        const baseK = 20;
        const relDelay = [], relNOx = [], relFuel = [];
        keys.forEach(k => {
            if (data[k] && data[baseK]) {
                const bd = data[baseK].netTotals.timeLoss, bn = data[baseK].netTotals.NOx, bf = data[baseK].netTotals.fuel;
                relDelay.push(bd > 0 ? ((data[k].netTotals.timeLoss - bd) / bd) * 100 : 0);
                relNOx.push (bn > 0 ? ((data[k].netTotals.NOx  - bn) / bn) * 100 : 0);
                relFuel.push(bf > 0 ? ((data[k].netTotals.fuel  - bf) / bf) * 100 : 0);
            } else { relDelay.push(null); relNOx.push(null); relFuel.push(null); }
        });

        // ---------- update formulas ----------
        // Shows BOTH the linear and quadratic fits, with adjusted R^2, AIC,
        // and n on each, and which AIC prefers — rather than only ever
        // showing the quadratic the coding agent chose on its own (see
        // CLAUDE.md's History section, polyReg.js's own header comment, and
        // Section 6.2 of the JSALT manuscript). The quadratic's own
        // low-confidence/negative-value warnings are unchanged from before.
        const oneModelLine = (label, reg, color) => {
            const stats = reg.lowConfidence
                ? ''
                : ` &nbsp;|&nbsp; adj. R² = ${reg.adjR2} &nbsp;|&nbsp; AIC = ${reg.aic} &nbsp;|&nbsp; n = ${reg.n}`;
            const warn = reg.warning ? `<br><span style="font-size:0.82em;">⚠ ${reg.warning}</span>` : '';
            return `<span style="color:${color};">${label}: ${reg.eq}${stats}</span>${warn}`;
        };
        const updateFormula = (canvasId, xData, yData) => {
            const el = document.getElementById('formula-' + canvasId);
            if (!el) return;
            const cmp = this.compareRegressionModels(xData, yData);
            const linColor = cmp.preferred.startsWith('Linear') ? '#059669' : 'inherit';
            const quadColor = cmp.preferred.startsWith('Quadratic') ? '#059669' : 'inherit';
            const quadWarnColor = cmp.quadratic.impliesNegative ? '#b91c1c' : (cmp.quadratic.lowConfidence ? '#b45309' : quadColor);
            let html = '<i>' + oneModelLine('Linear', cmp.linear, cmp.linear.lowConfidence ? '#b45309' : linColor) + '</i>';
            html += '<br><i>' + oneModelLine('Quadratic', cmp.quadratic, quadWarnColor) + '</i>';
            html += `<br><i style="font-size:0.8em;color:var(--text-secondary,#888);">Preferred by AIC: ${cmp.preferred}</i>`;
            el.innerHTML = html;
        };
        updateFormula('chart-dwell-tipping',  keys, timeLossData);
        updateFormula('chart-dwell-timeloss', keys, timeLossData);
        updateFormula('chart-dwell-co2',      keys, co2Data);
        updateFormula('chart-dwell-nox',      keys, noxData);
        updateFormula('chart-dwell-pmx',      keys, pmxData);
        updateFormula('chart-dwell-co',       keys, coData);
        updateFormula('chart-dwell-hc',       keys, hcData);
        updateFormula('chart-dwell-fuel',     keys, fuelData);
        updateFormula('chart-dwell-stops',    keys, stopsData);
        updateFormula('chart-dwell-speed',    keys, mySpeedData);

        // ---------- destroy old chart instances ----------
        ['chartDwellTimeloss','chartDwellCo2','chartDwellNox','chartDwellPmx',
         'chartDwellCo','chartDwellHc','chartDwellFuel','chartDwellStops',
         'chartDwellTipping','chartDwellSpeed','chartDwellFinancial',
         'chartDwellRelative','chartDwellTrees'].forEach(id => {
            if (window[id] && typeof window[id].destroy === 'function') window[id].destroy();
        });

        // ---------- chart factory ----------
        // Use FIXED pixel sizes (800x320).  responsive:false so Chart.js never
        // overrides the explicit canvas dimensions we set here.


        const makeCtx = (id, h) => {
            const el = document.getElementById(id);
            if (!el) { console.warn('[Dwell] canvas not found:', id); return null; }
            const hpx = (h || 320) + 'px';
            el.style.width = '100%';
            el.style.height = hpx;
            if (el.parentElement) {
                el.parentElement.style.height = hpx;
                el.parentElement.style.minHeight = hpx;
            }
            return el.getContext('2d');
        };

        const lineOpts = (yLabel) => ({
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: 'Bus Dwell Time (s)', font: { weight: 'bold' } } },
                y: { title: { display: true, text: yLabel,               font: { weight: 'bold' } }, beginAtZero: false }
            }
        });

        const barOpts = (yLabel) => ({
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { title: { display: true, text: 'Bus Dwell Time (s)', font: { weight: 'bold' } } },
                y: { title: { display: true, text: yLabel,               font: { weight: 'bold' } }, beginAtZero: true }
            }
        });

        const mkLine = (id, label, series, color, yLabel) => {
            const ctx = makeCtx(id);
            if (!ctx) return null;
            try {
                return new Chart(ctx, {
                    type: 'line',
                    data: { labels, datasets: [{ label, data: series,
                        borderColor: color, backgroundColor: color + '33',
                        pointBackgroundColor: color, pointBorderColor: '#fff',
                        pointHoverBackgroundColor: '#fff', pointHoverBorderColor: color,
                        pointRadius: 6, pointHoverRadius: 8, fill: true, tension: 0.3 }] },
                    options: lineOpts(yLabel)
                });
            } catch(e) { console.error('[Dwell] mkLine error on', id, e); return null; }
        };

        const mkBar = (id, label, series, color, yLabel) => {
            const ctx = makeCtx(id);
            if (!ctx) return null;
            try {
                return new Chart(ctx, {
                    type: 'bar',
                    data: { labels, datasets: [{ label, data: series, backgroundColor: color, borderRadius: 4 }] },
                    options: barOpts(yLabel)
                });
            } catch(e) { console.error('[Dwell] mkBar error on', id, e); return null; }
        };

        // ---------- create all charts ----------
        window.chartDwellTimeloss  = mkLine('chart-dwell-timeloss',  'Network Time Loss (Hours)',         timeLossData,  '#ef4444', 'Time Loss (Hours)');
        window.chartDwellCo2       = mkLine('chart-dwell-co2',       'Total CO₂ Emissions (kg)',    co2Data,       '#8b5cf6', 'CO₂ (kg)');
        window.chartDwellNox       = mkLine('chart-dwell-nox',       'Total NOx Emissions (g)',           noxData,       '#ef4444', 'NOx (g)');
        window.chartDwellPmx       = mkLine('chart-dwell-pmx',       'Total PMx Emissions (g)',           pmxData,       '#6b7280', 'PMx (g)');
        window.chartDwellCo        = mkLine('chart-dwell-co',        'Total CO Emissions (g)',            coData,        '#10b981', 'CO (g)');
        window.chartDwellHc        = mkLine('chart-dwell-hc',        'Total HC Emissions (g)',            hcData,        '#f59e0b', 'HC (g)');
        window.chartDwellFuel      = mkLine('chart-dwell-fuel',      'Total Fuel Consumption (L)',        fuelData,      '#3b82f6', 'Fuel (L)');
        window.chartDwellStops     = mkLine('chart-dwell-stops',     'Total Stop-and-Go Occurrences',     stopsData,     '#f59e0b', 'Occurrences');
        window.chartDwellFinancial = mkLine('chart-dwell-financial', 'Financial Drain (LKR)',             financialData, '#ef4444', 'LKR');

        // Speed bar chart
        try {
            const ctxSpd = makeCtx('chart-dwell-speed');
            if (ctxSpd) if (ctxSpd) window.chartDwellSpeed = new Chart(ctxSpd, {
                type: 'bar',
                data: { labels, datasets: [{ label: 'Average Speed (km/h)', data: speedData, backgroundColor: '#3b82f6', borderRadius: 4 }] },
                options: { responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'bottom' } },
                    scales: {
                        x: { title: { display: true, text: 'Bus Dwell Time (s)', font: { weight: 'bold' } } },
                        y: { title: { display: true, text: 'Speed (km/h)',        font: { weight: 'bold' } }, beginAtZero: true }
                    }}
            });
        } catch(e) { console.error('[Dwell] speed chart error', e); }

        // Tipping Point dual-axis chart (height 380)
        try {
            const ctxTip = makeCtx('chart-dwell-tipping', 380);
            if (ctxTip) if (ctxTip) window.chartDwellTipping = new Chart(ctxTip, {
                type: 'line',
                data: { labels, datasets: [
                    { label: 'Total Input Fleet', data: throughputData, type: 'bar',  backgroundColor: '#3b82f688', yAxisID: 'y' },
                    { label: 'Total Delay (Hours)', data: timeLossData, type: 'line', borderColor: '#ef4444', backgroundColor: '#ef4444', yAxisID: 'y1', tension: 0.3 }
                ]},
                options: { responsive: true, maintainAspectRatio: false,
                    scales: {
                        x:  { title: { display: true, text: 'Bus Dwell Time (s)', font: { weight: 'bold' } } },
                        y:  { type: 'linear', display: true, position: 'left',  title: { display: true, text: 'Vehicles Loaded' } },
                        y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Delay (Hours)' }, grid: { drawOnChartArea: false } }
                    }}
            });
        } catch(e) { console.error('[Dwell] tipping chart error', e); }

        // Relative Domino Effect
        try {
            const ctxRel = makeCtx('chart-dwell-relative');
            if (ctxRel) if (ctxRel) window.chartDwellRelative = new Chart(ctxRel, {
                type: 'line',
                data: { labels, datasets: [
                    { label: 'NOx Increase %',      data: relNOx,   borderColor: '#f59e0b', tension: 0.4 },
                    { label: 'Delay Increase %',    data: relDelay, borderColor: '#ef4444', tension: 0.4 },
                    { label: 'Fuel Cost Increase %',data: relFuel,  borderColor: '#8b5cf6', tension: 0.4 }
                ]},
                options: { responsive: true, maintainAspectRatio: false,
                    scales: {
                        x: { title: { display: true, text: 'Bus Dwell Time (s)', font: { weight: 'bold' } } },
                        y: { title: { display: true, text: '% Increase from 20s Baseline' } }
                    }}
            });
        } catch(e) { console.error('[Dwell] relative chart error', e); }

        // ---------- Evaluation Matrix table ----------
        let tableHtml = '';
        keys.forEach((k, idx) => {
            if (data[k]) {
                const trips    = throughputData[idx] || 0;
                const delayVal = trips > 0 ? (data[k].netTotals.timeLoss / trips) : 0;
                const fmt = v => v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                tableHtml += '<tr>' +
                    '<td><strong>' + labels[idx] + '</strong></td>' +
                    '<td style="text-align:right">' + trips.toLocaleString() + '</td>' +
                    '<td style="text-align:right">' + delayVal.toFixed(2) + '</td>' +
                    '<td style="text-align:right">' + fmt(data[k].netTotals.CO2)  + '</td>' +
                    '<td style="text-align:right">' + fmt(data[k].netTotals.NOx)  + '</td>' +
                    '<td style="text-align:right">' + fmt(data[k].netTotals.PMx)  + '</td>' +
                    '<td style="text-align:right">' + fmt(data[k].netTotals.fuel) + '</td>' +
                    '</tr>';
            } else {
                tableHtml += '<tr><td style="color:#9ca3af"><strong>' + labels[idx] + '</strong></td>' +
                    '<td colspan="6" style="text-align:center;color:#9ca3af;font-style:italic">No Data Uploaded</td></tr>';
            }
        });
        const tbody = document.getElementById('dwell-matrix-tbody');
        if (tbody) tbody.innerHTML = tableHtml;
    },

    // Bin width is the SAME "Interval Duration" already used for Flows/MAPE
    // (_getIntervalFreqSec, e.g. 10 minutes by default) — not a fixed split
    // of the total duration — so bins stay a fixed, familiar width and the
    // number of bins grows/shrinks with Duration instead.
    _emissionsBinCount() {
        const durMin = parseFloat(document.getElementById('sim-duration')?.value) || 100;
        return Math.max(1, Math.ceil((durMin * 60) / this._getIntervalFreqSec()));
    },

    // Clock-time range label for each bin, anchored to Sim Start Time —
    // replaces the old fixed "6:30 - 6:40" style labels so charts reflect
    // whatever Sim Start/Duration/Interval Duration are currently set to.
    _emissionsBinLabels(binDurSec, binCount) {
        const simStart = document.getElementById('sim-start-time')?.value || '06:30';
        const [sh, sm] = simStart.split(':').map(Number);
        const startTotalMin = (sh || 0) * 60 + (sm || 0);
        const durMin = (binDurSec > 0 ? binDurSec : 600) / 60;
        const fmt = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
        const labels = [];
        for (let i = 0; i < (binCount > 0 ? binCount : 10); i++) {
            labels.push(`${fmt(startTotalMin + i * durMin)} - ${fmt(startTotalMin + (i + 1) * durMin)}`);
        }
        return labels;
    },

    // Re-parses every currently-loaded emissions scenario's raw XML with the
    // current Sim Start/Duration/Interval Duration (bin count depends on
    // Duration, so a plain relabel isn't enough) and re-renders.
    async _rerenderEmissionsForTimeChange() {
        if (!this._lastEmissionsRawXml || !this._lastEmissionsRawXml.length) return;
        const binDurSec = this._getIntervalFreqSec();
        const binCount = this._emissionsBinCount();
        const dieselPrice = parseFloat(document.getElementById('fuel-price-diesel')?.value) || 382;
        const petrolPrice = parseFloat(document.getElementById('fuel-price-petrol')?.value) || 414;
        const scenarios = await Promise.all(this._lastEmissionsRawXml.map(async entry => {
            const data = await this._parseEmissionsAsync(entry.xml, binDurSec, binCount);
            data._label = entry.label;
            return data;
        }));
        this.renderEmissionsDashboard(scenarios, dieselPrice, petrolPrice);
    },

    // Emissions Analysis's uploaded tripinfo XML previously lived only in
    // _lastEmissionsRawXml (in-memory, not localStorage — real tripinfo files
    // can be far larger than localStorage's ~5-10MB quota). That meant a
    // browser refresh silently lost it. Writing it into the project folder
    // itself (same writeProjectFile channel "💾 Save Changes" already uses)
    // avoids the quota problem entirely, since it's plain disk I/O.
    _persistEmissionsRawXml() {
        if (!window.electronAPI || typeof window.electronAPI.writeProjectFile !== 'function') return;
        if (!this.project.folderPath) return;
        try {
            window.electronAPI.writeProjectFile({
                filename: 'dashboard_emissions_cache.json',
                content: JSON.stringify(this._lastEmissionsRawXml || [])
            }).catch(e => console.warn('Could not persist emissions cache:', e));
        } catch (e) {
            console.warn('Could not persist emissions cache:', e);
        }
    },

    // Restores the cache written by _persistEmissionsRawXml() above, called
    // once a project folder finishes loading. Silently does nothing if this
    // project has never had emissions data uploaded (no cache file yet).
    async _restoreEmissionsCache() {
        if (!window.electronAPI || typeof window.electronAPI.readProjectFile !== 'function') return;
        try {
            const text = await window.electronAPI.readProjectFile({ filename: 'dashboard_emissions_cache.json' });
            if (!text) return;
            const entries = JSON.parse(text);
            if (!Array.isArray(entries) || !entries.length) return;
            this._lastEmissionsRawXml = entries;
            const resultsEl = document.getElementById('emissions-results');
            if (resultsEl) resultsEl.style.display = 'block';
            await this._rerenderEmissionsForTimeChange();
            this.showToast('Restored previously uploaded Emissions Analysis data for this project.', 'info');
        } catch (e) {
            console.warn('Could not restore emissions cache:', e);
        }
    },

        // Synchronous fallback (also still used by anything that hasn't been
        // moved to the Worker-based path). The actual parsing logic lives in
        // emissionsParser.js's parseEmissionsXML() so the exact same code can
        // run inside emissionsWorker.js off the main thread.
        parseEmissionsRegex(xmlText, binDurSec, binCount) {
            const result = parseEmissionsXML(xmlText, binDurSec, binCount);
            this._toastEmissionsParseWarnings(result);
            return result;
        },

        // Surfaces parseEmissionsXML's post-parse validation warnings (zero
        // matched records, a record missing depart/timeLoss, a malformed/
        // auto-repaired XML structure, or trips with no <emissions> data) as
        // visible toasts instead of letting any of them pass silently as
        // empty/zero results.
        _toastEmissionsParseWarnings(result) {
            (result.warnings || []).forEach(msg => this.showToast('Warning: ' + msg, 'error'));
        },

        // Runs the parse inside emissionsWorker.js so a large tripinfo file
        // doesn't freeze the UI while it's being processed. Falls back to the
        // synchronous parse in place — silently, not as a user-facing error —
        // if Workers can't be constructed or fail to load for any reason, so a
        // Worker-loading quirk on some setup degrades performance, not function.
        _parseEmissionsAsync(xmlText, binDurSec, binCount) {
            return new Promise((resolve, reject) => {
                const fallback = () => {
                    try { resolve(this.parseEmissionsRegex(xmlText, binDurSec, binCount)); }
                    catch (e2) { reject(e2); }
                };
                let worker;
                try {
                    worker = new Worker('emissionsWorker.js');
                } catch (e) {
                    fallback();
                    return;
                }
                worker.onmessage = (e) => {
                    worker.terminate();
                    if (e.data.error) { fallback(); return; }
                    this._toastEmissionsParseWarnings(e.data.result);
                    resolve(e.data.result);
                };
                worker.onerror = () => {
                    worker.terminate();
                    fallback();
                };
                worker.postMessage({ xmlText, binDurSec, binCount });
            });
        },

        // Same worker/fallback pattern as _parseEmissionsAsync, but for the
        // idle/moving split (parseEmissionSplitXML) -- a different input file
        // (SUMO --emission-output, not --tripinfo-output) and a different
        // result shape, so kept as its own method rather than overloading
        // the tripinfo one.
        _parseEmissionSplitAsync(xmlText, idleThresholdMps) {
            return new Promise((resolve, reject) => {
                const fallback = () => {
                    try { resolve(parseEmissionSplitXML(xmlText, idleThresholdMps)); }
                    catch (e2) { reject(e2); }
                };
                let worker;
                try {
                    worker = new Worker('emissionsWorker.js');
                } catch (e) {
                    fallback();
                    return;
                }
                worker.onmessage = (e) => {
                    worker.terminate();
                    if (e.data.error) { fallback(); return; }
                    (e.data.result.warnings || []).forEach(msg => this.showToast('Warning: ' + msg, 'error'));
                    resolve(e.data.result);
                };
                worker.onerror = () => {
                    worker.terminate();
                    fallback();
                };
                worker.postMessage({ xmlText, mode: 'split', idleThresholdMps });
            });
        },

        async handleEmissionSplitParse() {
            const inp = document.getElementById('file-emission-split');
            const resultsEl = document.getElementById('emission-split-results');
            if (!inp || !inp.files[0]) {
                this.showToast('Choose a SUMO --emission-output file first.', 'error');
                return;
            }
            const threshold = parseFloat(document.getElementById('emission-split-threshold')?.value);
            const idleThresholdMps = isFinite(threshold) && threshold >= 0 ? threshold : 0.1;

            const xml = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = e => resolve(e.target.result);
                reader.onerror = () => reject(new Error('File read error'));
                reader.readAsText(inp.files[0]);
            });

            let result;
            try {
                result = await this._parseEmissionSplitAsync(xml, idleThresholdMps);
            } catch (e) {
                this.showToast('Could not parse this file: ' + (e.message || e), 'error');
                return;
            }
            this.renderEmissionSplit(result, resultsEl);
        },

        renderEmissionSplit(result, resultsEl) {
            if (!resultsEl) return;
            if (!result.vehicleStepCount) {
                resultsEl.innerHTML = '<p style="color:#b91c1c;">No usable vehicle/timestep records found in this file.</p>';
                return;
            }
            const pct = (part, whole) => whole > 0 ? ((100 * part) / whole).toFixed(1) + '%' : '—';
            const rows = [
                ['CO',   result.idle.CO,        result.moving.CO,        'g'],
                ['HC',   result.idle.HC,        result.moving.HC,        'g'],
                ['PMx',  result.idle.PMx,       result.moving.PMx,       'g'],
                ['NOx',  result.idle.NOx,       result.moving.NOx,       'g'],
                ['CO2',  result.idle.CO2,       result.moving.CO2,       'kg'],
                ['Fuel', result.idle.fuelLiters, result.moving.fuelLiters, 'L'],
            ];
            let html = `<p style="font-size:0.85rem; color:var(--text-secondary,#888);">Threshold: ${result.idleThresholdMps} m/s &nbsp;|&nbsp; Step length (inferred): ${result.stepLengthSec} s &nbsp;|&nbsp; ${result.vehicleStepCount} vehicle-steps (${result.idleVehicleSteps} idle, ${result.movingVehicleSteps} moving)</p>`;
            html += '<table class="data-table"><thead><tr><th>Pollutant</th><th>Idle</th><th>Moving</th><th>Idle share</th></tr></thead><tbody>';
            rows.forEach(([label, idleVal, movingVal, unit]) => {
                html += `<tr><td>${label}</td><td>${idleVal.toFixed(3)} ${unit}</td><td>${movingVal.toFixed(3)} ${unit}</td><td>${pct(idleVal, idleVal + movingVal)}</td></tr>`;
            });
            html += '</tbody></table>';
            resultsEl.innerHTML = html;
        },

    renderEmissionsDashboard(scenarios, dieselPrice, petrolPrice) {
        if (!scenarios || !scenarios.length) return;

        const PALETTE = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];
        const names = scenarios.map((d, i) => d._label || ('Scenario ' + (i + 1)));
        const baseline = scenarios[0];
        const compare = scenarios[scenarios.length - 1]; // most recently added scenario — used for single-value diff callouts

        const safeSet = (id, prop, val) => {
            const el = document.getElementById(id);
            if (el) {
                el[prop] = val;
            } else {
                console.warn('[Emissions] Element missing:', id);
            }
        };

        const makeCtxSafe = (id) => {
            const el = document.getElementById(id);
            if (!el) { console.warn('Canvas not found:', id); return null; }
            el.style.width = '100%';
            el.style.height = '320px';
            if (el.parentElement) {
                el.parentElement.style.height = '320px';
                el.parentElement.style.minHeight = '320px';
            }
            return el.getContext('2d');
        };

        // --- Dynamic table header: Category + one column per browsed scenario + Difference ---
        const headerRow = document.getElementById('cost-table-header-row');
        if (headerRow) {
            let headHtml = '<th style="text-align:left; padding:0.75rem;">Category</th>';
            names.forEach(n => { headHtml += `<th style="text-align:right; padding:0.75rem;">${n}</th>`; });
            if (scenarios.length > 1) headHtml += '<th style="text-align:right; padding:0.75rem; color:#b91c1c;">Difference (last vs baseline)</th>';
            headerRow.innerHTML = headHtml;
        }

        // --- Table Population ---
        const formatMoney = (val) => 'LKR ' + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fmtNum = (val) => val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const busFuelArr = scenarios.map(d => d.busFuel);
        const otherFuelArr = scenarios.map(d => d.otherFuel);
        const busCostArr = busFuelArr.map(v => v * dieselPrice);
        const otherCostArr = otherFuelArr.map(v => v * petrolPrice);
        const distArr = scenarios.map(d => d.netTotals.routeLength / 1000);
        const totalCols = 1 + names.length + (scenarios.length > 1 ? 1 : 0);

        let html = '';
        const makeRow = (cat, vals, isMoney) => {
            const fmt = isMoney ? formatMoney : fmtNum;
            let row = `<tr><td style="text-align:left; padding:0.75rem;"><strong>${cat}</strong></td>`;
            vals.forEach(v => { row += `<td style="text-align:right; padding:0.75rem;">${fmt(v)}</td>`; });
            if (vals.length > 1) {
                const diff = vals[vals.length - 1] - vals[0];
                const diffStr = (diff > 0 ? '+' : '') + fmt(diff);
                const color = diff > 0 ? '#b91c1c' : '#15803d';
                row += `<td style="text-align:right; padding:0.75rem; font-weight:bold; color:${color};">${diffStr}</td>`;
            }
            row += '</tr>';
            return row;
        };

        html += makeRow('Bus Fuel (Diesel) - Liters', busFuelArr, false);
        html += makeRow('Bus Fuel Cost', busCostArr, true);
        html += makeRow('Public Traffic Fuel (Petrol) - Liters', otherFuelArr, false);
        html += makeRow('Public Traffic Fuel Cost', otherCostArr, true);
        html += makeRow('Total Economic Cost', busCostArr.map((v, i) => v + otherCostArr[i]), true);
        html += `<tr><td colspan="${totalCols}" style="background:#f3f4f6; padding:0.25rem;"></td></tr>`;
        html += makeRow('Total Time Lost in Traffic (Hours)', scenarios.map(d => d.netTotals.timeLoss / 3600), false);
        html += makeRow('Total Stop-and-Go Occurrences', scenarios.map(d => d.netTotals.waitingCount), false);
        html += `<tr><td colspan="${totalCols}" style="background:#f3f4f6; padding:0.25rem;"></td></tr>`;
        html += makeRow('Average Cost per Kilometer', scenarios.map((d, i) => distArr[i] > 0 ? (busCostArr[i] + otherCostArr[i]) / distArr[i] : 0), true);

        safeSet('cost-analysis-tbody', 'innerHTML', html);

        // --- CO2 Equivalency Callout (baseline vs the most recently added scenario) ---
        const co2KgBaseline = baseline.netTotals.CO2;
        const co2KgCompare = compare.netTotals.CO2;
        const diffCo2Kg = Math.max(0, co2KgCompare - co2KgBaseline);
        const equivalentTrees = Math.round(diffCo2Kg / 22); // A tree absorbs ~22kg CO2/year

        safeSet('co2-penalty-kg', 'innerText', diffCo2Kg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        safeSet('co2-trees', 'innerText', equivalentTrees.toLocaleString());

        const labels = this._emissionsBinLabels(this._getIntervalFreqSec(), this._emissionsBinCount());

        const destroyChart = (id) => {
            if (window[id] && typeof window[id].destroy === 'function') {
                window[id].destroy();
            }
        };
        ['chart1', 'chart2', 'chartDelay', 'chartStops', 'chart3', 'chart4', 'chartCO', 'chartHC', 'chartCO2', 'chartPie', 'chartFuelBarPetrol', 'chartFuelBarDiesel', 'chartTimePenalty']
            .forEach(destroyChart);

        // Chart 1: Total Emissions Bar Chart
        const ctx1 = makeCtxSafe('chart-total-emissions');
        if (ctx1) window.chart1 = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: ['CO', 'HC', 'PMx', 'NOx'],
                datasets: scenarios.map((d, i) => ({ label: names[i], backgroundColor: PALETTE[i % PALETTE.length], data: [d.netTotals.CO, d.netTotals.HC, d.netTotals.PMx, d.netTotals.NOx] }))
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Grams (g)' } } } }
        });

        // Chart 2: Network Fuel over time
        const ctx2 = makeCtxSafe('chart-ripple-effect');
        if (ctx2) window.chart2 = new Chart(ctx2, {
            type: 'line',
            data: {
                labels: labels,
                datasets: scenarios.map((d, i) => ({ label: names[i] + ' Total Network Fuel (L)', borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length] + '33', data: d.netBins.map(b => b.fuel), fill: i === 0, tension: 0.4 }))
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Liters (L)' } } } }
        });

        // Chart 3: Network Delay (timeLoss per vehicle)
        const ctxDelay = makeCtxSafe('chart-delay-time');
        if (ctxDelay) window.chartDelay = new Chart(ctxDelay, {
            type: 'line',
            data: {
                labels: labels,
                datasets: scenarios.map((d, i) => ({ label: names[i], borderColor: PALETTE[i % PALETTE.length], backgroundColor: PALETTE[i % PALETTE.length] + '33', data: d.netBins.map(b => b.timeLoss / Math.max(1, b.tripCount)), fill: i === 0, tension: 0.4 }))
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Avg Delay per Vehicle (Seconds)' } } } }
        });

        // Chart 4: Stop-and-Go (waitingCount)
        const ctxStops = makeCtxSafe('chart-stops-time');
        if (ctxStops) window.chartStops = new Chart(ctxStops, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: scenarios.map((d, i) => ({ label: names[i], backgroundColor: PALETTE[i % PALETTE.length], data: d.netBins.map(b => b.waitingCount) }))
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Total Stop Occurrences' } } } }
        });

        // Chart 5: PMx Line Chart
        const ctx3 = makeCtxSafe('chart-pmx-time');
        if (ctx3) window.chart3 = new Chart(ctx3, {
            type: 'line',
            data: { labels: labels, datasets: scenarios.map((d, i) => ({ label: names[i], borderColor: PALETTE[i % PALETTE.length], data: d.netBins.map(b => b.PMx), tension: 0.4 })) },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Grams (g)' } } } }
        });

        // Chart 6: NOx Line Chart
        const ctx4 = makeCtxSafe('chart-nox-time');
        if (ctx4) window.chart4 = new Chart(ctx4, {
            type: 'line',
            data: { labels: labels, datasets: scenarios.map((d, i) => ({ label: names[i], borderColor: PALETTE[i % PALETTE.length], data: d.netBins.map(b => b.NOx), tension: 0.4 })) },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Grams (g)' } } } }
        });

        // Chart 7: CO Line Chart
        const ctxCO = makeCtxSafe('chart-co-time');
        if (ctxCO) window.chartCO = new Chart(ctxCO, {
            type: 'line',
            data: { labels: labels, datasets: scenarios.map((d, i) => ({ label: names[i], borderColor: PALETTE[i % PALETTE.length], data: d.netBins.map(b => b.CO), tension: 0.4 })) },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Grams (g)' } } } }
        });

        // Chart 8: HC Line Chart
        const ctxHC = makeCtxSafe('chart-hc-time');
        if (ctxHC) window.chartHC = new Chart(ctxHC, {
            type: 'line',
            data: { labels: labels, datasets: scenarios.map((d, i) => ({ label: names[i], borderColor: PALETTE[i % PALETTE.length], data: d.netBins.map(b => b.HC), tension: 0.4 })) },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Grams (g)' } } } }
        });

        // Chart 9: CO2 Line Chart (Kg)
        const ctxCO2 = makeCtxSafe('chart-co2-time');
        if (ctxCO2) window.chartCO2 = new Chart(ctxCO2, {
            type: 'line',
            data: { labels: labels, datasets: scenarios.map((d, i) => ({ label: names[i], borderColor: PALETTE[i % PALETTE.length], data: d.netBins.map(b => b.CO2), tension: 0.4 })) },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { title: { display: true, text: 'Kilograms (Kg)' } } } }
        });

        // Chart 10: Fuel Penalty Breakdown by Vehicle Type (Petrol) — one series per non-baseline scenario, vs baseline
        const ctxPie = makeCtxSafe('chart-fuel-pie');
        const penaltyCats = ['motorcycle', 'tuk_tuk', 'passenger_car', 'other'];
        const penaltyCatLabels = ['Motorcycles', 'Tuk-Tuks', 'Passenger Cars', 'Other'];
        if (ctxPie) window.chartPie = new Chart(ctxPie, {
            type: 'bar',
            data: {
                labels: penaltyCatLabels,
                datasets: scenarios.slice(1).map((d, idx) => {
                    const i = idx + 1;
                    return {
                        label: names[i] + ' vs ' + names[0],
                        backgroundColor: PALETTE[i % PALETTE.length],
                        data: penaltyCats.map(cat => Math.max(0, d.otherFuelBreakdown[cat] - baseline.otherFuelBreakdown[cat]))
                    };
                })
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { title: { display: true, text: 'Extra Fuel vs Baseline (L)' } } },
                plugins: { legend: { display: scenarios.length > 2 } }
            }
        });

        // Chart 11 & 12: Average Penalty Cost Bar Charts (Petrol / Diesel) — one series per non-baseline scenario
        const getAvgPenalty = (fuelA, countA, fuelB, countB, price) => {
            const avgA = countA > 0 ? fuelA / countA : 0;
            const avgB = countB > 0 ? fuelB / countB : 0;
            return Math.max(0, (avgB - avgA) * price);
        };

        const ctxBarPetrol = makeCtxSafe('chart-fuel-bar-petrol');
        if (ctxBarPetrol) window.chartFuelBarPetrol = new Chart(ctxBarPetrol, {
            type: 'bar',
            data: {
                labels: ['Motorcycle', 'Tuk-Tuk', 'Passenger Car'],
                datasets: scenarios.slice(1).map((d, idx) => {
                    const i = idx + 1;
                    return {
                        label: names[i],
                        backgroundColor: PALETTE[i % PALETTE.length],
                        borderRadius: 4,
                        data: ['motorcycle', 'tuk_tuk', 'passenger_car'].map(cat =>
                            getAvgPenalty(baseline.otherFuelBreakdown[cat], baseline.otherTripCountBreakdown[cat], d.otherFuelBreakdown[cat], d.otherTripCountBreakdown[cat], petrolPrice))
                    };
                })
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, title: { display: true, text: 'Rupees (LKR)' } } },
                plugins: { legend: { display: scenarios.length > 2 } }
            }
        });

        const ctxBarDiesel = makeCtxSafe('chart-fuel-bar-diesel');
        if (ctxBarDiesel) window.chartFuelBarDiesel = new Chart(ctxBarDiesel, {
            type: 'bar',
            data: {
                labels: ['Van', 'Truck', 'Heavy Bus'],
                datasets: scenarios.slice(1).map((d, idx) => {
                    const i = idx + 1;
                    return {
                        label: names[i],
                        backgroundColor: PALETTE[i % PALETTE.length],
                        borderRadius: 4,
                        data: [
                            getAvgPenalty(baseline.otherFuelBreakdown.van, baseline.otherTripCountBreakdown.van, d.otherFuelBreakdown.van, d.otherTripCountBreakdown.van, dieselPrice),
                            getAvgPenalty(baseline.otherFuelBreakdown.truck, baseline.otherTripCountBreakdown.truck, d.otherFuelBreakdown.truck, d.otherTripCountBreakdown.truck, dieselPrice),
                            getAvgPenalty(baseline.busFuel, baseline.busTripCount, d.busFuel, d.busTripCount, dieselPrice)
                        ]
                    };
                })
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, title: { display: true, text: 'Rupees (LKR)' } } },
                plugins: { legend: { display: scenarios.length > 2 } }
            }
        });

        // Chart 13: Average Time Penalty (seconds/trip) per Vehicle Type — absolute value per scenario
        const getAvgTime = (loss, count) => count > 0 ? (loss / count) : 0;
        const timePenaltyLabels = ['Motorcycle', 'Tuk-Tuk', 'Passenger Car', 'Van', 'Truck', 'Heavy Bus'];
        const ctxTimePenalty = makeCtxSafe('chart-time-penalty');
        if (ctxTimePenalty) window.chartTimePenalty = new Chart(ctxTimePenalty, {
            type: 'bar',
            data: {
                labels: timePenaltyLabels,
                datasets: scenarios.map((d, i) => ({
                    label: names[i],
                    backgroundColor: PALETTE[i % PALETTE.length],
                    borderRadius: 2,
                    data: [
                        getAvgTime(d.otherTimeLossBreakdown.motorcycle, d.otherTripCountBreakdown.motorcycle),
                        getAvgTime(d.otherTimeLossBreakdown.tuk_tuk, d.otherTripCountBreakdown.tuk_tuk),
                        getAvgTime(d.otherTimeLossBreakdown.passenger_car, d.otherTripCountBreakdown.passenger_car),
                        getAvgTime(d.otherTimeLossBreakdown.van, d.otherTripCountBreakdown.van),
                        getAvgTime(d.otherTimeLossBreakdown.truck, d.otherTripCountBreakdown.truck),
                        getAvgTime(d.busTimeLoss, d.busTripCount)
                    ]
                }))
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, title: { display: true, text: 'Time Lost (Seconds)' } } }
            }
        });

        // Heatmap — emission intensity of the most recently added scenario
        const pollutants = ['CO', 'HC', 'PMx', 'NOx', 'CO2'];
        const pollMax = { CO: 0, HC: 0, PMx: 0, NOx: 0, CO2: 0 };
        compare.netBins.forEach(bin => {
            pollutants.forEach(p => { if (bin[p] > pollMax[p]) pollMax[p] = bin[p]; });
        });

        let heatHtml = `<p style="font-size:0.8rem; color:var(--text-secondary,#888); margin:0 0 0.5rem;">Showing intensity for: <strong>${names[names.length - 1]}</strong></p>`;
        heatHtml += `<table style="width:100%; border-collapse: separate; border-spacing: 2px;">
            <tr><th style="text-align:right; padding-right:1rem; width:15%; color:var(--text-muted);">Interval</th>`;
        labels.forEach((clock, i) => {
            heatHtml += `<th style="font-size:0.75rem; writing-mode:vertical-rl; transform:rotate(180deg); padding:0.25rem;">Int ${i+1}<br/>${clock}</th>`;
        });
        heatHtml += `</tr>`;

        pollutants.forEach(poll => {
            heatHtml += `<tr><td style="text-align:right; padding-right:1rem; font-weight:600;">${poll}</td>`;
            compare.netBins.forEach(bin => {
                const val = bin[poll];
                const max = pollMax[poll] || 1;
                const ratio = val / max;
                let r, g, b = 50;
                if (ratio < 0.5) {
                    const t = ratio * 2;
                    r = Math.round(59 + t * (245 - 59));
                    g = Math.round(130 + t * (158 - 130));
                    b = Math.round(246 + t * (11 - 246));
                } else {
                    const t = (ratio - 0.5) * 2;
                    r = Math.round(245 + t * (239 - 245));
                    g = Math.round(158 + t * (68 - 158));
                    b = Math.round(11 + t * (68 - 11));
                }
                const opacity = Math.max(0.2, ratio);
                heatHtml += `<td title="${val.toFixed(2)}" style="background: rgba(${r},${g},${b},${opacity}); border-radius:3px; height: 35px; min-width: 30px;"></td>`;
            });
            heatHtml += `</tr>`;
        });
        heatHtml += `</table>`;
        safeSet('heatmap-container', 'innerHTML', heatHtml);
    },

    };


window.onload = () => App.init();
