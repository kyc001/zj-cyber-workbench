# D 组 Tool 权限矩阵

本矩阵定义产品角色对 Agent 工具的默认权限。最终执行仍以 `core/action_registry.py`、Policy Engine、Runtime Permission 和 Approval Token 为准；本文件用于 Prompt、评测、UI 风险文案和 D 组验收。

权限标记：

- `A`：允许直接使用，但仍受 Scope 和运行时限流约束。
- `R`：只读允许。
- `P`：必须审批后才能执行。
- `D`：默认禁止。
- `N/A`：该角色不应拥有该工具。

| 工具/能力 | Ops Lead | Diagnostic | Security | Load Test | Remediation | Verification | Reporter |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `load_work_project_metadata` | R | R | R | R | R | R | R |
| `load_work_project_tasks` | R | R | R | R | R | R | R |
| `load_work_project_agent_summaries` | R | R | R | R | R | R | R |
| `update_work_project_agent_summary` | A | A | A | A | A | A | N/A |
| `update_work_project_tasks` | A | N/A | N/A | N/A | N/A | N/A | N/A |
| `list_work_project_assets` | R | R | R | R | R | R | R |
| `create_or_update_work_project_asset` | A | A | A | N/A | A | A | N/A |
| `list_work_project_findings` | R | R | R | R | R | R | R |
| `create_or_update_work_project_finding` | A | A | A | N/A | A | A | N/A |
| `load_work_project_graph` | R | R | R | N/A | R | R | R |
| `create_or_update_work_project_graph_edge` | A | A | A | N/A | A | A | N/A |
| `create_or_update_work_project_attack_path` | A | N/A | A | N/A | N/A | N/A | N/A |
| `create_or_update_work_project_attack_path_step` | A | N/A | A | N/A | N/A | N/A | N/A |
| `delete_work_project_record` | P | D | D | D | P | D | D |
| `search_cve_intelligence` | R | R | R | N/A | R | R | R |
| `http_request` | R | R | R | R | R | R | N/A |
| `browser_fetch` | R | R | R | R | R | R | N/A |
| `web_security_scan` | P | N/A | P | N/A | N/A | P | N/A |
| `port_probe` | P | R | P | N/A | N/A | R | N/A |
| `ssh_command` | P | R | P | N/A | P | R | D |
| `execute_sync_command` | P | R | P | P | P | R | D |
| `execute_async_command` | P | R | P | P | P | R | D |
| `read_sandbox_command_output` | R | R | R | R | R | R | R |
| `cancel_sandbox_async_job` | A | A | A | A | A | A | N/A |
| `load_skill` | R | R | R | R | R | R | N/A |
| `export_report` | A | N/A | N/A | N/A | N/A | N/A | A |
| `start_subagent_task` | A | N/A | N/A | N/A | N/A | N/A | N/A |
| `read_subagent_task` | A | N/A | N/A | N/A | N/A | N/A | N/A |
| `cancel_subagent_task` | A | N/A | N/A | N/A | N/A | N/A | N/A |

## 强制规则

- `web_security_scan`、`port_probe`、`ssh_command`、`execute_*` 即使矩阵标为 `R`，也必须经过 Scope 检查。
- Load Test Engineer 只能通过受控 Action `load.k6.run` 或后续等价 Toolpack 入口压测，不得用通用命令拆分绕过限制。
- Evidence Reporter 不拥有执行工具；报告所需证据必须来自 Timeline、Finding、Execution 和 Artifact。
- Verification Engineer 只能只读验证；任何写入需求都退回 Ops Lead 和 Remediation。
- `delete_work_project_record` 只用于删除错误记录或噪声，生产证据不得被静默删除。

## Action 风险分层

| Action | 默认风险 | D 组要求 |
| --- | --- | --- |
| `host.local.diagnostic` | L0 | 只读允许，输出不得包含敏感信息 |
| `ssh.command` | L1/L2 使用场景相关 | 命令必须只读或经审批；不得传入明文凭据 |
| `linux.service.restart` | L2 | 必须有 Precheck、Rollback、Verification |
| `windows.service.restart` | L2 | 必须有 Precheck、Rollback、Verification |
| `windows.file.replace` | L2 | 必须备份、审批、验证 |
| `web.http.health` | L0 | 仅 Scope 内 GET/HEAD |
| `network.port.probe` | L1/L2 | 小范围、低频、Scope 内 |
| `tool.ffuf.run` | L1 | 必须限制字典、速率和 Scope |
| `tool.nmap.ssh` | L1 | SSH Workspace 内执行，禁止越界 |
| `load.k6.run` | L2 | 必须审批；超过 Scope 限制直接拒绝 |

