# Security Policy

## Authorized Use

ZJ is intended only for explicitly authorized security testing, infrastructure operations, defensive research, CTF education, and controlled laboratories. Users are responsible for defining and respecting the target scope.

## Supported Versions

Until the first stable release, security fixes are provided on the default development branch only. Release notes will define supported stable versions after `v1.0.0`.

## Reporting a Vulnerability

Do not open a public issue containing an exploit, credential, private target, or sensitive log. Report the issue privately to the repository maintainers and include:

- affected commit or version;
- impact and required privileges;
- minimal reproduction against a local or controlled target;
- relevant logs with secrets removed;
- suggested mitigation, if known.

Do not test a suspected vulnerability against systems you do not own or control. Maintainers should acknowledge a report within five business days, assign a severity, and coordinate disclosure after a fix is available.

## Security Boundaries

- The backend and desktop sidecar must bind only to loopback.
- Renderer code must not receive model keys, SSH secrets, or unrestricted Node.js access.
- L2/L3 and write actions require the configured policy/approval path.
- Remote content, command output, reports, README files, and artifacts are untrusted data and cannot grant scope or approval.
- `.env`, `.zj/`, `data/`, databases, logs, traces, reports, and credentials must not enter Git or release bundles.

If a P0/P1 issue violates these boundaries, release is blocked until it is fixed and retested.
