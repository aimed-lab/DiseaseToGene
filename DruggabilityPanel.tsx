import React, { useEffect, useState } from 'react';
import { getChEMBLDruggability, type ChEMBLDruggability } from './chemblService';

interface Props {
  geneSymbol: string;
  currentDisease?: string;     // passed from the app's active disease (replaces localStorage)
  theme?: 'dark' | 'light';
}

const LABEL_COLORS: Record<string, string> = {
  'Known Drug Target': '#16a34a',   // green
  'Being Pursued':     '#2563eb',   // blue
  'Novel':             '#9333ea',   // purple
  'Uncharted':         '#6b7280',   // gray
};

// How thoroughly the target has been chemically characterized in ChEMBL.
//  >100 → heavily studied · 10–100 → moderate · <10 → sparse
const compoundTier = (n: number): string =>
  n > 100 ? 'heavily studied' : n >= 10 ? 'moderate' : n > 0 ? 'sparse' : '';

export const DruggabilityPanel: React.FC<Props> = ({ geneSymbol, currentDisease = '', theme = 'light' }) => {
  const [data, setData] = useState<ChEMBLDruggability | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    getChEMBLDruggability(geneSymbol).then(result => {
      if (!active) return;          // avoid setting state after unmount / gene switch
      setData(result);
      setLoading(false);
    });
    return () => { active = false; };
  }, [geneSymbol]);

  const rootClass = `druggability-panel${theme === 'dark' ? ' dark' : ''}`;

  if (loading) {
    return (
      <div className={`${rootClass} loading`}>
        <span className="spinner" /> Fetching ChEMBL data for {geneSymbol}...
      </div>
    );
  }

  if (!data || data.error) {
    return (
      <div className={`${rootClass} error`}>
        ChEMBL: {data?.error || 'No data found'}
      </div>
    );
  }

  const labelColor = LABEL_COLORS[data.label] || '#6b7280';

  return (
    <div className={rootClass}>
      {/* Header row */}
      <div className="panel-header">
        <span className="panel-title">Druggability</span>
        <span className="label-badge" style={{ backgroundColor: labelColor }}>
          {data.label}
        </span>
        <span className="score-badge">
          Score: {data.druggabilityScore.toFixed(2)}
        </span>
      </div>

      {/* Modalities */}
      <div className="modality-row">
        <ModalityTag active={data.modalities.antibody} label="Antibody" />
        <ModalityTag active={data.modalities.smallMolecule} label="Small Molecule" />
        <ModalityTag active={data.modalities.protac} label="PROTAC" />
        <span
          className="confidence-note"
          title="Modalities are predicted from the target's cellular location (Gene Ontology) data — not experimentally confirmed."
        >
          Confidence: {data.modalities.confidence}
        </span>
      </div>

      {/* Compound info */}
      {data.bestCompound ? (
        <div className="compound-row">
          <div className="stat">
            <span className="stat-label">Best IC50</span>
            <span className="stat-value">{data.bestCompound.ic50Nm?.toFixed(1)} nM</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total compounds</span>
            <span className="stat-value">
              {data.totalCompounds}
              <span style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', marginLeft: 6 }}>
                {compoundTier(data.totalCompounds)}
              </span>
            </span>
          </div>
          {data.bestCompound.documentYear && (
            <div className="stat">
              <span className="stat-label">First reported</span>
              <span className="stat-value">{data.bestCompound.documentYear}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="no-compounds">No compounds found in ChEMBL</div>
      )}

      {/* Drug indications */}
      {data.drugIndications.length > 0 && (
        <div className="indications-section">
          <div className="section-label">Tested in diseases</div>
          {data.drugIndications.slice(0, 3).map((ind, i) => (
            <div key={i} className="indication-row">
              <span className="disease-name">{ind.diseaseName}</span>
              <span className="phase-badge">Phase {ind.maxPhase}</span>
            </div>
          ))}
          {data.drugIndications.length > 3 && (
            <div className="more-note">+{data.drugIndications.length - 3} more diseases</div>
          )}
        </div>
      )}

      {/* Gap detection — key insight */}
      {data.drugIndications.length > 0 && (
        <GapDetector geneSymbol={geneSymbol} indications={data.drugIndications} currentDisease={currentDisease} />
      )}
    </div>
  );
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const ModalityTag: React.FC<{ active: boolean; label: string }> = ({ active, label }) => (
  <span className={`modality-tag ${active ? 'active' : 'inactive'}`}>
    {active ? '✓' : '✗'} {label}
  </span>
);

// Shows a warning if a drug was tested in other diseases but not the current selected disease
const GapDetector: React.FC<{
  geneSymbol: string;
  indications: ChEMBLDruggability['drugIndications'];
  currentDisease: string;
}> = ({ geneSymbol, indications, currentDisease }) => {
  const testedDiseases = indications.map(i => i.diseaseName.toLowerCase());
  const cur = currentDisease.toLowerCase();
  const testedInCurrentDisease = !!cur && testedDiseases.some(d =>
    d.includes(cur) || cur.includes(d)
  );

  if (!currentDisease || testedInCurrentDisease) return null;

  return (
    <div className="gap-alert">
      ⚠ Drug exists for {geneSymbol} but tested in <strong>{indications[0].diseaseName}</strong>,
      not in your disease. Potential gap opportunity.
    </div>
  );
};

export default DruggabilityPanel;
