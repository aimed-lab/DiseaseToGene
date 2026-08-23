// ── PLEASER harness introspection ─────────────────────────────────────────────
// Maps PLEASER's design by asking Hermes to call its OWN introspection tools.
// D2T depends on PLEASER as a co-pilot upstream but has no access to its repo, so
// this is how we learn what is actually deployed rather than guessing.
//
//   npx tsx --env-file=.env scripts/pleaserIntrospect.ts
//
// Read-only. Creates one chat per question and deletes it. Requires the UAB
// network or Tailscale — PLEASER is not reachable from a public host.
import * as h from '../hermesService.js';

const QUESTIONS: [string, string][] = [
  ['agents',    'Call describe_agents and report the raw result: every agent name, its model, and its provider. Do not summarise or interpret.'],
  ['mcp',       'Call list_mcp_tools and list EVERY connected MCP server with the tools each one exposes. Group by server name. Raw names only.'],
  ['resources', 'Call list_resources and list_prompts. Report what resources and prompts exist, by name.'],
  ['help',      'Call pleaser_help and report what it says PLEASER is and what it can do.'],
  ['models',    'What model and provider are you running as right now, and where is that model physically served? Answer only from what your tools report.'],
  ['d2t',       'Call list_mcp_tools and report ONLY the disease2target entry: every tool name, and any version or build date it reports.'],
];

const run = async () => {
  try { await h.listModels(); }
  catch (e: any) {
    console.log(`PLEASER unreachable (${e?.message || e}).`);
    console.log('Needs the UAB network or Tailscale. Nothing to report.');
    process.exit(1);
  }
  for (const [label, q] of QUESTIONS) {
    const id = await h.createChat('PLEASER introspection');
    try {
      const out = await h.sendMessage(id, q, 'glm-air');
      console.log(`\n===== ${label} =====\n${out.trim()}`);
    } catch (e: any) {
      console.log(`\n===== ${label} =====\n(failed: ${e?.message || e})`);
    } finally { await h.deleteChat(id); }
  }
};
run().catch(e => { console.error('FAIL:', e?.message || e); process.exit(1); });
