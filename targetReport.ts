// targetReport.ts ─────────────────────────────────────────────────────────────
// F1.3 — "Generate a report from the application" (the professor's ask): turn a
// selected target into a self-contained, printable HTML dossier that answers
// "is this a good target, and are there better ones — why or why not?".
//
// Pure + framework-free: it takes already-computed inputs (verdict, alternatives,
// per-criterion breakdowns) and returns one HTML string. No React, no fetch, no
// Date.now — the caller passes generatedAt. Because it reuses the SAME verdict /
// alternatives / breakdown the on-screen report card uses, the document can never
// disagree with the UI. Reads as the investigator's starting point (F4 will let
// them customise it).

import type { TargetVerdict, Alternative, CriterionBreakdown } from './rankingBoard';

export interface ReportCriterion {
  key: string;
  label: string;
  definition: string;
  source: string;
  standing: number | null;   // 0–100 standing vs field leader (null = no data)
  weightPct: number;         // active-renormalised weight, %
  hasData: boolean;
  breakdown: CriterionBreakdown;
}

export interface TargetReportInput {
  gene: string;
  diseaseName: string;
  modalityLabel: string;
  snapshotLabel?: string | null;
  verdict: TargetVerdict;
  criteria: ReportCriterion[];
  alternatives: Alternative[];
  generatedAt: string;       // caller-supplied (e.g. new Date().toLocaleString())
  appUrl?: string;           // product URL shown in the report header/footer (e.g. target.smartdrugdiscovery.com)
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const toneColor = (tone: TargetVerdict['tone']): string =>
  tone === 'top' ? '#059669' : tone === 'strong' ? '#0d9488' : tone === 'low' ? '#e11d48' : '#64748b';

const bar = (pct: number | null, color = '#2563eb'): string => {
  const w = pct == null ? 0 : Math.max(2, Math.min(100, pct));
  return `<div class="bar"><div class="bar-fill" style="width:${w}%;background:${color}"></div></div>`;
};

function alternativesSection(a: Alternative[], gene: string): string {
  if (!a.length) {
    return `<p class="muted">No comparable target (same protein family or STRING network neighbour) outranks ${esc(gene)} in this snapshot — it is the strongest option in its comparable set.</p>`;
  }
  const rows = a.map(x => `
    <tr>
      <td class="num">#${x.boardRank.toLocaleString()}</td>
      <td class="mono strong">${esc(x.symbol)}</td>
      <td class="num strong">${x.display}</td>
      <td>${x.tags.map(t => `<span class="tag tag-${t}">${t}</span>`).join(' ')}</td>
      <td class="muted">${x.wins.length ? esc(x.wins.join(', ')) : 'higher overall score'}</td>
    </tr>`).join('');
  return `
    <table class="tbl">
      <thead><tr><th>Rank</th><th>Target</th><th>Score</th><th>Why comparable</th><th>Beats ${esc(gene)} on</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="fine">Comparable = same protein family (<span class="tag tag-family">family</span>) or a direct STRING interaction partner (<span class="tag tag-network">network</span>). "Beats on" lists the criteria where the alternative out-scores ${esc(gene)}.</p>`;
}

function criterionCard(c: ReportCriterion): string {
  const metricRows = c.breakdown.metrics.map(m => `
    <tr>
      <td>${esc(m.label)}</td>
      <td class="mono">${m.value == null ? '<span class="muted">—</span>' : esc(m.value)}</td>
      <td><span class="kind kind-${m.kind}">${m.kind}</span></td>
      <td class="fine muted">${esc(m.note ?? '')}</td>
    </tr>`).join('');
  const standing = c.hasData && c.standing != null ? `${Math.round(c.standing)} <span class="muted">/100 vs field</span>` : '<span class="muted">no data</span>';
  return `
    <div class="crit">
      <div class="crit-head">
        <div>
          <span class="crit-label">${esc(c.label)}</span>
          <span class="wt">weight ${Math.round(c.weightPct)}%</span>
        </div>
        <div class="crit-standing">${standing}</div>
      </div>
      ${bar(c.hasData ? c.standing : null)}
      <p class="def">${esc(c.definition)}</p>
      <p class="fine muted">Formula: ${esc(c.breakdown.formula)}</p>
      <table class="tbl sub"><thead><tr><th>Metric</th><th>Value</th><th>Type</th><th>Meaning</th></tr></thead><tbody>${metricRows}</tbody></table>
      <p class="fine muted">Source: ${esc(c.source)}</p>
    </div>`;
}

export function buildTargetReportHTML(input: TargetReportInput): string {
  const { gene, diseaseName, modalityLabel, snapshotLabel, verdict, criteria, alternatives, generatedAt } = input;
  const appUrl = input.appUrl || 'target.smartdrugdiscovery.com';
  const tc = toneColor(verdict.tone);
  const heldBack = [...verdict.drags, ...verdict.gaps.map(g => `${g} (no data)`)];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(gene)} — target report (${esc(diseaseName)})</title>
<style>
  :root { --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#f8fafc; }
  * { box-sizing:border-box; }
  body { font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; color:var(--ink); margin:0; background:#fff; line-height:1.5; }
  .wrap { max-width:900px; margin:0 auto; padding:40px 32px 64px; }
  h1 { font-size:26px; margin:0 0 2px; }
  h2 { font-size:15px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:34px 0 12px; border-bottom:1px solid var(--line); padding-bottom:6px; }
  .sub-title { color:var(--muted); font-size:13px; margin:0 0 20px; }
  .brand { font-size:11px; font-weight:800; letter-spacing:.04em; color:#2563eb; text-transform:lowercase; margin-bottom:6px; }
  .verdict { border:1px solid var(--line); border-left:5px solid ${tc}; border-radius:10px; padding:16px 18px; background:var(--bg); }
  .tier { font-weight:800; font-size:18px; color:${tc}; }
  .rank { font-weight:600; margin-top:2px; }
  .callout { margin-top:10px; font-size:14px; }
  .callout b.s { color:#059669; } .callout b.h { color:#d97706; }
  .bar { height:7px; background:#eef2f7; border-radius:4px; overflow:hidden; margin:6px 0; }
  .bar-fill { height:100%; border-radius:4px; }
  table.tbl { width:100%; border-collapse:collapse; font-size:13px; margin:8px 0; }
  table.tbl th { text-align:left; font-size:10px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); border-bottom:1px solid var(--line); padding:6px 8px; }
  table.tbl td { padding:6px 8px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
  table.sub th, table.sub td { padding:4px 8px; }
  .num { text-align:right; font-variant-numeric:tabular-nums; } .strong { font-weight:700; } .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .muted { color:var(--muted); } .fine { font-size:11px; }
  .crit { border:1px solid var(--line); border-radius:10px; padding:14px 16px; margin:12px 0; }
  .crit-head { display:flex; justify-content:space-between; align-items:baseline; }
  .crit-label { font-weight:700; font-size:15px; } .wt { color:var(--muted); font-size:11px; margin-left:8px; }
  .crit-standing { font-weight:700; font-variant-numeric:tabular-nums; }
  .def { font-size:13px; color:#334155; margin:8px 0 4px; }
  .tag { font-size:9px; font-weight:700; text-transform:uppercase; padding:1px 5px; border-radius:4px; }
  .tag-family { background:#ede9fe; color:#7c3aed; } .tag-network { background:#cffafe; color:#0891b2; }
  .kind { font-size:9px; font-weight:700; text-transform:uppercase; padding:1px 5px; border-radius:4px; }
  .kind-fact { background:#dcfce7; color:#16a34a; } .kind-prediction { background:#fef3c7; color:#b45309; }
  .toolbar { position:sticky; top:0; background:#fff; border-bottom:1px solid var(--line); padding:10px 32px; display:flex; gap:10px; align-items:center; }
  .toolbar button { font:inherit; font-size:13px; font-weight:600; padding:7px 14px; border-radius:8px; border:1px solid var(--line); background:#2563eb; color:#fff; cursor:pointer; }
  .toolbar .ghost { background:#fff; color:var(--ink); }
  footer { margin-top:40px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; }
  @media print { .toolbar { display:none; } .wrap { padding:0; max-width:none; } .crit, .verdict { break-inside:avoid; } }
</style></head>
<body>
<div class="toolbar">
  <button onclick="window.print()">Print / Save as PDF</button>
  <span class="muted fine">Disease2Target · <a href="https://${esc(appUrl)}" style="color:inherit">${esc(appUrl)}</a></span>
</div>
<div class="wrap">
  <div class="brand">${esc(appUrl)}</div>
  <h1>${esc(gene)}</h1>
  <p class="sub-title">Target report · ${esc(diseaseName)} · ${esc(modalityLabel)}${snapshotLabel ? ` · ${esc(snapshotLabel)}` : ''} · generated ${esc(generatedAt)}</p>

  <div class="verdict">
    <div class="tier">${esc(verdict.tier)}</div>
    <div class="rank">Rank #${verdict.rank.toLocaleString()} of ${verdict.total.toLocaleString()} · top ${Math.max(1, Math.round(verdict.pctTop * 100))}%</div>
    <div class="callout">
      ${verdict.strengths.length ? `<div><b class="s">Strong on:</b> ${esc(verdict.strengths.join(', '))}</div>` : ''}
      ${heldBack.length ? `<div><b class="h">Held back by:</b> ${esc(heldBack.join(', '))}</div>` : ''}
      ${!verdict.isTop ? `<div class="muted fine" style="margin-top:6px">Not among the top candidates for this disease — see stronger alternatives below.</div>` : ''}
    </div>
  </div>

  <h2>Are there better targets?</h2>
  ${alternativesSection(alternatives, gene)}

  <h2>Evidence by criterion</h2>
  ${criteria.map(criterionCard).join('')}

  <footer>
    Generated by <strong>Disease2Target</strong> · <a href="https://${esc(appUrl)}" style="color:inherit">${esc(appUrl)}</a>. Scores are a transparent weighted sum across the criteria with data in this snapshot (leader = 100), re-weighted for the <strong>${esc(modalityLabel)}</strong> modality. "Standing vs field" is each criterion relative to the strongest target in the field. Items tagged <span class="kind kind-prediction">prediction</span> are model outputs; <span class="kind kind-fact">fact</span> items are measured evidence. This report is a starting point for investigator review, not a clinical recommendation.
  </footer>
</div>
</body></html>`;
}
