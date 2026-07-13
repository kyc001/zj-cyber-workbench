import type { WorkProjectGraphEdgeCategory } from "../api/contract";
import {
  SYSTEM_USER_ROLES,
  WORK_PROJECT_ASSET_ORIGINS,
  WORK_PROJECT_ASSET_TYPES,
  WORK_PROJECT_ATTACK_PATH_STATUSES,
  WORK_PROJECT_FINDING_SEVERITIES,
  WORK_PROJECT_FINDING_STATUSES,
  WORK_PROJECT_GRAPH_EDGE_CATEGORIES,
  WORK_PROJECT_GRAPH_EDGE_TYPES,
  WORK_PROJECT_STATUSES,
  WORK_PROJECT_TASK_STATUSES,
  WORK_PROJECT_TYPES,
} from "../api/generated/constants";
import type {
  SystemUserRole,
  WorkProjectAssetOrigin,
  WorkProjectAssetType,
  WorkProjectAttackPathStatus,
  WorkProjectFindingSeverity,
  WorkProjectFindingStatus,
  WorkProjectGraphEdgeType,
  WorkProjectStatus,
  WorkProjectTaskStatus,
  WorkProjectType,
} from "../api/types";

export type SemiTagColor = "amber" | "green" | "red" | "grey" | "blue" | "cyan";

export const SYSTEM_USER_ROLE_LABEL = labelsFromEnum<SystemUserRole>(SYSTEM_USER_ROLES, { admin: "管理员", user: "普通用户" });
export const WORK_PROJECT_TYPE_LABEL = labelsFromEnum<WorkProjectType>(WORK_PROJECT_TYPES, { penetration_test: "渗透测试", source_code_audit: "源代码审计" });
export const WORK_PROJECT_STATUS_LABEL = labelsFromEnum<WorkProjectStatus>(WORK_PROJECT_STATUSES, { working: "进行中", completed: "已完成", canceled: "已取消" });
export const WORK_PROJECT_TASK_STATUS_LABEL = labelsFromEnum<WorkProjectTaskStatus>(WORK_PROJECT_TASK_STATUSES, { todo: "待处理", in_progress: "进行中", blocked: "已阻塞", done: "已完成" });
export const WORK_PROJECT_ASSET_TYPE_LABEL = labelsFromEnum<WorkProjectAssetType>(WORK_PROJECT_ASSET_TYPES, { service: "服务", domain: "域名", network: "网络", binary: "二进制" });
export const WORK_PROJECT_ASSET_ORIGIN_LABEL = labelsFromEnum<WorkProjectAssetOrigin>(WORK_PROJECT_ASSET_ORIGINS, { scope: "范围内", discovered: "已发现" });
export const WORK_PROJECT_FINDING_SEVERITY_LABEL = labelsFromEnum<WorkProjectFindingSeverity>(WORK_PROJECT_FINDING_SEVERITIES, { info: "信息", low: "低危", medium: "中危", high: "高危", critical: "严重" });
export const WORK_PROJECT_FINDING_STATUS_LABEL = labelsFromEnum<WorkProjectFindingStatus>(WORK_PROJECT_FINDING_STATUSES, { suspected: "疑似", validated: "已验证", false_positive: "误报" });
export const WORK_PROJECT_GRAPH_EDGE_TYPE_LABEL = labelsFromEnum<WorkProjectGraphEdgeType>(WORK_PROJECT_GRAPH_EDGE_TYPES, { related: "关联", resolves_to: "解析到", hosts: "托管", connects_to: "连接", trusts: "信任", exploits: "利用", pivots_to: "横向转移", leads_to: "导向" });
export const WORK_PROJECT_GRAPH_EDGE_CATEGORY_LABEL = labelsFromEnum<WorkProjectGraphEdgeCategory>(WORK_PROJECT_GRAPH_EDGE_CATEGORIES, { structural: "结构关系", offensive: "攻击关系" });
export const WORK_PROJECT_ATTACK_PATH_STATUS_LABEL = labelsFromEnum<WorkProjectAttackPathStatus>(WORK_PROJECT_ATTACK_PATH_STATUSES, { suspected: "疑似", validated: "已验证", blocked: "已阻断", closed: "已关闭" });

export const SYSTEM_USER_ROLE_COLOR = colorsFromEnum<SystemUserRole>(SYSTEM_USER_ROLES, {
  admin: "red",
  user: "blue",
});

export const WORK_PROJECT_STATUS_COLOR = colorsFromEnum<WorkProjectStatus>(WORK_PROJECT_STATUSES, {
  working: "amber",
  completed: "green",
  canceled: "grey",
});

export const WORK_PROJECT_TYPE_COLOR = colorsFromEnum<WorkProjectType>(WORK_PROJECT_TYPES, {
  penetration_test: "blue",
  source_code_audit: "cyan",
});

export const WORK_PROJECT_TASK_STATUS_COLOR = colorsFromEnum<WorkProjectTaskStatus>(WORK_PROJECT_TASK_STATUSES, {
  todo: "grey",
  in_progress: "blue",
  blocked: "amber",
  done: "green",
});

export const WORK_PROJECT_FINDING_SEVERITY_COLOR = colorsFromEnum<WorkProjectFindingSeverity>(WORK_PROJECT_FINDING_SEVERITIES, {
  info: "grey",
  low: "blue",
  medium: "amber",
  high: "red",
  critical: "red",
});

export const WORK_PROJECT_FINDING_STATUS_COLOR = colorsFromEnum<WorkProjectFindingStatus>(WORK_PROJECT_FINDING_STATUSES, {
  suspected: "amber",
  validated: "red",
  false_positive: "grey",
});

export const WORK_PROJECT_ATTACK_PATH_STATUS_COLOR = colorsFromEnum<WorkProjectAttackPathStatus>(WORK_PROJECT_ATTACK_PATH_STATUSES, {
  suspected: "amber",
  validated: "red",
  blocked: "grey",
  closed: "green",
});

export const WORK_PROJECT_ASSET_ORIGIN_COLOR = colorsFromEnum<WorkProjectAssetOrigin>(WORK_PROJECT_ASSET_ORIGINS, {
  scope: "blue",
  discovered: "cyan",
});

export const WORK_PROJECT_GRAPH_EDGE_CATEGORY_COLOR = colorsFromEnum<WorkProjectGraphEdgeCategory>(WORK_PROJECT_GRAPH_EDGE_CATEGORIES, {
  structural: "blue",
  offensive: "red",
});

function labelsFromEnum<T extends string>(
  values: readonly T[],
  overrides: Partial<Record<T, string>> = {},
): Record<T, string> {
  return Object.fromEntries(values.map((value) => [value, overrides[value] ?? titleCase(value)])) as Record<T, string>;
}

function colorsFromEnum<T extends string>(
  values: readonly T[],
  colors: Partial<Record<T, SemiTagColor>>,
): Record<T, SemiTagColor> {
  return Object.fromEntries(values.map((value) => [value, colors[value] ?? "grey"])) as Record<T, SemiTagColor>;
}

function titleCase(value: string): string {
  return value.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
