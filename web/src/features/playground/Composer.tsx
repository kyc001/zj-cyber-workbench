import { Button, Popconfirm, TextArea, Toast } from "@douyinfe/semi-ui";
import { AtSign, FileText, LoaderCircle, OctagonX, Paperclip, Send, Square, X } from "lucide-react";
import {
  ClipboardEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
} from "react";
import { AgentPicker } from "./AgentPicker";
import type { AgentImageInputPart, AgentInfo, AgentInputPart } from "../../shared/api/types";
import { cx } from "../../shared/lib/className";
import { formatBytes } from "../../shared/lib/number";
import { UI_TEXT } from "../../shared/lib/uiText";
import {
  deleteComposerTextDraft,
  loadComposerTextDrafts,
  saveComposerTextDraft,
} from "./composerDraftStorage";
import { subscribeComposerDraftDiscard } from "./composerDraftLifecycle";

type ComposerProps = {
  draftKey: string;
  streaming: boolean;
  disabled?: boolean;
  disabledReason?: string;
  agents: AgentInfo[];
  activeAgentCode: string;
  agentSwitchDisabled?: boolean;
  canCancelAll?: boolean;
  onPickAgent: (code: string) => void;
  onSend: (content: AgentInputPart[], files: File[]) => Promise<boolean>;
  onInterrupt: () => void;
  onCancelAll: () => void;
};

type ComposerDraft = {
  text: string;
  images: AgentImageInputPart[];
  files: File[];
};

const IMAGE_MEDIA_TYPE_BY_EXTENSION: Record<string, AgentImageInputPart["media_type"]> = {
  ".jfif": "image/jpeg",
  ".jpe": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 3.75 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_FILES = 8;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 64 * 1024 * 1024;
const DRAFT_SAVE_DELAY_MS = 250;
// File objects cannot be serialized safely. Keep attachment drafts at module
// scope so normal SPA route changes do not discard them; a full page unload is
// guarded separately below.
const COMPOSER_DRAFT_CACHE = new Map<string, ComposerDraft>();
const discardedComposerDraftKeys = new Set<string>();
const composerAttachmentListeners = new Set<(draftKey: string, draft: ComposerDraft) => void>();
const attachmentProcessingListeners = new Set<(draftKey: string, pending: number) => void>();
let composerDraftCacheHydrated = false;
// A slow image read belongs to the draft where it started. Keeping counts per
// draft prevents an unrelated conversation from inheriting its send lock.
const pendingAttachmentReadCounts = new Map<string, number>();
let attachmentUnloadProtectionActive = false;

subscribeComposerDraftDiscard((draftKey) => {
  discardedComposerDraftKeys.add(draftKey);
  COMPOSER_DRAFT_CACHE.delete(draftKey);
  const persistedDrafts = loadComposerTextDrafts();
  deleteComposerTextDraft(persistedDrafts, draftKey);
  syncAttachmentUnloadProtection();
});

export function Composer({
  draftKey,
  streaming,
  disabled = false,
  disabledReason = "",
  agents,
  activeAgentCode,
  agentSwitchDisabled = false,
  canCancelAll = false,
  onPickAgent,
  onSend,
  onInterrupt,
  onCancelAll,
}: ComposerProps) {
  const persistedDraftsRef = useRef<Map<string, string> | null>(null);
  if (persistedDraftsRef.current === null) {
    persistedDraftsRef.current = loadComposerTextDrafts();
  }
  if (!composerDraftCacheHydrated) {
    for (const [key, draftText] of persistedDraftsRef.current) {
      if (!COMPOSER_DRAFT_CACHE.has(key)) {
        COMPOSER_DRAFT_CACHE.set(key, { text: draftText, images: [], files: [] });
      }
    }
    composerDraftCacheHydrated = true;
  }
  const draftsRef = useRef(COMPOSER_DRAFT_CACHE);
  const initialDraft = getComposerDraft(draftsRef.current, persistedDraftsRef.current, draftKey);
  const [text, setText] = useState(initialDraft.text);
  const [images, setImages] = useState<AgentImageInputPart[]>(initialDraft.images);
  const [files, setFiles] = useState<File[]>(initialDraft.files);
  const [dragging, setDragging] = useState(false);
  const [processingAttachments, setProcessingAttachments] = useState(
    getPendingAttachmentReads(draftKey),
  );
  const [submitting, setSubmitting] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const agentPickerId = useId();

  const wrapperRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const draftSaveTimerRef = useRef<number | null>(null);
  const activeDraftKeyRef = useRef(draftKey);
  const submittingRef = useRef(false);
  const textRef = useRef(text);
  const imagesRef = useRef(images);
  const filesRef = useRef(files);
  textRef.current = text;
  imagesRef.current = images;
  filesRef.current = files;

  const persistTextDraft = useCallback((key: string, value: string, immediate = false) => {
    if (draftSaveTimerRef.current != null) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    const persist = () => {
      draftSaveTimerRef.current = null;
      saveComposerTextDraft(persistedDraftsRef.current!, key, value);
    };
    if (immediate) {
      persist();
      return;
    }
    draftSaveTimerRef.current = window.setTimeout(persist, DRAFT_SAVE_DELAY_MS);
  }, []);

  const handleTextChange = useCallback((value: string) => {
    const key = activeDraftKeyRef.current;
    const draft = getComposerDraft(draftsRef.current, persistedDraftsRef.current!, key);
    draftsRef.current.set(key, {
      ...draft,
      text: value,
      images: imagesRef.current,
      files: filesRef.current,
    });
    setText(value);
    textRef.current = value;
    persistTextDraft(key, value);
  }, [persistTextDraft]);

  const activeAgent = useMemo(
    () => agents.find((agent) => agent.code === activeAgentCode) ?? null,
    [agents, activeAgentCode],
  );

  useEffect(() => {
    if (!pickerOpen) return;
    if (highlight >= agents.length) {
      setHighlight(Math.max(0, agents.length - 1));
    }
  }, [agents.length, highlight, pickerOpen]);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    setHighlight(0);
  }, []);

  useEffect(() => {
    const previousKey = activeDraftKeyRef.current;
    if (previousKey === draftKey) return;

    draftsRef.current.set(previousKey, { text, images, files });
    syncAttachmentUnloadProtection();
    persistTextDraft(previousKey, text, true);
    const nextDraft = getComposerDraft(draftsRef.current, persistedDraftsRef.current!, draftKey);
    textRef.current = nextDraft?.text ?? "";
    imagesRef.current = nextDraft?.images ?? [];
    filesRef.current = nextDraft?.files ?? [];
    setText(nextDraft?.text ?? "");
    setImages(nextDraft?.images ?? []);
    setFiles(nextDraft?.files ?? []);
    setProcessingAttachments(getPendingAttachmentReads(draftKey));
    setDragging(false);
    closePicker();
    activeDraftKeyRef.current = draftKey;
  // The current state is intentionally captured only when the identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closePicker, draftKey, persistTextDraft]);

  useEffect(() => () => {
    if (draftSaveTimerRef.current != null) {
      window.clearTimeout(draftSaveTimerRef.current);
    }
    saveComposerTextDraft(
      persistedDraftsRef.current!,
      activeDraftKeyRef.current,
      textRef.current,
    );
    const activeKey = activeDraftKeyRef.current;
    draftsRef.current.set(activeKey, {
      text: textRef.current,
      images: imagesRef.current,
      files: filesRef.current,
    });
    syncAttachmentUnloadProtection();
  }, []);

  useEffect(() => {
    const syncVisibleAttachments = (changedKey: string, draft: ComposerDraft) => {
      if (changedKey !== activeDraftKeyRef.current) return;
      imagesRef.current = draft.images;
      filesRef.current = draft.files;
      setImages(draft.images);
      setFiles(draft.files);
    };
    composerAttachmentListeners.add(syncVisibleAttachments);
    const activeKey = activeDraftKeyRef.current;
    const activeDraft = draftsRef.current.get(activeKey);
    if (activeDraft) syncVisibleAttachments(activeKey, activeDraft);
    return () => {
      composerAttachmentListeners.delete(syncVisibleAttachments);
    };
  }, []);

  useEffect(() => {
    const syncProcessingCount = (changedKey: string, pending: number) => {
      if (changedKey === activeDraftKeyRef.current) setProcessingAttachments(pending);
    };
    attachmentProcessingListeners.add(syncProcessingCount);
    const activeKey = activeDraftKeyRef.current;
    syncProcessingCount(activeKey, getPendingAttachmentReads(activeKey));
    return () => {
      attachmentProcessingListeners.delete(syncProcessingCount);
    };
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && wrapperRef.current?.contains(target)) return;
      closePicker();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [closePicker, pickerOpen]);

  const focusTextarea = useCallback(() => {
    wrapperRef.current?.querySelector("textarea")?.focus();
  }, []);

  const submit = async () => {
    const hasText = text.trim().length > 0;
    if (
      (!hasText && images.length === 0 && files.length === 0)
      || streaming
      || disabled
      || submittingRef.current
      || processingAttachments > 0
    ) return;
    const content: AgentInputPart[] = [
      ...(hasText ? [{ type: "text" as const, text }] : []),
      ...images,
    ];
    const submissionDraftKey = activeDraftKeyRef.current;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const sent = await onSend(content, files);
      if (!sent) return;
      draftsRef.current.delete(submissionDraftKey);
      syncAttachmentUnloadProtection();
      if (draftSaveTimerRef.current != null) {
        window.clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      deleteComposerTextDraft(persistedDraftsRef.current!, submissionDraftKey);
      if (activeDraftKeyRef.current === submissionDraftKey) {
        textRef.current = "";
        imagesRef.current = [];
        filesRef.current = [];
        setText("");
        setImages([]);
        setFiles([]);
        closePicker();
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const addImageFiles = useCallback(async (selectedFiles: File[], targetDraftKey: string) => {
    const imageFiles = selectedFiles.filter((file) => getImageMediaType(file) !== null);
    if (!imageFiles.length) return;
    let duplicateCount = 0;
    let reachedLimit = false;
    updatePendingAttachmentReads(targetDraftKey, 1);
    try {
      for (const file of imageFiles) {
        if (file.size > MAX_IMAGE_BYTES) {
          Toast.warning(`${file.name} 超过 3.75 MB，已跳过`);
          continue;
        }
        try {
          const imagePart = await fileToImagePart(file);
          if (discardedComposerDraftKeys.has(targetDraftKey)) break;
          const draft = getComposerDraft(draftsRef.current, persistedDraftsRef.current!, targetDraftKey);
          const currentImages = draft.images;
          if (currentImages.some((image) => (
            image.media_type === imagePart.media_type && image.data === imagePart.data
          ))) {
            duplicateCount += 1;
            continue;
          }
          if (currentImages.length >= MAX_IMAGES) {
            reachedLimit = true;
            break;
          }
          const currentBytes = currentImages.reduce(
            (total, image) => total + base64DecodedSize(image.data),
            0,
          );
          if (currentBytes + file.size > MAX_TOTAL_IMAGE_BYTES) {
            Toast.warning("图片总大小超过 6 MB，部分图片已跳过");
            continue;
          }
          const nextImages = [...currentImages, imagePart];
          publishComposerAttachments(targetDraftKey, { ...draft, images: nextImages });
        } catch {
          Toast.error(`读取 ${file.name} 失败`);
        }
      }
    } finally {
      updatePendingAttachmentReads(targetDraftKey, -1);
    }
    if (duplicateCount > 0) Toast.warning(`已跳过 ${duplicateCount} 张重复图片`);
    if (reachedLimit) Toast.warning(`最多允许上传 ${MAX_IMAGES} 张图片，其余图片已跳过`);
  }, []);

  const addRegularFiles = useCallback((selectedFiles: File[], targetDraftKey: string) => {
    if (!selectedFiles.length) return;
    const draft = getComposerDraft(draftsRef.current, persistedDraftsRef.current!, targetDraftKey);
    const currentFiles = draft.files;
    if (currentFiles.length >= MAX_FILES) {
      Toast.warning(`最多允许上传 ${MAX_FILES} 个文件`);
      return;
    }
    const currentBytes = currentFiles.reduce((total, file) => total + file.size, 0);
    const identities = new Set(currentFiles.map(fileIdentity));
    let nextBytes = 0;
    let duplicateCount = 0;
    let reachedLimit = false;
    const next: File[] = [];
    for (const file of selectedFiles) {
      const identity = fileIdentity(file);
      if (identities.has(identity)) {
        duplicateCount += 1;
        continue;
      }
      if (currentFiles.length + next.length >= MAX_FILES) {
        reachedLimit = true;
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        Toast.warning(`${file.name} 超过 32 MB，已跳过`);
        continue;
      }
      if (currentBytes + nextBytes + file.size > MAX_TOTAL_FILE_BYTES) {
        Toast.warning("文件总大小超过 64 MB，部分文件已跳过");
        continue;
      }
      next.push(file);
      nextBytes += file.size;
      identities.add(identity);
    }
    if (duplicateCount > 0) Toast.warning(`已跳过 ${duplicateCount} 个重复文件`);
    if (reachedLimit) Toast.warning(`一次消息最多附加 ${MAX_FILES} 个文件`);
    if (!next.length) return;
    const nextFiles = [...currentFiles, ...next];
    publishComposerAttachments(targetDraftKey, { ...draft, files: nextFiles });
  }, []);

  const addSelectedFiles = useCallback(async (selectedFiles: File[]) => {
    const targetDraftKey = activeDraftKeyRef.current;
    const imageFiles = selectedFiles.filter((file) => getImageMediaType(file) !== null);
    const regularFiles = selectedFiles.filter((file) => getImageMediaType(file) === null);
    addRegularFiles(regularFiles, targetDraftKey);
    await addImageFiles(imageFiles, targetDraftKey);
  }, [addImageFiles, addRegularFiles]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    // Rich clipboard payloads may contain both useful plain text and files.
    // Keep the browser's normal text insertion in that case; a file-only
    // payload has no meaningful textarea default and can be consumed safely.
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    void addSelectedFiles(files);
  }, [addSelectedFiles]);

  useEffect(() => {
    const resetDragging = () => setDragging(false);
    const handleDocumentDragOver = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      const blockedTarget = isAttachmentDropBlocked(event.target);
      const canAccept = !blockedTarget && !disabled && !streaming && !submitting;
      if (event.dataTransfer) event.dataTransfer.dropEffect = canAccept ? "copy" : "none";
      setDragging(canAccept);
    };
    const handleDocumentDragLeave = (event: globalThis.DragEvent) => {
      if (event.relatedTarget === null) resetDragging();
    };
    const handleDocumentDrop = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event.dataTransfer)) return;
      event.preventDefault();
      resetDragging();
      if (isAttachmentDropBlocked(event.target)) {
        Toast.warning("请关闭当前弹窗或工具窗口后，再将文件添加到消息");
        return;
      }
      if (submitting) {
        Toast.warning("消息正在发送，请稍后再添加附件");
        return;
      }
      if (streaming) {
        Toast.warning("正在生成回复，请停止或等待完成后再添加附件");
        return;
      }
      if (disabled) {
        Toast.warning(disabledReason || "当前暂时无法添加附件");
        return;
      }
      const droppedFiles = Array.from(event.dataTransfer?.files ?? []);
      if (droppedFiles.length) void addSelectedFiles(droppedFiles);
    };

    document.addEventListener("dragover", handleDocumentDragOver);
    document.addEventListener("dragleave", handleDocumentDragLeave);
    document.addEventListener("drop", handleDocumentDrop);
    window.addEventListener("dragend", resetDragging);
    window.addEventListener("blur", resetDragging);
    return () => {
      document.removeEventListener("dragover", handleDocumentDragOver);
      document.removeEventListener("dragleave", handleDocumentDragLeave);
      document.removeEventListener("drop", handleDocumentDrop);
      window.removeEventListener("dragend", resetDragging);
      window.removeEventListener("blur", resetDragging);
    };
  }, [addSelectedFiles, disabled, disabledReason, streaming, submitting]);

  const pickAgent = (agent: AgentInfo) => {
    if (agentSwitchDisabled) return;
    onPickAgent(agent.code);
    closePicker();
    focusTextarea();
  };

  const toggleChip = () => {
    if (agentPickerDisabled) return;
    setPickerOpen((next) => !next);
    focusTextarea();
  };

  const agentSwitchDisabledReason = "请先完成或取消正在运行的子智能体任务，再切换智能体";
  const agentPickerDisabled = agentSwitchDisabled || agents.length === 0;
  const agentPickerDisabledReason = agentSwitchDisabled
    ? agentSwitchDisabledReason
    : agents.length === 0
      ? "暂无可用智能体"
      : "";

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    if (pickerOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
        return;
      }
      if (event.key === "ArrowDown" && agents.length > 0) {
        event.preventDefault();
        setHighlight((index) => (index + 1) % agents.length);
        return;
      }
      if (event.key === "ArrowUp" && agents.length > 0) {
        event.preventDefault();
        setHighlight((index) => (index - 1 + agents.length) % agents.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (agents.length > 0 && !agentSwitchDisabled) pickAgent(agents[highlight]);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        if (agents.length > 0 && !agentSwitchDisabled) pickAgent(agents[highlight]);
        return;
      }
    }

    if (event.key !== "Enter" || event.shiftKey || submitting) return;
    event.preventDefault();
    if (streaming) {
      onInterrupt();
    } else {
      void submit();
    }
  };

  const action = streaming
    ? { icon: <Square size={16} />, type: "danger" as const, title: "停止生成", onClick: onInterrupt, disabled: false }
    : {
        icon: submitting || processingAttachments > 0
          ? <LoaderCircle className="composer-action-spinner" size={16} />
          : <Send size={16} />,
        type: "primary" as const,
        title: processingAttachments > 0 ? "正在处理附件" : submitting ? "正在准备并发送" : "发送",
        onClick: () => void submit(),
        disabled: disabled
          || submitting
          || processingAttachments > 0
          || (!text.trim() && images.length === 0 && files.length === 0),
      };

  return (
    <div
      ref={wrapperRef}
      className={cx("composer", streaming && "composer-streaming", dragging && "composer-dragging")}
    >
      <div className="composer-input">
        {pickerOpen ? (
          <div className="composer-picker">
            <AgentPicker
              id={agentPickerId}
              agents={agents}
              highlightedIndex={highlight}
              disabled={agentSwitchDisabled}
              disabledReason={agentSwitchDisabledReason}
              onHover={setHighlight}
              onSelect={pickAgent}
            />
          </div>
        ) : null}
        <div className="composer-panel">
          {images.length || files.length ? (
            <div
              className="composer-attachments"
              role="list"
              aria-label={`本次消息附件，共 ${images.length + files.length} 项`}
            >
              {images.map((image, index) => (
                <div
                  key={`${image.media_type}:${index}:${image.data.length}`}
                  className="composer-attachment"
                  role="listitem"
                >
                  <img src={`data:${image.media_type};base64,${image.data}`} alt="附件预览" />
                  <button
                    type="button"
                    className="composer-attachment-remove"
                    onClick={() => {
                      const nextImages = imagesRef.current.filter((_, i) => i !== index);
                      const key = activeDraftKeyRef.current;
                      const draft = getComposerDraft(draftsRef.current, persistedDraftsRef.current!, key);
                      publishComposerAttachments(key, { ...draft, images: nextImages });
                    }}
                    disabled={submitting}
                    aria-label="移除图片"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {files.map((file, index) => (
                <div
                  key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
                  className="composer-file-attachment"
                  role="listitem"
                >
                  <span className="composer-file-icon"><FileText size={18} /></span>
                  <span className="composer-file-copy">
                    <span className="composer-file-name" title={file.name}>{file.name}</span>
                    <span className="composer-file-size">{formatBytes(file.size)}</span>
                  </span>
                  <button
                    type="button"
                    className="composer-file-remove"
                    onClick={() => {
                      const nextFiles = filesRef.current.filter((_, i) => i !== index);
                      const key = activeDraftKeyRef.current;
                      const draft = getComposerDraft(draftsRef.current, persistedDraftsRef.current!, key);
                      publishComposerAttachments(key, { ...draft, files: nextFiles });
                    }}
                    disabled={submitting}
                    aria-label={`移除文件 ${file.name}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          {dragging ? (
            <div className="composer-drop-hint" role="status" aria-live="polite">
              释放后添加到本次消息
            </div>
          ) : null}
          <TextArea
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            aria-autocomplete="list"
            aria-expanded={pickerOpen}
            aria-controls={pickerOpen ? agentPickerId : undefined}
            aria-activedescendant={pickerOpen && agents.length > 0
              ? `${agentPickerId}-option-${highlight}`
              : undefined}
            autosize={{ minRows: 1, maxRows: 8 }}
            borderless
            disabled={(disabled && !streaming) || submitting}
            placeholder={
              disabled
                ? disabledReason || "正在加载对话历史…"
                : streaming
                  ? "正在生成回复…按 Enter 或点击停止可中断"
                  : "输入消息，Shift+Enter 换行"
            }
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="composer-file-input"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              void addSelectedFiles(files);
            }}
          />
          <div className="composer-footer">
            <button
              type="button"
              className="composer-agent-chip"
              onClick={toggleChip}
              disabled={agentPickerDisabled}
              aria-label={activeAgent ? `当前智能体：${activeAgent.name}` : "选择智能体"}
              title={agentPickerDisabledReason || (activeAgent ? "点击切换智能体" : "选择智能体")}
            >
              <AtSign size={14} />
              <span>{activeAgent?.name || "智能体"}</span>
            </button>
            <div className="composer-actions">
              <Button
                className="composer-action-button"
                icon={<Paperclip size={16} />}
                theme="borderless"
                type="tertiary"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || streaming || submitting || (images.length >= MAX_IMAGES && files.length >= MAX_FILES)}
                aria-label="添加图片或文件"
                title="添加图片或文件"
              />
              <Button
                className="composer-action-button"
                icon={action.icon}
                theme="solid"
                type={action.type}
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={streaming ? "停止生成" : "发送消息"}
                title={action.title}
              />
              {canCancelAll ? (
                <Popconfirm
                  title="取消全部子智能体任务"
                  content="确定取消当前会话中全部正在运行的子智能体任务吗？"
                  okType="danger"
                  cancelText={UI_TEXT.cancel}
                  onConfirm={onCancelAll}
                >
                  <Button
                    className="composer-action-button"
                    icon={<OctagonX size={16} />}
                    theme="borderless"
                    type="danger"
                    disabled={disabled}
                    aria-label="取消全部子智能体任务"
                    title="取消全部正在运行的子智能体任务"
                  />
                </Popconfirm>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function base64DecodedSize(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

function fileIdentity(file: File) {
  return `${file.name}\u001f${file.size}\u001f${file.lastModified}\u001f${file.type}`;
}

function getComposerDraft(
  drafts: Map<string, ComposerDraft>,
  persistedDrafts: Map<string, string>,
  draftKey: string,
): ComposerDraft {
  const existing = drafts.get(draftKey);
  if (existing) return existing;
  const draft = {
    text: persistedDrafts.get(draftKey) ?? "",
    images: [],
    files: [],
  };
  drafts.set(draftKey, draft);
  return draft;
}

function publishComposerAttachments(draftKey: string, draft: ComposerDraft) {
  COMPOSER_DRAFT_CACHE.set(draftKey, draft);
  syncAttachmentUnloadProtection();
  for (const listener of composerAttachmentListeners) listener(draftKey, draft);
}

function getPendingAttachmentReads(draftKey: string) {
  return pendingAttachmentReadCounts.get(draftKey) ?? 0;
}

function updatePendingAttachmentReads(draftKey: string, delta: number) {
  const pending = Math.max(0, getPendingAttachmentReads(draftKey) + delta);
  if (pending > 0) pendingAttachmentReadCounts.set(draftKey, pending);
  else pendingAttachmentReadCounts.delete(draftKey);
  syncAttachmentUnloadProtection();
  for (const listener of attachmentProcessingListeners) listener(draftKey, pending);
}

function syncAttachmentUnloadProtection() {
  if (typeof window === "undefined") return;
  const shouldProtect = pendingAttachmentReadCounts.size > 0
    || Array.from(COMPOSER_DRAFT_CACHE.values()).some(
      (draft) => draft.images.length > 0 || draft.files.length > 0,
    );
  if (shouldProtect === attachmentUnloadProtectionActive) return;
  attachmentUnloadProtectionActive = shouldProtect;
  if (shouldProtect) {
    window.addEventListener("beforeunload", protectUnsavedAttachments);
  } else {
    window.removeEventListener("beforeunload", protectUnsavedAttachments);
  }
}

function protectUnsavedAttachments(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}

function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return dataTransfer.files.length > 0 || Array.from(dataTransfer.types).includes("Files");
}

function isAttachmentDropBlocked(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest(".shell-window, .semi-modal, .semi-sidesheet, .semi-portal"));
}

function fileToImagePart(file: File): Promise<AgentImageInputPart> {
  return new Promise((resolve, reject) => {
    const mediaType = getImageMediaType(file);
    if (!mediaType) {
      reject(new Error("不支持的图片格式"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const separatorIndex = value.indexOf(",");
      const prefix = separatorIndex >= 0 ? value.slice(0, separatorIndex) : "";
      const data = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : "";
      if (!/^data:[^;,]+;base64$/i.test(prefix) || !data) {
        reject(new Error("图片数据无效"));
        return;
      }
      resolve({
        type: "image",
        media_type: mediaType,
        data,
        detail: "auto",
      });
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function getImageMediaType(file: File): AgentImageInputPart["media_type"] | null {
  const declaredType = file.type.trim().toLowerCase();
  if (declaredType === "image/png" || declaredType === "image/webp") return declaredType;
  if (
    declaredType === "image/jpeg"
    || declaredType === "image/jpg"
    || declaredType === "image/pjpeg"
  ) {
    return "image/jpeg";
  }

  const normalizedName = file.name.trim().toLowerCase();
  const extensionIndex = normalizedName.lastIndexOf(".");
  if (extensionIndex < 0) return null;
  return IMAGE_MEDIA_TYPE_BY_EXTENSION[normalizedName.slice(extensionIndex)] ?? null;
}
