import { Button, Tag, Toast } from "@douyinfe/semi-ui";
import { Check, ChevronDown, ChevronRight, Copy, GitBranch, Maximize2, Minimize2, PanelRightOpen, Wrench } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { NestedTranscript, SubagentExecutionItem, ToolExecutionItem } from "./chatState";
import { cx } from "../../shared/lib/className";
import { copyTextToClipboard } from "../../shared/lib/clipboard";
import { subagentStatusColor, subordinateStatusLabel, type SubagentSelection } from "./subagentView";
import { emptyAgentTranscript, transcriptHasRunningExecution, transcriptItemCount, type ToolBlock } from "./transcriptView";

export function ToolGroup({
  items,
  live,
  selectedSubagent,
  onOpenSubagent,
  allowSubagentOpen,
  header,
}: {
  items: ToolBlock[];
  live: boolean;
  selectedSubagent?: SubagentSelection | null;
  onOpenSubagent?: (selection: SubagentSelection) => void;
  allowSubagentOpen: boolean;
  header: (props: PanelHeaderProps) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cx("transcript-panel transcript-panel-tools", live && "transcript-panel-live")}>
      {header({
        icon: <Wrench size={13} />,
        title: "工具调用",
        count: items.length,
        open,
        onToggle: () => setOpen((next) => !next),
      })}
      {open ? (
        <div className="tool-list">
          {items.map((block) =>
            block.kind === "tool" ? (
              <ToolExecutionBlock
                key={`${block.kind}:${block.id}`}
                item={block}
                live={live}
                selectedSubagent={allowSubagentOpen ? selectedSubagent : null}
                onOpenSubagent={allowSubagentOpen ? onOpenSubagent : undefined}
                allowSubagentOpen={allowSubagentOpen}
              />
            ) : (
              <SubagentExecutionBlock
                key={`${block.kind}:${block.id}`}
                item={block}
                selected={allowSubagentOpen && selectedSubagent === block.agentCode}
                onOpenSubagent={allowSubagentOpen ? onOpenSubagent : undefined}
              />
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

type PanelHeaderProps = {
  icon: ReactNode;
  title: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
};

function ToolExecutionBlock({
  item,
  live,
  selectedSubagent,
  onOpenSubagent,
  allowSubagentOpen,
}: {
  item: ToolExecutionItem;
  live: boolean;
  selectedSubagent?: SubagentSelection | null;
  onOpenSubagent?: (selection: SubagentSelection) => void;
  allowSubagentOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const detailRef = useRef<HTMLDivElement | null>(null);
  const nestedActive = !!item.nested && transcriptHasRunningExecution(item.nested);
  const status = toolExecutionStatus(item);
  const displayName = item.name;

  useEffect(() => {
    if (open) detailRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open]);

  return (
    <div className={cx("execution-row", `execution-row-${status.tone}`)}>
      <button
        type="button"
        className="execution-row-head"
        aria-expanded={open}
        onClick={() => setOpen((next) => !next)}
      >
        <ExecutionName name={displayName} />
        <Tag size="small" color={status.color}>{status.label}</Tag>
        <span className="execution-row-toggle">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
      </button>
      {open ? (
        <div ref={detailRef} className="execution-row-detail">
          <JsonExecutionSection label="参数" value={item.arguments} />
          {allowSubagentOpen && (item.nested || item.subagentTask) ? (
            <NestedTranscriptPanel
              nested={item.nested ?? emptyAgentTranscript()}
              task={item.subagentTask}
              live={live && (nestedActive || item.subagentTask?.status === "running")}
              selected={selectedSubagent === item.subagentTask?.agentCode}
              onOpenSubagent={onOpenSubagent}
            />
          ) : null}
          {item.resolved ? (
            <ToolOutputSection output={item.output} tone={item.isError ? "error" : undefined} />
          ) : (
            <ExecutionSection label="输出" body="等待中…" />
          )}
        </div>
      ) : null}
    </div>
  );
}

function SubagentExecutionBlock({
  item,
  selected,
  onOpenSubagent,
}: {
  item: SubagentExecutionItem;
  selected: boolean;
  onOpenSubagent?: (selection: SubagentSelection) => void;
}) {
  return (
    <div className={cx("execution-row execution-row-subagent", `execution-row-subagent-${item.status}`, selected && "execution-row-selected")}>
      <div className="execution-row-head execution-row-head-static">
        <ExecutionName name={item.agentCode || "子智能体"} />
        <SubagentStatusTag status={item.status} />
        <OpenSubagentButton agentCode={item.agentCode} onOpenSubagent={onOpenSubagent} />
      </div>
    </div>
  );
}

function NestedTranscriptPanel({
  nested,
  task,
  live,
  selected,
  onOpenSubagent,
}: {
  nested: NestedTranscript;
  task?: SubagentExecutionItem;
  live: boolean;
  selected: boolean;
  onOpenSubagent?: (selection: SubagentSelection) => void;
}) {
  const itemCount = transcriptItemCount(nested);
  if (itemCount === 0 && !task) return null;

  return (
    <div className={cx("nested-panel", live && "nested-panel-live", selected && "nested-panel-selected")}>
      <div className="nested-panel-head">
        <GitBranch size={13} />
        <span className="nested-panel-title">
          子智能体{task?.agentCode ? ` - ${task.agentCode}` : nested.agentName ? ` - ${nested.agentName}` : ""}
        </span>
        {task ? <SubagentStatusTag status={task.status} /> : null}
        <span className="nested-panel-count">{itemCount}</span>
        <OpenSubagentButton agentCode={task?.agentCode} onOpenSubagent={onOpenSubagent} />
      </div>
    </div>
  );
}

function ExecutionName({ name }: { name: string }) {
  return <span className="execution-row-name" title={name}>{name}</span>;
}

function OpenSubagentButton({
  agentCode,
  onOpenSubagent,
}: {
  agentCode?: string;
  onOpenSubagent?: (selection: SubagentSelection) => void;
}) {
  if (!agentCode || !onOpenSubagent) return null;
  return (
    <Button
      className="execution-row-expand"
      icon={<PanelRightOpen size={13} />}
      size="small"
      theme="borderless"
      type="tertiary"
      onClick={() => onOpenSubagent(agentCode)}
    >
      打开
    </Button>
  );
}

export function SubagentStatusTag({ status }: { status: SubagentExecutionItem["status"] }) {
  return <Tag size="small" color={subagentStatusColor(status)}>{subordinateStatusLabel(status)}</Tag>;
}

const EXECUTION_PREVIEW_MAX_CHARS = 12_000;
const EXECUTION_PREVIEW_MAX_LINES = 160;

export function ExecutionSection({
  label,
  body,
  tone,
  structured = false,
}: {
  label: string;
  body: string;
  tone?: "error";
  structured?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyingRef = useRef(false);
  const bodyId = useId();
  const preview = useMemo(() => createExecutionPreview(body), [body]);
  const displayBody = expanded || !preview.truncated ? body : preview.text;
  const json = useMemo(
    () => structured ? tokenizeJson(displayBody) : null,
    [displayBody, structured],
  );

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    if (copyingRef.current || !body) return;
    copyingRef.current = true;
    try {
      await copyTextToClipboard(body);
      setCopied(true);
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : "复制失败");
    } finally {
      copyingRef.current = false;
    }
  };

  return (
    <div className={cx(
      "execution-section",
      tone && `execution-section-${tone}`,
      preview.truncated && !expanded && "execution-section-collapsed",
    )}>
      <div className="execution-section-head">
        <div className="execution-section-label">{label}</div>
        <div className="execution-section-actions">
          {preview.truncated ? (
            <button
              type="button"
              className="execution-section-action"
              aria-controls={bodyId}
              aria-expanded={expanded}
              title={expanded ? "收起内容" : "展开完整内容"}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              <span>{expanded ? "收起" : "展开"}</span>
            </button>
          ) : null}
          {body ? (
            <button
              type="button"
              className="execution-section-action"
              aria-label={copied ? `已复制${label}` : `复制${label}`}
              title={copied ? "已复制" : "复制完整内容"}
              onClick={() => void copy()}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              <span>{copied ? "已复制" : "复制"}</span>
            </button>
          ) : null}
        </div>
      </div>
      <div className="execution-section-body-wrap">
        <pre
          id={bodyId}
          className={cx("execution-section-body", structured && "execution-json-body")}
        >
          {json ? (
            <code>
              {json.map((token, index) => (
                token.tone ? (
                  <span key={index} className={`json-token-${token.tone}`}>
                    {token.text}
                  </span>
                ) : token.text
              ))}
            </code>
          ) : displayBody}
        </pre>
      </div>
    </div>
  );
}

function JsonExecutionSection({ label, value, tone }: { label: string; value: unknown; tone?: "error" }) {
  const body = useMemo(() => stringifyJson(value), [value]);
  return <ExecutionSection label={label} body={body} tone={tone} structured />;
}

function ToolOutputSection({ output, tone }: { output: string; tone?: "error" }) {
  const parsed = useMemo(() => parseJsonText(output), [output]);
  if (!parsed.ok) {
    return <ExecutionSection label="输出" body={output || "（空）"} tone={tone} />;
  }
  return <JsonExecutionSection label="输出" value={parsed.value} tone={tone} />;
}

function toolExecutionStatus(item: ToolExecutionItem): { label: string; color: "red" | "green" | "amber"; tone: "error" | "ok" | "running" } {
  if (item.resolved && item.isError) return { label: "失败", color: "red", tone: "error" };
  if (item.subagentTask?.status === "failed" || item.subagentTask?.status === "canceled") {
    return { label: subordinateStatusLabel(item.subagentTask.status), color: "red", tone: "error" };
  }
  if (!item.resolved || item.subagentTask?.status === "running") return { label: "运行中", color: "amber", tone: "running" };
  return { label: "已完成", color: "green", tone: "ok" };
}

function parseJsonText(output: string): { ok: true; value: unknown } | { ok: false } {
  const text = output.trim();
  if (!text) return { ok: true, value: "" };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function stringifyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? JSON.stringify(String(value));
  } catch {
    return JSON.stringify(String(value));
  }
}

function createExecutionPreview(body: string): { text: string; truncated: boolean } {
  if (body.length > EXECUTION_PREVIEW_MAX_CHARS) {
    const headLength = 8_500;
    const tailLength = 2_500;
    const omitted = body.length - headLength - tailLength;
    return {
      text: `${body.slice(0, headLength)}\n\n… 已省略 ${omitted.toLocaleString()} 个字符 …\n\n${body.slice(-tailLength)}`,
      truncated: true,
    };
  }
  const lines = body.split("\n");
  if (lines.length > EXECUTION_PREVIEW_MAX_LINES) {
    const headLines = 120;
    const tailLines = 24;
    const omitted = lines.length - headLines - tailLines;
    return {
      text: [
        ...lines.slice(0, headLines),
        "",
        `… 已省略 ${omitted.toLocaleString()} 行 …`,
        "",
        ...lines.slice(-tailLines),
      ].join("\n"),
      truncated: true,
    };
  }
  return { text: body, truncated: false };
}

type JsonToken = { text: string; tone?: "key" | "string" | "number" | "boolean" | "null" };

const JSON_TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;

function tokenizeJson(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let cursor = 0;
  for (const match of source.matchAll(JSON_TOKEN_PATTERN)) {
    const text = match[0];
    const index = match.index ?? cursor;
    if (index > cursor) tokens.push({ text: source.slice(cursor, index) });
    tokens.push({ text, tone: jsonTokenTone(source, index, text) });
    cursor = index + text.length;
  }
  if (cursor < source.length) tokens.push({ text: source.slice(cursor) });
  return tokens;
}

function jsonTokenTone(source: string, index: number, text: string): JsonToken["tone"] {
  if (text.startsWith("\"")) {
    return /^\s*:/.test(source.slice(index + text.length)) ? "key" : "string";
  }
  if (text === "true" || text === "false") return "boolean";
  if (text === "null") return "null";
  return "number";
}
