import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Application render failed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <AppErrorScreen error={error} />;
  }
}

export function AppRouteErrorBoundary() {
  const routeError = useRouteError();
  const error = normalizeRouteError(routeError);

  useEffect(() => {
    console.error("Route render failed", routeError);
  }, [routeError]);

  return <AppErrorScreen error={error} />;
}

function AppErrorScreen({ error }: { error: Error }) {
  return (
    <main className="app-error-screen" role="alert">
      <section className="app-error-card">
        <span className="app-error-mark" aria-hidden="true">!</span>
        <div className="app-error-copy">
          <h1>页面暂时无法显示</h1>
          <p>当前操作没有完成。可以重新加载此页面，或返回对话工作区继续使用。</p>
        </div>
        <div className="app-error-actions">
          <button type="button" className="app-error-primary" onClick={() => window.location.reload()}>
            重新加载
          </button>
          <button type="button" className="app-error-secondary" onClick={() => window.location.assign("/playground")}>
            返回对话
          </button>
        </div>
        <details className="app-error-details">
          <summary>查看错误信息</summary>
          <code>{error.message || error.name || "未知页面错误"}</code>
        </details>
      </section>
    </main>
  );
}

function normalizeRouteError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (isRouteErrorResponse(value)) {
    const detail = typeof value.data === "string" ? value.data : value.statusText;
    return new Error([value.status, detail].filter(Boolean).join(" "));
  }
  return new Error(typeof value === "string" ? value : "未知页面错误");
}
