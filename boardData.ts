// boardData.ts ──────────────────────────────────────────────────────────────
// One client-side cache of a snapshot's board rows (/api/dashboard/genes), so the
// Assessment can score a target with the board's own math without re-downloading the
// disease's evidence set every time. The Ranking Board keeps its own progressive loader
// (it needs the partial-axis updates); this is for everyone who just wants the finished rows.
import { authenticatedFetch, fetchSnapshots } from './supabase';

const rows = new Map<number, Promise<any[]>>();

export async function loadBoardRows(snapshotId: number): Promise<any[]> {
  if (!rows.has(snapshotId)) {
    const p = (async () => {
      const r = await authenticatedFetch(`/api/dashboard/genes?snapshotId=${encodeURIComponent(String(snapshotId))}&limit=20000`);
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('application/json')) throw new Error(`board rows → ${r.status} (is the dev server restarted?)`);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `board rows → ${r.status}`);
      return (j?.rows || []) as any[];
    })();
    rows.set(snapshotId, p);
    p.catch(() => rows.delete(snapshotId));   // a failed pull is retried next time, not cached
  }
  return rows.get(snapshotId)!;
}

/** The newest snapshot whose disease name matches — the same rule the Ranking Board applies. */
export async function resolveSnapshot(diseaseName: string): Promise<{ id: number; disease_name: string } | null> {
  const dq = (diseaseName || '').toLowerCase().trim();
  if (!dq) return null;
  const s = await fetchSnapshots();
  const match = s.find(x => String(x.disease_name || '').toLowerCase().includes(dq));
  return match ? { id: Number(match.id), disease_name: String(match.disease_name) } : null;
}
