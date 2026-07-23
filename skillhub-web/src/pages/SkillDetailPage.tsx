import { Download, PackageCheck, ShieldAlert, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { downloadUrl, getSkill, rateSkill, setStar } from "../api";
import type { HubUser, SkillDetail } from "../types";

export function SkillDetailPage({ user }: { user: HubUser | null }) {
  const { namespace = "", slug = "" } = useParams();
  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function reload() {
    getSkill(namespace, slug).then(setSkill).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Skill 加载失败");
    });
  }

  useEffect(reload, [namespace, slug]);

  async function toggleStar() {
    if (!skill || !user || busy) return;
    setBusy(true);
    try {
      await setStar(namespace, slug, !skill.starred);
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function rate(score: number) {
    if (!skill || !user || busy) return;
    setBusy(true);
    try {
      await rateSkill(namespace, slug, score);
      reload();
    } finally {
      setBusy(false);
    }
  }

  if (error) return <main className="content-shell"><div className="error-banner">{error}</div></main>;
  if (!skill) return <main className="content-shell"><div className="empty-state">正在加载 Skill…</div></main>;

  return (
    <main className="content-shell">
      <section className="detail-header">
        <div>
          <div className="skill-card-topline">
            <span className="namespace-pill">@{skill.namespace}</span>
            <span className="version-pill">v{skill.latest_version}</span>
          </div>
          <h1>{skill.name}</h1>
          <p>{skill.summary}</p>
          <div className="tag-row">
            {skill.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        </div>
        <div className="detail-actions">
          {user ? (
            <button className="secondary-button" disabled={busy} onClick={toggleStar}>
              <Star size={17} fill={skill.starred ? "currentColor" : "none"} />
              {skill.starred ? "已收藏" : "收藏"} · {skill.stars}
            </button>
          ) : (
            <Link className="secondary-button" to="/auth">登录后收藏</Link>
          )}
          <a className="primary-button" href={downloadUrl(namespace, slug, skill.latest_version)}>
            <Download size={17} />下载 v{skill.latest_version}
          </a>
        </div>
      </section>

      <div className="detail-layout">
        <article className="skill-readme">
          <span className="section-kicker">SKILL README</span>
          <div className="markdown-plain">{skill.description}</div>
        </article>
        <aside className="detail-aside">
          <section>
            <h3>包信息</h3>
            <dl>
              <div><dt>作者</dt><dd>@{skill.author_username}</dd></div>
              <div><dt>下载</dt><dd>{skill.downloads}</dd></div>
              <div><dt>评分</dt><dd>{skill.rating_count ? `${skill.rating_average.toFixed(1)} / 5` : "暂无"}</dd></div>
            </dl>
            {user && (
              <div className="rating-picker">
                {[1, 2, 3, 4, 5].map((score) => (
                  <button
                    key={score}
                    className={(skill.my_rating || 0) >= score ? "active" : ""}
                    onClick={() => rate(score)}
                    aria-label={`${score} 星`}
                  >
                    ★
                  </button>
                ))}
              </div>
            )}
          </section>
          <section>
            <h3>版本</h3>
            <div className="version-list">
              {skill.versions.map((version) => (
                <div key={version.version}>
                  {version.scan_status === "passed" ? <PackageCheck /> : <ShieldAlert />}
                  <span>
                    <strong>v{version.version}</strong>
                    <small>{new Date(version.published_at).toLocaleDateString("zh-CN")} · {(version.size_bytes / 1024).toFixed(1)} KB</small>
                    {version.changelog && <p>{version.changelog}</p>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
