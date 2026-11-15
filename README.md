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

## Your Claude plan

The plugin runs in your own Claude Code, so building a plan uses your Claude plan (Pro or Max) or your own API key. Kollaite never charges for it. Building a whole plan is a lot of work for the agent: on Pro it can reach your usage limit, so for big plans use Max, or Sonnet (`/model sonnet`), which goes further than Opus.

## What it sends

- Everything the tools do, as you: picking up a plan, task status, questions and replies in the plan's discussion, the pull request URL.
- After each reply, in sessions that worked on a plan: the session's token counts per plan and model, and whether it ran on a Claude plan or an API key, so each plan shows its engineering usage (tokens on a Claude plan, the estimated cost on an API key). No prompts, code or file names.

Works in other MCP clients (Cursor, Codex) too: add the MCP server with the header `Authorization: Bearer <token>`. The skills are Claude Code only.
