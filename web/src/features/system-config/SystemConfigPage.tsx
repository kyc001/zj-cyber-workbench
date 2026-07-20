import { Button, Input, InputNumber, Select, Spin, Switch, TextArea, Toast } from "@douyinfe/semi-ui";
import { Bot, CopyCheck, DatabaseZap, FileText, RefreshCw, RotateCcw, Save, Settings, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
import { showApiError, showApiSuccess } from "../../shared/api/feedback";
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
  const [saving, setSaving] = useState(false);
  const [sharedProvider, setSharedProvider] = useState<ProviderDraft>(EMPTY_PROVIDER);
  const [sharedModels, setSharedModels] = useState<string[]>([]);
  const [sharedModelsLoading, setSharedModelsLoading] = useState(false);
  const [agentModels, setAgentModels] = useState<Record<string, string[]>>({});
  const [loadingAgentCode, setLoadingAgentCode] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const response = await getInstanceConfig();
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
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setLoading(false);
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
    setValues((current) => current && {
      ...current,
      agents: current.agents.map((agent) => (agent.code === code ? { ...agent, ...patch } : agent)),
    });
  };

  const handleCancel = useCallback(() => {
    if (savedValues) setValues(cloneFormValue(savedValues));
  }, [savedValues]);

  const handleSave = useCallback(async () => {
    if (!values || saving) return;

    setSaving(true);
    try {
      const response = await updateInstanceConfig(toPayload(values));
      showApiSuccess(response);
      if (response.data?.config) {
        const nextValues = toFormValue(response.data.config);
        setValues(nextValues);
        setSavedValues(cloneFormValue(nextValues));
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setSaving(false);
    }
  }, [saving, values]);

  const loadProviderModels = useCallback(async (provider: Pick<ProviderDraft, "base_url" | "api_key">) => {
    const response = await fetchProviderModels({
      base_url: provider.base_url.trim(),
      api_key: provider.api_key.trim(),
    });
    return response.data?.models ?? [];
  }, []);

  const handleFetchSharedModels = useCallback(async () => {
    if (!sharedProvider.base_url.trim() || sharedModelsLoading) return;
    setSharedModelsLoading(true);
    try {
      const models = await loadProviderModels(sharedProvider);
      setSharedModels(models);
      models.length ? Toast.success(`已拉取 ${models.length} 个模型`) : Toast.warning("Provider 未返回可用模型");
    } catch (error) {
      showApiError(error);
    } finally {
      setSharedModelsLoading(false);
    }
  }, [loadProviderModels, sharedModelsLoading, sharedProvider]);

  const handleApplySharedProvider = useCallback(() => {
    setValues((current) => current && {
      ...current,
      agents: current.agents.map((agent) => ({ ...agent, ...sharedProvider })),
    });
    if (values) {
      setAgentModels(Object.fromEntries(values.agents.map((agent) => [agent.code, sharedModels])));
    }
  }, [sharedModels, sharedProvider, values]);

  const handleFetchAgentModels = useCallback(async (agent: AgentConfig) => {
    if (!agent.base_url.trim() || loadingAgentCode) return;
    setLoadingAgentCode(agent.code);
    try {
      const models = await loadProviderModels(agent);
      setAgentModels((current) => ({ ...current, [agent.code]: models }));
      models.length ? Toast.success(`已为 ${agent.name} 拉取 ${models.length} 个模型`) : Toast.warning("Provider 未返回可用模型");
    } catch (error) {
      showApiError(error);
    } finally {
      setLoadingAgentCode(null);
    }
  }, [loadProviderModels, loadingAgentCode]);

  const headerActions = useMemo(() => (
    <>
      <Button icon={<X size={16} />} type="tertiary" disabled={!savedValues || saving || loading} onClick={handleCancel}>
        取消修改
      </Button>
      <Button icon={<Save size={16} />} theme="solid" type="primary" loading={saving} disabled={!values} onClick={handleSave}>
        保存配置
      </Button>
    </>
  ), [handleCancel, loading, savedValues, saving, values]);

  useAdminResourceHeader({
    refreshLabel: "刷新配置",
    loading,
    onRefresh: loadConfig,
    extraActions: headerActions,
    appendExtraActions: true,
  });

  return (
    <section className="system-config-page">
      <MetricStrip metrics={metrics} />

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
                onChange={(patch) => setSharedProvider((current) => ({ ...current, ...patch }))}
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
              <AgentCustomizationPanel agents={values.agents} />
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
        <Button icon={<CopyCheck size={16} />} theme="solid" type="primary"
          disabled={!value.base_url.trim() || !value.model.trim()} onClick={onApply}
        >
          应用到全部智能体
        </Button>
        <span>{models.length ? `已拉取 ${models.length} 个模型，可搜索选择` : "点击“拉取模型”获取服务端列表"}</span>
      </div>
    </div>
  );
}

function AgentCustomizationPanel({ agents }: { agents: AgentFormValue[] }) {
  const [agentCode, setAgentCode] = useState(agents[0]?.code ?? "");
  const [promptKind, setPromptKind] = useState<AgentPromptKind>("rules");
  const [prompt, setPrompt] = useState<AgentPrompt | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillName, setSkillName] = useState("");
  const [skillDetail, setSkillDetail] = useState<SkillDetail | null>(null);
  const [skillDraft, setSkillDraft] = useState("");
  const [newSkillName, setNewSkillName] = useState("");
  const [skillLoading, setSkillLoading] = useState(false);
  const [skillSaving, setSkillSaving] = useState(false);

  const selectedAgent = agents.find((agent) => agent.code === agentCode);

  const loadPrompt = useCallback(async () => {
    if (!agentCode) return;
    setPromptLoading(true);
    try {
      const response = await getAgentPrompt(agentCode, promptKind);
      if (response.data) {
        setPrompt(response.data);
        setPromptDraft(response.data.content);
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setPromptLoading(false);
    }
  }, [agentCode, promptKind]);

  const loadSkills = useCallback(async () => {
    setSkillLoading(true);
    try {
      const response = await listCustomizableSkills();
      const items = response.data?.items ?? [];
      setSkills(items);
    } catch (error) {
      showApiError(error);
    } finally {
      setSkillLoading(false);
    }
  }, []);

  const loadSkillDetail = useCallback(async () => {
    if (!skillName) {
      setSkillDetail(null);
      setSkillDraft("");
      return;
    }
    setSkillLoading(true);
    try {
      const response = await getCustomizableSkill(skillName);
      if (response.data) {
        setSkillDetail(response.data);
        setSkillDraft(response.data.content);
      }
    } catch (error) {
      showApiError(error);
    } finally {
      setSkillLoading(false);
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
    if (!skillName && skills[0]) setSkillName(skills[0].name);
  }, [skillName, skills]);

  useEffect(() => {
    void loadSkillDetail();
  }, [loadSkillDetail]);

  const savePrompt = useCallback(async () => {
    if (!agentCode || promptSaving) return;
    setPromptSaving(true);
    try {
      const response = await updateAgentPrompt(agentCode, { kind: promptKind, content: promptDraft });
      if (response.data) {
        setPrompt(response.data);
        setPromptDraft(response.data.content);
      }
      Toast.success("提示词已保存，新建或后续会话将使用自定义内容");
    } catch (error) {
      showApiError(error);
    } finally {
      setPromptSaving(false);
    }
  }, [agentCode, promptDraft, promptKind, promptSaving]);

  const restorePrompt = useCallback(async () => {
    if (!agentCode || promptSaving) return;
    setPromptSaving(true);
    try {
      const response = await resetAgentPrompt(agentCode, promptKind);
      if (response.data) {
        setPrompt(response.data);
        setPromptDraft(response.data.content);
      }
      Toast.success("已恢复内置提示词");
    } catch (error) {
      showApiError(error);
    } finally {
      setPromptSaving(false);
    }
  }, [agentCode, promptKind, promptSaving]);

  const createSkill = useCallback(async () => {
    const name = newSkillName.trim();
    if (!name || skillSaving) return;
    if (!SKILL_NAME_PATTERN.test(name)) {
      Toast.warning("Skill 名称只能使用小写字母、数字和短横线，且不能以短横线开头或结尾");
      return;
    }
    setSkillSaving(true);
    try {
      const response = await createCustomSkill({
        name,
        content: `# ${name}\n\n描述这个 Skill 的使用场景、前置条件和操作步骤。`,
      });
      if (response.data) {
        setSkillName(response.data.name);
        setSkillDetail(response.data);
        setSkillDraft(response.data.content);
        setNewSkillName("");
      }
      await loadSkills();
      Toast.success("Skill 已创建");
    } catch (error) {
      showApiError(error);
    } finally {
      setSkillSaving(false);
    }
  }, [loadSkills, newSkillName, skillSaving]);

  const saveSkill = useCallback(async () => {
    if (!skillDetail?.editable || skillSaving) return;
    setSkillSaving(true);
    try {
      const response = await updateCustomSkill(skillDetail.name, { content: skillDraft });
      if (response.data) {
        setSkillDetail(response.data);
        setSkillDraft(response.data.content);
      }
      await loadSkills();
      Toast.success("Skill 已保存");
    } catch (error) {
      showApiError(error);
    } finally {
      setSkillSaving(false);
    }
  }, [loadSkills, skillDetail, skillDraft, skillSaving]);

  const removeSkill = useCallback(async () => {
    if (!skillDetail?.editable || skillSaving) return;
    if (!window.confirm(`删除自定义 Skill：${skillDetail.name}？`)) return;
    setSkillSaving(true);
    try {
      await deleteCustomSkill(skillDetail.name);
      setSkillName("");
      setSkillDetail(null);
      setSkillDraft("");
      await loadSkills();
      Toast.success("Skill 已删除");
    } catch (error) {
      showApiError(error);
    } finally {
      setSkillSaving(false);
    }
  }, [loadSkills, skillDetail, skillSaving]);

  return (
    <div className="agent-customization">
      <div className="agent-custom-section">
        <div className="agent-custom-toolbar">
          <label className="field">
            <span>智能体</span>
            <Select
              value={agentCode}
              optionList={agents.map((agent) => ({ label: `${agent.name || agent.code} (${agent.code})`, value: agent.code }))}
              onChange={(value) => typeof value === "string" && setAgentCode(value)}
            />
          </label>
          <label className="field">
            <span>提示词文件</span>
            <Select
              value={promptKind}
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
        <TextArea
          className="agent-custom-editor"
          value={promptDraft}
          autosize={{ minRows: 10, maxRows: 18 }}
          disabled={promptLoading}
          onChange={setPromptDraft}
        />
        <div className="agent-custom-actions">
          <span>保存后会重建 Agent runtime，新建或后续会话生效。</span>
          <Button icon={<RotateCcw size={15} />} disabled={!prompt?.customized || promptSaving} onClick={restorePrompt}>
            恢复内置
          </Button>
          <Button icon={<Save size={15} />} theme="solid" type="primary" loading={promptSaving} onClick={savePrompt}>
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
              onChange={setNewSkillName}
              suffix={(
                <Button size="small" theme="borderless" type="tertiary" icon={<Wrench size={14} />} loading={skillSaving} onClick={createSkill}>
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
        <TextArea
          className="agent-custom-editor"
          value={skillDraft}
          autosize={{ minRows: 8, maxRows: 16 }}
          disabled={!skillDetail?.editable || skillLoading}
          placeholder="选择或创建一个自定义 Skill"
          onChange={setSkillDraft}
        />
        <div className="agent-custom-actions">
          <span>{skillDetail?.description || "自定义 Skill 会出现在 Agent 的 Portable Skill Index 中。"}</span>
          <Button icon={<X size={15} />} disabled={!skillDetail?.editable || skillSaving} onClick={removeSkill}>
            删除
          </Button>
          <Button icon={<Save size={15} />} theme="solid" type="primary" disabled={!skillDetail?.editable} loading={skillSaving} onClick={saveSkill}>
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
          <TextArea value={agent.description} autosize={{ minRows: 2, maxRows: 4 }} onChange={(description) => onChange({ description })} />
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
  return (
    <label className="field">
      <span>{label}</span>
      <div className="model-select-row">
        <Select
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
