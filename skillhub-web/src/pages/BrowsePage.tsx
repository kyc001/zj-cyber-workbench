import { Search, Sparkles } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { listSkills } from "../api";
import { SkillCard } from "../components/SkillCard";
import type { SkillList } from "../types";

export function BrowsePage() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [result, setResult] = useState<SkillList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listSkills({ q: activeQuery, sort })
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeQuery, sort]);

  function submit(event: FormEvent) {
    event.preventDefault();
    setActiveQuery(query.trim());
  }

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><Sparkles size={16} />开放的 Agent Skill 共享中心</div>
          <h1>把一次解决问题的方法，<br />变成所有 Agent 都能复用的能力。</h1>
          <p>发布、版本化、审查和安装标准化 Skill 包。兼容 ZJ、Codex、Claude Code 与其他 Agent Skills 工具。</p>
          <form className="hero-search" onSubmit={submit}>
            <Search size={20} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索安全分析、代码审计、运维自动化…"
            />
            <button type="submit">搜索</button>
          </form>
        </div>
        <div className="hero-orbit" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="hub-core">SKILL<br />HUB</div>
          <span className="node node-a">ZJ</span>
          <span className="node node-b">CODEX</span>
          <span className="node node-c">CLAUDE</span>
        </div>
      </section>

      <section className="catalog-section">
        <div className="section-heading">
          <div>
            <span className="section-kicker">COMMUNITY REGISTRY</span>
            <h2>{activeQuery ? `“${activeQuery}” 的搜索结果` : "发现社区 Skills"}</h2>
          </div>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recent">最近更新</option>
            <option value="downloads">下载最多</option>
            <option value="stars">收藏最多</option>
            <option value="rating">评分最高</option>
          </select>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <div className="empty-state">正在连接 Skill Hub…</div>
        ) : result?.items.length ? (
          <div className="skill-grid">
            {result.items.map((skill) => (
              <SkillCard key={`${skill.namespace}/${skill.slug}`} skill={skill} />
            ))}
          </div>
        ) : (
          <div className="empty-state">暂时没有匹配的 Skill。登录后发布第一个吧。</div>
        )}
      </section>
    </main>
  );
}
