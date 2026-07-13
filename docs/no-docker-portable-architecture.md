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

## 被明确排除的能力

- Dockerfile、Docker Compose 和镜像构建。
- Docker SDK、Docker Socket 和远程 Docker Host。
- 容器 Sandbox、容器 Shell、容器文件管理和 noVNC。
- Egress Proxy 和容器出口网络策略。
- 依赖完整 Kali/容器环境的工具。

这些能力不能以“可选依赖”的形式重新加入 v1，因为老师的要求是项目不使用 Docker，而不是仅允许无 Docker 降级启动。

## 替代方案

| 原设计 | 当前替代 |
| --- | --- |
| PostgreSQL | Embedded SQLite WAL |
| PGVector/PG LightRAG | NanoVectorDB + NetworkX + JSON local storage |
| Docker Sandbox | SSH 远端执行或明确打包的便携工具 |
| Docker Toolpack | Manifest 驱动的 EXE/PowerShell/Python-sidecar 内置适配器 |
| 容器隔离 | Scope、Policy、Approval、低权限进程、超时、输出上限和目录白名单 |
| noVNC | 不实现；v1 只提供终端和结构化结果 |
| Egress Proxy | Target 白名单、Action Registry 和执行前二次校验 |

移除容器后，执行安全不能降低。任意写操作仍必须经过 Scope、Policy、Approval、备份、验证和回滚；任意外部工具必须固定版本、校验哈希并限制工作目录和目标。

## EXE 打包边界

- `zj-core.exe`：使用 PyInstaller 打包 FastAPI Sidecar、Python 依赖、Agent 资源和内置脚本。
- `zhenjun.exe` / Portable 产物：使用 Electron Builder 打包桌面进程、React 静态资源和 `zj-core.exe`。
- 目标产物：`ZJ-<version>-win-x64-portable.exe`。
- Electron 负责选择空闲回环端口、自动建立本地管理员会话、传入 `ZJ_DATA_DIR`、轮询 `/health`、关闭 Sidecar 和处理进程树。
- Sidecar 只绑定 `127.0.0.1`，不作为局域网 Web 服务发布。
- Portable 模式不显示登录页，也不使用固定默认口令；Sidecar 为本地 `desktop` 用户保存随机口令哈希，并且只允许回环客户端在 `ZJ_DESKTOP_MODE=true` 时获取桌面会话 Token。
- 发布包内只包含空 Key 的配置模板。用户在 System Config 中填写的 Provider Key 保存到 EXE 旁的 `data/config.json`，不进入 EXE、源码仓库、日志或浏览器持久存储。
- System Config 同时支持逐 Agent 配置和一键应用统一 Provider；模型列表由后端代理访问 OpenAI-compatible `<baseURL>/models`，Renderer 不直接请求第三方 Provider。

## 发布验收

- 在无 Docker、无 PostgreSQL、无 Python、无 Node.js 的干净 Windows 10/11 x64 VM 冷启动。
- 中文用户名、中文和空格路径、普通用户权限可运行。
- 首次启动可创建配置和 SQLite，重启后数据仍存在。
- Sidecar 崩溃、端口占用、数据目录只读和数据库迁移失败有明确错误。
- Windows Defender 扫描、SHA-256、第三方许可和 SBOM 完整。
