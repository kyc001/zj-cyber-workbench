<aside>  
🛠️

**岗位使命：把真君做成可靠的执行工作台和工具箱。**C 模块负责所有接触本机或远程目标的执行能力：本机 Workspace、SSH/SFTP、PowerShell、便携工具、Linux 远程工具、扫描/压测、任务取消、输出解析和执行审计。

</aside>

## 一、当前代码基线

当前 `zj-cyber-workbench` 已经废弃 Docker 路线：

- 不要求最终用户安装 Docker、WSL、PostgreSQL、Python、Node.js 或 pnpm。
- 开发模式数据在 `.zj/`，Portable 版数据在 EXE 旁的 `data/`。
- 数据库是 SQLite WAL。
- 执行工作区保留 `/api/sandbox-containers` 这组 API 名称，但语义已经从 Docker 容器改为 **本机 Workspace / SSH Workspace**。
- 当前默认会创建本机 `zj-portable-tools` 工作区。
- Windows 原生工具进入 `portable-tools/`；Linux 强依赖工具走 SSH Linux 主机。

本文中“Sandbox”不再指 Docker 容器，而是指受控执行工作区。

## 二、职责边界

负责：

- Transport / Execution 抽象。
- 本机 Workspace 命令、文件、Shell。
- SSH 主机连接、Host Key、一次性命令、交互式 Shell。
- SFTP 文件操作。
- 本机 PowerShell 诊断和有限受控变更。
- `portable-tools/` 工具箱安装、校验、发现、执行和解析。
- Linux SSH Toolpack 适配。
- 扫描、探测和压测执行安全。
- 超时、背压、限流、取消、进程树清理。
- 统一 `ExecutionResult`、Artifact 和 Tool Parser。

不负责：

- 是否允许操作的最终业务判定；PolicyDecision、Approval 和 Runtime Permission 由 A 提供。
- Agent 是否决定调用工具；Prompt、工具权限矩阵和评测由 D 提供。
- 前端工具箱页面视觉和终端 UI；B 消费 C 提供的 API/WebSocket。

但 C 的执行器必须在执行前再次校验 Scope、Policy、Approval/Permission，不能盲信 Agent 或前端。

## 三、执行后端抽象

首批实现以当前代码为准：

```python
class ExecutionBackend:
    async def exec(self, action): ...
    async def open_shell(self): ...
    async def list_files(self, path): ...
    async def upload(self, path, stream): ...
    async def download(self, path): ...
    async def cancel(self, execution_id): ...
```

v1.0 只做：

- `LocalWorkspaceBackend`：Windows 本机 PowerShell、便携工具和受控目录。
- `SSHWorkspaceBackend`：Linux SSH 命令、PTY、SFTP 和远程工具。

不做：

- DockerTransport。
- Kubernetes。
- WinRM。
- 远程 Runner 常驻服务。

## 四、SSH 与 Host Key

SSH 使用 AsyncSSH 或当前代码中的等价实现，必须覆盖：

- 密码、私钥、Passphrase 和 SSH Agent 认证。
- 严格 Host Key 校验。
- `.zj/ssh/known_hosts` 管理。
- 指纹变化立即阻断并记录安全事件。
- 区分域名、IP 和端口。
- 禁止 Agent 自动接受新的 Host Key。
- 连接超时、Keepalive、空闲回收。
- 一次性命令、PTY、交互式 Shell、Resize、Signal。
- 断线、取消、重连和资源清理。

连接池隔离键：

```text
project_id + host_id + credential_ref + user_identity
```

不同 Project 不得共享高权限 SSH Connection。

## 五、Terminal WebSocket

客户端消息：

```json
{"type":"input","seq":12,"data":"...base64..."}
{"type":"resize","cols":120,"rows":36}
{"type":"signal","name":"INT"}
{"type":"close"}
```

服务端消息：

```json
{"type":"output","seq":98,"stream":"pty","data":"...base64..."}
{"type":"status","state":"connected"}
{"type":"exit","code":0,"signal":null}
{"type":"error","code":"SSH_DISCONNECTED","message":"..."}
```

要求：

- 二进制按 Base64 传输。
- 输出分块和背压。
- 最后有限历史回放。
- 原始大输出写 Artifact，不无限进入内存。
- Ctrl+C、关闭、断线和页面刷新后资源可清理。

## 六、文件管理

本机 Workspace 和 SSH Workspace 都要支持：

- List、Stat、Read、Write。
- 上传、下载、新建目录。
- 删除、复制、移动、重命名。
- 路径归一化和 `..` 逃逸防护。
- 符号链接检查。
- 文件大小限制和 SHA-256。
- 上传先写 `.zj-upload-<uuid>.tmp`，成功后原子替换。
- 覆盖、删除、重命名属于高风险操作，必须走策略/审批。
- 覆盖前备份并生成 Artifact 或 Change 记录。
- 失败和取消后清理临时文件。

## 七、本机 PowerShell

本机 PowerShell 只暴露白名单动作。

只读能力：

- 系统、CPU、内存、磁盘。
- 服务、进程、端口。
- Event Log。
- 防火墙状态、网络配置、计划任务。

受控修改能力：

- 服务重启。
- 文件备份和配置替换。
- 有限防火墙规则。
- 经批准的固定脚本。

禁止：

- 拼接任意用户字符串。
- 让 Agent 直接执行自由 PowerShell。
- 把密码、Token、私钥写入命令、日志、Artifact 或 Agent Context。

## 八、UAC Helper

`zj-helper.exe` 放在 v1.0 后段实现；若时间不足，可只保留设计和禁用入口。

要求：

1. 后端生成一次性任务文件。
2. 文件包含 Action、目标、过期时间、Nonce 和摘要。
3. Electron 以 `runas` 触发 UAC。
4. Helper 验证签名/HMAC、Action Hash 和有效期。
5. 只执行 Action Registry 中的操作。
6. 不接受任意 Shell 字符串。
7. 结果写入仅当前用户可读的文件，读取后删除。

主程序不得长期以管理员身份运行。

## 九、Action Registry

首批动作：

```text
host.local.diagnostic
ssh.command
ssh.shell
ssh.sftp.list
ssh.sftp.upload
ssh.sftp.download
linux.service.status
linux.service.restart
linux.log.tail
linux.disk.summary
linux.network.connections
windows.service.status
windows.service.restart
windows.eventlog.query
windows.file.backup
windows.file.replace
web.http.health
web.tls.inspect
web.port.probe
tool.ffuf.run
tool.httpx.run
tool.dnsx.run
tool.subfinder.run
tool.nmap.ssh
load.k6.run
```

每个 Action 必须声明：

- 输入 Schema。
- 平台和后端。
- 风险等级。
- Scope 要求。
- 是否需要 Approval。
- 超时、最大输出、最大文件数。
- 幂等性和重试策略。
- Backup、Verify、Rollback。
- Artifact 与结构化解析器。

## 十、Toolpack / 工具箱

这是 C 模块的核心之一。工具箱不是 Agent 的附属品，而是产品能力：

- 用户可以在 UI 中直接运行工具。
- Agent 也可以在授权后调用同一套工具。
- 两条入口必须共用同一个执行器、策略校验、输出解析和审计记录。

### Windows 本机便携工具

优先支持当前矩阵中的 Windows 原生工具：

```text
ffuf
httpx
dnsx
subfinder
gobuster
amass
observer_ward
agent-browser-cli
Chrome for Testing
uv / Embedded Python
```

要求：

- 下载到 `.zj/tools`。
- 校验版本、SHA-256 和 LICENSE/NOTICE。
- 发布时复制为 `portable-tools/`。
- 不关闭 Windows Defender，不要求用户添加杀软排除。
- 工具缺失时 UI 显示禁用和安装/修复提示。

### SSH Linux 工具

以下工具默认走 SSH Linux 工作区：

```text
nmap
sqlmap
hydra
ghidra
jadx
apktool
binwalk
checksec
gdb-pwndbg
strace/ltrace
pwntools
seclists
```

要求：

- 执行前用 `command -v` 验证工具存在。
- 缺失时返回稳定错误，不伪造结果。
- 所有目标必须来自 Project Scope。
- 原始结果写 Artifact，解析成 Finding/Observation。

### 工具 Manifest

每个工具至少需要：

```text
manifest.yaml
input.schema.json
output.schema.json
executor.py
parser.py
policy.yaml
test_executor.py
```

## 十一、扫描与压测

扫描和压测不是“能跑命令”就算完成，必须有硬限制：

- 目标白名单。
- 最大 RPS。
- 最大并发。
- 最大持续时间。
- Ramp-up。
- 时间窗。
- 实时输出。
- Kill Switch。
- UI/Agent 断连后的停止策略。
- 进程树终止。
- 结果解析和 Artifact。

执行器必须再次检查所有限制，禁止通过拆分任务绕过总额度。

## 十二、统一 ExecutionResult

```json
{
  "ok": true,
  "execution_id": "...",
  "summary": "...",
  "structured": {},
  "artifact_refs": [],
  "exit_code": 0,
  "started_at": "...",
  "finished_at": "...",
  "truncated": false,
  "error_code": ""
}
```

错误码至少区分：

```text
connect_failed
auth_failed
host_key_changed
permission_denied
policy_denied
approval_required
timeout
canceled
process_failed
output_truncated
tool_missing
platform_unsupported
scope_denied
```

## 十三、当前优先级

1. 梳理当前 `service/sandbox/local_runtime.py`、`remote_runtime.py`、`commands.py`、`files.py` 的能力和缺口。
2. 固化 `ExecutionResult` 和错误码。
3. 完成本机 Workspace 文件/命令只读路径测试。
4. 完成 SSH Host Key、命令、SFTP、取消测试。
5. 做 `portable-tools` 工具发现和 manifest。
6. 接 2 到 3 个 Windows 本机工具：`httpx`、`dnsx`、`ffuf`。
7. 接 1 到 2 个 SSH Linux 工具：`nmap`、`sqlmap` 或按课程要求选择。
8. 给 B 稳定 API/WebSocket，给 D 可复现测试场景。

## 十四、最终交付物

- Local/SSH 执行后端。
- SSH 连接、Host Key、Terminal WebSocket。
- SFTP。
- PowerShell 执行器和 UAC Helper 设计/实现。
- Action Registry。
- Windows、Linux、Web Toolpack。
- 工具 Manifest、安装校验和 parser。
- k6 或等价压测适配。
- 任务取消、进程树和资源清理。
- `ExecutionResult` 和执行层测试。
- 执行器开发文档。

## 十五、验收标准

- [ ] Host Key 变化时阻止连接。
- [ ] 不同 Project 不共享 SSH 会话。
- [ ] 取消后本机/远程进程真正终止。
- [ ] 大输出不会耗尽内存和磁盘。
- [ ] 文件操作无法逃逸允许目录。
- [ ] 扫描和压测不能访问 Scope 外目标。
- [ ] 压测无法超过 RPS、并发和时长。
- [ ] 写操作具有 Backup、Verify、Rollback 或明确禁用。
- [ ] 无便携工具时其他功能正常。
- [ ] Tool 返回稳定结构化结果。

## 十六、对其他成员的接口

- 接收 A 的 PolicyDecision、Approval Token、Runtime Permission、Action 规范和 Artifact 接口。
- 向 A 返回 ExecutionResult、Terminal Session、ArtifactRef 和 CancelHandle。
- 向 B 提供稳定 Terminal/SFTP WebSocket、工具箱 API 和状态事件。
- 接收 D 的恶意输入、越界、压测和执行失败测试集。
