# 工具能力矩阵

## 执行后端

ZJ 保留上游 25 个 Skill，但不再假设 Docker/Kali 容器。每个执行工作区绑定一个运行主机：

- `local`：Windows 本机 PowerShell，使用 EXE 内 `portable-tools/`。
- `ssh`：用户配置的 Linux SSH 主机，命令、异步任务、交互终端和 SFTP 文件管理都进入该主机的 `$HOME/.zj/sandboxes/<id>/workspace`。

Agent 加载 Skill 时会收到当前后端说明。若 Skill 只支持 Linux，而会话选择了本机工作区，Agent 必须停止并要求切换 SSH 工作区，不能把文档建议伪装成执行结果。

## Windows 本机能力

| Skill | 运行时 |
| --- | --- |
| `agent-browser-cli` | agent-browser-cli、Chrome for Testing、扩展桥接 |
| `amass` | Windows amd64 原生版本 |
| `archive-file-triage` | PowerShell、tar 和系统文件接口 |
| `dns-whois` | PowerShell DNS；批量枚举使用 dnsx/subfinder |
| `dnsx` | Windows amd64 原生版本 |
| `ffuf` | Windows amd64 原生版本 |
| `gobuster` | Windows x64 原生版本 |
| `httpx` | Windows amd64 原生版本 |
| `observer-ward` | Windows x64 原生版本 |
| `sandbox-shell` | 受控 PowerShell 工作区 |
| `subfinder` | Windows amd64 原生版本 |
| `uv-python` | uv 和 Embedded Python 3.12 |

安装与验收：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-portable-tools.ps1 -Proxy http://127.0.0.1:7897
powershell -ExecutionPolicy Bypass -File scripts/validate-portable-tools.ps1
```

## SSH Linux 能力

以下上游能力在 Windows 本机不提供不可靠的降级实现，必须选择预装对应 CLI 的 SSH Linux 工作区：

`apktool`、`binwalk`、`checksec`、`gdb-pwndbg`、`ghidra`、`hydra`、`jadx`、`nmap`、`openssl`、`pwntools`、`seclists`、`sqlmap`、`strace-ltrace`。

原因包括 Linux 内核跟踪接口、ELF/GDB 集成、原生依赖或 Windows Defender 对上游安全工具源码的隔离。项目不关闭 Defender、不添加排除项，也不引入 WSL/Docker。

SSH 主机必须先安装所需工具，并把主机公钥写入 `.zj/ssh/known_hosts`。示例：

```powershell
ssh-keyscan -p 22 192.0.2.10 | Out-File -Append -Encoding ascii .zj/ssh/known_hosts
```

然后在“主机”页面添加 SSH 地址、账号和密码，在“执行工作区”创建时选择该主机及工具基线。首次执行前用 `command -v <tool>` 验证实际安装状态。

## 发布边界

- `.zj/tools` 是开发下载缓存，Git 忽略；发布脚本只把通过验证的工具复制为 `portable-tools/`。
- `.env`、Provider Key、SSH 凭据、SQLite、日志和历史 Artifact 不进入 EXE。
- 下载工具必须保留上游 LICENSE/NOTICE；`scripts/validate-portable-tools.ps1` 会检查许可证文件。
- 高风险 CLI 存在不等于自动授权。Scope、Policy、Approval、目标限制、超时、取消和审计仍在执行前生效。
