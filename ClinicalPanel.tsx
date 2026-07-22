import React, { useEffect, useState } from 'react';

interface Props {
  geneSymbol: string;
  currentDisease?: string;     // clinical landscape is disease-scoped
  theme?: 'dark' | 'light';
}

interface ClinicalData {
  trial_count: number; max_phase: number;              // compat aliases of the two below
  n_drugs_in_disease_trials?: number;
  max_disease_trial_phase?: number;
  drug_names?: string[];
}

// Clinical axis (Open Targets target->drug->trial graph). Answers "does a drug that hits
// THIS target have a trial in THIS disease, and how far has it got?" — the SAME numbers the
// funnel filters on (the harvest stores these as 'clinical' evidence; here we fetch live).
//
// NOTE the metric changed with the #3 redesign: this is a count of DRUGS with >=1 trial in
// the disease, NOT a count of trials. It replaced a ClinicalTrials.gov free-text search that
// had no gene field and matched substrings (renin scored 234 for pancreatic via "cur-REN-t").
// Phase comes from each trial's own trialPhase filtered to the disease — never the drug's
// global maximumClinicalStage (dasatinib is approved for CML but only Phase 2 in pancreatic).
// ADDITIVE, fetch-on-mount, same lifecycle as the other drill-down panels.
export const ClinicalPanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [data, setData] = useState<ClinicalData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentDisease) { setLoading(false); return; }
    let active = true;
    setLoading(true); setData(null);
    fetch(`/api/clinical?gene=${encodeURIComponent(geneSymbol)}&disease=${encodeURIComponent(currentDisease)}`)
      .then(r => r.json()).then(j => { if (!active) return; setData(j?.data ?? null); setLoading(false); })
      .catch(() => { if (active) { setData(null); setLoading(false); } });
    return () => { active = false; };
  }, [geneSymbol, currentDisease]);

  if (!currentDisease) return null;

  const muted = isDark ? '#64748b' : '#94a3b8';
  const text = isDark ? '#e2e8f0' : '#1e293b';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#16a34a'; // green — clinical
  const wrap: React.CSSProperties = {
    border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
    background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
  };

  if (loading) return <div style={{ ...wrap, color: muted, fontStyle: 'italic' }}>Querying Open Targets trials for {geneSymbol}…</div>;

  const nDrugs = data?.n_drugs_in_disease_trials ?? data?.trial_count ?? 0;
  const phase = data?.max_disease_trial_phase ?? data?.max_phase ?? 0;
  const drugs = data?.drug_names ?? [];

  // 0 is a NEUTRAL novelty signal ("no clinical precedent yet"), never a negative — a novel
  // target like PHGDH correctly scores 0 and must not be penalised for it.
  if (!data || nDrugs === 0) {
    return (
      <div style={wrap}>
        <Header accent={accent} muted={muted} />
        <div style={{ color: muted, fontStyle: 'italic', marginTop: 6 }}>No drug targeting {geneSymbol} is in a registered {currentDisease} trial — no clinical precedent yet (not a negative).</div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <Header accent={accent} muted={muted} />
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 10 }}>
        <div>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Drugs in disease trials</div>
          <div style={{ fontWeight: 900, fontSize: 18, color: accent }}>{nDrugs}</div>
        </div>
        <div>
          <div style={{ color: muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800 }}>Max phase in disease</div>
          <div style={{ fontWeight: 900, fontSize: 18, color: text }}>{phase ? `Phase ${phase}` : '—'}</div>
        </div>
      </div>
      {drugs.length > 0 && (
        <div style={{ marginTop: 10, color: text, fontSize: 11, lineHeight: 1.5 }}>
          <span style={{ color: muted, fontWeight: 800, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Drugs · </span>
          {drugs.slice(0, 8).join(', ')}{drugs.length > 8 ? ` +${drugs.length - 8} more` : ''}
        </div>
      )}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: `1px solid ${border}`, color: muted, fontSize: 10, lineHeight: 1.5 }}>
        Source: <strong style={{ color: text }}>Open Targets</strong> · drugs hitting {geneSymbol} with a registered trial in {currentDisease}. Phase is that trial's own phase in this disease, not the drug's global approval status.
      </div>
    </div>
  );
};

const Header: React.FC<{ accent: string; muted: string }> = ({ accent, muted }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Clinical · Open Targets</span>
    <span title="Drugs known to hit this target that have at least one registered trial in the active disease, and the highest phase those disease trials reached. Curated target-to-drug attribution (not text matching). Phase is per-trial and per-disease, so a drug approved for another indication does not count as approved here. 0 means no clinical precedent yet - a neutral novelty signal, not a negative." style={{ fontSize: 10, color: muted, cursor: 'help' }}>ⓘ</span>
    <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Open Targets</span>
  </div>
);

export default ClinicalPanel;
