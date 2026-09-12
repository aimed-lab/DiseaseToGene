// nav.ts — minimal URL routing without a router library.
// The app is state-driven (viewMode + portal overlays), so instead of pulling in
// react-router we just push to the History API and notify listeners. App subscribes
// to `popstate` and re-reads window.location.pathname to decide what to render, which
// gives shareable URLs like /Methodologies while keeping the existing architecture.

export const ROUTES = {
  home: '/',
  methodology: '/Methodologies',
  modality: '/Modality',
  resetPassword: '/reset-password',
} as const;

// Navigate to a path: update the address bar and wake up any popstate listeners
// (pushState alone does NOT emit popstate, so we dispatch it ourselves).
export function navigate(to: string): void {
  if (window.location.pathname === to) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// True for /Methodologies, /methodology, etc. — tolerant of casing and trailing slash.
export function isMethodologyPath(pathname: string = window.location.pathname): boolean {
  return /^\/methodolog/i.test(pathname);
}

// True for /Modality (the full-page modality-fit analysis). Casing-tolerant.
export function isModalityPath(pathname: string = window.location.pathname): boolean {
  return /^\/modality/i.test(pathname);
}

// True for /reset-password — where a password-recovery link lands to set a new password.
export function isResetPasswordPath(pathname: string = window.location.pathname): boolean {
  return /^\/reset-password/i.test(pathname);
}

// A reset email may land on ANY path carrying a "#...type=recovery" hash (older emails still
// point at localhost root). Move such a stray hash to /reset-password, preserving it, BEFORE
// Supabase consumes it — so the reset form always catches the handoff. Call once at startup.
export function catchRecoveryHash(): void {
  if (typeof window === 'undefined') return;
  if (/type=recovery/.test(window.location.hash) && !isResetPasswordPath(window.location.pathname)) {
    window.history.replaceState(null, '', ROUTES.resetPassword + window.location.search + window.location.hash);
  }
}

// Read a query param (e.g. the preselected gene passed from the board report card).
export function queryParam(key: string): string | null {
  try { return new URLSearchParams(window.location.search).get(key); } catch { return null; }
}

// ── /wiki — the provenance wiki. A separate full-page UI (its own shell, nothing from the
// dashboard), read-only, login-only. Snapshot is identity: /wiki/:disease/:snapshot/... and
// a URL never changes what it resolves to. The disease segment is a readable slug; the
// snapshot id is what actually resolves. Entity segments mirror KG node keys (gene:KRAS →
// /gene/KRAS, drug:<slug> → /drug/<slug>), so a graph edge is a link with no lookup table.
export const WIKI_ROOT = '/wiki';
export type WikiEntityKind = 'gene' | 'run' | 'source' | 'drug' | 'trial' | 'pathway' | 'paper' | 'tissue' | 'variant';
export const WIKI_ENTITY_KINDS: readonly WikiEntityKind[] = ['gene', 'run', 'source', 'drug', 'trial', 'pathway', 'paper', 'tissue', 'variant'];
export type WikiRoute =
  | { page: 'index' }
  | { page: 'doc'; slug: string }
  | { page: 'disease'; disease: string; snapshot: number; section?: string }
  | { page: 'entity'; disease: string; snapshot: number; kind: WikiEntityKind; id: string };

export function isWikiPath(pathname: string = window.location.pathname): boolean {
  return /^\/wiki(\/|$)/i.test(pathname);
}

export function parseWikiPath(pathname: string = window.location.pathname): WikiRoute | null {
  if (!isWikiPath(pathname)) return null;
  const seg = pathname.replace(/^\/wiki\/?/i, '').split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  if (seg.length === 0) return { page: 'index' };
  if (seg[0] === 'docs') return { page: 'doc', slug: seg[1] || 'index' };
  const snapshot = Number(seg[1]);
  if (seg.length < 2 || !Number.isInteger(snapshot) || snapshot <= 0) return { page: 'index' };
  const disease = seg[0];
  if (seg.length === 2) return { page: 'disease', disease, snapshot };
  const kind = seg[2] as WikiEntityKind;
  if (seg.length === 3) return { page: 'disease', disease, snapshot, section: seg[2] };
  if (!WIKI_ENTITY_KINDS.includes(kind)) return { page: 'disease', disease, snapshot };
  return { page: 'entity', disease, snapshot, kind, id: seg.slice(3).join('/') };
}

// URL builders — the only place wiki paths are spelled out.
export const wikiSlug = (s: string): string => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
export const wikiUrl = {
  index: () => WIKI_ROOT,
  doc: (slug: string) => `${WIKI_ROOT}/docs/${encodeURIComponent(slug)}`,
  disease: (disease: string, snapshot: number, section?: string) => `${WIKI_ROOT}/${wikiSlug(disease)}/${snapshot}${section ? `/${section}` : ''}`,
  entity: (disease: string, snapshot: number, kind: WikiEntityKind, id: string) => `${WIKI_ROOT}/${wikiSlug(disease)}/${snapshot}/${kind}/${encodeURIComponent(id)}`,
  // A KG node key (gene:KRAS, drug:osimertinib, trial:NCT0…) → its wiki page, or null for kinds without one.
  node: (disease: string, snapshot: number, nodeKey: string): string | null => {
    const i = nodeKey.indexOf(':'); if (i < 0) return null;
    const kind = nodeKey.slice(0, i) as WikiEntityKind, id = nodeKey.slice(i + 1);
    return WIKI_ENTITY_KINDS.includes(kind) ? wikiUrl.entity(disease, snapshot, kind, id) : null;
  },
};
