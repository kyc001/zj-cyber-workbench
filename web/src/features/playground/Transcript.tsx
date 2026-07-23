import { AlertOctagon, ArrowDown, Brain, ChevronDown, ChevronRight, Download, FileText, LoaderCircle } from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AgentTranscript,
  ErrorItem,
  ReportAttachmentItem,
  ThinkingItem,
  TranscriptAttachmentItem,
} from "./chatState";
import { downloadAgentReport } from "../../shared/api/agentSessions";
import { showApiError } from "../../shared/api/feedback";
import { normalizeMarkdownForRender } from "./markdown";
import type { SubagentSelection } from "./subagentView";
import { cx } from "../../shared/lib/className";
import { saveBlob } from "../../shared/lib/download";
import { formatBytes } from "../../shared/lib/number";
import { ToolGroup } from "./TranscriptExecutions";
import {
  activeTextItemId,
  activeThinkingItemId,
  buildTranscriptSegments,
  isTranscriptEmpty,
  type ContentBlock,
  type TranscriptRenderSegment,
} from "./transcriptView";

const MarkdownRenderer = lazy(() => import("./MarkdownRenderer").then((module) => ({
  default: module.MarkdownRenderer,
})));

export function TranscriptContent({
  transcript,
  live,
  emptyText,
  pendingEmpty = false,
  allowSubagentOpen = true,
  selectedSubagent,
  onOpenSubagent,
}: {
  transcript: AgentTranscript;
  live: boolean;
  emptyText?: string;
  pendingEmpty?: boolean;
  allowSubagentOpen?: boolean;
  selectedSubagent?: SubagentSelection | null;
  onOpenSubagent?: (selection: SubagentSelection) => void;
}) {
  const isEmpty = isTranscriptEmpty(transcript);
  const activeTextId = live ? activeTextItemId(transcript.blocks) : "";
  const activeThinkingId = live ? activeThinkingItemId(transcript.blocks) : "";
  const segments = useMemo(() => buildTranscriptSegments(transcript.blocks), [transcript.blocks]);
  const attachments = transcript.attachments ?? [];

  return (
    <div className="transcript-body">
      {pendingEmpty && isEmpty && live ? <PendingShimmer /> : null}
      {segments.map((segment) => (
        <TranscriptSegmentView
          key={segment.id}
          segment={segment}
          live={live}
          activeTextId={activeTextId}
          activeThinkingId={activeThinkingId}
          allowSubagentOpen={allowSubagentOpen}
          selectedSubagent={selectedSubagent}
          onOpenSubagent={onOpenSubagent}
        />
      ))}
      {attachments.length ? <TranscriptAttachments attachments={attachments} /> : null}
      {live && !isEmpty ? <span className="caret" /> : null}
      {isEmpty && emptyText ? <div className="transcript-empty">{emptyText}</div> : null}
    </div>
  );
}

function TranscriptSegmentView({
  segment,
  live,
  activeTextId,
  activeThinkingId,
  allowSubagentOpen,
  selectedSubagent,
  onOpenSubagent,
}: {
  segment: TranscriptRenderSegment;
  live: boolean;
  activeTextId: string;
  activeThinkingId: string;
  allowSubagentOpen: boolean;
  selectedSubagent?: SubagentSelection | null;
  onOpenSubagent?: (selection: SubagentSelection) => void;
}) {
  if (segment.kind === "thinking") {
    return (
      <ThinkingGroup
        items={segment.items}
        activeItemId={activeThinkingId}
        active={segment.items.some((item) => item.id === activeThinkingId && !item.complete)}
        live={live}
      />
    );
  }
  if (segment.kind === "tools") {
    return (
      <ToolGroup
        items={segment.items}
        live={live}
        selectedSubagent={selectedSubagent}
        onOpenSubagent={onOpenSubagent}
        allowSubagentOpen={allowSubagentOpen}
        header={(props) => <PanelHeader {...props} />}
      />
    );
  }
  return (
    <ContentBlockView
      block={segment.block}
      streaming={segment.block.kind === "text" ? segment.block.id === activeTextId && !segment.block.complete : false}
    />
  );
}

function ContentBlockView({ block, streaming }: { block: ContentBlock; streaming: boolean }) {
  switch (block.kind) {
    case "text":
      return <MarkdownText text={block.text} streaming={streaming} />;
    case "error":
      return <ErrorNotice item={block} />;
  }
}

const STREAM_RENDER_INTERVAL_MS = 80;

const MarkdownText = memo(function MarkdownText({ text, streaming }: { text: string; streaming: boolean }) {
  const [renderText, setRenderText] = useState(text);
  const latestTextRef = useRef(text);

  latestTextRef.current = text;

  useEffect(() => {
    if (!streaming) {
      setRenderText(text);
      return;
    }
    const timer = setInterval(() => {
      setRenderText(latestTextRef.current);
    }, STREAM_RENDER_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      setRenderText(latestTextRef.current);
    };
  }, [streaming, text === ""]);

  useEffect(() => {
    if (!streaming) setRenderText(text);
  }, [streaming, text]);

  const markdown = useMemo(
    () => normalizeMarkdownForRender(renderText, streaming),
    [renderText, streaming],
  );
  if (!renderText && !streaming) return null;
  return (
    <div className="agent-text">
      <Suspense
        fallback={(
          <div className="markdown-render-fallback" aria-busy="true">
            {markdown}
          </div>
        )}
      >
        <MarkdownRenderer markdown={markdown} />
      </Suspense>
    </div>
  );
});

function ThinkingGroup({
  items,
  active,
  activeItemId,
  live,
}: {
  items: ThinkingItem[];
  active: boolean;
  activeItemId: string;
  live: boolean;
}) {
  const [open, setOpen] = useState(active);
  const [following, setFollowing] = useState(true);
  const wasActive = useRef(active);
  const bodyRef = useRef<HTMLPreElement | null>(null);
  const followingRef = useRef(true);
  const text = useMemo(
    () => items.map((item) => item.text.trim()).filter(Boolean).join("\n\n"),
    [items],
  );

  useEffect(() => {
    if (active) {
      followingRef.current = true;
      setFollowing(true);
      setOpen(true);
    } else if (wasActive.current) {
      setOpen(false);
    }
    wasActive.current = active;
  }, [active]);

  useEffect(() => {
    if (active && open && followingRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [active, text, open]);

  const toggleOpen = () => {
    setOpen((current) => {
      const next = !current;
      if (next && active) {
        followingRef.current = true;
        setFollowing(true);
      }
      return next;
    });
  };

  const handleThinkingScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const next = body.scrollHeight - body.scrollTop - body.clientHeight <= 20;
    followingRef.current = next;
    setFollowing((current) => current === next ? current : next);
  };

  const scrollThinkingToLatest = () => {
    followingRef.current = true;
    setFollowing(true);
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className={cx("thinking-block", live && "transcript-panel-live", active && "thinking-block-active")}>
      <PanelHeader
        icon={<Brain size={13} />}
        title={active ? "思考中…" : "思考过程"}
        count={items.length > 1 ? items.length : undefined}
        open={open}
        onToggle={toggleOpen}
      />
      {open ? (
        <div className="thinking-body">
          <div className="thinking-fade thinking-fade-top" />
          <pre
            ref={bodyRef}
            className="thinking-text"
            onScroll={handleThinkingScroll}
          >
            {text || (activeItemId ? " " : "(empty)")}
          </pre>
          <div className="thinking-fade thinking-fade-bottom" />
          {active && !following ? (
            <button
              type="button"
              className="thinking-follow-button"
              onClick={scrollThinkingToLatest}
            >
              <ArrowDown size={12} />
              <span>查看最新</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PanelHeader({
  icon,
  title,
  count,
  open,
  onToggle,
}: {
  icon: ReactNode;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="transcript-panel-header"
      aria-expanded={open}
      onClick={onToggle}
    >
      {icon}
      <span>{title}</span>
      {count ? <span className="transcript-panel-count">{count}</span> : null}
      <span className="transcript-panel-toggle">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </span>
    </button>
  );
}

function ErrorNotice({ item }: { item: ErrorItem }) {
  return (
    <div className="agent-error">
      <AlertOctagon size={16} />
      <span>{item.message}</span>
    </div>
  );
}

type TranscriptAttachmentRenderContext = {
  downloadingReportId: string;
  onDownloadReport: (report: ReportAttachmentItem) => void;
};

const TRANSCRIPT_ATTACHMENT_RENDERERS: {
  [Kind in TranscriptAttachmentItem["kind"]]: (
    attachment: Extract<TranscriptAttachmentItem, { kind: Kind }>,
    context: TranscriptAttachmentRenderContext,
  ) => ReactNode;
} = {
  report: (attachment, context) => (
    <ReportAttachment
      report={attachment}
      disabled={Boolean(context.downloadingReportId)}
      loading={context.downloadingReportId === attachment.reportId}
      onDownload={() => context.onDownloadReport(attachment)}
    />
  ),
};

function TranscriptAttachments({ attachments }: { attachments: TranscriptAttachmentItem[] }) {
  const [downloadingReportId, setDownloadingReportId] = useState("");
  const downloadingReportIdRef = useRef("");
  const downloadReport = useCallback(async (report: ReportAttachmentItem) => {
    if (downloadingReportIdRef.current) return;
    downloadingReportIdRef.current = report.reportId;
    setDownloadingReportId(report.reportId);
    try {
      const { blob, filename } = await downloadAgentReport(report.reportId);
      saveBlob(blob, filename || report.filename);
    } catch (error) {
      showApiError(error);
    } finally {
      if (downloadingReportIdRef.current === report.reportId) {
        downloadingReportIdRef.current = "";
      }
      setDownloadingReportId((current) => (current === report.reportId ? "" : current));
    }
  }, []);
  const context = useMemo(
    () => ({ downloadingReportId, onDownloadReport: downloadReport }),
    [downloadReport, downloadingReportId],
  );

  return (
    <div className="transcript-attachments">
      {attachments.map((attachment) => (
        <TranscriptAttachment
          key={attachment.id}
          attachment={attachment}
          context={context}
        />
      ))}
    </div>
  );
}

function TranscriptAttachment({
  attachment,
  context,
}: {
  attachment: TranscriptAttachmentItem;
  context: TranscriptAttachmentRenderContext;
}) {
  const render = TRANSCRIPT_ATTACHMENT_RENDERERS[attachment.kind] as (
    attachment: TranscriptAttachmentItem,
    context: TranscriptAttachmentRenderContext,
  ) => ReactNode;
  return render(attachment, context);
}

function ReportAttachment({
  report,
  disabled,
  loading,
  onDownload,
}: {
  report: ReportAttachmentItem;
  disabled: boolean;
  loading: boolean;
  onDownload: () => void;
}) {
  return (
    <button
      type="button"
      className="report-attachment"
      disabled={disabled}
      title={`${report.filename} · ${formatBytes(report.size)}`}
      aria-label={loading ? `正在下载 ${report.filename}` : `下载 ${report.filename}`}
      aria-busy={loading}
      onClick={onDownload}
    >
      <span className="report-attachment-icon">
        <FileText size={18} />
      </span>
      <span className="report-attachment-main">
        <span className="report-attachment-name">{report.filename}</span>
        <span className="report-attachment-size">{formatBytes(report.size)}</span>
      </span>
      <span className="report-attachment-download">
        {loading
          ? <LoaderCircle className="transcript-action-spinner" size={14} />
          : <Download size={14} />}
      </span>
    </button>
  );
}

function PendingShimmer() {
  return (
    <div className="agent-pending">
      <span /><span /><span />
    </div>
  );
}
