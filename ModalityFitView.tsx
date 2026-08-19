import React, { useState } from 'react';
import { Atom, MessageSquare, Search, X } from 'lucide-react';
import ModalityFitPanel from './ModalityFitPanel';
import { queryParam } from './nav';

// ModalityFitView — the full-page "modality fit" analysis, reached from the "Modality"
// button next to Methodology (route /Modality). Gives the chart room to breathe instead
// of the narrow report-card column. Optionally arrives with ?gene=SYMBOL (from the board
// report card), in which case it preselects that target and auto-runs.

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
        {onToggleChat && (
          <button onClick={onToggleChat} title={chatOpen ? 'Hide the co-pilot' : 'Ask the co-pilot about this analysis'}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${chatOpen ? '#2563eb' : border}`,
                     background: chatOpen ? '#2563eb' : 'transparent', color: chatOpen ? '#fff' : ink,
                     borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <MessageSquare className="w-4 h-4" />{chatOpen ? 'Co-pilot' : 'Ask co-pilot'}
          </button>
        )}
        <button onClick={onClose} title="Back to the app" style={{ marginLeft: onToggleChat ? 0 : 'auto', border: `1px solid ${border}`, background: 'transparent', color: muted, borderRadius: 8, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X className="w-4 h-4" /></button>
      </div>

      <div style={{ maxWidth: 880, margin: '0 auto', padding: '24px 20px 64px' }}>
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
      </div>
    </div>
  );
}
