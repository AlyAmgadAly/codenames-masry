const { app, BrowserWindow, ipcMain, shell, clipboard, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.argv.includes('--dev');
let win = null;

/* ------------------------------------------------------------------ */
/*  simple json storage in %APPDATA%                                   */
/* ------------------------------------------------------------------ */
const dataDir = () => app.getPath('userData');
const file = (name) => path.join(dataDir(), name);

function readJson(name, fallback) {
  try {
    const raw = fs.readFileSync(file(name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  try {
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(file(name), JSON.stringify(value, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('write failed', name, e);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  window                                                             */
/* ------------------------------------------------------------------ */
function createWindow() {
  // fit inside the usable desktop area (laptops are often 1366x768 or scaled)
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1360, Math.max(900, area.width - 80));
  const height = Math.min(900, Math.max(560, area.height - 60));

  win = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(960, area.width),
    minHeight: Math.min(600, area.height),
    center: true,
    backgroundColor: '#0a0d16',
    title: 'Codenames Masry — كلمة سر',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  });

  // external links open in the real browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

/* ------------------------------------------------------------------ */
/*  ipc                                                                */
/* ------------------------------------------------------------------ */
ipcMain.handle('store:get', (_e, name, fallback) => readJson(name, fallback));
ipcMain.handle('store:set', (_e, name, value) => writeJson(name, value));
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron
}));
ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });
ipcMain.handle('shell:open', (_e, url) => {
  if (/^https?:/i.test(url)) shell.openExternal(url);
  return true;
});

ipcMain.handle('packs:export', async (_e, payload) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'صدّر كلماتك',
    defaultPath: 'codenames-masry-words.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  try {
    fs.writeFileSync(res.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('packs:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'استورد كلمات',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths?.length) return { ok: false };
  try {
    const raw = fs.readFileSync(res.filePaths[0], 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('win:minimise', () => win?.minimize());
ipcMain.handle('win:toggleFull', () => {
  if (!win) return false;
  win.isFullScreen() ? win.setFullScreen(false) : win.setFullScreen(true);
  return win.isFullScreen();
});

process.on('uncaughtException', (err) => console.error('uncaught', err));

app.whenReady().then(() => {
  app.setAppUserModelId('com.masry.codenames');
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
