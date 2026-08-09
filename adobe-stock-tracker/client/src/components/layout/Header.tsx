import { BarChart3, History, Github, Settings } from 'lucide-react';

import { cn } from '@/lib/utils';

export type AppPage = 'dashboard' | 'license-history' | 'settings';

interface HeaderProps {
  page: AppPage;
  onNavigate: (page: AppPage) => void;
}

export function Header({ page, onNavigate }: HeaderProps) {
  const navButton = (target: AppPage, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => onNavigate(target)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
        page === target
          ? 'border-primary/40 bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
      aria-current={page === target ? 'page' : undefined}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <button
          type="button"
          onClick={() => onNavigate('dashboard')}
          className="flex items-center gap-2.5 text-left"
          aria-label="Back to dashboard"
        >
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <BarChart3 className="size-4" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold tracking-tight">Adobe Stock Tracker</h1>
            <p className="text-xs text-muted-foreground">Open-source contributor analytics</p>
          </div>
        </button>
        <div className="flex items-center gap-2">
          {navButton('dashboard', 'Dashboard', <BarChart3 className="size-3.5" />)}
          {navButton('license-history', 'My License History', <History className="size-3.5" />)}
          {navButton('settings', 'Settings', <Settings className="size-3.5" />)}
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex"
            aria-label="Open-source project"
          >
            <Github className="size-3.5" />
            Open source
          </a>
        </div>
      </div>
    </header>
  );
}
