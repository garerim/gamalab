# Privacy Policy — GamaLab

**Last updated:** May 24, 2026
**Effective date:** May 24, 2026

GamaLab ("the app", "we", "us") is a desktop PostgreSQL client developed by **Gama EI** (France). This Privacy Policy explains what data the app handles, where it is stored, and the limited circumstances in which information leaves your device.

> **TL;DR — GamaLab is a local-first application. We do not run a backend, we do not collect telemetry, and we do not have access to your databases, connection credentials, or queries.**

---

## 1. Data the app stores on your device

GamaLab stores the following information **locally** on your computer, inside the standard Electron user-data directory of your operating system (e.g. `%APPDATA%\GamaLab` on Windows). This data **never leaves your device** unless you explicitly trigger an action that requires it (see Section 3).

| Data | Purpose | Storage |
|------|---------|---------|
| Database connection settings (host, port, database, username) | Reconnecting to your databases | Local file |
| Database passwords | Reconnecting without re-entering credentials | Local file, **encrypted at rest** using the operating system's keychain via Electron's `safeStorage` API |
| Saved SQL queries / snippets | Personal query library | Local file |
| Open tabs and editor state | Restoring your workspace at launch | Local file |
| UI preferences (theme, layout) | Personalization | Local file |
| AI provider API keys (if you enable the AI Assistant — BYOK) | Calling the LLM provider on your behalf | Local file, **encrypted at rest** |

You can delete all locally stored data at any time by removing the GamaLab user-data folder, or by using the in-app "Remove" actions in Settings.

## 2. Data we do NOT collect

We want to be explicit: GamaLab does **not** collect, transmit, or store any of the following on remote servers controlled by us:

- Your database content, schema, or query results
- Your connection credentials or passwords
- Your saved queries
- Usage analytics, telemetry, crash reports, or session recordings
- IP address, device identifier, or any other identifying information

GamaLab does not operate any backend service. There is no GamaLab account to create, no sign-in, no user database.

## 3. Third-party services (only when you opt in)

GamaLab integrates with third-party services **only when you explicitly choose to use them**. In these cases, data is sent directly from your device to the third party — we do not act as an intermediary and we do not receive a copy.

### 3.1 AI Assistant (optional, BYOK)

If you enable the AI Assistant feature and configure your own API key (Bring Your Own Key), the following happens when you submit a natural-language prompt:

- Your prompt, the relevant database schema context, and your selected model are sent **directly from your device to the AI provider** you chose (e.g. Anthropic, OpenAI).
- Your API key is used to authenticate the request. The key is stored locally and encrypted (see Section 1).
- The provider's response (a generated SQL query) is returned to your device.

The handling of these requests is governed by the privacy policy of the AI provider you select:

- Anthropic — https://www.anthropic.com/legal/privacy
- OpenAI — https://openai.com/policies/privacy-policy

GamaLab does not see, log, or store these requests on any server.

### 3.2 Database servers

When you connect to a PostgreSQL database, GamaLab establishes a direct connection from your device to the database host you configured. No traffic is routed through us.

### 3.3 Docker (optional)

If you use GamaLab's Docker integration to manage local PostgreSQL containers, the app communicates only with the Docker daemon running on your machine.

## 4. Updates

GamaLab is distributed as source code on GitHub and as pre-built installers on the [GitHub Releases](https://github.com/garerim/gamalab/releases) page. GamaLab itself does not phone home to check for updates; you upgrade by downloading a new release manually.

## 5. Children's privacy

GamaLab is a professional developer tool and is not directed at children under 13. We do not knowingly collect any data from any user, including children.

## 6. Your rights (GDPR)

Because GamaLab does not collect or process personal data on remote servers, there is no central record for us to access, modify, or erase on your behalf. You retain full control over all data stored locally on your device.

If you contact us by email, we will retain that email solely to respond to you, and you may request its deletion at any time.

## 7. Changes to this policy

We may update this policy to reflect new features or legal requirements. Material changes will be announced in the app's release notes. The current version is always available at the URL listed below.

## 8. Contact

For privacy questions or concerns, contact:

**Gama EI**
Email: contact@gamalab.dev
Website: https://gamalab.dev

---

*Canonical version of this policy: https://gamalab.dev/privacy*
*This policy is published as plain Markdown in the [GamaLab repository](https://github.com/garerim/gamalab/blob/main/PRIVACY.md) and mirrored on the GamaLab website.*
