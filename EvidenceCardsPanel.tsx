import React, { useEffect, useState } from 'react';
import { fetchEvidenceCardsForGene, type EvidenceCardRow } from './supabase';

interface Props {
  geneSymbol: string;
  currentDisease?: string;
  theme?: 'dark' | 'light';
}

// Stored evidence cards (from ingested papers) for one gene. Renders nothing if
// the gene has no stored cards, so it only appears where curated content exists.
// Self-contained + fetch-on-mount, same lifecycle as DruggabilityPanel/MutationPanel.
export const EvidenceCardsPanel: React.FC<Props> = ({ geneSymbol, theme = 'light' }) => {
  const isDark = theme === 'dark';
  const [cards, setCards] = useState<EvidenceCardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchEvidenceCardsForGene(geneSymbol).then(rows => {
      if (!active) return;
      setCards(rows);
      setLoading(false);
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [geneSymbol]);

  if (loading || cards.length === 0) return null;   // nothing to show → no block

  const text = isDark ? '#e2e8f0' : '#1e293b';
  const muted = isDark ? '#64748b' : '#94a3b8';
  const border = isDark ? '#1e293b' : '#e2e8f0';
  const accent = '#059669';   // emerald — stored evidence
  const chipBg = isDark ? '#064e3b' : '#d1fae5';

  return (
    <div style={{
      border: `1px solid ${border}`, borderRadius: 12, padding: 14, marginTop: 12,
      background: isDark ? '#0f172a' : '#ffffff', fontSize: 12, color: text,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 800, letterSpacing: '0.04em' }}>Stored Evidence</span>
        <span style={{ fontSize: 10, color: muted }}>{cards.length} card{cards.length > 1 ? 's' : ''} from ingested papers</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 800, color: accent, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          content store
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {cards.map(card => (
          <div key={card.id} style={{ borderTop: `1px solid ${border}`, paddingTop: 8 }}>
            {/* Fact line: drug / action / mutation / disease */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 4 }}>
              {card.drug && <Chip bg={chipBg} color={accent}>{card.drug}</Chip>}
              {card.drug_action && <span style={{ color: muted, fontSize: 11 }}>{card.drug_action}</span>}
              {card.mutation && <Chip bg={chipBg} color={accent}>{card.mutation}</Chip>}
              {card.trial_phase && <span style={{ color: text, fontSize: 11, fontWeight: 700 }}>· {card.trial_phase}</span>}
              {card.disease && <span style={{ color: muted, fontSize: 11 }}>· {card.disease}</span>}
            </div>

            {/* Outcome */}
            {(card.primary_endpoint || card.efficacy_result || card.effect_size) && (
              <div style={{ color: text, fontSize: 11, marginBottom: 3 }}>
                {card.primary_endpoint && <strong>{card.primary_endpoint}: </strong>}
                {card.efficacy_result}{card.efficacy_result && card.effect_size ? ' · ' : ''}{card.effect_size}
              </div>
            )}
            {card.mechanism && <div style={{ color: muted, fontSize: 11, marginBottom: 3 }}>Mechanism: {card.mechanism}</div>}
            {card.key_finding && <div style={{ color: text, fontSize: 11, marginBottom: 4 }}>{card.key_finding}</div>}

            {/* Provenance: the exact source sentence + audit status */}
            {card.source_quote && (
              <div style={{
                fontSize: 10, fontStyle: 'italic', color: muted, lineHeight: 1.5,
                borderLeft: `2px solid ${border}`, paddingLeft: 8, marginTop: 4,
              }}>
                “{card.source_quote}”
              </div>
            )}
            <div style={{ fontSize: 9, color: muted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {card.audit_status}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Chip: React.FC<{ bg: string; color: string; children: React.ReactNode }> = ({ bg, color, children }) => (
  <span style={{ background: bg, color, fontWeight: 800, fontSize: 11, padding: '1px 7px', borderRadius: 999 }}>{children}</span>
);

export default EvidenceCardsPanel;
