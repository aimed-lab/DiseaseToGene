import React from 'react';
import ConstraintPanel from './ConstraintPanel';
import ExpressionPanel from './ExpressionPanel';
import DependencyPanel from './DependencyPanel';
import MutationPanel from './MutationPanel';
import DruggabilityPanel from './DruggabilityPanel';
import PocketStructurePanel from './PocketStructurePanel';
import ModalityPanel from './ModalityPanel';
import ClinicalPanel from './ClinicalPanel';
import LiteraturePanel from './LiteraturePanel';
import EvidenceCardsPanel from './EvidenceCardsPanel';

// ── On-demand gene-detail drawer ──────────────────────────────────────────────
// Opens for ANY gene symbol (e.g. a gene from a stored snapshot in the Funnel /
// Rankings, which was never search-loaded). Reuses the existing drill-down panels
// — they all fetch by symbol on demand — so no new data logic is needed. Slides in
// from the right with a backdrop. ADDITIVE.

interface Props {
  geneSymbol: string | null;
  diseaseName: string;
  theme?: 'dark' | 'light';
  onClose: () => void;
}

export const GeneDetailDrawer: React.FC<Props> = ({ geneSymbol, diseaseName, theme = 'light', onClose }) => {
  const isDark = theme === 'dark';
  if (!geneSymbol) return null;
  const panelBg = isDark ? '#0b1220' : '#ffffff';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const ink = isDark ? '#e2e8f0' : '#0f172a';
  const muted = isDark ? '#64748b' : '#94a3b8';

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(2,6,23,0.45)', display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 'min(480px, 92vw)', height: '100%', background: panelBg, borderLeft: `1px solid ${border}`, boxShadow: '-12px 0 32px rgba(2,6,23,0.25)', display: 'flex', flexDirection: 'column' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: `1px solid ${border}`, flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, color: ink }}>{geneSymbol}</div>
            <div style={{ fontSize: 11, color: muted }}>{diseaseName || 'evidence'} · on-demand drill-down</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', border: `1px solid ${border}`, background: 'transparent', color: muted, borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
        </div>
        {/* body — the existing panels, fetched on demand by symbol */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 16px 24px' }}>
          <div style={{ fontSize: 10.5, color: muted, margin: '6px 0 2px', fontStyle: 'italic' }}>
            Live evidence is fetched for this gene now — expression, dependency &amp; gnomAD constraint read the reference tables; mutation, druggability, clinical &amp; literature fetch from cBioPortal / ChEMBL / ClinicalTrials.gov / Europe PMC.
          </div>
          <DruggabilityPanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
          <ModalityPanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
          <PocketStructurePanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
          <MutationPanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
          <ExpressionPanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
          <DependencyPanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
          <ConstraintPanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
          <ClinicalPanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
          <LiteraturePanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
          <EvidenceCardsPanel geneSymbol={geneSymbol} currentDisease={diseaseName} theme={theme} />
        </div>
      </div>
    </div>
  );
};

export default GeneDetailDrawer;
