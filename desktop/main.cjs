const { app, BrowserWindow } = require('electron');
const path = require('node:path');

function createWindow() {
  const window = new BrowserWindow({
    title: 'AutoPilot',
    width: 1120,
    height: 760,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: '#f5f6f8',
    icon: path.join(__dirname, '../docs/logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.argv.includes('--smoke-test')) {
    const timeout = setTimeout(() => app.exit(1), 15000);
    window.webContents.once('did-fail-load', () => app.exit(1));
    window.webContents.once('did-finish-load', () => {
      clearTimeout(timeout);
      app.exit(window.getTitle() === 'AutoPilot' ? 0 : 1);
    });
  }
  window.loadFile(path.join(__dirname, 'index.html'));
  if (!app.isPackaged && process.argv.includes('--dev')) {
    window.webContents.openDevTools({ mode: 'detach' });
  }
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
