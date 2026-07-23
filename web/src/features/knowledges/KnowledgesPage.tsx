import { Button, Popconfirm, Select, TabPane, Tabs, Tag, Tooltip } from "@douyinfe/semi-ui";
import { Braces, CircleAlert, DatabaseZap, Eye, FileText, Network, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  deleteKnowledgeDocument,
  getKnowledgeGraph,
  queryKnowledgeDocuments,
  queryKnowledgeVectors,
  searchKnowledgeGraph,
  uploadKnowledgeDocuments,
} from "../../shared/api/knowledges";
import { getApiErrorMessage, showApiError } from "../../shared/api/feedback";
import {
  KNOWLEDGE_DOCUMENT_STATUSES,
  KNOWLEDGE_GRAPH_EXPANSION_NODES,
  KNOWLEDGE_GRAPH_MAX_NODES,
} from "../../shared/api/generated/constants";
import type {
  KnowledgeDocument,
  KnowledgeDocumentStatus,
  KnowledgeGraph,
  KnowledgeVector,
  QueryKnowledgeDocumentsData,
} from "../../shared/api/types";
import { ResourceIdentity, ResourceText, RowActions } from "../../shared/components/ResourceCells";
import {
  MetricStrip,
  ResourcePager,
  ResourcePanel,
  ResourceSearchForm,
} from "../../shared/components/ResourcePageShell";
import { ResourceTable, type ResourceColumn } from "../../shared/components/ResourceTable";
import { useAdminResourceHeader } from "../../shared/hooks/useAdminResourceHeader";
import { usePagedResourceList } from "../../shared/hooks/usePagedResourceList";
import { useResourceAction } from "../../shared/hooks/useResourceAction";
import { formatDateTime } from "../../shared/lib/date";
import { UI_TEXT } from "../../shared/lib/uiText";
import { KnowledgeDetailModal, type KnowledgeDetailTarget } from "./KnowledgeDetailModal";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import { KNOWLEDGE_STATUS_COLORS, KNOWLEDGE_STATUS_LABEL } from "./knowledgeUi";

type KnowledgeTab = "documents" | "vectors" | "graph";
type KnowledgeUploadSummary = {
  queued: number;
  rejected: Array<{ fileName: string; message: string }>;
  requestError?: string;
};

const EMPTY_GRAPH: KnowledgeGraph = { nodes: [], edges: [], is_truncated: false };
const DOCUMENT_POLL_INTERVAL_MS = 5_000;
const INFLIGHT_DOCUMENT_STATUSES: KnowledgeDocumentStatus[] = [
  "pending",
  "parsing",
  "analyzing",
  "processing",
  "preprocessed",
];
function countInflightDocuments(counts: Record<string, number>) {
  return INFLIGHT_DOCUMENT_STATUSES.reduce(
    (total, documentStatus) => total + (counts[documentStatus] ?? 0),
    0,
  );
}

export function KnowledgesPage() {
  const [activeTab, setActiveTab] = useState<KnowledgeTab>("documents");
  const [status, setStatus] = useState<KnowledgeDocumentStatus | undefined>();
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [graph, setGraph] = useState<KnowledgeGraph>(EMPTY_GRAPH);
  const [graphQuery, setGraphQuery] = useState("");
  const [activeGraphQuery, setActiveGraphQuery] = useState("");
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [graphExpansionLimits, setGraphExpansionLimits] = useState<Record<string, number>>({});
  const [expandedGraphNodeIds, setExpandedGraphNodeIds] = useState<Set<string>>(new Set());
  const [expandingGraphNodeIds, setExpandingGraphNodeIds] = useState<Set<string>>(new Set());
  const [awaitingUploadCompletion, setAwaitingUploadCompletion] = useState(false);
  const [processingCompletionVersion, setProcessingCompletionVersion] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<KnowledgeUploadSummary | null>(null);
  const [detailTarget, setDetailTarget] = useState<KnowledgeDetailTarget | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);
  const graphRequestRef = useRef(0);
  const graphExpansionRequestsRef = useRef<Set<string>>(new Set());
  const latestInflightDocumentsRef = useRef(0);
  const documentDataVersionRef = useRef(0);
  const handledProcessingCompletionVersionRef = useRef(0);

  const queryDocumentPage = useCallback(
    ({ page, size }: { page: number; size: number }) => queryKnowledgeDocuments({ page, size, status }),
    [status],
  );
  const updateDocumentMetrics = useCallback((data: QueryKnowledgeDocumentsData | null) => {
    if (!data) return;
    const counts = data.status_counts;
    const nextInflightDocuments = countInflightDocuments(counts);
    if (latestInflightDocumentsRef.current > 0 && nextInflightDocuments === 0) {
      setProcessingCompletionVersion((current) => current + 1);
    }
    latestInflightDocumentsRef.current = nextInflightDocuments;
    documentDataVersionRef.current += 1;
    setStatusCounts(counts);
  }, []);
  const documents = usePagedResourceList<KnowledgeDocument, QueryKnowledgeDocumentsData>({
    query: queryDocumentPage,
    onData: updateDocumentMetrics,
  });
  const queryVectorPage = useCallback(
    ({ page, size }: { page: number; size: number }) => queryKnowledgeVectors({ page, size }),
    [],
  );
  const vectors = usePagedResourceList<KnowledgeVector>({
    query: queryVectorPage,
  });
  const inflightDocuments = countInflightDocuments(statusCounts);

  useEffect(() => () => {
    graphRequestRef.current += 1;
    graphExpansionRequestsRef.current.clear();
  }, []);

  const loadGraph = useCallback(async (query = activeGraphQuery) => {
    const normalizedQuery = query.trim();
    const requestId = graphRequestRef.current + 1;
    graphRequestRef.current = requestId;
    graphExpansionRequestsRef.current.clear();
    setExpandingGraphNodeIds(new Set());
    if (!normalizedQuery) {
      setGraphLoading(false);
      setGraphError("");
      setGraph(EMPTY_GRAPH);
      setGraphExpansionLimits({});
      setExpandedGraphNodeIds(new Set());
      setExpandingGraphNodeIds(new Set());
      return;
    }
    setGraphLoading(true);
    setGraphError("");
    try {
      const response = await searchKnowledgeGraph({
        query: normalizedQuery,
        max_nodes: KNOWLEDGE_GRAPH_MAX_NODES,
      });
      if (graphRequestRef.current === requestId) {
        setGraphError("");
        setGraph(response.data ?? EMPTY_GRAPH);
        setGraphExpansionLimits({});
        setExpandedGraphNodeIds(new Set());
        setExpandingGraphNodeIds(new Set());
      }
    } catch (error) {
      if (graphRequestRef.current === requestId) {
        setGraphError(getApiErrorMessage(error, "加载知识图谱失败"));
      }
    } finally {
      if (graphRequestRef.current === requestId) setGraphLoading(false);
    }
  }, [activeGraphQuery]);

  useEffect(() => {
    if (inflightDocuments === 0 && !awaitingUploadCompletion) return;
    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      timer = window.setTimeout(async () => {
        const previousDataVersion = documentDataVersionRef.current;
        const previousInflightDocuments = latestInflightDocumentsRef.current;
        await documents.loadItems();
        if (cancelled) return;
        if (documentDataVersionRef.current === previousDataVersion) {
          schedule();
          return;
        }
        if (latestInflightDocumentsRef.current === 0) {
          setAwaitingUploadCompletion(false);
          if (previousInflightDocuments === 0) {
            await Promise.all([vectors.loadItems(), loadGraph()]);
          }
          return;
        }
        schedule();
      }, DOCUMENT_POLL_INTERVAL_MS);
    };
    schedule();

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [awaitingUploadCompletion, documents.loadItems, inflightDocuments, loadGraph, vectors.loadItems]);

  useEffect(() => {
    if (processingCompletionVersion <= handledProcessingCompletionVersionRef.current) return;
    handledProcessingCompletionVersionRef.current = processingCompletionVersion;
    void Promise.all([vectors.loadItems(), loadGraph()]);
  }, [loadGraph, processingCompletionVersion, vectors.loadItems]);

  const expandGraphNode = useCallback(async (node: KnowledgeGraph["nodes"][number]) => {
    if (
      graphExpansionRequestsRef.current.has(node.id)
      || expandedGraphNodeIds.has(node.id)
      || graph.nodes.length >= KNOWLEDGE_GRAPH_MAX_NODES
    ) return;

    const previousLimit = graphExpansionLimits[node.id] ?? 0;
    const nextLimit = Math.min(
      previousLimit + KNOWLEDGE_GRAPH_EXPANSION_NODES,
      KNOWLEDGE_GRAPH_MAX_NODES,
    );
    const graphRequestId = graphRequestRef.current;
    graphExpansionRequestsRef.current.add(node.id);
    setExpandingGraphNodeIds((current) => new Set(current).add(node.id));
    try {
      const response = await getKnowledgeGraph({
        query: node.labels[0] || node.id,
        max_depth: 1,
        max_nodes: nextLimit,
      });
      if (graphRequestRef.current !== graphRequestId) return;

      const incoming = response.data ?? EMPTY_GRAPH;
      setGraph((current) => mergeKnowledgeGraphs(current, incoming, KNOWLEDGE_GRAPH_MAX_NODES));
      setGraphExpansionLimits((current) => ({ ...current, [node.id]: nextLimit }));
      if (!incoming.is_truncated || nextLimit >= KNOWLEDGE_GRAPH_MAX_NODES) {
        setExpandedGraphNodeIds((current) => new Set(current).add(node.id));
      }
    } catch (error) {
      if (graphRequestRef.current === graphRequestId) showApiError(error);
    } finally {
      if (graphRequestRef.current === graphRequestId) {
        graphExpansionRequestsRef.current.delete(node.id);
        setExpandingGraphNodeIds((current) => {
          const next = new Set(current);
          next.delete(node.id);
          return next;
        });
      }
    }
  }, [expandedGraphNodeIds, graph.nodes.length, graphExpansionLimits]);

  const refreshKnowledgeData = useCallback(async () => {
    await Promise.all([
      documents.loadItems(),
      vectors.loadItems(),
      loadGraph(),
    ]);
  }, [documents.loadItems, loadGraph, vectors.loadItems]);
  const { run: deleteDocument, busyId: deletingDocumentId } = useResourceAction<KnowledgeDocument>(
    (document) => deleteKnowledgeDocument(document.id),
    refreshKnowledgeData,
  );

  const refreshActive = useCallback(async () => {
    if (activeTab === "documents") await documents.loadItems();
    if (activeTab === "vectors") await vectors.loadItems();
    if (activeTab === "graph") await loadGraph();
  }, [activeTab, documents.loadItems, loadGraph, vectors.loadItems]);

  const handleTabChange = (key: string) => {
    const next = key as KnowledgeTab;
    setActiveTab(next);
    if (next === "vectors") void vectors.loadItems();
    if (next === "graph") void loadGraph();
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || uploadingRef.current) return;

    uploadingRef.current = true;
    setUploading(true);
    setUploadSummary(null);
    try {
      const response = await uploadKnowledgeDocuments(files);
      const result = response.data;
      if (!result) throw new Error("上传响应未包含批处理结果");

      const queued = result.queued_files.length;
      const rejected = result.rejected_files.map((item) => ({
        fileName: item.file_name,
        message: item.message,
      }));
      setUploadSummary({ queued, rejected });
      if (queued > 0) {
        setAwaitingUploadCompletion(true);
        setActiveTab("documents");
        if (documents.page === 1) await documents.loadItems();
        else documents.goToFirstPage();
      }
    } catch (error) {
      setUploadSummary({
        queued: 0,
        rejected: [],
        requestError: getApiErrorMessage(error, "上传文档失败"),
      });
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  };

  const activeLoading = uploading
    || deletingDocumentId !== null
    || (activeTab === "documents" && documents.loading)
    || (activeTab === "vectors" && vectors.loading)
    || (activeTab === "graph" && graphLoading);

  useAdminResourceHeader({
    createLabel: "上传文档",
    createDisabled: uploading || deletingDocumentId !== null,
    createIcon: <Upload size={16} />,
    refreshLabel: "刷新知识库",
    loading: activeLoading,
    onCreate: () => {
      if (!uploadingRef.current && deletingDocumentId === null) fileInputRef.current?.click();
    },
    onRefresh: refreshActive,
  });

  const metrics = useMemo(() => [
    { label: "文档", value: statusCounts.all ?? documents.total },
    { label: "已处理", value: statusCounts.processed ?? 0 },
    { label: "向量", value: vectors.total },
    { label: "可见图谱", value: `${graph.nodes.length} / ${graph.edges.length}` },
  ], [documents.total, graph.edges.length, graph.nodes.length, statusCounts, vectors.total]);

  return (
    <section className="knowledges-page">
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept=".md,.pdf"
        multiple
        disabled={uploading || deletingDocumentId !== null}
        onChange={(event) => void handleUpload(event)}
      />
      <div className="knowledge-page-header">
        {uploadSummary ? (
          <KnowledgeUploadResult
            summary={uploadSummary}
            onClose={() => setUploadSummary(null)}
          />
        ) : null}
        <MetricStrip metrics={metrics} />
      </div>
      <Tabs type="line" activeKey={activeTab} onChange={handleTabChange} className="knowledge-tabs">
        <TabPane itemKey="documents" tab={<TabLabel icon={<FileText size={15} />} text="文档" />}>
          <DocumentsTab
            items={documents.items}
            status={status}
            loading={documents.loading || uploading || deletingDocumentId !== null}
            error={documents.error}
            deletingId={deletingDocumentId}
            page={documents.page}
            rangeStart={documents.rangeStart}
            rangeEnd={documents.rangeEnd}
            total={documents.total}
            canGoBack={documents.canGoBack}
            canGoNext={documents.canGoNext}
            onStatus={(next) => {
              setStatus(next);
              documents.goToFirstPage();
            }}
            onPrevious={documents.previous}
            onNext={documents.next}
            onRetry={documents.loadItems}
            onView={(document) => setDetailTarget({
              kind: "document",
              id: document.id,
              label: document.file_name,
            })}
            onDelete={deleteDocument}
          />
        </TabPane>
        <TabPane itemKey="vectors" tab={<TabLabel icon={<Braces size={15} />} text="向量" />}>
          <VectorsTab
            vectors={vectors}
            onView={(vector) => setDetailTarget({
              kind: "vector",
              id: vector.id,
              label: vector.file_name,
            })}
          />
        </TabPane>
        <TabPane itemKey="graph" tab={<TabLabel icon={<Network size={15} />} text="知识图谱" />}>
          <ResourcePanel
            className="knowledge-graph-panel"
            toolbar={(
              <ResourceSearchForm
                value={graphQuery}
                placeholder="搜索实体和关系"
                loading={graphLoading}
                onChange={setGraphQuery}
                onSearch={() => {
                  const query = graphQuery.trim();
                  setActiveGraphQuery(query);
                  void loadGraph(query);
                }}
              />
            )}
            loading={graphLoading}
            error={graphError}
            errorTitle="无法加载知识图谱"
            onRetry={() => void loadGraph()}
            empty={graph.nodes.length === 0}
            emptyTitle={activeGraphQuery ? "未找到图谱结果" : "尚未加载图谱"}
            emptyIcon={<Network size={42} />}
          >
            <KnowledgeGraphView
              graph={graph}
              expansionLimits={graphExpansionLimits}
              expandedNodeIds={expandedGraphNodeIds}
              expandingNodeIds={expandingGraphNodeIds}
              nodeLimitReached={graph.nodes.length >= KNOWLEDGE_GRAPH_MAX_NODES}
              onExpand={expandGraphNode}
            />
          </ResourcePanel>
        </TabPane>
      </Tabs>
      <KnowledgeDetailModal target={detailTarget} onClose={() => setDetailTarget(null)} />
    </section>
  );
}

function KnowledgeUploadResult({
  summary,
  onClose,
}: {
  summary: KnowledgeUploadSummary;
  onClose: () => void;
}) {
  const hasError = Boolean(summary.requestError) || summary.rejected.length > 0;
  const rejectedPreview = summary.rejected.slice(0, 5);
  const hiddenRejected = summary.rejected.length - rejectedPreview.length;
  const title = summary.requestError
    ? "文档上传失败"
    : summary.rejected.length > 0
      ? summary.queued > 0
        ? `${summary.queued} 个文档已加入队列，${summary.rejected.length} 个未上传`
        : `${summary.rejected.length} 个文档未上传`
      : summary.queued > 0
        ? `${summary.queued} 个文档已加入处理队列`
        : "没有可上传的文档";

  return (
    <div
      className={`knowledge-upload-result${hasError ? " is-error" : " is-success"}`}
      role={hasError ? "alert" : "status"}
    >
      {hasError ? <CircleAlert size={20} aria-hidden="true" /> : <Upload size={20} aria-hidden="true" />}
      <div>
        <strong>{title}</strong>
        {summary.requestError ? <span>{summary.requestError}</span> : null}
        {rejectedPreview.length > 0 ? (
          <ul>
            {rejectedPreview.map((item, index) => (
              <li key={`${item.fileName}:${index}`}>
                <span>{item.fileName}</span>
                <span>{item.message}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {hiddenRejected > 0 ? <span>另有 {hiddenRejected} 个文件未显示</span> : null}
      </div>
      <Button
        aria-label="关闭上传结果"
        icon={<X size={15} />}
        size="small"
        theme="borderless"
        type="tertiary"
        onClick={onClose}
      />
    </div>
  );
}

function mergeKnowledgeGraphs(current: KnowledgeGraph, incoming: KnowledgeGraph, maxNodes: number): KnowledgeGraph {
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  let isTruncated = current.is_truncated || incoming.is_truncated;
  incoming.nodes.forEach((node) => {
    const existing = nodes.get(node.id);
    if (existing) {
      nodes.set(node.id, {
        ...existing,
        labels: node.labels.length > 0 ? node.labels : existing.labels,
        properties: { ...existing.properties, ...node.properties },
      });
      return;
    }
    if (nodes.size >= maxNodes) {
      isTruncated = true;
      return;
    }
    nodes.set(node.id, node);
  });

  const nodeIds = new Set(nodes.keys());
  const edges = new Map(current.edges.map((edge) => [edge.id, edge]));
  incoming.edges.forEach((edge) => {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) edges.set(edge.id, edge);
  });
  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
    is_truncated: isTruncated,
  };
}

type PageProps = {
  page: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
  canGoBack: boolean;
  canGoNext: boolean;
  loading: boolean;
  error: string;
  onPrevious: () => void;
  onNext: () => void;
  onRetry: () => void;
};

function DocumentsTab({
  items,
  status,
  deletingId,
  error,
  onStatus,
  onView,
  onDelete,
  onRetry,
  ...page
}: PageProps & {
  items: KnowledgeDocument[];
  status?: KnowledgeDocumentStatus;
  deletingId: string | null;
  onStatus: (status?: KnowledgeDocumentStatus) => void;
  onView: (document: KnowledgeDocument) => void;
  onDelete: (document: KnowledgeDocument) => Promise<void>;
}) {
  const columns: ResourceColumn<KnowledgeDocument>[] = [
    { key: "document", header: "文档", width: "minmax(260px, 1fr)", render: (item) => <ResourceIdentity icon={<FileText size={18} />} title={item.file_name} detail={item.content_summary || item.id} /> },
    { key: "status", header: "状态", width: "120px", render: (item) => <Tag color={KNOWLEDGE_STATUS_COLORS[item.status]}>{KNOWLEDGE_STATUS_LABEL[item.status]}</Tag> },
    { key: "size", header: "内容", width: "150px", render: (item) => <ResourceText>{item.content_length.toLocaleString()} 字符</ResourceText> },
    { key: "chunks", header: "分块", width: "90px", render: (item) => item.chunks_count },
    { key: "updated", header: "更新时间", width: "170px", render: (item) => formatDateTime(item.updated_at) },
    {
      key: "actions", header: "操作", width: "104px",
      render: (item) => (
        <RowActions>
          <Tooltip content="查看文档详情">
            <Button
              icon={<Eye size={15} />}
              theme="borderless"
              type="tertiary"
              disabled={deletingId !== null}
              aria-label={`查看 ${item.file_name} 详情`}
              onClick={() => onView(item)}
            />
          </Tooltip>
          <Popconfirm
            title="删除文档"
            content={`确定删除 ${item.file_name} 及其全部向量和图谱数据吗？`}
            okType="danger"
            cancelText={UI_TEXT.cancel}
            onConfirm={() => void onDelete(item)}
          >
            <Button
              icon={<Trash2 size={15} />}
              theme="borderless"
              type="danger"
              disabled={deletingId !== null && deletingId !== item.id}
              loading={deletingId === item.id}
              aria-label={`删除 ${item.file_name}`}
            />
          </Popconfirm>
        </RowActions>
      ),
    },
  ];
  return (
    <ResourcePanel
      toolbar={(
        <Select
          value={status}
          placeholder="全部状态"
          showClear
          optionList={KNOWLEDGE_DOCUMENT_STATUSES.map((value) => ({ label: value, value }))}
          onChange={(value) => onStatus(value as KnowledgeDocumentStatus | undefined)}
        />
      )}
      loading={page.loading}
      error={error}
      errorTitle="无法加载知识库文档"
      onRetry={onRetry}
      empty={items.length === 0}
      emptyTitle="未找到文档"
      emptyIcon={<FileText size={42} />}
      footer={<ResourcePager {...page} />}
    >
      <ResourceTable ariaLabel="知识库文档" columns={columns} rows={items} rowKey={(item) => item.id} />
    </ResourcePanel>
  );
}

function VectorsTab({
  vectors,
  onView,
}: {
  vectors: ReturnType<typeof usePagedResourceList<KnowledgeVector>>;
  onView: (vector: KnowledgeVector) => void;
}) {
  const columns: ResourceColumn<KnowledgeVector>[] = [
    { key: "vector", header: "向量", width: "minmax(260px, 0.8fr)", render: (item) => <ResourceIdentity icon={<Braces size={18} />} title={item.file_name} detail={item.id} /> },
    { key: "content", header: "分块内容", width: "minmax(320px, 1.4fr)", render: (item) => <ResourceText>{item.content}</ResourceText> },
    { key: "index", header: "索引", width: "80px", render: (item) => item.chunk_index },
    { key: "tokens", header: "Token 数", width: "90px", render: (item) => item.tokens },
    { key: "dimension", header: "维度", width: "80px", render: (item) => item.dimension },
    {
      key: "actions", header: "操作", width: "64px",
      render: (item) => (
        <RowActions>
          <Tooltip content="查看向量详情">
            <Button
              icon={<Eye size={15} />}
              theme="borderless"
              type="tertiary"
              aria-label={`查看 ${item.file_name} 向量详情`}
              onClick={() => onView(item)}
            />
          </Tooltip>
        </RowActions>
      ),
    },
  ];
  return (
    <ResourcePanel
      loading={vectors.loading}
      error={vectors.error}
      errorTitle="无法加载知识向量"
      onRetry={vectors.loadItems}
      empty={vectors.items.length === 0}
      emptyTitle="未找到向量"
      emptyIcon={<DatabaseZap size={42} />}
      footer={(
        <ResourcePager
          page={vectors.page}
          rangeStart={vectors.rangeStart}
          rangeEnd={vectors.rangeEnd}
          total={vectors.total}
          loading={vectors.loading}
          canGoBack={vectors.canGoBack}
          canGoNext={vectors.canGoNext}
          onPrevious={vectors.previous}
          onNext={vectors.next}
        />
      )}
    >
      <ResourceTable ariaLabel="知识库向量" columns={columns} rows={vectors.items} rowKey={(item) => item.id} />
    </ResourcePanel>
  );
}

function TabLabel({ icon, text }: { icon: ReactNode; text: string }) {
  return <span className="workspace-tab-label">{icon}{text}</span>;
}
