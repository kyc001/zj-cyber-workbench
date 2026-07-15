# C Module Change Log

This document records C module changes made during implementation and verification follow-up. Each entry lists what changed, why it changed, and the expected effect.

## 2026-07-15

### feat: add toolpack frontend entry (`4efddb4`)

- Added a Toolpack page at `/toolpack`.
- Added a frontend API wrapper for `/api/toolpack/tools`, tool runs, cancellation, and artifact download.
- Registered the Toolpack route in the admin router and left navigation.
- Added schema-driven input rendering so new backend Toolpack manifests can appear in the UI without one-off frontend pages.
- Added compact result rendering for run status, summary, stdout, parsed records, and artifacts.

Reason:
- Backend Toolpack APIs were present, but users had no direct frontend entry to discover and run the tools.

Effect:
- Users can run `local.httpx`, `local.dnsx`, `local.ffuf`, `ssh.nmap`, and `ssh.sqlmap` through the same backend execution gateway used by Agent paths.

### fix plan: first intuitive verification issues

- Normalize local smoke-test defaults from port `8765` to the actual API port `8000`.
- Normalize `ssh_command` audit targets so they do not produce values such as `ssh://ssh://127.0.0.1:2222:2222`.
- Make Toolpack SSH tool availability explicit when the selected workspace is local.

Reason:
- `docs/C-verification-2026-07-15.md` found these as direct, low-risk issues that cause confusing validation and UI behavior.

Effect:
- Verification steps should produce clearer evidence before moving to deeper Runtime Permission and SSH credential work.

### fix: align Toolpack UI defaults and SSH availability

- Changed Toolpack UI defaults for `local.httpx` and `local.ffuf` from `127.0.0.1:8765` to `127.0.0.1:8000`.
- Updated the Windows SSH handoff document smoke-test URLs to use port `8000`.
- Normalized Agent `ssh_command` targets before authorization and audit recording.
- Made SSH Toolpack tools return `available=false` with `Linux-heavy tools require an SSH workspace` when the selected workspace is local.
- Added unit tests for SSH target normalization and local-workspace SSH Toolpack availability.

Reason:
- Verification found direct evidence that port `8765` was stale, SSH audit targets had duplicate `ssh://` prefixes, and SSH tools were unclear in the Toolpack list.

Effect:
- Frontend smoke defaults match the actual development API port.
- SSH command audit records should use stable `ssh://host:port` targets.
- The Toolpack UI can disable SSH tools on local Windows workspaces before the user starts a run.

### fix: align execution audit reason codes with permission source

- Changed `service.runtime_permissions.require_permission()` to return the actual grant source.
- Updated `core.execution_guard` to write that source into `executions.jsonl.reason_codes`.
- Added a unit test proving an always-allow grant is audited as `["always_allow"]`, not `["user_approved"]`.

Reason:
- Verification found `permissions.jsonl.source="always_allow"` while `executions.jsonl.reason_codes=["user_approved"]`, which could mislead audit review.

Effect:
- Execution audit now distinguishes stored always-allow rules from one-time user approvals.

### feat: add first-stage operations Toolpack tools

- Added `local.webcheck` for bounded HTTP health checks.
- Added `local.tls.inspect` for TLS certificate and cipher inspection.
- Added `local.port.scan` for small TCP port probes with a maximum of 32 ports.
- Implemented the tools with Python standard library scripts executed through the existing sandbox command gateway.
- Added Toolpack UI defaults for the new tools.
- Added unit coverage for manifest exposure, port-count policy enforcement, and `local.webcheck` output parsing.

Reason:
- The next C module milestone is to make Toolpack useful as an operations toolbox, not only a security scanner launcher.

Effect:
- Users can run low-risk diagnostics directly from `/toolpack` without installing extra binaries beyond the local Python runtime.
- The new tools still use the same Toolpack `ExecutionResult`, timeout, cancellation, artifact, and parsing path.

## Deferred Items

### D-TODO-1: L3 destructive pattern can be masked by always-allow in normal mode

Status: deferred.

Priority: P1 security hardening, not the next implementation blocker.

Reason:
- This is a real safety boundary issue, but it mainly affects cases where a user or prior workflow has already granted `always_allow` for a broad action such as `workspace.command.execute`.
- Most normal Toolpack and diagnostic flows do not depend on arbitrary destructive shell commands.
- Fixing it requires changing Runtime Permission precedence, so it should be handled with focused tests rather than mixed into tool expansion work.

Expected future behavior:
- In `mode=normal`, known L3 destructive patterns such as `rm -rf`, `Remove-Item -Recurse -Force`, `del /f /q`, `Format-Volume`, and `diskpart` should require a fresh approval even if a broad always-allow rule exists.
- In `mode=full_access`, current direct execution behavior may remain unchanged.

Next action when resumed:
- Add a destructive-pattern classifier near the execution guard.
- Check L3 destructive patterns before applying always-allow.
- Add tests for `always_allow + L3 command => pending approval`.
