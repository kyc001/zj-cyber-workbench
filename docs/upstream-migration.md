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
| `web/` | 133 | 迁移工作台，删除 Host/Egress/Sandbox 页面并继续由 B 产品化 |
| `sandbox/` | 48 | 全部排除 |
| `service/` | 44 | 迁移 Agent、Knowledge、User、WorkProject；排除容器/Host/Egress 服务 |
| `core/` | 42 | 迁移 Agent Runtime、委派、会话、工具；排除 Sandbox 控制层 |
| `docs/` | 32 | 仅作上游参考，不覆盖本项目设计文档 |
| `schema/` | 30 | 迁移可复用领域和 API Schema，排除容器相关 Schema |
| `model/` | 23 | 迁移并将 PostgreSQL 类型改为 SQLite 兼容类型 |
| `router/` | 22 | 迁移可复用 API，删除容器/Host/Egress 路由 |
| `handler/` | 19 | 与保留路由同步迁移 |
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
- Web 部署入口：增加 Electron Main/Preload 和 Sidecar 生命周期骨架。
- `.z3r0`：从可写运行目录拆分为只读 Agent 资源；运行数据改到 `.zj`/`ZJ_DATA_DIR`。

## 明确排除的部分

- `sandbox/` 全目录。
- Dockerfile、`.dockerignore`、Compose 文件和 Docker Python 依赖。
- `core/sandbox`、`service/sandbox`、Sandbox model/schema/router/handler。
- Docker Host、Egress Proxy、容器 Shell、容器文件、noVNC 和容器网络 UI。
- 依赖 PostgreSQL、pgvector 或外部数据库服务的运行路径。

## 来源与安全检查

- 上游 MIT License：`licenses/Z3r0-LICENSE`。
- 衍生项目声明：`NOTICE`、`THIRD_PARTY_NOTICES.md`、README Acknowledgments。
- 不迁移上游本地配置、密钥、日志、数据库或生成产物。
- 提交前必须验证 `git check-ignore -v Z3r0/README.md` 命中 `/Z3r0/`，且 `git ls-files` 中不存在 `Z3r0/`。

## 后续同步规则

不做整仓覆盖式上游同步。需要吸收上游修复时，以本基线提交为起点逐文件 Cherry-pick/人工移植，并重新检查：无 Docker、SQLite 兼容、桌面数据目录、当前 Schema 和许可证。任何上游 Docker/PostgreSQL 假设都不能直接进入主干。
