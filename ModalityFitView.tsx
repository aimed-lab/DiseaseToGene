import React, { useRef, useState } from 'react';
import { Atom, MessageSquare, Search, X, Plus, Square, Table2, User } from 'lucide-react';
import { authenticatedFetch } from './supabase';
import ModalityFitPanel from './ModalityFitPanel';
import { queryParam } from './nav';

// ModalityFitView — the full-page "modality fit" analysis, reached from the "Modality"
// button next to Methodology (route /Modality). Gives the chart room to breathe instead
// of the narrow report-card column. Optionally arrives with ?gene=SYMBOL (from the board
// report card), in which case it preselects that target and auto-runs.

type CmpTier = 'Precedented' | 'Plausible' | 'Speculative' | 'Blocked';
interface CmpRow {
  gene: string;
  best: { modality: string; category: string; tier: CmpTier } | null;
  byCategory: Record<string, CmpTier>;
  counts: Record<CmpTier, number>;
  blocked: string[];
  error?: string;
}
const CMP_CATEGORIES = ['Small molecule', 'Biologic', 'Peptide', 'Induced-proximity', 'RNA/genetic'];
const CMP_COLOR: Record<CmpTier, string> = {
  Precedented: '#059669', Plausible: '#2563eb', Speculative: '#d97706', Blocked: '#64748b',
};
const CMP_TINT = (t: CmpTier, dark: boolean) => (dark
  ? ({ Precedented: '#0d2a23', Plausible: '#14203a', Speculative: '#2f2211', Blocked: '#20262e' } as Record<CmpTier, string>)[t]
  : ({ Precedented: '#e7f6f0', Plausible: '#e8effc', Speculative: '#fdf1e1', Blocked: '#eef1f5' } as Record<CmpTier, string>)[t]);
const CMP_SHORT: Record<CmpTier, string> = { Precedented: 'PREC', Plausible: 'PLAUS', Speculative: 'SPEC', Blocked: 'BLOCK' };

export default function ModalityFitView({ isDark, onClose, chatOpen, onToggleChat }: {
  isDark: boolean;
  onClose: () => void;
  chatOpen?: boolean;              // whether the co-pilot sidebar is currently open
  onToggleChat?: () => void;       // show/hide it — this view covers the app, so it needs its own control
}) {
  const initialGene = (queryParam('gene') || '').toUpperCase();
  const [input, setInput] = useState(initialGene);
  const [gene, setGene] = useState<string>(initialGene);
  const [autoRun] = useState<boolean>(!!initialGene);   // auto-run only for the gene we arrived with

  // ── Compare mode ───────────────────────────────────────────────────────────
  // Deliberately a CHOSEN set of targets, not "everything on screen". Comparing a shortlist
  // is the real question ("which of these three suits a degrader?"), and it keeps the cost
  // proportional: a cold summary is ~5s per gene of upstream API time.
  const [mode, setMode] = useState<'single' | 'compare'>('single');
  const [cmpGenes, setCmpGenes] = useState<string[]>([]);
  const [cmpInput, setCmpInput] = useState('');
  const [cmpGoal, setCmpGoal] = useState('inhibit');
  const [cmpRows, setCmpRows] = useState<Record<string, CmpRow>>({});
  const [cmpDone, setCmpDone] = useState(0);
  const [cmpRunning, setCmpRunning] = useState(false);
  const cmpStop = useRef(false);

  const addCmpGene = (raw: string) => {
    const g = raw.trim().toUpperCase();
    if (!g) return;
    setCmpGenes(prev => (prev.includes(g) || prev.length >= 12 ? prev : [...prev, g]));
    setCmpInput('');
  };

  // Chunked so the table fills progressively instead of showing nothing for a minute. The
  // server caps a request at 60 genes; small chunks are about FEEDBACK, not that limit.
  const runCompare = async () => {
    if (!cmpGenes.length || cmpRunning) return;
    setCmpRunning(true); setCmpDone(0); setCmpRows({}); cmpStop.current = false;
    const CHUNK = 3;
    try {
      for (let i = 0; i < cmpGenes.length; i += CHUNK) {
        if (cmpStop.current) break;
        const slice = cmpGenes.slice(i, i + CHUNK);
        const r = await authenticatedFetch('/api/modality-fit/batch', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ genes: slice, goal: cmpGoal }),
        });
        const j = await r.json();
        if (r.ok && Array.isArray(j.rows)) {
          setCmpRows(prev => { const next = { ...prev }; for (const row of j.rows as CmpRow[]) next[row.gene] = row; return next; });
        }
        setCmpDone(d => d + slice.length);
      }
    } catch { /* partial results stay on screen — better than discarding the work done */ }
    finally { setCmpRunning(false); }
  };

  const bg = isDark ? '#0a0f1a' : '#f8fafc';
  const card = isDark ? '#0f172a' : '#ffffff';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const ink = isDark ? '#e2e8f0' : '#0f172a';
  const muted = isDark ? '#64748b' : '#94a3b8';

  const submit = (e: React.FormEvent) => { e.preventDefault(); const g = input.trim().toUpperCase(); if (g) setGene(g); };

  return (
    <div style={{ position: 'fixed', inset: 0, background: bg, color: ink, overflow: 'auto', zIndex: 50 }}>
      {/* header */}
      <div style={{ position: 'sticky', top: 0, background: card, borderBottom: `1px solid ${border}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 2 }}>
        <Atom className="w-5 h-5" style={{ color: '#2563eb' }} />
        <div style={{ fontWeight: 900, fontSize: 16 }}>Modality Fit</div>
        <div style={{ fontSize: 12, color: muted }}>which therapeutic modality suits a target — on demand</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2, border: `1px solid ${border}`, borderRadius: 8, padding: 2 }}>
          {([['single', 'One target', User], ['compare', 'Compare', Table2]] as const).map(([m, label, Icon]) => (
            <button key={m} onClick={() => setMode(m)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', borderRadius: 6, padding: '6px 11px',
                       fontSize: 12, fontWeight: 700, cursor: 'pointer',
                       background: mode === m ? '#2563eb' : 'transparent', color: mode === m ? '#fff' : muted }}>
              <Icon className="w-3.5 h-3.5" />{label}
            </button>
          ))}
        </div>
        {onToggleChat && (
          <button onClick={onToggleChat} title={chatOpen ? 'Hide the co-pilot' : 'Ask the co-pilot about this analysis'}
            style={{ display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${chatOpen ? '#2563eb' : border}`,
                     background: chatOpen ? '#2563eb' : 'transparent', color: chatOpen ? '#fff' : ink,
                     borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <MessageSquare className="w-4 h-4" />{chatOpen ? 'Co-pilot' : 'Ask co-pilot'}
          </button>
        )}
        <button onClick={onClose} title="Back to the app" style={{ marginLeft: onToggleChat ? 0 : 'auto', border: `1px solid ${border}`, background: 'transparent', color: muted, borderRadius: 8, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X className="w-4 h-4" /></button>
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 20px 64px' }}>
        {mode === 'single' && <>
        {/* gene picker */}
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 12px', background: card }}>
            <Search className="w-4 h-4" style={{ color: muted }} />
            <input autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder="Enter a gene symbol (e.g. PHGDH, APP, PSEN2)…"
              style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: ink, fontSize: 14, fontWeight: 600 }} />
          </div>
          <button type="submit" style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Load</button>
        </form>

        {gene
          ? <ModalityFitPanel key={gene} geneSymbol={gene} theme={isDark ? 'dark' : 'light'} autoRun={autoRun && gene === initialGene} />
          : <div style={{ color: muted, fontSize: 13, textAlign: 'center', padding: '48px 0' }}>Enter a gene above, then click <strong style={{ color: ink }}>Generate modality analysis</strong> to score all modalities for it.</div>}
        </>}

        {mode === 'compare' && (
          <div>
            <p style={{ fontSize: 13, color: muted, margin: '0 0 14px', maxWidth: '70ch', lineHeight: 1.5 }}>
              Compare a shortlist of targets under one mechanistic goal. Add up to 12 — a first
              run costs roughly <strong style={{ color: ink }}>5 seconds per target</strong> while the
              evidence is fetched; afterwards it is cached and instant, including under a different goal.
            </p>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: `1px solid ${border}`, borderRadius: 10, padding: '8px 12px', background: card, minWidth: 240 }}>
                <Plus className="w-4 h-4" style={{ color: muted }} />
                <input value={cmpInput} onChange={e => setCmpInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCmpGene(cmpInput); } }}
                  placeholder="Add a gene, then Enter…"
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: ink, fontSize: 14, fontWeight: 600 }} />
              </div>
              <select value={cmpGoal} onChange={e => setCmpGoal(e.target.value)}
                style={{ background: card, color: ink, border: `1px solid ${border}`, borderRadius: 10, padding: '9px 10px', fontSize: 13 }}>
                <option value="inhibit">Inhibit function</option>
                <option value="degrade">Degrade protein</option>
                <option value="reduce_level">Reduce level (knockdown)</option>
                <option value="spare_catalytic">Spare catalytic activity</option>
                <option value="restore_function">Restore / increase function</option>
              </select>
              <button onClick={runCompare} disabled={!cmpGenes.length || cmpRunning}
                style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 16px', fontSize: 13, fontWeight: 700,
                         cursor: !cmpGenes.length || cmpRunning ? 'default' : 'pointer', opacity: !cmpGenes.length || cmpRunning ? 0.55 : 1 }}>
                {cmpRunning ? `Computing ${cmpDone} / ${cmpGenes.length}…` : `Compare ${cmpGenes.length || ''}`}
              </button>
              {cmpRunning && (
                <button onClick={() => { cmpStop.current = true; }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: ink, border: `1px solid ${border}`, borderRadius: 10, padding: '9px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                  <Square className="w-3.5 h-3.5" />Stop
                </button>
              )}
            </div>

            {cmpGenes.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {cmpGenes.map(g => (
                  <span key={g} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: card, border: `1px solid ${border}`, borderRadius: 999, padding: '4px 6px 4px 11px', fontSize: 12, fontWeight: 700, color: ink }}>
                    {g}
                    <button onClick={() => setCmpGenes(prev => prev.filter(x => x !== g))} title={`Remove ${g}`}
                      style={{ display: 'flex', border: 'none', background: 'transparent', color: muted, cursor: 'pointer', padding: 2 }}>
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {cmpRunning && (
              <div style={{ height: 4, borderRadius: 2, background: border, overflow: 'hidden', marginBottom: 14 }}>
                <div style={{ height: '100%', width: `${(cmpDone / Math.max(1, cmpGenes.length)) * 100}%`, background: '#2563eb', transition: 'width .3s ease' }} />
              </div>
            )}

            {Object.keys(cmpRows).length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
                  <thead>
                    <tr style={{ color: muted }}>
                      <th style={{ textAlign: 'left', padding: '0 12px 8px 0', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Target</th>
                      {CMP_CATEGORIES.map(c => (
                        <th key={c} style={{ textAlign: 'center', padding: '0 8px 8px', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{c}</th>
                      ))}
                      <th style={{ textAlign: 'left', padding: '0 0 8px 14px', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Best route</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmpGenes.filter(g => cmpRows[g]).map(g => {
                      const row = cmpRows[g];
                      return (
                        <tr key={g} style={{ borderTop: `1px solid ${border}` }}>
                          <td style={{ padding: '9px 12px 9px 0', fontWeight: 800, color: ink, whiteSpace: 'nowrap' }}>{g}</td>
                          {CMP_CATEGORIES.map(c => {
                            const t = row.byCategory?.[c];
                            return (
                              <td key={c} style={{ padding: '6px 8px', textAlign: 'center' }}>
                                {t ? (
                                  <span title={`${c}: ${t}`} style={{ display: 'inline-block', minWidth: 54, borderRadius: 6, padding: '3px 7px', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em',
                                                                      color: CMP_COLOR[t], background: CMP_TINT(t, isDark), border: `1px solid ${CMP_COLOR[t]}33` }}>{CMP_SHORT[t]}</span>
                                ) : <span style={{ color: muted }}>—</span>}
                              </td>
                            );
                          })}
                          <td style={{ padding: '9px 0 9px 14px', color: ink }}>
                            {row.error ? <span style={{ color: muted }}>{row.error}</span>
                              : row.best ? <span><strong>{row.best.modality}</strong>{row.blocked.length ? <span style={{ color: muted }}> · {row.blocked.length} ruled out</span> : null}</span>
                              : <span style={{ color: muted }}>no route</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {/* The cells are four-letter codes, which are unreadable without a key. The
                    definitions sit directly under the table rather than in a tooltip: this is
                    the first table most people meet, and the codes carry the entire result. */}
                <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, background: card, border: `1px solid ${border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: muted, marginBottom: 9 }}>
                    What the codes mean
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(232px, 1fr))', gap: '9px 20px' }}>
                    {([
                      ['Precedented', 'A drug of this kind already exists for this exact target. A database lookup, not a prediction.'],
                      ['Plausible',   'No drug of this kind yet, but the evidence supports it — a pocket, measured chemistry, or an interface.'],
                      ['Speculative', 'No evidence either way. Not ruled out, just unsupported.'],
                      ['Blocked',     'Physically ruled out by a hard rule — not a weak score, an impossibility.'],
                    ] as [CmpTier, string][]).map(([tier, def]) => (
                      <div key={tier} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                        <span style={{ flexShrink: 0, minWidth: 54, textAlign: 'center', borderRadius: 6, padding: '3px 7px', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.04em',
                                       color: CMP_COLOR[tier], background: CMP_TINT(tier, isDark), border: `1px solid ${CMP_COLOR[tier]}33` }}>{CMP_SHORT[tier]}</span>
                        <span style={{ fontSize: 11.5, lineHeight: 1.45, color: ink, opacity: 0.85 }}>
                          <strong style={{ fontWeight: 700 }}>{tier}</strong> — {def}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: muted, margin: '11px 0 0', maxWidth: '70ch', lineHeight: 1.45 }}>
                    Each cell is the best tier reached within that category for the chosen goal, so a target
                    can be Precedented for one kind of drug and Blocked for another. Tiers are set by
                    deterministic rules, not by a model. Open a target in <strong style={{ color: ink }}>One target</strong> for
                    the full 12-modality breakdown and the evidence behind it.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
