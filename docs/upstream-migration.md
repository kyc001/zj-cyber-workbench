# Z3r0 上游扫描与迁移记录

## 基线

| 项目 | 值 |
| --- | --- |
| 上游 | `https://github.com/yv1ing/Z3r0` |
| 基线提交 | `79776a2017d5863658a55b979f7a0972ce95a371` |
| Git 跟踪文件 | 432 |
| 原始参考目录 | `D:\Study\26sp\zhenjun\Z3r0` |
| 许可证 | MIT，保留于 `licenses/Z3r0-LICENSE` |

原始 `Z3r0/` 只用于逐文件对照，根 `.gitignore` 使用锚定规则 `/Z3r0/` 忽略整个目录。迁入仓库根目录的代码才是本项目维护对象。

## 扫描方法

扫描以 `git -C Z3r0 ls-files` 的 432 个文件为全集，不依赖资源管理器可见文件。每个文件按以下问题判断：

1. 是否属于 ZJ 仍需要的 Control、Runtime、Evidence 或桌面 UI 能力？
2. 是否假设 Docker、PostgreSQL、Web 多用户部署或容器网络？
3. 能否在无外部服务的 Windows Portable EXE 中运行？
4. 迁移后是否保留上游许可证和来源说明？
5. 应直接迁移、迁移后改造、仅参考重写，还是明确排除？

复核命令：

```powershell
git -C Z3r0 rev-parse HEAD
git -C Z3r0 ls-files | Measure-Object
git -C Z3r0 ls-files
```

上游一级目录分布：

| 路径 | 文件数 | 处理结论 |
| --- | ---: | --- |
| `web/` | 133 | 完整迁移工作台；Host/Egress/Sandbox 页面改称主机、出口代理、工具基线和执行工作区 |
| `sandbox/` | 48 | Docker/Go 进程实现由便携后端替换；全部 Skill 与用户能力迁入 Windows/SSH 双后端 Workspace Runtime |
| `service/` | 44 | 完整迁移 Agent、Knowledge、WorkProject、Host、Egress、Sandbox 服务并替换 Docker 实现 |
| `core/` | 42 | 完整迁移 Agent Runtime、委派、会话、Sandbox 工具与异步命令 |
| `docs/` | 32 | 仅作上游参考，不覆盖本项目设计文档 |
| `schema/` | 30 | 完整迁移领域和 API Schema；Sandbox 契约保留，底层语义改为执行工作区 |
| `model/` | 23 | 迁移并将 PostgreSQL 类型改为 SQLite 兼容类型 |
| `router/` | 22 | 完整迁移 API；Host/Egress/Sandbox 路由保留，仅删除登录路由 |
| `handler/` | 19 | 与完整路由同步迁移，并增加本机身份、审批和模型拉取处理 |
| `.z3r0/` | 13 | 迁移 Agent SOUL/AGENTS 和配置模板，作为只读发布资源 |
| 其他根文件 | 26 | 按运行、许可和构建需要逐项迁移或重写 |

## 直接保留的设计

- FastAPI 的 Router/Handler/Service 分层。
- Agent Session、主 Agent/子 Agent 委派、暂停恢复和事件流。
- Timeline 的稳定 `item_key`、单调 `seq`、历史回放和实时合并模型。
- WorkProject、Asset、Finding、Graph、Attack Path 和报告骨架。
- Agent Context Projection/Compaction。
- React 工作台和 OpenAPI 生成链。
- LightRAG 知识文档入口，但存储改为本地文件。

## 迁移后改造的部分

- `database.py`：`postgresql+asyncpg` 改为 `sqlite+aiosqlite`，启用 WAL、FK、Busy Timeout。
- JSONB/ARRAY/jsonb_set：改为通用 JSON 和事务内 Python 字典更新。
- PostgreSQL Timeline insert：改为 SQLite dialect upsert。
- PostgreSQL advisory lock：改为单 Sidecar 进程内 `asyncio.Lock`。
- PostgreSQL LightRAG：改为 JsonKV、NanoVectorDB、NetworkX、JsonDocStatus 本地存储。
- Web 部署入口：增加 Electron Main/Preload、Sidecar 生命周期和 Portable 发布配置。
- `.z3r0`：从可写运行目录拆分为只读 Agent 资源；运行数据改到 `.zj`/`ZJ_DATA_DIR`。

## Docker 替换而非功能删除

- Dockerfile、Compose、Docker SDK、Docker Socket 和镜像构建不进入运行时。
- Sandbox 的 API、模型、路由、命令、文件、Shell、异步任务、技能和前端选择器全部保留。
- Sandbox 底层替换为 `.zj/sandboxes/<id>/workspace` 本机目录，或 SSH 主机 `$HOME/.zj/sandboxes/<id>/workspace`；两者都支持命令、异步任务、Shell 和文件 API。
- Host 保留本机 PowerShell，并以严格 Host Key 的 SSH/SFTP 后端承载 Linux 专属工具。
- Egress Proxy 保留为受管网络配置；Agent 网络工具仍以 Scope/Policy/Audit 为最终边界。
- 便携工作区每次启动本机或 SSH 命令/Shell 时解析 Egress 配置并注入代理环境；直连模式会清除宿主机继承代理，避免界面配置与实际执行不一致。
- noVNC API 保留兼容判断，但本机工作区没有远程图形桌面时明确禁用入口。
- PostgreSQL/pgvector 替换为 SQLite WAL、本地向量库和 NetworkX。

## 来源与安全检查

- 上游 MIT License：`licenses/Z3r0-LICENSE`。
- 衍生项目声明：`NOTICE`、`THIRD_PARTY_NOTICES.md`、README Acknowledgments。
- 不迁移上游本地配置、密钥、日志、数据库或生成产物。
- 提交前必须验证 `git check-ignore -v Z3r0/README.md` 命中 `/Z3r0/`，且 `git ls-files` 中不存在 `Z3r0/`。

## 后续同步规则

继续以 `git -C Z3r0 ls-files` 为完整功能审计基线。吸收上游修复时逐文件移植并重新检查：无 Docker、SQLite 兼容、桌面数据目录、Scope/Policy/Audit、当前 Schema 和许可证。上游 Docker/PostgreSQL 实现不得直接进入主干，但对应用户能力不得无说明删除。

自动审计命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/audit-upstream-migration.ps1
```

当前基线的 432 个文件全部被脚本分类，任何新的未迁移文件都会以非零退出码阻断交接。登录页/登录 API、官网 Landing、Docker/Compose/Go 容器代理和上游文档站属于明确替代项；其余 Control、Runtime、Evidence、Workspace API、React 工作台与 Skill 均要求存在对应源文件。

同一脚本还比较上游与当前 `web/openapi.json`：上游 57 条 API 路径中只允许缺少已明确删除的登录接口；所有共享路径的 HTTP 方法必须完整存在。当前仓库有 63 条路径，额外提供审批、模型拉取和健康检查，迁移 API 缺失数为 0。
