import type { KnowledgeDocumentStatus } from "../../shared/api/types";

export const KNOWLEDGE_STATUS_COLORS: Record<
  KnowledgeDocumentStatus,
  "blue" | "cyan" | "amber" | "green" | "red" | "grey"
> = {
  pending: "grey",
  parsing: "blue",
  analyzing: "cyan",
  processing: "amber",
  preprocessed: "cyan",
  processed: "green",
  failed: "red",
};

export const KNOWLEDGE_STATUS_LABEL: Record<KnowledgeDocumentStatus, string> = {
  pending: "待处理",
  parsing: "解析中",
  analyzing: "分析中",
  processing: "处理中",
  preprocessed: "预处理完成",
  processed: "已处理",
  failed: "失败",
};
