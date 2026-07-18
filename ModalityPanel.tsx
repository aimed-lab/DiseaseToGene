import React, { useState } from 'react';

// ── Druggability BY MODALITY — "which modality can drug it?" ────────────────────
// Replaces the single ChEMBL "can we drug it?" verdict. Shows two things the
// professor insists stay separate, in two visually distinct blocks:
//   FACT       — developed drugs by modality (Open Targets: drugType + max stage)
//   PREDICTION — per-modality tractability assessment (Open Targets tractability)
// Fact and prediction never share a field or a colour. On-demand (public OT API).

interface Props { geneSymbol: string; currentDisease?: string; theme?: 'dark' | 'light'; }

// Plain-English explanations for the Open Targets tractability buckets (hover tooltips),
// so the specific evidence terms don't have to be memorised.
const BUCKET_INFO: Record<string, string> = {
  // clinical precedence (small molecule / antibody / other)
  'Approved Drug': 'This target already has an approved drug in this modality — the strongest clinical precedent.',
  'Advanced Clinical': 'A drug in this modality is in advanced clinical trials (Phase 2/3).',
  'Phase 1 Clinical': 'A drug in this modality has reached Phase 1.',
  // small molecule — is there a pocket a drug-like molecule can bind?
  'Structure with Ligand': 'An experimental 3D structure exists with a small molecule bound — proof it has a pocket that can hold a drug-like molecule.',
  'High-Quality Ligand': 'The bound molecule is genuinely drug-like (good size/properties), not just a fragment or buffer.',
  'High-Quality Pocket': 'A predicted pocket of druggable quality (size, shape, chemistry) from the structure.',
  'Med-Quality Pocket': 'A predicted pocket of medium druggable quality.',
  'Druggable Family': 'Belongs to a gene family historically drugged by small molecules (e.g. kinases, GPCRs) — class-level precedent.',
  // antibody — is it reachable from outside the cell? (antibodies act on surface/secreted proteins)
  'UniProt loc high conf': 'UniProt places the protein at the cell membrane / secreted (high confidence) — reachable by an antibody, which acts outside the cell.',
  'UniProt loc med conf': 'UniProt suggests a membrane / secreted location (medium confidence).',
  'GO CC high conf': 'Gene Ontology "Cellular Component" (high confidence) places it at the membrane / extracellular.',
  'GO CC med conf': 'Gene Ontology "Cellular Component" (medium confidence) suggests a membrane / extracellular location.',
  'UniProt SigP or TMHMM': 'Has a signal peptide (secreted) or predicted transmembrane helices (sits in the membrane) — i.e. surface-exposed.',
  'Human Protein Atlas loc': 'Human Protein Atlas imaging supports a membrane / secreted location.',
  // PROTAC / degrader — can we tag it for destruction? needs a chemical handle + degradation machinery
  'Literature': 'Literature evidence relevant to targeted protein degradation (PROTAC / degrader).',
  'UniProt Ubiquitination': 'UniProt annotates ubiquitination sites — the cell already tags it for the disposal pathway a PROTAC hijacks.',
  'Database Ubiquitination': 'Databases record ubiquitination of this protein — amenable to PROTAC-induced degradation.',
  'Half-life Data': 'Protein half-life data is available (relevant to how a degrader would act).',
  'Small Molecule Binder': 'A known small-molecule binder exists — the chemical "handle" a PROTAC is built from.',
};
const bucketTip = (label: string) => BUCKET_INFO[label] || 'Open Targets tractability assessment bucket.';

interface FactRow { modality: string; family: string; drugCount: number; topStage: string; topStageRank: number; approved: boolean; }
interface PredRow { modality: string; code: string; labels: string[]; }
interface Result {
  gene: string; ensemblId: string | null;
  fact: { developed: FactRow[]; totalDrugs: number; provenModalities: number; provenFamilies: number; bestStageRank: number; unclassified: { drugCount: number; names: string[]; topStage: string; topStageRank: number } | null; provenance: string };
  prediction: { buckets: PredRow[]; tractableModalities: number; provenance: string };
  note: string; error?: string;
}

export const ModalityPanel: React.FC<Props> = ({ geneSymbol, theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const c = {
    card: isDark ? '#0f172a' : '#f8fafc', border: isDark ? '#1e293b' : '#e2e8f0',
    ink: isDark ? '#e2e8f0' : '#0f172a', muted: isDark ? '#64748b' : '#94a3b8',
    head: isDark ? '#0b1220' : '#f1f5f9', accent: '#2a78d6',
    // fact = solid/real; prediction = a distinct tinted, dashed block
    factBg: isDark ? '#0b1220' : '#eef4fb', predBg: isDark ? '#1a1206' : '#fff7ed', predInk: isDark ? '#fdba74' : '#b45309',
    good: '#16a34a', track: isDark ? '#1e293b' : '#e5e7eb',
  };

  const run = async () => {
    setLoading(true); setErr(null); setData(null);
    try {
      const r = await fetch(`/api/druggability/modality?gene=${encodeURIComponent(geneSymbol)}`);
      const j: Result = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e: any) { setErr(e?.message || 'Failed to analyze modalities'); }
    finally { setLoading(false); }
  };

  const stageColor = (rank: number) => (rank >= 4 ? c.good : rank >= 1 ? c.accent : c.muted);

  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 10, background: c.card, padding: 12, margin: '10px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: c.ink }} title="Druggability is not one number — it depends on the modality. Developed drugs (fact) are shown separately from tractability assessment (prediction).">Druggability by modality</span>
        <span style={{ fontSize: 10, color: c.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>which modality?</span>
        <button onClick={run} disabled={loading} style={{ marginLeft: 'auto', border: `1px solid ${c.border}`, background: loading ? c.track : c.accent, color: loading ? c.muted : '#fff', borderRadius: 8, padding: '5px 11px', fontSize: 11, fontWeight: 800, cursor: loading ? 'default' : 'pointer' }}>
          {loading ? 'Analyzing…' : data ? 'Re-run' : 'Analyze modalities'}
        </button>
      </div>

      {!data && !loading && !err && (
        <div style={{ fontSize: 11, color: c.muted, marginTop: 8 }}>
          "Can we drug it?" is the wrong question — <b>which modality</b> can drug {geneSymbol}? Shows developed drugs by modality (fact) vs tractability by modality (prediction).
        </div>
      )}
      {err && <div style={{ fontSize: 11.5, color: '#dc2626', marginTop: 8 }}>{err}</div>}

      {data && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* ── FACT block: developed drugs by modality ── */}
          <div style={{ background: c.factBg, border: `1px solid ${c.border}`, borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: c.ink }}>Developed drugs by modality</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: c.good, background: isDark ? '#052e16' : '#dcfce7', borderRadius: 4, padding: '1px 6px' }}>fact</span>
              <span style={{ fontSize: 10, color: c.muted, marginLeft: 'auto' }}>
                {data.fact.provenModalities} modalit{data.fact.provenModalities === 1 ? 'y' : 'ies'}
                {data.fact.provenModalities !== data.fact.provenFamilies ? ` · ${data.fact.provenFamilies} famil${data.fact.provenFamilies === 1 ? 'y' : 'ies'}` : ''}
              </span>
            </div>
            {data.fact.developed.length === 0 && !data.fact.unclassified ? (
              <div style={{ fontSize: 11.5, color: c.muted }}>No developed drugs in any modality — <b style={{ color: c.ink }}>novel target</b>. (Not a strike against it — see tractability below.)</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {data.fact.developed.map(m => (
                  <div key={m.modality} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: c.ink }}>{m.modality}<span style={{ fontSize: 10, color: c.muted, marginLeft: 6 }}>{m.family !== m.modality ? m.family : ''}</span></span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: stageColor(m.topStageRank) }}>{m.topStage}</span>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: c.muted, minWidth: 44, textAlign: 'right' }}>×{m.drugCount}</span>
                  </div>
                ))}
                {data.fact.unclassified && (
                  <div style={{ marginTop: 4, paddingTop: 6, borderTop: `1px dashed ${c.border}`, fontSize: 10, color: c.muted, lineHeight: 1.4 }}>
                    <b style={{ color: c.ink }}>{data.fact.unclassified.drugCount}</b> unclassified drug{data.fact.unclassified.drugCount === 1 ? '' : 's'} ({data.fact.unclassified.topStage}) — drugType not reported, <i>not counted as a modality</i>{data.fact.unclassified.names.length ? `: ${data.fact.unclassified.names.slice(0, 6).join(', ')}${data.fact.unclassified.names.length > 6 ? ' …' : ''}` : ''}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── PREDICTION block: per-modality tractability (visually distinct) ── */}
          <div style={{ background: c.predBg, border: `1px dashed ${isDark ? '#7c5410' : '#f0c98a'}`, borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: c.ink }}>Tractability by modality</span>
              <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: c.predInk, background: isDark ? '#3b2408' : '#ffedd5', borderRadius: 4, padding: '1px 6px' }}>prediction</span>
              <span style={{ fontSize: 10, color: c.muted, marginLeft: 'auto' }}>{data.prediction.tractableModalities} tractable</span>
            </div>
            {data.prediction.buckets.length === 0 ? (
              <div style={{ fontSize: 11.5, color: c.muted }}>No tractability assessment available.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.prediction.buckets.map(b => (
                  <div key={b.code} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: c.ink, minWidth: 92 }}>{b.modality}</span>
                    <span style={{ fontSize: 10.5, color: c.muted }}>
                      {b.labels.map((lab, i) => (
                        <React.Fragment key={lab}>
                          {i > 0 && ' · '}
                          <span title={bucketTip(lab)} style={{ cursor: 'help', borderBottom: `1px dotted ${c.muted}` }}>{lab}</span>
                        </React.Fragment>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ fontSize: 9.5, color: c.muted, lineHeight: 1.4 }}>{data.note} <span style={{ opacity: .85 }}>Fact: {data.fact.provenance}. Prediction: {data.prediction.provenance}.</span></div>
        </div>
      )}
    </div>
  );
};

export default ModalityPanel;
