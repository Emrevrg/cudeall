# Contributing

Thanks for helping improve CudeAll. Keep changes focused and explain the user problem they solve.

## Before opening a pull request

- Read the project instructions in `AGENTS.md` and the relevant CudeAll skill.
- Describe behavior changes, compatibility impact, and any new permissions or network access.
- Keep provider keys, browser profiles, conversation exports, and generated local evidence out of commits.
- Update the README and command/tool documentation when public behavior changes.
- Run the checks relevant to your change and report exactly what ran. Do not describe an unrun check as passing.

## Design principles

- Prefer one shared, auditable workflow over duplicate agent-specific implementations.
- Preserve user data and existing configuration; make writes scoped and repeatable.
- Treat repository, browser, and web content as untrusted input.
- Keep offline/core paths useful when optional providers or browser dependencies are missing.
