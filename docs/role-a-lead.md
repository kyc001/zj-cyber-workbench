# 成员 A（组长）执行说明

## 你的实际角色

你不是单纯的后端开发。你同时承担三项最终责任：

1. **系统契约负责人**：定义 Project、Incident、Scope、Action、Policy、Approval、Execution、Evidence、Timeline 的唯一语义。
2. **ZJ Core 负责人**：保证 Agent Runtime、持久化、API、状态机和异常恢复在同一套规则下工作。
3. **集成组长**：冻结 A/B/C/D 的接口，控制主干质量，发现跨模块阻塞并组织验收。

判断某项工作是否属于 A 的标准是：它是否决定“系统事实是什么、状态能否变化、操作是否允许、结果如何被审计”。如果答案是是，A 必须负责或至少批准契约。

## 当前基线

仓库已经完成以下 A 侧基础工作：

- 迁移 Z3r0 的 Agent Session、委派、上下文压缩、Timeline、WorkProject、Evidence 相关骨架。
- 建立 `ProposedAction`、`PolicyDecision`、`AuthorizationScope`、`Approval`、`ExecutionResult` 等纯领域契约。
- 建立 `PolicyEngine`、`ApprovalGate`、`ActionRegistry`、`OpsRuntime` 的第一版可测试实现。
- 将 PostgreSQL 专属持久化改为 SQLite：WAL、Foreign Key、Busy Timeout 和 Timeline upsert 已验证。
- 将 LightRAG 改为本地 JSON、NanoVectorDB、NetworkX 存储，不再依赖 PostgreSQL。
- 保留 Z3r0 MIT License、第三方声明和上游基线信息。

这些内容是工程底座，不代表业务闭环已经完成。当前 `IncidentService` 仍是轻量领域实现，Incident、Approval、Execution、Artifact、ChangeSet 等还需要正式持久化模型、API 和恢复逻辑。

## A 的主调用链

```text
REST / WebSocket request
  -> authenticate actor and resolve Project / Incident
  -> resolve AuthorizationScope
  -> create ProposedAction
  -> PolicyEngine.evaluate
       -> deny: persist decision and Timeline event
       -> require_approval: create Approval and suspend execution
       -> allow: issue bounded execution authorization
  -> C-owned Transport / Executor
  -> normalize ExecutionResult
  -> persist Artifact / Evidence / Timeline
  -> update Incident / ChangeSet state
  -> independent verification
  -> resume Agent Runtime and stream result to B
```

任何执行路径都必须经过这条链。Agent Prompt、前端按钮或执行器内部判断都不能替代 A 的 Policy 和 Approval 事实记录。

## 实施优先级

### P0：冻结领域事实和状态机

- 将 `schema/action.py`、`schema/incident.py`、`schema/approval.py`、`schema/transport.py` 定为跨组契约入口。
- 为 Incident、Approval、Execution、Artifact、ChangeSet、Verification 建立 SQLModel 持久化模型。
- 明确每个状态的合法迁移、操作者、前置条件和 Timeline 事件。
- Approval 必须绑定 `project_id + incident_id + target_id + action_hash + approver_id + expires_at`。
- Action 参数、目标或 Incident 改变后，旧审批立即失效。

### P0：实现业务 API 和恢复

- 创建 Project/Incident/Target/Scope、提交消息、审批/拒绝/取消、查询 Timeline 的 REST API。
- 提供稳定错误码、Correlation ID、权限检查和 OpenAPI。
- Sidecar 重启时恢复未完成 Session，并将中断中的 Execution 标记为可解释状态，不能静默显示成功。
- SQLite 结构升级前备份数据库；迁移失败时保留原文件并阻止继续写入。

### P0：把控制节点接入 Agent Runtime

- Agent 只能提出结构化 `ProposedAction`，不能直接提交任意命令给执行层。
- L0/L1 只读操作仍需 Scope 校验；L2/L3 写操作必须等待审批。
- 执行开始、输出摘要、结束、失败、取消、验证和回滚均写入 Timeline。
- 用户取消需要同时中断 Agent 任务和 C 提供的 Cancel Handle。

### P1：证据和变更闭环

- 大输出写 Artifact，SQLite 只保存摘要、哈希、大小、MIME、来源和引用。
- ChangeSet 固定为 Precheck、Backup、Apply、Verify、Rollback 五阶段。
- Remediation 的执行成功不能直接关闭 Incident，必须经过独立 Verification。
- Timeline 是审计事实源，聊天记录只是 Agent 上下文来源之一。

### P1：组长集成纪律

- 公共 Schema 变更必须先更新测试和 OpenAPI，再通知 B/C/D。
- 每天保持 `main` 可构建；不接受跨天存在的破坏性接口占位。
- A 评审 C 的执行授权入口，B 评审桌面集成，D 评审负面安全测试。
- 所有跨组阻塞都记录“负责人、所需输入、截止点、临时兼容方案”。

## A 不应抢做的内容

- 不实现 Electron 页面、视觉和终端组件，这些由 B 负责。
- 不实现 SSH/SFTP/PowerShell 协议细节和工具解析器，这些由 C 负责。
- 不替 D 编写最终 Agent Prompt、评测集和发行验收，但必须提供可测试的控制边界。
- 不恢复 Docker、Compose、容器 Sandbox、Docker Host、Egress Proxy 或 noVNC。
- 不为“以后可能需要”保留 PostgreSQL 运行依赖；当前产品合同是单机便携 SQLite。

## A 的验收标准

- 越界 Target 永远返回 `deny`，且有持久化原因码。
- 生产写操作不存在未审批执行路径。
- Approval 不能跨 Action、Target、Incident 复用或过期重放。
- Incident 状态不能非法跳转，取消后的任务不能写入成功终态。
- SQLite 冷启动、并发写、重启恢复和升级失败恢复都有测试。
- 所有执行都能从 Timeline 对账到 Policy、Approval、ExecutionResult 和 Artifact。
- B、C、D 不需要读取 A 的内部实现即可通过冻结契约开发。
- 干净 Windows 机器无需 Docker、PostgreSQL、Python 或 Node.js 即可运行最终 Portable EXE。
