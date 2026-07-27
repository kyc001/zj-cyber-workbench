import { Button, Input, Popconfirm, Select, Spin, Toast } from "@douyinfe/semi-ui";
import {
  Download,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  UserCircle,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getHubSkill,
  installHubSkill,
  listHubSkills,
  listInstalledHubSkills,
  uninstallHubSkill,
  type HubSkillDetail,
  type HubSkillSummary,
  type InstalledHubSkill,
} from "../../shared/api/skillHub";
import { useAuth } from "../../shared/auth/AuthProvider";
import "./skill-hub.css";

const PORTAL_URL = import.meta.env.VITE_SKILL_HUB_PORTAL_URL || "http://118.31.221.165:3011";

export function SkillHubPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [skills, setSkills] = useState<HubSkillSummary[]>([]);
  const [installed, setInstalled] = useState<InstalledHubSkill[]>([]);
  const [selected, setSelected] = useState<HubSkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoadingKey, setDetailLoadingKey] = useState("");
  const [mutationBusyKey, setMutationBusyKey] = useState("");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const loadRequestRef = useRef(0);
  const installedRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const mutationBusyRef = useRef("");
  const detailCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestRef.current += 1;
      installedRequestRef.current += 1;
      detailRequestRef.current += 1;
      mutationBusyRef.current = "";
    };
  }, []);

  const installedByName = useMemo(
    () => new Map(installed.map((item) => [item.name, item])),
    [installed],
  );

  const loadInstalled = useCallback(async () => {
    const requestId = installedRequestRef.current + 1;
    installedRequestRef.current = requestId;
    const response = await listInstalledHubSkills();
    if (mountedRef.current && installedRequestRef.current === requestId) {
      setInstalled(response.data?.items || []);
    }
  }, []);

  const loadSkills = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const [market] = await Promise.all([
        listHubSkills({ q: activeQuery, sort }),
        loadInstalled(),
      ]);
      if (!mountedRef.current || loadRequestRef.current !== requestId) return;
      setSkills(market.data?.items || []);
    } catch (reason) {
      if (mountedRef.current && loadRequestRef.current === requestId) {
        setError(reason instanceof Error ? reason.message : "Skill Hub 暂时不可用");
      }
    } finally {
      if (mountedRef.current && loadRequestRef.current === requestId) setLoading(false);
    }
  }, [activeQuery, loadInstalled, sort]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setDetailLoadingKey("");
    setSelected(null);
  }, []);

  useEffect(() => {
    if (!selected) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => detailCloseRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [closeDetail, selected]);

  async function openDetail(skill: HubSkillSummary) {
    const key = `${skill.namespace}/${skill.slug}`;
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setDetailLoadingKey(key);
    try {
      const response = await getHubSkill(skill.namespace, skill.slug);
      if (mountedRef.current && detailRequestRef.current === requestId) {
        setSelected(response.data || null);
      }
    } catch (reason) {
      if (!mountedRef.current || detailRequestRef.current !== requestId) return;
      Toast.error(reason instanceof Error ? reason.message : "详情加载失败");
    } finally {
      if (mountedRef.current && detailRequestRef.current === requestId) setDetailLoadingKey("");
    }
  }

  async function install(skill: HubSkillSummary | HubSkillDetail) {
    const key = `${skill.namespace}/${skill.slug}`;
    if (mutationBusyRef.current) return;
    mutationBusyRef.current = key;
    setMutationBusyKey(key);
    try {
      const response = await installHubSkill({
        namespace: skill.namespace,
        slug: skill.slug,
        version: skill.latest_version,
      });
      if (!mountedRef.current) return;
      Toast.success(response.data?.updated ? "Skill 已更新" : "Skill 已安装");
      await loadInstalled();
    } catch (reason) {
      if (mountedRef.current) Toast.error(reason instanceof Error ? reason.message : "安装失败");
    } finally {
      if (mutationBusyRef.current === key) mutationBusyRef.current = "";
      if (mountedRef.current) setMutationBusyKey("");
    }
  }

  async function uninstall(item: InstalledHubSkill) {
    if (mutationBusyRef.current) return;
    mutationBusyRef.current = item.name;
    setMutationBusyKey(item.name);
    try {
      await uninstallHubSkill(item.name);
      if (!mountedRef.current) return;
      Toast.success("Skill 已卸载");
      await loadInstalled();
    } catch (reason) {
      if (mountedRef.current) Toast.error(reason instanceof Error ? reason.message : "卸载失败");
    } finally {
      if (mutationBusyRef.current === item.name) mutationBusyRef.current = "";
      if (mountedRef.current) setMutationBusyKey("");
    }
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (nextQuery === activeQuery) {
      void loadSkills();
      return;
    }
    setActiveQuery(nextQuery);
  }

  return (
    <div className="zj-hub-page">
      <section className="zj-hub-hero">
        <div>
          <span className="zj-hub-kicker"><ShieldCheck size={15} />COMMUNITY SKILL REGISTRY</span>
          <h2>发现经过结构校验的<br />社区 Agent Skills</h2>
          <p>安装包会在本机再次验证 SHA-256、路径和 SKILL.md 元数据，随后写入可回滚的自定义 Skill 目录。</p>
          <form onSubmit={submitSearch} className="zj-hub-search">
            <Search size={18} />
            <Input
              value={query}
              onChange={setQuery}
              placeholder="搜索安全、运维、审计或自动化 Skills"
              showClear
            />
            <Button htmlType="submit" theme="solid" type="primary">搜索</Button>
          </form>
        </div>
        <div className="zj-hub-hero-actions">
          <div className="zj-hub-action-row">
            <Button icon={<RefreshCw size={16} />} loading={loading} onClick={loadSkills}>刷新</Button>
            <Button
              icon={<ExternalLink size={16} />}
              onClick={() => window.open(PORTAL_URL, "_blank", "noopener,noreferrer")}
            >
              打开发布门户
            </Button>
          </div>
          <section className="zj-hub-auth-panel" aria-label="Skill Hub 身份状态">
            <span className="zj-hub-auth-status"><UserCircle size={16} />已接入主工作台身份</span>
            <strong>{user?.display_name || user?.username || "当前用户"}</strong>
            <small>{user?.email || "desktop@localhost"} · {user?.role || "user"}</small>
            <p>Skill Hub 的浏览、安装和卸载权限由当前工作台账号统一控制。</p>
          </section>
        </div>
      </section>

      <section className="zj-hub-toolbar">
        <div>
          <strong>{activeQuery ? `“${activeQuery}” 的结果` : "社区市场"}</strong>
          <span>{skills.length} 个 Skill · 本机已安装 {installed.length} 个</span>
        </div>
        <Select
          value={sort}
          onChange={(value) => setSort(String(value))}
          optionList={[
            { label: "最近更新", value: "recent" },
            { label: "下载最多", value: "downloads" },
            { label: "收藏最多", value: "stars" },
            { label: "评分最高", value: "rating" },
          ]}
        />
      </section>

      {error && (
        <div className="zj-hub-error" role="alert">
          <span>{error}</span>
          <Button size="small" icon={<RefreshCw size={14} />} onClick={loadSkills}>重试</Button>
        </div>
      )}
      {loading ? (
        <div className="zj-hub-loading"><Spin size="large" /><span>正在连接 Skill Hub…</span></div>
      ) : skills.length ? (
        <div className="zj-hub-grid">
          {skills.map((skill) => {
            const local = installedByName.get(skill.slug);
            const key = `${skill.namespace}/${skill.slug}`;
            const updating = local && local.version !== skill.latest_version;
            return (
              <article className="zj-hub-card" key={key}>
                <button
                  className="zj-hub-card-body"
                  disabled={detailLoadingKey === key}
                  aria-busy={detailLoadingKey === key}
                  onClick={() => openDetail(skill)}
                >
                  <div className="zj-hub-card-meta">
                    <span>@{skill.namespace}</span>
                    <span>v{skill.latest_version}</span>
                    {detailLoadingKey === key ? <Spin size="small" /> : null}
                  </div>
                  <h3>{skill.name}</h3>
                  <p>{skill.summary}</p>
                  <div className="zj-hub-tags">
                    {skill.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                  <div className="zj-hub-stats">
                    <span><Download size={14} />{skill.downloads}</span>
                    <span><Star size={14} />{skill.stars}</span>
                    <span>{skill.rating_count ? `${skill.rating_average.toFixed(1)} 分` : "暂无评分"}</span>
                  </div>
                </button>
                <div className="zj-hub-card-actions">
                  {local ? (
                    <>
                      <span className="zj-hub-installed"><PackageCheck size={14} />已安装 v{local.version}</span>
                      {updating && (
                        <Button
                          size="small"
                          theme="solid"
                          loading={mutationBusyKey === key}
                          disabled={Boolean(mutationBusyKey)}
                          onClick={() => install(skill)}
                        >
                          更新
                        </Button>
                      )}
                      <Popconfirm
                        title="卸载 Skill"
                        content={`确定卸载 ${local.name}？本地安装的文件将被移除。`}
                        okText="卸载"
                        cancelText="取消"
                        okType="danger"
                        onConfirm={() => void uninstall(local)}
                      >
                        <Button
                          size="small"
                          type="danger"
                          theme="borderless"
                          icon={<Trash2 size={14} />}
                          loading={mutationBusyKey === local.name}
                          disabled={Boolean(mutationBusyKey)}
                          aria-label={`卸载 ${local.name}`}
                        />
                      </Popconfirm>
                    </>
                  ) : (
                    <Button
                      size="small"
                      theme="solid"
                      type="primary"
                      loading={mutationBusyKey === key}
                      disabled={Boolean(mutationBusyKey)}
                      onClick={() => install(skill)}
                    >
                      安装
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="zj-hub-empty">没有找到匹配的 Skill。</div>
      )}

      {selected && (
        <div className="zj-hub-detail-backdrop" role="presentation" onClick={closeDetail}>
          <aside
            className="zj-hub-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="skill-hub-detail-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button ref={detailCloseRef} className="zj-hub-detail-close" aria-label="关闭 Skill 详情" onClick={closeDetail}>×</button>
            <span className="zj-hub-kicker">@{selected.namespace} · v{selected.latest_version}</span>
            <h2 id="skill-hub-detail-title">{selected.name}</h2>
            <p className="zj-hub-detail-summary">{selected.summary}</p>
            <div className="zj-hub-detail-readme">{selected.description}</div>
            <div className="zj-hub-detail-versions">
              <strong>版本历史</strong>
              {selected.versions.map((version) => (
                <div key={version.version}>
                  <PackageCheck size={16} />
                  <span><b>v{version.version}</b><small>{version.changelog || "无更新说明"}</small></span>
                </div>
              ))}
            </div>
            <Button
              block
              theme="solid"
              type="primary"
              loading={mutationBusyKey === `${selected.namespace}/${selected.slug}`}
              disabled={Boolean(mutationBusyKey)}
              onClick={() => install(selected)}
            >
              {installedByName.has(selected.slug) ? "重新安装 / 更新" : "安装到 ZJ"}
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}
