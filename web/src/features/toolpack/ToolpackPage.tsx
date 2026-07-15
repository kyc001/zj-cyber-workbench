import { Button, Input, InputNumber, Select, Spin, Tag, TextArea, Toast } from "@douyinfe/semi-ui";
import { Boxes, Download, PackageSearch, Play, Square, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryAvailableSandboxContainers } from "../../shared/api/sandboxContainers";
import {
  buildToolArtifactUrl,
  cancelToolRun,
  getToolRun,
  listToolpackTools,
  startToolRun,
  type ExecutionArtifact,
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

  const handleToolSelect = (value: unknown) => {
    setSelectedToolId(String(value ?? ""));
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
            label: `${workspace.container_name} · ${workspace.status}`,
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
          <div className="toolpack-tool-list">
            {tools.map((tool) => (
              <button
                type="button"
                key={tool.id}
                className={tool.id === selectedTool?.id ? "toolpack-tool-item is-active" : "toolpack-tool-item"}
                onClick={() => handleToolSelect(tool.id)}
              >
                <ResourceIdentity
                  icon={<Boxes size={18} />}
                  title={tool.id}
                  detail={<span>{tool.category}</span>}
                />
                <span className="toolpack-tool-tags">
                  <Tag color={BACKEND_COLOR[tool.backend]}>{tool.backend}</Tag>
                  <Tag color={tool.available === false ? "red" : "green"}>{tool.available === false ? "缺失" : "可用"}</Tag>
                </span>
              </button>
            ))}
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
                    title={selectedTool.name}
                    detail={<span>{selectedTool.description}</span>}
                  />
                  <div className="toolpack-run-actions">
                    <Tag color={BACKEND_COLOR[selectedTool.backend]}>{selectedTool.backend}</Tag>
                    <Tag color={selectedTool.available === false ? "red" : "green"}>
                      {selectedTool.available === false ? "缺失" : "可用"}
                    </Tag>
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
                  {renderInputFields(selectedTool.manifest.input_schema, inputs, updateInput)}
                  <label className="toolpack-field">
                    <span>timeout_seconds</span>
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

function renderInputFields(schema: ToolInputSchema, values: ToolInputValues, onChange: (name: string, value: string | number | boolean | null) => void) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(properties).map(([name, property]) => (
    <label className="toolpack-field" key={name}>
      <span>{required.has(name) ? `${name} *` : name}</span>
      {renderInputField(name, property, values[name], onChange)}
    </label>
  ));
}

function renderInputField(
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

  return <Input value={String(value ?? "")} onChange={(next) => onChange(name, next)} />;
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
  if (toolId === "local.httpx" && name === "target") return "http://127.0.0.1:8765";
  if (toolId === "local.dnsx" && name === "domain") return "example.com";
  if (toolId === "local.ffuf" && name === "url") return "http://127.0.0.1:8765/FUZZ";
  if (toolId === "local.ffuf" && name === "wordlist") return "wordlist.txt";
  if (toolId === "ssh.nmap" && name === "target") return "127.0.0.1";
  if (toolId === "ssh.sqlmap" && name === "target") return "http://192.168.192.1:8877/?id=1";
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
