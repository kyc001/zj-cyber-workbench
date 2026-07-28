import path from "node:path";
import net from "node:net";
import { promises as fs } from "node:fs";
import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { installContentSecurityPolicy } from "./security/csp";
import { installNavigationPolicy } from "./security/navigation-policy";
import { SidecarManager } from "./sidecar/sidecar-manager";

const developmentRoot = path.resolve(__dirname, "..", "..");
const appDataDirectoryName = "Zhenjun";
let sidecar: SidecarManager | null = null;
let mainWindow: BrowserWindow | null = null;

function packagedAppRoot(): string {
  const configured = process.env.ZJ_APP_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) return path.join(localAppData, appDataDirectoryName);
  return path.join(app.getPath("appData"), appDataDirectoryName);
}

if (app.isPackaged) {
  app.setPath("userData", path.join(packagedAppRoot(), "Electron"));
}

function rendererUrl(): string {
  return process.env.ZJ_RENDERER_URL || (sidecar ? `${sidecar.baseUrl}/playground` : "http://127.0.0.1:5173/playground");
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: "#111315",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  const target = rendererUrl();
  installNavigationPolicy(window.webContents, new URL(target).origin);
  window.once("ready-to-show", () => window.show());
  void window.loadURL(target);
  return window;
}

function registerIpc(): void {
  ipcMain.handle("desktop:get-status", () => sidecar?.getStatus() ?? {
    state: "STOPPED",
    pid: null,
    lastError: null,
  });
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:close", () => mainWindow?.close());
}

function runtimeDataDir(): string {
  if (process.env.ZJ_DATA_DIR) return path.resolve(process.env.ZJ_DATA_DIR);
  return app.isPackaged ? path.join(packagedAppRoot(), "Data") : path.join(developmentRoot, ".zj");
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function migrateLegacyPortableData(targetDataDir: string): Promise<void> {
  if (!app.isPackaged || process.env.ZJ_DATA_DIR) return;
  if (await pathExists(path.join(targetDataDir, "config.json"))) return;

  const executableDir = path.dirname(process.execPath);
  const candidates = [
    process.env.PORTABLE_EXECUTABLE_DIR
      ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, "data")
      : "",
    path.join(executableDir, "data"),
  ].filter((candidate, index, items) => (
    candidate
    && path.resolve(candidate) !== path.resolve(targetDataDir)
    && items.indexOf(candidate) === index
  ));

  for (const legacyDataDir of candidates) {
    if (!await pathExists(path.join(legacyDataDir, "config.json"))) continue;
    await fs.mkdir(targetDataDir, { recursive: true });
    await fs.cp(legacyDataDir, targetDataDir, {
      recursive: true,
      force: false,
      errorOnExist: false,
      preserveTimestamps: true,
    });
    await fs.writeFile(
      path.join(targetDataDir, ".migrated-from-portable.json"),
      `${JSON.stringify({
        source: legacyDataDir,
        migrated_at: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf8",
    );
    return;
  }
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate loopback port"));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    app.setAppUserModelId("io.github.zj-security.workbench");
    installContentSecurityPolicy(session.defaultSession);
    registerIpc();
    const shouldStartSidecar = app.isPackaged || process.env.ZJ_START_SIDECAR === "1";
    if (shouldStartSidecar) {
      const runtimeRoot = app.isPackaged ? process.resourcesPath : developmentRoot;
      const dataDir = runtimeDataDir();
      await migrateLegacyPortableData(dataDir);
      await fs.mkdir(dataDir, { recursive: true });
      sidecar = new SidecarManager(runtimeRoot, dataDir, await findAvailablePort());
      await sidecar.start();
    }
    mainWindow = createWindow();
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      "真君安全工作台启动失败",
      `${message}\n\n日志目录：${runtimeDataDir()}`,
    );
    app.quit();
  });
}

app.on("activate", () => {
  if (!mainWindow) mainWindow = createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!sidecar || sidecar.getStatus().state === "STOPPED") return;
  event.preventDefault();
  void sidecar.stop().finally(() => app.exit());
});
