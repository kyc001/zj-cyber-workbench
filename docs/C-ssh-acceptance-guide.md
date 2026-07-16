# C 模块 SSH 验收使用说明

本说明用于模拟普通用户从前端完成完整链路：

1. 注册 SSH 主机。
2. 信任 SSH Host Key。
3. 创建 SSH Workspace。
4. 手动打开 SSH Shell。
5. 通过 Toolpack 运行 SSH 工具。
6. 在 Playground 中让 Agent 通过同一个 SSH Workspace 执行 SSH 命令。

本文不记录 SSH 密码、token、私钥。开发测试密码请从本机安全位置或既有交接文档读取，不要粘贴进 Agent 对话或测试报告。

## 1. 启动

在仓库根目录分别启动后端和前端：

```powershell
cd D:\zj-cyber-workbench
.\scripts\dev.ps1 backend
```

另开一个 PowerShell：

```powershell
cd D:\zj-cyber-workbench
.\scripts\dev.ps1 web
```

浏览器打开：

```text
http://127.0.0.1:5173
```

快速开发模式也可以直接运行：

```powershell
cd D:\zj-cyber-workbench
.\scripts\dev.ps1 ui
```

后端健康检查：

```text
http://127.0.0.1:8000/health
```

## 2. 准备 SSH 测试主机

推荐使用 WSL SSH 测试主机。若 Windows 直连 WSL IP 不稳定，先在管理员 PowerShell 中配置 portproxy，把 `127.0.0.1:2222` 转发到当前 WSL IP 的 `2222`。

前端注册主机时推荐使用：

```text
IP: 127.0.0.1
SSH Port: 2222
SSH Account: zj_sandbox
SSH Password: 使用本机开发测试密码，不写入文档或对话
```

如果不用 portproxy，也可以使用当前 WSL IP 和 `2222`。

## 3. 注册 SSH 主机

1. 打开左侧导航的“主机管理”。
2. 点击“添加主机”。
3. 填写 IP、SSH 端口、账号、密码。
4. 保存后确认列表里出现该主机，且“密码”列显示已配置。

## 4. 信任 SSH Host Key

1. 在“主机管理”列表中找到刚添加的 SSH 主机。
2. 点击盾牌图标。
3. 前端会读取当前服务器 SSH Host Key，并显示：
   - Endpoint
   - 算法
   - SHA256 指纹
   - 公钥
4. 人工确认指纹是当前测试主机的指纹后，点击“信任当前指纹”。
5. 再次打开 SSH Shell 时不应出现 host key 未信任错误。

注意：这是显式人工信任，不是 Agent 自动接受。后续如果服务器 Host Key 变化，命令和 Toolpack 仍应被阻断，需要用户重新确认。

## 5. 手动运行 SSH 命令

在“主机管理”中点击终端图标，打开 Host Shell，输入：

```bash
whoami
hostname
pwd
```

预期：

- `whoami` 输出测试账号。
- `hostname` 有输出。
- `pwd` 位于远端用户目录或 SSH 登录默认目录。

## 6. 创建 SSH Workspace

方式 A：从 Playground 创建。

1. 打开“Playground”。
2. 顶部工作区选择器旁点击“创建执行工作区”。
3. “运行主机”选择刚添加的 SSH 主机。
4. “工具基线”选择可用基线。
5. 网络出口使用“直连”。
6. 创建后，选择该工作区，并确保状态为运行中。

方式 B：从“执行工作区”页面创建。

1. 打开“执行工作区”。
2. 点击创建。
3. 主机选择刚添加的 SSH 主机。
4. 工具基线选择可用基线。
5. 创建并启动。

## 7. 手动运行 Workspace 命令

在 Playground 顶部选择 SSH Workspace 后，点击终端图标打开 Workspace Shell，输入：

```bash
pwd
whoami
uname -a
```

预期：

- 命令在远端 SSH Workspace 中执行。
- 当前目录应在远端 `.zj/sandboxes/<workspace_id>/workspace` 下。

## 8. 手动运行 Toolpack

打开“Toolpack”页面：

1. 顶部选择 SSH Workspace。
2. 选择“SSH/Linux”分组。
3. 运行 `ssh.nmap`：

```text
target: 127.0.0.1
```

预期：

- 工具状态变为 completed。
- `ok=true` 或返回 nmap 合理退出码。
- 输出中有端口扫描结果。

继续运行 `ssh.sqlmap` 时，请只使用课程实验环境中的靶场 URL，不要对生产或第三方目标运行。

## 9. Agent 通过同一主机执行 SSH 命令

关键点：Agent 会复用当前会话绑定的 SSH Workspace Managed Host 凭据。不要在提示词里输入 SSH 密码。

1. 打开“Playground”。
2. 顶部选择刚创建的 SSH Workspace。
3. 新建对话。
4. 输入类似提示：

```text
请通过当前 SSH Workspace 连接绑定的 SSH 主机，运行只读诊断命令：
whoami && hostname && uptime

不要询问或输出 SSH 密码。使用当前工作区绑定主机，调用 ssh_command 时不要传 credential_ref，target 可以省略。
```

5. 如果出现权限授权弹窗，确认这是 `ssh.command` 且目标是刚注册的 SSH 主机后允许。

预期：

- Agent 调用 `ssh_command`。
- 返回 JSON 中 `ok=true`，`exit_code=0`。
- 输出包含 `whoami`、`hostname`、`uptime` 的结果。
- 对话、日志、artifact 中不出现 SSH 密码。

## 10. 最小验收判定

C 模块当前核心流程可以认为通过，当以下结果都成立：

- 前端可添加 SSH Managed Host。
- 前端可显式信任 Host Key。
- 前端可创建并选择 SSH Workspace。
- Host Shell 可手动执行远程命令。
- Workspace Shell 可在远端工作目录执行命令。
- Toolpack 可在 SSH Workspace 中运行 `ssh.nmap`。
- Agent 在绑定 SSH Workspace 后，可经授权调用 `ssh_command` 执行远程只读命令。
- SSH 密码不需要输入到 Agent 对话，也不出现在结果、日志或 artifact 中。
