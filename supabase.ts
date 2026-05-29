import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY — auth will not work.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
