import { Button, Input, InputNumber, Select, Spin, Tag, TextArea } from "@douyinfe/semi-ui";
import { FolderKanban, Plus, ScanSearch, Server, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  WORK_PROJECT_ASSET_ORIGIN,
  getWorkProjectAssetTypes,
  getWorkProjectTypes,
  isWorkProjectAssetType,
  isWorkProjectType,
  WORK_PROJECT_ASSET_TYPE,
} from "../../shared/api/contract";
import { querySystemUsers } from "../../shared/api/systemUsers";
import { queryAvailableSandboxContainers } from "../../shared/api/sandboxContainers";
import type {
  CreateWorkProjectRequest,
  SandboxContainer,
  SystemUser,
  WorkProject,
  WorkProjectAssetRequest,
} from "../../shared/api/types";
import { ResourceFormLoadError, ResourceModal } from "../../shared/components/ResourceModal";
import { useOptionList } from "../../shared/hooks/useOptionList";
import {
  SYSTEM_USER_ROLE_COLOR,
  SYSTEM_USER_ROLE_LABEL,
  WORK_PROJECT_ASSET_TYPE_LABEL,
  SANDBOX_CONTAINER_STATUS_COLOR,
  SANDBOX_CONTAINER_STATUS_LABEL,
  WORK_PROJECT_TYPE_LABEL,
} from "../../shared/lib/labels";

type WorkProjectFormModalProps = {
  open: boolean;
  saving: boolean;
  project?: WorkProject | null;
  onCancel: () => void;
  onSubmit: (payload: CreateWorkProjectRequest) => Promise<void>;
};

type SelectedOption = {
  value?: SystemUser["id"];
};

type AssetFormRow = WorkProjectAssetRequest & {
  existingId?: number;
};

type WorkProjectFormValues = Omit<CreateWorkProjectRequest, "assets"> & {
  assets: AssetFormRow[];
};

const projectTypes = getWorkProjectTypes();
const assetTypes = getWorkProjectAssetTypes();

const EMPTY_ASSET: AssetFormRow = {
  type: assetTypes[0],
  path: "",
  host: "",
  port: null,
};

const EMPTY: WorkProjectFormValues = {
  name: "",
  description: "",
  owner_user_ids: [],
  sandbox_container_id: null,
  assets: [{ ...EMPTY_ASSET }],
  type: projectTypes[0],
};

export function WorkProjectFormModal({ open, saving, project, onCancel, onSubmit }: WorkProjectFormModalProps) {
  const [values, setValues] = useState<WorkProjectFormValues>(EMPTY);
  const [initialSnapshot, setInitialSnapshot] = useState("");
  const loadWorkspaces = useCallback((params: { page: number; size: number; keyword: string }) => (
    queryAvailableSandboxContainers({ ...params, work_project_id: project?.id })
  ), [project?.id]);
  const {
    items: workspaces,
    loading: workspacesLoading,
    error: workspacesError,
    load: loadWorkspaceOptions,
  } = useOptionList<SandboxContainer>({
    enabled: open,
    query: loadWorkspaces,
  });
  const {
    items: users,
    loading: usersLoading,
    error: usersError,
    load: loadUserOptions,
  } = useOptionList<SystemUser>({
    enabled: open,
    query: querySystemUsers,
  });
  const editing = Boolean(project);
  const retryOptions = useCallback(() => {
    void Promise.all([loadWorkspaceOptions(), loadUserOptions()]);
  }, [loadUserOptions, loadWorkspaceOptions]);

  useEffect(() => {
    if (!open) return;
    const nextValues: WorkProjectFormValues = project ? {
      name: project.name,
      description: project.description,
      owner_user_ids: project.owner_user_ids,
      sandbox_container_id: project.sandbox_container_id ?? null,
      assets: scopeAssetsFromProject(project),
      type: project.type,
    } : { ...EMPTY, assets: [{ ...EMPTY_ASSET }] };
    setValues(nextValues);
    setInitialSnapshot(JSON.stringify(nextValues));
  }, [open, project]);

  const dirty = open && Boolean(initialSnapshot) && JSON.stringify(values) !== initialSnapshot;

  const userOptionList = useMemo(() => users.map((user) => ({
    label: <UserOption user={user} />,
    value: user.id,
  })), [users]);
  const workspaceOptionList = useMemo(() => workspaces.map((workspace) => ({
    label: <WorkspaceOption workspace={workspace} />,
    value: workspace.id,
  })), [workspaces]);

  const canSubmit = Boolean(values.name.trim()) && values.assets.length > 0
    && values.assets.every(isAssetComplete);

  const updateAsset = (index: number, patch: Partial<AssetFormRow>) => {
    setValues((current) => ({
      ...current,
      assets: current.assets.map((asset, assetIndex) => (
        assetIndex === index ? { ...asset, ...patch } : asset
      )),
    }));
  };

  const removeAsset = (index: number) => {
    setValues((current) => ({
      ...current,
      assets: current.assets.filter((_, assetIndex) => assetIndex !== index),
    }));
  };

  const submit = () => onSubmit({
    ...values,
    name: values.name.trim(),
    description: values.description.trim(),
    assets: values.assets.map(normalizeAsset).filter(isAssetComplete),
  });

  return (
    <ResourceModal
      open={open}
      title={editing ? "编辑工作项目" : "创建工作项目"}
      saving={saving}
      dirty={dirty}
      submitLabel={editing ? "保存" : "创建"}
      submitDisabled={!canSubmit || (editing && !dirty)}
      width={980}
      onCancel={onCancel}
      onSubmit={submit}
    >
      <ResourceFormLoadError
        issues={[
          ...(usersError ? [{ label: "负责人", message: usersError }] : []),
          ...(workspacesError ? [{ label: "执行工作区", message: workspacesError }] : []),
        ]}
        loading={usersLoading || workspacesLoading}
        onRetry={retryOptions}
      />
      <div className="project-form-grid">
        <label>
          <span>名称</span>
          <Input prefix={<FolderKanban size={16} />} value={values.name} maxLength={255} required
            onChange={(name) => setValues((v) => ({ ...v, name }))}
          />
        </label>
        <label>
          <span>类型</span>
          <Select prefix={<ScanSearch size={16} />} value={values.type}
            onChange={(type) => isWorkProjectType(type) && setValues((v) => ({ ...v, type }))}
            optionList={projectTypes.map((type) => ({ label: WORK_PROJECT_TYPE_LABEL[type], value: type }))}
          />
        </label>
        <label>
          <span>负责人</span>
          <Select
            prefix={<UserRound size={16} />}
            value={values.owner_user_ids}
            optionList={userOptionList}
            placeholder={usersLoading ? "正在加载用户" : "选择项目负责人"}
            emptyContent={usersLoading ? <Spin size="small" /> : usersError || "暂无用户"}
            loading={usersLoading}
            multiple
            renderSelectedItem={(option: SelectedOption) => ({
              isRenderInTag: true,
              content: users.find((user) => user.id === option.value)?.username ?? String(option.value ?? ""),
            })}
            showClear
            onClear={() => setValues((v) => ({ ...v, owner_user_ids: [] }))}
            onChange={(value) => setValues((v) => ({
              ...v,
              owner_user_ids: Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [],
            }))}
          />
        </label>
        <label>
          <span>执行工作区</span>
          <Select
            prefix={<Server size={16} />}
            value={values.sandbox_container_id ?? undefined}
            optionList={workspaceOptionList}
            placeholder={workspacesLoading ? "正在加载执行工作区" : "选择项目执行工作区"}
            emptyContent={workspacesLoading ? <Spin size="small" /> : workspacesError || "暂无可用工作区"}
            loading={workspacesLoading}
            showClear
            renderSelectedItem={(option: { value?: number }) => (
              workspaces.find((workspace) => workspace.id === option.value)?.container_name
              ?? String(option.value ?? "")
            )}
            onClear={() => setValues((v) => ({ ...v, sandbox_container_id: null }))}
            onChange={(value) => setValues((v) => ({
              ...v,
              sandbox_container_id: typeof value === "number" ? value : null,
            }))}
          />
        </label>
      </div>

      <label>
        <span>描述</span>
        <TextArea value={values.description} maxLength={2000} autosize={{ minRows: 3, maxRows: 6 }}
          onChange={(description) => setValues((v) => ({ ...v, description }))}
        />
      </label>

      <section className="project-assets-editor">
        <header>
          <span>资产</span>
          <Button
            icon={<Plus size={14} />}
            size="small"
            theme="borderless"
            type="tertiary"
            onClick={() => setValues((v) => ({ ...v, assets: [...v.assets, { ...EMPTY_ASSET }] }))}
          >
            添加资产
          </Button>
        </header>
        <div className="project-assets-rows">
          {values.assets.map((asset, index) => (
            <article key={index} className="project-asset-row">
              <label>
                <span>类型</span>
                <Select
                  value={asset.type}
                  disabled={Boolean(asset.existingId)}
                  optionList={assetTypes.map((type) => ({ label: WORK_PROJECT_ASSET_TYPE_LABEL[type], value: type }))}
                  onChange={(type) => isWorkProjectAssetType(type) && updateAsset(index, resetAssetForType(type))}
                />
              </label>
              {asset.type === WORK_PROJECT_ASSET_TYPE.BINARY ? (
                <label>
                  <span>路径</span>
                  <Input
                    value={asset.path}
                    maxLength={500}
                    required
                    onChange={(path) => updateAsset(index, { path })}
                  />
                </label>
              ) : (
                <>
                  <label>
                    <span>{ASSET_HOST_FIELD_LABEL[asset.type]}</span>
                    <Input value={asset.host} maxLength={255} onChange={(host) => updateAsset(index, { host })} />
                  </label>
                  {asset.type === WORK_PROJECT_ASSET_TYPE.SERVICE ? (
                    <label>
                      <span>端口</span>
                      <InputNumber value={asset.port ?? undefined} min={1} max={65535} onChange={(port) => updateAsset(index, { port: typeof port === "number" ? port : null })} />
                    </label>
                  ) : null}
                </>
              )}
              <Button
                icon={<Trash2 size={14} />}
                theme="borderless"
                type="danger"
                disabled={values.assets.length <= 1}
                aria-label="移除资产"
                onClick={() => removeAsset(index)}
              />
            </article>
          ))}
          {!values.assets.every(isAssetComplete) && values.name.trim() ? (
            <span className="project-assets-validation" role="status">
              请完整填写资产信息；服务资产必须同时填写 Host 和有效端口。
            </span>
          ) : null}
        </div>
      </section>
    </ResourceModal>
  );
}

function UserOption({ user }: { user: SystemUser }) {
  return (
    <div className="project-user-option">
      <span>{user.username}</span>
       <small>{user.email || "无邮箱"}</small>
      <Tag color={SYSTEM_USER_ROLE_COLOR[user.role]}>{SYSTEM_USER_ROLE_LABEL[user.role]}</Tag>
    </div>
  );
}


function WorkspaceOption({ workspace }: { workspace: SandboxContainer }) {
  return (
    <div className="project-sandbox-option">
      <span>{workspace.container_name}</span>
      <small>工作区 #{workspace.id}</small>
      <Tag color={SANDBOX_CONTAINER_STATUS_COLOR[workspace.status]}>
        {SANDBOX_CONTAINER_STATUS_LABEL[workspace.status]}
      </Tag>
    </div>
  );
}

function assetFromProject(asset: WorkProject["assets"][number]): AssetFormRow {
  return {
    existingId: asset.id,
    type: asset.type,
    path: asset.path,
    host: asset.host,
    port: asset.port,
  };
}

function scopeAssetsFromProject(project: WorkProject): AssetFormRow[] {
  const assets = project.assets
    .filter((asset) => asset.origin === WORK_PROJECT_ASSET_ORIGIN.SCOPE)
    .map(assetFromProject);
  return assets.length ? assets : [{ ...EMPTY_ASSET }];
}

function normalizeAsset(asset: AssetFormRow): WorkProjectAssetRequest {
  if (asset.type === WORK_PROJECT_ASSET_TYPE.BINARY) {
    return { type: asset.type, path: asset.path.trim(), host: "", port: null };
  }
  return {
    type: asset.type,
    path: "",
    host: asset.host.trim(),
    port: asset.type === WORK_PROJECT_ASSET_TYPE.SERVICE ? asset.port : null,
  };
}

function isAssetComplete(asset: WorkProjectAssetRequest): boolean {
  if (asset.type === WORK_PROJECT_ASSET_TYPE.BINARY) return Boolean(asset.path.trim());
  if (!asset.host.trim()) return false;
  if (asset.type !== WORK_PROJECT_ASSET_TYPE.SERVICE) return true;
  return Number.isInteger(asset.port) && Number(asset.port) >= 1 && Number(asset.port) <= 65535;
}

function resetAssetForType(type: WorkProjectAssetRequest["type"]): Partial<AssetFormRow> {
  return { type, path: "", host: "", port: null };
}

// Label for the `host` input field, which carries a different identifier per asset type.
const ASSET_HOST_FIELD_LABEL: Record<Exclude<WorkProjectAssetRequest["type"], typeof WORK_PROJECT_ASSET_TYPE.BINARY>, string> = {
  [WORK_PROJECT_ASSET_TYPE.SERVICE]: "Host",
  [WORK_PROJECT_ASSET_TYPE.DOMAIN]: "Domain",
  [WORK_PROJECT_ASSET_TYPE.NETWORK]: "Network (CIDR)",
};
