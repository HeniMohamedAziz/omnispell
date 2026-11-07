const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const { execFile } = require('child_process');
const fs = require('fs');

let mainWindow = null;
let saveTimeout = null;
let pendingSaveData = null;

function getDataFilePath() {
  return path.join(__dirname, 'omnispell_local_db.json');
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.omnispell.app');
  }
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: 'OMNISPELL',
    icon: path.join(__dirname, 'src', 'assets', 'icon.ico'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

ipcMain.handle('omnispell:speak-native', async (_event, { text, rate = 0 }) => {
  if (process.platform === 'win32') {
    const safeText = String(text).replace(/'/g, "''");
    const psScript = `Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Rate = ${Number(rate) || 0}; $synth.Speak('${safeText}');`;
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], { windowsHide: true }, () => {
        resolve({ ok: true });
      });
    });
  }
  return { ok: false };
});

ipcMain.handle('omnispell:load-db', async () => {
  try {
    const filePath = getDataFilePath();
    if (fs.existsSync(filePath)) {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to load local database:', err);
  }
  return null;
});

ipcMain.handle('omnispell:save-db', async (_event, data) => {
  try {
    pendingSaveData = data;
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      try {
        const filePath = getDataFilePath();
        await fs.promises.writeFile(filePath, JSON.stringify(pendingSaveData, null, 2), 'utf-8');
      } catch (e) {
        console.error('Failed to save local database:', e);
      }
    }, 150);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

if (gotTheLock) {
  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
