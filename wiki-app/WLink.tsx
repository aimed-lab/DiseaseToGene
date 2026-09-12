// wiki-app/WLink.tsx — an in-wiki link. A real <a href> (so middle-click, copy-link and
// hover all work) that routes through nav.navigate on a plain left click.
import React from 'react';
import { navigate } from '../nav';

export function WLink({ to, className, title, children, onClick }: { to: string; className?: string; title?: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <a href={to} className={className} title={title}
      onClick={e => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); onClick?.(); navigate(to);
      }}>
      {children}
    </a>
  );
}
