import { Toast } from "@douyinfe/semi-ui";
import { Check, Copy, LoaderCircle } from "lucide-react";
import {
  isValidElement,
  lazy,
  memo,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { copyTextToClipboard } from "../../shared/lib/clipboard";

const MARKDOWN_PLUGINS = [remarkGfm, remarkBreaks];
const MermaidDiagram = lazy(() => import("./MermaidDiagram").then((module) => ({
  default: module.MermaidDiagram,
})));

const MARKDOWN_COMPONENTS: Components = {
  a({ children, href, node: _node, ...props }) {
    const external = isExternalWebLink(href);
    return (
      <a
        {...props}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined}
      >
        {children}
      </a>
    );
  },
  img({ node: _node, ...props }) {
    return <img {...props} loading="lazy" decoding="async" />;
  },
  pre({ children, node: _node, ...props }) {
    const mermaidSource = mermaidBlockSource(children);
    if (mermaidSource !== null) {
      return (
        <Suspense
          fallback={(
            <div className="mermaid-diagram" role="status" aria-busy="true" aria-live="polite">
              <LoaderCircle className="transcript-action-spinner" size={18} />
              <span className="sr-only">正在加载 Mermaid 图表</span>
            </div>
          )}
        >
          <MermaidDiagram source={mermaidSource} />
        </Suspense>
      );
    }
    return <MarkdownCodeBlock {...props}>{children}</MarkdownCodeBlock>;
  },
  table({ children, node: _node, ...props }) {
    return <MarkdownTable {...props}>{children}</MarkdownTable>;
  },
};

function MarkdownRendererComponent({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={MARKDOWN_PLUGINS}
      components={MARKDOWN_COMPONENTS}
    >
      {markdown}
    </ReactMarkdown>
  );
}

export const MarkdownRenderer = memo(MarkdownRendererComponent);

function MarkdownTable({
  children,
  ...props
}: React.ComponentPropsWithoutRef<"table">) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [scrollable, setScrollable] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const table = tableRef.current;
    if (!container || !table) return;
    const syncScrollable = () => {
      const next = container.scrollWidth > container.clientWidth + 1;
      setScrollable((current) => current === next ? current : next);
    };
    syncScrollable();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncScrollable);
      return () => window.removeEventListener("resize", syncScrollable);
    }
    const observer = new ResizeObserver(syncScrollable);
    observer.observe(container);
    observer.observe(table);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div
      ref={containerRef}
      className="markdown-table-scroll"
      role={scrollable ? "region" : undefined}
      aria-label={scrollable ? "表格，可横向滚动" : undefined}
      tabIndex={scrollable ? 0 : undefined}
    >
      <table ref={tableRef} {...props}>{children}</table>
    </div>
  );
}

function MarkdownCodeBlock({
  children,
  ...props
}: React.ComponentPropsWithoutRef<"pre">) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied">("idle");
  const copyingRef = useRef(false);
  const source = codeBlockSource(children);
  const language = codeBlockLanguage(children);

  useEffect(() => {
    if (status !== "copied") return;
    const timer = window.setTimeout(() => setStatus("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [status]);

  const copy = async () => {
    if (copyingRef.current || !source) return;
    copyingRef.current = true;
    setStatus("copying");
    try {
      await copyTextToClipboard(source);
      setStatus("copied");
    } catch (error) {
      setStatus("idle");
      Toast.error(error instanceof Error ? error.message : "复制失败");
    } finally {
      copyingRef.current = false;
    }
  };

  const copyLabel = status === "copied" ? "已复制" : status === "copying" ? "正在复制" : "复制代码";
  return (
    <div className="markdown-code-block">
      {language ? <span className="markdown-code-language">{language}</span> : null}
      <button
        type="button"
        className="markdown-code-copy"
        disabled={!source || status === "copying"}
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => void copy()}
      >
        {status === "copied" ? <Check size={13} /> : status === "copying"
          ? <LoaderCircle className="transcript-action-spinner" size={13} />
          : <Copy size={13} />}
        <span>{status === "copied" ? "已复制" : "复制"}</span>
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

function mermaidBlockSource(children: ReactNode) {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string; children?: ReactNode }>(child)) return null;
  if (child.type !== "code" || !child.props.className?.split(/\s+/).includes("language-mermaid")) return null;
  return textContent(child.props.children).replace(/\n$/, "");
}

function codeBlockSource(children: ReactNode) {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ children?: ReactNode }>(child)) return textContent(children).replace(/\n$/, "");
  return textContent(child.props.children).replace(/\n$/, "");
}

function codeBlockLanguage(children: ReactNode) {
  const child = Array.isArray(children) ? children[0] : children;
  if (!isValidElement<{ className?: string }>(child)) return "";
  const languageClass = child.props.className?.split(/\s+/).find((value) => value.startsWith("language-"));
  return languageClass?.slice("language-".length) ?? "";
}

function isExternalWebLink(href: string | undefined) {
  return typeof href === "string" && /^https?:\/\//i.test(href);
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textContent(node.props.children);
  return "";
}
