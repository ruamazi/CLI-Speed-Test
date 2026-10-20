# Security Policy

## Supported versions

| Version | Supported |
| :-----: | :-------: |
| 1.x     | Yes       |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Include the affected version, Node.js version, operating system, a
   reproduction, and the potential impact.

If private reporting is not enabled, open a minimal issue asking the
maintainers to provide a private channel. Do not include exploit details in
that public issue.

Please redact personal information such as public IP addresses, ISP details,
tokens, and logs that contain them.

## Scope

This project makes HTTPS requests to Cloudflare and renders terminal output.
Reports are especially relevant for:

- Unsafe handling of network responses.
- Resource exhaustion that can be triggered remotely.
- Command injection or terminal control-sequence injection.
- Unintended disclosure of local data by the CLI.

Connection speed variation, Cloudflare rate limits, and the public IP/ISP/edge
details shown by design are not security vulnerabilities.

## Disclosure

Maintainers will acknowledge a report as soon as practical and will coordinate
a fix and disclosure timeline with the reporter.
