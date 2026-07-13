import { EventEmitter } from "node:events";
import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

export type SidecarState = "STOPPED" | "STARTING" | "HEALTHY" | "STOPPING" | "CRASHED";

export type SidecarStatus = {
  state: SidecarState;
  pid: number | null;
  lastError: string | null;
};

export class SidecarManager extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private status: SidecarStatus = { state: "STOPPED", pid: null, lastError: null };
  private stopping = false;

  constructor(
    private readonly runtimeRoot: string,
    private readonly dataDir: string,
    private readonly port: number,
  ) {
    super();
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  getStatus(): SidecarStatus {
    return { ...this.status };
  }

  async start(): Promise<void> {
    if (this.child) return;

    this.stopping = false;
    this.setStatus({ state: "STARTING", pid: null, lastError: null });
    const packagedEntrypoint = path.join(this.runtimeRoot, "sidecar", "zj-core.exe");
    const packaged = fs.existsSync(packagedEntrypoint);
    const command = packaged ? packagedEntrypoint : process.env.ZJ_PYTHON || "python";
    const args = packaged ? [] : [path.join(this.runtimeRoot, "main.py")];
    const child = spawn(command, args, {
      cwd: this.runtimeRoot,
      env: {
        ...process.env,
        ZJ_BIND_HOST: "127.0.0.1",
        ZJ_BIND_PORT: String(this.port),
        ZJ_DATA_DIR: this.dataDir,
        ZJ_DESKTOP_MODE: "true",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
      windowsHide: true,
    });
    this.child = child;
    this.setStatus({ state: "STARTING", pid: child.pid ?? null, lastError: null });

    child.stdout.on("data", (chunk: Buffer) => this.emit("log", chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => this.emit("log", chunk.toString("utf8")));
    child.once("error", (error) => {
      this.child = null;
      this.setStatus({ state: "CRASHED", pid: null, lastError: error.message });
    });
    child.once("exit", (code, signal) => {
      this.child = null;
      if (this.stopping) {
        this.setStatus({ state: "STOPPED", pid: null, lastError: null });
        return;
      }
      this.setStatus({
        state: "CRASHED",
        pid: null,
        lastError: `ZJ Core exited (code=${String(code)}, signal=${String(signal)})`,
      });
    });

    await this.waitUntilHealthy();
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) {
      this.setStatus({ state: "STOPPED", pid: null, lastError: null });
      return;
    }

    this.stopping = true;
    this.setStatus({ ...this.status, state: "STOPPING" });
    child.kill();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private setStatus(status: SidecarStatus): void {
    this.status = status;
    this.emit("status", this.getStatus());
  }

  private async waitUntilHealthy(): Promise<void> {
    const deadline = Date.now() + 30_000;
    let lastError = "health check timed out";
    while (Date.now() < deadline) {
      if (!this.child || this.status.state === "CRASHED") {
        throw new Error(this.status.lastError || "ZJ Core exited during startup");
      }
      try {
        const response = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(1_500) });
        if (response.ok) {
          const health = (await response.json()) as { protocol_version?: number };
          if (health.protocol_version !== 1) {
            throw new Error(`unsupported sidecar protocol ${String(health.protocol_version)}`);
          }
          this.setStatus({ state: "HEALTHY", pid: this.child.pid ?? null, lastError: null });
          return;
        }
        lastError = `health check returned HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    this.setStatus({ state: "CRASHED", pid: this.child?.pid ?? null, lastError });
    this.child?.kill();
    throw new Error(lastError);
  }
}
