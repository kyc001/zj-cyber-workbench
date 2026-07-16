# 无 Docker 便携架构补充说明

## 决策优先级

本文件记录老师新增的强制约束，并覆盖 `A.md`、`B.md`、`C.md`、`D.md` 和 `方案.md` 中所有 Docker、Compose、容器 Sandbox、Docker Host、Egress Proxy、noVNC 相关设计。原文保留作为需求演变记录，不再作为实现依据。

## 最终运行架构

```text
ZJ Portable EXE (Electron Main + Preload + React)
  -> loopback REST / WebSocket
  -> zj-core.exe (Python FastAPI Sidecar)
       -> embedded SQLite (WAL)
       -> local LightRAG files
       -> Local PowerShell
       -> SSH / SFTP
       -> explicitly bundled portable native tools
```

最终用户机器不得要求安装 Docker Desktop、WSL、PostgreSQL、Python、Node.js 或 pnpm。

## 数据目录

- 开发模式默认使用仓库根目录 `.zj/`。
- Sidecar 接受 `ZJ_DATA_DIR=<absolute path>`。
- Portable 版由 Electron 将数据目录设为便携程序旁的 `data/`。
- SQLite、配置、日志、Artifact 和 LightRAG 文件全部位于该目录。
- `.z3r0/agents` 是随程序打包的只读 Agent 资源，不作为运行数据目录。

SQLite 启动固定启用：

```text
journal_mode=WAL
foreign_keys=ON
busy_timeout=5000
synchronous=NORMAL
```

## 被明确排除的实现依赖

- Dockerfile、Docker Compose、镜像构建、Docker SDK 和 Docker Socket。
- 远程 Docker Host 与容器网络命名空间。
- 在 Windows 本机伪装实现依赖 Linux 内核或 ELF/GDB 生态的工具；这些能力改走 SSH Linux 工作区。

这些能力不能以“可选依赖”的形式重新加入 v1，因为老师的要求是项目不使用 Docker，而不是仅允许无 Docker 降级启动。

## 替代方案

| 原设计 | 当前替代 |
| --- | --- |
| PostgreSQL | Embedded SQLite WAL |
| PGVector/PG LightRAG | NanoVectorDB + NetworkX + JSON local storage |
| Docker Sandbox | 本机隔离 Workspace + SSH 远端执行 + 便携工具 |
| Docker Toolpack | Manifest 驱动的 EXE/PowerShell/Python-sidecar 内置适配器 |
| 容器 Shell/文件 | 本机 PowerShell 或 SSH Shell、目录白名单和本机/SFTP 文件 API |
| 容器隔离 | Scope、Policy、Approval、低权限进程、超时、输出上限和目录白名单 |
| noVNC | 保留兼容入口；本机工作区无图形桌面时禁用，后续可接 Chromium Sidecar |
| Egress Proxy | 保留配置与 UI，同时以 Target 白名单和执行前二次校验兜底 |

## 已完成的等价迁移

- Agent 可调用 HTTP GET/HEAD、网页读取、低风险 Web Header/TLS 检查和小范围 TCP 端口探测。
- Agent 可调用同步/异步本机或 SSH 命令，支持超时、取消、分块输出和 JSONL 审计。
- 执行工作区支持创建、选择、项目绑定、本机/SFTP 文件浏览、上传下载、复制移动删除和交互终端。
- 子 Agent、通知恢复和后端重启恢复继承同一工作区与授权 Scope。
- Agent 的独立 SSH 工具使用 `credential_ref`；SSH 工作区使用“主机”配置，并统一通过 `.zj/ssh/known_hosts` 严格校验主机公钥。
- L2/L3 提供审批创建、批准、拒绝、Token 签发和一次性消费 API。
- `.zj/tools` 可下载并验证 ffuf、httpx、dnsx、subfinder、gobuster、amass、uv、Embedded Python、observer_ward、agent-browser-cli 和 Chrome；sqlmap 等 Linux 专属能力走 SSH 工作区，详见 `docs/tool-capability-matrix.md`。

移除容器后，执行安全不能降低。任意写操作仍必须经过 Scope、Policy、Approval、备份、验证和回滚；任意外部工具必须固定版本、校验哈希并限制工作目录和目标。

## EXE 打包边界

- `zj-core.exe`：使用 PyInstaller 打包 FastAPI Sidecar、Python 依赖、Agent 资源和内置脚本。
- `zhenjun.exe` / Portable 产物：使用 Electron Builder 打包桌面进程、React 静态资源和 `zj-core.exe`。
- 目标产物：`ZJ-<version>-win-x64-portable.exe`。
- Electron 负责选择空闲回环端口、自动建立本地管理员会话、传入 `ZJ_DATA_DIR`、轮询 `/health`、关闭 Sidecar 和处理进程树。
- Sidecar 只绑定 `127.0.0.1`，不作为局域网 Web 服务发布。
- Portable 模式不显示登录页，不使用固定口令、JWT、Header Token 或桌面会话 Token。Sidecar 强制只监听回环地址，HTTP/WebSocket 请求直接映射为内部 `desktop` 管理员身份；该产品没有可重新开启的登录模式。
- 发布包内只包含空 Key 的配置模板。用户在 System Config 中填写的 Provider Key 保存到 EXE 旁的 `data/config.json`，不进入 EXE、源码仓库、日志或浏览器持久存储。
- System Config 同时支持逐 Agent 配置和一键应用统一 Provider；模型列表由后端代理访问 OpenAI-compatible `<baseURL>/models`，Renderer 不直接请求第三方 Provider。

## 发布验收

- 在无 Docker、无 PostgreSQL、无 Python、无 Node.js 的干净 Windows 10/11 x64 VM 冷启动。
- 中文用户名、中文和空格路径、普通用户权限可运行。
- 首次启动可创建配置和 SQLite，重启后数据仍存在。
- Sidecar 崩溃、端口占用、数据目录只读和数据库迁移失败有明确错误。
- Windows Defender 扫描、SHA-256、第三方许可和 SBOM 完整。
