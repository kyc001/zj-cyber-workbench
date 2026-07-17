# 真君操作手册

## 1. 启动

开发模式在项目根目录运行：

```powershell
./scripts/dev.ps1 ui
```

打开 `http://127.0.0.1:5173/playground`。网页无法打开时，先运行 `./scripts/dev.ps1 doctor`，再检查 5173 和 8000 端口是否被占用。

## 2. 配置 Provider

进入“系统配置”，填写 OpenAI-compatible Base URL、API Key 和模型名。Key 只应存放在本机配置中；不得粘贴到对话、报告、Issue 或 Git。D 组自动化测试使用 Mock Model，不需要真实 Key。

## 3. 创建授权任务

1. 创建 Work Project。
2. 写明授权编号、目标、环境、允许动作、时间窗口和风险上限。
3. 绑定本机或 SSH 执行工作区。
4. 从项目创建会话，再进入 Playground。

普通聊天会话不能代替正式 Project Scope。发现目标不在 Scope、Host Key 变化或授权已过期时，应停止操作。

## 4. 诊断与变更

- 先执行只读诊断并确认证据。
- 修复 Agent 应生成包含 Precheck、Backup、Apply、Verify 和 Rollback 的 ChangeSet。
- 对授权弹窗核对目标、动作、风险和参数；不确定时选择拒绝。
- 执行后由 Verification Agent 重新读取目标状态，不直接采信修复结论。

## 5. 报告与审计

导出的报告应包含 Scope、Timeline、Finding、Approval、Execution、Artifact、ChangeSet、验证结论和遗留风险。发布或共享前删除凭据、Token、私钥、Cookie 和不必要的个人信息。

## 6. 停止与恢复

“停止生成”中断当前 Agent 回合；“取消全部任务”同时取消子 Agent 和异步任务。异常退出后重新启动应用并检查会话、Timeline 和任务终态，不能把中断状态当作成功。

## 7. D 组验收入口

```powershell
pnpm test:d-runtime
pnpm test:d-web
```

完整发布还必须验证真实 Provider、受控 SSH 靶场、Electron Portable EXE 和干净 Windows VM。
