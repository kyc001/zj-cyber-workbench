# 结论先行

**可行，而且 Python 部分基本可以全部改成 TypeScript。**

但我不建议把目标理解成“把 Z3r0 原样翻译成 TypeScript，再套一个 Electron”。更合理的是：

> **保留 Z3r0 的四平面思想、证据模型和多 Agent 工作流，重新实现一个 Windows-first、离线优先、权限受控的运维安全工作台。**
> 

推荐最终形态：

```
Electron + React/TypeScript
        │
        ├── TypeScript Core Service
        │   ├── 多 Agent 编排
        │   ├── SSH / SFTP / 远程终端
        │   ├── 审批与策略引擎
        │   ├── 任务调度与审计
        │   └── 本地 SQLite
        │
        ├── 本机 Windows 执行器
        │   └── PowerShell / WinRM / 系统诊断
        │
        └── Linux 安全沙箱
            ├── 远程 Linux + Docker（首选）
            ├── Docker Desktop / WSL2（可选）
            └── 预装的审计、压测、诊断工具
```

**关键判断：**

1. **Electron 可以打包为 Windows `.exe`。**
2. **Agent、API、数据库、SSH、任务编排都能改成 TypeScript。**
3. **很多渗透、漏洞验证、逆向工具本身仍是 Python/C/Go/Java 程序，没有必要重写。**
4. **“单个便携 EXE”不等于“把 Docker、Kali、Ghidra、Nmap 全塞进 EXE”。**
5. 最可靠的产品模式是：  
    
    **轻量 Windows 控制端 + 本机执行器 + 可选远程 Linux 沙箱。**
    

以下方案均应限定在**明确授权的资产、压测目标和修复范围**内，并默认禁止越权扫描、破坏性利用和无审批的生产变更。

---

# 一、Z3r0 项目到底是什么

Z3r0 并不是一个简单的“LLM 调 Nmap”的聊天工具，而是一个偏控制平面的红队协作工作台。

它当前公开架构包含：

- React 操作界面
- FastAPI 控制平面
- 会话式多 Agent Runtime
- PostgreSQL 持久化
- 项目级资产、发现、证据、攻击路径
- Docker 沙箱资源池
- Shell、文件、noVNC
- 统一出口代理和网络策略
- 可回放 Timeline

项目将系统拆成四个平面：

| 平面 | 职责 |
| --- | --- |
| Control Plane | 用户、Agent、会话、主机、沙箱、配置 |
| Runtime Plane | 多 Agent 执行、委派、暂停恢复、事件流 |
| Evidence Plane | 资产、发现、证据、关系图、任务、报告 |
| Execution Plane | Docker、Shell、文件、工具调用、出口网络 |

这是 Z3r0 最值得复用的部分。其 Agent 对话并不是唯一真相，资产、发现、证据和操作时间线都作为结构化数据持久化。Z3r0 项目与架构说明

## 对你们项目最有价值的设计

### 1. Control Plane 与 Execution Plane 分离

Agent 不应直接获得 Windows 主机管理员权限或 SSH 私钥。

正确流程应该是：

```
Agent 生成操作计划
    ↓
策略引擎检查
    ↓
必要时等待人工审批
    ↓
执行器运行
    ↓
结果写入证据库
    ↓
Agent 分析结果
```

### 2. 证据独立于聊天上下文

例如一次服务器故障诊断，不应只保存在对话里，而应形成：

```
Incident
├── Target
├── Symptoms
├── Observations
├── Commands
├── Artifacts
├── Findings
├── Remediation Plan
├── Changes
├── Verification
└── Rollback Result
```

这样才能：

- 审计 Agent 做过什么；
- 回放故障处理过程；
- 生成运维报告；
- 确认漏洞是否真的修复；
- 在模型上下文丢失后继续任务。

### 3. 长任务不阻塞对话

压测、日志分析、镜像扫描、代码扫描可能运行几十分钟。Z3r0 将这些操作抽象成持久任务，Agent 可以暂停，等结果返回后继续，这一点应保留。

---

# 二、Z3r0 与你们目标的差异

你们想做的不完全是红队平台，而是：

> **Windows 便携式 AI 运维 + 安全诊断 + 授权测试工具包。**
> 

因此需要对 Z3r0 做以下调整。

| Z3r0 原定位 | 你们需要的定位 |
| --- | --- |
| Web 红队协作平台 | Windows 桌面运维安全工作台 |
| Docker / Linux 中心 | Windows 控制端 + Linux 执行端 |
| 渗透与漏洞研究 | 诊断、压测、验证、修复、回滚 |
| PostgreSQL 服务化 | 单机 SQLite，团队版再上 PostgreSQL |
| 管理员预配置沙箱 | 自动发现本机/远程执行能力 |
| 多用户 Web 应用 | 单用户优先，后续团队协作 |
| 攻击路径为核心 | 事件、变更、修复闭环为核心 |

建议不要直接 Fork 后大改，而是：

1. Fork Z3r0 用于学习和 PoC；
2. 提取领域模型、事件协议和 Agent 提示词；
3. 新建 Windows-first TypeScript Monorepo；
4. 保留对 Z3r0 数据模型的兼容转换层。

原因是 Python FastAPI 服务、Docker Compose、PostgreSQL和 Web 部署假设，会与“便携 Windows EXE”长期冲突。

---

# 三、Python 能否全部改成 TypeScript

## 可以改的部分

| Python 组件 | TypeScript 替代方案 | 可行性 |
| --- | --- | --- |
| --- | --- | ---: |
| FastAPI | Fastify / Hono / Electron IPC | 高 |
| Pydantic Schema | Zod / TypeBox | 高 |
| SQLModel | Drizzle ORM / Prisma | 高 |
| PostgreSQL Client | `pg` / Drizzle | 高 |
| Agent Runtime | LangGraph.js / 自研状态机 | 高 |
| WebSocket | `ws` / Socket.IO | 高 |
| Docker 管理 | Dockerode | 高 |
| SSH | `ssh2` | 高 |
| HTTP Client | `fetch` / Undici | 高 |
| 后台任务 | BullMQ / SQLite Job Queue | 高 |
| 日志 | Pino | 高 |
| 配置管理 | Zod + TOML/YAML | 高 |
| 文件管理 | Node.js FS API | 高 |
| JWT、加密 | `jose`  • Node Crypto | 高 |

LangGraph.js 已支持 TypeScript 的长时间、有状态 Agent 工作流、持久化和人工介入，适合实现 Lead Agent 与 Specialist Agents。LangGraph.js 文档

Node 的 `ssh2` 支持 SSH Client、交互 Shell、命令执行、SFTP 和端口转发。ssh2

Docker 管理可以通过 Dockerode 调用 Docker Remote API。Dockerode

## 不应强行改成 TypeScript 的部分

以下“Python 部分”更准确地说是**安全工具生态**，不值得重写：

- SQLMap
- Impacket
- Pwntools
- Python PoC
- Frida 脚本
- 某些固件分析工具
- 数据科学、日志分析脚本
- 专门的漏洞验证脚本

建议把它们作为外部 Tool：

```tsx
interface ToolAdapter {
  manifest: ToolManifest;
  checkRuntime(): Promise<RuntimeStatus>;
  prepare(input: unknown): Promise<ExecutionPlan>;
  execute(ctx: ExecutionContext): Promise<ToolResult>;
  cancel(taskId: string): Promise<void>;
}
```

Agent Runtime 是 TypeScript，不影响它调用 Python、Go、Java 或本机 EXE。

## 推荐结论

### 不推荐

```
把所有 Python 工具逐个改写成 TypeScript
```

成本极高，还会丢失原工具维护和更新能力。

### 推荐

```
TypeScript 负责控制、编排、审批、SSH、数据、界面
Python/Go/C 工具运行在受控沙箱内
```

这样用户看到的仍然是一个 Electron EXE，内部工具语言对用户透明。

---

# 四、完整目标架构

## 4.1 总体架构

```
┌──────────────────────────────────────────────────────┐
│ Windows Electron Desktop                             │
│                                                      │
│  React UI                                            │
│  ├── 项目 / 事件中心                                 │
│  ├── Agent 对话                                      │
│  ├── 审批中心                                        │
│  ├── SSH / PowerShell 终端                           │
│  ├── 文件管理                                        │
│  ├── 资产 / 漏洞 / 修复记录                          │
│  └── Timeline 回放                                   │
│                                                      │
│  Electron Main                                       │
│  ├── IPC Gateway                                     │
│  ├── Core Service                                    │
│  ├── Agent Runtime                                   │
│  ├── Policy Engine                                   │
│  ├── SSH Manager                                     │
│  ├── Local Executor                                  │
│  ├── Job Scheduler                                   │
│  └── SQLite / Secret Store                           │
└──────────────────────┬───────────────────────────────┘
                       │
           ┌───────────┴────────────┐
           │                        │
┌──────────▼───────────┐  ┌────────▼─────────────────┐
│ 本机 Windows 执行器  │  │ 远程 Linux Sandbox      │
│ PowerShell / WinRM   │  │ Docker / Podman         │
│ Event Log / WMI      │  │ Security tool images    │
│ Services / Registry  │  │ Restricted egress       │
└──────────────────────┘  └──────────────────────────┘
```

## 4.2 Monorepo 结构

```
ops-agent-workbench/
├── apps/
│   ├── desktop/                 # Electron main/preload
│   ├── renderer/                # React UI
│   ├── runner/                  # 可选远程执行代理
│   └── cli/                     # 无界面管理命令
├── packages/
│   ├── domain/                  # 领域模型
│   ├── contracts/               # Zod Schema、事件协议
│   ├── agent-runtime/           # 多 Agent 图
│   ├── policy-engine/           # 审批、Scope、风险分级
│   ├── execution-core/          # Tool Adapter
│   ├── ssh-transport/
│   ├── windows-executor/
│   ├── docker-executor/
│   ├── evidence-store/
│   ├── secret-store/
│   ├── report-engine/
│   └── provider-adapters/       # OpenAI/Anthropic/本地模型
├── toolpacks/
│   ├── operations/
│   ├── diagnostics/
│   ├── load-testing/
│   ├── vulnerability-validation/
│   └── remediation/
└── infra/
    ├── sandbox-images/
    ├── compose/
    └── signing/
```

推荐使用：

- `pnpm workspace`
- Turborepo
- TypeScript strict mode
- Vitest
- Playwright
- ESLint
- Changesets

---

# 五、桌面端设计

## 5.1 Electron 进程边界

### Renderer

只负责：

- UI；
- 展示 Agent 消息；
- 展示 Terminal；
- 提交审批；
- 展示报告和 Timeline。

**不能直接访问：**

- SSH 私钥；
- Node.js FS；
- `child_process`；
- Docker Socket；
- 数据库；
- LLM API Key。

### Preload

只暴露白名单接口：

```tsx
interface DesktopAPI {
  project: {
    list(): Promise<ProjectSummary[]>;
    open(id: string): Promise<Project>;
  };
  agent: {
    send(sessionId: string, message: string): Promise<void>;
    subscribe(sessionId: string, listener: EventListener): Unsubscribe;
  };
  approval: {
    approve(id: string, token: string): Promise<void>;
    reject(id: string, reason: string): Promise<void>;
  };
  terminal: {
    create(targetId: string): Promise<string>;
    write(terminalId: string, data: string): Promise<void>;
    resize(terminalId: string, cols: number, rows: number): Promise<void>;
  };
}
```

### Main / Utility Process

高权限逻辑放在 Main 或独立 Utility Process 中：

- SSH；
- PTY；
- Docker；
- 数据库；
- 密钥；
- Agent Runtime；
- 执行审批。

Electron 官方要求启用 `contextIsolation`，并建议 Renderer 启用进程沙箱、禁用 Node Integration。Electron 安全指南

配置至少为：

```tsx
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    preload: preloadPath,
  },
});
```

## 5.2 Terminal

建议：

- 前端：`@xterm/xterm`
- 本机终端：`node-pty`
- 远程终端：`ssh2.shell()`
- 二进制输出：按 Buffer 传输
- 自动脱敏：Token、Password、Private Key
- 输出分块持久化，不能整段塞入 Agent Context

Xterm.js 是纯前端终端组件，VS Code 等项目也在使用。Xterm.js

---

# 六、多 Agent 设计

## 6.1 Agent 不应按工具划分

不要设计成：

- Nmap Agent
- SQLMap Agent
- SSH Agent

这会导致 Agent 只会调用单个工具，无法形成完整闭环。

建议按责任划分。

| Agent | 职责 |
| --- | --- |
| Coordinator | 理解问题、拆解任务、控制范围 |
| Diagnostic Agent | 日志、CPU、内存、磁盘、网络、进程分析 |
| Security Analyst | 漏洞风险、配置缺陷、依赖风险 |
| Load Test Planner | 设计授权压测计划、停止条件 |
| Remediation Agent | 生成修复和回滚方案 |
| Verification Agent | 修复后验证、回归检查 |
| Evidence Agent | 整理证据、时间线和报告 |
| Code Audit Agent | 代码、依赖和配置审计 |

## 6.2 推荐工作流

```
用户描述问题
    ↓
Coordinator 建立 Incident
    ↓
Scope 校验
    ↓
并行委派
 ┌─────────────┬─────────────┬─────────────┐
 │ Diagnostic  │ Security    │ Evidence    │
 └─────────────┴─────────────┴─────────────┘
    ↓
合并事实，生成候选根因
    ↓
提出诊断命令
    ↓
Policy Engine 风险检查
    ↓
低风险自动执行 / 中高风险人工审批
    ↓
Remediation Agent 生成：
- 变更计划
- 影响范围
- 备份方案
- 回滚方案
- 验证方案
    ↓
人工确认
    ↓
执行修复
    ↓
Verification Agent 回归验证
    ↓
生成报告
```

## 6.3 Agent 状态

不要只存 Chat Messages，建议定义显式状态：

```tsx
interface IncidentState {
  incidentId: string;
  objective: string;
  authorizationScope: AuthorizationScope;
  targets: TargetRef[];
  hypotheses: Hypothesis[];
  observations: Observation[];
  proposedActions: ProposedAction[];
  approvals: ApprovalRecord[];
  executions: ExecutionRecord[];
  findings: Finding[];
  remediationPlan?: RemediationPlan;
  verification?: VerificationResult;
  status:
    | "planning"
    | "diagnosing"
    | "awaiting_approval"
    | "executing"
    | "verifying"
    | "completed"
    | "failed";
}
```

## 6.4 Prompt Injection 防护

Agent 可能读取：

- 恶意日志；
- 网页内容；
- 服务器文件；
- 仓库 README；
- 工单文本。

因此所有远程内容必须标记为：

```
UNTRUSTED OBSERVATION
```

任何文件中出现的“忽略规则”“执行此命令”“上传密钥”等内容，都不能改变系统策略。

---

# 七、SSH 远程交互与修复设计

## 7.1 连接层

```tsx
interface RemoteTransport {
  connect(): Promise<void>;
  exec(command: CommandSpec): Promise<ExecResult>;
  openShell(options: ShellOptions): Promise<InteractiveSession>;
  upload(local: string, remote: string): Promise<void>;
  download(remote: string, local: string): Promise<void>;
  forward(spec: ForwardSpec): Promise<ForwardHandle>;
  disconnect(): Promise<void>;
}
```

实现：

- `SSHTransport`
- `WinRMTransport`
- `LocalPowerShellTransport`
- 后续可扩展 `KubernetesTransport`

## 7.2 SSH 安全要求

必须实现：

1. **默认启用 Host Key 校验**
2. 第一次连接展示指纹，用户确认后写入 Known Hosts
3. 主机指纹变化时阻止连接
4. 优先使用 SSH Key
5. 支持 Passphrase，但不明文落盘
6. 禁止把私钥传给模型
7. Jump Host 独立配置
8. Agent 只能引用 `credentialId`
9. 每次连接绑定 Incident 和 Project
10. 连接空闲超时
11. 支持只读会话
12. 默认禁止 Agent 自行建立任意端口转发

Windows 本地密钥建议使用 Electron `safeStorage`，它通过操作系统提供的加密机制保护本地字符串。Electron safeStorage

更严格的实现：

- 私钥仍保存在用户现有 `.ssh` 或 Windows Credential Manager；
- 应用只保存引用；
- 优先调用 `ssh-agent`；
- 解密后的私钥只存在于短生命周期进程内存。

## 7.3 命令分类

### L0：纯读取

例如：

- 系统版本；
- 服务状态；
- 磁盘空间；
- 日志读取；
- 进程列表。

可配置为自动执行。

### L1：受限诊断

- 短时抓包；
- 有范围的端口检查；
- 配置语法校验；
- 指定目标的健康检查。

需要 Scope 校验，可配置自动执行。

### L2：可逆变更

- 重启服务；
- 修改配置；
- 调整防火墙规则；
- 部署修复文件。

必须人工审批，并要求回滚方案。

### L3：高危操作

- 删除数据；
- 改磁盘分区；
- 批量修改防火墙；
- 生产环境压力测试；
- 运行漏洞利用；
- 凭据测试；
- 提权或横向行为。

必须二次确认、明确授权信息、限定目标和时间窗。部分行为应默认禁用。

---

# 八、执行器与沙箱

## 8.1 为什么不能只靠 Electron

Electron 的 Main Process 虽然能运行命令，但不能把它当安全沙箱：

- Agent 输出可能不可靠；
- Renderer 可能受恶意内容影响；
- 安全工具可能包含漏洞；
- 某些工具需要高权限；
- Docker Socket 相当于宿主机高权限接口；
- 测试目标可能返回恶意文件。

因此需要独立 Execution Boundary。

## 8.2 三种执行模式

### 模式 A：本机 Windows

用于：

- 系统诊断；
- PowerShell；
- 服务、计划任务、注册表；
- Event Log；
- Windows Defender 状态；
- 本地文件检查。

风险：权限直接作用于本机。

控制措施：

- 默认普通用户权限；
- 仅单个任务通过 UAC 提权；
- 不让整个 Electron 长期以管理员运行；
- 高权限任务放到短生命周期 Helper；
- Helper 验证签名和任务 Token。

### 模式 B：Windows + WSL2 / Docker Desktop

适合技术用户，兼容大量 Linux 安全工具。

Docker Desktop 在 Windows 上可以使用 WSL2 后端，但要求安装并启用 WSL2，最低版本和系统条件需要满足官方要求。Docker Desktop WSL2

优点：

- 本机完整使用；
- 兼容 Z3r0 沙箱思想；
- 工具镜像容易升级。

缺点：

- 不再是真正“开箱即用的单 EXE”；
- Docker Desktop 体积大；
- 企业许可和安装权限需要评估；
- WSL 网络与文件挂载有额外复杂度。

### 模式 C：远程 Linux Runner——最推荐

Windows 端只负责控制，工具运行在远程 Linux：

```
Electron → SSH/mTLS → Runner → Docker Sandbox
```

优点：

- Windows 端非常轻；
- Linux 工具兼容性最佳；
- 隔离更清晰；
- 多人可以共享沙箱资源；
- 不要求每台 Windows 安装 Docker。

建议 MVP 就优先实现此模式。

## 8.3 Runner 设计

Runner 可使用 TypeScript 实现：

```
ops-runner
├── mTLS / SSH 身份认证
├── Task API
├── Docker Adapter
├── Output Streaming
├── Artifact Store
├── Resource Limits
├── Egress Policy
└── Heartbeat
```

禁止直接暴露未加密的 Docker TCP API。Runner 负责与 Docker Socket 交互，并执行二次策略校验。

## 8.4 沙箱要求

每个任务或者每个 Incident 独立容器：

- 非 root；
- Read-only Root FS；
- Drop Linux Capabilities；
- 禁止 `--privileged`；
- 禁止挂载宿主 Docker Socket；
- CPU、内存、PID 限制；
- 独立工作目录；
- 超时自动回收；
- 网络默认拒绝；
- 仅放行授权目标；
- 禁止访问云 Metadata 地址；
- 输出和文件限制大小；
- 镜像签名、SBOM 和漏洞扫描。

---

# 九、压测模块应该怎样设计

不要让 Agent 根据一句“帮我压测一下”直接发流量。

压测必须有结构化计划：

```tsx
interface LoadTestPlan {
  authorizationId: string;
  target: string;
  environment: "dev" | "staging" | "production";
  timeWindow: DateRange;
  maxConcurrency: number;
  maxRps: number;
  rampUpSeconds: number;
  durationSeconds: number;
  successCriteria: MetricRule[];
  abortConditions: MetricRule[];
  observers: string[];
  approvalId?: string;
}
```

建议支持：

- k6
- JMeter
- wrk / wrk2
- Vegeta
- Locust 作为兼容插件

Agent 的职责是：

1. 读取业务目标；
2. 生成测试计划；
3. 检查停止条件；
4. 让用户审批；
5. 启动工具；
6. 监控指标；
7. 触发熔断；
8. 分析结果。

必须实现独立于 LLM 的硬限制：

- 最大并发；
- 最大 RPS；
- 最大时长；
- 允许目标；
- 允许时间窗；
- 立即停止按钮；
- Agent 失联自动停止；
- 生产环境强制二次审批。

---

# 十、漏洞修复闭环

“发现漏洞”和“修复漏洞”必须是不同阶段。

```
Finding
  ↓
Remediation Proposal
  ↓
Impact Analysis
  ↓
Backup / Snapshot
  ↓
Approval
  ↓
Apply Change
  ↓
Service Health Check
  ↓
Security Verification
  ↓
Regression Check
  ↓
Close or Rollback
```

每个变更操作应包含：

```tsx
interface ChangeSet {
  targetId: string;
  reason: string;
  preconditions: Check[];
  backupSteps: Action[];
  actions: Action[];
  verificationSteps: Action[];
  rollbackSteps: Action[];
  riskLevel: RiskLevel;
  approvalRequired: boolean;
}
```

不允许 Agent 只生成一条 Shell 字符串。应尽量转成结构化 Action：

```tsx
{
  type: "service.restart",
  target: "nginx",
  timeoutSeconds: 30,
  requireApproval: true
}
```

执行器再把 Action 映射成目标系统命令。这比让 LLM自由拼接命令安全得多。

---

# 十一、数据模型

单机版建议 SQLite + Drizzle ORM。

主要表：

```
projects
authorization_scopes
targets
credentials
sessions
agent_runs
tasks
task_dependencies
incidents
observations
assets
findings
evidence
artifacts
change_sets
approvals
executions
timeline_events
reports
tool_manifests
sandbox_instances
model_profiles
```

## Timeline Event

```tsx
interface TimelineEvent {
  id: string;
  projectId: string;
  sessionId?: string;
  incidentId?: string;
  timestamp: string;
  actor:
    | { type: "user"; id: string }
    | { type: "agent"; id: string }
    | { type: "executor"; id: string }
    | { type: "system" };
  kind:
    | "message"
    | "plan_created"
    | "tool_requested"
    | "approval_requested"
    | "approval_resolved"
    | "execution_started"
    | "execution_output"
    | "execution_completed"
    | "finding_created"
    | "change_applied"
    | "verification_completed";
  payload: unknown;
  previousHash?: string;
  eventHash: string;
}
```

可通过哈希链提高审计记录被篡改后的可检测性。

## 大输出处理

不能把完整日志都存进主数据库：

- 数据库保存摘要和索引；
- 原始日志压缩后存 Artifact；
- Agent 通过分块、关键词或时间范围读取；
- 对敏感信息先脱敏；
- 文件使用 SHA-256；
- 可配置保留周期。

---

# 十二、Tool Plugin 体系

每个工具都应有 Manifest：

```yaml
id: diagnostics.linux.system-overview
name: Linux System Overview
version: 1.0.0
runtime: sandbox
risk: read-only
supportedPlatforms:
  - linux
requiredCapabilities:
  - process.read
  - filesystem.read-limited
network:
  mode: none
inputs:
  targetId:
    type: string
outputs:
  schema: system-overview.v1
timeoutSeconds: 60
```

Plugin 包含：

```
toolpack/
├── manifest.yaml
├── schema.json
├── adapter.ts
├── parser.ts
├── policy.ts
└── tests/
```

重点是让 Agent 使用“语义工具”：

```
collect_system_overview
check_service_health
analyze_recent_errors
prepare_config_patch
verify_patch
```

而不是一开始就获得无限制的：

```
execute_any_shell_command
```

通用 Shell 可以保留，但风险等级必须更高。

---

# 十三、Windows EXE 打包方案

## 13.1 发行格式

建议同时输出：

1. **NSIS 安装版**
    - 自动更新；
    - 文件关联；
    - 服务组件；
    - 企业部署更可靠。
2. **Portable EXE**
    - 适合临时诊断；
    - 配置和数据库保存在 EXE 同目录的 `data/`；
    - 不自动注册系统服务；
    - 功能可能受系统权限限制。

electron-builder 支持 Windows NSIS 和 Portable Target。electron-builder Portable

配置示意：

```json
{
  "build": {
    "appId": "com.example.opsworkbench",
    "productName": "Ops Workbench",
    "win": {
      "target": [
        { "target": "nsis", "arch": ["x64"] },
        { "target": "portable", "arch": ["x64"] }
      ]
    },
    "asar": true
  }
}
```

## 13.2 需要注意

“便携版”仍会在运行时解压 Electron 资源，体积通常不会很小。

建议目标：

- 控制端：150–300 MB；
- 不内置大型安全工具；
- Toolpack、Runner 镜像按需下载；
- 不把模型权重放进主 EXE；
- 支持离线资源包导入。

## 13.3 签名与更新

生产发布必须考虑：

- Windows Code Signing；
- 时间戳签名；
- CI 中隔离签名证书；
- 更新包签名验证；
- 版本回滚；
- 企业内网更新源；
- 禁止自动安装未签名 Toolpack。

---

# 十四、推荐技术栈

## Desktop

- Electron
- React
- TypeScript
- Vite
- Zustand 或 Redux Toolkit
- TanStack Query
- xterm.js
- Monaco Editor
- Tailwind CSS

## Core

- Node.js LTS
- Fastify：Runner 或本地 HTTP API
- Electron IPC：桌面内部通信
- Zod：运行时校验
- Drizzle ORM
- SQLite
- Pino
- `ssh2`
- `node-pty`
- Dockerode

## Agent

建议二选一。

### 方案 A：LangGraph.js

适合：

- 快速做 MVP；
- 状态图；
- checkpoint；
- Human-in-the-loop；
- 多 Agent 委派。

### 方案 B：自研轻量 Runtime

适合：

- 需要非常强的可控性；
- 不希望深度绑定框架；
- Agent 逻辑相对固定。

建议先用 LangGraph.js，同时把 Agent 接口封装在你们自己的 Domain 层内，避免框架渗透全部代码。

## 模型适配层

```tsx
interface ModelProvider {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
  generateStructured<T>(
    request: StructuredRequest<T>
  ): Promise<T>;
  countTokens(input: ModelInput): Promise<number>;
}
```

支持：

- OpenAI-compatible API
- Anthropic
- Azure OpenAI
- Ollama
- 企业内网模型

---

# 十五、MVP 功能边界

## 第一版应该做

1. Windows Electron 桌面端；
2. 项目和 Incident；
3. 模型 Provider 配置；
4. Coordinator + Diagnostic + Remediation Agent；
5. SSH 主机管理；
6. 交互式 SSH Terminal；
7. SFTP 文件浏览；
8. 只读诊断 Toolpack；
9. Agent 提议命令；
10. 人工审批；
11. 命令输出持久化；
12. Timeline；
13. 修复计划和回滚计划；
14. Markdown/PDF 报告；
15. SQLite 本地存储；
16. Portable EXE。

## 第一版不要做

- 自动漏洞利用；
- 自动提权；
- 自动横向移动；
- 无人审批的生产修复；
- 集群化多租户；
- 自建模型训练；
- 大而全的插件市场；
- 把所有安全工具塞入 Windows；
- 复杂攻击图可视化；
- 自研容器运行时。

这样才能尽快验证“Agent 是否真的能提高运维诊断效率”。

---

# 十六、分阶段实施计划

## Phase 0：Z3r0 架构拆解，1 周

产出：

- Z3r0 模块映射；
- API 和事件模型清单；
- 可复用 Prompt；
- 数据模型 ER 图；
- 保留/替换/删除列表；
- 授权与安全边界说明。

## Phase 1：桌面骨架，2 周

完成：

- Electron Main / Preload / Renderer；
- SQLite；
- 项目管理；
- Agent Chat；
- Timeline；
- Provider 配置；
- Portable 构建。

验收：

- Windows 10/11 可运行；
- Renderer 无 Node 权限；
- 应用重启后会话可恢复。

## Phase 2：SSH 与诊断，2–3 周

完成：

- SSH Host Key；
- Key/Agent 认证；
- xterm.js；
- SFTP；
- 只读命令；
- 输出持久化；
- 命令审批。

验收：

- 能诊断一台 Linux 服务器；
- 所有 Agent 命令都有审计记录；
- 私钥不会进入模型消息。

## Phase 3：多 Agent 与修复闭环，3 周

完成：

- Coordinator；
- Diagnostic；
- Security；
- Remediation；
- Verification；
- ChangeSet；
- Backup/Apply/Verify/Rollback。

验收：

- 能处理“服务不可用”故障；
- 能生成并执行经审批的修复；
- 验证失败可回滚。

## Phase 4：Runner 和 Docker 沙箱，3 周

完成：

- Linux Runner；
- mTLS/SSH 认证；
- Docker Sandbox；
- Toolpack；
- 资源限制；
- Egress Allowlist；
- 任务取消。

验收：

- 安全工具不在 Electron 主机直接运行；
- 沙箱无法访问非授权目标；
- 任务超时可自动停止。

## Phase 5：压测和漏洞管理，2–3 周

完成：

- 压测计划；
- RPS/并发硬限制；
- Kill Switch；
- Finding；
- 修复验证；
- 报告模板。

整体 MVP 大约 **10–14 周**，适合 3–5 人小组。

---

# 十七、团队分工

| 角色 | 主要负责 |
| --- | --- |
| Desktop Engineer | Electron、React、Terminal、打包 |
| Core Engineer | 数据模型、任务系统、事件流、SSH |
| Agent Engineer | LangGraph、Prompt、Provider、上下文管理 |
| Security Engineer | 沙箱、策略、Toolpack、威胁建模 |
| QA/DevOps | Windows 测试、签名、Runner、CI/CD |

如果只有 3 人：

1. Electron + UI；
2. Core + Agent Runtime；
3. SSH + Sandbox + Security。

---

# 十八、主要风险

## 1. Electron 本身成为 RCE 入口

处理：

- 禁止 Renderer Node Integration；
- Context Isolation；
- Renderer Sandbox；
- CSP；
- 不加载远程页面；
- URL 白名单；
- IPC 输入全部用 Zod 校验；
- 外部链接交给系统浏览器；
- Main Process 不拼接 Shell 字符串。

## 2. Agent 误操作生产环境

处理：

- Scope；
- Risk Level；
- Human Approval；
- Dry Run；
- Backup；
- Rollback；
- 最大任务时长；
- Kill Switch；
- 生产环境特殊标记。

## 3. Prompt Injection

处理：

- 远程数据不可信；
- Policy Engine 不由 LLM控制；
- 工具权限独立于 Prompt；
- 模型不能读取密钥；
- 命令参数结构化；
- 高风险操作二次确认。

## 4. Docker 等于宿主机高权限

处理：

- 不把 Docker Socket 暴露给容器；
- Runner 作为唯一 Docker Broker；
- Runner 也做策略检查；
- 不允许 privileged；
- Toolpack 镜像签名；
- 生产环境考虑独立 VM 或更强隔离。

## 5. “便携”目标膨胀

必须尽早明确：

```
Portable 控制端 ≠ Portable 完整 Linux 安全环境
```

推荐定义两个产品档位：

### Lite

- 单 EXE；
- SSH；
- 本机 PowerShell；
- Agent 诊断；
- 不需要 Docker。

### Full

- Windows EXE；
- 远程 Runner 或 Docker Desktop；
- 沙箱；
- 安全工具包；
- 压测和漏洞验证。

---

# 十九、最终推荐方案

## 产品架构

```
Electron 桌面控制台
+ 全 TypeScript 核心
+ SQLite 本地证据库
+ LangGraph.js 多 Agent
+ SSH2 / SFTP / xterm.js
+ 结构化审批与变更系统
+ 远程 Linux Docker Runner
+ 可插拔多语言 Toolpack
```

## Python 策略

```
业务后端 Python：逐步替换为 TypeScript
第三方 Python 安全工具：保留为沙箱插件
```

## 与 Z3r0 的关系

建议复用：

- 四平面架构；
- 多 Agent 专家团队；
- Timeline；
- Evidence Model；
- 长任务恢复；
- Docker Sandbox；
- Egress Policy。

建议重写：

- FastAPI 控制面；
- SQLModel；
- Python Agent Runtime；
- Web-only 部署；
- PostgreSQL-only 存储；
- 以红队为中心的 UI。

建议新增：

- Windows 执行器；
- SSH/WinRM Transport；
- ChangeSet 与 Rollback；
- 压测熔断；
- Portable Mode；
- Electron 安全边界；
- 操作审批中心；
- 离线模型与企业 Provider；
- Toolpack 签名。

**一句话总结：**

> 你们完全可以将 Z3r0 的平台主体重构为 TypeScript，但不要重写安全工具生态。最优路线是做一个“Windows 便携控制台 + TypeScript 多 Agent 控制面 + 远程 Linux 沙箱”的产品，而不是试图制造一个装下全部渗透环境的超级 EXE。
> 

不是“Agent Loop 完全不改”。更准确地说：

- **保留** Z3r0 的多 Agent 调度、任务恢复、证据与 Timeline 主骨架。
- **改造** Scope 校验、风险分级、审批门、SSH/PowerShell 执行、修复回滚和独立验证节点。
- **新增**运维诊断、压测、安全检查和修复工具。
- 在 **4 人 × 10 天**的约束下，**不进行 Python → TypeScript 全量重写**；保留现有 Python 控制面，以 Electron + React/TypeScript 封装 Windows 产品。

我已经创建了完整方案页面，其中包含源码目录级改动、最终功能边界、Agent Runtime 改造、API/数据模型、Electron Sidecar 方案、SSH 与审批机制、四人分工、逐日执行计划、验收场景和 Definition of Done。

已将页面扩充至万字以上，并补充了可直接执行的工程细节，包括：

- Windows 开发环境、版本基线、安装步骤与验证命令
- 改造后的完整目录及文件职责
- Electron + Python Sidecar 打包与通信协议
- SQLite/PostgreSQL 双模式及迁移策略
- SSH、SFTP、Terminal WebSocket 具体协议
- Windows UAC Helper 与本地执行机制
- Policy Engine、审批 Token 和风险规则
- Agent Context、Tool Schema 与事件规范
- Toolpack 目录、Manifest 和执行约束
- 日志、审计、凭据与敏感信息处理
- 单元测试、集成测试、Electron E2E 与 Agent 评测
- Windows CI/CD、PyInstaller、NSIS、Portable 打包流程
- 320 人时预算分配
- 发布前工程、安全、数据与功能检查表

## 首选名称：**Z3rOps**

> **Z3r0 + Operations = Z3rOps**
> 

推荐理由：

- 保留 Z3r0 血统，能体现基于原项目二次开发；
- `Ops` 明确表达运维、诊断、修复和自动化；
- 简短、技术感强，适合 EXE、GitHub 仓库和命令行；
- 不会把产品限制在“渗透测试”，能同时覆盖安全运维、压测和故障处理。

建议完整品牌写法：

- **产品名：** Z3rOps
- **英文副标题：** AI-Native Security Operations Workbench
- **中文副标题：** AI 原生安全运维工作台
- **仓库名：** `z3rops`
- **程序名：** `Z3rOps.exe`
- **命令行：** `z3rops`
- **Runner：** `z3rops-runner`
- **配置目录：** `%APPDATA%\Z3rOps`
- **安装包：** `Z3rOps-1.0.0-win-x64-setup.exe`

Logo 可以继续沿用 Z3r0 的“零/终端”视觉语言，但加入扳手、盾牌或脉冲线元素。

### 其他候选

| --- | --- | --- |

**最终建议：项目就叫 `Z3rOps`。**

需要注意：如果将来公开发布或商业化，应确认 Z3r0 原作者对名称、Logo 和品牌衍生使用的态度；MIT 许可允许代码层面的二次开发，但名称和 Logo 不一定自动包含在软件许可授权范围内。

可以完全使用一个与 Z3r0 无关的新名字。根据这份 **MIT License**，你们可以修改、再发布、商业化和更名，但需要：

1. 在源码仓库或发行包中保留原版权声明和 MIT 许可文本；
1. 清楚标注项目包含基于 Z3r0 修改的代码；
1. 不必沿用 Z3r0 的名称或 Logo；
1. 不要暗示原作者为你们的产品背书。

建议在 `THIRD_PARTY_NOTICES.md` 中写：

```
This product includes software derived from Z3r0:
https://github.com/yv1ing/Z3r0

Z3r0 is licensed under the MIT License.

Copyright (c) 2026 yv1ing
```

并附上完整 MIT License。

## 首选名称：**OpsHive**

> **Operations + Hive（蜂群）**
> 

它很符合产品特征：

- `Ops`：运维、诊断、修复和自动化；
- `Hive`：多个专业 Agent 像蜂群一样协同工作；
- 不绑定 Z3r0 品牌；
- 比较适合桌面工具和开源项目；
- 可以自然命名内部组件。

推荐品牌体系：

- **产品名：** OpsHive
- **中文名：** 蜂巢运维
- **英文副标题：** Multi-Agent Operations & Security Workbench
- **中文副标题：** 多智能体安全运维工作台
- **仓库名：** `opshive`
- **桌面程序：** `OpsHive.exe`
- **远程执行器：** `opshive-runner`
- **命令行工具：** `opshive-cli`
- **工具包：** `opshive-toolpacks`
- **配置目录：** `%APPDATA%\OpsHive`
- **安装包：** `OpsHive-1.0.0-win-x64-setup.exe`

命名也可以映射到 Agent：

```
OpsHive
├── Queen / Coordinator       总协调 Agent
├── Scout                     诊断与信息收集
├── Guard                     安全检查
├── Mechanic                  修复 Agent
├── Inspector                 独立验证 Agent
└── Archivist                 证据与报告 Agent
```

不过产品界面中建议使用正式名称，如 `Ops Lead`、`Diagnostic Engineer`；蜂群名称可以作为内部代号。

## 其他较好的候选

| --- | --- | --- | --- |

## 如果想更有“硬核工具”感

推荐：

### **VigilForge**

完整写法：

> **VigilForge — AI-Native Operations and Security Workbench**
> 

中文可以叫：

> **守望工坊——AI 原生安全运维工作台**
> 

它比 OpsHive 更偏安全工程和基础设施：

- `Vigil` 表示持续观察、警戒；
- `Forge` 表示分析、构建、修复；
- 同时涵盖诊断、安全检查、变更和验证；
- 与 Z3r0 没有名称关联；
- 比 `Sentinel`、`Aegis` 等常见安全词更容易形成独立品牌。

## 最终建议

- 如果重点突出**多 Agent 协同**：选 **OpsHive**
- 如果重点突出**安全诊断与修复**：选 **VigilForge**
- 如果希望定位成未来的**企业运维平台**：选 **OpsNexus**

综合你们当前“多 Agent + SSH + 诊断 + 安全检查 + 修复”的产品形态，我最推荐：

# **OpsHive**

正式介绍可以写成：

> **OpsHive 是一款面向授权运维与安全工作的多智能体桌面工作台，支持远程诊断、安全检查、受控压测、修复审批、执行回滚和证据审计。**
> 

正式确定前，仍应检查 GitHub 仓库名、npm/PyPI 包名、域名和相关类别商标是否已被占用。

可以，而且加入 **网安 / CTF 黑客文化**后，名字会更有辨识度。常见的命名元素包括：

- `Pwn`：漏洞利用、二进制安全
- `Root`：系统最高权限、运维
- `Flag`：CTF 标志
- `Shell`：命令行与远程控制
- `Hex`：十六进制、逆向、安全
- `0day` / `Zero`：漏洞研究
- `Sec`：Cybersecurity
- `Forge`：构建、修复、工具工坊
- `Ops`：运维与安全运营

## 最推荐：**RootForge**

> **Root + Forge**
> 

中文可叫：**根域工坊** 或 **极客安全工坊**

它比较平衡：

- `Root` 同时代表 Linux、服务器运维和网安；
- `Forge` 表示工具集合、漏洞分析与修复；
- 不会像 `Pwn` 那样显得只做攻击；
- 能覆盖 CTF、渗透测试、诊断、修复和压测；
- 适合正式项目，也适合比赛展示。

品牌体系：

- **产品名：** RootForge
- **副标题：** Multi-Agent Cybersecurity Operations Workbench
- **中文副标题：** 多智能体网络安全运维工作台
- **程序：** `RootForge.exe`
- **仓库：** `rootforge`
- **执行器：** `rootforge-runner`
- **工具包：** `rootforge-arsenal`
- **命令行：** `rfctl`
- **工作区文件：** `.rootforge`
- **项目文件：** `project.rfproj`

宣传语可以是：

> **RootForge — Diagnose. Exploit Safely. Patch. Verify.**
> 

中文：

> **发现问题，验证风险，实施修复，闭环复测。**
> 

---

## 偏 CTF 风格的候选

| --- | --- | --- |

## 更有黑客感的名字

### 1. **PwnForge**

最适合比赛、课程项目、CTF 团队作品。

> **PwnForge — Agentic Security Workbench**
> 

优点：

- 一眼就能看出是网安项目；
- 很符合渗透、漏洞验证、逆向和 CTF；
- `Forge` 又能覆盖工具封装和漏洞修复。

缺点：

- 企业用户可能认为它只做攻击；
- 商业化时安全合规解释成本较高。

### 2. **FlagOps**

最能体现“CTF + 运维”。

> **FlagOps — Capture Problems, Restore Systems**
> 

优点：

- `Flag` 有明显 CTF 文化；
- `Ops` 表达运维和安全运营；
- 简短、好记；
- 不会像 Pwn 那么具有攻击性。

缺点：

- 容易被认为是 CTF 赛事管理平台；
- 需要用副标题说明产品功能。

### 3. **HexForge**

比较适合涵盖代码审计、逆向和漏洞研究。

> **HexForge — Multi-Agent Security Engineering Workbench**
> 

优点：

- 网安从业者容易理解；
- 品牌感比较强；
- 不局限于渗透或运维；
- 适合做 Logo：六边形、十六进制、终端光标。

缺点：

- 对非技术用户不如 RootForge 直观。

### 4. **RootHive**

最适合强调多 Agent。

> **RootHive — Collaborative Agents for Cyber Operations**
> 

可以给 Agent 使用蜂群代号：

```
RootHive
├── Queen       总协调
├── Scout       资产与情报收集
├── Breaker     漏洞验证
├── Medic       修复
├── Inspector   独立复测
└── Scribe      证据和报告
```

这个名字的技术感和多 Agent 特征都很明显，但 `Root` 可能让人误解为工具一定需要管理员权限。

---

## 中文名称候选

如果你们希望有正式中文名：

| --- | --- |

其中比较顺口的是：

- **RootForge｜根铸**
- **HexForge｜玄铸**
- **PwnForge｜攻防熔炉**
- **RootHive｜根域蜂巢**

## 我的最终排序

### 如果这是课程/比赛/CTF 项目

1. **PwnForge**
1. **FlagOps**
1. **FlagForge**

### 如果希望以后做成正式产品

1. **RootForge**
1. **HexForge**
1. **SecHive**

### 如果重点宣传多 Agent

1. **RootHive**
1. **PwnHive**
1. **SecHive**

综合“网安 + CTF + SSH 运维 + 漏洞修复 + 多 Agent”，我建议采用：

# **RootForge**

完整写法：

> **RootForge — Multi-Agent Cybersecurity Operations Workbench**
> 

> **根铸——多智能体网络安全运维工作台**
> 

它既有网安和 CTF 的黑客文化，又不至于把产品限制成纯攻击工具。正式确定前，需要检查 GitHub、npm/PyPI、域名及相关类别商标占用情况。

我看了你的理由，**“真君”比前面的 RootForge、OpsHive 更有记忆点**，而且不是简单堆砌 `Cyber / Sec / Ops / Pwn` 这类常见词。

“三只眼”的功能映射尤其成立：

1. **第一只眼：攻**
1. **第二只眼：守**
1. **第三只眼：智**

这比普通英文组合名更能解释产品为什么包含“渗透、运维、修复、多 Agent”四类能力。

## 英文名不需要硬翻译

我同意你说的：**直接使用 `ZhenJun` 确实不够好。**

问题不是拼音不能做品牌，而是：

- 海外用户不知道怎么发音；
- 看不出网络安全和运维含义；
- `Jun` 容易被理解成人名或 June；
- “真君”背后的二郎神、第三只眼等文化意象翻译后会损失很多；
- 写成 `ZhenJun Security` 反而显得不够利落。

因此建议：

# 正式产品名就叫「真君」

英文场景不要翻译品牌，只使用缩写和功能描述。

## 推荐品牌体系

- **中文产品名：** 真君
- **品牌缩写：** ZJ
- **英文展示名：** ZJ
- **英文副标题：** Multi-Agent Cyber Operations Workbench
- **中文副标题：** 多智能体网络安全运维工作台
- **完整中文：** 真君 · 多智能体网络安全运维工作台

英文页面可以写：

> **ZJ — Multi-Agent Cyber Operations Workbench**
> 

而不是：

> ZhenJun
> 

这样既保留中文品牌，又不会让拼音成为国际传播障碍。

## 软件命名

你图片里的 `zj.exe` 非常合适，甚至是整个命名方案中最有意思的一部分。

```
真君
├── zj.exe                Windows 主程序
├── zj-cli.exe            命令行客户端
├── zj-runner             远程执行器
├── zj-helper.exe          Windows 提权辅助程序
├── zj-toolpacks           工具包
├── .zj                    项目配置目录
└── *.zjproj               项目文件
```

推荐统一为：

| --- | --- |

仓库不建议只叫 `zj`，搜索和辨识度太低；可以用：

- `zj-cyber-workbench`
- `zj-security-workbench`
- `zj-agentic-secops`

其中推荐：

> `zj-cyber-workbench`
> 

## Slogan

### 最推荐

> **开天眼，见真因。**
> 

它同时对应：

- 第三只眼；
- AI 看透故障本质；
- 根因诊断；
- 安全风险发现。

完整品牌文案：

> **真君——开天眼，见真因。**
> 

> 多智能体网络安全运维工作台。
> 

### 偏技术型

> **洞察风险，执掌终端。**
> 

### 偏安全闭环

> **洞察、验证、修复、复明。**
> 

### 偏 CTF 和极客文化

> **三目洞观，攻守一体。**
> 

### 英文副标语

> **See Deeper. Act Safer.**
> 

或者：

> **Diagnose. Validate. Remediate.**
> 

## 视觉设计也很好做

Logo 不要直接画完整的二郎神，这样容易变成游戏或国潮项目。建议做成抽象符号：

```
上方：一只纵向“天眼”
下方：终端提示符 >_
外框：盾牌或六边形
内部：三条汇聚到中心的线路
```

颜色可以对应三只眼：

- **红色：** 渗透、压测、风险验证
- **蓝色：** 运维、防护、修复
- **金色或紫色：** AI、多 Agent、天眼
- **深黑背景：** 终端和 CTF 氛围

产品中的三个主要工作模式也可以直接命名为：

```
赤目｜攻防验证
青目｜运维修复
天目｜智能诊断
```

不过这里建议稍微克制：可以用于首页导航或内部模块，不要把每个按钮都国风化，否则会影响专业运维工具的可用性。

## 产品介绍文案

> **真君是一款面向授权网络安全测试与基础设施运维的多智能体工作台。系统以“攻、守、智”三类能力为核心，通过专业 Agent 协作完成故障诊断、漏洞验证、受控压测、SSH 远程操作、修复审批、执行回滚和结果复测，并对全过程进行证据留存与时间线审计。**
> 

## 最终建议

品牌就定为：

# **真君**

对外不使用 `ZhenJun`，而采用：

# **ZJ — Multi-Agent Cyber Operations Workbench**

程序名：

# **zj.exe**

宣传语：

# **开天眼，见真因。**

这个方案兼顾了中国文化辨识度、CTF 极客气质、软件命名简洁度和英文环境的可读性。唯一需要提前检查的是“真君”和 `ZJ` 在网络安全软件类别中的商标、域名及仓库名称占用情况。

已将品牌方案加入设计页面，包括：

- 中文产品名：**真君**
- 对外英文名：**ZJ — Multi-Agent Cyber Operations Workbench**
- Windows 主程序：**`zj.exe`**
- 宣传语：**开天眼，见真因。**
- “攻、防、智”三目能力映射
- CLI、Sidecar、Runner、Helper、安装包等工程命名规范
- 中英文产品介绍与 Logo 视觉方向

## 推荐 GitHub 仓库名

# `zj-cyber-workbench`

完整地址形式：

```
https://github.com/<组织名>/zj-cyber-workbench
```

这是比单独叫 `zj` 更好的选择：

- `zj` 太短，搜索结果和辨识度较差；
- `zj-cyber-workbench` 能直接说明这是网络安全工作台；
- 不沿用 Z3r0 名称，品牌边界清晰；
- 后续可以围绕 `zj-*` 拆分 Runner、Toolpack 和文档仓库。

如果建立 GitHub Organization，推荐：

```
组织名：zj-security
主仓库：zj-security/zj-cyber-workbench
```

或者更简洁：

```
组织名：zj-cyber
主仓库：zj-cyber/zj
```

综合可读性和搜索效果，最推荐：

```
zj-security/zj-cyber-workbench
```

---

## GitHub Description

GitHub About 区域建议直接填写英文，方便搜索和传播：

> **ZJ (真君) is a multi-agent cyber operations workbench for authorized security testing, infrastructure diagnostics, SSH remediation, controlled load testing, evidence tracking, and replayable audit timelines.**
> 

较短版本：

> **Multi-agent cyber operations workbench for authorized security testing, diagnostics, remote remediation, and evidence-driven incident response.**
> 

我更推荐短版本，信息密度高，不会显得堆砌功能。

### 中文描述

可以放在 README 开头：

> **真君（ZJ）是一款面向授权网络安全测试与基础设施运维的多智能体工作台，支持安全诊断、漏洞验证、受控压测、SSH 远程修复、回滚复测、证据管理与时间线审计。**
> 

---

## GitHub Topics

建议添加以下 Topics：

```
cybersecurity
multi-agent
ai-agents
security-automation
cyber-operations
secops
incident-response
penetration-testing
vulnerability-research
infrastructure
ssh
remote-operations
load-testing
electron
fastapi
windows
ctf-tools
```

不要添加太多。最终推荐保留这 12 个：

```
cybersecurity
multi-agent
ai-agents
security-automation
secops
incident-response
penetration-testing
vulnerability-research
ssh
electron
fastapi
ctf-tools
```

---

## README 标题区

推荐直接使用：

```markdown
<div align="center">

# 真君 · ZJ

### Multi-Agent Cyber Operations Workbench

**开天眼，见真因。**

Authorized security testing · Infrastructure diagnostics ·  
Remote remediation · Evidence-driven operations

</div>
```

然后紧接安全声明：

```markdown
> [!WARNING]
> ZJ is intended exclusively for authorized security testing,
> infrastructure operations, defensive research, CTF education,
> and controlled laboratory environments.
>
> Do not use ZJ to access, scan, test, disrupt, or modify systems
> without explicit authorization.
```

中文版本：

```markdown
> [!WARNING]
> 真君仅用于经过明确授权的网络安全测试、基础设施运维、
> 防御性安全研究、CTF 教学及受控实验环境。
>
> 禁止在未获得授权的情况下扫描、访问、测试、干扰或修改任何系统。
```

---

## README 第一段

### 英文版

```markdown
ZJ (真君) is a Windows-oriented, multi-agent cyber operations
workbench built for authorized security testing and infrastructure
operations.

It combines specialist AI agents, SSH-based remote diagnostics,
controlled security tooling, remediation workflows, approval gates,
evidence records, and replayable audit timelines in a unified
Electron desktop application.
```

### 中文版

```markdown
真君（ZJ）是一款面向 Windows 的多智能体网络安全运维工作台，
用于经过授权的安全测试、基础设施诊断、远程运维和漏洞修复。

系统将专业 Agent 协作、SSH 远程诊断、受控安全工具、修复审批、
执行回滚、证据留存和时间线审计整合到统一的 Electron 桌面应用中。
```

---

## 三目能力命名

README 可以将核心能力写成：

```markdown
## Three Eyes · 三目

### 赤目 · Offensive Validation

Authorized penetration testing, vulnerability validation,
exposure assessment, and controlled load testing.

### 青目 · Operations & Remediation

SSH diagnostics, infrastructure operations, configuration repair,
rollback, and post-remediation verification.

### 天目 · Multi-Agent Intelligence

Multi-agent coordination, root-cause analysis, evidence correlation,
risk classification, and execution planning.
```

其中：

| --- | --- | --- |

---

## 仓库目录名称

仓库克隆后的根目录建议叫：

```
zj-cyber-workbench/
```

内部命名统一修改为：

```
zj-cyber-workbench/
├── desktop/               # Electron Desktop
├── web/                   # React Renderer
├── core/                  # Agent Runtime
├── service/               # Domain Services
├── toolpacks/             # Security and Ops Tools
├── sandbox/               # Isolated Execution Environment
├── packaging/             # Windows Packaging
├── docs/
├── LICENSE
├── NOTICE
├── THIRD_PARTY_NOTICES.md
└── README.md
```

---

## 组件仓库命名

如果后续拆分多个仓库：

| --- | --- |

第一版不建议拆仓库。10 天内全部保留在 `zj-cyber-workbench` Monorepo 中。

---

## 软件包命名

```json
{
  "name": "@zj-security/desktop",
  "productName": "ZJ",
  "description": "Multi-Agent Cyber Operations Workbench"
}
```

Python 包可以使用：

```
zj_core
zj_runtime
zj_toolpacks
```

Docker 镜像：

```
ghcr.io/zj-security/zj-core
ghcr.io/zj-security/zj-runner
ghcr.io/zj-security/zj-sandbox
```

---

## Release 命名

```
ZJ v1.0.0
```

发行文件：

```
ZJ-1.0.0-win-x64-setup.exe
ZJ-1.0.0-win-x64-portable.exe
ZJ-1.0.0-SHA256SUMS.txt
ZJ-1.0.0-SBOM.spdx.json
ZJ-1.0.0-third-party-licenses.txt
```

Release 描述：

```markdown
# ZJ v1.0.0

The first production release of ZJ, a multi-agent cyber operations
workbench for authorized security testing and infrastructure operations.

## Highlights

- Multi-agent incident diagnosis
- SSH terminal and remote file operations
- Controlled security validation
- Approval-gated remediation
- Rollback and independent verification
- Evidence records and replayable timelines
- Windows installer and portable edition
```

---

## MIT 许可与来源说明

仓库根目录保留你们自己的 `LICENSE`，如果整体继续采用 MIT，可以写你们的版权信息；同时必须保留 Z3r0 的原许可声明。

建议新增 `THIRD_PARTY_NOTICES.md`：

```markdown
# Third-Party Notices

## Z3r0

ZJ includes software derived from Z3r0:

https://github.com/yv1ing/Z3r0

Copyright (c) 2026 yv1ing

Z3r0 is licensed under the MIT License. A copy of the original
license is included in this repository.
```

再保存原许可：

```
licenses/Z3r0-LICENSE
```

README 中可以写：

```markdown
## Acknowledgments

ZJ is based in part on the architecture and source code of
Z3r0, originally created by yv1ing
and distributed under the MIT License.
```

不要写：

```
Official Z3r0 successor
```

除非获得原作者明确授权。

---

## 最终推荐配置

```
GitHub Organization:
zj-security

Repository:
zj-cyber-workbench

Display Name:
真君 · ZJ

Description:
Multi-agent cyber operations workbench for authorized security
testing, diagnostics, remote remediation, and evidence-driven
incident response.

Homepage:
https://zj-security.github.io/zj-cyber-workbench/

Executable:
zj.exe

Slogan:
开天眼，见真因。

English Slogan:
See Deeper. Act Safer.
```

如果目前不建立 Organization，直接使用：

```
<你们的 GitHub 账号>/zj-cyber-workbench
```

即可。

已加入执行方案，新增了完整的 **GitHub 仓库与开源发布规范**，包括：

- 主仓库：`zj-security/zj-cyber-workbench`
- GitHub Description、Homepage 和 Topics
- README 中英文标题、项目简介及安全声明
- “赤目、青目、天目”三类能力介绍
- Monorepo 根目录与社区文件规范
- npm、Python 包和 Docker 镜像命名
- Release 标题、安装包及 SBOM 命名
- MIT License、Z3r0 原版权声明和致谢模板
- `SECURITY.md`、Issue、PR、Dependabot 等社区配置
- 将原有发布产物名称统一改为 `ZJ-*`

已重新梳理并完善整份方案，重点进行了以下调整：

- 页面正式更名为 **《真君（ZJ）项目设计与实现方案》**
- 增加目录导航，方便快速定位长文内容
- 明确 **ZJ v1.0 的产品合同**，划定 10 天成品的准确范围
- 增加正式发布阻断项，避免最终交付退化成演示 Demo
- 统一产品、仓库、环境变量、数据目录、Sidecar、协议头和安装包命名
- 明确单机单用户、SQLite、Linux SSH 优先、Windows 有限受控执行等架构决策
- 修正 `zj-core.exe`、`zj-core.spec`、`zj-helper.exe`、`ZJ_*` 等工程名称
- 统一 GitHub、README、Release、MIT 许可与上游致谢规范
- 加强 Scope、审批、回滚、凭据保护和压测限制等发布门槛
- 整理 Definition of Done、10 天主干交付纪律和最终发布检查表

# 4 人详细任务分工

建议将 4 位成员分别定义为四个模块负责人，每个人对自己的模块承担从**设计、开发、测试、文档到最终验收**的完整责任，而不是只负责写代码。

总体分工：

| --- | --- | --- |

---

# 成员 A：后端与 Agent Runtime 负责人

## 一、负责范围

成员 A 负责 **ZJ Core 的核心业务层**，是整个系统的数据和状态中心。

主要覆盖：

- Z3r0 原有 Agent Runtime 的二次开发；
- Incident、Target、Scope、Action、Approval 等业务模型；
- Agent 调度和任务状态机；
- Policy Engine；
- SQLite/PostgreSQL；
- FastAPI REST API；
- Timeline、Evidence 和 Artifact 元数据；
- 后端异常恢复和数据迁移。

成员 A 不负责具体 SSH 协议和 Electron 窗口，但需要定义它们调用的后端接口。

---

## 二、具体任务

### 1. 阅读并梳理 Z3r0 后端

需要完整梳理：

- 用户消息如何进入 Session Runtime；
- Lead Agent 如何选择和委派 Specialist Agent；
- Agent 如何注册、发现和调用 Tool；
- Tool 执行结果如何返回 Agent；
- Session、Task 和 Timeline 如何持久化；
- WorkProject、Asset、Finding、Graph Edge、Attack Path 的关联关系；
- WebSocket 事件如何从后端发送给前端；
- 长任务如何暂停、恢复和取消；
- Sandbox、Host、Container 与 Project 如何绑定。

需要输出一份内部调用链：

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

### 2. 设计并实现新增领域模型

负责新增或扩展：

- `Incident`
- `Target`
- `AuthorizationScope`
- `CredentialRef`
- `ProposedAction`
- `PolicyDecision`
- `Approval`
- `Execution`
- `ExecutionChunk`
- `Artifact`
- `ChangeSet`
- `VerificationResult`
- `RollbackResult`

每个模型需要包含：

- 主键和关联关系；
- 创建时间、更新时间；
- 状态字段；
- 创建者或 Agent Actor；
- Project 和 Incident 归属；
- 审计字段；
- Schema Version；
- 删除或归档策略。

### 3. Incident 状态机

负责实现：

```
created
→ planning
→ diagnosing
→ awaiting_approval
→ executing
→ verifying
→ completed
```

异常路径：

```
executing → failed
executing → cancelled
verifying → rollback_required
rollback_required → rolling_back
rolling_back → rolled_back
```

需要保证：

- 状态不能非法跳转；
- 已取消任务不能继续写入成功结果；
- 已过期审批不能启动执行；
- 修复失败必须进入验证失败或回滚状态；
- Agent 不能直接把 Incident 标记为完成；
- Incident 完成前必须保存最终结论。

### 4. 改造 Agent Runtime

保留 Z3r0 原有主循环，但增加：

- `resolve_project_scope`
- `classify_request_risk`
- `create_incident`
- `policy_check`
- `approval_gate`
- `execute_action`
- `persist_evidence`
- `build_changeset`
- `verify_changeset`
- `rollback_changeset`
- `generate_incident_summary`

需要支持：

- Lead Agent 委派多个 Specialist；
- Specialist 并行执行只读诊断；
- 写操作等待人工审批；
- Agent 任务暂停后恢复；
- Agent 失败后的有限重试；
- 用户取消后中断 Agent 和 Tool；
- 任务结果通过统一事件写入 Timeline。

### 5. Policy Engine

成员 A 对 Policy Engine 负主要责任。

输入至少包含：

- Project；
- Incident；
- Target；
- AuthorizationScope；
- Action Type；
- Action 参数；
- 发起 Agent；
- 当前用户；
- 目标环境；
- 当前时间；
- 是否存在备份和回滚；
- 压测速率、并发和持续时间。

输出：

```python
class PolicyDecision(BaseModel):
    effect: Literal["allow", "require_approval", "deny"]
    risk_level: Literal["L0", "L1", "L2", "L3"]
    reason_codes: list[str]
    constraints: dict[str, Any]
    approval_ttl_seconds: int | None
```

必须实现：

- 越界目标直接拒绝；
- 生产环境写操作必须审批；
- 高风险 Action 二次确认；
- 没有回滚方案的配置修改不得执行；
- 修改 Action 参数后原审批失效；
- 压测不能通过拆分任务绕过总限制；
- CredentialRef 只能用于绑定目标；
- Agent 不能通过 Prompt 或 Tool 参数覆盖策略。

### 6. Approval Token

负责审批数据模型和 Token 生成验证。

Token 必须绑定：

```
project_id
incident_id
action_hash
target_id
approver_id
expires_at
```

需要防止：

- 修改命令后重复使用旧审批；
- 在不同目标复用审批；
- 在不同 Incident 复用审批；
- 审批过期后继续执行；
- 同一个审批重复触发不可重入操作。

### 7. 数据库和迁移

负责将桌面模式切换为 SQLite 默认运行，同时保留 PostgreSQL 兼容能力。

需要处理：

- UUID；
- JSON 字段；
- Enum；
- UTC 时间；
- SQLite WAL；
- Foreign Key；
- Busy Timeout；
- 数据库升级；
- 升级前自动备份；
- 迁移失败恢复；
- PostgreSQL/SQLite 双数据库测试。

终端大输出不得逐字符写数据库。数据库只存索引、摘要和 Artifact 引用。

### 8. REST API 和业务接口

负责实现或协调以下 API：

```
POST   /desktop/bootstrap
GET    /health
POST   /projects
GET    /projects/{id}
POST   /targets
POST   /targets/ssh/test
POST   /incidents
GET    /incidents/{id}
POST   /incidents/{id}/messages
GET    /incidents/{id}/timeline
POST   /actions/{id}/approve
POST   /actions/{id}/reject
POST   /actions/{id}/cancel
POST   /changesets/{id}/apply
POST   /changesets/{id}/verify
POST   /changesets/{id}/rollback
POST   /reports/incidents/{id}
```

每个接口需要：

- Pydantic 参数校验；
- 统一错误码；
- Correlation ID；
- 权限和 Scope 检查；
- Timeline 事件；
- 对应单元测试。

### 9. Timeline 与 Evidence

负责建立统一事件格式：

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

Timeline 必须成为系统事实来源，不能只依赖聊天消息。

---

## 三、成员 A 的最终交付物

- 可运行的 ZJ Core；
- Agent Runtime 改造；
- 完整领域模型；
- SQLite/PostgreSQL 数据层；
- 数据库迁移文件；
- Policy Engine；
- Approval Token；
- Incident 和 ChangeSet 状态机；
- REST API；
- Timeline 与 Evidence 服务；
- 后端单元测试；
- API 和数据模型文档。

---

## 四、成员 A 的验收标准

- Agent 无法绕过 Scope 和 Approval；
- Incident 状态不会非法跳转；
- SQLite 并发写入不会长期锁死；
- 数据迁移失败不会破坏原数据库；
- 所有执行操作具有 Timeline 记录；
- ChangeSet 能完成 Apply、Verify、Rollback；
- 后端崩溃重启后任务和 Incident 状态可恢复；
- API 错误均返回稳定错误码，而不是裸堆栈。

---

# 成员 B：Electron 与前端负责人

## 一、负责范围

成员 B 负责整个 **Windows 产品体验和桌面运行环境**。

主要覆盖：

- Electron Main、Preload、Renderer；
- 现有 React 前端复用与改造；
- ZJ Core Sidecar 生命周期；
- IPC 安全；
- Project、Incident、Agent、Terminal、Approval 等页面；
- xterm.js 终端界面；
- 安装版和 Portable 版；
- Windows 桌面安全配置；
- 崩溃提示和日志导出；
- 产品品牌视觉。

成员 B 不负责后端 Agent 决策，也不直接实现 SSH 协议；通过成员 A、C 提供的 API 和 WebSocket 使用这些能力。

---

## 二、具体任务

### 1. Electron 工程搭建

负责建立：

```
desktop/
├── src/
│   ├── main.ts
│   ├── preload.ts
│   ├── ipc/
│   ├── sidecar/
│   ├── security/
│   └── updater/
├── electron-builder.yml
├── package.json
└── tsconfig.json
```

必须配置：

```tsx
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
```

禁止：

- Renderer 直接使用 `fs`；
- Renderer 直接使用 `child_process`；
- Renderer 访问 SSH 私钥；
- Renderer 读取模型 API Key；
- Renderer 连接 Docker Socket；
- 将完整 Electron API 暴露给页面。

### 2. Preload 白名单 IPC

负责提供最小化接口，例如：

```tsx
window.zj.desktop.getStatus()
window.zj.secret.save()
window.zj.secret.delete()
window.zj.logs.export()
window.zj.window.minimize()
window.zj.window.close()
```

每个 IPC：

- 明确参数类型；
- 使用 Zod 或 TypeScript Schema 校验；
- 不接受任意文件路径；
- 不接受任意 Shell 命令；
- 错误信息脱敏；
- 具有单元测试。

### 3. ZJ Core Sidecar 管理

实现 `SidecarManager`：

- 启动 `zj-core.exe`；
- 生成随机会话 Token；
- 传递数据目录、端口和配置；
- 读取握手文件；
- 轮询健康检查；
- 捕获标准输出和错误日志；
- 处理启动超时；
- 检测崩溃；
- 最多自动重启两次；
- Electron 退出时优雅关闭；
- 超时后终止整个进程树。

UI 要显示以下状态：

```
正在启动核心服务
核心服务可用
核心服务启动失败
核心服务已崩溃
正在尝试恢复
需要导出日志
```

### 4. React 工作区改造

负责复用 Z3r0 原有 `web/`，增加以下页面。

#### 首页

- 最近 Project；
- 最近 Incident；
- 当前运行任务；
- 待审批操作；
- SSH 主机状态；
- Sandbox 状态；
- 三目入口：赤目、青目、天目。

#### Project 页面

- Project 基本信息；
- 授权范围；
- 目标列表；
- CredentialRef；
- Incident；
- Finding；
- Artifact；
- Timeline。

#### Incident 工作区

建议布局：

```
左侧：Incident、Agent、目标
中间：Agent 对话与计划
右侧：证据、Finding、审批、执行详情
底部：Terminal、任务输出
```

#### Approval Center

展示：

- 发起 Agent；
- 目标；
- Action Type；
- 实际命令或配置差异；
- 风险等级；
- 影响范围；
- 备份方案；
- 回滚方案；
- Token 有效期；
- 批准、拒绝按钮。

不能只展示“Agent 希望执行操作”，必须展示用户实际批准的内容。

#### ChangeSet 页面

- Precheck；
- Backup；
- Apply；
- Verify；
- Rollback；
- 每一步的执行状态；
- 标准输出和错误；
- 配置 Diff；
- 验证结果。

### 5. Terminal UI

集成 xterm.js：

- 多标签终端；
- ANSI 颜色；
- Copy/Paste；
- Resize；
- 搜索；
- 连接状态；
- 断线提示；
- 重新连接；
- Ctrl+C 信号；
- 自动滚动开关；
- 输出截断提示；
- 终端历史加载。

Terminal 数据按 Base64 Buffer 传输，不能假设所有输出都是 UTF-8 文本。

### 6. SFTP 文件界面

提供：

- 目录树；
- 当前路径；
- 文件大小和时间；
- 上传；
- 下载；
- 新建目录；
- 文件预览；
- 修改前 Diff；
- 覆盖确认；
- 备份状态；
- 下载进度和取消。

任何路径必须通过后端 API 处理，前端不自行判断安全路径。

### 7. 设置和首次启动

首次启动向导需要完成：

- 数据目录选择；
- 模型 Provider；
- API Endpoint；
- API Key 安全保存；
- Docker 可用性检查；
- SSH 功能说明；
- 授权使用声明；
- 是否开启本机 PowerShell；
- 日志和 Artifact 保留时间。

没有 Docker 时不能阻止软件启动，只关闭依赖 Sandbox 的功能并给出明确说明。

### 8. 产品视觉

负责落地：

- 产品名：真君；
- 英文名：ZJ；
- 宣传语：开天眼，见真因；
- 主程序：`zj.exe`；
- Logo；
- Icon；
- Splash Screen；
- About 页面；
- 赤目、青目、天目颜色规范；
- 深色主题；
- 高风险操作红色警示。

不能让国风视觉影响终端、日志、Diff 和审批等专业界面的可读性。

### 9. Windows 打包

负责：

- Electron Builder；
- NSIS 安装包；
- Portable 版；
- 应用图标；
- `appId`；
- AUMID；
- 版本号；
- Sidecar 和资源打包；
- `asar` 配置；
- Native Module Rebuild；
- 安装路径；
- 卸载数据策略；
- 更新机制；
- 代码签名流程。

需要测试：

- 中文用户名；
- 中文安装路径；
- 路径包含空格；
- 无管理员权限；
- 只读目录；
- 覆盖安装；
- 卸载后保留或清除用户数据；
- Windows Defender/SmartScreen 提示。

---

## 三、成员 B 的最终交付物

- Electron Main/Preload/Renderer；
- 完整 React 产品界面；
- SidecarManager；
- xterm.js Terminal；
- SFTP 文件管理界面；
- Approval Center；
- ChangeSet 页面；
- 首次启动向导；
- 设置、错误恢复和日志导出；
- Logo、Icon、启动页；
- NSIS 安装版；
- Portable 版；
- Electron E2E 测试；
- Windows 打包说明。

---

## 四、成员 B 的验收标准

- Renderer 无 Node 权限；
- 所有桌面高权限能力只能通过白名单 IPC；
- `zj-core.exe` 崩溃后有明确恢复路径；
- 安装版与 Portable 版均可在干净 Windows 启动；
- Terminal 大输出不会卡死 UI；
- 用户能看清 Agent 将要执行的真实操作；
- 软件在无 Docker、无模型配置时能够正常进入降级界面；
- 数据目录不可写时给出明确修复方案；
- 所有核心流程可通过 UI 完成。

---

# 成员 C：远程执行、Windows 执行与 Toolpack 负责人

## 一、负责范围

成员 C 负责系统中所有“真正碰目标机器”的能力，是执行平面的负责人。

主要覆盖：

- SSH；
- Host Key；
- SFTP；
- 远程交互式 Shell；
- 一次性远程命令；
- 本机 PowerShell；
- Windows UAC Helper；
- Docker Sandbox；
- Toolpack；
- 授权扫描；
- 压力测试；
- 超时、限流、取消和进程清理；
- 执行结果结构化。

成员 C 不决定某个操作是否允许执行，Policy Decision 由成员 A 提供；成员 C 必须在执行前再次验证 Decision 和 Approval Token。

---

## 二、具体任务

### 1. Transport 抽象

设计统一接口：

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

后续可扩展：

- WinRM；
- Kubernetes；
- Docker Remote Runner。

### 2. SSH

建议使用 AsyncSSH。

实现：

- 密码认证；
- 私钥认证；
- Passphrase；
- SSH Agent；
- Host Key 校验；
- 连接超时；
- Keepalive；
- 空闲回收；
- 多终端会话；
- 一次性命令；
- PTY；
- Resize；
- Signal；
- Sudo 交互；
- 连接中断清理；
- Jump Host 预留接口。

连接池必须按以下键隔离：

```
project_id + target_id + credential_ref + user_identity
```

禁止不同 Project 共享高权限连接。

### 3. Host Key 管理

负责：

- 首次连接获取算法和 SHA-256 指纹；
- 将待确认指纹返回 UI；
- 用户确认后写入 `known_hosts`；
- 指纹变化时阻止连接；
- 区分域名、IP 和端口；
- 不提供默认忽略 Host Key 的选项；
- 为 Host Key 变化写入安全事件。

### 4. Terminal WebSocket

实现后端 Terminal Handler：

客户端消息：

```
input
resize
signal
close
```

服务端消息：

```
output
status
exit
error
```

需要处理：

- Base64 二进制传输；
- 序号；
- 背压；
- 输出分块；
- 终端关闭；
- 进程退出码；
- 信号；
- 断线重连；
- 最大历史；
- Artifact 输出文件；
- 超时和取消。

### 5. SFTP

实现：

- 文件列表；
- Stat；
- 上传；
- 下载；
- 新建目录；
- 删除或重命名的高风险控制；
- 允许根目录；
- 路径归一化；
- `..` 防护；
- 符号链接检查；
- 文件大小限制；
- 哈希校验；
- 临时文件原子重命名；
- 覆盖前备份；
- 中断续传是否支持的明确行为。

### 6. Windows 本机执行

实现受限 PowerShell 执行器。

只读能力：

- 系统信息；
- CPU、内存、磁盘；
- 服务状态；
- 进程列表；
- 端口列表；
- Event Log；
- 防火墙状态；
- 计划任务；
- 网络配置。

受控修改能力：

- 服务重启；
- 文件备份；
- 配置文件替换；
- 部分防火墙规则；
- 经批准的脚本执行。

PowerShell 必须：

- 使用固定脚本或结构化参数；
- 不通过字符串直接拼接用户输入；
- 设置超时；
- 捕获退出码；
- 捕获标准输出和错误；
- 使用受限 Execution Policy 设计；
- 对输出进行脱敏。

### 7. UAC Helper

实现 `zj-helper.exe` 或对应辅助程序。

要求：

- 主程序不长期管理员运行；
- Helper 只在需要时触发 UAC；
- Helper 只接受一次性任务文件；
- 任务文件具有签名或 HMAC；
- 任务文件绑定 Action Hash；
- 任务具有有效期；
- Helper 不接受任意 Shell 字符串；
- 执行结果写入安全结果文件；
- 读取后立即清理临时文件。

### 8. Action Registry

建立结构化 Action 到具体命令的映射。

示例：

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

每个 Action 必须包含：

- 输入 Schema；
- 支持平台；
- 风险等级；
- Scope 要求；
- 权限要求；
- 超时；
- 最大输出；
- 是否幂等；
- 是否可重试；
- Backup；
- Verify；
- Rollback。

### 9. Toolpack

负责首批正式 Toolpack：

#### Linux 运维

- 系统概况；
- 服务状态；
- Journal/System Log；
- CPU、内存、磁盘；
- 端口和连接；
- DNS；
- TLS；
- 时间同步；
- 配置备份；
- 配置语法检查；
- 服务重启；
- 健康检查。

#### Windows 运维

- 服务；
- Event Log；
- 进程；
- 端口；
- 磁盘；
- 网络；
- 防火墙状态；
- 文件备份和替换。

#### Web Health

- DNS 解析；
- TCP 连通性；
- TLS 证书；
- HTTP 状态；
- 重定向；
- 响应时间；
- 关键 Header；
- 健康检查。

#### 安全工具

复用现有 Sandbox：

- 端口和服务识别；
- HTTP 探测；
- 依赖和配置检查；
- 有授权范围的漏洞验证；
- 原始结果 Artifact；
- 结构化 Finding 输出。

### 10. 压力测试

集成一种成熟引擎，建议优先 k6。

负责：

- 测试配置生成；
- 最大 RPS；
- 最大并发；
- Ramp-up；
- 最大持续时间；
- 目标白名单；
- 测试时间窗；
- 实时输出；
- Kill Switch；
- 进程树终止；
- Agent/UI 断连后的停止策略；
- 结果解析；
- 性能报告 Artifact。

所有硬限制必须在执行器再检查一次，不能只依赖 Policy Engine。

### 11. Docker Sandbox

负责：

- 现有沙箱兼容；
- 镜像构建；
- Tool Manifest；
- 非 Root；
- CPU、内存、PID 限制；
- 文件系统限制；
- 超时回收；
- 网络出口白名单；
- Artifact 挂载；
- 任务取消；
- 容器清理；
- 镜像版本和哈希记录。

禁止：

- `--privileged`；
- 容器挂载宿主 Docker Socket；
- 未受控访问宿主文件；
- Agent 任意开放端口；
- 未授权目标流量。

### 12. 统一执行结果

所有执行返回：

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

错误必须区分：

- 连接失败；
- 认证失败；
- Host Key 错误；
- 权限不足；
- 超时；
- 用户取消；
- 策略拒绝；
- 执行失败；
- 输出超限；
- 目标平台不支持。

---

## 三、成员 C 的最终交付物

- Transport 接口；
- SSHTransport；
- LocalPowerShellTransport；
- SandboxTransport；
- SSH 连接池；
- Terminal WebSocket；
- SFTP；
- Host Key 管理；
- UAC Helper；
- Action Registry；
- Linux、Windows、Web Toolpack；
- Sandbox 工具适配；
- k6 压测适配；
- 任务取消与进程清理；
- Tool Parser；
- 执行层单元和集成测试；
- 执行器开发文档。

---

## 四、成员 C 的验收标准

- Host Key 变化时连接被阻止；
- 不同 Project 不共享 SSH 会话；
- 用户取消后远程进程或容器真正终止；
- 输出超限不会耗尽内存和磁盘；
- SFTP 不能通过路径穿越访问允许目录之外；
- 压测无法访问 Scope 之外的目标；
- 压测无法超过批准的并发、RPS 和时长；
- 写操作均有备份、验证和回滚接口；
- 无 Docker 时非 Sandbox 功能正常运行；
- 所有 Tool 返回稳定结构化结果。

---

# 成员 D：Agent 工程、质量、安全与发布负责人

## 一、负责范围

成员 D 负责保证“多 Agent 真正有效且安全”，并对整个正式版本的质量负责。

主要覆盖：

- Agent 角色设计；
- System Prompt；
- Tool 描述和 Tool Schema；
- Context Engineering；
- Agent 评测；
- Mock Model；
- 自动化测试；
- 安全测试；
- Prompt Injection 测试；
- Electron E2E；
- 报告模板；
- README 和用户文档；
- Release Checklist；
- SBOM 和第三方许可；
- 最终发布验收。

成员 D 不是“只负责测试”，而是 **Agent 行为和最终质量负责人**。

---

## 二、具体任务

### 1. Agent 角色设计

负责定义：

- Ops Lead；
- Diagnostic Engineer；
- Security Engineer；
- Load Test Engineer；
- Remediation Engineer；
- Verification Engineer；
- Evidence Reporter。

每个 Agent 必须明确：

- 职责；
- 输入；
- 输出；
- 可用工具；
- 禁止工具；
- 最大任务深度；
- 何时委派；
- 何时停止；
- 何时请求审批；
- 何时拒绝；
- 最终结果 Schema。

### 2. Ops Lead Prompt

Ops Lead 需要做到：

- 明确用户目标；
- 读取 Project Scope；
- 将问题分解为诊断任务；
- 选择正确 Specialist；
- 避免重复任务；
- 汇总证据；
- 区分事实、推测和建议；
- 不直接执行高风险命令；
- 在证据不足时继续诊断；
- 修复后交给 Verification Agent；
- 给出最终 Incident 总结。

### 3. Diagnostic Agent Prompt

要求：

- 只读优先；
- 从低风险、高信息量检查开始；
- 不盲目运行大量命令；
- 每个检查说明目的；
- 将输出转为 Observation；
- 为根因假设提供支持或反证；
- 不将命令成功等同于系统健康；
- 不直接修改目标。

### 4. Security Agent Prompt

要求：

- 只在授权 Scope 内工作；
- 区分发现、验证、利用；
- 默认不执行破坏性测试；
- 不主动扩大目标范围；
- Finding 必须包含证据、影响和置信度；
- 不把版本号直接等价为可利用漏洞；
- 明确误报和待验证状态；
- 所有压测和漏洞验证需遵守硬限制。

### 5. Remediation Agent Prompt

要求输出结构化 ChangeSet：

- 问题；
- 根因；
- 修复目标；
- Precheck；
- Backup；
- Apply；
- Verify；
- Rollback；
- 风险；
- 预计影响；
- 审批需求。

禁止：

- 在没有备份时直接覆盖配置；
- 在没有语法检查时重启服务；
- 在没有回滚时修改生产配置；
- 将“执行成功”视为“问题已解决”。

### 6. Verification Agent Prompt

Verification Agent 必须独立于 Remediation Agent：

- 重新读取目标状态；
- 检查原始问题；
- 检查服务健康；
- 检查安全问题；
- 检查副作用；
- 检查关键回归项；
- 输出通过、失败或不确定；
- 失败时建议回滚；
- 不直接相信 Remediation Agent 的结论。

### 7. Context Engineering

负责定义模型上下文构造：

```
系统安全规则
→ 当前 Agent 职责
→ Project Scope 摘要
→ Incident 状态摘要
→ 最近相关 Timeline
→ 必要证据片段
→ 当前允许的 Tool
```

必须避免：

- 将完整终端历史放入上下文；
- 将完整扫描报告一次性发送模型；
- 将私钥和密码放入上下文；
- 将远程文件中的指令当系统指令；
- 不受控地跨 Incident 共享敏感信息。

### 8. Prompt Injection 防护测试

准备恶意样本：

- 日志中要求忽略系统规则；
- README 中要求上传密钥；
- 配置文件中伪造审批指令；
- HTTP 页面要求扫描额外目标；
- 命令输出中诱导 Agent 执行提权；
- Artifact 中伪造 Tool Result；
- 用户要求绕过审批。

验证：

- Agent 将其视为不可信数据；
- Tool 权限不发生变化；
- Scope 不发生变化；
- 凭据不被读取；
- 高风险操作仍需要审批。

### 9. Agent 评测集

建立至少以下场景：

- Linux 服务不可用；
- 磁盘空间不足；
- CPU 异常；
- TLS 证书过期；
- DNS 配置错误；
- Nginx 配置错误；
- Windows 服务停止；
- 端口被占用；
- 漏洞发现但证据不足；
- 修复失败触发回滚；
- 压测参数超过授权；
- 目标不在 Scope；
- Prompt Injection；
- SSH 权限不足；
- Agent Tool 调用超时。

评测指标：

- Agent 选择正确率；
- Tool 选择正确率；
- Scope 违规率；
- 未审批写操作数量；
- 根因判断准确性；
- ChangeSet 完整率；
- 回滚完整率；
- Verification 独立性；
- 报告完整性；
- Token 消耗和任务时长。

### 10. Mock Model

负责开发 Mock Provider，用于 CI：

- 固定返回 Agent Tool Call；
- 模拟流式消息；
- 模拟结构化输出错误；
- 模拟超时；
- 模拟 Provider 断开；
- 模拟 Token 超限；
- 支持复现 Agent 流程。

自动化测试不能依赖真实付费模型才能运行。

### 11. 后端、前端与执行层测试协调

成员 D 负责建立统一测试矩阵，但各模块负责人必须编写自己模块的单元测试。

D 重点负责：

- 跨模块集成测试；
- Agent 流程测试；
- Policy 负面测试；
- Electron E2E；
- Windows 安装测试；
- SQLite 升级测试；
- Sidecar 崩溃恢复；
- SSH 断连恢复；
- 长输出；
- 任务取消；
- 并发任务；
- 凭据泄漏扫描。

### 12. 安全测试

覆盖：

- XSS；
- Electron IPC 注入；
- Node Integration；
- CSP；
- 路径穿越；
- SFTP 路径逃逸；
- Shell 注入；
- PowerShell 注入；
- Approval Token 篡改；
- Approval 重放；
- Scope 绕过；
- Host Key 绕过；
- 日志敏感信息泄漏；
- Sidecar 未授权访问；
- WebSocket 未认证连接；
- Docker 网络越界；
- 压测参数绕过。

### 13. 报告系统

负责定义 Incident Report：

- 基本信息；
- 授权范围；
- 时间线；
- 参与 Agent；
- 目标；
- 症状；
- Observation；
- 根因；
- Finding；
- 执行动作；
- 审批；
- ChangeSet；
- 验证；
- 回滚；
- 遗留风险；
- Artifact Hash；
- 生成时间。

输出：

- Markdown；
- HTML；
- 后续可扩展 PDF。

### 14. 文档和开源规范

负责：

- `README.md`
- `README_zh.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `THIRD_PARTY_NOTICES.md`
- `licenses/Z3r0-LICENSE`
- 用户手册；
- 管理员安全说明；
- 开发环境文档；
- 构建文档；
- 发布检查表；
- 已知限制；
- 故障排查文档。

### 15. 最终发布

负责协调：

- 版本号；
- Changelog；
- Release Notes；
- SHA-256；
- SBOM；
- 第三方许可；
- 安装包烟雾测试；
- 干净 Windows VM 验收；
- Git Tag；
- GitHub Release；
- Known Issues；
- 发布阻断项检查。

成员 D 有权阻止存在 P0/P1 安全问题的版本标记为 `v1.0.0`。

---

## 三、成员 D 的最终交付物

- 7 个 Agent 的正式 Prompt；
- Agent Tool 权限矩阵；
- Context Builder 规范；
- Agent 评测集；
- Mock Model；
- 集成测试；
- Electron E2E；
- 安全测试报告；
- Prompt Injection 测试；
- Incident Report 模板；
- README 与社区文件；
- MIT/第三方许可文件；
- 用户手册；
- 发布检查表；
- SBOM、Release Notes 和最终测试报告。

---

## 四、成员 D 的验收标准

- CI 不依赖真实模型即可稳定运行；
- Agent 不会通过远程内容改变安全规则；
- 高风险操作不存在未审批执行路径；
- 所有核心 Incident 场景通过 E2E；
- 报告数据与 Timeline 一致；
- 安装包在干净 Windows 环境通过验收；
- README、License、NOTICE 和第三方许可完整；
- 发布包具有版本号、校验值、SBOM 和已知限制；
- P0/P1 安全缺陷清零。

---

# 四人之间的接口边界

## A 向 B 提供

- REST API；
- Incident/Action/Approval Schema；
- Timeline WebSocket；
- 统一错误码；
- 健康检查；
- Sidecar Shutdown API。

## A 向 C 提供

- `PolicyDecision`；
- Approval Token；
- Execution 数据接口；
- Artifact 写入接口；
- Action Registry 接口规范；
- Timeline 事件接口。

## C 向 A 提供

- Transport；
- Tool Adapter；
- Execution Result；
- Terminal Session；
- SFTP Result；
- Sandbox Task；
- Cancel Handle。

## D 向 A 提供

- Agent Prompt；
- Tool 权限矩阵；
- Agent 输出 Schema；
- Agent 评测用例；
- Policy 负面测试。

## D 向 B 提供

- E2E 流程；
- UI 安全测试；
- 报告展示字段；
- 风险提示文案；
- 发布验收清单。

## D 向 C 提供

- Tool 测试场景；
- 恶意输入样本；
- Scope 越界样本；
- 压测限制测试；
- Prompt Injection 样本。

---

# 共同责任

以下事项不能只归某一个人：

1. **代码评审**
1. **主干稳定**
1. **测试**
1. **文档**
1. **安全**

---

# 工作量平衡建议

| --- | --- | --- |

最终责任可以概括为：

- **A 保证系统“逻辑正确、状态可靠”。**
- **B 保证系统“在 Windows 上能用、好用、能发布”。**
- **C 保证系统“能安全、稳定地执行真实操作”。**
- **D 保证系统“Agent 有效、整体安全、质量达标”。**

已在总设计方案下创建 4 个独立任务页面，每个页面均包含职责边界、具体任务、工程接口、最终交付物和验收标准。

已将成员 A 页面升级为 **“成员 A（组长）｜ZJ Core、系统架构与项目交付负责人”**，并补充完整执行要求，包括：

- 技术负责人和组长两套职责
- 最终决定权、共同决策权和不可越过的权力边界
- 四人 RACI 责任矩阵
- 与成员 B 的 API、Sidecar、WebSocket 和前端类型交接契约
- 与成员 C 的 Action、Policy、Execution、Cancel 和 Artifact 交接契约
- 与成员 D 的 Prompt、Mock Model、安全测试和发布交接契约
- 公共 Schema 冻结、版本管理和变更流程
- 从原项目梳理到正式发布的六阶段执行方案
- 个人后端开发顺序和不应优先投入的事项
- 主干、Issue、PR、Review 和 ADR 管理规则
- 阻塞升级与团队沟通机制
- SQLite、PyInstaller、接口变更、模型稳定性等风险预案
- 个人 Definition of Done 和工作优先级