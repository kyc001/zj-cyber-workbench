import { Button, Popconfirm, Toast } from "@douyinfe/semi-ui";
import { Download, Edit3, RefreshCw, Save, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { downloadContainerFiles, readContainerFile, writeContainerFile } from "../../shared/api/sandboxContainers";
import { getApiErrorMessage, showApiError } from "../../shared/api/feedback";
import type { ContainerFileInfo } from "../../shared/api/types";
import { saveBlob } from "../../shared/lib/download";
import { UI_TEXT } from "../../shared/lib/uiText";

const CodeEditor = lazy(() => import("./CodeEditor").then((module) => ({ default: module.CodeEditor })));

type ViewerType = "text" | "image" | "binary";

type Props = {
  containerId: number;
  file: ContainerFileInfo;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "xml", "yaml", "yml", "toml", "ini", "cfg",
  "conf", "log", "csv", "tsv", "env", "gitignore", "dockerignore", "editorconfig",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "pyx", "go", "rs", "java", "c",
  "cpp", "cc", "cxx", "h", "hpp", "hh", "hxx", "sh", "bash", "zsh", "fish",
  "ps1", "bat", "cmd", "Makefile", "Dockerfile", "sql", "html", "htm", "css",
  "scss", "less", "vue", "svelte", "graphql", "gql", "proto", "tf", "tfvars",
  "rb", "php", "swift", "kt", "scala", "lua", "r", "pl", "pm", "patch", "diff",
  "lock", "nix", "ex", "exs", "erl", "hs", "elm", "nim", "zig", "v", "wren",
  "rst", "tex", "bib", "cfg", "cnf", "service", "socket", "timer", "desktop",
  "svg",
]);

const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "tif", "avif",
]);

const IMAGE_MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", ico: "image/x-icon", bmp: "image/bmp",
  tiff: "image/tiff", tif: "image/tiff", avif: "image/avif",
};

function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

function determineViewerType(file: ContainerFileInfo): ViewerType {
  if (file.type === "directory") return "binary";
  const e = ext(file.name);
  if (IMAGE_EXTENSIONS.has(e)) return "image";
  if (TEXT_EXTENSIONS.has(e)) return "text";
  // heuristic: if size < 1MB and no null bytes → treat as text, else binary
  if (file.size > 1_000_000) return "binary";
  return "text";
}

export function FileViewer({ containerId, file, onClose, onDirtyChange }: Props) {
  const titleId = useId();
  const viewerType = useMemo(() => determineViewerType(file), [file]);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const savingRef = useRef(false);
  const downloadingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mountedRef.current = true;
    dialogRef.current?.focus();
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      savingRef.current = false;
      downloadingRef.current = false;
      previouslyFocused?.focus();
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    setEditing(false);
    setEditContent("");
    setContent("");
    setImageError(false);

    if (viewerType === "binary") {
      setLoading(false);
      return;
    }

    try {
      const params: { path: string; base64?: boolean } = { path: file.path };
      if (viewerType === "image") params.base64 = true;
      const response = await readContainerFile(containerId, params);
      if (!mountedRef.current || requestIdRef.current !== requestId) return;
      setContent(response.data?.content ?? "");
    } catch (err) {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setError(getApiErrorMessage(err, "读取文件失败"));
      }
    } finally {
      if (mountedRef.current && requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [containerId, file.path, viewerType]);

  useEffect(() => { void load(); }, [load]);

  const imageSrc = useMemo(() => {
    if (viewerType !== "image" || !content) return "";
    const mime = IMAGE_MIME[ext(file.name)] || "image/png";
    // content may include newlines from base64; strip them for data URI
    return `data:${mime};base64,${content.replace(/\s/g, "")}`;
  }, [viewerType, content, file.name]);

  const lineCount = useMemo(() => {
    if (viewerType !== "text" || !content) return 0;
    return content.split("\n").length;
  }, [viewerType, content]);

  const dirty = editing && editContent !== content;

  useEffect(() => {
    if (!dirty) return;
    const preventAccidentalUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventAccidentalUnload);
    return () => window.removeEventListener("beforeunload", preventAccidentalUnload);
  }, [dirty]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const handleEdit = useCallback(() => {
    setEditContent(content);
    setEditing(true);
  }, [content]);

  const handleSave = useCallback(async () => {
    if (!mountedRef.current || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await writeContainerFile(containerId, { path: file.path, content: editContent });
      if (!mountedRef.current) return;
      Toast.success("文件已保存");
      setContent(editContent);
      setEditing(false);
    } catch (err) {
      if (mountedRef.current) showApiError(err);
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [containerId, file.path, editContent]);

  const handleCancelEdit = useCallback(() => {
    setEditContent("");
    setEditing(false);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!mountedRef.current || downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloading(true);
    try {
      const { blob, filename } = await downloadContainerFiles(containerId, { path: [file.path] });
      if (!mountedRef.current) return;
      saveBlob(blob, filename);
    } catch (err) {
      if (mountedRef.current) showApiError(err);
    } finally {
      downloadingRef.current = false;
      if (mountedRef.current) setDownloading(false);
    }
  }, [containerId, file.path]);

  const handleDiscardAndClose = useCallback(() => {
    setEditContent("");
    setEditing(false);
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editing) {
      event.preventDefault();
      event.stopPropagation();
      if (dirty && !savingRef.current && !downloadingRef.current) {
        void handleSave();
      }
      return;
    }
    if (event.key !== "Escape") return;
    event.stopPropagation();
    if (savingRef.current || downloadingRef.current) return;
    if (dirty) {
      Toast.warning("存在未保存的修改，请先保存或取消编辑");
      return;
    }
    if (editing) {
      handleCancelEdit();
      return;
    }
    onClose();
  }, [dirty, editing, handleCancelEdit, handleSave, onClose]);

  const closeButton = (
    <Button
      icon={<X size={14} />}
      theme="borderless"
      size="small"
      type="tertiary"
      disabled={saving || downloading}
      onClick={dirty ? undefined : onClose}
      aria-label="关闭文件查看器"
    >
      关闭
    </Button>
  );

  return (
    <div
      ref={dialogRef}
      className="fv-body"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <div className="fv-toolbar">
        <span id={titleId} className="fv-title">{file.name}</span>
        <span className="fv-meta">
          {viewerType === "text" ? "文本" : viewerType === "image" ? "图片" : "二进制"}
          {" · "}{file.size.toLocaleString()} 字节
          {viewerType === "text" && !loading && !error ? ` · ${lineCount} 行` : ""}
        </span>
        <span className="fv-spacer" />
        {viewerType === "text" && !editing && (
          <Button
            icon={<Edit3 size={14} />}
            theme="borderless"
            type="tertiary"
            size="small"
            disabled={loading || Boolean(error) || downloading}
            title={loading ? "文件加载完成后可编辑" : error ? "请先重新加载文件" : "编辑文件"}
            onClick={handleEdit}
          >
            编辑
          </Button>
        )}
        {!editing && (
          <Button
            icon={<Download size={14} />}
            theme="borderless"
            type="tertiary"
            size="small"
            loading={downloading}
            disabled={loading}
            onClick={() => void handleDownload()}
          >
            下载
          </Button>
        )}
        {dirty ? (
          <Popconfirm
            title="放弃未保存的修改？"
            content="关闭后，本次编辑内容将无法恢复。"
            okType="danger"
            okText="放弃并关闭"
            cancelText={UI_TEXT.cancel}
            onConfirm={handleDiscardAndClose}
          >
            {closeButton}
          </Popconfirm>
        ) : closeButton}
      </div>

      {loading ? (
        <div className="fv-loading">正在加载...</div>
      ) : error ? (
        <div className="fv-error" role="alert">
          <span>{error}</span>
          <Button
            icon={<RefreshCw size={14} />}
            size="small"
            theme="borderless"
            type="primary"
            onClick={() => void load()}
          >
            重试
          </Button>
        </div>
      ) : viewerType === "image" ? (
        <div className="fv-image-viewer">
          {imageSrc && !imageError ? (
            <img
              src={imageSrc}
              alt={file.name}
              className="fv-image"
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="fv-error" role="alert">
              <span>图片内容无法解码，请重新加载或下载后查看。</span>
              <Button
                icon={<RefreshCw size={14} />}
                size="small"
                theme="borderless"
                type="primary"
                onClick={() => void load()}
              >
                重新加载
              </Button>
            </div>
          )}
        </div>
      ) : viewerType === "text" ? (
        editing ? (
          <div className="fv-editor">
            <div className="fv-editor-cm">
              <Suspense fallback={<div className="fv-loading">正在加载编辑器...</div>}>
                <CodeEditor
                  value={editContent}
                  onChange={setEditContent}
                  filename={file.name}
                />
              </Suspense>
            </div>
            <div className="fv-editor-actions">
              <Button
                icon={<Save size={14} />}
                size="small"
                type="primary"
                loading={saving}
                disabled={!dirty || downloading}
                aria-keyshortcuts="Control+S Meta+S"
                title="保存（Ctrl/⌘ + S）"
                onClick={() => void handleSave()}
              >
                保存
              </Button>
              {dirty ? (
                <Popconfirm
                  title="放弃未保存的修改？"
                  content="取消后，本次编辑内容将无法恢复。"
                  okType="danger"
                  okText="放弃修改"
                  cancelText={UI_TEXT.cancel}
                  onConfirm={handleCancelEdit}
                >
                  <Button icon={<X size={14} />} size="small" type="tertiary" disabled={saving}>取消</Button>
                </Popconfirm>
              ) : (
                <Button icon={<X size={14} />} size="small" type="tertiary" disabled={saving} onClick={handleCancelEdit}>取消</Button>
              )}
            </div>
          </div>
        ) : (
          <div className="fv-preview">
            <Suspense fallback={<div className="fv-loading">正在加载预览...</div>}>
              <CodeEditor
                value={content}
                readOnly
                filename={file.name}
              />
            </Suspense>
          </div>
        )
      ) : (
        <div className="fv-binary">
          <div className="fv-binary-icon" />
          <p>二进制文件无法预览</p>
          <span>{file.size.toLocaleString()} 字节</span>
        </div>
      )}
    </div>
  );
}
