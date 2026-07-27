import { Button, Input, Toast } from "@douyinfe/semi-ui";
import { LogIn, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../shared/auth/AuthProvider";

type AuthMode = "login" | "register";

export function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (mode === "login") {
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
      Toast.success(mode === "login" ? "登录成功" : "注册成功");
      navigate("/playground", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "认证失败");
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
            <span>统一账号登录</span>
            <h1>真君安全协作工作台</h1>
            <p>登录后进入主工作台，Skill Hub、执行工作区和系统管理使用同一个当前用户身份。</p>
          </div>
        </div>

        <div className="auth-gate-card">
          <div className="auth-gate-tabs" role="tablist" aria-label="认证方式">
            <button
              type="button"
              className={mode === "login" ? "active" : ""}
              aria-selected={mode === "login"}
              onClick={() => setMode("login")}
            >
              <LogIn size={16} />登录
            </button>
            <button
              type="button"
              className={mode === "register" ? "active" : ""}
              aria-selected={mode === "register"}
              onClick={() => setMode("register")}
            >
              <UserPlus size={16} />注册
            </button>
          </div>
          <form className="auth-gate-form" onSubmit={submit}>
            {mode === "register" ? (
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
                minLength={mode === "register" ? 8 : 1}
                maxLength={200}
                required
                placeholder={mode === "register" ? "至少 8 个字符" : "输入密码"}
              />
            </label>
            {error ? <div className="auth-gate-error" role="alert">{error}</div> : null}
            <Button
              block
              htmlType="submit"
              theme="solid"
              type="primary"
              loading={busy}
              icon={mode === "login" ? <LogIn size={16} /> : <UserPlus size={16} />}
            >
              {mode === "login" ? "登录工作台" : "创建账号"}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
