// nav.ts — minimal URL routing without a router library.
// The app is state-driven (viewMode + portal overlays), so instead of pulling in
// react-router we just push to the History API and notify listeners. App subscribes
// to `popstate` and re-reads window.location.pathname to decide what to render, which
// gives shareable URLs like /Methodologies while keeping the existing architecture.

export const ROUTES = {
  home: '/',
  methodology: '/Methodologies',
  modality: '/Modality',
  resetPassword: '/reset-password',
} as const;

// Navigate to a path: update the address bar and wake up any popstate listeners
// (pushState alone does NOT emit popstate, so we dispatch it ourselves).
export function navigate(to: string): void {
  if (window.location.pathname === to) return;
  window.history.pushState({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

// True for /Methodologies, /methodology, etc. — tolerant of casing and trailing slash.
export function isMethodologyPath(pathname: string = window.location.pathname): boolean {
  return /^\/methodolog/i.test(pathname);
}

// True for /Modality (the full-page modality-fit analysis). Casing-tolerant.
export function isModalityPath(pathname: string = window.location.pathname): boolean {
  return /^\/modality/i.test(pathname);
}

// True for /reset-password — where a password-recovery link lands to set a new password.
export function isResetPasswordPath(pathname: string = window.location.pathname): boolean {
  return /^\/reset-password/i.test(pathname);
}

// A reset email may land on ANY path carrying a "#...type=recovery" hash (older emails still
// point at localhost root). Move such a stray hash to /reset-password, preserving it, BEFORE
// Supabase consumes it — so the reset form always catches the handoff. Call once at startup.
export function catchRecoveryHash(): void {
  if (typeof window === 'undefined') return;
  if (/type=recovery/.test(window.location.hash) && !isResetPasswordPath(window.location.pathname)) {
    window.history.replaceState(null, '', ROUTES.resetPassword + window.location.search + window.location.hash);
  }
}

// Read a query param (e.g. the preselected gene passed from the board report card).
export function queryParam(key: string): string | null {
  try { return new URLSearchParams(window.location.search).get(key); } catch { return null; }
}
