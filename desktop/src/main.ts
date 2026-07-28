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
let splashWindow: BrowserWindow | null = null;

const SPLASH_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    display: flex; align-items: center; justify-content: center;
    height: 100vh; background: #0b0f17; color: #c9d1d9;
    font-family: -apple-system, "Microsoft YaHei", sans-serif;
    user-select: none; -webkit-app-region: drag;
  }
  .splash {
    display: flex; flex-direction: column; align-items: center;
    gap: 24px; padding: 40px;
  }
  .logo {
    display: flex; align-items: center; gap: 10px;
    font-size: 28px; font-weight: 900; color: #e4e7ed;
  }
  .logo svg { color: #d92d3a; }
  .title { font-size: 15px; color: #8b949e; letter-spacing: 0.04em; }
  .loader {
    width: 200px; height: 3px; background: #21262d; border-radius: 2px;
    overflow: hidden; margin-top: 8px;
  }
  .loader-bar {
    width: 30%; height: 100%; background: linear-gradient(90deg, #d92d3a, #e8797c);
    border-radius: 2px; animation: slide 1.6s ease-in-out infinite;
  }
  @keyframes slide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(430%); }
  }
  .status { font-size: 12px; color: #6e7681; margin-top: 4px; }
</style>
</head>
<body>
<div class="splash">
  <div class="logo">
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
    <span>ZJ</span>
  </div>
  <div class="title">真君安全工作台</div>
  <div class="loader"><div class="loader-bar"></div></div>
  <div class="status">正在启动服务…</div>
</div>
</body>
</html>`;

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

function showSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 480,
    height: 360,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    center: true,
    resizable: false,
    show: true,
    backgroundColor: "#0b0f17",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
  return splash;
}

function closeSplashWindow(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
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

    // Show splash immediately so the operator sees feedback while the
    // Python sidecar boots (can take 10–30 s on first launch).
    splashWindow = showSplashWindow();

    try {
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
      mainWindow.once("ready-to-show", () => {
        closeSplashWindow();
        mainWindow?.show();
      });
      mainWindow.on("closed", () => {
        mainWindow = null;
      });
    } catch (error: unknown) {
      closeSplashWindow();
      throw error;
    }
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
