// diseaseAccent.ts ─────────────────────────────────────────────────────────────
// One accent colour per disease, applied to the app FRAME (disease bar, logo badge, active
// tab, view-title chips) — never to content. The idea is Amazon's contextual colouring:
// after a few sessions the frame colour alone tells you which disease you are in, before
// you read a single number, and a screenshot cannot be mistaken for another disease.
//
// Client-safe (no fs): the registry file is server-side. Match by MONDO id first, then by
// name; anything unlisted gets a stable colour hashed from its id, so every disease has one.
// To change a colour, edit NAMED below — one line.

export interface DiseaseAccent { hex: string; soft: string; strong: string; name: string }

const DEFAULT: DiseaseAccent = { hex: '#2563eb', soft: 'rgba(37,99,235,0.10)', strong: '#1d4ed8', name: 'blue' };

const NAMED: Array<{ match: RegExp; hex: string; strong: string; name: string }> = [
  { match: /MONDO_0004975|alzheimer/i,                 hex: '#7c3aed', strong: '#6d28d9', name: 'violet'  },
  { match: /MONDO_0006047|MONDO_0005192|pancrea/i,     hex: '#d97706', strong: '#b45309', name: 'amber'   },
  { match: /MONDO_0018177|glioblastoma/i,              hex: '#0d9488', strong: '#0f766e', name: 'teal'    },
  { match: /MONDO_0005061|MONDO_0008903|lung/i,        hex: '#0284c7', strong: '#0369a1', name: 'sky'     },
  { match: /MONDO_0005575|colorectal|colon/i,          hex: '#059669', strong: '#047857', name: 'emerald' },
  { match: /MONDO_0007254|breast/i,                    hex: '#db2777', strong: '#be185d', name: 'pink'    },
  { match: /prostate/i,                                hex: '#4f46e5', strong: '#4338ca', name: 'indigo'  },
  { match: /parkinson/i,                               hex: '#ca8a04', strong: '#a16207', name: 'yellow'  },
];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const soften = (hex: string) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},0.10)`; };

// Stable fallback: hash the id/name to a hue. Saturation/lightness fixed so it reads as an
// accent in both themes and never collides with the greys.
function hashed(key: string): DiseaseAccent {
  let h = 0; for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return { hex: `hsl(${hue} 62% 42%)`, strong: `hsl(${hue} 62% 34%)`, soft: `hsl(${hue} 62% 42% / 0.10)`, name: `hue-${hue}` };
}

export function accentFor(disease?: { id?: string | null; name?: string | null } | null): DiseaseAccent {
  if (!disease || (!disease.id && !disease.name)) return DEFAULT;
  const key = `${disease.id || ''} ${disease.name || ''}`;
  const hit = NAMED.find(n => n.match.test(key));
  if (hit) return { hex: hit.hex, strong: hit.strong, soft: soften(hit.hex), name: hit.name };
  return hashed(disease.id || disease.name || '');
}

// Push the accent into CSS variables on <html>, so any component can use
// var(--disease-accent) without threading props. Also stamps data-disease for CSS hooks.
export function applyDiseaseAccent(disease?: { id?: string | null; name?: string | null } | null): DiseaseAccent {
  const a = accentFor(disease);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.style.setProperty('--disease-accent', a.hex);
    root.style.setProperty('--disease-accent-strong', a.strong);
    root.style.setProperty('--disease-accent-soft', a.soft);
    if (disease?.id || disease?.name) root.setAttribute('data-disease', String(disease.id || disease.name));
    else root.removeAttribute('data-disease');
  }
  return a;
}
