import { shell, type WebContents } from "electron";

export function installNavigationPolicy(webContents: WebContents, appOrigin: string): void {
  webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== appOrigin) event.preventDefault();
  });

  webContents.setWindowOpenHandler(({ url }) => {
    const target = new URL(url);
    if (target.protocol === "https:") void shell.openExternal(target.toString());
    return { action: "deny" };
  });
}

