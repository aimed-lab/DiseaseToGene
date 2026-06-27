import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY — auth will not work.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const isInvalidRefreshTokenError = (message?: string) =>
  /invalid refresh token|refresh token not found/i.test(message || '');

export function clearSupabaseSessionStorage(): void {
  if (typeof window === 'undefined') return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith('sb-') && key.endsWith('-auth-token')) {
      localStorage.removeItem(key);
    }
  }
}

export async function getInitialSession() {
  const result = await supabase.auth.getSession();
  if (!result.error || !isInvalidRefreshTokenError(result.error.message)) {
    return result;
  }

  clearSupabaseSessionStorage();
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Storage is already cleared; the user can sign in again.
  }
  return { data: { session: null }, error: null };
}

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data, error } = await getInitialSession();
  if (error || !data.session?.access_token) {
    throw new Error('Your session has expired. Sign in again.');
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${data.session.access_token}`);
  return fetch(input, { ...init, headers });
}

// ── Typed DB helpers ──────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'user';

export interface UserProfile {
  id:          string;
  name:        string | null;
  institution: string | null;
  role:        UserRole;
  created_at:  string;
}

export interface GlobalWeights {
  genetic:    number;
  expression: number;
  target:     number;
}

export interface WeightPreset {
  id:         string;
  user_id:    string;
  name:       string;
  genetic:    number;
  expression: number;
  target:     number;
  created_at: string;
}

export interface SavedSearch {
  id:           string;
  user_id:      string;
  disease_id:   string;
  disease_name: string;
  gene_symbols: string[];
  saved_at:     string;
}

// ── DB query helpers ─────────────────────────────────────────────────────────

export async function fetchGlobalWeights(): Promise<GlobalWeights | null> {
  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'global_weights')
    .single();
  if (error || !data) return null;
  return data.value as GlobalWeights;
}

export async function saveGlobalWeights(w: GlobalWeights): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('app_config')
    .update({ value: w, updated_at: new Date().toISOString() })
    .eq('key', 'global_weights');
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function fetchUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return data as UserProfile;
}

export async function updateUserProfile(userId: string, fields: Partial<Pick<UserProfile, 'name' | 'institution'>>): Promise<void> {
  await supabase.from('user_profiles').update(fields).eq('id', userId);
}

export async function fetchWeightPresets(userId: string): Promise<WeightPreset[]> {
  const { data } = await supabase
    .from('weight_presets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return (data as WeightPreset[]) ?? [];
}

export async function saveWeightPreset(userId: string, name: string, w: GlobalWeights): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('weight_presets')
    .insert({ user_id: userId, name, ...w });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteWeightPreset(id: string): Promise<void> {
  await supabase.from('weight_presets').delete().eq('id', id);
}

export async function fetchSavedSearches(userId: string): Promise<SavedSearch[]> {
  const { data } = await supabase
    .from('saved_searches')
    .select('*')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });
  return (data as SavedSearch[]) ?? [];
}

export async function saveSearch(userId: string, diseaseId: string, diseaseName: string, geneSymbols: string[]): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('saved_searches')
    .insert({ user_id: userId, disease_id: diseaseId, disease_name: diseaseName, gene_symbols: geneSymbols });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await supabase.from('saved_searches').delete().eq('id', id);
}

// ── Content-centric ranking snapshots ─────────────────────────────────────────
// Versioned, traceable disease→target ranking content stored in Supabase.

export interface RankingSnapshotMeta {
  id:           string;
  disease_id:   string;
  disease_name: string;
  version:      number;
  created_at:   string;
  created_by:   string | null;
  label:        string | null;
  gene_count:   number | null;
}

export interface RankingSnapshot extends RankingSnapshotMeta {
  weights:    GlobalWeights | null;
  provenance: Record<string, unknown> | null;
  targets:    unknown[];
}

export interface NewRankingSnapshot {
  disease_id:   string;
  disease_name: string;
  label?:       string | null;
  weights?:     unknown;
  gene_count?:  number;
  provenance?:  unknown;
  targets:      unknown[];
}

// Content now lives in Oracle (store of record); these go through the server's
// /api/snapshots endpoints (server connects to Oracle). Supabase = auth only.
// Signatures unchanged so callers (index.tsx) don't change. ids are coerced to
// strings (Oracle uses numeric ids).

export async function saveRankingSnapshot(s: NewRankingSnapshot): Promise<{ ok: boolean; version?: number; error?: string }> {
  try {
    const res = await authenticatedFetch('/api/snapshots', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || `Request failed (HTTP ${res.status})` };
    return { ok: true, version: data.version };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function fetchSnapshots(diseaseId?: string): Promise<RankingSnapshotMeta[]> {
  try {
    const url = '/api/snapshots' + (diseaseId ? `?diseaseId=${encodeURIComponent(diseaseId)}` : '');
    const res = await authenticatedFetch(url);
    if (!res.ok) return [];
    const rows = await res.json();
    return (rows as any[]).map((r) => ({ ...r, id: String(r.id) })) as RankingSnapshotMeta[];
  } catch {
    return [];
  }
}

export async function fetchSnapshot(id: string): Promise<RankingSnapshot | null> {
  try {
    const res = await authenticatedFetch(`/api/snapshots/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const r = await res.json();
    return { ...r, id: String(r.id) } as RankingSnapshot;
  } catch {
    return null;
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  try {
    await authenticatedFetch(`/api/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
  } catch { /* ignore */ }
}

// Per-gene scores for a snapshot (Rankings dashboard). Reads Oracle.
export async function fetchSnapshotScores(id: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await authenticatedFetch(`/api/snapshots/${encodeURIComponent(id)}/scores`);
    if (!res.ok) return [];
    return (await res.json()) as Record<string, unknown>[];
  } catch { return []; }
}

// Evidence rows for a snapshot (Gene × Source matrix). Reads Oracle.
export async function fetchSnapshotEvidence(id: string): Promise<Record<string, unknown>[]> {
  try {
    const res = await authenticatedFetch(`/api/snapshots/${encodeURIComponent(id)}/evidence`);
    if (!res.ok) return [];
    return (await res.json()) as Record<string, unknown>[];
  } catch { return []; }
}

// ── Papers + evidence cards (content store) ───────────────────────────────────
// papers: one row per ingested paper. evidence_cards: one row per extracted
// gene/drug/mutation fact, each carrying a source_quote for traceability.
// created_by is set server-side by the column default (auth.uid()), enforced by RLS.

export interface NewPaper {
  title:          string;
  authors?:       string[] | null;
  journal?:       string | null;
  year?:          number | null;
  doi?:           string | null;
  url?:           string | null;
  study_type?:    string | null;
  sample_size?:   number | null;
  key_finding?:   string | null;
  conclusion?:    string | null;
  raw_extraction?: unknown;
}

export interface NewEvidenceCard {
  gene_symbol:       string;
  disease?:          string | null;
  mutation?:         string | null;
  drug?:             string | null;
  drug_action?:      string | null;
  mechanism?:        string | null;
  modality?:         string | null;
  trial_phase?:      string | null;
  trial_ids?:        string[] | null;
  primary_endpoint?: string | null;
  efficacy_result?:  string | null;
  effect_size?:      string | null;
  approval_status?:  string | null;
  key_finding?:      string | null;
  source_quote?:     string | null;
}

export interface EvidenceCardRow extends NewEvidenceCard {
  id: string;
  paper_id: string;
  audit_status: string;
  created_at: string;
}

// Save paper-derived evidence → Oracle EVIDENCE (evidence_type='paper').
// Each card's full object is kept in value_json so the Stored Evidence panel can
// reconstruct it. (Signature unchanged so callers don't change.)
export async function savePaper(
  paper: NewPaper,
  cards: NewEvidenceCard[],
): Promise<{ ok: boolean; cardCount?: number; error?: string }> {
  const valid = cards.filter(c => c.gene_symbol);
  if (valid.length === 0) return { ok: true, cardCount: 0 };
  const sourceUrl = paper.doi ? `https://doi.org/${paper.doi}` : (paper.url || null);
  const evidence = valid.map(c => ({
    disease_id: c.disease || 'unknown',
    gene_symbol: c.gene_symbol,
    evidence_type: 'paper',
    source: paper.title || c.drug || 'paper',
    source_url: sourceUrl,
    value_text: c.source_quote || c.key_finding || null,
    value_json: { ...c, paper_title: paper.title, paper_doi: paper.doi, paper_journal: paper.journal, paper_year: paper.year },
    generated_by: 'paper extraction (Gemini)',
    audit_status: 'AI-extracted',
  }));
  try {
    const res = await authenticatedFetch('/api/evidence', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cards: evidence }),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || `Request failed (HTTP ${res.status})` };
    return { ok: true, cardCount: data.count ?? evidence.length };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

// Gene symbols that have stored evidence (for the EVIDENCE badge). Reads Oracle.
export async function fetchEvidenceGeneSymbols(disease?: string): Promise<Set<string>> {
  try {
    const url = '/api/evidence/genes' + (disease ? `?diseaseId=${encodeURIComponent(disease)}` : '');
    const res = await authenticatedFetch(url);
    if (!res.ok) return new Set();
    const arr = await res.json();
    return new Set((arr as string[]) || []);
  } catch {
    return new Set();
  }
}

// Paper-derived evidence cards for one gene (for the Stored Evidence panel).
// Reconstructs the card shape from EVIDENCE.value_json.
export async function fetchEvidenceCardsForGene(gene: string, _disease?: string): Promise<EvidenceCardRow[]> {
  try {
    const res = await authenticatedFetch(`/api/evidence?gene=${encodeURIComponent(gene)}`);
    if (!res.ok) return [];
    const rows = await res.json();
    return (rows as any[])
      .filter(r => r.evidence_type === 'paper' && r.value_json)
      .map(r => ({
        ...(r.value_json as NewEvidenceCard),
        id: String(r.id),
        paper_id: '',
        audit_status: r.audit_status || 'AI-extracted',
        created_at: r.retrieved_at || '',
      })) as EvidenceCardRow[];
  } catch {
    return [];
  }
}

// ── Harvest → Oracle (snapshot + per-gene scores + per-source evidence) ───────
export interface HarvestRow {
  gene_symbol: string;
  rank?:       number | null;
  get_scores?: unknown;
  clinical?:   unknown;
  literature?: unknown;
  chembl?:     unknown;
  mutations?:  unknown;
  retrieved?:  string | null;
}

export async function saveHarvest(input: {
  disease_id: string; disease_name: string; weights?: unknown; provenance?: unknown; rows: HarvestRow[];
}): Promise<{ ok: boolean; version?: number; scores?: number; evidence?: number; error?: string }> {
  try {
    const res = await authenticatedFetch('/api/harvest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok || data.ok === false) return { ok: false, error: data.error || `Request failed (HTTP ${res.status})` };
    return { ok: true, version: data.version, scores: data.scores, evidence: data.evidence };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
