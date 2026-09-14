# Security Policy

## Supported versions

GamaLab is under active early development. Only the latest release receives security fixes.

| Version | Supported          |
| ------- | ------------------ |
| Latest  | ✅                 |
| Older   | ❌                 |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

If you believe you have found a security issue in GamaLab — for example:

- A way to bypass Electron's context isolation or IPC boundary
- A path to exfiltrate connection passwords or AI keys from the encrypted store
- A dependency vulnerability with a working exploit against GamaLab
- Any other issue that could compromise user data or systems

please report it privately by one of the following channels:

- **Email**: contact@gamalab.dev with subject line `[SECURITY] <short summary>`
- **GitHub Security Advisories**: [Report a vulnerability](https://github.com/garerim/gamalab/security/advisories/new) (preferred — creates a private advisory)

## What to include

A useful report contains:

1. A clear description of the vulnerability and its impact
2. Steps to reproduce (or a proof-of-concept)
3. The affected version(s) of GamaLab
4. Your operating system and Electron version, if relevant
5. Any suggested fix or mitigation, if you have one

## What to expect

- **Acknowledgement** within 72 hours
- **Initial assessment** within 7 days
- **Fix and disclosure timeline** communicated once the issue is understood
- **Credit** in the release notes and security advisory, if you want it

I ask that you give a reasonable window to ship a fix before public disclosure. As a solo-maintained project, response times may vary, but I take security reports seriously.

## Scope

**In scope**
- The GamaLab desktop application itself
- The Electron main process, preload bridge, and renderer
- The `window.gamalab.*` IPC surface
- Local credential storage and encryption
- The AI provider integration

**Out of scope**
- Vulnerabilities in upstream dependencies without a demonstrable impact on GamaLab
- Issues that require an attacker to already have local admin access to the user's machine
- Third-party services GamaLab connects to (Anthropic, OpenAI, PostgreSQL, Docker) — report those directly to the vendor
- Social engineering, phishing, or physical attacks

Thank you for helping keep GamaLab users safe.
