import { Button, Checkbox, Input, InputNumber, Select, Spin, Tag, TextArea, Toast } from "@douyinfe/semi-ui";
import { Activity, Boxes, Download, Globe2, PackageSearch, Play, Radar, ShieldCheck, Square, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryAvailableSandboxContainers } from "../../shared/api/sandboxContainers";
import {
  buildToolArtifactUrl,
  cancelToolRun,
  getToolRun,
  listToolpackTools,
  startToolRun,
  type ExecutionArtifact,
  type ExecutionResult,
  type JsonSchemaProperty,
  type ToolInputSchema,
  type ToolRunSnapshot,
  type ToolSchema,
} from "../../shared/api/toolpack";
import { showApiError } from "../../shared/api/feedback";
import { SANDBOX_CONTAINER_STATUS } from "../../shared/api/generated/constants";
import type { SandboxContainer } from "../../shared/api/types";
import { ResourcePanel } from "../../shared/components/ResourcePageShell";
import { ResourceIdentity, ResourceText } from "../../shared/components/ResourceCells";
import { useAdminResourceHeader } from "../../shared/hooks/useAdminResourceHeader";
import { formatDateTime } from "../../shared/lib/date";
import { SANDBOX_CONTAINER_STATUS_COLOR, SANDBOX_CONTAINER_STATUS_LABEL } from "../../shared/lib/labels";

type ToolInputValues = Record<string, string | number | boolean | null>;
type ToolGroupId = "all" | "ops-basic" | "web" | "network" | "security" | "ssh";

type ToolMeta = {
  title: string;
  group: Exclude<ToolGroupId, "all">;
  description: string;
};

const TOOL_GROUPS: { id: ToolGroupId; label: string; icon: typeof Boxes }[] = [
  { id: "all", label: "全部工具", icon: Boxes },
  { id: "ops-basic", label: "常用诊断", icon: Activity },
  { id: "web", label: "Web 检查", icon: Globe2 },
  { id: "network", label: "网络检查", icon: Radar },
  { id: "security", label: "安全测试", icon: ShieldCheck },
  { id: "ssh", label: "SSH/Linux", icon: Wrench },
];

const TOOL_META: Record<string, ToolMeta> = {
  "local.system.info": {
    title: "系统信息",
    group: "ops-basic",
    description: "查看主机名、用户、系统版本、CPU、磁盘和运行时信息。",
  },
  "local.disk.usage": {
    title: "磁盘占用",
    group: "ops-basic",
    description: "统计指定路径的磁盘占用和体积最大的文件/目录。",
  },
  "local.process.list": {
    title: "进程列表",
    group: "ops-basic",
    description: "查看运行中进程，可按关键词过滤。",
  },
  "local.net.connections": {
    title: "网络连接",
    group: "network",
    description: "查看 TCP/UDP 连接或监听行，支持按状态关键词过滤。",
  },
  "local.env.check": {
    title: "环境检查",
    group: "ops-basic",
    description: "检查 PATH 和常用命令是否可用。",
  },
  "local.curl": {
    title: "受限 curl",
    group: "web",
    description: "执行受限 HTTP 请求，查看状态码、响应头和正文预览。",
  },
  "local.http.probe": {
    title: "HTTP 批量探测",
    group: "web",
    description: "批量检查 URL 状态码、耗时和基础响应信息。",
  },
  "local.dns.trace": {
    title: "DNS 追踪",
    group: "network",
    description: "查询 DNS 记录，并在可用时附带 nslookup 输出。",
  },
  "local.port.quickcheck": {
    title: "常用端口快检",
    group: "network",
    description: "按 common/web/db 模板快速检查常用端口。",
  },
  "local.log.tail": {
    title: "日志尾部",
    group: "ops-basic",
    description: "读取文本日志最后 N 行。",
  },
  "local.log.grep": {
    title: "日志搜索",
    group: "ops-basic",
    description: "在文本日志里搜索关键词或正则表达式。",
  },
  "local.file.hash": {
    title: "文件哈希",
    group: "ops-basic",
    description: "计算文件 SHA256 / SHA1 / MD5。",
  },
  "local.archive.inspect": {
    title: "压缩包查看",
    group: "ops-basic",
    description: "列出 zip/tar 压缩包内容，不解压文件。",
  },
  "ssh.system.info": {
    title: "SSH 系统信息",
    group: "ssh",
    description: "在 SSH Workspace 上查看主机系统、磁盘和运行时信息。",
  },
  "ssh.disk.usage": {
    title: "SSH 磁盘占用",
    group: "ssh",
    description: "在 SSH Workspace 上统计指定路径占用。",
  },
  "ssh.process.list": {
    title: "SSH 进程列表",
    group: "ssh",
    description: "在 SSH Workspace 上查看进程并按关键词过滤。",
  },
  "ssh.net.connections": {
    title: "SSH 网络连接",
    group: "ssh",
    description: "在 SSH Workspace 上查看 TCP/UDP 连接或监听状态。",
  },
  "ssh.env.check": {
    title: "SSH 环境检查",
    group: "ssh",
    description: "检查 SSH Workspace 上常用命令是否可用。",
  },
  "ssh.curl": {
    title: "SSH 受限 curl",
    group: "ssh",
    description: "从 SSH Workspace 发起受限 HTTP 请求。",
  },
  "ssh.http.probe": {
    title: "SSH HTTP 批量探测",
    group: "ssh",
    description: "从 SSH Workspace 批量检查 URL 状态。",
  },
  "ssh.dns.trace": {
    title: "SSH DNS 追踪",
    group: "ssh",
    description: "从 SSH Workspace 查询 DNS 记录。",
  },
  "ssh.port.quickcheck": {
    title: "SSH 常用端口快检",
    group: "ssh",
    description: "从 SSH Workspace 按模板检查常用端口。",
  },
  "ssh.log.tail": {
    title: "SSH 日志尾部",
    group: "ssh",
    description: "读取 SSH Workspace 可访问日志的最后 N 行。",
  },
  "ssh.log.grep": {
    title: "SSH 日志搜索",
    group: "ssh",
    description: "搜索 SSH Workspace 可访问的文本日志。",
  },
  "ssh.file.hash": {
    title: "SSH 文件哈希",
    group: "ssh",
    description: "计算 SSH Workspace 上文件的哈希值。",
  },
  "ssh.archive.inspect": {
    title: "SSH 压缩包查看",
    group: "ssh",
    description: "查看 SSH Workspace 上 zip/tar 压缩包内容。",
  },
  "local.webcheck": {
    title: "HTTP 健康检查",
    group: "ops-basic",
    description: "检查 URL 的状态码、耗时和常用响应头。",
  },
  "local.http.headers": {
    title: "HTTP 响应头",
    group: "web",
    description: "使用 HEAD 请求查看目标响应头，自动隐藏敏感 Set-Cookie。",
  },
  "local.tls.inspect": {
    title: "TLS 证书检查",
    group: "web",
    description: "查看证书有效期、签发者、SAN、TLS 版本和 cipher。",
  },
  "local.dns.lookup": {
    title: "DNS 解析",
    group: "network",
    description: "通过本机解析器查询 A / AAAA 记录。",
  },
  "local.ping": {
    title: "Ping 连通性",
    group: "network",
    description: "执行受限次数的 ping，查看基础可达性。",
  },
  "local.port.scan": {
    title: "端口探测",
    group: "network",
    description: "探测小范围 TCP 端口，最多 32 个端口。",
  },
  "local.httpx": {
    title: "httpx 探测",
    group: "security",
    description: "使用 ProjectDiscovery httpx 进行 HTTP 服务探测。",
  },
  "local.dnsx": {
    title: "dnsx 解析",
    group: "security",
    description: "使用 ProjectDiscovery dnsx 进行 DNS 解析。",
  },
  "local.ffuf": {
    title: "ffuf 目录扫描",
    group: "security",
    description: "执行受限 ffuf FUZZ 任务，限制速率和参数。",
  },
  "ssh.nmap": {
    title: "nmap 扫描",
    group: "ssh",
    description: "在 SSH Linux workspace 中运行 nmap。",
  },
  "ssh.sqlmap": {
    title: "sqlmap 检测",
    group: "ssh",
    description: "在 SSH Linux workspace 中运行低风险 sqlmap 探测模板。",
  },
};

const FIELD_LABELS: Record<string, string> = {
  url: "URL",
  target: "目标",
  host: "主机",
  domain: "域名",
  ports: "端口",
  port: "端口",
  method: "方法",
  count: "次数",
  timeout_seconds: "超时秒数",
  server_name: "SNI",
  wordlist: "字典文件",
  rps: "每秒请求",
  concurrency: "并发",
  path: "路径",
  max_depth: "最大深度",
  top_n: "显示数量",
  keyword: "关键词",
  limit: "数量限制",
  state: "连接状态",
  tools: "工具列表",
  urls: "URL 列表",
  body: "请求体",
  record_type: "记录类型",
  profile: "端口模板",
  lines: "行数",
  pattern: "搜索模式",
  ignore_case: "忽略大小写",
  max_matches: "最大匹配数",
  algorithm: "算法",
  max_entries: "最大条目数",
};

const RUN_STATUS_COLOR: Record<ToolRunSnapshot["status"], "blue" | "green" | "red" | "grey" | "orange"> = {
  running: "blue",
  completed: "green",
  failed: "red",
  canceled: "grey",
};

const RUN_STATUS_LABEL: Record<ToolRunSnapshot["status"], string> = {
  running: "运行中",
  completed: "完成",
  failed: "失败",
  canceled: "已取消",
};

const BACKEND_COLOR: Record<ToolSchema["backend"], "cyan" | "violet"> = {
  local: "cyan",
  ssh: "violet",
};

export function ToolpackPage() {
  const [workspaces, setWorkspaces] = useState<SandboxContainer[]>([]);
  const [workspaceId, setWorkspaceId] = useState<number | undefined>();
  const [tools, setTools] = useState<ToolSchema[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<ToolGroupId>("all");
  const [selectedToolId, setSelectedToolId] = useState<string>("");
  const [inputs, setInputs] = useState<ToolInputValues>({});
  const [timeoutSeconds, setTimeoutSeconds] = useState<number | undefined>();
  const [run, setRun] = useState<ToolRunSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const runRef = useRef<ToolRunSnapshot | null>(null);

  const selectedTool = useMemo(
    () => tools.find((tool) => tool.id === selectedToolId) ?? tools[0] ?? null,
    [selectedToolId, tools],
  );

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
    [workspaceId, workspaces],
  );

  const groupedCounts = useMemo(() => {
    const counts: Record<ToolGroupId, number> = { all: tools.length, "ops-basic": 0, web: 0, network: 0, security: 0, ssh: 0 };
    tools.forEach((tool) => {
      counts[toolMeta(tool).group] += 1;
    });
    return counts;
  }, [tools]);

  const visibleTools = useMemo(
    () => tools.filter((tool) => selectedGroup === "all" || toolMeta(tool).group === selectedGroup),
    [selectedGroup, tools],
  );

  const loadPage = useCallback(async () => {
    setLoading(true);
    try {
      const workspaceResponse = await queryAvailableSandboxContainers({ page: 1, size: 100, include_non_running: true });
      const nextWorkspaces = workspaceResponse.data?.items ?? [];
      setWorkspaces(nextWorkspaces);
      const nextWorkspaceId = workspaceId ?? nextWorkspaces.find((item) => item.status === SANDBOX_CONTAINER_STATUS.RUNNING)?.id ?? nextWorkspaces[0]?.id;
      setWorkspaceId(nextWorkspaceId);

      const toolResponse = await listToolpackTools(nextWorkspaceId);
      const nextTools = toolResponse.data?.tools ?? [];
      setTools(nextTools);
      const nextTool = nextTools.find((tool) => tool.id === selectedToolId) ?? nextTools[0] ?? null;
      setSelectedToolId(nextTool?.id ?? "");
      setInputs(nextTool ? defaultInputs(nextTool) : {});
      setTimeoutSeconds(nextTool?.manifest.default_timeout_seconds);
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
    }
  }, [selectedToolId, workspaceId]);

  useAdminResourceHeader({
    refreshLabel: "刷新 Toolpack",
    loading,
    onRefresh: loadPage,
    createIcon: <Wrench size={16} />,
  });

  useEffect(() => {
    void loadPage();
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    void listToolpackTools(workspaceId)
      .then((response) => {
        const nextTools = response.data?.tools ?? [];
        setTools(nextTools);
        setSelectedToolId((current) => (nextTools.some((tool) => tool.id === current) ? current : nextTools[0]?.id ?? ""));
      })
      .catch(showApiError);
  }, [workspaceId]);

  useEffect(() => {
    if (!selectedTool) return;
    setInputs(defaultInputs(selectedTool));
    setTimeoutSeconds(selectedTool.manifest.default_timeout_seconds);
  }, [selectedTool?.id]);

  useEffect(() => {
    runRef.current = run;
    if (!run || run.status !== "running") return;

    const timer = window.setInterval(() => {
      const currentRun = runRef.current;
      if (!currentRun || currentRun.status !== "running") return;
      void getToolRun(currentRun.run_id)
        .then((response) => {
          if (response.data) setRun(response.data);
        })
        .catch(showApiError);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [run]);

  const handleToolSelect = (tool: ToolSchema) => {
    setSelectedToolId(tool.id);
    setSelectedGroup(toolMeta(tool).group);
    setRun(null);
  };

  const handleWorkspaceSelect = (value: unknown) => {
    setWorkspaceId(typeof value === "number" ? value : Number(value));
    setRun(null);
  };

  const updateInput = (name: string, value: string | number | boolean | null) => {
    setInputs((current) => ({ ...current, [name]: value }));
  };

  const handleRun = async () => {
    if (!selectedTool || !workspaceId) return;
    setRunningAction(true);
    try {
      const response = await startToolRun(selectedTool.id, {
        sandbox_container_id: workspaceId,
        input: cleanInputs(selectedTool.manifest.input_schema, inputs),
        timeout_seconds: timeoutSeconds,
      });
      if (response.data) {
        setRun(response.data);
        Toast.success("Toolpack 已启动");
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setRunningAction(false);
    }
  };

  const handleCancel = async () => {
    if (!run || run.status !== "running") return;
    setRunningAction(true);
    try {
      await cancelToolRun(run.run_id);
      const response = await getToolRun(run.run_id);
      if (response.data) setRun(response.data);
      Toast.success("已发送取消请求");
    } catch (error) {
      showApiError(error);
    } finally {
      setRunningAction(false);
    }
  };

  const running = run?.status === "running";
  const canRun = Boolean(selectedTool && workspaceId && selectedWorkspace?.status === SANDBOX_CONTAINER_STATUS.RUNNING && selectedTool.available !== false);

  return (
    <section className="toolpack-page">
      <div className="toolpack-workspace-bar">
        <Select
          value={workspaceId}
          onChange={handleWorkspaceSelect}
          loading={loading}
          optionList={workspaces.map((workspace) => ({
            value: workspace.id,
            label: formatWorkspaceLocation(workspace),
          }))}
        />
        {selectedWorkspace ? (
          <Tag color={SANDBOX_CONTAINER_STATUS_COLOR[selectedWorkspace.status]}>
            {SANDBOX_CONTAINER_STATUS_LABEL[selectedWorkspace.status]}
          </Tag>
        ) : null}
      </div>

      <div className="toolpack-layout">
        <ResourcePanel
          className="toolpack-tools-panel"
          loading={loading}
          empty={tools.length === 0}
          emptyIcon={<PackageSearch size={52} />}
          emptyTitle="暂无 Toolpack"
        >
          <div className="toolpack-group-list">
            {TOOL_GROUPS.map((group) => {
              const Icon = group.icon;
              const active = selectedGroup === group.id;
              return (
                <button
                  type="button"
                  key={group.id}
                  className={active ? "toolpack-group-item is-active" : "toolpack-group-item"}
                  onClick={() => setSelectedGroup(group.id)}
                >
                  <Icon size={15} />
                  <span>{group.label}</span>
                  <small>{groupedCounts[group.id]}</small>
                </button>
              );
            })}
          </div>

          <div className="toolpack-tool-list">
            {visibleTools.map((tool) => {
              const meta = toolMeta(tool);
              return (
                <button
                  type="button"
                  key={tool.id}
                  className={tool.id === selectedTool?.id ? "toolpack-tool-item is-active" : "toolpack-tool-item"}
                  onClick={() => handleToolSelect(tool)}
                >
                  <ResourceIdentity
                    icon={<Boxes size={18} />}
                    title={meta.title}
                    detail={<span>{tool.id}</span>}
                  />
                  <span className="toolpack-tool-tags">
                    <Tag color={BACKEND_COLOR[tool.backend]}>{tool.backend}</Tag>
                    <Tag color={tool.available === false ? "red" : "green"}>{tool.available === false ? "不可用" : "可用"}</Tag>
                  </span>
                </button>
              );
            })}
          </div>
        </ResourcePanel>

        <ResourcePanel
          className="toolpack-run-panel"
          loading={loading}
          empty={!selectedTool}
          emptyIcon={<Wrench size={52} />}
          emptyTitle="请选择 Toolpack"
        >
          {selectedTool ? (
            <Spin spinning={runningAction}>
              <div className="toolpack-run-grid">
                <header className="toolpack-run-header">
                  <ResourceIdentity
                    icon={<Wrench size={18} />}
                    title={toolMeta(selectedTool).title}
                    detail={<span>{toolMeta(selectedTool).description}</span>}
                  />
                  <div className="toolpack-run-actions">
                    <Tag color={BACKEND_COLOR[selectedTool.backend]}>{selectedTool.backend}</Tag>
                    <Tag color={selectedTool.available === false ? "red" : "green"}>
                      {selectedTool.available === false ? "不可用" : "可用"}
                    </Tag>
                    <Tag color="grey">{selectedTool.manifest.risk_level}</Tag>
                  </div>
                </header>

                {selectedTool.available === false ? (
                  <div className="toolpack-inline-alert">
                    <ResourceText title={selectedTool.availability_message || selectedTool.install_hint}>
                      {selectedTool.availability_message || selectedTool.install_hint}
                    </ResourceText>
                  </div>
                ) : null}

                <div className="toolpack-form-grid">
                  {renderInputFields(selectedTool.id, selectedTool.manifest.input_schema, inputs, updateInput)}
                  <label className="toolpack-field">
                    <span>运行超时</span>
                    <InputNumber
                      value={timeoutSeconds}
                      min={1}
                      max={selectedTool.manifest.max_timeout_seconds}
                      onChange={(value) => setTimeoutSeconds(typeof value === "number" ? value : selectedTool.manifest.default_timeout_seconds)}
                    />
                  </label>
                </div>

                <div className="toolpack-command-row">
                  <Button
                    icon={<Play size={16} />}
                    theme="solid"
                    type="primary"
                    disabled={!canRun || running}
                    loading={runningAction && !running}
                    onClick={handleRun}
                  >
                    运行
                  </Button>
                  <Button
                    icon={<Square size={16} />}
                    type="danger"
                    disabled={!running}
                    loading={runningAction && running}
                    onClick={handleCancel}
                  >
                    取消
                  </Button>
                </div>

                <RunResult run={run} />
              </div>
            </Spin>
          ) : null}
        </ResourcePanel>
      </div>
    </section>
  );
}

function renderInputFields(
  toolId: string,
  schema: ToolInputSchema,
  values: ToolInputValues,
  onChange: (name: string, value: string | number | boolean | null) => void,
) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(properties).map(([name, property]) => (
    <label className="toolpack-field" key={name}>
      <span>{fieldLabel(name)}{required.has(name) ? " *" : ""}</span>
      {renderInputField(toolId, name, property, values[name], onChange)}
    </label>
  ));
}

function renderInputField(
  toolId: string,
  name: string,
  property: JsonSchemaProperty,
  value: string | number | boolean | null | undefined,
  onChange: (name: string, value: string | number | boolean | null) => void,
) {
  if (property.enum?.length) {
    return (
      <Select
        value={value ?? undefined}
        onChange={(next) => onChange(name, String(next ?? ""))}
        optionList={property.enum.map((item) => ({ value: String(item), label: String(item) }))}
      />
    );
  }

  const type = Array.isArray(property.type) ? property.type[0] : property.type;
  if (type === "boolean") {
    return (
      <Checkbox checked={Boolean(value)} onChange={(event) => onChange(name, Boolean(event.target.checked))}>
        {Boolean(value) ? "是" : "否"}
      </Checkbox>
    );
  }

  if (type === "integer" || type === "number") {
    return (
      <InputNumber
        value={typeof value === "number" ? value : undefined}
        min={property.minimum}
        max={property.maximum}
        onChange={(next) => onChange(name, typeof next === "number" ? next : null)}
      />
    );
  }

  if ((property.maxLength ?? 0) > 512 || name === "wordlist") {
    return <TextArea value={String(value ?? "")} autosize={{ minRows: 2, maxRows: 5 }} onChange={(next) => onChange(name, next)} />;
  }

  return <Input value={String(value ?? "")} placeholder={fieldPlaceholder(toolId, name)} onChange={(next) => onChange(name, next)} />;
}

function RunResult({ run }: { run: ToolRunSnapshot | null }) {
  if (!run) {
    return <div className="toolpack-result-empty">未运行</div>;
  }

  const stdout = typeof run.result?.structured.stdout === "string" ? run.result.structured.stdout : "";
  const records = Array.isArray(run.result?.structured.records) ? run.result.structured.records : [];
  return (
    <section className="toolpack-result">
      <div className="toolpack-result-head">
        <Tag color={RUN_STATUS_COLOR[run.status]}>{RUN_STATUS_LABEL[run.status]}</Tag>
        <span>{run.run_id}</span>
        <span>{formatDateTime(run.started_at)}</span>
      </div>
      {run.result ? (
        <>
          <ResultSummary result={run.result} />
          <div className="toolpack-result-facts">
            <span>ok: {String(run.result.ok)}</span>
            <span>exit_code: {run.result.exit_code ?? "null"}</span>
            <span>records: {records.length}</span>
            <span>error: {run.result.error_code ?? "null"}</span>
          </div>
          <p className="toolpack-result-summary">{run.result.summary}</p>
          <pre className="toolpack-output">{stdout || JSON.stringify(run.result.structured, null, 2)}</pre>
          <ArtifactList artifacts={run.result.artifact_refs} />
        </>
      ) : null}
    </section>
  );
}

function ResultSummary({ result }: { result: ExecutionResult }) {
  const records = Array.isArray(result.structured.records) ? result.structured.records : [];
  const first = records[0];
  if (!isRecord(first)) return null;
  const facts = summarizeRecord(first);
  if (!facts.length) return null;
  return (
    <div className="toolpack-summary-grid">
      {facts.map((fact) => (
        <div key={fact.label}>
          <span>{fact.label}</span>
          <strong>{fact.value}</strong>
        </div>
      ))}
    </div>
  );
}

function summarizeRecord(record: Record<string, unknown>) {
  const facts: { label: string; value: string }[] = [];
  addFact(facts, "状态", record.status_code);
  addFact(facts, "耗时", typeof record.elapsed_ms === "number" ? `${record.elapsed_ms} ms` : undefined);
  addFact(facts, "TLS", record.tls_version);
  addFact(facts, "证书到期", record.not_after);
  addFact(facts, "地址数", Array.isArray(record.records) ? record.records.length : undefined);
  addFact(facts, "开放端口", openPortCount(record));
  addFact(facts, "目标", record.host ?? record.url ?? record.target);
  return facts.slice(0, 4);
}

function addFact(facts: { label: string; value: string }[], label: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  facts.push({ label, value: String(value) });
}

function openPortCount(record: Record<string, unknown>) {
  if (!Array.isArray(record.ports)) return undefined;
  return record.ports.filter((item) => isRecord(item) && item.open === true).length;
}

function ArtifactList({ artifacts }: { artifacts: ExecutionArtifact[] }) {
  if (!artifacts.length) return null;
  return (
    <div className="toolpack-artifacts">
      {artifacts.map((artifact) => (
        <a key={artifact.id} href={buildToolArtifactUrl(artifact.id)} target="_blank" rel="noreferrer">
          <Download size={14} />
          <span>{artifact.path}</span>
          <small>{artifact.size} B</small>
        </a>
      ))}
    </div>
  );
}

function defaultInputs(tool: ToolSchema): ToolInputValues {
  const values: ToolInputValues = {};
  const properties = tool.manifest.input_schema.properties ?? {};
  Object.entries(properties).forEach(([name, property]) => {
    values[name] = defaultValueForField(tool.id, name, property);
  });
  return values;
}

function defaultValueForField(toolId: string, name: string, property: JsonSchemaProperty) {
  if (property.default !== undefined && typeof property.default !== "object") return property.default as string | number | boolean;
  if (name === "path") {
    if (toolId.endsWith(".log.tail") || toolId.endsWith(".log.grep")) return "toolpack-smoke.log";
    if (toolId.endsWith(".archive.inspect")) return "toolpack-smoke.zip";
    return ".";
  }
  if (name === "max_depth") return 1;
  if (name === "top_n") return 20;
  if (name === "keyword") return "";
  if (name === "limit") return 50;
  if (name === "state") return "";
  if (name === "tools") return "python,python3,node,pnpm,git,curl,nmap,sqlmap,httpx,dnsx,ffuf";
  if (name === "urls") return "http://127.0.0.1:8000/health";
  if (name === "body") return "";
  if (name === "record_type") return "A";
  if (name === "profile") return "common";
  if (name === "lines") return 100;
  if (name === "pattern") return "error|warn|failed";
  if (name === "ignore_case") return true;
  if (name === "max_matches") return 50;
  if (name === "algorithm") return "sha256";
  if (name === "max_entries") return 100;
  if (toolId === "local.webcheck" && name === "url") return "http://127.0.0.1:8000/health";
  if (toolId === "local.webcheck" && name === "method") return "GET";
  if (toolId === "local.http.headers" && name === "url") return "http://127.0.0.1:8000/health";
  if (toolId === "local.tls.inspect" && name === "host") return "example.com";
  if (toolId === "local.tls.inspect" && name === "port") return 443;
  if (toolId === "local.dns.lookup" && name === "host") return "example.com";
  if (toolId === "local.ping" && name === "host") return "127.0.0.1";
  if (toolId === "local.ping" && name === "count") return 4;
  if (toolId === "local.port.scan" && name === "host") return "127.0.0.1";
  if (toolId === "local.port.scan" && name === "ports") return "8000,2222";
  if (toolId === "local.httpx" && name === "target") return "http://127.0.0.1:8000/health";
  if (toolId === "local.dnsx" && name === "domain") return "example.com";
  if (toolId === "local.ffuf" && name === "url") return "http://127.0.0.1:8000/FUZZ";
  if (toolId === "local.ffuf" && name === "wordlist") return "wordlist.txt";
  if (toolId === "ssh.nmap" && name === "target") return "127.0.0.1";
  if (toolId === "ssh.sqlmap" && name === "target") return "http://192.168.192.1:8877/?id=1";
  if (toolId.endsWith(".curl") && name === "url") return "http://127.0.0.1:8000/health";
  if (toolId.endsWith(".curl") && name === "method") return "GET";
  if (toolId.endsWith(".http.probe") && name === "method") return "HEAD";
  if (toolId.endsWith(".dns.trace") && name === "host") return "example.com";
  if (toolId.endsWith(".port.quickcheck") && name === "host") return "127.0.0.1";
  const type = Array.isArray(property.type) ? property.type[0] : property.type;
  if (type === "integer" || type === "number") return property.minimum ?? 1;
  return "";
}

function cleanInputs(schema: ToolInputSchema, values: ToolInputValues) {
  const properties = schema.properties ?? {};
  return Object.fromEntries(
    Object.entries(properties)
      .map(([name]) => [name, values[name]])
      .filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function toolMeta(tool: ToolSchema) {
  return TOOL_META[tool.id] ?? {
    title: tool.name,
    group: tool.backend === "ssh" ? "ssh" : "security",
    description: tool.description,
  };
}

function fieldLabel(name: string) {
  return FIELD_LABELS[name] ?? name;
}

function fieldPlaceholder(toolId: string, name: string) {
  if (toolId === "local.port.scan" && name === "ports") return "80,443,8000-8010";
  if (name === "urls") return "每行一个 URL，最多 20 个";
  if (name === "path") return "相对路径或绝对路径";
  if (name === "pattern") return "error|warn|failed";
  if (name === "url") return "https://example.com";
  if (name === "host") return "example.com";
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatWorkspaceLocation(workspace: SandboxContainer) {
  const status = SANDBOX_CONTAINER_STATUS_LABEL[workspace.status];
  if (workspace.host_execution_backend === "local") {
    return `本机 · 本地执行 · ${status}`;
  }
  const hostName = workspace.host_display_name || "SSH主机";
  return `SSH · ${hostName} · ${workspace.host_account}@${workspace.host_ip_address}:${workspace.host_ssh_port} · ${status}`;
}
