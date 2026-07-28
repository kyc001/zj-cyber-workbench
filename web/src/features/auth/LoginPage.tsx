import { Button, Input, Spin, Toast } from "@douyinfe/semi-ui";
import { Cpu, LogIn, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { FormEvent, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../shared/auth/AuthProvider";
import { storeAccessToken } from "../../shared/auth/session";
import { apiPost } from "../../shared/api/client";
import type { AuthResponse } from "../../shared/api/auth";

type AuthMode = "login" | "register";
type Tab = "desktop" | "remote";

export function LoginPage() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<Tab>("remote");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const startDesktopSession = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      await apiPost<AuthResponse>("/api/auth/desktop-session");
      storeAccessToken("desktop");
      Toast.success("已进入本地工作会话");
      window.location.replace("/playground");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "启动会话失败");
    } finally {
      setBusy(false);
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (authMode === "login") {
        await login({
          username_or_email: String(form.get("identity") || ""),
          password: String(form.get("password") || ""),
        });
      } else {
        await register({
          username: String(form.get("username") || ""),
          email: String(form.get("email") || ""),
          display_name: String(form.get("display_name") || ""),
          password: String(form.get("password") || ""),
        });
      }
      Toast.success(authMode === "login" ? "登录成功" : "注册成功");
      navigate("/playground", { replace: true });
    } catch (reason) {
      if (reason instanceof Error) {
        // FastAPI returns validation error details in the response data.
        const detail = (reason as { response?: { data?: Array<{ loc: string[]; msg: string }> } }).response?.data
          ?.map((e) => e.msg)
          ?.join("；");
        setError(detail || reason.message);
      } else {
        setError("认证失败");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-gate">
      <section className="auth-gate-panel">
        <div className="auth-gate-intro">
          <div className="auth-gate-brand">
            <ShieldCheck size={34} />
            <span>ZJ</span>
          </div>
          <div className="auth-gate-copy">
            <span>{tab === "desktop" ? "本机工作会话" : "统一账号登录"}</span>
            <h1>真君安全协作工作台</h1>
            <p>
              {tab === "desktop"
                ? "首次启动需要确认本机工作身份。确认后下次打开将直接进入工作台。"
                : "使用 Skill Hub 统一账号登录，Skill Hub、执行工作区和系统管理使用同一个身份。"}
            </p>
          </div>
        </div>

        <div className="auth-gate-card">
          <div className="auth-gate-tabs" role="tablist" aria-label="认证方式">
            <button
              type="button"
              className={tab === "desktop" ? "active" : ""}
              aria-selected={tab === "desktop"}
              onClick={() => { setTab("desktop"); setError(""); }}
            >
              <Cpu size={16} />本机
            </button>
            <button
              type="button"
              className={tab === "remote" ? "active" : ""}
              aria-selected={tab === "remote"}
              onClick={() => { setTab("remote"); setError(""); }}
            >
              <LogIn size={16} />统一账号
            </button>
          </div>

          {tab === "desktop" ? (
            <div className="auth-gate-form">
              <p className="auth-desktop-hint">
                当前为<strong>本机模式</strong>，所有数据存储在本地。
              </p>
              {error ? <div className="auth-gate-error" role="alert">{error}</div> : null}
              <Button
                block
                theme="solid"
                type="primary"
                size="large"
                loading={busy}
                icon={<ShieldCheck size={18} />}
                onClick={startDesktopSession}
              >
                开始使用
              </Button>
            </div>
          ) : (
            <>
              <div className="auth-gate-subtabs" role="tablist" aria-label="账号操作">
                <button
                  type="button"
                  className={authMode === "login" ? "active" : ""}
                  aria-selected={authMode === "login"}
                  onClick={() => { setAuthMode("login"); setError(""); }}
                >
                  <LogIn size={14} />登录
                </button>
                <button
                  type="button"
                  className={authMode === "register" ? "active" : ""}
                  aria-selected={authMode === "register"}
                  onClick={() => { setAuthMode("register"); setError(""); }}
                >
                  <UserPlus size={14} />注册
                </button>
              </div>
              <form className="auth-gate-form" onSubmit={submit}>
                {authMode === "register" ? (
                  <>
                    <label>
                      <span>用户名</span>
                      <Input name="username" minLength={3} maxLength={32} required placeholder="kiwi" />
                    </label>
                    <label>
                      <span>显示名称</span>
                      <Input name="display_name" maxLength={80} required placeholder="安全运营成员" />
                    </label>
                    <label>
                      <span>邮箱</span>
                      <Input
                        name="email"
                        type="email"
                        maxLength={254}
                        prefix={<Mail size={16} />}
                        required
                        placeholder="you@example.com"
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    <span>用户名或邮箱</span>
                    <Input
                      name="identity"
                      minLength={3}
                      maxLength={254}
                      prefix={<Mail size={16} />}
                      required
                      autoFocus
                      placeholder="username@example.com"
                    />
                  </label>
                )}
                <label>
                  <span>密码</span>
                  <Input
                    name="password"
                    mode="password"
                    minLength={authMode === "register" ? 8 : 1}
                    maxLength={200}
                    required
                    placeholder={authMode === "register" ? "至少 8 个字符" : "输入密码"}
                  />
                </label>
                {error ? <div className="auth-gate-error" role="alert">{error}</div> : null}
                <Button
                  block
                  htmlType="submit"
                  theme="solid"
                  type="primary"
                  loading={busy}
                  icon={authMode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}
                >
                  {authMode === "login" ? "登录工作台" : "创建账号"}
                </Button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
