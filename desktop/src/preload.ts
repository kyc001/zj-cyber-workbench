import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("zj", {
  desktop: {
    getStatus: () => ipcRenderer.invoke("desktop:get-status"),
  },
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    close: () => ipcRenderer.invoke("window:close"),
  },
});

