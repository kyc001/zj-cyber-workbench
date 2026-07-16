import { Button, Empty, Input, Select, Spin, Tag } from "@douyinfe/semi-ui";
import { DatabaseZap, PackageSearch, Radar, Save, ServerCog, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { discoverWorkProjectCves, importWorkProjectCve } from "../../shared/api/workProjects";
import { showApiError, showApiSuccess } from "../../shared/api/feedback";
import type {
  CveCandidate,
  CveDiscoveryMode,
  CveMatchConfidence,
  WorkProjectAsset,
} from "../../shared/api/types";
import { WORK_PROJECT_FINDING_SEVERITY_COLOR, WORK_PROJECT_FINDING_SEVERITY_LABEL } from "../../shared/lib/labels";
import { formatWorkProjectAsset } from "./workProjectView";

type Props = {
  projectId: number;
  assets: WorkProjectAsset[];
  onImported?: () => void;
};

const CONFIDENCE_LABEL: Record<CveMatchConfidence, string> = {
  exact: "精确匹配",
  high: "高可信",
  medium: "待核版本",
  low: "弱候选",
};

export function CveDiscoveryPanel({ projectId, assets, onImported }: Props) {
  const [mode, setMode] = useState<CveDiscoveryMode>("service");
  const [assetId, setAssetId] = useState<number | undefined>();
  const [vendor, setVendor] = useState("");
  const [product, setProduct] = useState("");
  const [version, setVersion] = useState("");
  const [cpe, setCpe] = useState("");
  const [ecosystem, setEcosystem] = useState("PyPI");
  const [packageName, setPackageName] = useState("");
  const [items, setItems] = useState<CveCandidate[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");

  const assetOptions = useMemo(
    () => assets.map((asset) => ({ label: formatWorkProjectAsset(asset), value: asset.id })),
    [assets],
  );

  const canSearch = mode === "service"
    ? Boolean(cpe.trim() || product.trim())
    : Boolean(ecosystem.trim() && packageName.trim() && version.trim());

  async function search() {
    setLoading(true);
    try {
      const response = await discoverWorkProjectCves(projectId, {
        mode,
        asset_id: assetId,
        vendor,
        product,
        version,
        cpe,
        ecosystem,
        package_name: packageName,
        limit: 20,
      });
      setItems(response.data?.items ?? []);
      setWarnings(response.data?.warnings ?? []);
      setQuery(response.data?.query ?? "");
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  }

  async function save(candidate: CveCandidate) {
    setSavingId(candidate.cve_id);
    try {
      const response = await importWorkProjectCve(projectId, {
        asset_id: assetId,
        candidate,
        affected_version: version,
      });
      showApiSuccess(response);
      onImported?.();
    } catch (error) {
      showApiError(error);
    } finally {
      setSavingId("");
    }
  }

  return (
    <div className="cve-workbench">
      <div className="cve-query-bar">
        <div className="cve-mode-switch" role="group" aria-label="CVE 查询模式">
          <Button
            icon={<ServerCog size={15} />}
            type={mode === "service" ? "primary" : "tertiary"}
            theme={mode === "service" ? "solid" : "borderless"}
            onClick={() => setMode("service")}
          >服务 / 中间件</Button>
          <Button
            icon={<PackageSearch size={15} />}
            type={mode === "package" ? "primary" : "tertiary"}
            theme={mode === "package" ? "solid" : "borderless"}
            onClick={() => setMode("package")}
          >软件依赖</Button>
        </div>
        <Select
          className="cve-asset-select"
          placeholder="关联资产"
          optionList={assetOptions}
          value={assetId}
          onChange={(value) => setAssetId(typeof value === "number" ? value : undefined)}
          showClear
        />
        {mode === "service" ? (
          <>
            <Input value={vendor} onChange={setVendor} placeholder="厂商（可选）" />
            <Input value={product} onChange={setProduct} placeholder="产品，例如 nginx" />
            <Input value={version} onChange={setVersion} placeholder="版本，例如 1.24.0" />
            <Input className="cve-cpe-input" value={cpe} onChange={setCpe} placeholder="CPE 2.3（可选）" />
          </>
        ) : (
          <>
            <Select
              value={ecosystem}
              onChange={(value) => setEcosystem(String(value))}
              optionList={["PyPI", "npm", "Maven", "Go", "NuGet", "RubyGems", "crates.io"].map((value) => ({
                label: value,
                value,
              }))}
            />
            <Input value={packageName} onChange={setPackageName} placeholder="包名" />
            <Input value={version} onChange={setVersion} placeholder="精确版本" />
          </>
        )}
        <Button icon={<Radar size={16} />} type="primary" disabled={!canSearch} loading={loading} onClick={search}>
          查询
        </Button>
      </div>

      {warnings.length ? (
        <div className="cve-warnings">{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>
      ) : null}

      <Spin spinning={loading}>
        {items.length ? (
          <div className="cve-result-list">
            <div className="cve-result-summary"><DatabaseZap size={14} /><span>{query}</span><strong>{items.length}</strong></div>
            {items.map((candidate) => (
              <article className="cve-result-row" key={`${candidate.source}:${candidate.cve_id}`}>
                <header>
                  <div>
                    <strong>{candidate.cve_id}</strong>
                    <span>{candidate.title || candidate.description}</span>
                  </div>
                  <div>
                    <Tag color={WORK_PROJECT_FINDING_SEVERITY_COLOR[candidate.severity]}>
                      {WORK_PROJECT_FINDING_SEVERITY_LABEL[candidate.severity]}
                    </Tag>
                    <Tag>{CONFIDENCE_LABEL[candidate.match_confidence]}</Tag>
                    {candidate.known_exploited ? <Tag color="red">CISA KEV</Tag> : null}
                  </div>
                </header>
                <p>{candidate.description || "暂无摘要"}</p>
                <div className="cve-result-facts">
                  <span><strong>CVSS</strong>{candidate.cvss_score?.toFixed(1) ?? "-"}</span>
                  <span><strong>EPSS</strong>{candidate.epss_score == null ? "-" : `${(candidate.epss_score * 100).toFixed(1)}%`}</span>
                  <span><strong>来源</strong>{candidate.source}</span>
                  <span><strong>修复版本</strong>{candidate.fixed_versions?.join(", ") || "待核"}</span>
                </div>
                <div className="cve-result-footer">
                  <span>{candidate.match_reason}</span>
                  <Button
                    icon={<Save size={15} />}
                    loading={savingId === candidate.cve_id}
                    onClick={() => save(candidate)}
                  >加入发现</Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            className="empty-state cve-empty"
            image={<ShieldAlert size={42} />}
            title={query ? "未返回匹配的 CVE" : "暂无 CVE 查询结果"}
            description=""
          />
        )}
      </Spin>
    </div>
  );
}
