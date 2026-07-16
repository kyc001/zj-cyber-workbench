<aside>  
🧠

**岗位使命：保证真君系统的业务逻辑正确、状态可靠、策略不可绕过。**负责 ZJ Core、Agent Runtime、领域模型、Policy Engine、数据库和后端 API 的完整交付。

</aside>

## 一、职责边界

成员 A 负责系统的控制平面和事实状态中心，包括：

- 阅读、梳理并改造 Z3r0 Agent Runtime。
- Incident、Target、Scope、Action、Approval、Execution、ChangeSet 等领域模型。
- Agent 调度、任务状态机、暂停、恢复、取消与失败处理。
- Policy Engine 和 Approval Token。
- SQLite 默认模式与 PostgreSQL 兼容。
- FastAPI REST API、业务 WebSocket 事件和统一错误码。
- Timeline、Evidence 与 Artifact 元数据。
- 数据库迁移、备份、恢复和后端测试。

**不负责：**Electron 窗口和 UI、SSH 协议底层、SFTP 底层、Docker 工具执行；但负责定义这些模块依赖的业务接口与数据契约。

## 二、Z3r0 Runtime 梳理

需要首先确认并形成文档：

- 用户消息如何进入 Session Runtime。
- Lead Agent 如何选择和委派 Specialist Agent。
- Agent 如何发现、注册和调用 Tool。
- Tool 结果如何回到 Agent。
- Session、Task、Summary 和 Timeline 如何持久化。
- WorkProject、Asset、Finding、Graph Edge、Attack Path 的关联。
- WebSocket 事件如何发送到前端。
- 长任务如何暂停、恢复、取消。
- Sandbox、Host、Container 与 Project 如何绑定。

最终形成调用链：

```
HTTP/WebSocket Request
→ Session Runtime
→ Lead Agent
→ Specialist Agent
→ Tool Request
→ Policy Check
→ Execution Service
→ Evidence/Timeline
→ Agent Result
→ WebSocket Event
```

## 三、领域模型

负责新增或扩展：

- `Incident`：一次故障、安全检查、压测或修复任务。
- `Target`：本机、SSH 主机、Windows 主机、Sandbox。
- `AuthorizationScope`：允许的主机、端口、时间窗、操作类型和资源上限。
- `CredentialRef`：凭据引用，不保存凭据明文。
- `ProposedAction`：Agent 提出的结构化操作。
- `PolicyDecision`：允许、需要审批或拒绝。
- `Approval`：审批人、操作摘要、有效期和结果。
- `Execution`：真实执行记录、退出码、耗时和结果。
- `ExecutionChunk`：大输出索引。
- `Artifact`：日志、备份、扫描结果和文件哈希。
- `ChangeSet`：Precheck、Backup、Apply、Verify、Rollback。
- `VerificationResult`、`RollbackResult`。

所有模型必须有 Project/Incident 归属、时间戳、状态、Actor、Schema Version 和审计字段。

## 四、Incident 与 ChangeSet 状态机

正常路径：

```
created → planning → diagnosing → awaiting_approval
→ executing → verifying → completed
```

异常路径：

```
executing → failed / cancelled
verifying → rollback_required
rollback_required → rolling_back → rolled_back
```

必须保证：

- 状态不能非法跳转。
- 已取消任务不能继续写入成功结果。
- 过期审批不能启动执行。
- 修复失败必须进入验证失败或回滚状态。
- Agent 不能跳过 Verification 直接结束 Incident。
- Incident 完成前必须保存最终结论与遗留风险。

## 五、Agent Runtime 改造

保留 Z3r0 主循环，加入以下节点：

```
resolve_project_scope
classify_request_risk
create_incident
policy_check
approval_gate
execute_action
persist_evidence
build_changeset
verify_changeset
rollback_changeset
generate_incident_summary
```

需要支持：

- 多 Specialist 并行执行只读诊断。
- 中高风险操作暂停等待审批。
- Agent 任务持久化和恢复。
- 只读工具的有限幂等重试。
- 写工具禁止隐式自动重试。
- 用户取消后中断 Agent 和 Execution。
- 所有状态变化写入 Timeline。

## 六、Policy Engine

判定输入至少包括：Project、Incident、Target、Scope、Action、参数、发起 Agent、用户、目标环境、时间窗、备份和回滚信息、压测限制。

```python
class PolicyDecision(BaseModel):
    effect: Literal["allow", "require_approval", "deny"]
    risk_level: Literal["L0", "L1", "L2", "L3"]
    reason_codes: list[str]
    constraints: dict[str, Any]
    approval_ttl_seconds: int | None
```

强制规则：

- 目标不在 Scope：拒绝。
- 生产环境写操作：至少 L2 并要求审批。
- 删除、权限和防火墙修改：至少 L3。
- 没有回滚的配置修改：拒绝。
- 配置检查未通过的服务重启：拒绝。
- 压测不能超过目标、RPS、并发、时长和时间窗限制。
- CredentialRef 必须与 Target 匹配。
- Prompt 和 Tool 参数不能覆盖策略。

## 七、审批 Token

Token 必须绑定：

```
project_id | incident_id | action_hash | target_id | approver_id | expires_at
```

需要防止参数变化后复用、跨 Target 复用、跨 Incident 复用、过期复用、重放不可重入操作。

## 八、数据库与迁移

桌面默认 SQLite：

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=NORMAL;
```

负责处理 UUID、JSON、Enum、UTC、Foreign Key、单写队列和 SQLite 锁。终端输出按 Chunk 写 Artifact，数据库只保存摘要与索引。

迁移要求：

- 每次模型变化有升级和降级迁移。
- 升级前自动备份。
- 迁移失败恢复原数据库并阻止启动。
- Schema Version 写入 `/health`。
- 完成旧版本数据库升级回归测试。

## 九、API 与事件

负责或协调：

```
POST /desktop/bootstrap
GET  /health
POST /projects
POST /targets
POST /targets/ssh/test
POST /incidents
GET  /incidents/{id}
POST /incidents/{id}/messages
GET  /incidents/{id}/timeline
POST /actions/{id}/approve
POST /actions/{id}/reject
POST /actions/{id}/cancel
POST /changesets/{id}/apply
POST /changesets/{id}/verify
POST /changesets/{id}/rollback
POST /reports/incidents/{id}
```

统一事件：

```
incident.created
agent.started
agent.delegated
action.proposed
policy.decided
approval.requested
approval.granted
execution.started
execution.finished
finding.created
changeset.created
changeset.applied
verification.finished
rollback.started
incident.closed
```

## 十、最终交付物

- ZJ Core 可执行后端。
- Agent Runtime 改造。
- 完整领域模型和数据库迁移。
- Incident/ChangeSet 状态机。
- Policy Engine 与 Approval Token。
- REST API 和业务事件流。
- Timeline、Evidence、Artifact 服务。
- SQLite/PostgreSQL 兼容测试。
- 后端单元和集成测试。
- API、模型和迁移文档。

## 十一、验收标准

- [ ] Agent 无法绕过 Scope 和 Approval。
- [ ] 状态机拒绝非法跳转。
- [ ] SQLite 并发写入不锁死。
- [ ] 迁移失败不会损坏原数据库。
- [ ] 每次执行均有 Timeline 和 Audit 记录。
- [ ] ChangeSet 完成 Apply、Verify、Rollback。
- [ ] 崩溃重启后 Incident 状态可恢复。
- [ ] API 返回稳定错误码，不暴露裸堆栈。
- [ ] 凭据明文不会进入模型、数据库普通字段或日志。

## 十二、对其他成员的接口

- 向 B 提供 REST API、Timeline WebSocket、Schema、健康检查和 Shutdown API。
- 向 C 提供 PolicyDecision、Approval Token、Execution/Artifact 接口和 Action Registry 规范。
- 接收 C 的 Transport、ExecutionResult、Terminal Session 和 Cancel Handle。
- 接收 D 的 Agent Prompt、权限矩阵、输出 Schema 和负面测试。