import path from "node:path";
import net from "node:net";
import { app, BrowserWindow, ipcMain, session } from "electron";
import { installContentSecurityPolicy } from "./security/csp";
import { installNavigationPolicy } from "./security/navigation-policy";
import { SidecarManager } from "./sidecar/sidecar-manager";

const developmentRoot = path.resolve(__dirname, "..", "..");
let sidecar: SidecarManager | null = null;
let mainWindow: BrowserWindow | null = null;

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

function portableDataDir(): string {
  if (process.env.ZJ_DATA_DIR) return path.resolve(process.env.ZJ_DATA_DIR);
  const portableRoot = process.env.PORTABLE_EXECUTABLE_DIR;
  if (portableRoot) return path.join(portableRoot, "data");
  return app.isPackaged ? path.join(path.dirname(process.execPath), "data") : path.join(developmentRoot, ".zj");
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

app.whenReady().then(async () => {
  installContentSecurityPolicy(session.defaultSession);
  registerIpc();
  const shouldStartSidecar = app.isPackaged || process.env.ZJ_START_SIDECAR === "1";
  if (shouldStartSidecar) {
    const runtimeRoot = app.isPackaged ? process.resourcesPath : developmentRoot;
    sidecar = new SidecarManager(runtimeRoot, portableDataDir(), await findAvailablePort());
    await sidecar.start();
  }
  mainWindow = createWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
});

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
