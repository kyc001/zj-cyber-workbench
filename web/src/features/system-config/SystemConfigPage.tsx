import { Button, Input, InputNumber, Modal, Popconfirm, Select, Spin, Switch, TextArea, Toast } from "@douyinfe/semi-ui";
import { Bot, CopyCheck, DatabaseZap, FileText, RefreshCw, RotateCcw, Save, Settings, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createCustomSkill,
  deleteCustomSkill,
  fetchProviderModels,
  getAgentPrompt,
  getCustomizableSkill,
  getInstanceConfig,
  listCustomizableSkills,
  resetAgentPrompt,
  updateAgentPrompt,
  updateCustomSkill,
  updateInstanceConfig,
  type AgentPrompt,
  type AgentPromptKind,
  type SkillDetail,
  type SkillSummary,
} from "../../shared/api/systemConfig";
import { getApiErrorMessage, showApiError, showApiSuccess } from "../../shared/api/feedback";
import { MetricStrip } from "../../shared/components/ResourcePageShell";
import { cx } from "../../shared/lib/className";
import type {
  AgentConfig,
  AgentPoolConfig,
  AgentRuntimeConfig,
  InstanceConfig,
  LightRAGConfig,
  PermissionConfig,
  UpdateInstanceConfigRequest,
} from "../../shared/api/types";
import { useUnsavedChangesRegistration } from "../../shared/components/UnsavedChangesGuard";
import { useAdminResourceHeader } from "../../shared/hooks/useAdminResourceHeader";

type AgentFormValue = AgentConfig;
type LightRAGFormValue = LightRAGConfig;

type ConfigFormValue = {
  agents: AgentFormValue[];
  agent_pool: AgentPoolConfig;
  agent_runtime: AgentRuntimeConfig;
  permissions: PermissionConfig;
  lightrag: LightRAGFormValue;
};

type ProviderDraft = Pick<AgentConfig, "base_url" | "api_key" | "model">;

type FieldKey<T, Value> = {
  [Key in keyof T]: T[Key] extends Value ? Key : never;
}[keyof T];

type ConfigField<T> =
  | { kind: "number"; key: FieldKey<T, number>; label: string; min?: number; max?: number; step?: number }
  | { kind: "toggle"; key: FieldKey<T, boolean>; label: string };

type AgentTextField = {
  key: keyof Pick<AgentConfig, "name" | "base_url" | "model" | "api_key">;
  label: string;
  maxLength?: number;
  password?: boolean;
};

const RUNTIME_FIELDS: ConfigField<AgentRuntimeConfig>[] = [
  { kind: "number", key: "main_max_turns", label: "主智能体最大轮数", min: 1 },
  { kind: "number", key: "subordinate_max_turns", label: "子智能体最大轮数", min: 1 },
  { kind: "number", key: "model_stream_idle_timeout_seconds", label: "流式空闲超时", min: 30 },
  { kind: "number", key: "report_retention_seconds", label: "报告保留秒数", min: 0 },
  { kind: "number", key: "context_compression_trigger_ratio", label: "压缩触发比例", min: 0.01, max: 0.99, step: 0.01 },
  { kind: "number", key: "context_compression_hard_stop_ratio", label: "压缩硬停止比例", min: 0.01, max: 0.99, step: 0.01 },
  { kind: "number", key: "context_compression_target_ratio", label: "压缩目标比例", min: 0.01, max: 0.99, step: 0.01 },
  { kind: "number", key: "context_budget_model_call_ratio", label: "模型调用预算比例", min: 0.01, max: 0.99, step: 0.01 },
  { kind: "number", key: "context_compression_preserve_recent_ratio", label: "保留近期内容比例", min: 0.01, max: 0.99, step: 0.01 },
  { kind: "number", key: "context_compression_preserve_recent_items", label: "保留近期条数", min: 1 },
  { kind: "number", key: "context_compression_min_items", label: "最少内容条数", min: 1 },
  { kind: "number", key: "context_compression_summary_max_tokens", label: "摘要最大 Token 数", min: 512 },
  { kind: "toggle", key: "context_compression_enabled", label: "启用上下文压缩" },
];

const POOL_FIELDS: ConfigField<AgentPoolConfig>[] = [
  { kind: "number", key: "max_size", label: "最大会话数", min: 1 },
  { kind: "number", key: "ttl_seconds", label: "过期时间（秒）", min: 0 },
  { kind: "number", key: "sweep_interval_seconds", label: "清理间隔（秒）", min: 1 },
];

const AGENT_TEXT_FIELDS: AgentTextField[] = [
  { key: "name", label: "名称", maxLength: 128 },
  { key: "base_url", label: "Base URL" },
  { key: "api_key", label: "API Key", password: true },
];

const EMPTY_PROVIDER: ProviderDraft = { base_url: "", api_key: "", model: "" };
const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function selectAvailableModel(currentModel: string, fetchedModels: string[]) {
  if (!fetchedModels.length || fetchedModels.includes(currentModel)) return currentModel;
  return fetchedModels[0];
}

function toFormValue(config: InstanceConfig): ConfigFormValue {
  if (!config.agent_pool || !config.agent_runtime || !config.permissions || !config.lightrag) {
    throw new Error("实例配置不完整");
  }
  const agents = Object.values(config.agents ?? {}).map((agent) => ({ ...agent }));
  return {
    agents,
    agent_pool: { ...config.agent_pool },
    agent_runtime: { ...config.agent_runtime },
    permissions: {
      mode: config.permissions.mode ?? "normal",
      approval_timeout_seconds: config.permissions.approval_timeout_seconds ?? 300,
    },
    lightrag: { ...config.lightrag },
  };
}

function cloneFormValue(values: ConfigFormValue): ConfigFormValue {
  return {
    agents: values.agents.map((agent) => ({ ...agent })),
    agent_pool: { ...values.agent_pool },
    agent_runtime: { ...values.agent_runtime },
    permissions: { ...values.permissions },
    lightrag: { ...values.lightrag },
  };
}

function toPayload(values: ConfigFormValue): UpdateInstanceConfigRequest {
  const agents: NonNullable<UpdateInstanceConfigRequest["agents"]> = {};
  values.agents.forEach((agent) => {
    const code = agent.code.trim();
    if (!code) return;
    agents[code] = {
      name: agent.name.trim(),
      description: agent.description.trim(),
      base_url: agent.base_url.trim(),
      api_key: agent.api_key.trim(),
      model: agent.model.trim(),
      use_responses: agent.use_responses,
      context_window: agent.context_window,
    };
  });
  return {
    agents,
    agent_pool: values.agent_pool,
    agent_runtime: values.agent_runtime,
    permissions: values.permissions,
    lightrag: values.lightrag,
  };
}

export function SystemConfigPage() {
  const [values, setValues] = useState<ConfigFormValue | null>(null);
  const [savedValues, setSavedValues] = useState<ConfigFormValue | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sharedProvider, setSharedProvider] = useState<ProviderDraft>(EMPTY_PROVIDER);
  const [sharedModels, setSharedModels] = useState<string[]>([]);
  const [sharedModelsLoading, setSharedModelsLoading] = useState(false);
  const [agentModels, setAgentModels] = useState<Record<string, string[]>>({});
  const [loadingAgentCode, setLoadingAgentCode] = useState<string | null>(null);
  const [customizationDirty, setCustomizationDirty] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);
  const mountedRef = useRef(true);
  const configRequestRef = useRef(0);
  const configLoadingRef = useRef(false);
  const configSavingRef = useRef(false);
  const sharedModelsRequestRef = useRef(0);
  const sharedModelsBusyRef = useRef(false);
  const agentModelsRequestRef = useRef(0);
  const agentModelsBusyRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      configRequestRef.current += 1;
      sharedModelsRequestRef.current += 1;
      agentModelsRequestRef.current += 1;
      configLoadingRef.current = false;
      configSavingRef.current = false;
      sharedModelsBusyRef.current = false;
      agentModelsBusyRef.current = false;
    };
  }, []);

  const loadConfig = useCallback(async () => {
    if (!mountedRef.current || configLoadingRef.current) return;
    const requestId = configRequestRef.current + 1;
    configRequestRef.current = requestId;
    configLoadingRef.current = true;
    setLoading(true);
    setConfigError("");
    try {
      const response = await getInstanceConfig();
      if (!mountedRef.current || configRequestRef.current !== requestId) return;
      if (response.data) {
        const nextValues = toFormValue(response.data);
        setValues(nextValues);
        setSavedValues(cloneFormValue(nextValues));
        const firstAgent = nextValues.agents[0];
        setSharedProvider(firstAgent ? {
          base_url: firstAgent.base_url,
          api_key: firstAgent.api_key,
          model: firstAgent.model,
        } : EMPTY_PROVIDER);
        setSharedModels([]);
        setAgentModels({});
      } else {
        setConfigError("服务端未返回系统配置");
      }
    } catch (error) {
      if (mountedRef.current && configRequestRef.current === requestId) {
        setConfigError(getApiErrorMessage(error, "加载系统配置失败"));
      }
    } finally {
      if (mountedRef.current && configRequestRef.current === requestId) {
        configLoadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const metrics = useMemo(() => {
    const agentCount = values?.agents.length ?? 0;
    return [
        { label: "智能体数", value: agentCount },
        { label: "池大小", value: values?.agent_pool.max_size ?? "-" },
        { label: "主轮数", value: values?.agent_runtime.main_max_turns ?? "-" },
      {
        label: "图谱 / 分块",
        value: values ? `${values.lightrag.graph_matches} / ${values.lightrag.chunk_matches}` : "-",
      },
    ];
  }, [values]);

  const configDirty = useMemo(() => {
    if (!values || !savedValues) return false;
    return JSON.stringify(toPayload(values)) !== JSON.stringify(toPayload(savedValues));
  }, [savedValues, values]);

  useUnsavedChangesRegistration(configDirty || customizationDirty, {
    title: "放弃系统配置页的未保存修改？",
    content: "离开后，尚未保存的运行配置、提示词或 Skill 修改将无法恢复。",
  });

  const updatePool = (patch: Partial<AgentPoolConfig>) => {
    setValues((current) => current && { ...current, agent_pool: { ...current.agent_pool, ...patch } });
  };

  const updateRuntime = (patch: Partial<AgentRuntimeConfig>) => {
    setValues((current) => current && { ...current, agent_runtime: { ...current.agent_runtime, ...patch } });
  };

  const updateLightRAG = (patch: Partial<LightRAGFormValue>) => {
    setValues((current) => current && { ...current, lightrag: { ...current.lightrag, ...patch } });
  };

  const updateAgent = (code: string, patch: Partial<AgentConfig>) => {
    if ("base_url" in patch || "api_key" in patch) {
      agentModelsRequestRef.current += 1;
      agentModelsBusyRef.current = false;
      setLoadingAgentCode(null);
      setAgentModels((current) => {
        const next = { ...current };
        delete next[code];
        return next;
      });
    }
    setValues((current) => current && {
      ...current,
      agents: current.agents.map((agent) => (agent.code === code ? { ...agent, ...patch } : agent)),
    });
  };

  const discardConfigChanges = useCallback(() => {
    if (!savedValues) return;
    const restoredValues = cloneFormValue(savedValues);
    const firstAgent = restoredValues.agents[0];
    sharedModelsRequestRef.current += 1;
    agentModelsRequestRef.current += 1;
    sharedModelsBusyRef.current = false;
    agentModelsBusyRef.current = false;
    setValues(restoredValues);
    setSharedProvider(firstAgent ? {
      base_url: firstAgent.base_url,
      api_key: firstAgent.api_key,
      model: firstAgent.model,
    } : EMPTY_PROVIDER);
    setSharedModels([]);
    setAgentModels({});
    setSharedModelsLoading(false);
    setLoadingAgentCode(null);
  }, [savedValues]);

  const handleCancel = useCallback(() => {
    if (configDirty) setResetConfirmOpen(true);
  }, [configDirty]);

  const handleSave = useCallback(async () => {
    if (!values || !configDirty || configSavingRef.current) return;

    configSavingRef.current = true;
    setSaving(true);
    try {
      const response = await updateInstanceConfig(toPayload(values));
      if (!mountedRef.current) return;
      showApiSuccess(response);
      if (response.data?.config) {
        const nextValues = toFormValue(response.data.config);
        setValues(nextValues);
        setSavedValues(cloneFormValue(nextValues));
      } else {
        setSavedValues(cloneFormValue(values));
      }
    } catch (error) {
      if (mountedRef.current) showApiError(error);
    } finally {
      configSavingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }, [configDirty, values]);

  const loadProviderModels = useCallback(async (provider: Pick<ProviderDraft, "base_url" | "api_key">) => {
    const response = await fetchProviderModels({
      base_url: provider.base_url.trim(),
      api_key: provider.api_key.trim(),
    });
    return response.data?.models ?? [];
  }, []);

  const handleFetchSharedModels = useCallback(async () => {
    if (!sharedProvider.base_url.trim() || sharedModelsBusyRef.current) return;
    const requestId = sharedModelsRequestRef.current + 1;
    sharedModelsRequestRef.current = requestId;
    sharedModelsBusyRef.current = true;
    setSharedModelsLoading(true);
    try {
      const models = await loadProviderModels(sharedProvider);
      if (!mountedRef.current || sharedModelsRequestRef.current !== requestId) return;
      const selectedModel = selectAvailableModel(sharedProvider.model, models);
      setSharedModels(models);
      setAgentModels(Object.fromEntries(
        (values?.agents ?? []).map((agent) => [agent.code, models]),
      ));
      setSharedProvider((current) => (
        selectedModel === current.model ? current : { ...current, model: selectedModel }
      ));
      setValues((current) => current && {
        ...current,
        agents: current.agents.map((agent) => (
          selectedModel === agent.model ? agent : { ...agent, model: selectedModel }
        )),
      });
      models.length ? Toast.success(`已拉取 ${models.length} 个模型`) : Toast.warning("Provider 未返回可用模型");
    } catch (error) {
      if (mountedRef.current && sharedModelsRequestRef.current === requestId) showApiError(error);
    } finally {
      if (sharedModelsRequestRef.current === requestId) {
        sharedModelsBusyRef.current = false;
        if (mountedRef.current) setSharedModelsLoading(false);
      }
    }
  }, [loadProviderModels, sharedProvider, values?.agents]);

  const handleSharedProviderChange = useCallback((patch: Partial<ProviderDraft>) => {
    if ("base_url" in patch || "api_key" in patch) {
      sharedModelsRequestRef.current += 1;
      sharedModelsBusyRef.current = false;
      setSharedModelsLoading(false);
      setSharedModels([]);
    }
    setSharedProvider((current) => ({ ...current, ...patch }));
    if ("model" in patch) {
      setValues((current) => current && {
        ...current,
        agents: current.agents.map((agent) => ({ ...agent, model: patch.model ?? "" })),
      });
    }
  }, []);

  const handleApplySharedProvider = useCallback(() => {
    setValues((current) => current && {
      ...current,
      agents: current.agents.map((agent) => ({ ...agent, ...sharedProvider })),
    });
    if (values) {
      setAgentModels(Object.fromEntries(values.agents.map((agent) => [agent.code, sharedModels])));
    }
    Toast.success("已应用到全部智能体，请保存配置以生效");
  }, [sharedModels, sharedProvider, values]);

  const handleFetchAgentModels = useCallback(async (agent: AgentConfig) => {
    if (!agent.base_url.trim() || agentModelsBusyRef.current) return;
    const requestId = agentModelsRequestRef.current + 1;
    agentModelsRequestRef.current = requestId;
    agentModelsBusyRef.current = true;
    setLoadingAgentCode(agent.code);
    try {
      const models = await loadProviderModels(agent);
      if (!mountedRef.current || agentModelsRequestRef.current !== requestId) return;
      setAgentModels((current) => ({ ...current, [agent.code]: models }));
      setValues((current) => current && {
        ...current,
        agents: current.agents.map((item) => {
          if (item.code !== agent.code) return item;
          const model = selectAvailableModel(item.model, models);
          return model === item.model ? item : { ...item, model };
        }),
      });
      models.length ? Toast.success(`已为 ${agent.name} 拉取 ${models.length} 个模型`) : Toast.warning("Provider 未返回可用模型");
    } catch (error) {
      if (mountedRef.current && agentModelsRequestRef.current === requestId) showApiError(error);
    } finally {
      if (agentModelsRequestRef.current === requestId) {
        agentModelsBusyRef.current = false;
        if (mountedRef.current) setLoadingAgentCode(null);
      }
    }
  }, [loadProviderModels]);

  const handleRefresh = useCallback(() => {
    if (!configDirty) {
      void loadConfig();
      return;
    }
    setRefreshConfirmOpen(true);
  }, [configDirty, loadConfig]);

  const headerActions = useMemo(() => (
    <>
      <Button icon={<X size={16} />} type="tertiary" disabled={!configDirty || saving || loading} onClick={handleCancel}>
        取消修改
      </Button>
      <Button icon={<Save size={16} />} theme="solid" type="primary" loading={saving} disabled={!configDirty || loading || Boolean(configError)} onClick={handleSave}>
        保存配置
      </Button>
    </>
  ), [configDirty, configError, handleCancel, handleSave, loading, saving]);

  useAdminResourceHeader({
    refreshLabel: "刷新配置",
    loading: loading || saving,
    onRefresh: handleRefresh,
    extraActions: headerActions,
    appendExtraActions: true,
  });

  return (
    <section className="system-config-page">
      <Modal
        visible={resetConfirmOpen}
        title="放弃运行配置修改？"
        okText="放弃修改"
        cancelText="继续编辑"
        okType="danger"
        maskClosable={false}
        onOk={() => {
          setResetConfirmOpen(false);
          discardConfigChanges();
        }}
        onCancel={() => setResetConfirmOpen(false)}
      >
        <p className="unsaved-changes-dialog-content">
          运行时、智能体和模型配置将恢复为上次保存的内容。
        </p>
      </Modal>
      <Modal
        visible={refreshConfirmOpen}
        title="放弃未保存的配置修改？"
        okText="放弃并重新加载"
        cancelText="继续编辑"
        okType="danger"
        maskClosable={false}
        onOk={() => {
          setRefreshConfirmOpen(false);
          void loadConfig();
        }}
        onCancel={() => setRefreshConfirmOpen(false)}
      >
        <p className="unsaved-changes-dialog-content">
          重新加载会使用服务端配置覆盖当前修改。
        </p>
      </Modal>
      <MetricStrip metrics={metrics} />

      {configError ? (
        <div className="agent-custom-load-error system-config-load-error" role="alert">
          <span>{configError}</span>
          <Button size="small" icon={<RefreshCw size={14} />} loading={loading} onClick={() => void loadConfig()}>
            重试
          </Button>
        </div>
      ) : null}

      <Spin spinning={loading} wrapperClassName="system-config-spin">
        {values ? (
          <div className="system-config-layout">
            <ConfigPanel icon={<Settings size={18} />} title="运行时">
              <ConfigFieldGrid fields={RUNTIME_FIELDS} values={values.agent_runtime} onChange={updateRuntime} />
            </ConfigPanel>

            <ConfigPanel icon={<RotateCcw size={18} />} title="智能体池">
              <ConfigFieldGrid compact fields={POOL_FIELDS} values={values.agent_pool} onChange={updatePool} />
            </ConfigPanel>

            <ConfigPanel icon={<DatabaseZap size={18} />} title="知识检索（LightRAG）">
              <LightRAGConfigEditor value={values.lightrag} onChange={updateLightRAG} />
            </ConfigPanel>

            <ConfigPanel icon={<Bot size={18} />} title="智能体与模型">
              <ProviderQuickSetup
                value={sharedProvider}
                models={sharedModels}
                loading={sharedModelsLoading}
                onChange={handleSharedProviderChange}
                onFetch={handleFetchSharedModels}
                onApply={handleApplySharedProvider}
              />
              <div className="agent-config-list">
                {values.agents.map((agent) => (
                  <AgentConfigEditor
                    key={agent.code}
                    agent={agent}
                    models={agentModels[agent.code] ?? []}
                    loadingModels={loadingAgentCode === agent.code}
                    onChange={(patch) => updateAgent(agent.code, patch)}
                    onFetchModels={() => void handleFetchAgentModels(agent)}
                  />
                ))}
              </div>
            </ConfigPanel>

            <ConfigPanel icon={<FileText size={18} />} title="Agent 自定义">
              <AgentCustomizationPanel
                agents={values.agents}
                onDirtyChange={setCustomizationDirty}
              />
            </ConfigPanel>
          </div>
        ) : null}
      </Spin>
    </section>
  );
}

function ProviderQuickSetup({ value, models, loading, onChange, onFetch, onApply }: {
  value: ProviderDraft;
  models: string[];
  loading: boolean;
  onChange: (patch: Partial<ProviderDraft>) => void;
  onFetch: () => void;
  onApply: () => void;
}) {
  return (
    <div className="provider-quick-setup">
      <div className="provider-quick-grid">
        <Field kind="text" label="基础 URL" value={value.base_url}
          onChange={(base_url) => onChange({ base_url })}
        />
        <Field kind="text" label="API Key" value={value.api_key} password
          onChange={(api_key) => onChange({ api_key })}
        />
        <ModelSelectField label="模型" value={value.model} models={models} loading={loading}
          onChange={(model) => onChange({ model })} onFetch={onFetch}
        />
      </div>
      <div className="provider-quick-actions">
        <Popconfirm
          title="应用 Provider 配置"
          content="将覆盖全部智能体的基础 URL、API Key 和模型，之后仍需保存配置才会生效。"
          okText="应用"
          cancelText="取消"
          onConfirm={onApply}
        >
          <Button icon={<CopyCheck size={16} />} theme="solid" type="primary"
            disabled={!value.base_url.trim() || !value.model.trim()}
          >
            应用到全部智能体
          </Button>
        </Popconfirm>
        <span>{models.length ? `已拉取 ${models.length} 个模型，可搜索选择` : "点击“拉取模型”获取服务端列表"}</span>
      </div>
    </div>
  );
}

function AgentCustomizationPanel({
  agents,
  onDirtyChange,
}: {
  agents: AgentFormValue[];
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [agentCode, setAgentCode] = useState(agents[0]?.code ?? "");
  const [promptKind, setPromptKind] = useState<AgentPromptKind>("rules");
  const [prompt, setPrompt] = useState<AgentPrompt | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState("");
  const [promptSaving, setPromptSaving] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillName, setSkillName] = useState("");
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [skillDraft, setSkillDraft] = useState("");
  const [newSkillName, setNewSkillName] = useState("");
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillDetailLoading, setSkillDetailLoading] = useState(false);
  const [skillsError, setSkillsError] = useState("");
  const [skillDetailError, setSkillDetailError] = useState("");
  const [skillSaving, setSkillSaving] = useState(false);
  const mountedRef = useRef(true);
  const promptRequestRef = useRef(0);
  const skillsRequestRef = useRef(0);
  const skillDetailRequestRef = useRef(0);
  const promptSavingRef = useRef(false);
  const skillSavingRef = useRef(false);

  const selectedAgent = agents.find((agent) => agent.code === agentCode);
  const skillLoading = skillsLoading || skillDetailLoading;
  const promptDirty = Boolean(prompt) && promptDraft !== prompt?.content;
  const skillDirty = Boolean(skillDetail?.editable) && skillDraft !== skillDetail?.content;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      promptRequestRef.current += 1;
      skillsRequestRef.current += 1;
      skillDetailRequestRef.current += 1;
      promptSavingRef.current = false;
      skillSavingRef.current = false;
    };
  }, []);

  useEffect(() => {
    onDirtyChange(promptDirty || skillDirty);
  }, [onDirtyChange, promptDirty, skillDirty]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const loadPrompt = useCallback(async () => {
    const requestId = promptRequestRef.current + 1;
    promptRequestRef.current = requestId;
    if (!agentCode) {
      setPrompt(null);
      setPromptDraft("");
      setPromptError("");
      setPromptLoading(false);
      return;
    }
    setPromptLoading(true);
    setPromptError("");
    setPrompt(null);
    setPromptDraft("");
    try {
      const response = await getAgentPrompt(agentCode, promptKind);
      if (!mountedRef.current || promptRequestRef.current !== requestId) return;
      if (response.data) {
        setPrompt(response.data);
        setPromptDraft(response.data.content);
      }
    } catch (error) {
      if (mountedRef.current && promptRequestRef.current === requestId) {
        setPromptError(getApiErrorMessage(error, "加载提示词失败"));
      }
    } finally {
      if (mountedRef.current && promptRequestRef.current === requestId) setPromptLoading(false);
    }
  }, [agentCode, promptKind]);

  const loadSkills = useCallback(async () => {
    const requestId = skillsRequestRef.current + 1;
    skillsRequestRef.current = requestId;
    setSkillsLoading(true);
    setSkillsError("");
    try {
      const response = await listCustomizableSkills();
      if (!mountedRef.current || skillsRequestRef.current !== requestId) return;
      const items = response.data?.items ?? [];
      setSkills(items);
    } catch (error) {
      if (mountedRef.current && skillsRequestRef.current === requestId) {
        setSkillsError(getApiErrorMessage(error, "加载 Skill 列表失败"));
      }
    } finally {
      if (mountedRef.current && skillsRequestRef.current === requestId) setSkillsLoading(false);
    }
  }, []);

  const loadSkillDetail = useCallback(async () => {
    const requestId = skillDetailRequestRef.current + 1;
    skillDetailRequestRef.current = requestId;
    if (!skillName) {
      setSkillDetail(null);
      setSkillDraft("");
      setSkillDetailError("");
      setSkillDetailLoading(false);
      return;
    }
    setSkillDetailLoading(true);
    setSkillDetailError("");
    setSkillDetail(null);
    setSkillDraft("");
    try {
      const response = await getCustomizableSkill(skillName);
      if (!mountedRef.current || skillDetailRequestRef.current !== requestId) return;
      if (response.data) {
        setSkillDetail(response.data);
        setSkillDraft(response.data.content);
      }
    } catch (error) {
      if (mountedRef.current && skillDetailRequestRef.current === requestId) {
        setSkillDetailError(getApiErrorMessage(error, "加载 Skill 详情失败"));
      }
    } finally {
      if (mountedRef.current && skillDetailRequestRef.current === requestId) setSkillDetailLoading(false);
    }
  }, [skillName]);

  useEffect(() => {
    if (!agents.some((agent) => agent.code === agentCode)) {
      setAgentCode(agents[0]?.code ?? "");
    }
  }, [agentCode, agents]);

  useEffect(() => {
    void loadPrompt();
  }, [loadPrompt]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    if (!skills.some((skill) => skill.name === skillName)) {
      setSkillName(skills[0]?.name ?? "");
    }
  }, [skillName, skills]);

  useEffect(() => {
    void loadSkillDetail();
  }, [loadSkillDetail]);

  const savePrompt = useCallback(async () => {
    if (!agentCode || !promptDirty || promptSavingRef.current) return;
    promptSavingRef.current = true;
    setPromptSaving(true);
    try {
      const response = await updateAgentPrompt(agentCode, { kind: promptKind, content: promptDraft });
      if (!mountedRef.current) return;
      if (response.data) {
        setPrompt(response.data);
        setPromptDraft(response.data.content);
      }
      setPromptError("");
      Toast.success("提示词已保存，新建或后续会话将使用自定义内容");
    } catch (error) {
      if (mountedRef.current) showApiError(error);
    } finally {
      promptSavingRef.current = false;
      if (mountedRef.current) setPromptSaving(false);
    }
  }, [agentCode, promptDirty, promptDraft, promptKind]);

  const restorePrompt = useCallback(async () => {
    if (!agentCode || promptSavingRef.current) return;
    promptSavingRef.current = true;
    setPromptSaving(true);
    try {
      const response = await resetAgentPrompt(agentCode, promptKind);
      if (!mountedRef.current) return;
      if (response.data) {
        setPrompt(response.data);
        setPromptDraft(response.data.content);
      }
      setPromptError("");
      Toast.success("已恢复内置提示词");
    } catch (error) {
      if (mountedRef.current) showApiError(error);
    } finally {
      promptSavingRef.current = false;
      if (mountedRef.current) setPromptSaving(false);
    }
  }, [agentCode, promptKind]);

  const createSkill = useCallback(async () => {
    const name = newSkillName.trim();
    if (!name || skillDirty || skillSavingRef.current) return;
    if (!SKILL_NAME_PATTERN.test(name)) {
      Toast.warning("Skill 名称只能使用小写字母、数字和短横线，且不能以短横线开头或结尾");
      return;
    }
    skillSavingRef.current = true;
    setSkillSaving(true);
    try {
      const response = await createCustomSkill({
        name,
        content: `# ${name}\n\n描述这个 Skill 的使用场景、前置条件和操作步骤。`,
      });
      if (!mountedRef.current) return;
      if (response.data) {
        setSkillName(response.data.name);
        setSkillDetail(response.data);
        setSkillDraft(response.data.content);
        setSkillDetailError("");
        setNewSkillName("");
      }
      await loadSkills();
      Toast.success("Skill 已创建");
    } catch (error) {
      if (mountedRef.current) showApiError(error);
    } finally {
      skillSavingRef.current = false;
      if (mountedRef.current) setSkillSaving(false);
    }
  }, [loadSkills, newSkillName, skillDirty]);

  const saveSkill = useCallback(async () => {
    if (!skillDetail?.editable || !skillDirty || skillSavingRef.current) return;
    skillSavingRef.current = true;
    setSkillSaving(true);
    try {
      const response = await updateCustomSkill(skillDetail.name, { content: skillDraft });
      if (!mountedRef.current) return;
      if (response.data) {
        setSkillDetail(response.data);
        setSkillDraft(response.data.content);
        setSkillDetailError("");
      }
      await loadSkills();
      Toast.success("Skill 已保存");
    } catch (error) {
      if (mountedRef.current) showApiError(error);
    } finally {
      skillSavingRef.current = false;
      if (mountedRef.current) setSkillSaving(false);
    }
  }, [loadSkills, skillDetail, skillDirty, skillDraft]);

  const removeSkill = useCallback(async () => {
    if (!skillDetail?.editable || skillSavingRef.current) return;
    skillSavingRef.current = true;
    setSkillSaving(true);
    try {
      await deleteCustomSkill(skillDetail.name);
      if (!mountedRef.current) return;
      setSkillName("");
      setSkillDetail(null);
      setSkillDraft("");
      setSkillDetailError("");
      await loadSkills();
      Toast.success("Skill 已删除");
    } catch (error) {
      if (mountedRef.current) showApiError(error);
    } finally {
      skillSavingRef.current = false;
      if (mountedRef.current) setSkillSaving(false);
    }
  }, [loadSkills, skillDetail]);

  return (
    <div className="agent-customization">
      <div className="agent-custom-section">
        <div className="agent-custom-toolbar">
          <label className="field">
            <span>智能体</span>
            <Select
              value={agentCode}
              disabled={promptSaving || promptDirty}
              optionList={agents.map((agent) => ({ label: `${agent.name || agent.code} (${agent.code})`, value: agent.code }))}
              onChange={(value) => typeof value === "string" && setAgentCode(value)}
            />
          </label>
          <label className="field">
            <span>提示词文件</span>
            <Select
              value={promptKind}
              disabled={promptSaving || promptDirty}
              optionList={[
                { label: "AGENTS.md - 规则提示词", value: "rules" },
                { label: "SOUL.md - 角色提示词", value: "soul" },
              ]}
              onChange={(value) => (value === "rules" || value === "soul") && setPromptKind(value)}
            />
          </label>
          <div className="agent-custom-status">
            <strong>{selectedAgent?.name || agentCode || "-"}</strong>
            <span>{prompt?.customized ? "已自定义" : "使用内置"}</span>
          </div>
        </div>
        {promptError ? (
          <div className="agent-custom-load-error" role="alert">
            <span>{promptError}</span>
            <Button size="small" icon={<RefreshCw size={14} />} onClick={() => void loadPrompt()}>重试</Button>
          </div>
        ) : null}
        <TextArea
          className="agent-custom-editor"
          aria-label={`${selectedAgent?.name || agentCode || "智能体"}提示词内容`}
          value={promptDraft}
          autosize={{ minRows: 10, maxRows: 18 }}
          disabled={promptLoading || promptSaving || Boolean(promptError)}
          onChange={setPromptDraft}
        />
        <div className="agent-custom-actions">
          <span>保存后会重建 Agent runtime，新建或后续会话生效。</span>
          <Button
            icon={<X size={15} />}
            disabled={!promptDirty || promptSaving}
            onClick={() => setPromptDraft(prompt?.content ?? "")}
          >
            撤销编辑
          </Button>
          <Popconfirm
            title="恢复内置提示词"
            content="当前自定义提示词将被删除，此操作无法撤销。"
            okText="恢复内置"
            cancelText="继续编辑"
            okType="danger"
            onConfirm={() => void restorePrompt()}
          >
            <Button icon={<RotateCcw size={15} />} disabled={!prompt?.customized || promptLoading || promptSaving || Boolean(promptError)}>
              恢复内置
            </Button>
          </Popconfirm>
          <Button icon={<Save size={15} />} theme="solid" type="primary" disabled={!promptDirty || promptLoading || Boolean(promptError)} loading={promptSaving} onClick={savePrompt}>
            保存提示词
          </Button>
        </div>
      </div>

      <div className="agent-custom-section">
        <div className="agent-custom-toolbar">
          <label className="field">
            <span>Skill</span>
            <Select
              value={skillName}
              loading={skillLoading}
              disabled={skillSaving || skillDirty}
              filter
              placeholder="选择 Skill"
              optionList={skills.map((skill) => ({
                label: `${skill.name} · ${skill.source === "custom" ? "自定义" : "内置"}`,
                value: skill.name,
              }))}
              onChange={(value) => typeof value === "string" && setSkillName(value)}
            />
          </label>
          <label className="field">
            <span>新建 Skill</span>
            <Input
              value={newSkillName}
              disabled={skillSaving || skillDirty}
              onChange={setNewSkillName}
              suffix={(
                <Button size="small" theme="borderless" type="tertiary" icon={<Wrench size={14} />} disabled={skillDirty} loading={skillSaving} onClick={createSkill}>
                  创建
                </Button>
              )}
            />
          </label>
          <div className="agent-custom-status">
            <strong>{skillDetail?.name || "-"}</strong>
            <span>{skillDetail ? (skillDetail.editable ? "可编辑" : "内置只读") : "未选择"}</span>
          </div>
        </div>
        {skillsError || skillDetailError ? (
          <div className="agent-custom-load-error" role="alert">
            <span>{skillsError || skillDetailError}</span>
            <Button
              size="small"
              icon={<RefreshCw size={14} />}
              onClick={() => void (skillsError ? loadSkills() : loadSkillDetail())}
            >
              重试
            </Button>
          </div>
        ) : null}
        <TextArea
          className="agent-custom-editor"
          aria-label={skillDetail ? `${skillDetail.name} Skill 内容` : "Skill 内容"}
          value={skillDraft}
          autosize={{ minRows: 8, maxRows: 16 }}
          disabled={!skillDetail?.editable || skillLoading || skillSaving}
          placeholder="选择或创建一个自定义 Skill"
          onChange={setSkillDraft}
        />
        <div className="agent-custom-actions">
          <span>{skillDetail?.description || "自定义 Skill 会出现在 Agent 的 Portable Skill Index 中。"}</span>
          <Button
            icon={<RotateCcw size={15} />}
            disabled={!skillDirty || skillSaving}
            onClick={() => setSkillDraft(skillDetail?.content ?? "")}
          >
            撤销编辑
          </Button>
          <Popconfirm
            title="删除自定义 Skill"
            content={`确定删除 ${skillDetail?.name || "这个 Skill"}？此操作无法撤销。`}
            okText="删除"
            cancelText="取消"
            okType="danger"
            onConfirm={() => void removeSkill()}
          >
            <Button icon={<X size={15} />} disabled={!skillDetail?.editable || skillSaving}>
              删除
            </Button>
          </Popconfirm>
          <Button icon={<Save size={15} />} theme="solid" type="primary" disabled={!skillDirty || skillLoading || Boolean(skillDetailError)} loading={skillSaving} onClick={saveSkill}>
            保存 Skill
          </Button>
        </div>
      </div>
    </div>
  );
}

function LightRAGConfigEditor({ value, onChange }: {
  value: LightRAGFormValue;
  onChange: (patch: Partial<LightRAGFormValue>) => void;
}) {
  return (
    <div className="config-grid lightrag-config-grid">
        <Field kind="text" label="嵌入 API" value={value.embedding_api}
        onChange={(embedding_api) => onChange({ embedding_api })} />
      <Field kind="text" label="嵌入 Key" value={value.embedding_key} password
        onChange={(embedding_key) => onChange({ embedding_key })} />
      <Field kind="text" label="嵌入模型" value={value.embedding_model}
        onChange={(embedding_model) => onChange({ embedding_model })} />
      <Field kind="number" label="嵌入维度" value={value.embedding_dim} min={1}
        onChange={(embedding_dim) => onChange({ embedding_dim })} />
      <Field kind="text" label="抽取 LLM API" value={value.llm_api}
        onChange={(llm_api) => onChange({ llm_api })} />
      <Field kind="text" label="抽取 LLM Key" value={value.llm_key} password
        onChange={(llm_key) => onChange({ llm_key })} />
      <Field kind="text" label="抽取 LLM 模型" value={value.llm_model}
        onChange={(llm_model) => onChange({ llm_model })} />
      <Field kind="number" label="图谱匹配数" value={value.graph_matches} min={1} max={50}
        onChange={(graph_matches) => onChange({ graph_matches })} />
      <Field kind="number" label="分块匹配数" value={value.chunk_matches} min={1} max={50}
        onChange={(chunk_matches) => onChange({ chunk_matches })} />
    </div>
  );
}

function ConfigPanel({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <div className="config-panel">
      <div className="config-panel-header">
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
      </div>
      {children}
    </div>
  );
}

function ConfigFieldGrid<T extends object>({ compact = false, fields, values, onChange }: {
  compact?: boolean;
  fields: ConfigField<T>[];
  values: T;
  onChange: (patch: Partial<T>) => void;
}) {
  return (
    <div className={cx("config-grid", compact && "compact")}>
      {fields.map((field) => {
        if (field.kind === "toggle") {
          return (
            <Field
              key={String(field.key)}
              kind="toggle"
              label={field.label}
              value={values[field.key] as boolean}
              onChange={(checked) => onChange({ [field.key]: checked } as Partial<T>)}
            />
          );
        }
        return (
          <Field
            key={String(field.key)}
            kind="number"
            label={field.label}
            value={values[field.key] as number}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(value) => onChange({ [field.key]: value } as Partial<T>)}
          />
        );
      })}
    </div>
  );
}

function AgentConfigEditor({ agent, models, loadingModels, onChange, onFetchModels }: {
  agent: AgentFormValue;
  models: string[];
  loadingModels: boolean;
  onChange: (patch: Partial<AgentConfig>) => void;
  onFetchModels: () => void;
}) {
  return (
    <div className="agent-config-card">
      <div className="agent-config-card-header">
        <strong>{agent.name || agent.code || "新智能体"}</strong>
        <span>{agent.code}</span>
      </div>
      <div className="agent-form-grid">
        {AGENT_TEXT_FIELDS.map((field) => (
          <Field
            key={field.key}
            kind="text"
            label={field.label}
            value={agent[field.key]}
            maxLength={field.maxLength}
            password={field.password}
            onChange={(value) => onChange({ [field.key]: value })}
          />
        ))}
        <ModelSelectField label="模型" value={agent.model} models={models} loading={loadingModels}
          onChange={(model) => onChange({ model })} onFetch={onFetchModels}
        />
        <Field kind="number" label="上下文窗口" value={agent.context_window} min={0}
          onChange={(context_window) => onChange({ context_window })}
        />
        <Field kind="toggle" label="使用 Responses API" value={agent.use_responses}
          onChange={(use_responses) => onChange({ use_responses })}
        />
        <label className="field full">
          <span>描述</span>
          <TextArea
            aria-label={`${agent.name || agent.code || "智能体"}描述`}
            value={agent.description}
            autosize={{ minRows: 2, maxRows: 4 }}
            onChange={(description) => onChange({ description })}
          />
        </label>
      </div>
    </div>
  );
}

function ModelSelectField({ label, value, models, loading, onChange, onFetch }: {
  label: string;
  value: string;
  models: string[];
  loading: boolean;
  onChange: (value: string) => void;
  onFetch: () => void;
}) {
  const options = Array.from(new Set([value, ...models].filter(Boolean)));
  // Semi Select keeps an internal option cache. With `filter` and `allowCreate`
  // enabled, updating optionList alone can leave an already mounted selector
  // showing the pre-fetch options. Remount only when the fetched model set
  // changes so the popup and its search index are rebuilt from the new list.
  const modelSetKey = JSON.stringify(models);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="model-select-row">
        <Select
          key={modelSetKey}
          value={value}
          filter
          allowCreate
          placeholder={models.length ? "搜索或选择模型" : "先拉取模型列表"}
          emptyContent="没有匹配的模型，可直接输入模型名"
          optionList={options.map((model) => ({ label: model, value: model }))}
          onChange={(model) => typeof model === "string" && onChange(model)}
        />
        <Button className="model-fetch-button" icon={<RefreshCw size={15} />} loading={loading} disabled={loading}
          theme="borderless" type="tertiary" onClick={onFetch} aria-label="拉取模型列表" title="拉取模型列表"
        >拉取模型</Button>
      </div>
    </label>
  );
}

type FieldProps =
  | { kind: "text"; label: string; value: string; maxLength?: number; password?: boolean; onChange: (value: string) => void }
  | { kind: "number"; label: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void }
  | { kind: "toggle"; label: string; value: boolean; onChange: (value: boolean) => void };

function Field(props: FieldProps) {
  const className = props.kind === "toggle" ? "field switch-field" : "field";
  return (
    <label className={className}>
      <span>{props.label}</span>
      {props.kind === "text" ? (
        <Input type={props.password ? "password" : "text"} value={props.value} maxLength={props.maxLength} onChange={props.onChange} />
      ) : props.kind === "number" ? (
        <InputNumber
          value={props.value}
          min={props.min}
          max={props.max}
          step={props.step}
          onChange={(next) => typeof next === "number" && props.onChange(next)}
        />
      ) : (
        <Switch checked={props.value} onChange={props.onChange} aria-label={props.label} />
      )}
    </label>
  );
}
