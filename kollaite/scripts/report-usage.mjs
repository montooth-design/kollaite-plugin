#!/usr/bin/env node
// Kollaite plugin, Stop hook: report this session's token totals per model to
// the Kollaite plan it worked on (report_usage on the Kollaite MCP server).
// Only sessions that picked up or worked on a plan are reported; nothing else
// leaves the machine — no prompts, code or file names, just token counts.
// Each report holds the session's totals so far and replaces the last one.
// Never fails the session: any problem exits quietly.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const WORK_TOOLS = /kollaite.*__(start_plan|update_task|submit|ask|reply)$/;

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

function read(files) {
  const messages = new Map(); // message id → { model, usage, at }
  let plan = null;
  let at = null;
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
      if (entry?.type !== "assistant" || !m) continue;
      // A response is written once per content block, with the same id and usage.
      if (m.id && m.usage && m.model && m.model !== "<synthetic>") messages.set(m.id, { model: m.model, usage: m.usage });
      if (entry.timestamp && (!at || entry.timestamp > at)) at = entry.timestamp;
      for (const block of Array.isArray(m.content) ? m.content : []) {
        if (block?.type === "tool_use" && WORK_TOOLS.test(block.name ?? "") && typeof block.input?.plan === "string") plan = block.input.plan;
      }
    }
  }
  const models = new Map();
  for (const { model, usage } of messages.values()) {
    const t = models.get(model) ?? { model, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, messages: 0 };
    t.input_tokens += usage.input_tokens ?? 0;
    t.output_tokens += usage.output_tokens ?? 0;
    t.cache_read_tokens += usage.cache_read_input_tokens ?? 0;
    t.cache_write_tokens += usage.cache_creation_input_tokens ?? 0;
    t.messages += 1;
    models.set(model, t);
  }
  return { plan, at, models: [...models.values()] };
}

async function main() {
  const url = process.env.CLAUDE_PLUGIN_OPTION_SERVER_URL;
  const token = process.env.CLAUDE_PLUGIN_OPTION_TOKEN;
  if (!url || !token) return;
  const input = await stdin();
  if (!input.session_id || !input.transcript_path) return;
  const { plan, at, models } = read(transcripts(input.transcript_path));
  if (!plan || !models.length) return;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "report_usage", arguments: { session_id: input.session_id, plan, models, ...(at ? { ended_at: at } : {}) } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
}

main().catch(() => {});
