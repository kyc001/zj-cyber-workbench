import { Toast } from "@douyinfe/semi-ui";
import { AtSign, Check, Copy, FileText, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AgentFileInputPart, AgentImageInputPart, AgentInfo, AgentInputPart } from "../../shared/api/types";
import { copyTextToClipboard } from "../../shared/lib/clipboard";
import { formatDateTime } from "../../shared/lib/date";
import { formatBytes } from "../../shared/lib/number";
import { ImagePreview, imageDataUrl, type ImagePreviewState } from "./ImagePreview";
import type { AgentTranscript, ChatNode } from "./chatState";
import { TranscriptContent } from "./Transcript";
import { emptyAgentTranscript, isTranscriptEmpty } from "./transcriptView";
import type { SubagentSelection } from "./subagentView";

type ChatStreamProps = {
  nodes: ChatNode[];
  streaming: boolean;
  agents: AgentInfo[];
  selectedSubagent: SubagentSelection | null;
  tailRef: RefObject<HTMLDivElement | null>;
  onOpenFile: (file: AgentFileInputPart) => void;
  onOpenSubagent: (selection: SubagentSelection) => void;
};

type RenderedChatNode =
  | { kind: "user"; node: Extract<ChatNode, { kind: "user" }>; targetName: string }
  | { kind: "agent"; node: Extract<ChatNode, { kind: "agent" }>; agentName: string; live: boolean };

export function ChatStream({
  nodes,
  streaming,
  agents,
  selectedSubagent,
  tailRef,
  onOpenFile,
  onOpenSubagent,
}: ChatStreamProps) {
  const [preview, setPreview] = useState<ImagePreviewState>(null);
  const agentNameByCode = useMemo(
    () => new Map(agents.map((a) => [a.code, a.name])),
    [agents],
  );
  const renderedNodes = useMemo(
    () => buildRenderedChatNodes(nodes, streaming, agentNameByCode),
    [agentNameByCode, nodes, streaming],
  );

  const openImagePreview = (image: AgentImageInputPart, index: number) => {
    setPreview({
      src: imageDataUrl(image),
      alt: `用户附件 ${index + 1}`,
    });
  };

  const lastIndex = nodes.length - 1;
  const lastNode = nodes[lastIndex];

  return (
    <div className="chat-stream">
      {nodes.length === 0 ? <ChatEmptyState /> : renderedNodes.map((item) => {
        if (item.kind === "user") {
          return (
            <UserBubble
              key={item.node.id}
              content={item.node.content}
              displayText={item.node.displayText}
              targetName={item.targetName}
              createdAt={item.node.createdAt}
              onPreviewImage={openImagePreview}
              onOpenFile={onOpenFile}
            />
          );
        }
        return (
          <AgentBlock
            key={item.node.id}
            agentName={item.agentName}
            transcript={item.node}
            live={item.live}
            selectedSubagent={selectedSubagent}
            onOpenSubagent={onOpenSubagent}
          />
        );
      })}
      {streaming && lastNode?.kind === "user" ? (
        <AgentBlock
          key="pending-agent"
          agentName={resolveAgentName(agentNameByCode, lastNode.targetAgentCode)}
          transcript={emptyAgentTranscript()}
          live
          selectedSubagent={selectedSubagent}
          onOpenSubagent={onOpenSubagent}
        />
      ) : null}
      <div ref={tailRef} className="chat-tail" />
      <ImagePreview preview={preview} onClose={() => setPreview(null)} />
    </div>
  );
}

function ChatEmptyState() {
  return (
    <div className="chat-empty">
      <div className="chat-empty-mark">
        <Sparkles size={28} />
      </div>
      <h2>开始新对话</h2>
      <p>
        输入任务说明，或直接拖入代码、日志和文档
        <br />
        Agent 会在当前工作区中分析材料并整理结果。
      </p>
    </div>
  );
}

function buildRenderedChatNodes(
  nodes: ChatNode[],
  streaming: boolean,
  agentNameByCode: Map<string, string>,
): RenderedChatNode[] {
  const rendered: RenderedChatNode[] = [];
  const lastIndex = nodes.length - 1;
  let lastTargetName = "";

  nodes.forEach((node, index) => {
    if (node.kind === "user") {
      lastTargetName = resolveAgentName(agentNameByCode, node.targetAgentCode);
      rendered.push({ kind: "user", node, targetName: lastTargetName });
      return;
    }

    const live = streaming && index === lastIndex;
    if (!live && isTranscriptEmpty(node)) return;
    rendered.push({ kind: "agent", node, agentName: node.agentName || lastTargetName, live });
  });

  return rendered;
}

function MessageTimestamp({ value }: { value: string }) {
  return <time className="message-timestamp" dateTime={value}>{formatDateTime(value)}</time>;
}

function resolveAgentName(agentNameByCode: Map<string, string>, agentCode: string) {
  return agentNameByCode.get(agentCode) ?? agentCode;
}

function UserBubble({
  content,
  displayText,
  targetName,
  createdAt,
  onPreviewImage,
  onOpenFile,
}: {
  content: AgentInputPart[];
  displayText: string;
  targetName: string;
  createdAt: string;
  onPreviewImage: (image: AgentImageInputPart, index: number) => void;
  onOpenFile: (file: AgentFileInputPart) => void;
}) {
  const textParts = content.filter((part): part is Extract<AgentInputPart, { type: "text" }> => part.type === "text");
  const imageParts = content.filter((part): part is AgentImageInputPart => part.type === "image");
  const fileParts = content.filter((part): part is AgentFileInputPart => part.type === "file");
  const copyText = [
    ...textParts.map((part) => part.text),
    ...fileParts.map((part) => `${part.name}: ${part.path}`),
  ].join("\n\n");
  return (
    <div className="chat-row chat-row-user">
      <div className="chat-message chat-message-user">
        <div className="chat-message-meta chat-message-meta-user">
          <CopyTextButton text={copyText} label="复制用户消息" />
          <MessageTimestamp value={createdAt} />
        </div>
        <div className="user-bubble">
          {targetName ? (
            <span className="user-bubble-mention">
              <AtSign size={11} />
              <span>{targetName}</span>
            </span>
          ) : null}
          {textParts.length ? (
            <span className="user-bubble-text">{textParts.map((part) => part.text).join("\n\n")}</span>
          ) : displayText ? (
            <span className="user-bubble-text">{displayText}</span>
          ) : null}
          {imageParts.length ? (
            <div className="user-bubble-images">
              {imageParts.map((part, index) => (
                <button
                  key={`${part.media_type}:${index}:${part.data.length}`}
                  type="button"
                  className="user-bubble-image-button"
                  onClick={() => onPreviewImage(part, index)}
                  aria-label={`预览附件 ${index + 1}`}
                >
                  <img
                    className="user-bubble-image"
                    src={imageDataUrl(part)}
                    alt="用户附件"
                  />
                </button>
              ))}
            </div>
          ) : null}
          {fileParts.length ? (
            <div className="user-bubble-files">
              {fileParts.map((part) => (
                <button
                  key={`${part.path}:${part.sha256}`}
                  type="button"
                  className="user-bubble-file"
                  title={`在文件管理器中打开 ${part.path}`}
                  onClick={() => onOpenFile(part)}
                >
                  <FileText size={15} />
                  <span className="user-bubble-file-copy">
                    <strong>{part.name}</strong>
                    <small>{formatBytes(part.size)}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentBlock({
  agentName,
  transcript,
  live,
  selectedSubagent,
  onOpenSubagent,
}: {
  agentName: string;
  transcript: AgentTranscript;
  live: boolean;
  selectedSubagent: SubagentSelection | null;
  onOpenSubagent: (selection: SubagentSelection) => void;
}) {
  const copyText = useMemo(
    () => transcript.blocks
      .filter((block) => block.kind === "text")
      .map((block) => block.text.trim())
      .filter(Boolean)
      .join("\n\n"),
    [transcript.blocks],
  );
  return (
    <div className="chat-row chat-row-agent">
      <div className="agent-block">
        <div className="agent-header">
          {agentName ? <span>{agentName}</span> : null}
          {live ? <span className="agent-pulse" /> : null}
          {transcript.createdAt ? <MessageTimestamp value={transcript.createdAt} /> : null}
          <CopyTextButton text={copyText} label="复制智能体回复" />
        </div>
        <TranscriptContent
          transcript={transcript}
          live={live}
          pendingEmpty
          selectedSubagent={selectedSubagent}
          onOpenSubagent={onOpenSubagent}
        />
      </div>
    </div>
  );
}

function CopyTextButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!text) return null;

  const copy = async () => {
    if (copyingRef.current) return;
    copyingRef.current = true;
    setCopying(true);
    try {
      await copyTextToClipboard(text);
      setCopied(true);
      Toast.success("已复制到剪贴板");
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : "复制失败");
    } finally {
      copyingRef.current = false;
      setCopying(false);
    }
  };

  return (
    <button
      type="button"
      className="message-copy-button"
      disabled={copying}
      aria-label={copied ? "已复制" : copying ? "正在复制" : label}
      title={copied ? "已复制" : copying ? "正在复制" : label}
      onClick={() => void copy()}
    >
      {copied ? <Check size={13} /> : copying
        ? <LoaderCircle className="transcript-action-spinner" size={13} />
        : <Copy size={13} />}
    </button>
  );
}
