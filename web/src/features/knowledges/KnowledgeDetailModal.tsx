import { Empty, Modal, Spin, Tag } from "@douyinfe/semi-ui";
import { Braces, FileText } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { getKnowledgeDocument, getKnowledgeVector } from "../../shared/api/knowledges";
import { showApiError } from "../../shared/api/feedback";
import type { KnowledgeDocumentDetail, KnowledgeVectorDetail } from "../../shared/api/types";
import { formatDateTime } from "../../shared/lib/date";
import { KNOWLEDGE_STATUS_COLORS } from "./knowledgeUi";

const CodeEditor = lazy(() => import("../code-editor/CodeEditor").then((module) => ({
  default: module.CodeEditor,
})));
const DETAIL_MODAL_HEIGHT = "min(640px, calc(100dvh - 120px))";

export type KnowledgeDetailTarget =
  | { kind: "document"; id: string; label: string }
  | { kind: "vector"; id: string; label: string };

type KnowledgeDetail =
  | { kind: "document"; data: KnowledgeDocumentDetail }
  | { kind: "vector"; data: KnowledgeVectorDetail };

export function KnowledgeDetailModal({
  target,
  onClose,
}: {
  target: KnowledgeDetailTarget | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    if (!target) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    void (async () => {
      try {
        if (target.kind === "document") {
          const response = await getKnowledgeDocument(target.id);
    if (!response.data) throw new Error("文档详情不可用");
          if (!cancelled) setDetail({ kind: "document", data: response.data });
        } else {
          const response = await getKnowledgeVector(target.id);
    if (!response.data) throw new Error("向量详情不可用");
          if (!cancelled) setDetail({ kind: "vector", data: response.data });
        }
      } catch (error) {
        if (!cancelled) showApiError(error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [target]);

  return (
    <Modal
      visible={target !== null}
      centered
      title={(
        <div className="knowledge-detail-title">
      <strong>{target?.kind === "vector" ? "向量详情" : "文档详情"}</strong>
          <span>{target?.label}</span>
        </div>
      )}
      width="min(1120px, calc(100vw - 24px))"
      height={DETAIL_MODAL_HEIGHT}
      bodyStyle={{
        minHeight: 0,
        overflowY: "auto",
        overscrollBehavior: "contain",
        scrollbarGutter: "stable",
      }}
      footer={null}
      onCancel={onClose}
    >
      <Spin spinning={loading} wrapperClassName="knowledge-detail-spin">
        {detail?.kind === "document" ? <DocumentDetail detail={detail.data} /> : null}
        {detail?.kind === "vector" ? <VectorDetail detail={detail.data} /> : null}
        {!loading && !detail ? (
          <Empty
            className="empty-state"
            image={target?.kind === "vector" ? <Braces size={42} /> : <FileText size={42} />}
    title="详情不可用"
            description=""
          />
        ) : null}
      </Spin>
    </Modal>
  );
}

function DocumentDetail({ detail }: { detail: KnowledgeDocumentDetail }) {
  return (
    <div className="knowledge-detail-content">
      <section className="knowledge-detail-facts" aria-label="文档元数据">
        <DetailFact label="状态">
          <Tag color={KNOWLEDGE_STATUS_COLORS[detail.status]}>{detail.status}</Tag>
        </DetailFact>
        <DetailFact label="内容">{detail.content_length.toLocaleString()} 字符</DetailFact>
        <DetailFact label="分块">{detail.chunks_count.toLocaleString()}</DetailFact>
        <DetailFact label="创建时间">{formatDateTime(detail.created_at)}</DetailFact>
        <DetailFact label="更新时间">{formatDateTime(detail.updated_at)}</DetailFact>
        <DetailFact label="解析器">{detail.parse_engine || detail.parse_format || "-"}</DetailFact>
      </section>

      <section className="knowledge-detail-identifiers" aria-label="文档标识">
        <DetailIdentifier label="文档 ID" value={detail.id} />
        <DetailIdentifier label="跟踪 ID" value={detail.track_id || "-"} />
        <DetailIdentifier label="内容哈希" value={detail.content_hash || "-"} />
      </section>

      <DetailSection title="内容摘要">
        <pre className="knowledge-detail-text">{detail.content_summary || "暂无摘要。"}</pre>
      </DetailSection>

      <DetailSection title="提取后的文档内容">
        {detail.content ? (
          <Editor value={detail.content} filename={detail.file_name} />
        ) : (
        <DetailEmpty icon={<FileText size={36} />} title="暂无提取内容" />
        )}
      </DetailSection>

      {detail.error ? (
      <DetailSection title="处理错误">
          <pre className="knowledge-detail-text is-error">{detail.error}</pre>
        </DetailSection>
      ) : null}

      <DetailJsonSection title="分块 ID" value={detail.chunk_ids} />
      <DetailJsonSection title="文档元数据" value={detail.metadata} />
      <DetailJsonSection title="分块选项" value={detail.chunk_options} />
    </div>
  );
}

function VectorDetail({ detail }: { detail: KnowledgeVectorDetail }) {
  return (
    <div className="knowledge-detail-content">
      <section className="knowledge-detail-facts" aria-label="向量元数据">
        <DetailFact label="分块索引">{detail.chunk_index.toLocaleString()}</DetailFact>
        <DetailFact label="Token 数">{detail.tokens.toLocaleString()}</DetailFact>
        <DetailFact label="维度">{detail.dimension.toLocaleString()}</DetailFact>
        <DetailFact label="创建时间">{formatDateTime(detail.created_at)}</DetailFact>
        <DetailFact label="更新时间">{formatDateTime(detail.updated_at)}</DetailFact>
      </section>

      <section className="knowledge-detail-identifiers" aria-label="向量标识">
        <DetailIdentifier label="分块 ID" value={detail.id} />
        <DetailIdentifier label="文档 ID" value={detail.document_id} />
        <DetailIdentifier label="源文档" value={detail.file_name} />
      </section>

      <DetailSection title="分块内容">
        {detail.content ? (
          <Editor value={detail.content} filename={detail.file_name} compact />
        ) : (
        <DetailEmpty icon={<Braces size={36} />} title="该分块没有文本内容" />
        )}
      </DetailSection>

      <DetailJsonSection title="标题" value={detail.heading} />
      <DetailJsonSection title="来源元数据" value={detail.source_metadata} />
    </div>
  );
}

function DetailFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
}

function DetailIdentifier({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="knowledge-detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function DetailJsonSection({ title, value }: { title: string; value: unknown[] | Record<string, unknown> }) {
  const hasContent = Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
  if (!hasContent) return null;
  return (
    <DetailSection title={title}>
      <pre className="knowledge-detail-json">{JSON.stringify(value, null, 2)}</pre>
    </DetailSection>
  );
}

function DetailEmpty({ icon, title }: { icon: ReactNode; title: string }) {
  return <Empty className="knowledge-detail-empty" image={icon} title={title} description="" />;
}

function Editor({ value, filename, compact = false }: { value: string; filename: string; compact?: boolean }) {
  return (
    <div className={`knowledge-detail-editor${compact ? " is-compact" : ""}`}>
      <Suspense fallback={<Spin spinning />}>
        <CodeEditor value={value} readOnly filename={filename} />
      </Suspense>
    </div>
  );
}
