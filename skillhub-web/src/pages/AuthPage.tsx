import { FormEvent, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { login, register, storeToken } from "../api";
import type { HubUser } from "../types";

type AuthPageProps = {
  user: HubUser | null;
  onAuthenticated: (user: HubUser) => void;
};

export function AuthPage({ user, onAuthenticated }: AuthPageProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  if (user) return <Navigate to="/dashboard" replace />;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = mode === "login"
        ? await login({
            username_or_email: String(form.get("identity") || ""),
            password: String(form.get("password") || ""),
          })
        : await register({
            username: String(form.get("username") || ""),
            email: String(form.get("email") || ""),
            display_name: String(form.get("display_name") || ""),
            password: String(form.get("password") || ""),
          });
      storeToken(response.access_token);
      onAuthenticated(response.user);
      const target = (location.state as { from?: string } | null)?.from || "/dashboard";
      navigate(target, { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "认证失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <div className="auth-intro">
          <span className="section-kicker">BUILD ONCE · SHARE EVERYWHERE</span>
          <h1>加入 Skill<br />创造者社区</h1>
          <p>每个账户自动获得个人命名空间。发布不可变版本，让团队和 Agent 安全复用你的工作流。</p>
          <div className="auth-feature-list">
            <span>语义版本与 SHA-256 校验</span>
            <span>自动包结构与敏感信息扫描</span>
            <span>ZJ 工作台一键安装与更新</span>
          </div>
        </div>
        <div className="auth-form-card">
          <div className="auth-tabs">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button>
            <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册</button>
          </div>
          <form onSubmit={submit}>
            {mode === "register" && (
              <>
                <label>用户名<input name="username" required minLength={3} placeholder="lowercase-name" /></label>
                <label>显示名称<input name="display_name" required placeholder="你的名字或团队名" /></label>
                <label>邮箱<input name="email" required type="email" placeholder="you@example.com" /></label>
              </>
            )}
            {mode === "login" && (
              <label>用户名或邮箱<input name="identity" required autoFocus placeholder="username@example.com" /></label>
            )}
            <label>密码<input name="password" required type="password" minLength={8} placeholder="至少 8 个字符" /></label>
            {error && <div className="form-error">{error}</div>}
            <button className="primary-button full-width" disabled={busy} type="submit">
              {busy ? "请稍候…" : mode === "login" ? "登录 Skill Hub" : "创建账户"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
