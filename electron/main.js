import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import https from 'https';
import AdmZip from 'adm-zip';

import pkg from 'electron-updater';
const { autoUpdater } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// --- AUTO-UPDATER KONFIGURATION ---
autoUpdater.logger = console;
autoUpdater.autoDownload = true;

autoUpdater.on('checking-for-update', () => {
  console.log('[AutoUpdater] Prüfe auf Updates...');
});

autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Neues Update gefunden:', info.version);
});

autoUpdater.on('update-not-available', () => {
  console.log('[AutoUpdater] App ist auf dem neuesten Stand.');
});

autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater] Fehler beim Update-Check:', err);
});

autoUpdater.on('update-downloaded', () => {
  console.log('[AutoUpdater] Update heruntergeladen. Wird beim nächsten Beenden installiert.');
});

// Basis-Pfad für den Football Manager im Dokumente-Ordner des Nutzers
const fmBaseDir = path.join(os.homedir(), 'Documents', 'Sports Interactive', 'Football Manager 2026');

// Hilfsfunktion: Ermittelt den FM-Zielordner basierend auf der Kategorie aus deiner links.json
function getTargetFolder(groupName) {
  if (groupName.includes('Taktiken')) return path.join(fmBaseDir, 'tactics');
  if (groupName.includes('Standardsituationen')) return path.join(fmBaseDir, 'set-pieces');
  if (groupName.includes('Trainingspläne')) return path.join(fmBaseDir, 'schedules');
  if (groupName.includes('Medienpakete')) return path.join(fmBaseDir, 'configs');
  return path.join(os.homedir(), 'Downloads');
}

// Hilfsfunktion: Unterstützt HTTPS-Downloads inkl. 301/302 Redirects
function downloadStream(url, fileStream, resolve, reject) {
  https.get(url, (response) => {
    if (response.statusCode === 301 || response.statusCode === 302) {
      return downloadStream(response.headers.location, fileStream, resolve, reject);
    }
    if (response.statusCode !== 200) {
      return reject(new Error(`Server-Fehler: Statuscode ${response.statusCode}`));
    }
    response.pipe(fileStream);
    fileStream.on('finish', () => {
      fileStream.close();
      resolve();
    });
  }).on('error', (err) => {
    reject(err);
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'xBurzelx FM Suite',
    icon: path.join(__dirname, '../src/assets/images/icon.ico'),
    backgroundColor: '#0B0F19',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  // Externe Web-Links im Standard-Browser öffnen
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Update-Prüfung ausführen, wenn das Fenster sichtbar ist (nur im gebauten Zustand)
  mainWindow.once('ready-to-show', () => {
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    } else {
      console.log('[AutoUpdater] Dev-Modus aktiv: Auto-Updater wird übersprungen.');
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC HANDLER ---

ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

// Download & Entpacken aus links.json
ipcMain.handle('download-file', async (event, { url, fileName, groupName }) => {
  if (!url.endsWith('.fmf') && !url.endsWith('.zip') && !url.endsWith('.lnc')) {
    await shell.openExternal(url);
    return { success: true, openedInBrowser: true };
  }

  const targetFolder = getTargetFolder(groupName);

  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  const tempFilePath = path.join(targetFolder, fileName);
  const fileStream = fs.createWriteStream(tempFilePath);

  try {
    await new Promise((resolve, reject) => {
      downloadStream(url, fileStream, resolve, reject);
    });

    if (fileName.endsWith('.zip')) {
      const zip = new AdmZip(tempFilePath);
      zip.extractAllTo(targetFolder, true);
      fs.unlinkSync(tempFilePath);
      return { success: true, unzipped: true, targetFolder };
    }

    return { success: true, unzipped: false, filePath: tempFilePath, targetFolder };
  } catch (err) {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    return { success: false, error: err.message };
  }
});

// Ordner direkt im Explorer öffnen
ipcMain.handle('open-folder', async (event, groupName) => {
  const targetFolder = getTargetFolder(groupName);
  if (fs.existsSync(targetFolder)) {
    await shell.openPath(targetFolder);
    return { success: true };
  }
  return { success: false, error: 'Ordner existiert noch nicht.' };
});

// --- CONFIG.XML GENERATOR HANDLER ---

// 1. Ordner-Auswahldialog mit Parent Window
ipcMain.handle('select-facepack-folder', async (event) => {
  const webContents = event.sender;
  const win = BrowserWindow.fromWebContents(webContents);

  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Facepack-Ordner auswählen'
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// 2. Pfad / Ordner / Log öffnen
ipcMain.handle('open-path', async (event, targetPath) => {
  if (targetPath && fs.existsSync(targetPath)) {
    await shell.openPath(targetPath);
    return true;
  }
  return false;
});

// Helper: Sicherer Zielpfad bei Namenskonflikten
function getUniqueDestination(folderPath, desiredName) {
  const ext = path.extname(desiredName);
  const name = path.basename(desiredName, ext);
  let targetPath = path.join(folderPath, desiredName);
  let counter = 2;

  while (fs.existsSync(targetPath)) {
    targetPath = path.join(folderPath, `${name}_${counter}${ext}`);
    counter++;
  }
  return targetPath;
}

// Helper: Verschieben in Unterordner
function moveToFolder(basePath, sourcePath, destinationFolder, prefix) {
  const relativePath = path.relative(basePath, sourcePath);
  const safeName = relativePath.replace(/\\/g, '__').replace(/\//g, '__');
  const destinationName = `${prefix}_${safeName}`;
  const targetPath = getUniqueDestination(destinationFolder, destinationName);

  fs.renameSync(sourcePath, targetPath);
  return targetPath;
}

// 3. Haupt-Verarbeitungslogik für config.xml
ipcMain.handle('process-facepack', async (event, basePath) => {
  try {
    const stats = {
      files_processed: 0,
      ids_valid: 0,
      ids_new: 0,
      ids_invalid: 0,
      ids_duplicates: 0,
      ids_missing_files: 0,
      missing_image_ids: []
    };

    const INVALID_DIR = path.join(basePath, '__invalid_files');
    const DUPLICATE_DIR = path.join(basePath, '__duplicates');
    const CONFIG_PATH = path.join(basePath, 'config.xml');
    const BACKUP_PATH = path.join(basePath, 'config.xml.bak');
    const LOG_PATH = path.join(basePath, 'update_log.txt');

    if (!fs.existsSync(INVALID_DIR)) fs.mkdirSync(INVALID_DIR, { recursive: true });
    if (!fs.existsSync(DUPLICATE_DIR)) fs.mkdirSync(DUPLICATE_DIR, { recursive: true });

    const log = (msg) => {
      const timestamp = new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
      fs.appendFileSync(LOG_PATH, `[${timestamp}] ${msg}\n`, 'utf-8');
    };

    fs.writeFileSync(LOG_PATH, `=== xBurzelx Facepack Tool v1.1 ===\nOrdner: ${basePath}\n\n`, 'utf-8');

    // Alte config.xml auslesen
    const existingIds = new Set();
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const xmlData = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const regex = /from="(\d+)"[^>]*graphics\/pictures\/person\//g;
        let match;
        while ((match = regex.exec(xmlData)) !== null) {
          existingIds.add(match[1]);
        }
        log(`Bestehende Spieler-IDs in config.xml: ${existingIds.size}`);
      } catch (err) {
        log(`Fehler beim Lesen der alten config.xml: ${err.message}`);
      }
    } else {
      log(`Keine bestehende config.xml gefunden. Neue wird angelegt.`);
    }

    // Bilder rekursiv sammeln
    const supportedExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
    const excludedDirs = ['__invalid_files', '__duplicates', '__pycache__', '.git', 'node_modules', 'build', 'dist'];

    function collectFiles(dir) {
      let results = [];
      const list = fs.readdirSync(dir);

      list.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat && stat.isDirectory()) {
          if (!excludedDirs.includes(file)) {
            results = results.concat(collectFiles(filePath));
          }
        } else {
          const ext = path.extname(file).toLowerCase();
          if (supportedExtensions.includes(ext)) {
            results.push(filePath);
          }
        }
      });
      return results;
    }

    const imageFiles = collectFiles(basePath);
    const totalFiles = imageFiles.length;

    if (totalFiles === 0) {
      log('Keine unterstützen Bilder im Ordner gefunden.');
      return { success: true, stats, logPath: LOG_PATH, invalidDir: INVALID_DIR, duplicateDir: DUPLICATE_DIR };
    }

    const foundIds = new Set();

    for (let i = 0; i < totalFiles; i++) {
      const filePath = imageFiles[i];
      const fileName = path.basename(filePath);
      const fileStem = path.basename(filePath, path.extname(filePath));

      event.sender.send('process-progress', {
        current: i + 1,
        total: totalFiles,
        fileName: fileName
      });

      stats.files_processed++;

      // Check 1: Ist Dateiname eine reine Zahl?
      if (!/^\d+$/.test(fileStem)) {
        moveToFolder(basePath, filePath, INVALID_DIR, 'INVALID_NAME');
        stats.ids_invalid++;
        log(`Ungültiger Dateiname verschoben: ${filePath}`);
        continue;
      }

      // Check 2: Duplikats-Prüfung
      if (foundIds.has(fileStem)) {
        moveToFolder(basePath, filePath, DUPLICATE_DIR, 'DUPLICATE');
        stats.ids_duplicates++;
        log(`Doppelte ID verschoben: ${filePath} | ID: ${fileStem}`);
        continue;
      }

      foundIds.add(fileStem);
      stats.ids_valid++;
    }

    const newIdsSet = new Set([...foundIds].filter((x) => !existingIds.has(x)));
    const missingIdsArray = [...existingIds].filter((x) => !foundIds.has(x)).sort((a, b) => Number(a) - Number(b));

    stats.ids_new = newIdsSet.size;
    stats.ids_missing_files = missingIdsArray.length;
    stats.missing_image_ids = missingIdsArray;

    // Backup erstellen
    if (fs.existsSync(CONFIG_PATH)) {
      fs.copyFileSync(CONFIG_PATH, BACKUP_PATH);
      log(`Backup erstellt: ${BACKUP_PATH}`);
    }

    // Kombinieren & Numerisch sortieren
    const allIds = Array.from(new Set([...existingIds, ...foundIds])).sort((a, b) => Number(a) - Number(b));

    // Neue config.xml schreiben
    let xmlContent = `<record>\n\t<boolean id="preload" value="false"/>\n\t<boolean id="amap" value="false"/>\n\t<list id="maps">\n`;
    allIds.forEach((id) => {
      xmlContent += `\t\t<record from="${id}" to="graphics/pictures/person/${id}/portrait"/>\n`;
    });
    xmlContent += `\t</list>\n</record>`;

    fs.writeFileSync(CONFIG_PATH, xmlContent, 'utf-8');
    log(`config.xml erfolgreich erstellt. Gesamt-Einträge: ${allIds.length}`);

    return {
      success: true,
      stats,
      logPath: LOG_PATH,
      invalidDir: INVALID_DIR,
      duplicateDir: DUPLICATE_DIR
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});