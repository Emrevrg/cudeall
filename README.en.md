# CudeAll — one durable workflow for coding agents

[Türkçe](README.md) · [License](LICENSE) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

![CudeAll social preview](assets/cudeall-social-preview.svg)

CudeAll brings project context, persistent work tracking, verification evidence, and agent handoffs into one local workflow shared by OpenCode, Codex, Claude Code, and Cude Desktop. Its goal is not to maximize tool count: it keeps work recoverable across sessions and offers progressively simpler fallbacks when optional tools are unavailable.

## Why CudeAll

- **One shared project spine:** context, tasks, plans, decisions, evidence, and handoffs live in the selected project.
- **Cross-agent continuity:** compatible tools can read the same task record and hand off unfinished work.
- **Progressive fallbacks:** web and browser workflows can use optional providers and browser engines, then fall back to simpler paths.
- **Local-first core:** the MCP server uses Node.js built-ins; browser automation is optional.
- **Scoped permissions:** browser/desktop control, setup, automation, and other write-capable tools should be approval-gated in the host.

## Components

| Component | Purpose |
| --- | --- |
| OpenCode plugin and skill | Workflow guidance, session context, and MCP-independent fallback tools |
| CudeAll MCP server | 14 tools for project context, web, browser, desktop, memory, automation, QA, history, and orchestration |
| Project spine | Durable tasks, plans, decisions, verification evidence, and handoffs shared across sessions |
| Cude Desktop | Optional desktop shell with chat, editor, agent, and computer-use modes |
| Chrome extension | Optional bridge to a dedicated CudeAll tab group in the user's Chrome |

## Requirements

- Node.js 18 or newer for the MCP server.
- OpenCode for the included OpenCode integration. Other host integrations are optional.
- Windows for the provided one-click installer and Cude Desktop workflows documented here.
- Playwright/Chromium and search API keys are optional; the core starts without them.

## Quick start (OpenCode)

1. Clone the repository and open its folder in OpenCode.
2. Confirm `opencode.json` points to `mcp-cudeall/server.mjs` relative to the workspace. If your host uses another working directory, configure an absolute path.
3. Start OpenCode and call `cude_setup(action=status)` to see available capabilities.
4. Call `cude_spine(action=context)` to create a bounded project summary, then `cude_task(action=start, objective="...")` to track substantial work.

On Windows, `kurulum.bat` provides an interactive installer. Review the configuration changes it makes before using it on a machine with an existing OpenCode setup. It creates a backup of the selected global config.

## Durable work loop

1. Read the project context and existing task/handoff queue.
2. Start a task and record the plan and decisions.
3. Attach outputs and verification evidence to the task.
4. Complete only after a successful task-linked evidence record and a verification note.
5. Write a handoff when another session or agent should continue.

Manual inspection can be recorded without an exit code; command evidence should include its actual exit code. Do not claim that tests or checks ran when they did not.

## Optional integrations

- Install `chrome-extension/` as an unpacked Chrome extension for the CudeAll tab-group workflow.
- Install Playwright and Chromium only if you need the optional real-browser fallback.
- Set `TAVILY_API_KEY` or `BRAVE_API_KEY` in the environment for provider-backed search. CudeAll also has a keyless search fallback.
- `cude-desktop/` is an optional desktop application; see its README for its current platform and runtime limits.

## Security and limits

Review [SECURITY.md](SECURITY.md) before reporting a vulnerability. Public pages and repository content are untrusted input. Do not commit provider credentials, browser session data, local evidence logs, or personal conversation exports. See the Turkish README for the full tool reference and installation details.

## Contributing

Focused bug reports and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and report which checks you ran.
