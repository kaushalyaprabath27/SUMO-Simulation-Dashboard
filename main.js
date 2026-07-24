const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let loadedFolderPath = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        icon: path.join(__dirname, 'Icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

const SUMO_EXTENSIONS = ['.rou.xml', '.add.xml', '.net.xml', '.sumocfg'];

ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths.length) return null;

    const folderPath = result.filePaths[0];
    loadedFolderPath = folderPath;

    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!SUMO_EXTENSIONS.some(ext => entry.name.endsWith(ext))) continue;
        const content = fs.readFileSync(path.join(folderPath, entry.name), 'utf8');
        files.push({ name: entry.name, content });
    }

    return { name: path.basename(folderPath), folderPath, files };
});

// Only ever write/read plain filenames inside the loaded project folder —
// reject anything that looks like it's trying to escape that folder.
function safeProjectPath(filename) {
    if (!loadedFolderPath) throw new Error('No project folder loaded yet — load a SUMO project folder first.');
    if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        throw new Error('Invalid filename: ' + filename);
    }
    return path.join(loadedFolderPath, filename);
}

ipcMain.handle('write-project-file', async (event, { filename, content }) => {
    fs.writeFileSync(safeProjectPath(filename), content, 'utf8');
    return true;
});

ipcMain.handle('read-project-file', async (event, { filename }) => {
    const filePath = safeProjectPath(filename);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
});

// Some SUMO projects reference detector/output files with absolute paths baked
// in from whatever PC they were originally authored on (e.g. C:/Users/OtherUser/...).
// Those paths won't exist here, and SUMO refuses to run at all if it can't create
// an output file. We never edit the user's original .add.xml for this — we create
// any missing directory where we can (fixing it in place, in the user's own intended
// location), and only for paths we truly can't write to (e.g. another user's profile)
// do we build a throwaway copy of that additional file with just the broken paths
// redirected into a local "sumo_output" folder, pointing SUMO at the copy via
// --additional-files (which fully overrides whatever the .sumocfg lists).
function prepareAdditionalFiles(cfg, cwd) {
    const cfgPath = path.isAbsolute(cfg) ? cfg : path.join(cwd, cfg);
    if (!fs.existsSync(cfgPath)) return { additionalFilesArg: null, notes: [] };

    const cfgText = fs.readFileSync(cfgPath, 'utf8');
    const match = cfgText.match(/<additional-files\s+value="([^"]*)"\s*\/>/);
    if (!match || !match[1]) return { additionalFilesArg: null, notes: [] };

    const listedFiles = match[1].split(',').map(s => s.trim()).filter(Boolean);
    const notes = [];
    const finalFiles = [];

    for (const relName of listedFiles) {
        const addPath = path.isAbsolute(relName) ? relName : path.join(cwd, relName);
        if (!fs.existsSync(addPath)) { finalFiles.push(relName); continue; }

        let text = fs.readFileSync(addPath, 'utf8');
        let changed = false;

        text = text.replace(/(\bfile=")([^"]+)(")/g, (whole, pre, filePath, post) => {
            const outPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
            const dir = path.dirname(outPath);
            if (fs.existsSync(dir)) return whole;
            try {
                fs.mkdirSync(dir, { recursive: true });
                return whole; // directory now exists — original path is fine, left untouched
            } catch (e) {
                const localDir = path.join(cwd, 'sumo_output');
                fs.mkdirSync(localDir, { recursive: true });
                const newPath = path.join(localDir, path.basename(filePath)).replace(/\\/g, '/');
                changed = true;
                notes.push(`${path.basename(filePath)} → sumo_output/ (original location unavailable: ${dir})`);
                return `${pre}${newPath}${post}`;
            }
        });

        if (changed) {
            const dotIdx = relName.toLowerCase().endsWith('.add.xml') ? relName.length - 8 : relName.lastIndexOf('.');
            const localName = dotIdx > 0 ? relName.slice(0, dotIdx) + '.local' + relName.slice(dotIdx) : relName + '.local';
            fs.writeFileSync(path.join(cwd, localName), text, 'utf8');
            finalFiles.push(localName);
        } else {
            finalFiles.push(relName);
        }
    }

    return { additionalFilesArg: finalFiles.join(','), notes };
}

// Neither MAPE travel-time data nor per-run emissions/tripinfo output exist
// unless something in the loaded project actually asks SUMO to produce them.
// Rather than requiring the user to hand-edit their .add.xml, we always write
// our own small additional-file requesting edge travel times (never touching
// the user's own files) and fold it into whichever --additional-files list
// prepareAdditionalFiles() already built for this run.
function ensureEdgeDataFile(cwd, freqSec) {
    const edgeDataAddName = 'dashboard_edgedata.add.xml';
    const edgeDataOutName = 'dashboard_traveltimes_output.xml';
    const freq = Number(freqSec) > 0 ? Number(freqSec) : 600;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<additional>\n    <edgeData id="dashboard_traveltimes" file="${edgeDataOutName}" freq="${freq}"/>\n</additional>\n`;
    fs.writeFileSync(path.join(cwd, edgeDataAddName), xml, 'utf8');
    return { addName: edgeDataAddName, outName: edgeDataOutName };
}

function prepareRunFiles(cfg, cwd, freqSec) {
    let notes = [];
    let additionalFilesArg = null;
    try {
        const prepared = prepareAdditionalFiles(cfg, cwd);
        notes = prepared.notes;
        additionalFilesArg = prepared.additionalFilesArg;
    } catch (e) {
        console.warn('Could not prepare additional-files:', e.message);
    }

    let travelTimesPath = null;
    try {
        const edgeData = ensureEdgeDataFile(cwd, freqSec);
        additionalFilesArg = additionalFilesArg ? `${additionalFilesArg},${edgeData.addName}` : edgeData.addName;
        travelTimesPath = path.join(cwd, edgeData.outName);
    } catch (e) {
        console.warn('Could not set up edgeData output:', e.message);
    }

    return { additionalFilesArg, notes, travelTimesPath };
}

ipcMain.handle('run-sumo', async (event, { cfg, step, folderPath, freqSec }) => {
    const cwd = folderPath || loadedFolderPath;
    if (!cwd || !fs.existsSync(cwd)) {
        throw new Error('No project folder loaded yet — load a SUMO project folder first.');
    }
    const tripinfoPath = path.join(cwd, '_dashboard_tripinfo.xml');
    const summaryPath = path.join(cwd, '_dashboard_summary.xml');

    // Requesting tripinfo/emissions/edgeData output here too (not just in the
    // headless run) means these files exist on disk afterward even when the
    // user runs via the interactive sumo-gui window.
    const args = ['-c', cfg, '--tripinfo-output', tripinfoPath, '--summary-output', summaryPath, '--device.emissions.probability', '1.0'];
    if (step) args.push('--step-length', String(step));

    const prepared = prepareRunFiles(cfg, cwd, freqSec);
    if (prepared.additionalFilesArg) args.push('--additional-files', prepared.additionalFilesArg);

    return new Promise((resolve, reject) => {
        const proc = spawn('sumo-gui', args, { cwd, detached: true, stdio: 'ignore' });
        proc.on('error', (err) => {
            reject(new Error(
                err.code === 'ENOENT'
                    ? 'sumo-gui was not found on your PATH. Install SUMO and make sure its "bin" folder is in your system PATH.'
                    : err.message
            ));
        });
        // Give spawn a moment to fail fast (e.g. ENOENT) before reporting success.
        setTimeout(() => resolve({ notes: prepared.notes }), 300);
        proc.unref();
    });
});

// Runs SUMO headless (no GUI window) so it runs to completion on its own,
// then hands back its tripinfo/summary output for the Simulation Results tab.
// Unlike run-sumo (sumo-gui, detached, fire-and-forget), this waits for the
// process to actually exit before resolving.
ipcMain.handle('run-sumo-headless', async (event, { cfg, step, folderPath, freqSec }) => {
    const cwd = folderPath || loadedFolderPath;
    if (!cwd || !fs.existsSync(cwd)) {
        throw new Error('No project folder loaded yet — load a SUMO project folder first.');
    }
    const tripinfoPath = path.join(cwd, '_dashboard_tripinfo.xml');
    const summaryPath = path.join(cwd, '_dashboard_summary.xml');

    // --device.emissions.probability 1.0 makes SUMO attach a per-vehicle
    // <emissions> total to each <tripinfo>, so the Emissions Analysis tab can be
    // auto-filled from this same run without the user exporting/pasting anything.
    const args = ['-c', cfg, '--tripinfo-output', tripinfoPath, '--summary-output', summaryPath, '--no-step-log', 'true', '--device.emissions.probability', '1.0'];
    if (step) args.push('--step-length', String(step));

    const prepared = prepareRunFiles(cfg, cwd, freqSec);
    if (prepared.additionalFilesArg) args.push('--additional-files', prepared.additionalFilesArg);

    return new Promise((resolve, reject) => {
        const proc = spawn('sumo', args, { cwd });
        let stderr = '';
        proc.stdout.resume();
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('error', (err) => {
            reject(new Error(
                err.code === 'ENOENT'
                    ? 'sumo (headless) was not found on your PATH. Install SUMO and make sure its "bin" folder is in your system PATH.'
                    : err.message
            ));
        });
        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`SUMO exited with code ${code}.\n${stderr.slice(-2000)}`));
                return;
            }
            try {
                resolve({
                    tripinfo: fs.existsSync(tripinfoPath) ? fs.readFileSync(tripinfoPath, 'utf8') : null,
                    summary: fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : null,
                    travelTimes: prepared.travelTimesPath && fs.existsSync(prepared.travelTimesPath) ? fs.readFileSync(prepared.travelTimesPath, 'utf8') : null,
                    notes: prepared.notes
                });
            } catch (e) {
                reject(e);
            }
        });
    });
});
