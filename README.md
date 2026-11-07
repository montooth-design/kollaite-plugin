# Kollaite for Claude Code

Pick up plans your team approved in [Kollaite](https://montoothdesign.com), build them in your own Claude Code, and hand back the pull request.

## Install

```bash
claude plugin marketplace add montooth-design/kollaite-plugin
```

Then, in Claude Code:

```
/plugin install kollaite@kollaite
```

It asks for two values from Kollaite's **Settings › Developer**: the **MCP server** address and a **personal access token** (stored in your system's credential store).

## Use

- `/kollaite:work`: plans ready for engineering, plans you picked up, and people's tasks for your roles
- `/kollaite:pickup 12`: read plan 12, check out its branch, build it task by task (`T-n: …` commits), run the checks, open the pull request and submit it (`12.2` = epic 2 of plan 12)

Or just ask: "what's ready in Kollaite?", "pick up plan 12".

## What it sends

- Everything the tools do, as you: picking up a plan, task status, questions and replies in the plan's discussion, the pull request URL.
- After each reply, in sessions that worked on a plan: the session's token counts per model, so the plan shows its engineering cost. No prompts, code or file names.

Works in other MCP clients (Cursor, Codex) too: add the MCP server with the header `Authorization: Bearer <token>`. The skills are Claude Code only.
