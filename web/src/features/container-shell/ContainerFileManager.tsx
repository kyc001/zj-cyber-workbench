import { Button, Popconfirm, Tag, Toast, Tooltip } from "@douyinfe/semi-ui";
import {
  ArrowLeft, ArrowRight, ArrowUp, CircleAlert, Clipboard, ClipboardPaste,
  Copy, Download, File, FilePlus, Folder, FolderOpen, FolderPlus, Grid3X3, List,
  RefreshCw, Scissors, Trash2, Upload,
} from "lucide-react";
import { type CSSProperties, lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  copyContainerFiles, createContainerDirectory, deleteContainerFiles,
  downloadContainerFiles, listContainerFiles, moveContainerFiles, uploadContainerFiles, writeContainerFile,
} from "../../shared/api/sandboxContainers";
import { getApiErrorMessage, showApiError } from "../../shared/api/feedback";
import type { ContainerFileInfo } from "../../shared/api/types";
import { formatDateTime } from "../../shared/lib/date";
import { saveBlob } from "../../shared/lib/download";
import { formatBytes } from "../../shared/lib/number";
import { UI_TEXT } from "../../shared/lib/uiText";
import { cx } from "../../shared/lib/className";

const FileViewer = lazy(() => import("./FileViewer").then((module) => ({ default: module.FileViewer })));

type ViewMode = "list" | "icon";
type ClipboardState = { action: "copy" | "cut"; paths: string[]; sourceDir: string } | null;
const MAX_FILE_NAME_BYTES = 255;

function validateFileName(value: string, existingNames: ReadonlySet<string>) {
  const name = value.trim();
  if (!name) return "请输入名称";
  if (name === "." || name === "..") return "不能使用 . 或 .. 作为名称";
  if (/[/\u0000-\u001f\u007f]/.test(name)) return "名称不能包含 / 或控制字符";
  if (new TextEncoder().encode(name).length > MAX_FILE_NAME_BYTES) {
    return `名称不能超过 ${MAX_FILE_NAME_BYTES} 字节`;
  }
  if (existingNames.has(name)) return "当前目录已存在同名项目";
  return "";
}

type Props = {
  containerId: number;
  initialPath?: string;
  navigationKey?: number;
  onDirtyChange?: (dirty: boolean) => void;
};

export function ContainerFileManager({
  containerId,
  initialPath = "/",
  navigationKey = 0,
  onDirtyChange,
}: Props) {
  const [path, setPath] = useState(initialPath);
  const [files, setFiles] = useState<ContainerFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [clipboard, setClipboard] = useState<ClipboardState>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [pathHistory, setPathHistory] = useState<string[]>([initialPath]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [viewingFile, setViewingFile] = useState<ContainerFileInfo | null>(null);
  const [createType, setCreateType] = useState<"file" | "dir" | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const actionBusyRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      actionBusyRef.current = false;
    };
  }, []);

  const loadFiles = useCallback(async (dir: string): Promise<boolean> => {
    if (!mountedRef.current) return false;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setLoadError("");
    try {
      const response = await listContainerFiles(containerId, { path: dir });
      if (!mountedRef.current || requestIdRef.current !== requestId) return false;
      const fileList = response.data?.files ?? [];
      fileList.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(fileList);
      setPath(dir);
      setSelectedPaths(new Set());
      return true;
    } catch (error) {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setLoadError(getApiErrorMessage(error, "加载目录失败"));
      }
      return false;
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [containerId]);

  useEffect(() => {
    requestIdRef.current += 1;
    setPath(initialPath);
    setFiles([]);
    setLoadError("");
    setClipboard(null);
    setSelectedPaths(new Set());
    setPathHistory([initialPath]);
    setHistoryIndex(0);
    setViewingFile(null);
    setCreateType(null);
    void loadFiles(initialPath);
  }, [containerId, initialPath, loadFiles, navigationKey]);

  const navigateTo = useCallback(async (dir: string) => {
    if (dir === path) return;
    const loaded = await loadFiles(dir);
    if (!loaded) return;
    const newHistory = pathHistory.slice(0, historyIndex + 1);
    newHistory.push(dir);
    setPathHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [historyIndex, loadFiles, path, pathHistory]);

  const goBack = useCallback(async () => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const loaded = await loadFiles(pathHistory[newIndex]);
    if (!loaded) return;
    setHistoryIndex(newIndex);
  }, [historyIndex, loadFiles, pathHistory]);

  const goForward = useCallback(async () => {
    if (historyIndex >= pathHistory.length - 1) return;
    const newIndex = historyIndex + 1;
    const loaded = await loadFiles(pathHistory[newIndex]);
    if (!loaded) return;
    setHistoryIndex(newIndex);
  }, [historyIndex, loadFiles, pathHistory]);

  const goUp = useCallback(() => {
    if (path === "/") return;
    const parent = path.replace(/\/[^/]*$/, "") || "/";
    void navigateTo(parent);
  }, [path, navigateTo]);

  const refresh = useCallback(() => {
    void loadFiles(path);
  }, [path, loadFiles]);

  const runFileAction = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    if (!mountedRef.current || actionBusyRef.current) return false;
    actionBusyRef.current = true;
    setLoading(true);
    try {
      await action();
      return true;
    } catch (error) {
      if (mountedRef.current) showApiError(error);
      return false;
    } finally {
      actionBusyRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  const selectFile = useCallback((file: ContainerFileInfo, toggle: boolean) => {
    if (toggle) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(file.path)) next.delete(file.path);
        else next.add(file.path);
        return next;
      });
      return;
    }
    setSelectedPaths(new Set([file.path]));
  }, []);

  const openFileViewer = useCallback((file: ContainerFileInfo) => {
    setViewingFile(file);
  }, []);

  const handleFileDoubleClick = useCallback((file: ContainerFileInfo) => {
    if (file.type === "directory") {
      void navigateTo(file.path);
      return;
    }
    openFileViewer(file);
  }, [navigateTo, openFileViewer]);

  const handleCopy = useCallback(() => {
    if (selectedPaths.size === 0) return;
    setClipboard({ action: "copy", paths: Array.from(selectedPaths), sourceDir: path });
    Toast.success(`已复制 ${selectedPaths.size} 项`);
  }, [selectedPaths, path]);

  const handleCut = useCallback(() => {
    if (selectedPaths.size === 0) return;
    setClipboard({ action: "cut", paths: Array.from(selectedPaths), sourceDir: path });
    Toast.success(`已剪切 ${selectedPaths.size} 项`);
  }, [selectedPaths, path]);

  const handlePaste = useCallback(async () => {
    if (!clipboard) return;
    await runFileAction(async () => {
      if (clipboard.action === "copy") {
        await copyContainerFiles(containerId, { sources: clipboard.paths, destination: path });
      } else {
        await moveContainerFiles(containerId, { sources: clipboard.paths, destination: path });
        setClipboard(null);
      }
      Toast.success(`${clipboard.action === "copy" ? "已复制" : "已移动"} ${clipboard.paths.length} 项`);
      await loadFiles(path);
    });
  }, [clipboard, containerId, path, loadFiles, runFileAction]);

  const handleDelete = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    await runFileAction(async () => {
      await deleteContainerFiles(containerId, { paths: Array.from(selectedPaths) });
      Toast.success(`已删除 ${selectedPaths.size} 项`);
      await loadFiles(path);
    });
  }, [selectedPaths, containerId, path, loadFiles, runFileAction]);

  const startCreate = useCallback((type: "file" | "dir") => {
    setCreateType(type);
    setSelectedPaths(new Set());
  }, []);

  const handleCreateConfirm = useCallback(async (name: string) => {
    if (!createType) return;
    const normalizedName = name.trim();
    const validationError = validateFileName(
      normalizedName,
      new Set(files.map((file) => file.name)),
    );
    if (validationError) {
      Toast.warning(validationError);
      return;
    }
    const itemPath = path.replace(/\/$/, "") + "/" + normalizedName;
    const created = await runFileAction(async () => {
      if (createType === "dir") {
        await createContainerDirectory(containerId, { path: itemPath });
      } else {
        await writeContainerFile(containerId, { path: itemPath, content: "" });
      }
      Toast.success(createType === "dir" ? "文件夹已创建" : "文件已创建");
      await loadFiles(path);
    });
    if (created) setCreateType(null);
  }, [createType, containerId, files, path, loadFiles, runFileAction]);

  const handleCreateCancel = useCallback(() => {
    setCreateType(null);
  }, []);

  const handleUploadClick = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const handleUploadChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadFiles = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (uploadFiles.length === 0) return;

    await runFileAction(async () => {
      await uploadContainerFiles(containerId, path, uploadFiles, true);
      Toast.success(`已上传 ${uploadFiles.length} 个文件`);
      await loadFiles(path);
    });
  }, [containerId, path, loadFiles, runFileAction]);

  const handleDownload = useCallback(async () => {
    if (selectedPaths.size === 0) return;
    await runFileAction(async () => {
      const { blob, filename } = await downloadContainerFiles(containerId, { path: Array.from(selectedPaths) });
      saveBlob(blob, filename);
    });
  }, [containerId, selectedPaths, runFileAction]);

  const breadcrumbs = useMemo(() => {
    if (path === "/") return [{ label: "/", path: "/" }];
    const parts = path.split("/").filter(Boolean);
    return [
      { label: "/", path: "/" },
      ...parts.map((part, i) => ({
        label: part,
        path: "/" + parts.slice(0, i + 1).join("/"),
      })),
    ];
  }, [path]);
  const existingFileNames = useMemo(() => new Set(files.map((file) => file.name)), [files]);

  const toolbarDisabled = loading;
  const hasSelection = selectedPaths.size > 0;
  const canPaste = clipboard !== null && clipboard.sourceDir !== path;

  return (
    <div className="file-manager-body">
      <div className="file-manager-toolbar">
        <Button icon={<ArrowLeft size={15} />} theme="borderless" type="tertiary" disabled={historyIndex <= 0 || toolbarDisabled} onClick={() => void goBack()} aria-label="后退" />
        <Button icon={<ArrowRight size={15} />} theme="borderless" type="tertiary" disabled={historyIndex >= pathHistory.length - 1 || toolbarDisabled} onClick={() => void goForward()} aria-label="前进" />
        <Button icon={<ArrowUp size={15} />} theme="borderless" type="tertiary" disabled={path === "/" || toolbarDisabled} onClick={goUp} aria-label="上一级" />
        <Button icon={<RefreshCw size={15} />} theme="borderless" type="tertiary" disabled={toolbarDisabled} onClick={refresh} aria-label="刷新" />
        <span className="file-manager-separator" />
        <Button icon={<FilePlus size={15} />} theme="borderless" type="tertiary" disabled={toolbarDisabled || createType !== null} onClick={() => startCreate("file")} aria-label="新建文件" />
        <Button icon={<FolderPlus size={15} />} theme="borderless" type="tertiary" disabled={toolbarDisabled || createType !== null} onClick={() => startCreate("dir")} aria-label="新建文件夹" />
        <Tooltip content="上传文件">
          <Button icon={<Upload size={15} />} theme="borderless" type="tertiary" disabled={toolbarDisabled} onClick={handleUploadClick} aria-label="上传文件" />
        </Tooltip>
        <Tooltip content="下载所选项">
          <Button icon={<Download size={15} />} theme="borderless" type="tertiary" disabled={!hasSelection || toolbarDisabled} onClick={() => void handleDownload()} aria-label="下载所选项" />
        </Tooltip>
        <span className="file-manager-separator" />
        <Tooltip content="复制所选项">
          <Button icon={<Copy size={15} />} theme="borderless" type="tertiary" disabled={!hasSelection || toolbarDisabled} onClick={handleCopy} aria-label="复制" />
        </Tooltip>
        <Tooltip content="剪切所选项">
          <Button icon={<Scissors size={15} />} theme="borderless" type="tertiary" disabled={!hasSelection || toolbarDisabled} onClick={handleCut} aria-label="剪切" />
        </Tooltip>
        <Tooltip content={canPaste ? `粘贴 ${clipboard?.paths.length ?? 0} 项` : "没有可粘贴内容"}>
          <Button icon={<ClipboardPaste size={15} />} theme="borderless" type="tertiary" disabled={!canPaste || toolbarDisabled} onClick={() => void handlePaste()} aria-label="粘贴" />
        </Tooltip>
        <Popconfirm title="删除所选项" content={`确定删除所选 ${selectedPaths.size} 项？`} okType="danger" cancelText={UI_TEXT.cancel} onConfirm={() => void handleDelete()}>
          <Button icon={<Trash2 size={15} />} theme="borderless" type="danger" disabled={!hasSelection || toolbarDisabled} aria-label="删除" />
        </Popconfirm>
        <span className="file-manager-separator" />
        <Tooltip content="列表视图">
          <Button icon={<List size={15} />} theme="borderless" type={viewMode === "list" ? "primary" : "tertiary"} disabled={toolbarDisabled} onClick={() => setViewMode("list")} aria-label="列表视图" />
        </Tooltip>
        <Tooltip content="图标视图">
          <Button icon={<Grid3X3 size={15} />} theme="borderless" type={viewMode === "icon" ? "primary" : "tertiary"} disabled={toolbarDisabled} onClick={() => setViewMode("icon")} aria-label="图标视图" />
        </Tooltip>
      </div>
      <input ref={uploadInputRef} className="file-manager-upload-input" type="file" multiple onChange={(event) => void handleUploadChange(event)} />

      <div className="file-manager-breadcrumb">
        {breadcrumbs.map((crumb, i) => (
          <span key={crumb.path}>
            {i > 1 && <span className="file-manager-breadcrumb-sep">/</span>}
            <button type="button" className="file-manager-breadcrumb-item" onClick={() => void navigateTo(crumb.path)}>
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {loadError ? (
        <div className="file-manager-load-error" role="alert">
          <CircleAlert size={15} aria-hidden="true" />
          <span>{loadError}</span>
          <Button
            icon={<RefreshCw size={13} />}
            size="small"
            theme="borderless"
            type="danger"
            disabled={loading}
            onClick={refresh}
          >
            重试
          </Button>
        </div>
      ) : null}

      {viewMode === "list" ? (
        <div className="file-manager-list">
          <FileListHeader />
          {createType && (
            <InlineCreateRow
              type={createType}
              existingNames={existingFileNames}
              onConfirm={handleCreateConfirm}
              onCancel={handleCreateCancel}
            />
          )}
          {files.length === 0 && !createType ? (
            <div className="file-manager-empty">{loading ? "正在加载..." : "此目录为空"}</div>
          ) : (
            files.map((file) => (
              <FileListRow
                key={file.path}
                file={file}
                selected={selectedPaths.has(file.path)}
                onSelect={(toggle) => selectFile(file, toggle)}
                onOpen={() => handleFileDoubleClick(file)}
              />
            ))
          )}
        </div>
      ) : (
        <div className="file-manager-icons">
          {createType && (
            <InlineCreateIcon
              type={createType}
              existingNames={existingFileNames}
              onConfirm={handleCreateConfirm}
              onCancel={handleCreateCancel}
            />
          )}
          {files.length === 0 && !createType ? (
            <div className="file-manager-empty">{loading ? "正在加载..." : "此目录为空"}</div>
          ) : (
            files.map((file) => (
              <FileIconItem
                key={file.path}
                file={file}
                selected={selectedPaths.has(file.path)}
                onSelect={(toggle) => selectFile(file, toggle)}
                onOpen={() => handleFileDoubleClick(file)}
              />
            ))
          )}
        </div>
      )}

      <div className="file-manager-statusbar">
        <span>{files.length} 项{selectedPaths.size ? `，已选择 ${selectedPaths.size} 项` : ""}</span>
        {clipboard && (
          <span className="file-manager-clipboard-hint">
            <Clipboard size={12} /> {clipboard.action === "cut" ? "已剪切" : "已复制"} {clipboard.paths.length} 项 - <button type="button" onClick={() => setClipboard(null)}>清除</button>
          </span>
        )}
        {!clipboard ? <span>双击打开文件或目录</span> : null}
      </div>

      {viewingFile ? (
        <div className="file-manager-viewer-overlay">
          <Suspense fallback={<div className="file-manager-loading">正在加载查看器...</div>}>
            <FileViewer
              containerId={containerId}
              file={viewingFile}
              onClose={() => setViewingFile(null)}
              onDirtyChange={onDirtyChange}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}


const FILE_LIST_GRID_STYLE: CSSProperties = {
  gridTemplateColumns: "minmax(0, 1.2fr) 92px 168px 92px",
};

function FileListHeader() {
  return (
    <div className="file-manager-list-row file-manager-list-head" style={FILE_LIST_GRID_STYLE}>
      <div>名称</div>
      <div>大小</div>
      <div>修改时间</div>
      <div>权限</div>
    </div>
  );
}

function FileListRow({ file, selected, onSelect, onOpen }: {
  file: ContainerFileInfo;
  selected: boolean;
  onSelect: (toggle: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={cx("file-manager-list-row", selected && "file-manager-list-row-selected")}
      style={FILE_LIST_GRID_STYLE}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={(event) => onSelect(event.ctrlKey || event.metaKey)}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen();
        } else if (event.key === " ") {
          event.preventDefault();
          onSelect(event.ctrlKey || event.metaKey);
        }
      }}
    >
      <div className="file-manager-name">
        {file.type === "directory" ? <Folder size={15} /> : file.type === "symlink" ? <File size={15} /> : <File size={15} />}
        <span>{file.name}</span>
      </div>
      <div className="file-manager-cell-muted">{file.type === "directory" ? "—" : formatBytes(file.size)}</div>
      <div className="file-manager-cell-muted">{formatDateTime(new Date(file.modified_at * 1000).toISOString())}</div>
      <div><Tag size="small">{file.permissions}</Tag></div>
    </div>
  );
}

function FileIconItem({ file, selected, onSelect, onOpen }: {
  file: ContainerFileInfo;
  selected: boolean;
  onSelect: (toggle: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <div
      className={cx("file-manager-icon-item", selected && "file-manager-icon-item-selected")}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={(event) => onSelect(event.ctrlKey || event.metaKey)}
      onDoubleClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onOpen();
        } else if (event.key === " ") {
          event.preventDefault();
          onSelect(event.ctrlKey || event.metaKey);
        }
      }}
      title={file.name}
    >
      {file.type === "directory" ? <FolderOpen size={32} /> : <File size={32} />}
      <span>{file.name}</span>
    </div>
  );
}

function InlineCreateInput({ type, existingNames, onConfirm, onCancel, cancelOnBlur = false }: {
  type: "file" | "dir";
  existingNames: ReadonlySet<string>;
  onConfirm: (name: string) => void;
  onCancel: () => void;
  cancelOnBlur?: boolean;
}) {
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commit = () => {
    const validationError = validateFileName(name, existingNames);
    if (validationError) {
      setAttempted(true);
      return;
    }
    onConfirm(name.trim());
  };
  const validationError = validateFileName(name, existingNames);
  const visibleError = Boolean(validationError && (attempted || name.length > 0));

  return (
    <div className="file-manager-inline-field">
      <input
        ref={inputRef}
        className="file-manager-inline-input"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (attempted) setAttempted(false);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={cancelOnBlur ? () => onCancel() : undefined}
        placeholder={type === "dir" ? "新建文件夹" : "新建文件"}
        aria-invalid={visibleError}
        aria-describedby={visibleError ? errorId : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {visibleError ? (
        <span id={errorId} className="file-manager-inline-error" role="alert">
          {validationError}
        </span>
      ) : null}
    </div>
  );
}

function InlineCreateRow({ type, existingNames, onConfirm, onCancel }: {
  type: "file" | "dir";
  existingNames: ReadonlySet<string>;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {

  return (
    <div
      className="file-manager-list-row file-manager-create-row"
      style={FILE_LIST_GRID_STYLE}
    >
      <div className="file-manager-name">
        {type === "dir" ? <Folder size={15} /> : <File size={15} />}
        <InlineCreateInput
          type={type}
          existingNames={existingNames}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </div>
      <div className="file-manager-cell-muted">—</div>
      <div className="file-manager-cell-muted">—</div>
      <div className="file-manager-cell-muted">—</div>
    </div>
  );
}

function InlineCreateIcon({ type, existingNames, onConfirm, onCancel }: {
  type: "file" | "dir";
  existingNames: ReadonlySet<string>;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="file-manager-icon-item file-manager-create-row">
      {type === "dir" ? <FolderOpen size={32} /> : <File size={32} />}
      <InlineCreateInput
        type={type}
        existingNames={existingNames}
        onConfirm={onConfirm}
        onCancel={onCancel}
        cancelOnBlur
      />
    </div>
  );
}
