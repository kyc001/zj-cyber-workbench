import { Button } from "@douyinfe/semi-ui";
import { Maximize2, Minimize2, Minus, Monitor, FolderOpen, SquareTerminal, X } from "lucide-react";
import {
  CSSProperties,
  createContext,
  lazy,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { buildHostShellUrl } from "../../shared/api/hosts";
import { buildContainerNoVNCUrl, buildContainerShellUrl, canOpenContainerNoVNC } from "../../shared/api/sandboxContainers";
import { SANDBOX_CONTAINER_STATUS } from "../../shared/api/generated/constants";
import { showApiError } from "../../shared/api/feedback";
import type { ManagedHost, SandboxContainer } from "../../shared/api/types";
import { cx } from "../../shared/lib/className";
import {
  clamp,
  clampWindowToViewport,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  getDraggedWindowPosition,
  getInitialFileManagerRect,
  getInitialNoVNCRect,
  getMaximizedRect,
  getResizedWindowSize,
  getWindowRect,
  MIN_WINDOW_HEIGHT,
  type DockState,
  type DragState,
  type Rect,
  type ResizeState,
  type WindowStateBase,
} from "./floatingWindow";

const ContainerFileManager = lazy(() => import("./ContainerFileManager").then((module) => ({ default: module.ContainerFileManager })));

type ShellStatus = "connecting" | "open" | "closed";

type ShellWindowRecord = {
  id: string;
  shellUrl: string;
  targetKey: string;
  title: string;
  serial: number;
  initialRect: Rect;
};

type ShellWindowState = WindowStateBase & {
  status: ShellStatus;
  isMaximized: boolean;
  restoreRect: Rect | null;
};

type ShellTarget = {
  key: string;
  title: string;
  url: string;
};

type NoVNCWindowState = WindowStateBase & {
  containerId: number;
  containerName: string;
  url: string;
};

type FileManagerWindowState = WindowStateBase & {
  containerId: number;
  containerName: string;
  isMaximized: boolean;
  restoreRect: Rect | null;
};

type ContainerShellContextValue = {
  openFileManager: (container: SandboxContainer) => void;
  openHostShell: (host: ManagedHost) => void;
  openNoVNC: (container: SandboxContainer) => void;
  openShell: (container: SandboxContainer) => void;
  syncContainerWindows: (container: SandboxContainer | null) => void;
};

type FloatingWindowProps = {
  actions: ReactNode;
  children: ReactNode;
  className?: string;
  dockState: DockState;
  icon: ReactNode;
  isMaximized?: boolean;
  meta: string;
  onHeaderPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  rect: Rect;
  resizeHandle?: ReactNode;
  title: string;
};

type WindowControlsProps = {
  closeAriaLabel: string;
  maximizeAriaLabel?: string;
  minimizeAriaLabel: string;
  isMaximized?: boolean;
  onClose: () => void;
  onMaximize?: () => void;
  onMinimize: () => void;
  restoreAriaLabel?: string;
};

const SHELL_OUTPUT_DECODER = new TextDecoder();

async function loadXterm() {
  const [{ Terminal }, { FitAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/xterm/css/xterm.css"),
  ]);
  return { Terminal, FitAddon };
}

const ContainerShellContext = createContext<ContainerShellContextValue | null>(null);

export function useContainerShell() {
  const value = useContext(ContainerShellContext);
  if (!value) throw new Error("useContainerShell must be used inside ContainerShellProvider");
  return value;
}

export function ContainerShellProvider({ children }: { children: ReactNode }) {
  const [shells, setShells] = useState<ShellWindowRecord[]>([]);
  const [noVNC, setNoVNC] = useState<NoVNCWindowState | null>(null);
  const [fileManager, setFileManager] = useState<FileManagerWindowState | null>(null);
  const shellCounterRef = useRef(0);
  const targetSerialsRef = useRef<Record<string, number>>({});
  const noVNCRef = useRef<NoVNCWindowState | null>(null);
  const fileManagerRef = useRef<FileManagerWindowState | null>(null);
  const noVNCDragRef = useRef<DragState | null>(null);
  const fileManagerDragRef = useRef<DragState | null>(null);
  const fileManagerResizeRef = useRef<ResizeState | null>(null);

  useLayoutEffect(() => {
    noVNCRef.current = noVNC;
  }, [noVNC]);

  useLayoutEffect(() => {
    fileManagerRef.current = fileManager;
  }, [fileManager]);

  const closeShell = useCallback((id: string) => {
    setShells((current) => current.filter((shell) => shell.id !== id));
  }, []);

  const openShellTarget = useCallback((target: ShellTarget) => {
    const serial = (targetSerialsRef.current[target.key] ?? 0) + 1;
    targetSerialsRef.current[target.key] = serial;
    shellCounterRef.current += 1;
    const offset = Math.min((serial - 1) * 28, 112);
    const width = Math.min(DEFAULT_WINDOW_WIDTH, Math.max(460, window.innerWidth - 48));
    const height = Math.min(DEFAULT_WINDOW_HEIGHT, Math.max(300, window.innerHeight - 96));
    const next: ShellWindowRecord = {
      id: `shell:${Date.now()}:${shellCounterRef.current}`,
      shellUrl: target.url,
      targetKey: target.key,
      title: `${target.title} #${serial}`,
      serial,
      initialRect: {
        x: Math.max(24, window.innerWidth - width - 36 - offset),
        y: Math.max(92, window.innerHeight - height - 36 - offset),
        width,
        height,
      },
    };
    setShells((current) => [...current, next]);
  }, []);

  const openShell = useCallback((container: SandboxContainer) => {
    if (container.status !== SANDBOX_CONTAINER_STATUS.RUNNING || container.control_proxy_host_port <= 0) return;
    openShellTarget({
      key: `container:${container.id}`,
      title: `Workspace · ${container.container_name}`,
      url: buildContainerShellUrl(container.id),
    });
  }, [openShellTarget]);

  const openHostShell = useCallback((host: ManagedHost) => {
    const isLocal = host.id === 1;
    const hostName = host.display_name || host.ip_address;
    openShellTarget({
      key: `host:${host.id}`,
      title: isLocal ? "本机 PowerShell" : `SSH · ${hostName}`,
      url: buildHostShellUrl(host.id),
    });
  }, [openShellTarget]);

  const closeNoVNC = useCallback(() => {
    noVNCDragRef.current = null;
    noVNCRef.current = null;
    setNoVNC(null);
  }, []);

  const minimizeNoVNC = useCallback(() => {
    setNoVNC((current) => current ? { ...current, dockState: "minimized" } : current);
  }, []);

  const restoreNoVNC = useCallback(() => {
    setNoVNC((current) => current ? { ...current, dockState: "normal" } : current);
  }, []);

  const openNoVNC = useCallback((container: SandboxContainer) => {
    try {
      const url = buildContainerNoVNCUrl(container);
      setNoVNC((current) => {
        if (current?.containerId === container.id && current.url === url) {
          const next = { ...current, title: container.container_name, containerName: container.container_name, dockState: "normal" as DockState };
          noVNCRef.current = next;
          return next;
        }
        const next: NoVNCWindowState = {
          containerId: container.id,
          title: container.container_name,
          containerName: container.container_name,
          dockState: "normal",
          url,
          ...getInitialNoVNCRect(),
        };
        noVNCRef.current = next;
        return next;
      });
    } catch (error) {
      showApiError(error);
    }
  }, []);

  const closeFileManager = useCallback(() => {
    fileManagerDragRef.current = null;
    fileManagerResizeRef.current = null;
    fileManagerRef.current = null;
    setFileManager(null);
  }, []);

  const minimizeFileManager = useCallback(() => {
    setFileManager((current) => current ? { ...current, dockState: "minimized" } : current);
  }, []);

  const restoreFileManager = useCallback(() => {
    setFileManager((current) => current ? { ...current, dockState: "normal" } : current);
  }, []);

  const toggleMaximizeFileManager = useCallback(() => {
    fileManagerDragRef.current = null;
    fileManagerResizeRef.current = null;
    setFileManager((current) => {
      if (!current) return current;
      if (current.isMaximized) {
        const restoreRect = current.restoreRect ?? getWindowRect(current);
        return { ...current, ...restoreRect, isMaximized: false, restoreRect: null };
      }
      return { ...current, ...getMaximizedRect(), isMaximized: true, restoreRect: getWindowRect(current) };
    });
  }, []);

  const openFileManager = useCallback((container: SandboxContainer) => {
    if (container.status !== SANDBOX_CONTAINER_STATUS.RUNNING || container.control_proxy_host_port <= 0) return;
    setFileManager((current) => {
      if (current?.containerId === container.id) {
        const next = { ...current, title: container.container_name, containerName: container.container_name, dockState: "normal" as DockState };
        fileManagerRef.current = next;
        return next;
      }
      const next: FileManagerWindowState = {
        containerId: container.id,
        title: container.container_name,
        containerName: container.container_name,
        dockState: "normal",
        isMaximized: false,
        restoreRect: null,
        ...getInitialFileManagerRect(),
      };
      fileManagerRef.current = next;
      return next;
    });
  }, []);

  const syncContainerWindows = useCallback((container: SandboxContainer | null) => {
    const currentFileManager = fileManagerRef.current;
    const currentNoVNC = noVNCRef.current;
    if (currentFileManager) {
      if (container && container.status === SANDBOX_CONTAINER_STATUS.RUNNING && container.control_proxy_host_port > 0) openFileManager(container);
      else closeFileManager();
    }
    if (currentNoVNC) {
      if (container && canOpenContainerNoVNC(container)) openNoVNC(container);
      else closeNoVNC();
    }
  }, [closeFileManager, closeNoVNC, openFileManager, openNoVNC]);

  useEffect(() => {
    const onWindowResize = () => {
      setNoVNC((current) => current ? {
        ...current,
        x: clamp(current.x, 8, window.innerWidth - 80),
        y: clamp(current.y, 8, window.innerHeight - 80),
      } : current);
      setFileManager((current) => {
        if (!current) return current;
        if (current.isMaximized) return { ...current, ...getMaximizedRect() };
        return clampWindowToViewport(current);
      });
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, []);

  const onPointerMove = useCallback((event: PointerEvent) => {
    const noVNCDrag = noVNCDragRef.current;
    if (noVNCDrag) {
      setNoVNC((current) => current ? { ...current, ...getDraggedWindowPosition(noVNCDrag, event) } : current);
      return;
    }
    const fmDrag = fileManagerDragRef.current;
    if (fmDrag) {
      setFileManager((current) => current ? { ...current, ...getDraggedWindowPosition(fmDrag, event) } : current);
      return;
    }
    const fmResize = fileManagerResizeRef.current;
    if (fmResize) {
      setFileManager((current) => current ? { ...current, ...getResizedWindowSize(fmResize, event) } : current);
    }
  }, []);

  const stopPointerAction = useCallback(() => {
    noVNCDragRef.current = null;
    fileManagerDragRef.current = null;
    fileManagerResizeRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopPointerAction);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopPointerAction);
    };
  }, [onPointerMove, stopPointerAction]);

  const contextValue = useMemo<ContainerShellContextValue>(
    () => ({ openFileManager, openHostShell, openNoVNC, openShell, syncContainerWindows }),
    [openFileManager, openHostShell, openNoVNC, openShell, syncContainerWindows],
  );

  return (
    <ContainerShellContext.Provider value={contextValue}>
      {children}
      {shells.map((shell, index) => (
        <ShellWindow key={shell.id} record={shell} dockIndex={index} onClose={() => closeShell(shell.id)} />
      ))}
      {noVNC ? (
        <>
          <FloatingWindow
            actions={(
              <WindowControls
                closeAriaLabel="关闭远程桌面"
                minimizeAriaLabel="最小化远程桌面"
                onClose={closeNoVNC}
                onMinimize={minimizeNoVNC}
              />
            )}
            dockState={noVNC.dockState}
            icon={<Monitor size={16} />}
            meta="桌面"
            rect={noVNC}
            title={noVNC.title}
            onHeaderPointerDown={(event) => {
              noVNCDragRef.current = beginWindowDrag(noVNC, event, { capturePointer: true });
            }}
          >
            <div className="novnc-body">
              <iframe className="novnc-frame" src={noVNC.url} title={`noVNC ${noVNC.containerName}`} />
            </div>
          </FloatingWindow>
          {noVNC.dockState === "minimized" ? (
            <MinimizedWindowButton className="novnc-minimized-button" ariaLabel="恢复远程桌面" icon={<Monitor size={20} />} onClick={restoreNoVNC} />
          ) : null}
        </>
      ) : null}
      {fileManager ? (
        <>
          <FloatingWindow
            actions={(
              <WindowControls
                closeAriaLabel="关闭文件管理器"
                isMaximized={fileManager.isMaximized}
                maximizeAriaLabel="最大化文件管理器"
                minimizeAriaLabel="最小化文件管理器"
                onClose={closeFileManager}
                onMaximize={toggleMaximizeFileManager}
                onMinimize={minimizeFileManager}
                restoreAriaLabel="还原文件管理器大小"
              />
            )}
            dockState={fileManager.dockState}
            icon={<FolderOpen size={16} />}
            isMaximized={fileManager.isMaximized}
            meta="文件"
            rect={fileManager}
            title={fileManager.title}
            onHeaderPointerDown={(event) => {
              if (fileManager.isMaximized) return;
              fileManagerDragRef.current = beginWindowDrag(fileManager, event, { capturePointer: true });
            }}
            resizeHandle={(
              <div
                className="shell-resize-handle"
                onPointerDown={(event) => {
                  if (fileManager.isMaximized) return;
                  fileManagerResizeRef.current = beginWindowResize("filemanager", fileManager, event);
                }}
              />
            )}
          >
            <Suspense fallback={<div className="file-manager-loading">正在加载文件...</div>}>
              <ContainerFileManager containerId={fileManager.containerId} />
            </Suspense>
          </FloatingWindow>
          {fileManager.dockState === "minimized" ? (
            <MinimizedWindowButton className="filemanager-minimized-button" ariaLabel="恢复文件管理器" icon={<FolderOpen size={20} />} onClick={restoreFileManager} />
          ) : null}
        </>
      ) : null}
    </ContainerShellContext.Provider>
  );
}

function ShellWindow({ dockIndex, onClose, record }: { dockIndex: number; onClose: () => void; record: ShellWindowRecord }) {
  const [state, setState] = useState<ShellWindowState>({
    ...record.initialRect,
    title: record.title,
    dockState: "normal",
    status: "connecting",
    isMaximized: false,
    restoreRect: null,
  });
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<ResizeState | null>(null);
  const fitWithoutSnapRef = useRef(false);

  const sendResize = useCallback(() => {
    const terminal = terminalRef.current;
    const socket = socketRef.current;
    if (!terminal || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "resize", rows: terminal.rows, cols: terminal.cols }));
  }, []);

  const fitTerminal = useCallback((snapHeight = true) => {
    if (!fitRef.current || !terminalRef.current || !terminalHostRef.current) return;
    fitRef.current.fit();
    if (snapHeight) {
      snapShellHeightToRows(terminalHostRef.current, terminalRef.current, setState);
    }
    sendResize();
  }, [sendResize]);

  const minimize = useCallback(() => {
    setState((current) => ({ ...current, dockState: "minimized" }));
  }, []);

  const restore = useCallback(() => {
    fitWithoutSnapRef.current = true;
    setState((current) => ({ ...current, dockState: "normal" }));
    window.setTimeout(() => {
      fitTerminal(false);
      terminalRef.current?.focus();
    }, 0);
  }, [fitTerminal]);

  const toggleMaximize = useCallback(() => {
    dragRef.current = null;
    resizeRef.current = null;
    fitWithoutSnapRef.current = true;
    setState((current) => {
      if (current.isMaximized) {
        const restoreRect = current.restoreRect ?? getWindowRect(current);
        return { ...current, ...restoreRect, isMaximized: false, restoreRect: null };
      }
      return { ...current, ...getMaximizedRect(), isMaximized: true, restoreRect: getWindowRect(current) };
    });
  }, []);

  useEffect(() => {
    if (!terminalHostRef.current) return;
    let canceled = false;
    let terminal: Terminal | null = null;
    let fit: FitAddon | null = null;
    let socket: WebSocket | null = null;
    let disposable: { dispose: () => void } | null = null;

    const cleanup = () => {
      disposable?.dispose();
      if (socket) {
        socket.close();
      }
      terminal?.dispose();
      if (socketRef.current === socket) socketRef.current = null;
      if (terminalRef.current === terminal) terminalRef.current = null;
      if (fitRef.current === fit) fitRef.current = null;
    };

    void loadXterm()
      .then(({ Terminal, FitAddon }) => {
        if (canceled || !terminalHostRef.current) return;
        terminal = new Terminal({
          cursorBlink: true,
          convertEol: true,
          fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, monospace",
          fontSize: 13,
          theme: {
            background: "#0b1018",
            foreground: "#b7c6d7",
            cursor: "#ffffff",
            selectionBackground: "rgba(59, 130, 246, 0.24)",
          },
        });
        fit = new FitAddon();
        terminal.loadAddon(fit);
        terminal.open(terminalHostRef.current);
        terminalRef.current = terminal;
        fitRef.current = fit;
        window.setTimeout(() => fitTerminal(false), 0);

        try {
          socket = new WebSocket(record.shellUrl);
        } catch (error) {
          cleanup();
          showApiError(error);
          setState((current) => ({ ...current, status: "closed" }));
          return;
        }

        socket.binaryType = "arraybuffer";
        socketRef.current = socket;
        disposable = terminal.onData((data) => {
          if (socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "input", data }));
          }
        });

        socket.addEventListener("open", () => {
          setState((current) => ({ ...current, status: "open" }));
          terminal?.focus();
          fitTerminal(false);
        });
        socket.addEventListener("message", (event) => {
          if (!terminal) return;
          if (typeof event.data === "string") {
            terminal.write(event.data);
            return;
          }
          terminal.write(SHELL_OUTPUT_DECODER.decode(event.data as ArrayBuffer));
        });
        socket.addEventListener("close", () => setState((current) => ({ ...current, status: "closed" })));
        socket.addEventListener("error", () => setState((current) => ({ ...current, status: "closed" })));
      })
      .catch((error) => {
        if (canceled) return;
        showApiError(error);
        setState((current) => ({ ...current, status: "closed" }));
      });

    return () => {
      canceled = true;
      cleanup();
    };
  }, [fitTerminal, record.shellUrl]);

  useEffect(() => {
    if (state.dockState !== "normal") return;
    const snapHeight = !fitWithoutSnapRef.current;
    fitWithoutSnapRef.current = false;
    window.setTimeout(() => fitTerminal(snapHeight), 0);
  }, [fitTerminal, state.dockState, state.height, state.width]);

  useEffect(() => {
    const onWindowResize = () => {
      setState((current) => {
        if (current.isMaximized) return { ...current, ...getMaximizedRect() };
        return clampWindowToViewport(current);
      });
      window.setTimeout(() => fitTerminal(false), 0);
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [fitTerminal]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag) {
        setState((current) => ({ ...current, ...getDraggedWindowPosition(drag, event) }));
        return;
      }
      const resize = resizeRef.current;
      if (resize) {
        setState((current) => ({ ...current, ...getResizedWindowSize(resize, event) }));
      }
    };
    const stopPointerAction = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopPointerAction);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopPointerAction);
    };
  }, []);

  return (
    <>
      <FloatingWindow
        actions={(
          <WindowControls
            closeAriaLabel="关闭终端"
            isMaximized={state.isMaximized}
            maximizeAriaLabel="最大化终端"
            minimizeAriaLabel="最小化终端"
            onClose={onClose}
            onMaximize={toggleMaximize}
            onMinimize={minimize}
            restoreAriaLabel="还原终端大小"
          />
        )}
        dockState={state.dockState}
        icon={<SquareTerminal size={16} />}
        isMaximized={state.isMaximized}
        meta={state.status}
        rect={state}
        title={state.title}
        onHeaderPointerDown={(event) => {
          if (state.isMaximized) return;
          dragRef.current = beginWindowDrag(state, event);
        }}
        resizeHandle={(
          <div
            className="shell-resize-handle"
            onPointerDown={(event) => {
              if (state.isMaximized) return;
              resizeRef.current = beginWindowResize("shell", state, event);
            }}
          />
        )}
      >
        <div ref={terminalHostRef} className="shell-terminal" />
      </FloatingWindow>
      {state.dockState === "minimized" ? (
        <MinimizedWindowButton
          ariaLabel={`恢复终端 ${state.title}`}
          icon={<SquareTerminal size={20} />}
          onClick={restore}
          style={{ top: `calc(50% + ${dockIndex * 54}px)` }}
        />
      ) : null}
    </>
  );
}

function WindowControls({
  closeAriaLabel,
  isMaximized = false,
  maximizeAriaLabel,
  minimizeAriaLabel,
  onClose,
  onMaximize,
  onMinimize,
  restoreAriaLabel,
}: WindowControlsProps) {
  return (
    <>
      <Button icon={<Minus size={14} />} theme="borderless" type="tertiary" onClick={onMinimize} aria-label={minimizeAriaLabel} />
      {onMaximize ? (
        <Button icon={isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />} theme="borderless" type="tertiary" onClick={onMaximize} aria-label={isMaximized ? restoreAriaLabel : maximizeAriaLabel} />
      ) : null}
      <Button icon={<X size={14} />} theme="borderless" type="tertiary" onClick={onClose} aria-label={closeAriaLabel} />
    </>
  );
}

function FloatingWindow({
  actions,
  children,
  className,
  dockState,
  icon,
  isMaximized = false,
  meta,
  onHeaderPointerDown,
  rect,
  resizeHandle,
  title,
}: FloatingWindowProps) {
  return (
    <div className={buildWindowClassName(className, dockState, isMaximized)} style={buildWindowStyle(rect)}>
      <div className="shell-window-header" onPointerDown={onHeaderPointerDown}>
        <div className="shell-window-title">
          {icon}
          <span>{title}</span>
          <em>{meta}</em>
        </div>
        <div className="shell-window-actions" onPointerDown={(event) => event.stopPropagation()}>
          {actions}
        </div>
      </div>
      {children}
      {resizeHandle}
    </div>
  );
}

function MinimizedWindowButton({ ariaLabel, className, icon, onClick, style }: {
  ariaLabel: string;
  className?: string;
  icon: ReactNode;
  onClick: () => void;
  style?: CSSProperties;
}) {
  return (
    <button className={cx("shell-minimized-button", className)} style={style} type="button" onClick={onClick} aria-label={ariaLabel}>
      {icon}
    </button>
  );
}

function buildWindowClassName(className: string | undefined, dockState: DockState, isMaximized: boolean) {
  return cx(
    "shell-window",
    className,
    dockState === "minimized" && "shell-window-hidden",
    isMaximized && "shell-window-maximized",
  );
}

function beginWindowDrag(
  rect: Rect,
  event: ReactPointerEvent<HTMLDivElement>,
  options: { capturePointer?: boolean } = {},
): DragState {
  if (options.capturePointer) event.currentTarget.setPointerCapture(event.pointerId);
  return { x: rect.x, y: rect.y, startX: event.clientX, startY: event.clientY };
}

function beginWindowResize(
  target: ResizeState["target"],
  rect: Rect,
  event: ReactPointerEvent<HTMLDivElement>,
): ResizeState {
  event.currentTarget.setPointerCapture(event.pointerId);
  return { target, width: rect.width, height: rect.height, startX: event.clientX, startY: event.clientY };
}

function buildWindowStyle(rect: Rect) {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  } satisfies CSSProperties;
}

function snapShellHeightToRows(
  host: HTMLDivElement,
  terminal: Terminal,
  setShell: (value: (current: ShellWindowState) => ShellWindowState) => void,
) {
  const cellHeight = getTerminalCellHeight(terminal);
  if (!cellHeight || !terminal.element) return;

  const terminalStyle = window.getComputedStyle(terminal.element);
  const terminalPaddingY = cssNumber(terminalStyle, "padding-top") + cssNumber(terminalStyle, "padding-bottom");
  const visibleHostHeight = host.getBoundingClientRect().height;
  const targetHostHeight = Math.ceil((terminal.rows * cellHeight) + terminalPaddingY);
  const delta = targetHostHeight - visibleHostHeight;
  if (Math.abs(delta) < 1) return;

  setShell((current) => !current.isMaximized ? {
    ...current,
    height: clamp(current.height + delta, MIN_WINDOW_HEIGHT, window.innerHeight - 24),
  } : current);
}

function getTerminalCellHeight(terminal: Terminal) {
  const dimensions = (terminal as unknown as {
    _core?: { _renderService?: { dimensions?: { css?: { cell?: { height?: number } } } } };
  })._core?._renderService?.dimensions;
  const height = dimensions?.css?.cell?.height;
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : null;
}

function cssNumber(style: CSSStyleDeclaration, property: string) {
  const value = Number.parseFloat(style.getPropertyValue(property));
  return Number.isFinite(value) ? value : 0;
}
