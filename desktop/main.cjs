const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { registerIpc, confirmClose } = require('./autopilotIpc.cjs');

const SMOKE_CHECK_SCRIPT = "typeof window.autopilot?.start === 'function' && Boolean(document.querySelector('#log'))";

function createWindow() {
  const window = new BrowserWindow({
    title: 'AutoPilot',
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f5f6f8',
    icon: path.join(__dirname, '../docs/logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (!confirmClose(window)) event.preventDefault();
  });
  if (process.argv.includes('--smoke-test')) {
    const timeout = setTimeout(() => app.exit(1), 15000);
    window.webContents.once('did-fail-load', () => app.exit(1));
    window.webContents.once('did-finish-load', async () => {
      clearTimeout(timeout);
      const isBridgeReady = await window.webContents.executeJavaScript(SMOKE_CHECK_SCRIPT).catch(() => false);
      app.exit(window.getTitle() === 'AutoPilot' && isBridgeReady ? 0 : 1);
    });
  }
  window.loadFile(path.join(__dirname, 'index.html'));
  if (!app.isPackaged && process.argv.includes('--dev')) {
    window.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
