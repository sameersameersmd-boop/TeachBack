const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let backendProcess = null;


/* =========================================================
   PATHS
========================================================= */

function getBackendPath() {
    if (app.isPackaged) {
        return path.join(
            process.resourcesPath,
            'app.asar.unpacked',
            'backend',
            'server.js'
        );
    }

    return path.join(
        __dirname,
        '..',
        'backend',
        'server.js'
    );
}


function getBackendDirectory() {
    return path.dirname(getBackendPath());
}


function getFrontendPath() {
    if (app.isPackaged) {
        return path.join(
            process.resourcesPath,
            'app.asar',
            'frontend',
            'dist',
            'index.html'
        );
    }

    return path.join(
        __dirname,
        '..',
        'frontend',
        'dist',
        'index.html'
    );
}


/* =========================================================
   START BACKEND
========================================================= */

function startBackend() {
    const backendPath = getBackendPath();
    const backendDirectory = getBackendDirectory();

    console.log('============================================');
    console.log('Starting TeachBack backend...');
    console.log('Backend:', backendPath);
    console.log('Backend directory:', backendDirectory);
    console.log('Packaged:', app.isPackaged);
    console.log('============================================');

    /*
     * Electron contains Node internally.
     *
     * ELECTRON_RUN_AS_NODE=1 makes the Electron executable
     * behave like Node when launching server.js.
     */
    const backendEnvironment = {
        ...process.env,

        /*
         * Tell the backend where it is allowed to store
         * uploaded PDFs, generated videos and temporary files.
         */
        TEACHBACK_DATA_DIR: app.getPath('userData'),

        /*
         * Make the Electron executable behave like Node
         * when launching server.js.
         */
        ELECTRON_RUN_AS_NODE: '1'
    };

    backendProcess = spawn(
        process.execPath,
        [backendPath],
        {
            cwd: backendDirectory,
            env: backendEnvironment,
            windowsHide: false,
            stdio: 'inherit'
        }
    );

    backendProcess.on('error', (error) => {
        console.error(
            'Failed to start TeachBack backend:',
            error
        );
    });

    backendProcess.on('exit', (code, signal) => {
        console.log(
            `TeachBack backend stopped. Code: ${code}, Signal: ${signal}`
        );

        backendProcess = null;
    });
}


/* =========================================================
   CREATE WINDOW
========================================================= */

function createWindow() {
    const frontendPath = getFrontendPath();

    console.log('============================================');
    console.log('Opening TeachBack interface...');
    console.log('Frontend:', frontendPath);
    console.log('============================================');

    const win = new BrowserWindow({
        width: 1200,
        height: 800,

        minWidth: 900,
        minHeight: 650,

        title: 'TeachBack',

        backgroundColor: '#ffffff',

        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    win.loadFile(frontendPath);

    /*
     * Open DevTools only when debugging.
     * Keep this commented for the normal application.
     */
    // win.webContents.openDevTools();
}


/* =========================================================
   STOP BACKEND
========================================================= */

function stopBackend() {
    if (!backendProcess) {
        return;
    }

    console.log('Stopping TeachBack backend...');

    try {
        backendProcess.kill();
    } catch (error) {
        console.error(
            'Error stopping TeachBack backend:',
            error
        );
    }

    backendProcess = null;
}


/* =========================================================
   ELECTRON READY
========================================================= */

app.whenReady().then(() => {
    startBackend();

    /*
     * Give Express a moment to start before opening
     * the frontend.
     */
    setTimeout(() => {
        createWindow();
    }, 3000);

    app.on('activate', () => {
        if (
            BrowserWindow.getAllWindows().length === 0
        ) {
            createWindow();
        }
    });
});


/* =========================================================
   APPLICATION CLOSE
========================================================= */

app.on('before-quit', () => {
    stopBackend();
});


app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});