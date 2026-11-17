# Security Policy

## Supported Versions

Security fixes go into the latest release.

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please send an e-mail to the maintainers. All security vulnerabilities will be promptly addressed.

Please do **NOT** open an issue on GitHub for security vulnerabilities.

## Security review (2.0.0)

An independent security review of 2.0.0 found one high, three medium and six
low-severity issues (agent fraud guard bypass via recurring invoices, agent
control of automatically emailed content, anonymous email relay, telemetry
injection, idempotency-key squatting, implicit confirmation of agent-written
data, suspension bypass in account routes, weak `INITIAL_PASSWORD` / KDF,
weaponisable lockout, missing CSP). All are fixed in 2.0.0; see the
CHANGELOG ("Security") and the README section "Security model and known
limitations" for what is protected and what remains a limitation.
