import { FileArchive, ShieldCheck, UploadCloud } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { listNamespaces, publishSkill } from "../api";
import type { HubNamespace, HubUser } from "../types";

export function PublishPage({ user }: { user: HubUser | null }) {
  const [namespaces, setNamespaces] = useState<HubNamespace[]>([]);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (user) listNamespaces().then(setNamespaces).catch(() => setNamespaces([]));
  }, [user]);

  if (!user) return <Navigate to="/auth" state={{ from: "/publish" }} replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const skill = await publishSkill(form);
      navigate(`/skills/${skill.namespace}/${skill.slug}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="content-shell">
      <div className="page-heading">
        <span className="section-kicker">PUBLISH A VERSION</span>
        <h1>发布 Skill 包</h1>
        <p>每次发布都是不可变版本。相同命名空间、名称和版本不能覆盖。</p>
      </div>
      <div className="publish-layout">
        <form className="publish-form" onSubmit={submit}>
          <div className="form-grid">
            <label>
              命名空间
              <select name="namespace" required>
                {namespaces.map((namespace) => (
                  <option key={namespace.slug} value={namespace.slug}>@{namespace.slug}</option>
                ))}
              </select>
            </label>
            <label>
              Skill 名称
              <input name="slug" required pattern="[a-z0-9][a-z0-9-]*" placeholder="incident-helper" />
            </label>
            <label>
              语义版本
              <input name="version" required placeholder="1.0.0" />
            </label>
            <label>
              可见范围
              <select name="visibility" defaultValue="public">
                <option value="public">公开</option>
                <option value="namespace">仅命名空间</option>
              </select>
            </label>
          </div>
          <label>
            更新说明
            <textarea name="changelog" rows={4} placeholder="说明本版本新增、修复或不兼容变更" />
          </label>
          <label className="upload-zone">
            <UploadCloud size={34} />
            <strong>{fileName || "选择 Skill ZIP 包"}</strong>
            <span>必须包含 SKILL.md，最大 10 MB</span>
            <input
              name="package"
              type="file"
              accept=".zip,application/zip"
              required
              onChange={(event) => setFileName(event.target.files?.[0]?.name || "")}
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button" type="submit" disabled={busy || !namespaces.length}>
            {busy ? "正在校验并发布…" : "发布不可变版本"}
          </button>
        </form>
        <aside className="publish-aside">
          <h3>发布前自动检查</h3>
          <div><FileArchive /><span><strong>包结构</strong>路径穿越、符号链接、体积和文件类型</span></div>
          <div><ShieldCheck /><span><strong>内容安全</strong>Frontmatter、名称、凭据与高风险命令模式</span></div>
          <p>Hub 不会运行上传包内的任何脚本。通过校验不代表 Skill 内容受到官方背书，安装前仍应阅读源码。</p>
        </aside>
      </div>
    </main>
  );
}
