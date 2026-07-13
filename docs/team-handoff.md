# 团队接口与交接规则

## 唯一接口来源

- Python 领域契约：`schema/`。
- REST 契约：`web/openapi.json`。
- 前端生成类型：`web/src/shared/api/generated/`。
- Timeline 事件：后端事件 Schema 和 WebSocket 协议。
- 桌面进程协议：`GET /health`、Sidecar 环境变量和桌面 IPC 类型。

聊天消息、截图和口头约定不能替代这些文件。公共字段发生变化时，提交必须同时更新 Schema、测试、OpenAPI、生成类型和本文件涉及的交接说明。

## A 向 B 交付

| 接口 | A 保证 | B 使用方式 |
| --- | --- | --- |
| `GET /health` | 服务名、版本、协议版本和可用状态稳定 | Sidecar 启动轮询与兼容性检查 |
| 本机身份 | Sidecar 仅监听回环地址；桌面模式默认开启，无登录接口和会话 Token | Renderer 直接调用同源 REST/WebSocket，不写登录状态 |
| `POST /api/system-config/models` | 使用提交的 Base URL 和 Key 代理拉取 OpenAI-compatible 模型列表，错误中不回显 Key | Renderer 提供逐 Agent 拉取、搜索、下拉和手工输入 |
| REST/OpenAPI | 鉴权、错误码、分页和业务状态稳定 | 只使用生成的 TypeScript 类型 |
| Timeline WS | 稳定 `item_key`、单 Session 单调 `seq`、历史重放与实时流可幂等合并 | 不能按文本内容去重 |
| Approval | 返回真实 Action、目标、风险、约束、过期时间和变更摘要 | UI 不得只显示模糊确认文案 |
| Shutdown/Cancel | 有界关闭和任务取消语义 | Electron 退出先请求关闭，再处理超时进程 |

B 需要向 A 回传：首次启动所需字段、Sidecar 崩溃状态、前端遇到的错误码缺口。Renderer 只允许在系统配置表单的瞬时状态中处理模型 Key，并通过回环 API 提交；不得写入 `localStorage`、日志或打包资源。B 不得在 Renderer 中读取数据库、SSH 私钥或启动子进程。

## A 向 C 交付

C 的执行入口只接受以下结构化对象：

- `ProposedAction`：执行意图、Target、参数、风险和幂等属性。
- `PolicyDecision`：`allow / require_approval / deny`、原因码和硬约束。
- Approval Token：绑定 Project、Incident、Target、Action Hash、审批人和过期时间。
- `ExecutionContext`：Correlation ID、Actor、Scope、超时、输出上限和取消句柄。
- `ExecutionResult`：统一成功/失败、退出码、结构化数据、Artifact 引用、截断和时间字段。

C 必须在执行前再次校验 Target、Action Hash、Decision 和 Approval Token，不能只相信上游布尔值。C 需要向 A 回传稳定错误码、Cancel Handle、输出分块、Artifact 元数据，以及 Transport 能力探测结果。

当前无 Docker 产品边界下，C 只实现：

- `SSHTransport`
- `LocalPowerShellTransport`
- 便携原生工具/脚本执行适配器
- 本机及 SSH Workspace 文件、终端、异步命令与取消

Docker Socket、容器网络和 Docker Toolpack 不进入仓库；上游 Sandbox 用户能力由 Windows 本机与 SSH Linux 双后端 Workspace Runtime 提供。13 个 Linux 专属 Skill 的执行路径见 `docs/tool-capability-matrix.md`。

### 当前运行接口

- `POST /api/agent-sessions/turns` 和 `POST /api/agent-sessions/{id}/turns` 接受 `sandbox_container_id`。
- `PATCH /api/agent-sessions/{id}/sandbox-container` 切换空闲会话的执行工作区。
- WorkProject 创建/更新接受 `sandbox_container_id`，项目会话固定继承该工作区。
- `/api/sandbox-containers/*` 保留上游命令、文件、Shell、生命周期和出口配置契约。
- `/api/approvals/*` 提供策略评估、审批、拒绝和 Token 消费。
- Agent 工具注册表包含 HTTP、页面读取、Web 检查、端口探测、SSH、同步/异步命令、输出读取、取消和 Skill 加载。

### 队友开发注意

- 不提交 `.env`、`.zj/`、`Z3r0/`、下载工具、SQLite、日志和报告。
- 新机器从 `.env.example` 创建本地 `.env`；正式包在系统配置页填写 Provider，Key 不进入 EXE。
- 开发阶段使用 `http://127.0.0.1:8000/` 或 Vite `http://127.0.0.1:5173/`，不需要反复打包 EXE。
- 便携工具执行 `powershell -ExecutionPolicy Bypass -File scripts/install-portable-tools.ps1 -Proxy http://127.0.0.1:7897`。
- 便携工具验收执行 `powershell -ExecutionPolicy Bypass -File scripts/validate-portable-tools.ps1`。
- Agent 实际命令运行时验收执行 `uv run python scripts/validate_workspace_runtime.py --workspace-id 1`。
- 工作区出口配置会在每次命令和 Shell 启动时生效；直连模式会清除宿主环境继承的代理变量，SSH 模式使用同一组受管代理语义。
- SSH 工作区需要把已核验的主机公钥写入 `.zj/ssh/known_hosts`；不得关闭 Host Key 校验。
- 每次合并前执行 `scripts/audit-upstream-migration.ps1` 和 `scripts/validate-portable-skills.ps1`；新增上游文件若未迁移或未明确替代，审计必须失败。

## A 向 D 交付

- 可注入 Mock Model 的 Agent Runtime 入口。
- Scope、Policy、Approval、Incident 和 Timeline 的确定性测试接口。
- 冷启动临时数据目录和 SQLite 测试夹具。
- 固定错误码和可构造的失败/取消/超时场景。
- OpenAPI、事件 Schema 和数据库升级说明。

D 向 A 回传 Agent 输出 Schema、工具权限矩阵、Prompt Injection 样本、Policy 负面测试和核心 E2E。D 发现任何未审批写操作、越界执行或 Timeline 缺失时，有权阻断发布。

## 变更流程

1. 提交者先修改 Schema 和对应测试。
2. 重新导出 OpenAPI 并生成前端类型。
3. 在 PR 中写清兼容性、迁移方式和受影响成员。
4. 至少由一个消费方负责人 Review。
5. 破坏性变更只在明确版本节点合入，不在未通知时直接修改字段语义。

## 每个成员的完成定义

- **A**：状态、权限、持久化、API 和恢复均有测试。
- **B**：桌面流程可操作，Sidecar 生命周期和失败状态可见，Portable 构建可复现。
- **C**：真实执行受控、可取消、可审计，超时和大输出不会拖垮进程。
- **D**：核心 E2E、越权负面测试、报告对账和干净 Windows 验收通过。

任何功能只有在提供方测试和至少一个消费方集成测试都通过后，才算完成交接。
