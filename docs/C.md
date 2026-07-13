<aside>  
🛠️

**岗位使命：保证真君能够在严格授权和限制下，稳定地执行真实远程操作。**负责 SSH、SFTP、PowerShell、UAC Helper、Sandbox、Toolpack、扫描和压测执行层。

</aside>

## 一、职责边界

负责所有接触本机或远程目标的能力：

- Transport 抽象。
- SSH、Host Key、交互式 Shell、一次性命令。
- SFTP 文件操作。
- 本机 PowerShell 和 Windows UAC Helper。
- Action Registry 和结构化命令映射。
- Linux、Windows、Web Toolpack。
- Docker Sandbox。
- 授权安全检查与压测。
- 超时、背压、限流、取消、进程清理。
- 统一 ExecutionResult 和 Tool Parser。

**不负责：**是否允许操作的最终业务判定；PolicyDecision 由 A 提供。但执行前必须重新校验 Scope、Policy 和 Approval Token，不能盲信调用方。

## 二、Transport 抽象

```python
class Transport:
    async def connect(self): ...
    async def exec(self, action): ...
    async def open_shell(self): ...
    async def upload(self): ...
    async def download(self): ...
    async def cancel(self, execution_id): ...
    async def close(self): ...
```

首批实现：

- `SSHTransport`
- `LocalPowerShellTransport`
- `SandboxTransport`

为后续 WinRM、Kubernetes、远程 Runner 预留接口，但不进入 v1.0 实现。

## 三、SSHTransport

建议 AsyncSSH，负责：

- 密码、私钥、Passphrase 和 SSH Agent 认证。
- Host Key 校验。
- 连接超时、Keepalive 和空闲回收。
- 一次性命令、PTY、交互式 Shell。
- Terminal Resize 和 Signal。
- Sudo 交互。
- 断线、重连和资源清理。
- Jump Host 仅预留数据结构。

连接池隔离键：

```
project_id + target_id + credential_ref + user_identity
```

不同 Project 不得共享高权限 SSH Connection。空闲 10 分钟关闭，应用退出全部关闭。

## 四、Host Key 管理

- 首次连接返回算法、SHA-256 指纹、Host 和 Port。
- 用户确认后写入 `known_hosts`。
- 指纹变化立即阻断连接并记录安全事件。
- 区分域名、IP、端口。
- 不提供默认忽略 Host Key 的选项。
- 禁止 Agent 自动接受新的 Host Key。

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

需要处理二进制传输、序号、背压、输出分块、退出码、Signal、断线和最大历史。原始输出写 Artifact，不能无限保存在内存和 WebSocket 队列中。

## 六、SFTP

实现：

- List、Stat、上传、下载、新建目录。
- 删除和重命名作为高风险操作。
- Project 级允许根目录。
- 路径归一化、`..` 防护和符号链接检查。
- 文件大小限制和 SHA-256。
- 上传先写 `.zj-upload-<uuid>.tmp`，成功后原子重命名。
- 覆盖文件前备份并关联 ChangeSet。
- 明确中断、取消和失败后的临时文件清理。

## 七、本机 PowerShell

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

要求：使用结构化参数或固定脚本，禁止拼接任意用户字符串；设置超时、退出码、标准输出/错误和脱敏。

## 八、UAC Helper

实现 `zj-helper.exe`：

1. 后端生成一次性任务文件。
2. 文件包含 Action、目标、过期时间、Nonce 和摘要。
3. Electron 以 `runas` 触发 UAC。
4. Helper 验证签名/HMAC、Action Hash 和有效期。
5. 只执行 Action Registry 中的操作。
6. 不接受任意 Shell 字符串。
7. 结果写入仅当前用户可读的文件，读取后删除。

主程序不得长期以管理员身份运行。

## 九、Action Registry

首批 Action：

```
linux.service.status
linux.service.restart
linux.log.tail
linux.disk.summary
linux.network.connections
linux.file.backup
linux.file.replace
windows.service.status
windows.service.restart
windows.eventlog.query
windows.file.backup
windows.file.replace
web.http.health
web.tls.inspect
```

每个 Action 必须声明：Schema、平台、风险、Scope、权限、超时、最大输出、幂等性、重试策略、Backup、Verify、Rollback。

## 十、Toolpack

### Linux 运维

系统概况、服务、Journal/System Log、CPU、内存、磁盘、端口、连接、DNS、TLS、时间同步、配置备份、语法检查、服务重启和健康检查。

### Windows 运维

服务、Event Log、进程、端口、磁盘、网络、防火墙状态、文件备份和替换。

### Web Health

DNS、TCP、TLS 证书、HTTP 状态、重定向、响应时间、关键 Header 和健康检查。

### 安全工具

复用 Z3r0 Sandbox 的端口识别、HTTP 探测、依赖/配置检查和授权漏洞验证。原始结果写 Artifact，解析成 Finding。

每个工具目录必须包含：

```
manifest.yaml
input.schema.json
output.schema.json
executor.py
parser.py
policy.yaml
test_executor.py
```

## 十一、压测执行

集成一种成熟引擎，优先 k6：

- 最大 RPS、并发、Ramp-up、持续时间。
- 目标白名单和时间窗。
- 实时输出和 Kill Switch。
- Agent/UI 断连后的停止策略。
- 进程树终止。
- 结果解析和 Artifact。

执行器必须再次检查所有限制，禁止通过拆分任务绕过总额度。

## 十二、Docker Sandbox

- 非 Root。
- CPU、内存、PID 和磁盘限制。
- 工作目录和 Artifact 挂载。
- 网络出口白名单。
- 超时回收和任务取消。
- 容器、网络和临时文件清理。
- 镜像版本、Digest 和 Tool 版本记录。

禁止 `--privileged`、挂载宿主 Docker Socket、任意宿主目录、未授权目标流量和 Agent 任意开放端口。

## 十三、统一 ExecutionResult

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
  "truncated": false
}
```

错误码区分连接、认证、Host Key、权限、超时、取消、策略拒绝、执行失败、输出超限和平台不支持。

## 十四、最终交付物

- Transport 抽象及三种实现。
- SSH 连接池、Host Key、Terminal WebSocket。
- SFTP。
- PowerShell 执行器和 `zj-helper.exe`。
- Action Registry。
- Linux、Windows、Web Toolpack。
- Sandbox 和安全工具适配。
- k6 压测适配。
- 任务取消、进程树和资源清理。
- Tool Parser、ExecutionResult 和执行层测试。
- 执行器开发文档。

## 十五、验收标准

- [ ] Host Key 变化时阻止连接。
- [ ] 不同 Project 不共享 SSH 会话。
- [ ] 取消后远程进程/容器真正终止。
- [ ] 大输出不会耗尽内存和磁盘。
- [ ] SFTP 无法逃逸允许目录。
- [ ] 扫描和压测不能访问 Scope 外目标。
- [ ] 压测无法超过 RPS、并发和时长。
- [ ] 写操作具有 Backup、Verify、Rollback。
- [ ] 无 Docker 时其他功能正常。
- [ ] Tool 返回稳定结构化结果。

## 十六、对其他成员的接口

- 接收 A 的 PolicyDecision、Approval Token、Execution/Artifact 接口和 Action 规范。
- 向 A 返回 Transport、ExecutionResult、Terminal Session、ArtifactRef 和 CancelHandle。
- 向 B 提供稳定 Terminal/SFTP WebSocket 协议和状态事件。
- 接收 D 的恶意输入、越界、压测和执行失败测试集。