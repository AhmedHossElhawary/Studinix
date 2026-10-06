const { app, BrowserWindow, screen, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

let mainWindow = null;
let dropNoteWindow = null;
let pyBackendProcess = null;
let tray = null;

const SERVER_PORT = 8000;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const BACKEND_READY_TIMEOUT_MS = 5000;
const BACKEND_POLL_INTERVAL_MS = 500;
const BACKEND_MAX_ATTEMPTS = Math.ceil(BACKEND_READY_TIMEOUT_MS / BACKEND_POLL_INTERVAL_MS);

// ----------------- BACKEND LIFECYCLE -----------------

function getBackendCandidates() {
  const repoRoot = path.join(__dirname, '..');
  const candidates = [];

  if (app.isPackaged) {
    const packagedBackendDir = path.join(process.resourcesPath, 'backend');
    const packagedExecutableNames = [
      'Studinix-Backend.exe',
      'studinix-backend.exe',
      'backend.exe',
      'server.exe',
      'run_app.exe'
    ];

    for (const fileName of packagedExecutableNames) {
      const executablePath = path.join(packagedBackendDir, fileName);
      if (fs.existsSync(executablePath)) {
        candidates.push({
          command: executablePath,
          args: [],
          cwd: packagedBackendDir
        });
      }
    }

    const packagedScripts = [
      path.join(packagedBackendDir, 'run_app.py'),
      path.join(packagedBackendDir, 'server.py')
    ];

    for (const scriptPath of packagedScripts) {
      if (fs.existsSync(scriptPath)) {
        candidates.push({
          command: 'python',
          args: [scriptPath],
          cwd: process.resourcesPath
        });
        candidates.push({
          command: 'py',
          args: ['-3', scriptPath],
          cwd: process.resourcesPath
        });
      }
    }
  } else {
    const devCandidates = [
      {
        command: 'python',
        args: [path.join(repoRoot, 'run_app.py')],
        cwd: repoRoot
      },
      {
        command: 'python',
        args: [path.join(repoRoot, 'backend', 'server.py')],
        cwd: repoRoot
      },
      {
        command: 'py',
        args: ['-3', path.join(repoRoot, 'run_app.py')],
        cwd: repoRoot
      }
    ];

    candidates.push(...devCandidates);
  }

  return candidates;
}

function waitForBackendHealth(maxAttempts = 10, delayMs = 500) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      http.get(`${SERVER_URL}/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          retry(remaining);
        }
      }).on('error', () => {
        retry(remaining);
      });
    };

    const retry = (remaining) => {
      if (remaining <= 0) return reject(new Error('Backend timeout'));
      setTimeout(() => check(remaining - 1), delayMs);
    };

    check(maxAttempts);
  });
}

function startPythonBackend() {
  const candidates = getBackendCandidates();

  if (candidates.length === 0) {
    return Promise.reject(new Error('No backend launch candidate was found.'));
  }

  process.env.STUDINIX_DATA_DIR = app.getPath('userData');
  fs.mkdirSync(process.env.STUDINIX_DATA_DIR, { recursive: true });

  return new Promise((resolve, reject) => {
    const tryNextCandidate = (index) => {
      if (index >= candidates.length) {
        reject(new Error('Unable to launch backend.'));
        return;
      }

      const candidate = candidates[index];
      const child = spawn(candidate.command, candidate.args, {
        cwd: candidate.cwd,
        env: {
          ...process.env,
          STUDINIX_DATA_DIR: process.env.STUDINIX_DATA_DIR
        },
        windowsHide: true,
        shell: false
      });

      let settled = false;
      const cleanup = () => {
        child.removeListener('error', onError);
        child.removeListener('spawn', onSpawn);
        child.removeListener('exit', onExit);
      };

      const onError = (error) => {
        cleanup();
        if (settled) return;
        settled = true;
        console.warn(`[Studinix Engine]: Failed to start backend with ${candidate.command}: ${error.message}`);
        tryNextCandidate(index + 1);
      };

      const onExit = (code, signal) => {
        cleanup();
        if (settled) return;
        settled = true;
        reject(new Error(`Backend process exited before becoming ready (code=${code}, signal=${signal || 'none'}).`));
      };

      const onSpawn = () => {
        cleanup();
        if (settled) return;
        settled = true;
        pyBackendProcess = child;

        if (pyBackendProcess.stdout) {
          pyBackendProcess.stdout.on('data', (data) => {
            console.log(`[Studinix Engine]: ${data}`);
          });
        }

        if (pyBackendProcess.stderr) {
          pyBackendProcess.stderr.on('data', (data) => {
            console.error(`[Studinix Engine Error]: ${data}`);
          });
        }

        pyBackendProcess.on('exit', (code, signal) => {
          console.warn(`[Studinix Engine]: Backend exited (code=${code}, signal=${signal || 'none'}).`);
        });

        resolve(pyBackendProcess);
      };

      child.once('error', onError);
      child.once('spawn', onSpawn);
      child.once('exit', onExit);
    };

    tryNextCandidate(0);
  });
}

// ----------------- WINDOW CREATION -----------------

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    title: 'Studinix — Focus & To-Do',
    backgroundColor: '#090d16',
    show: false,  // Hidden until backend is ready
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const loadingPage = path.join(__dirname, '..', 'static', 'loading.html');
  mainWindow.loadFile(loadingPage).catch((error) => {
    console.error(`[Studinix Engine]: Failed to load loading page: ${error.message}`);
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createDropNoteWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;

  // Position at top-right of screen
  const defaultWidth = 330;
  const defaultHeight = 460;
  const defaultX = screenWidth - defaultWidth - 24;
  const defaultY = 32;

  dropNoteWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    minWidth: 260,
    minHeight: 52,
    x: defaultX,
    y: defaultY,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,  // Hidden until backend is ready
    title: 'Studinix Drop Note',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // STRICT ALWAYS-ON-TOP ENFORCEMENT:
  // Using 'screen-saver' or 'pop-up-menu' priority so it stays visible above ALL full-screen apps & games
  dropNoteWindow.setAlwaysOnTop(true, 'screen-saver');
  dropNoteWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  dropNoteWindow.on('closed', () => {
    dropNoteWindow = null;
  });
}

// ----------------- IPC HANDLERS -----------------

ipcMain.handle('toggle-dropnote', () => {
  if (!dropNoteWindow) {
    createDropNoteWindow();
    return true;
  }
  if (dropNoteWindow.isVisible()) {
    dropNoteWindow.hide();
    return false;
  } else {
    dropNoteWindow.show();
    dropNoteWindow.setAlwaysOnTop(true, 'screen-saver');
    return true;
  }
});

ipcMain.handle('hide-dropnote', () => {
  if (dropNoteWindow) {
    dropNoteWindow.hide();
  }
  return true;
});

let originalNoteBounds = null;

ipcMain.handle('set-dropnote-collapsed', (event, collapsed) => {
  if (!dropNoteWindow) return;

  if (collapsed) {
    originalNoteBounds = dropNoteWindow.getBounds();
    dropNoteWindow.setSize(originalNoteBounds.width, 54, true);
    dropNoteWindow.setResizable(false);
  } else {
    const targetHeight = originalNoteBounds ? originalNoteBounds.height : 460;
    const targetWidth = originalNoteBounds ? originalNoteBounds.width : 330;
    dropNoteWindow.setSize(targetWidth, targetHeight, true);
    dropNoteWindow.setResizable(true);
  }
  dropNoteWindow.setAlwaysOnTop(true, 'screen-saver');
});

ipcMain.on('notify-tasks-updated', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync-tasks');
  }
  if (dropNoteWindow && !dropNoteWindow.isDestroyed()) {
    dropNoteWindow.webContents.send('sync-tasks');
  }
});

ipcMain.on('notify-user-changed', (event, data) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('user-changed', data);
  }
  if (dropNoteWindow && !dropNoteWindow.isDestroyed()) {
    dropNoteWindow.webContents.send('user-changed', data);
  }
});

// ----------------- SYSTEM TRAY -----------------

function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'static', 'favicon.ico');
    tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open Main Window', click: () => { if (mainWindow) mainWindow.show(); else createMainWindow(); } },
      { label: 'Toggle Drop Note', click: () => { if (dropNoteWindow && dropNoteWindow.isVisible()) dropNoteWindow.hide(); else if (dropNoteWindow) dropNoteWindow.show(); else createDropNoteWindow(); } },
      { type: 'separator' },
      { label: 'Quit Studinix', click: () => { app.isQuitting = true; app.quit(); } }
    ]);
    tray.setToolTip('Studinix — Focus & To-Do Note');
    tray.setContextMenu(contextMenu);
  } catch (e) {
    // Tray optional
  }
}

// ----------------- APP INITIALIZATION -----------------

app.whenReady().then(async () => {
  // Create both windows immediately and keep the main window on a local page
  // while the backend starts up.
  createMainWindow();
  createDropNoteWindow();
  createTray();

  const fallbackPage = path.join(__dirname, '..', 'static', 'error.html');

  const showMainWindowFallback = async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        await mainWindow.loadFile(fallbackPage);
      } catch (error) {
        console.error(`[Studinix Engine]: Failed to load fallback page: ${error.message}`);
      }
      if (!mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    }
  };

  const revealApp = async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        await mainWindow.loadURL(SERVER_URL);
      } catch (error) {
        console.error(`[Studinix Engine]: Failed to load main app URL: ${error.message}`);
      }
      if (!mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    }
    if (dropNoteWindow && !dropNoteWindow.isDestroyed()) {
      try {
        await dropNoteWindow.loadURL(`${SERVER_URL}/dropnote`);
      } catch (error) {
        console.error(`[Studinix Engine]: Failed to load drop note URL: ${error.message}`);
      }
      if (!dropNoteWindow.isDestroyed()) {
        dropNoteWindow.show();
      }
    }
  };

  const showFallback = () => {
    void showMainWindowFallback();
  };

  try {
    await waitForBackendHealth(3, 250);
    await revealApp();
  } catch (err) {
    // Spawn the backend automatically and wait up to 5 seconds for readiness.
    try {
      await startPythonBackend();
      await waitForBackendHealth(BACKEND_MAX_ATTEMPTS, BACKEND_POLL_INTERVAL_MS);
      await revealApp();
    } catch (e) {
      console.warn('Backend failed to start in time — showing fallback page');
      showFallback();
    }
  }
});


app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (pyBackendProcess && !pyBackendProcess.killed) pyBackendProcess.kill();
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (pyBackendProcess && !pyBackendProcess.killed) pyBackendProcess.kill();
});
