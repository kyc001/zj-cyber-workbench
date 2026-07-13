<aside>  
🖥️

**岗位使命：保证真君在 Windows 上能安装、能启动、能操作、能恢复、能正式发布。**负责 Electron 桌面端、React 产品界面、Sidecar 生命周期和 Windows 打包。

</aside>

## 一、职责边界

负责：

- Electron Main、Preload、Renderer。
- 原 Z3r0 React Workbench 的复用和产品化改造。
- ZJ Core Sidecar 启动、健康检查、崩溃恢复与关闭。
- IPC 白名单和桌面安全配置。
- Project、Incident、Agent、Terminal、Approval、ChangeSet 等界面。
- xterm.js 终端与 SFTP 文件界面。
- 首次启动、设置、日志导出和错误恢复。
- 产品品牌、Icon、启动页、About 页面。
- NSIS 安装版、Portable 版和 Windows 构建流水线。

**不负责：**Agent 决策、Policy 规则、SSH 协议底层和 Tool 执行；通过 A、C 提供的 API 与 WebSocket 使用这些能力。

## 二、Electron 工程

建立：

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

安全配置：

```tsx
nodeIntegration: false
contextIsolation: true
sandbox: true
webSecurity: true
```

禁止 Renderer 直接使用 `fs`、`child_process`、SSH 私钥、模型 Key 和 Docker Socket；禁止加载远程脚本和任意远程页面。

## 三、Preload 与 IPC

只暴露最小白名单：

```tsx
window.zj.desktop.getStatus()
window.zj.secret.save()
window.zj.secret.delete()
window.zj.logs.export()
window.zj.window.minimize()
window.zj.window.close()
```

每个 IPC 必须：

- 有明确参数和返回类型。
- 使用 Zod/Schema 校验。
- 不接受任意文件路径和 Shell 命令。
- 对错误信息脱敏。
- 验证调用来源。
- 有单元测试和负面测试。

## 四、ZJ Core SidecarManager

负责：

- 启动 `zj-core.exe`。
- 生成随机桌面会话 Token。
- 传入数据目录、端口和运行配置。
- 读取握手文件中的 PID、端口、Nonce 和协议版本。
- 轮询 `/health`。
- 捕获标准输出和错误日志。
- 处理 30 秒启动超时。
- 5 秒一次健康检查。
- 连续失败后标记崩溃。
- 最多自动重启两次。
- Electron 退出时调用 Shutdown API。
- 超时后终止完整进程树。

状态机：

```
STOPPED → STARTING → HEALTHY → STOPPING → STOPPED
                  ↘ CRASHED → RESTARTING
```

UI 需要显示启动、健康、崩溃、恢复和日志导出状态。

## 五、React 页面

### 1. 首页

- 最近 Project、Incident。
- 正在运行的任务。
- 待审批操作。
- SSH/Sandbox 状态。
- 三目入口：赤目、青目、天目。

### 2. Project 页面

- 基本信息和授权范围。
- Target、CredentialRef。
- Incident、Finding、Artifact、Timeline。

### 3. Incident 工作区

```
左侧：Incident、Agent、目标
中间：Agent 对话、计划、结果
右侧：证据、Finding、审批、执行详情
底部：Terminal、任务输出
```

### 4. Approval Center

必须展示：

- 发起 Agent 和目标。
- Action Type、真实命令或配置 Diff。
- 风险等级和影响范围。
- Precheck、Backup、Verify、Rollback。
- 审批有效期。
- 批准、拒绝及拒绝理由。

不能只展示模糊的“Agent 请求执行”。

### 5. ChangeSet 页面

展示 Precheck、Backup、Apply、Verify、Rollback，每一步的状态、输出、配置 Diff 和验证结论。

## 六、Terminal UI

集成 xterm.js：

- 多标签终端。
- ANSI 颜色和 Unicode。
- Copy/Paste、搜索、Resize。
- Ctrl+C、关闭和重新连接。
- 自动滚动开关。
- 连接与断线状态。
- 输出截断提示。
- 最后 256 KB 历史加载。
- 大输出虚拟化，避免卡死 UI。

按 Base64 Buffer 接收终端数据，不假设输出都是完整 UTF-8 文本。

## 七、SFTP 文件界面

- 目录树和路径导航。
- 文件大小、时间、权限信息。
- 上传、下载、取消、进度。
- 文件预览和配置 Diff。
- 覆盖前确认和备份状态。
- 大文件限制提示。

路径安全由后端判定，前端不得自行绕过后端直接读写远程文件。

## 八、首次启动与设置

首次启动向导：

- 数据目录。
- 模型 Provider、Endpoint 和模型名。
- API Key 安全保存。
- Docker 可用性检查。
- SSH 与本机 PowerShell 功能说明。
- 授权和安全使用声明。
- 日志和 Artifact 保留时间。

无 Docker 时软件仍应正常启动，仅禁用 Sandbox、部分扫描和压测功能。

## 九、品牌与视觉

负责落地：

- 中文产品名：真君。
- 英文展示：ZJ。
- 副标题：Multi-Agent Cyber Operations Workbench。
- 宣传语：开天眼，见真因。
- 主程序：`zj.exe`。
- Logo、Icon、Splash Screen、About 页面。
- 赤目、青目、天目颜色系统。
- 深色主题、高风险警示和可读性。

Logo 使用抽象纵向天眼、终端光标和盾牌/六边形，不直接绘制完整神话人物。

## 十、Windows 打包与发布

负责 Electron Builder：

- NSIS 安装版和 Portable 版。
- `appId`、AUMID、版本号和图标。
- `asar` 和 Sidecar 资源配置。
- Native Module Rebuild。
- 安装、覆盖安装和卸载。
- 用户数据保留策略。
- 更新与回滚机制。
- 代码签名接口和 SmartScreen 说明。

测试：中文用户名、中文/空格路径、普通用户权限、只读目录、覆盖安装、卸载、Windows Defender。

正式产物：

```
ZJ-1.0.0-win-x64-setup.exe
ZJ-1.0.0-win-x64-portable.exe
```

## 十一、最终交付物

- Electron Main/Preload/Renderer。
- React 正式产品界面。
- SidecarManager。
- Terminal 和 SFTP 界面。
- Approval Center、ChangeSet 页面。
- 首次启动、设置、错误恢复、日志导出。
- Logo、Icon、启动页和 About 页面。
- NSIS、Portable 构建。
- Electron E2E 和打包文档。

## 十二、验收标准

- [ ] Renderer 没有 Node 权限。
- [ ] 高权限能力只经白名单 IPC。
- [ ] `zj-core.exe` 崩溃后有明确恢复路径。
- [ ] 安装版和 Portable 版在干净 Windows 冷启动。
- [ ] Terminal 大输出不会卡死 UI。
- [ ] 审批页面展示真实操作、风险和回滚。
- [ ] 无 Docker和无模型配置时进入可理解的降级状态。
- [ ] 数据目录不可写时提供可执行修复方案。
- [ ] 用户可通过 UI 完成完整 Incident 闭环。

## 十三、对其他成员的接口

- 消费 A 的 REST API、Schema、Timeline WebSocket、健康和 Shutdown API。
- 消费 C 的 Terminal/SFTP 事件和执行状态。
- 向 D 提供可自动化的 UI、稳定 Selector 和测试构建。
- 接收 D 的风险文案、E2E 场景、报告字段和发布清单。