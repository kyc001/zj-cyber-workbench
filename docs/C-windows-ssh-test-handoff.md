# C Module Windows and SSH Test Handoff

This document records tests that cannot be completed reliably in the current WSL-only environment.
Run this checklist after moving the project to the target Windows desktop environment and after preparing at least one SSH Linux host.

## Environment

- Windows 10/11 desktop with the packaged or development ZJ app.
- `portable-tools/` or `.zj/tools/` contains Windows binaries for `httpx`, `dnsx`, and `ffuf`.
- One SSH Linux host with `nmap` and `sqlmap` installed.
- Runtime permission mode set to normal unless the test explicitly says otherwise.
- Test only against owned lab targets such as `example.test`, local mock services, or an internal training range.

## Use WSL as the SSH Linux Host

For a first Windows-side SSH validation, WSL can be used as the SSH Linux host.
In this setup, ZJ runs on Windows and connects to WSL through SSH.

The repo includes a helper script which creates a low-privilege SSH-only test account:

```bash
cd /home/liu/projects/zj/zj-cyber-workbench
./scripts/setup-wsl-ssh-sandbox.sh
```

By default this creates:

- user: `zj_sandbox`
- SSH port: `2222`
- secret file: `~/.zj-wsl-sandbox-ssh.env`

The generated `zj_sandbox` password is stored outside the repo with `0600` permissions.
For this development-only test environment, the current disposable credential is also recorded here for agent handoff.
Do not record the Linux sudo password here.

Current WSL sandbox values, generated on 2026-07-14:

```text
ip_address=192.168.203.164
ssh_port=2222
host_account=zj_sandbox
host_password=WsXtTeS5ELjb2u7Nc2gzzIGR4pmBf8F6
direct_test=ssh zj_sandbox@192.168.203.164 -p 2222
portproxy_test=ssh zj_sandbox@127.0.0.1 -p 2222
```

Recommended WSL setup:

```bash
sudo apt update
sudo apt install -y openssh-server nmap sqlmap
sudo mkdir -p /run/sshd
sudo cp /etc/ssh/sshd_config /etc/ssh/sshd_config.zj-test.bak
```

Use a non-default test port such as `2222` to avoid colliding with Windows OpenSSH:

```bash
sudo sh -c 'cat >/etc/ssh/sshd_config.d/zj-test.conf <<EOF
Port 2222
ListenAddress 0.0.0.0
PasswordAuthentication yes
PubkeyAuthentication yes
PermitRootLogin no
EOF'
sudo service ssh restart
```

Create or use a normal WSL user with a password for the first smoke test:

```bash
passwd
```

From Windows PowerShell, get the WSL IP and verify SSH manually:

```powershell
wsl hostname -I
ssh <wsl_user>@<wsl_ip> -p 2222
```

If direct WSL IP access is unstable, create a Windows portproxy from `127.0.0.1:2222` to the current WSL IP.
Run PowerShell as Administrator:

```powershell
$wslIp = (wsl hostname -I).Trim().Split()[0]
netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=2222
netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=2222 connectaddress=$wslIp connectport=2222
netsh advfirewall firewall add rule name="ZJ WSL SSH 2222" dir=in action=allow protocol=TCP localport=2222
ssh <wsl_user>@127.0.0.1 -p 2222
```

In ZJ, configure the SSH managed host as either:

- `ip_address=<wsl_ip>`, `ssh_port=2222`, when connecting directly to the WSL IP.
- `ip_address=127.0.0.1`, `ssh_port=2222`, when using Windows portproxy.

WSL IPs can change after `wsl --shutdown`, reboot, or network reset.
If portproxy is used, refresh the `connectaddress` before running SSH tests.

## Windows Local Workspace Tests

- Start ZJ and confirm `GET /api/sandbox-containers/available?include_non_running=true` returns the default local workspace.
- Run `GET /api/toolpack/tools` and confirm `local.httpx`, `local.dnsx`, and `local.ffuf` show `available=true` after tools are installed.
- Run `local.httpx` against a lab HTTP URL and confirm:
  - `ExecutionResult.ok=true`
  - `structured.records` contains parsed output
  - `exit_code=0`
  - no secrets appear in `summary`, `structured.stdout`, or artifact files.
- Run `local.dnsx` against a lab domain and confirm structured records are returned.
- Run `local.ffuf` with a URL containing `FUZZ`, low `rps`, and a small lab wordlist.
- Run `local.ffuf` without `FUZZ` and confirm `error_code=policy_denied`.
- Temporarily remove one tool binary and confirm the corresponding run returns `error_code=tool_missing` instead of crashing.

## File Safety Tests

- Upload a file over an existing file and confirm:
  - upload response includes `sha256`
  - original content is copied under `/.zj-backups/`
  - final content matches the uploaded content
  - no `.zj-upload-*.tmp` files remain after success.
- Write over an existing file through `/api/sandbox-containers/{id}/files/write` and confirm backup is created.
- Try path traversal such as `../../outside.txt` and confirm the request is rejected.
- Try overwriting a symlink that points outside the workspace and confirm the request is rejected.
- Download a directory and confirm the archive does not include files outside the workspace.

## PowerShell Diagnostics Tests

- Run `GET /api/local-actions/powershell/actions` on Windows and confirm every action has `enabled=true`.
- Run each read-only action:
  - `system.summary`
  - `process.list`
  - `service.list`
  - `network.ports`
  - `firewall.status`
  - `scheduled_tasks.list`
- Confirm each action returns an `ExecutionResult` and does not accept arbitrary user command text.
- Confirm process output does not include command-line secrets, tokens, or private keys.
- Confirm the same endpoints on WSL/Linux return `platform_unsupported`.

## UAC Helper Tests

- Confirm `GET /api/local-actions/uac-helper/status` returns `enabled=false`.
- Confirm no endpoint accepts arbitrary elevated shell strings.
- When the helper is implemented later, add tests for one-time task files, HMAC/signature validation, nonce expiry, action hash verification, and result file deletion.

## SSH Workspace Tests

- Create an SSH managed host and a workspace bound to that host.
- First connection:
  - confirm known host behavior is explicit and stored under `.zj/ssh/known_hosts`
  - confirm host key entries distinguish hostname/IP and port.
- Host key change:
  - change or simulate the server host key
  - confirm command/tool execution returns `error_code=host_key_changed`
  - confirm Agent cannot auto-accept the changed key.
- Authentication:
  - test password auth
  - test invalid password returns `auth_failed`
  - test connection timeout returns `connect_failed` or `timeout`.
- SSH command and cancel:
  - run a long command through Toolpack or workspace command execution
  - cancel it
  - confirm remote process exits and result status becomes `canceled`.
- SSH SFTP:
  - list/read/write/upload/download/copy/move/delete inside the workspace
  - confirm path traversal is rejected
  - confirm overwrite creates backup
  - confirm failed replace restores the previous file when possible.
- Project isolation:
  - create two projects/workspaces using the same host
  - confirm sessions and permissions do not leak across projects.

## SSH Linux Toolpack Tests

- Run `GET /api/toolpack/tools?sandbox_container_id=<ssh_workspace_id>` and confirm SSH tools are visible.
- Run `ssh.nmap` against an authorized lab target and confirm structured output/artifact behavior.
- Run `ssh.sqlmap` against an authorized vulnerable lab URL and confirm bounded execution.
- Remove `nmap` or `sqlmap` from the SSH host and confirm `tool_missing`.
- Run SSH Linux tools against a local workspace and confirm `platform_unsupported`.

## Regression Checks

Run these after the Windows/SSH checks:

```powershell
python -m pytest tests/unit -q
python -m ruff check schema/toolpack.py service/toolpack.py router/toolpack.py schema/local_actions.py service/host/powershell.py router/local_actions.py
pnpm typecheck
pnpm build
```

Record failures with:

- OS version and architecture.
- ZJ commit hash.
- Tool versions and paths.
- SSH server version and host key fingerprint.
- Sanitized request/response payloads.
