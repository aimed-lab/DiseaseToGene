import React, { useEffect, useMemo, useState } from 'react';
import { authenticatedFetch, fetchSnapshots, fetchSnapshotScores, fetchSnapshotEvidence, type RankingSnapshotMeta } from './supabase';

// ── Jobs & Data Store ─────────────────────────────────────────────────────────
// Left: create + run background harvest jobs (any disease, any gene count) and
// watch them progress live. Right: a read-only browser of what is actually stored
// in Oracle — snapshots, their per-gene scores, and the evidence behind them.
// Jobs run server-side (POST /api/jobs) and persist; this view just polls them.

interface Props { theme?: 'dark' | 'light' }

type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
interface JobRec {
  id: string; type: string; disease_query: string; disease_id: string | null; disease_name: string | null;
  gene_count: number; status: JobStatus; progress: number; processed: number; total: number;
  log: string[]; snapshot_id: number | null; snapshot_version: number | null; error: string | null;
  created_at: string; started_at: string | null; finished_at: string | null;
}

const GENE_COUNTS = [100, 250, 500, 1000, 2000];

export const JobsView: React.FC<Props> = ({ theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [jobs, setJobs] = useState<JobRec[]>([]);
  const [disease, setDisease] = useState('Pancreatic adenocarcinoma');
  const [geneCount, setGeneCount] = useState(500);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);
  // add-genes-on-demand
  const [addList, setAddList] = useState('SRC');
  const [targetSnap, setTargetSnap] = useState('');
  const [submittingAdd, setSubmittingAdd] = useState(false);
  const [errAdd, setErrAdd] = useState<string | null>(null);

  // ── data browser state ──
  const [snapshots, setSnapshots] = useState<RankingSnapshotMeta[]>([]);
  const [selSnap, setSelSnap] = useState<string>('');
  const [snapScores, setSnapScores] = useState<Record<string, any>[]>([]);
  const [snapEvidence, setSnapEvidence] = useState<Record<string, any>[]>([]);
  const [loadingSnap, setLoadingSnap] = useState(false);

  const loadJobs = async () => {
    try { const r = await authenticatedFetch('/api/jobs'); if (r.ok) setJobs(await r.json()); } catch { /* ignore poll error */ }
  };
  const loadSnapshots = async () => { try { setSnapshots(await fetchSnapshots()); } catch { /* ignore */ } };

  useEffect(() => { loadJobs(); loadSnapshots(); }, []);
  // poll while any job is active
  const anyActive = jobs.some(j => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    const t = setInterval(() => { loadJobs(); }, anyActive ? 2000 : 8000);
    return () => clearInterval(t);
  }, [anyActive]);

  useEffect(() => {
    if (!selSnap) { setSnapScores([]); setSnapEvidence([]); return; }
    let active = true; setLoadingSnap(true);
    Promise.all([fetchSnapshotScores(selSnap), fetchSnapshotEvidence(selSnap)]).then(([sc, ev]) => {
      if (!active) return; setSnapScores(sc as any[]); setSnapEvidence(ev as any[]); setLoadingSnap(false);
    }).catch(() => { if (active) setLoadingSnap(false); });
    return () => { active = false; };
  }, [selSnap]);

  const submit = async () => {
    if (!disease.trim()) return;
    setSubmitting(true); setErr(null);
    try {
      const r = await authenticatedFetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disease_query: disease.trim(), gene_count: geneCount, type: 'harvest_ot' }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `HTTP ${r.status}`); }
      await loadJobs();
    } catch (e: any) { setErr(e?.message || 'Failed to start job'); }
    finally { setSubmitting(false); }
  };

  const cancel = async (id: string) => {
    try { await authenticatedFetch(`/api/jobs/${id}`, { method: 'DELETE' }); await loadJobs(); } catch { /* ignore */ }
  };

  // default the "add to" snapshot to the newest one
  useEffect(() => { if (!targetSnap && snapshots.length) setTargetSnap(String(snapshots[0].id)); }, [snapshots]);

  const submitAdd = async () => {
    const list = addList.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    const snap = snapshots.find(s => String(s.id) === targetSnap);
    if (!list.length) { setErrAdd('Enter at least one gene symbol'); return; }
    if (!snap) { setErrAdd('Pick a snapshot to add into'); return; }
    setSubmittingAdd(true); setErrAdd(null);
    try {
      const r = await authenticatedFetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'add_genes', disease_query: snap.disease_name, genes: list, target_snapshot_id: snap.id }),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `HTTP ${r.status}`); }
      await loadJobs();
    } catch (e: any) { setErrAdd(e?.message || 'Failed to add genes'); }
    finally { setSubmittingAdd(false); }
  };

  // ── theme tokens ──
  const bg = isDark ? '#0b1220' : '#ffffff', border = isDark ? '#1e293b' : '#e2e8f0';
  const ink = isDark ? '#e2e8f0' : '#0f172a', muted = isDark ? '#64748b' : '#94a3b8';
  const cardBg = isDark ? '#0f172a' : '#fbfdff', field = isDark ? '#0f172a' : '#ffffff', track = isDark ? '#1e293b' : '#eef2f7';
  const accent = '#2563eb';
  const STATUS_COLOR: Record<JobStatus, string> = { queued: '#64748b', running: '#2563eb', done: '#16a34a', failed: '#dc2626', cancelled: '#b45309' };

  const evidenceTally = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of snapEvidence) { const t = (e.evidence_type as string) || 'other'; m[t] = (m[t] || 0) + 1; }
    return m;
  }, [snapEvidence]);
  const topGenes = useMemo(() => {
    return snapScores.slice().sort((a, b) => (Number(b.overall_score) || 0) - (Number(a.overall_score) || 0)).slice(0, 12);
  }, [snapScores]);

  const wrap: React.CSSProperties = { height: '100%', overflow: 'auto', background: bg, color: ink, border: `1px solid ${border}`, borderRadius: 12 };
  const fieldStyle: React.CSSProperties = { background: field, color: ink, border: `1px solid ${border}`, borderRadius: 8, padding: '8px 10px', fontSize: 13, width: '100%' };
  const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 800, color: muted, textTransform: 'uppercase', letterSpacing: '0.08em' };

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: `1px solid ${border}`, position: 'sticky', top: 0, background: bg, zIndex: 2 }}>
        <div style={{ fontWeight: 800, fontSize: 15 }}>Jobs &amp; Data Store <span style={{ color: muted, fontWeight: 600, fontSize: 12 }}>· run harvests in the background · browse what Oracle holds</span></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
        {/* ── LEFT: jobs ── */}
        <div style={{ padding: '16px 18px', borderRight: `1px solid ${border}` }}>
          {/* new job */}
          <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: cardBg, padding: 14, marginBottom: 16 }}>
            <div style={sectionLabel}>New harvest job</div>
            <div style={{ fontSize: 11.5, color: muted, margin: '4px 0 10px' }}>Pulls the Open Targets gene universe for a disease and stores it as an Oracle snapshot — runs in the background.</div>
            <label style={{ fontSize: 11, color: muted, fontWeight: 700 }}>Disease (name or EFO id)</label>
            <input value={disease} onChange={e => setDisease(e.target.value)} placeholder="e.g. Pancreatic adenocarcinoma or EFO_0002618" style={{ ...fieldStyle, marginTop: 4 }} />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 11, color: muted, fontWeight: 700 }}>Genes to harvest</label>
                <select value={geneCount} onChange={e => setGeneCount(Number(e.target.value))} style={{ ...fieldStyle, marginTop: 4 }}>
                  {GENE_COUNTS.map(n => <option key={n} value={n}>{n} genes</option>)}
                </select>
              </div>
              <button onClick={submit} disabled={submitting || !disease.trim()} style={{ border: 'none', background: accent, color: '#fff', borderRadius: 8, padding: '10px 16px', fontSize: 12, fontWeight: 800, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                {submitting ? 'Starting…' : 'Run job'}
              </button>
            </div>
            {err && <div style={{ marginTop: 8, fontSize: 11.5, color: '#dc2626' }}>{err}</div>}
          </div>

          {/* add genes on demand */}
          <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: cardBg, padding: 14, marginBottom: 16 }}>
            <div style={sectionLabel}>Add genes on demand</div>
            <div style={{ fontSize: 11.5, color: muted, margin: '4px 0 10px' }}>Add specific genes (e.g. <strong>SRC</strong>) into an existing snapshot — they join the same universe and get the same evidence harvested, so they compete in the funnel alongside the Open Targets genes.</div>
            <label style={{ fontSize: 11, color: muted, fontWeight: 700 }}>Gene symbols (comma or space separated)</label>
            <textarea value={addList} onChange={e => setAddList(e.target.value)} placeholder="SRC, LYN, FYN" rows={2} style={{ ...fieldStyle, marginTop: 4, resize: 'vertical', fontFamily: 'monospace' }} />
            <label style={{ fontSize: 11, color: muted, fontWeight: 700, marginTop: 10, display: 'block' }}>Add into snapshot</label>
            <select value={targetSnap} onChange={e => setTargetSnap(e.target.value)} style={{ ...fieldStyle, marginTop: 4 }}>
              {snapshots.length === 0 && <option value="">No snapshots — run a harvest first</option>}
              {snapshots.map(s => <option key={s.id} value={String(s.id)}>{s.disease_name} · Tier {s.version} · {s.gene_count ?? '?'} genes</option>)}
            </select>
            <button onClick={submitAdd} disabled={submittingAdd || !addList.trim() || !snapshots.length} style={{ marginTop: 10, width: '100%', border: 'none', background: '#0d9488', color: '#fff', borderRadius: 8, padding: '10px 16px', fontSize: 12, fontWeight: 800, cursor: submittingAdd ? 'default' : 'pointer', opacity: submittingAdd ? 0.6 : 1, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {submittingAdd ? 'Adding…' : 'Add & harvest genes'}
            </button>
            {errAdd && <div style={{ marginTop: 8, fontSize: 11.5, color: '#dc2626' }}>{errAdd}</div>}
          </div>

          {/* jobs list */}
          <div style={{ ...sectionLabel, marginBottom: 8 }}>Jobs {jobs.length > 0 && <span style={{ color: muted }}>· {jobs.length}</span>}</div>
          {jobs.length === 0 && <div style={{ color: muted, fontStyle: 'italic', fontSize: 12 }}>No jobs yet — start one above.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {jobs.map(j => {
              const sc = STATUS_COLOR[j.status];
              const isOpen = openJob === j.id;
              const dur = j.started_at ? Math.round((((j.finished_at ? +new Date(j.finished_at) : Date.now()) - +new Date(j.started_at)) / 1000)) : 0;
              return (
                <div key={j.id} style={{ border: `1px solid ${border}`, borderRadius: 10, background: cardBg }}>
                  <div onClick={() => setOpenJob(o => o === j.id ? null : j.id)} style={{ padding: '9px 11px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fff', background: sc, borderRadius: 999, padding: '2px 7px' }}>{j.status}</span>
                      <span style={{ fontWeight: 800, fontSize: 13, color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.disease_name || j.disease_query}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: muted }}>{j.processed}/{j.gene_count} genes</span>
                    </div>
                    <div style={{ marginTop: 7, height: 6, borderRadius: 999, background: track, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round((j.progress || 0) * 100)}%`, height: '100%', background: sc, transition: 'width 200ms' }} />
                    </div>
                    <div style={{ marginTop: 5, display: 'flex', gap: 8, fontSize: 10.5, color: muted }}>
                      <span>{j.gene_count} requested</span>
                      {j.started_at && <span>· {dur}s</span>}
                      {j.snapshot_id != null && <span>· snapshot #{j.snapshot_id}{j.snapshot_version != null ? ` (Tier ${j.snapshot_version})` : ''}</span>}
                      {j.error && <span style={{ color: '#dc2626' }}>· {j.error}</span>}
                    </div>
                  </div>
                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${border}`, padding: '8px 11px' }}>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        {(j.status === 'queued' || j.status === 'running') && (
                          <button onClick={() => cancel(j.id)} style={{ fontSize: 10, fontWeight: 700, color: '#b45309', background: 'none', border: `1px solid ${border}`, borderRadius: 8, padding: '4px 9px', cursor: 'pointer' }}>Cancel</button>
                        )}
                        {j.snapshot_id != null && (
                          <button onClick={() => setSelSnap(String(j.snapshot_id))} style={{ fontSize: 10, fontWeight: 700, color: accent, background: 'none', border: `1px solid ${border}`, borderRadius: 8, padding: '4px 9px', cursor: 'pointer' }}>View in data store →</button>
                        )}
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 10.5, color: muted, background: track, borderRadius: 8, padding: '7px 9px', maxHeight: 150, overflow: 'auto', lineHeight: 1.5 }}>
                        {j.log.length ? j.log.map((l, i) => <div key={i}>{l}</div>) : <em>no log lines yet</em>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: Oracle data browser ── */}
        <div style={{ padding: '16px 18px' }}>
          <div style={{ ...sectionLabel, marginBottom: 8 }}>Oracle data store <span style={{ color: muted }}>· {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}</span></div>
          <select value={selSnap} onChange={e => setSelSnap(e.target.value)} style={{ ...fieldStyle }}>
            <option value="">Select a snapshot to inspect…</option>
            {snapshots.map(s => <option key={s.id} value={String(s.id)}>{s.disease_name} · Tier {s.version} · {s.gene_count ?? '?'} genes · {(s.created_at || '').slice(0, 10)}</option>)}
          </select>

          {!selSnap ? (
            <div style={{ marginTop: 14, color: muted, fontSize: 12, fontStyle: 'italic' }}>Pick a snapshot to see its stored gene scores and the evidence behind them — exactly what is in Oracle.</div>
          ) : loadingSnap ? (
            <div style={{ marginTop: 14, color: muted, fontStyle: 'italic' }}>Loading snapshot from Oracle…</div>
          ) : (
            <div style={{ marginTop: 14 }}>
              {/* stat row */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <Stat label="Genes (scores)" value={String(snapScores.length)} ink={ink} muted={muted} border={border} cardBg={cardBg} />
                <Stat label="Evidence rows" value={String(snapEvidence.length)} ink={ink} muted={muted} border={border} cardBg={cardBg} />
                <Stat label="Evidence types" value={String(Object.keys(evidenceTally).length)} ink={ink} muted={muted} border={border} cardBg={cardBg} />
              </div>

              {/* evidence-type tally */}
              {Object.keys(evidenceTally).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ ...sectionLabel, marginBottom: 6 }}>Evidence by source</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {Object.entries(evidenceTally).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                      <span key={t} style={{ fontSize: 11, fontWeight: 700, color: ink, background: track, borderRadius: 999, padding: '3px 9px' }}>{t} <span style={{ color: muted }}>{n}</span></span>
                    ))}
                  </div>
                </div>
              )}

              {/* top genes */}
              <div style={{ ...sectionLabel, marginBottom: 6 }}>Top genes by overall score</div>
              <div style={{ border: `1px solid ${border}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 70px 70px 70px', gap: 0, fontSize: 10, fontWeight: 800, color: muted, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '7px 10px', background: track }}>
                  <span>#</span><span>Gene</span><span style={{ textAlign: 'right' }}>Overall</span><span style={{ textAlign: 'right' }}>Genetic</span><span style={{ textAlign: 'right' }}>Expr</span>
                </div>
                {topGenes.map((g, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1fr 70px 70px 70px', gap: 0, fontSize: 12, padding: '6px 10px', borderTop: `1px solid ${border}` }}>
                    <span style={{ color: muted }}>{i + 1}</span>
                    <span style={{ fontWeight: 700, color: accent }}>{String(g.gene_symbol ?? '')}</span>
                    <span style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(g.overall_score)}</span>
                    <span style={{ textAlign: 'right', fontFamily: 'monospace', color: muted }}>{fmt(g.genetic_score)}</span>
                    <span style={{ textAlign: 'right', fontFamily: 'monospace', color: muted }}>{fmt(g.expression_score)}</span>
                  </div>
                ))}
                {topGenes.length === 0 && <div style={{ padding: 12, color: muted, fontStyle: 'italic', fontSize: 12 }}>No score rows in this snapshot.</div>}
              </div>
              <div style={{ marginTop: 10, fontSize: 10.5, color: muted, lineHeight: 1.5 }}>
                This is read straight from Oracle — the same store the Funnel and Rankings tabs use. A harvest job writes a new snapshot here; nothing is fabricated.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; ink: string; muted: string; border: string; cardBg: string }> = ({ label, value, ink, muted, border, cardBg }) => (
  <div style={{ flex: 1, border: `1px solid ${border}`, borderRadius: 10, background: cardBg, padding: '10px 12px' }}>
    <div style={{ fontSize: 20, fontWeight: 900, color: ink }}>{value}</div>
    <div style={{ fontSize: 10, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{label}</div>
  </div>
);

const fmt = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(3) : '—'; };

export default JobsView;
