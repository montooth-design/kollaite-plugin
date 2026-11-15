#!/usr/bin/env node
// Kollaite plugin, Stop hook: report this session's token totals per model to
// the Kollaite plans it worked on (report_usage on the Kollaite MCP server).
// Only sessions that picked up or worked on a plan are reported; nothing else
// leaves the machine — no prompts, code or file names, just token counts, and
// whether the session ran on a Claude plan (Pro / Max) or an API key.
// Each response counts for the plan being worked on at that point, so one
// session can report several plans. Each report holds the session's totals so
// far and replaces the last one. Never fails the session: any problem exits quietly.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const WORK_TOOLS = /kollaite.*__(start_plan|update_task|submit|ask|reply)$/;
// Reading a plan counts for it too, once the session works on it.
const PLAN_TOOLS = /kollaite.*__(get_plan|start_plan|update_task|submit|ask|reply|read_discussion)$/;

async function stdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data || "{}");
}

/** The main transcript plus its subagents' (<session>/subagents/*.jsonl). */
function transcripts(path) {
  const files = [path];
  const dir = join(path.replace(/\.jsonl$/, ""), "subagents");
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (f.endsWith(".jsonl")) files.push(join(dir, f));
  return files;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * "api" when Claude Code bills per token (an API key, a key helper, a gateway,
 * Bedrock, Vertex or Foundry), otherwise "plan": a claude.ai login on Pro or Max.
 */
function billing(cwd) {
  const settings = [join(homedir(), ".claude", "settings.json")];
  if (cwd) settings.push(join(cwd, ".claude", "settings.json"), join(cwd, ".claude", "settings.local.json"));
  const envs = [process.env];
  for (const path of settings) {
    const s = readJson(path);
    if (s?.apiKeyHelper) return "api";
    if (s?.env) envs.push(s.env);
  }
  return envs.some(perToken) ? "api" : "plan";
}

function perToken(e) {
  if (e.ANTHROPIC_API_KEY || e.ANTHROPIC_AUTH_TOKEN) return true;
  if (e.CLAUDE_CODE_USE_BEDROCK || e.CLAUDE_CODE_USE_VERTEX || e.CLAUDE_CODE_USE_FOUNDRY) return true;
  // A gateway or proxy; the desktop app sets Anthropic's own address, which says nothing.
  if (e.ANTHROPIC_BASE_URL) {
    try {
      return new URL(e.ANTHROPIC_BASE_URL).hostname !== "api.anthropic.com";
    } catch {
      return true;
    }
  }
  return false;
}

function read(files) {
  const responses = new Map(); // message id → { model, usage, at, plans: plan names its tool calls named }
  const worked = new Set();
  let ended = null;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.includes('"assistant"')) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const m = entry?.message;
      if (entry?.type !== "assistant" || !m?.id) continue;
      if (entry.timestamp && (!ended || entry.timestamp > ended)) ended = entry.timestamp;
      // A response is written once per content block, with the same id and usage.
      const r = responses.get(m.id) ?? { model: null, usage: null, at: entry.timestamp ?? "", plans: [] };
      if (m.usage && m.model && m.model !== "<synthetic>") {
        r.model = m.model;
        r.usage = m.usage;
      }
      for (const block of Array.isArray(m.content) ? m.content : []) {
        const plan = block?.type === "tool_use" && typeof block.input?.plan === "string" ? block.input.plan : null;
        if (!plan) continue;
        if (PLAN_TOOLS.test(block.name ?? "")) r.plans.push(plan);
        if (WORK_TOOLS.test(block.name ?? "")) worked.add(plan);
      }
      responses.set(m.id, r);
    }
  }
  if (!worked.size) return { ended, plans: [] };

  // In time order, each response counts for the plan in hand; responses before the first count for it.
  const ordered = [...responses.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let current = null;
  const pending = [];
  const byPlan = new Map(); // plan → Map(model → totals)
  const count = (plan, r) => {
    const models = byPlan.get(plan) ?? new Map();
    const t = models.get(r.model) ?? { model: r.model, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, messages: 0 };
    t.input_tokens += r.usage.input_tokens ?? 0;
    t.output_tokens += r.usage.output_tokens ?? 0;
    t.cache_read_tokens += r.usage.cache_read_input_tokens ?? 0;
    t.cache_write_tokens += r.usage.cache_creation_input_tokens ?? 0;
    t.messages += 1;
    models.set(r.model, t);
    byPlan.set(plan, models);
  };
  for (const r of ordered) {
    const named = r.plans.filter((p) => worked.has(p));
    if (named.length) {
      current = named[named.length - 1];
      for (const p of pending.splice(0)) count(current, p);
    }
    if (!r.usage) continue;
    if (current) count(current, r);
    else pending.push(r);
  }
  return { ended, plans: [...byPlan].map(([plan, models]) => ({ plan, models: [...models.values()] })) };
}

async function main() {
  const url = process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL;
  const token = process.env.CLAUDE_PLUGIN_OPTION_TOKEN;
  if (!url || !token) return;
  const input = await stdin();
  if (!input.session_id || !input.transcript_path) return;
  const { ended, plans } = read(transcripts(input.transcript_path));
  if (!plans.length) return;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "report_usage",
        arguments: { session_id: input.session_id, billing: billing(input.cwd), plans: plans.slice(0, 10), ...(ended ? { ended_at: ended } : {}) },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
}

main().catch(() => {});
