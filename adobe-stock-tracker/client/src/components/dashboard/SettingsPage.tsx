import { useEffect, useState } from 'react';
import { Check, Database, KeyRound, Loader2, Server, ShieldCheck, Wifi } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchSettings, testApiConnection } from '@/lib/api';
import type { ApiConnectionStatus, ApiError, SettingsResponse, TestConnectionResponse } from '@/types';

type TestState = 'idle' | 'testing' | 'done';

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? 'success' : 'secondary'} className="gap-1">
      <span className={ok ? 'text-emerald-600' : ''}>{ok ? <Check className="size-3" /> : null}</span>
      {label}
    </Badge>
  );
}

function connectionBadge(status: ApiConnectionStatus): { variant: 'success' | 'destructive' | 'warning' | 'secondary'; label: string } {
  switch (status) {
    case 'connected':
      return { variant: 'success', label: 'Connected' };
    case 'not_configured':
      return { variant: 'secondary', label: 'Not configured' };
    case 'invalid':
      return { variant: 'destructive', label: 'Invalid credentials' };
    case 'rate_limited':
      return { variant: 'warning', label: 'Rate limited' };
    default:
      return { variant: 'destructive', label: 'Connection failed' };
  }
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <dt className="shrink-0 font-medium text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-mono">{value}</dd>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [test, setTest] = useState<TestConnectionResponse | null>(null);
  const [testState, setTestState] = useState<TestState>('idle');
  const [testError, setTestError] = useState<ApiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchSettings(controller.signal)
      .then(setSettings)
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err as ApiError);
      });
    return () => controller.abort();
  }, []);

  const runTest = async () => {
    setTestState('testing');
    setTestError(null);
    setTest(null);
    try {
      const result = await testApiConnection();
      setTest(result);
    } catch (err) {
      setTestError(err as ApiError);
    } finally {
      setTestState('done');
    }
  };

  const badge = test ? connectionBadge(test.status) : null;
  const connected = settings?.apiKeyConfigured ?? false;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Read-only status of this instance. Credentials never appear here — the Adobe Stock API key lives only in{' '}
          <code className="rounded bg-muted px-1">server/.env</code> on this machine.
        </p>
      </div>

      {error ? (
        <p className="text-sm text-destructive">Could not load settings: {error.message}</p>
      ) : !settings ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound className="size-4" />
                Adobe Stock API
              </CardTitle>
              <CardDescription className="text-xs">Official Search API connection status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {connected ? (
                  <StatusPill ok label="API key configured" />
                ) : (
                  <Badge variant="secondary">API key not configured</Badge>
                )}
                {test && badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
              </div>

              <Button
                variant={connected ? 'outline' : 'secondary'}
                size="sm"
                onClick={runTest}
                disabled={testState === 'testing'}
              >
                {testState === 'testing' ? <Loader2 className="animate-spin" /> : <Wifi className="size-3.5" />}
                Test connection
              </Button>

              {testError && <p className="text-xs text-destructive">{testError.message}</p>}
              {test && (
                <p className="text-xs text-muted-foreground">
                  {test.message}
                  {test.latencyMs !== undefined ? ` (${test.latencyMs} ms)` : ''}
                </p>
              )}

              <dl className="space-y-1.5 border-t border-border/70 pt-3">
                <Field label="Product header" value={settings.product} />
                <Field label="Locale" value={settings.locale} />
                <Field label="API base URL" value={settings.apiBaseUrl} />
              </dl>

              {!connected && (
                <p className="text-xs text-muted-foreground">
                  Set <code className="rounded bg-muted px-1">ADOBE_STOCK_API_KEY</code> in{' '}
                  <code className="rounded bg-muted px-1">server/.env</code> and restart to show live assets. Until then the
                  dashboard runs in search-link mode and never fabricates data.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Database className="size-4" />
                Data source
              </CardTitle>
              <CardDescription className="text-xs">Provider, history store and authorization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{settings.provider}</Badge>
                {settings.database.enabled ? (
                  <StatusPill ok label={settings.database.label} />
                ) : (
                  <Badge variant="secondary">{settings.database.label}</Badge>
                )}
                {settings.licenseHistory.authorized ? (
                  <StatusPill ok label="License history authorized" />
                ) : (
                  <Badge variant="secondary">License history not authorized</Badge>
                )}
              </div>
              <dl className="space-y-1.5 border-t border-border/70 pt-3">
                <Field label="Site search base URL" value={settings.siteSearchBaseUrl} />
              </dl>
              <p className="text-xs text-muted-foreground">
                {settings.database.enabled
                  ? 'Historical observations persist across restarts.'
                  : 'Historical observations are session-only. Set DATABASE_URL in server/.env for persistent history.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Server className="size-4" />
                Environment
              </CardTitle>
              <CardDescription className="text-xs">Runtime configuration of this instance</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1.5">
                <Field label="Node environment" value={settings.environment.nodeEnv} />
                <Field label="API port" value={String(settings.environment.port)} />
                <Field label="Rate limit" value={`${settings.environment.rateLimitMax} req / ${settings.environment.rateLimitWindowMs} ms`} />
                <Field label="Result cache TTL" value={`${settings.environment.cacheTtlMs} ms`} />
                <Field label="Observation scheduler" value={settings.environment.observationSchedulerEnabled ? 'enabled' : 'disabled'} />
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="size-4" />
                Privacy
              </CardTitle>
              <CardDescription className="text-xs">How this tool is built</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                All asset data comes from the <strong>official Adobe Stock API</strong> with your own key. The key is used
                server-side only and is never exposed to the browser, stored in localStorage, or committed to the repository.
              </p>
              <p>
                Without credentials the app runs in search-link mode and opens Adobe's own result pages. Download counts and
                upload dates that the API does not expose are shown as unavailable — nothing is fabricated.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
