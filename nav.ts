// nav.ts — minimal URL routing without a router library.
// The app is state-driven (viewMode + portal overlays), so instead of pulling in
// react-router we just push to the History API and notify listeners. App subscribes
// to `popstate` and re-reads window.location.pathname to decide what to render, which
// gives shareable URLs like /Methodologies while keeping the existing architecture.

export const ROUTES = {
  home: '/',
  methodology: '/Methodologies',
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
