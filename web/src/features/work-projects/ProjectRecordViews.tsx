import { Empty, TabPane, Tabs, Tag } from "@douyinfe/semi-ui";
import { Boxes, Bug, FileText, Network, Route, ShieldAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { WORK_PROJECT_ASSET_TYPE } from "../../shared/api/contract";
import type {
  WorkProjectAsset,
  WorkProjectAttackPathStep,
  WorkProjectFinding,
  WorkProjectGraphEdge,
  WorkProjectGraphSnapshot,
  WorkProjectRecords,
} from "../../shared/api/types";
import { cx } from "../../shared/lib/className";
import { formatDateTime } from "../../shared/lib/date";
import {
  WORK_PROJECT_ASSET_ORIGIN_COLOR,
  WORK_PROJECT_ASSET_ORIGIN_LABEL,
  WORK_PROJECT_ASSET_TYPE_LABEL,
  WORK_PROJECT_ATTACK_PATH_STATUS_COLOR,
  WORK_PROJECT_ATTACK_PATH_STATUS_LABEL,
  WORK_PROJECT_FINDING_SEVERITY_COLOR,
  WORK_PROJECT_FINDING_SEVERITY_LABEL,
  WORK_PROJECT_FINDING_STATUS_COLOR,
  WORK_PROJECT_FINDING_STATUS_LABEL,
} from "../../shared/lib/labels";
import { ProjectGraphCanvas } from "./ProjectGraphCanvas";
import { CveDiscoveryPanel } from "./CveDiscoveryPanel";
import { filledDetailItems, type DetailItem } from "./workProjectDetails";
import { formatWorkProjectAsset } from "./workProjectView";

export type ProjectRecordTab = "assets" | "findings" | "cve" | "attack-paths" | "graph";

type WorkProjectRecordTabsProps = {
  records: WorkProjectRecords;
  initialTab?: ProjectRecordTab;
  className?: string;
  projectId?: number;
  onRecordsChanged?: () => void;
};

export function WorkProjectRecordTabs({
  records,
  initialTab = "assets",
  className,
  projectId,
  onRecordsChanged,
}: WorkProjectRecordTabsProps) {
  return (
    <Tabs
      type="line"
      className={cx("project-record-tabs", className)}
      defaultActiveKey={initialTab}
    >
      <TabPane tab={<TabLabel icon={<Boxes size={14} />} text="资产" />} itemKey="assets">
        <AssetList assets={records.assets} />
      </TabPane>
      <TabPane tab={<TabLabel icon={<Bug size={14} />} text="发现" />} itemKey="findings">
        <FindingList findings={records.findings} assets={records.assets} />
      </TabPane>
      {projectId ? (
        <TabPane tab={<TabLabel icon={<ShieldAlert size={14} />} text="CVE 发现" />} itemKey="cve">
          <CveDiscoveryPanel
            projectId={projectId}
            assets={records.assets}
            onImported={onRecordsChanged}
          />
        </TabPane>
      ) : null}
      <TabPane tab={<TabLabel icon={<Route size={14} />} text="攻击路径" />} itemKey="attack-paths">
        <AttackPathList assets={records.assets} graph={records.graph} />
      </TabPane>
      <TabPane tab={<TabLabel icon={<Network size={14} />} text="关系图" />} itemKey="graph">
        <GraphView assets={records.assets} graph={records.graph} />
      </TabPane>
    </Tabs>
  );
}

export function AssetList({ assets }: { assets: WorkProjectAsset[] }) {
  if (!assets.length) return <RecordEmpty title="暂无资产。" />;
  return (
    <div className="project-record-list">
      {assets.map((asset) => (
        <article key={asset.id} className="project-record-row">
          <header>
            <strong>{formatWorkProjectAsset(asset)}</strong>
            <div>
              <Tag>{WORK_PROJECT_ASSET_TYPE_LABEL[asset.type]}</Tag>
              <Tag color={WORK_PROJECT_ASSET_ORIGIN_COLOR[asset.origin]}>{WORK_PROJECT_ASSET_ORIGIN_LABEL[asset.origin]}</Tag>
            </div>
          </header>
          <RecordDetails items={assetBaseMeta(asset)} />
          <RecordDetails className="project-record-details-extension" items={[
            ["服务信息", asset.extra?.banner],
          ]} />
        </article>
      ))}
    </div>
  );
}

export function FindingList({ findings, assets }: { findings: WorkProjectFinding[]; assets: WorkProjectAsset[] }) {
  const assetLabels = useAssetLabels(assets);
  if (!findings.length) return <RecordEmpty title="暂无发现。" />;
  return (
    <div className="project-record-list">
      {findings.map((finding) => (
        <article key={finding.id} className="project-record-row">
          <header>
            <strong>{finding.title}</strong>
            <div>
              <Tag color={WORK_PROJECT_FINDING_SEVERITY_COLOR[finding.severity]}>{WORK_PROJECT_FINDING_SEVERITY_LABEL[finding.severity]}</Tag>
              <Tag color={WORK_PROJECT_FINDING_STATUS_COLOR[finding.status]}>{WORK_PROJECT_FINDING_STATUS_LABEL[finding.status]}</Tag>
            </div>
          </header>
          <p>{finding.description || finding.impact || "暂无描述"}</p>
          <RecordDetails items={[
            ["CVE", finding.cve_id],
            ["CVSS", finding.cvss_score?.toFixed(1)],
            ["置信度", finding.confidence],
            ["EPSS", finding.epss_score == null ? undefined : `${(finding.epss_score * 100).toFixed(1)}%`],
            ["已知利用", finding.known_exploited ? "CISA KEV" : undefined],
            ["受影响版本", finding.affected_version],
            ["资产", finding.asset_id ? assetLabels.get(finding.asset_id) ?? `#${finding.asset_id}` : undefined],
            ["支持关系边", finding.edge_id ? `#${finding.edge_id}` : undefined],
            ["更新时间", formatDateTime(finding.updated_at)],
          ]} />
          {finding.evidence ? <p className="project-finding-evidence">{finding.evidence}</p> : null}
          {finding.remediation ? <p className="project-finding-remediation">{finding.remediation}</p> : null}
        </article>
      ))}
    </div>
  );
}

export function AttackPathList({ assets, graph }: { assets: WorkProjectAsset[]; graph: WorkProjectGraphSnapshot }) {
  const assetLabels = useAssetLabels(assets);
  const edgesById = useMemo(() => new Map(graph.edges.map((edge) => [edge.id, edge])), [graph.edges]);
  if (!graph.attack_paths.length) return <RecordEmpty title="暂无攻击路径。" />;
  const stepsByPath = groupSteps(graph.attack_path_steps);
  return (
    <div className="project-record-list">
      {graph.attack_paths.map((path) => (
        <article key={path.id} className="project-record-row project-attack-path">
          <header>
            <strong>{path.title}</strong>
            <Tag color={WORK_PROJECT_ATTACK_PATH_STATUS_COLOR[path.status]}>{WORK_PROJECT_ATTACK_PATH_STATUS_LABEL[path.status]}</Tag>
          </header>
          {path.summary ? <p>{path.summary}</p> : null}
          <ol>
            {(stepsByPath.get(path.id) ?? []).map((step) => {
              const edge = edgesById.get(step.edge_id);
              return (
                <li key={step.id}>
                  <strong>{edgeLabel(edge, assetLabels)}</strong>
                  {edge?.label ? <span>{edge.label}</span> : null}
                </li>
              );
            })}
          </ol>
        </article>
      ))}
    </div>
  );
}

export function GraphView({ assets, graph }: { assets: WorkProjectAsset[]; graph: WorkProjectGraphSnapshot }) {
  if (!assets.length) return <RecordEmpty title="暂无可绘制的资产。" />;
  return <ProjectGraphCanvas assets={assets} edges={graph.edges} />;
}

function useAssetLabels(assets: WorkProjectAsset[]) {
  return useMemo(() => new Map(assets.map((asset) => [asset.id, formatWorkProjectAsset(asset)])), [assets]);
}

function edgeLabel(edge: WorkProjectGraphEdge | undefined, assetLabels: Map<number, string>): string {
  if (!edge) return "未知关系边";
  const source = assetLabels.get(edge.source_asset_id) ?? `#${edge.source_asset_id}`;
  const target = assetLabels.get(edge.target_asset_id) ?? `#${edge.target_asset_id}`;
  return `${source} → ${target}`;
}

function RecordDetails({ className, items }: { className?: string; items: DetailItem[] }) {
  const visible = filledDetailItems(items);
  if (!visible.length) return null;
  return (
    <div className={cx("project-record-details", className)}>
      {visible.map(([label, value]) => (
        <span key={label}><strong>{label}</strong>{value}</span>
      ))}
    </div>
  );
}

function assetBaseMeta(asset: WorkProjectAsset): DetailItem[] {
  if (asset.type === WORK_PROJECT_ASSET_TYPE.BINARY) {
    return [["Path", asset.path]];
  }
  return [
    ["Host", asset.host],
    ["Port", asset.port?.toString()],
  ];
}

function RecordEmpty({ title }: { title: string }) {
  return <Empty className="empty-state" image={<FileText size={42} />} title={title} description="" />;
}

function TabLabel({ icon, text }: { icon: ReactNode; text: string }) {
  return <span className="workspace-tab-label">{icon}{text}</span>;
}

function groupSteps(steps: WorkProjectAttackPathStep[]) {
  const map = new Map<number, WorkProjectAttackPathStep[]>();
  for (const step of steps) {
    const items = map.get(step.path_id) ?? [];
    items.push(step);
    map.set(step.path_id, items);
  }
  for (const items of map.values()) items.sort((a, b) => a.sequence - b.sequence);
  return map;
}
