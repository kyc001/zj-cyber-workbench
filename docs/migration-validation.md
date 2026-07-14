# Z3r0 完整迁移验证记录

验证日期：2026-07-14。

## 迁移范围

- 保留 Z3r0 的 Agent Session、主/子 Agent、通知恢复、Timeline、WorkProject、资产、发现、图谱和报告。
- 保留 Host、Egress Proxy、Sandbox Image/Container、Shell、文件管理、命令、异步任务和 Skill 契约。
- 不使用 Docker；Sandbox 底层替换为 Windows 本机工作区或 SSH Linux 工作区，二者共享命令、异步任务、Shell 和文件 API。
- SQLite 启动时自动添加会话工作区字段，并创建项目工作区绑定表。
- Web 与 Portable 模式均通过回环本机身份进入，不显示登录页、不保存登录 Token，也不要求固定口令。
- `scripts/audit-upstream-migration.ps1` 已将上游 432 个 Git 跟踪文件全部归类：330 个原路径保留、32 个 Skill 文件迁到 `skills/`、2 个 Skill 基础设施文件改写、68 个 Docker/登录/官网/上游文档文件由便携版对应物明确替代，未分类缺失为 0。
- OpenAPI 对账覆盖上游 57 条路径：仅登录接口按产品要求移除，共享路径缺失方法为 0；当前 63 条路径包含新增审批、模型拉取和健康检查。
- Egress 不再只是配置/UI：本机 PowerShell 与 SSH Linux 命令、交互 Shell 都在启动时应用直连、受管代理或 Tor 环境；SFTP 文件访问复用同一条已校验 SSH 连接。

## Agent 工具闭环

当前注册工具：

```text
http_request
browser_fetch
web_security_scan
port_probe
ssh_command
execute_sync_command
execute_async_command
read_sandbox_command_output
cancel_sandbox_async_job
load_skill
```

普通访问下，网络工具从当前消息提取声明目标；越界目标转为运行时授权请求，拒绝后不执行。同步/异步命令通过本机诊断策略、运行时授权、超时和输出上限。

顶栏可切换权限模式。普通访问对越界目标和中高风险操作发起运行时授权，支持拒绝、本次允许和按“操作类型 + 精确目标”始终允许；完全访问绕过目标范围和运行时授权，不产生权限或执行守卫审计记录。仓库及便携包不带默认 Provider Base URL，用户必须在系统配置页或本机忽略的 `.env` 中显式填写。

## 真实案例

输入：

```text
帮我对这个网站进行一些扫描，看看有没有潜在的漏洞。http://123.56.96.251/
```

最新复测 Session：`b5df621e-b4c4-4166-9284-8ce366866ff5`。本次生成 52 条持久事件和 22 次工具调用，实际使用 `http_request`、`browser_fetch`、`web_security_scan`、`port_probe` 及子 Agent 委派/结果读取。结果：

- HTTP 返回 `403 Forbidden`，服务端标识为 `openresty`。
- 页面无链接或表单，未发生重定向。
- TCP 22、80、443 可连接；21、25、3306、6379、8080、8443、27017 未发现开放。
- 403 响应缺少 CSP、X-Content-Type-Options、X-Frame-Options；HTTP 站点不适用 HSTS。
- 模型尝试继续访问 `https://123.56.96.251/` 时，因为授权 Scope 只声明了 HTTP，工具按预期拒绝。

该结果只代表低频、非破坏性暴露面检查，不等价于漏洞利用或完整渗透测试。

## 本地验证

```text
Python tests: 34 passed
Web TypeScript: passed
Desktop TypeScript: passed
Web production build: passed
Backend health: 200
No-token loopback Agent/Workspace API: 200
Host/Image/Workspace/Agent/Approval API: 200
Runtime permission normal/full-access API: passed
Blank default Provider configuration: passed
WorkProject -> Workspace binding: passed
Agent real tool loop: passed
Upstream 432-file audit: passed
Portable Skill validation: 25 passed
Portable native tool validation: 10 commands + Chrome + extension passed
```

## 便携工具

`scripts/install-portable-tools.ps1` 已通过 `127.0.0.1:7897` 验证，可安装：

- ffuf 2.2.1
- httpx 1.10.0
- dnsx 1.2.3
- subfinder 2.14.0
- gobuster 3.8.2
- amass 5.1.1
- uv 0.11.28
- Embedded Python 3.12.10
- observer_ward 2026.6.28
- agent-browser-cli 0.3.5
- Chrome for Testing 145.0.7632.117

工具位于 `.zj/tools`，由 Workspace Runtime 加入子进程 PATH，并已通过 `scripts/validate-portable-tools.ps1` 实际启动。sqlmap、gdb/pwndbg、strace/ltrace、hydra、pwntools、binwalk/checksec 等不在 Windows 本机绕过 Defender 或强行降级，统一通过 SSH Linux 工作区保留；完整矩阵见 `docs/tool-capability-matrix.md`。下载目录被 Git 忽略，高风险工具没有默认 Agent 授权。
