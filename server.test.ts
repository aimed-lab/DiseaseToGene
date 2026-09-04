// server.test.ts ─────────────────────────────────────────────────────────────
// Runnable checks for the pure decisions server.ts makes. No test framework —
// run with:  npx tsx --env-file=.env server.test.ts
// Exits non-zero on any failure.
//
// VERCEL=1 is set before the import so server.ts skips app.listen() and the Vite
// dev middleware. Without it, importing the module tries to bind port 3000 and
// the test fails against a dev server that is merely already running.
process.env.VERCEL = '1';

const { pickSnapshot } = await import('./server.ts');

let failures = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${String(got)} want=${String(want)}`}`);
}

// Deliberately out of id order: pickSnapshot must sort, and "newest" must mean
// the highest id rather than whatever the store happened to return first.
const SNAPS = [
  { id: 103, disease_name: 'pancreatic ductal adenocarcinoma' },
  { id: 123, disease_name: 'glioblastoma' },
  { id: 87, disease_name: "Alzheimer's disease" },
];
const pick = (...a: [string?, string?, number?]) => Number(pickSnapshot(SNAPS, ...a)?.id);

// ── The bug this function exists for ──
// Glioblastoma is on screen (ambient name AND ambient snapshot id), and the user
// asks about pancreatic cancer. The named disease must win both.
check('named disease beats the ambient snapshot id', pick('pancreatic', 'glioblastoma', 123), 103);
check('named disease beats the ambient disease name', pick('pancreatic', 'glioblastoma', undefined), 103);
check('named disease beats a bare ambient id', pick("Alzheimer's", undefined, 123), 87);

// ── Ambient context still governs when the user names nothing ──
check('ambient snapshot id used when no disease is named', pick(undefined, undefined, 123), 123);
check('ambient id beats the ambient name when they disagree', pick(undefined, 'pancreatic', 123), 123);
check('ambient disease name used when there is no id', pick(undefined, 'glioblastoma', undefined), 123);
check('newest snapshot when there is no context at all', pick(undefined, undefined, undefined), 123);

// ── Matching is loose in both directions and case-insensitive ──
// The screen says "pancreatic ductal adenocarcinoma"; a user types "pancreatic",
// and a tool call may pass the full stored label back. Both must resolve.
check('a short query matches a longer stored name', pick('pancreatic'), 103);
check('a long query matches a shorter stored name', pick('glioblastoma multiforme'), 123);
check('matching ignores case', pick('GLIOBLASTOMA'), 123);
check('an apostrophe in the stored name is not special', pick("alzheimer's disease"), 87);

// ── Falling through rather than failing ──
// A disease we do not hold must not error and must not silently answer from it;
// the caller falls back to context, and EVIDENCE_RULES makes the model state
// which snapshot the numbers came from.
check('an unknown disease falls back to the ambient id', pick('psoriasis', 'glioblastoma', 103), 103);
check('an unknown disease falls back to the ambient name', pick('psoriasis', 'glioblastoma'), 123);
check('an unknown disease with no context falls back to newest', pick('psoriasis'), 123);
check('blank and whitespace-only names are ignored', pick('   ', '  ', 87), 87);

// ── Degenerate inputs ──
check('an empty store yields nothing', pickSnapshot([], 'pancreatic', 'glioblastoma', 123), undefined);
check('a missing store yields nothing', pickSnapshot(undefined as any), undefined);
check('an id that is not held falls back to newest', pick(undefined, undefined, 999), 123);

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
