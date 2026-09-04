// ── Hermes (PLEASER) chat backend ─────────────────────────────────────────────
// A second co-pilot upstream alongside Gemini. PLEASER exposes its agent through
// its own authenticated API, so no gateway is needed here: a permanent `pk_`
// connector token in the X-PLEASER-Session header is accepted by its require_auth,
// and /api/chats/* is the whole integration surface.
//
// Three properties of that API shape everything below (all verified live, 2026-08-21):
//
//  1. CONVERSATION STATE LIVES ON THE SERVER. Posting a message to an existing
//     chat id continues that conversation — a second turn quoted the first turn
//     back verbatim. So we do NOT resend the transcript each turn the way the
//     Gemini path does; we keep a chat id per co-pilot session and post only the
//     newest user turn.
//
//  2. THERE IS NO SYSTEM-PROMPT FIELD. Both `system` and `system_prompt` were
//     sent carrying a marker token; neither reached the model. D2T's system
//     instruction therefore goes in as an ordinary priming message when the chat
//     is created — which (1) makes cheap, since it is sent once per session
//     rather than once per turn.
//
//  3. REQUEST-LEVEL `tools` ARE IGNORED. PLEASER's _request_agent_overrides
//     honours provider / model / model_options and nothing else; `tools` is only
//     hashed into the idempotency fingerprint. Hermes answers from its own
//     toolset, so D2T's function declarations cannot be passed per request. The
//     caller must not send them, and must tell the user the co-pilot is
//     explain-only on this upstream. Giving Hermes tools needs an MCP server
//     Hermes connects to — a separate piece of work, not a flag.
//
// The token identifies ONE PLEASER account, so every D2T user's turns land in
// that account. We keep the blast radius small by deleting each chat when the
// session ends or goes idle (see reapIdleChats in server.ts).

const baseUrl = () => (process.env.PLEASER_BASE_URL || '').replace(/\/+$/, '');
const token = () => process.env.PLEASER_TOKEN || '';

/** Hermes is only offered when both halves are configured. */
export const hermesEnabled = (): boolean => Boolean(baseUrl() && token());

export interface HermesModel { id: string; label: string; }

// A first turn carries D2T's whole system instruction — ~24k characters of
// glossary and modality reference — and PLEASER replays it on every later turn.
// Measured against glm-air on ASC: 75s for that first turn, ~25s after. 120s was
// not enough and failed the user's very first message, so the ceiling is set well
// clear of the measurement rather than just above it.
const call = async (path: string, init: RequestInit = {}, timeoutMs = 240_000): Promise<any> => {
  if (!hermesEnabled()) throw new Error('PLEASER_BASE_URL / PLEASER_TOKEN not configured');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r: Response;
  try {
    r = await fetch(`${baseUrl()}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: {
        'X-PLEASER-Session': token(),
        'Content-Type': 'application/json',
        // Same lesson as Open Targets: some edges reject a fetch with no UA.
        'User-Agent': 'Disease2Target/1.0 (+https://github.com/aimed-lab/DiseaseToGene)',
        ...(init.headers || {}),
      },
    });
  } catch (e: any) {
    clearTimeout(timer);
    // Distinguish SLOW from UNREACHABLE. Conflating them sent users chasing a
    // network problem when the model was simply still thinking — the campus IP
    // does time out from off-network, but the Tailscale Funnel address does not,
    // and a big first turn legitimately takes over a minute.
    if (e?.name === 'AbortError') {
      throw new Error(`PLEASER did not answer within ${Math.round(timeoutMs / 1000)}s. The model is likely overloaded — try again, or switch to Gemini.`);
    }
    throw new Error(`Cannot reach PLEASER at ${baseUrl()}: ${e?.message || e}`);
  }
  clearTimeout(timer);
  const raw = await r.text();
  let d: any = null;
  try { d = raw ? JSON.parse(raw) : null; } catch { throw new Error(`PLEASER returned a non-JSON response (${r.status})`); }
  if (!r.ok) throw new Error(`PLEASER ${path} failed (${r.status}): ${d?.detail || d?.error || r.statusText}`);
  return d;
};

export const listModels = async (): Promise<HermesModel[]> => {
  const d = await call('/api/chats/models', { method: 'GET' }, 15_000);
  return Array.isArray(d) ? d.filter(m => m?.id).map(m => ({ id: String(m.id), label: String(m.label || m.id) })) : [];
};

export const createChat = async (title: string): Promise<string> => {
  const d = await call('/api/chats', { method: 'POST', body: JSON.stringify({ title }) }, 30_000);
  const id = d?.id;
  if (!id) throw new Error('PLEASER did not return a chat id');
  return String(id);
};

/** Post one turn. Returns the assistant's text. `model` picks the Hermes model.
 *  `timeoutMs` overrides the default for turns that are legitimately slow — reading a
 *  full paper through paperclip runs past the 240s that suits an ordinary chat turn. */
export const sendMessage = async (chatId: string, content: string, model?: string, timeoutMs?: number): Promise<string> => {
  const body: Record<string, unknown> = { content };
  if (model) body.model = model;
  const d = await call(`/api/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', body: JSON.stringify(body) }, timeoutMs);
  const text = typeof d?.content === 'string' ? d.content.trim() : '';
  if (!text) throw new Error('Hermes returned no text');
  return text;
};

/** Best-effort cleanup — a failed delete must never break the user's turn. */
export const deleteChat = async (chatId: string): Promise<boolean> => {
  try {
    await call(`/api/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }, 20_000);
    return true;
  } catch {
    return false;
  }
};
