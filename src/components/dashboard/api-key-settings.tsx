"use client"

import { useState } from "react"
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  WifiOff,
  X,
  XCircle,
  Zap,
} from "lucide-react"

import { maskKey } from "@/lib/api-keys"
import {
  friendlyApiError,
  testGeminiConnection,
  testMistralConnection,
  testOpenAIConnection,
} from "@/lib/generate"
import {
  applyHealthResult,
  formatTimeAgo,
  maskKeyBullets,
  summarizeKeyHealth,
  testKeyHealth,
  type KeyHealthSummary,
} from "@/lib/key-health"
import { refreshProviderModels } from "@/lib/models"
import type { ApiKeyEntry, ApiProvider, KeyHealthStatus } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

type ConnStatus = "idle" | "testing" | "connected" | "failed";

const PROVIDER_META: Record<
  ApiProvider,
  { label: string; title: string; placeholder: string }
> = {
  gemini: {
    label: "Gemini",
    title: "Gemini API Keys",
    placeholder: "AIza… (paste Gemini key)",
  },
  openai: {
    label: "OpenAI",
    title: "OpenAI API Keys",
    placeholder: "sk-… (paste OpenAI key)",
  },
  mistral: {
    label: "Mistral AI",
    title: "Mistral AI API Keys",
    placeholder: "… (paste Mistral key)",
  },
};

const HEALTH_META: Record<
  KeyHealthStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    badgeClass: string;
    textClass: string;
  }
> = {
  working: {
    label: "Active / Working",
    icon: CheckCircle2,
    badgeClass:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    textClass: "text-emerald-600 dark:text-emerald-400",
  },
  "rate-limited": {
    label: "Rate Limited",
    icon: AlertTriangle,
    badgeClass:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    textClass: "text-amber-600 dark:text-amber-400",
  },
  "quota-exhausted": {
    label: "Daily Quota Exhausted",
    icon: AlertTriangle,
    badgeClass:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    textClass: "text-amber-600 dark:text-amber-400",
  },
  "invalid-key": {
    label: "Invalid API Key",
    icon: XCircle,
    badgeClass:
      "bg-destructive/10 text-destructive dark:text-red-400",
    textClass: "text-destructive dark:text-red-400",
  },
  "permission-denied": {
    label: "Permission Denied",
    icon: ShieldAlert,
    badgeClass:
      "bg-destructive/10 text-destructive dark:text-red-400",
    textClass: "text-destructive dark:text-red-400",
  },
  "api-disabled": {
    label: "API Disabled",
    icon: ShieldAlert,
    badgeClass:
      "bg-destructive/10 text-destructive dark:text-red-400",
    textClass: "text-destructive dark:text-red-400",
  },
  "model-unavailable": {
    label: "Model Unavailable",
    icon: XCircle,
    badgeClass:
      "bg-destructive/10 text-destructive dark:text-red-400",
    textClass: "text-destructive dark:text-red-400",
  },
  "server-error": {
    label: "Temporary Server Error",
    icon: WifiOff,
    badgeClass:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    textClass: "text-amber-600 dark:text-amber-400",
  },
  "not-tested": {
    label: "Not Tested",
    icon: HelpCircle,
    badgeClass: "bg-muted text-muted-foreground",
    textClass: "text-muted-foreground",
  },
};

function KeyHealthBadge({
  status,
  testing,
}: {
  status: KeyHealthStatus;
  testing: boolean;
}) {
  const meta = HEALTH_META[status] ?? HEALTH_META["not-tested"];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1", meta.badgeClass)}>
      {testing ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Icon className="size-3" />
      )}
      {testing ? "Testing…" : meta.label}
    </Badge>
  );
}

function KeyHealthDetails({ entry }: { entry: ApiKeyEntry }) {
  const [open, setOpen] = useState(false);
  const health = entry.health;
  if (!health) return null;

  const meta = HEALTH_META[health.status] ?? HEALTH_META["not-tested"];
  const Icon = meta.icon;

  return (
    <div className="flex flex-col gap-1 border-t border-border/60 pt-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className={cn("flex items-center gap-1.5 text-xs", meta.textClass)}>
          <Icon className="size-3.5 shrink-0" />
          <span>{health.message}</span>
        </p>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex shrink-0 items-center gap-1 rounded p-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {open ? "Hide details" : "Details"}
          {open ? (
            <ChevronUp className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </button>
      </div>

      {open ? (
        <dl className="grid grid-cols-1 gap-1 rounded-md bg-muted/50 p-2 text-[11px] sm:grid-cols-2">
          {health.checkedAt ? (
            <div className="flex gap-1">
              <dt className="text-muted-foreground">Checked</dt>
              <dd className="font-mono">
                {formatTimeAgo(health.checkedAt)} ·{" "}
                {new Date(health.checkedAt).toLocaleTimeString()}
              </dd>
            </div>
          ) : null}
          {health.httpStatus != null ? (
            <div className="flex gap-1">
              <dt className="text-muted-foreground">HTTP</dt>
              <dd className="font-mono">{health.httpStatus}</dd>
            </div>
          ) : null}
          {health.apiCode ? (
            <div className="flex gap-1">
              <dt className="text-muted-foreground">Status code</dt>
              <dd className="font-mono">{health.apiCode}</dd>
            </div>
          ) : null}
          {health.model ? (
            <div className="flex gap-1">
              <dt className="text-muted-foreground">Model</dt>
              <dd className="font-mono">{health.model}</dd>
            </div>
          ) : null}
          {health.latencyMs != null ? (
            <div className="flex gap-1">
              <dt className="text-muted-foreground">Latency</dt>
              <dd className="font-mono">{health.latencyMs} ms</dd>
            </div>
          ) : null}
          {health.rawDetail ? (
            <div className="flex flex-col gap-0.5 sm:col-span-2">
              <dt className="text-muted-foreground">Raw response</dt>
              <dd className="max-h-32 overflow-auto rounded bg-background p-1.5 font-mono whitespace-pre-wrap break-words">
                {health.rawDetail}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </div>
  );
}

export function ApiKeySettings() {
  const primaryProvider = useAppStore((state) => state.primaryProvider);
  const apiKeys = useAppStore((state) => state.apiKeys);

  const hasFallback = apiKeys.some(
    (entry) => entry.provider !== primaryProvider && entry.enabled
  );
  const meta = PROVIDER_META[primaryProvider];

  return (
    <div className="flex flex-col gap-5">
      <PrimaryProviderPicker />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">
          <Zap className="size-3" />
          Primary Provider: {meta.label}
        </Badge>
        {hasFallback ? (
          <Badge variant="outline">
            <Check className="size-3" />
            Fallback Available
          </Badge>
        ) : null}
      </div>

      <ProviderKeys
        provider={primaryProvider}
        title={meta.title}
        placeholder={meta.placeholder}
      />

      <p className="text-xs text-muted-foreground">
        Only the primary provider&apos;s keys are shown here. Keys for the other
        providers stay saved and hidden, and they remain active as automatic
        fallbacks in the background. The primary provider is tried first for
        every image; if it is rate-limited or unavailable, the queue switches to
        the next compatible model, then the next key, then the hidden fallback
        providers automatically, retries the same image, and continues without
        losing progress. Keys are saved in browser localStorage and loaded
        automatically. If no active keys are added, a local engine generates
        results on-device.
      </p>
    </div>
  );
}

function PrimaryProviderPicker() {
  const primaryProvider = useAppStore((state) => state.primaryProvider);
  const setPrimaryProvider = useAppStore((state) => state.setPrimaryProvider);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="primary-provider">Primary provider</Label>
      <Select
        id="primary-provider"
        value={primaryProvider}
        onChange={(event) => {
          const value = event.target.value;
          const next: ApiProvider =
            value === "openai"
              ? "openai"
              : value === "mistral"
                ? "mistral"
                : "gemini";
          setPrimaryProvider(next);
          toast(
            "info",
            "Primary provider",
            `Primary Provider: ${
              next === "gemini"
                ? "Gemini"
                : next === "openai"
                  ? "OpenAI"
                  : "Mistral AI"
            }`
          );
        }}
      >
        <option value="gemini">Gemini</option>
        <option value="openai">OpenAI</option>
        <option value="mistral">Mistral AI</option>
      </Select>
      <p className="text-xs text-muted-foreground">
        Used first for every image; the remaining providers are used as
        automatic fallbacks.
      </p>
    </div>
  );
}

function ProviderKeys({
  provider,
  title,
  placeholder,
}: {
  provider: ApiProvider;
  title: string;
  placeholder: string;
}) {
  const apiKeys = useAppStore((state) => state.apiKeys);
  const addApiKey = useAppStore((state) => state.addApiKey);
  const updateApiKey = useAppStore((state) => state.updateApiKey);
  const removeApiKey = useAppStore((state) => state.removeApiKey);
  const keyHealthCheckedAt = useAppStore((state) => state.keyHealthCheckedAt);
  const setKeyHealthCheckedAt = useAppStore(
    (state) => state.setKeyHealthCheckedAt
  );

  const providerKeys = apiKeys.filter((entry) => entry.provider === provider);

  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState(0);
  const [keyValue, setKeyValue] = useState("");
  const [testingKeyIds, setTestingKeyIds] = useState<Set<string>>(new Set());
  const [testingAll, setTestingAll] = useState(false);
  const [testAllSummary, setTestAllSummary] = useState<KeyHealthSummary | null>(
    null
  );

  const clearForm = () => {
    setKeyValue("");
    setVisible(false);
    setStatus("idle");
    setEditingId(null);
  };

  const runKeyHealthTest = async (entry: ApiKeyEntry) => {
    setTestingKeyIds((current) => {
      const next = new Set(current);
      next.add(entry.id);
      return next;
    });
    try {
      const check = await testKeyHealth(entry);
      applyHealthResult(entry.id, check);
      const store = useAppStore.getState();
      store.setKeyHealthCheckedAt(Date.now());
      const meta =
        check.status === "working"
          ? HEALTH_META["working"]
          : HEALTH_META[check.status];
      toast(
        check.status === "working" ? "success" : "info",
        check.status === "working" ? "Key works" : meta.label,
        check.message
      );
      return check;
    } catch (error) {
      const message = friendlyApiError(error);
      const check = {
        status: "server-error" as const,
        message,
        httpStatus: null,
        apiCode: null,
        rawDetail: message,
        model: null,
        latencyMs: null,
        checkedAt: Date.now(),
        cooldownUntil: null,
      };
      applyHealthResult(entry.id, check);
      toast("error", "Health check failed", message);
      return check;
    } finally {
      setTestingKeyIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  };

  const testSingleKey = (entry: ApiKeyEntry) => {
    void runKeyHealthTest(entry);
  };

  const testAllKeys = async () => {
    if (providerKeys.length === 0 || testingAll) return;
    setTestingAll(true);
    setTestAllSummary(null);
    try {
      for (const entry of providerKeys) {
        await runKeyHealthTest(entry);
      }
      const summary = summarizeKeyHealth(providerKeys);
      setTestAllSummary(summary);
      setKeyHealthCheckedAt(Date.now());
    } finally {
      setTestingAll(false);
    }
  };

  const saveKey = () => {
    const trimmed = keyValue.trim();
    if (editingId) {
      if (!trimmed) {
        toast("info", "No changes", "Paste a new key to replace the current one.");
        return;
      }
      updateApiKey(editingId, { key: trimmed });
      toast("success", "Key updated");
    } else {
      if (!trimmed) {
        toast("error", "Enter a key first", `Paste your ${title} API key to add it.`);
        return;
      }
      addApiKey({
        id: crypto.randomUUID(),
        provider,
        key: trimmed,
        enabled: true,
      });
      toast("success", "Key added");
    }
    clearForm();
    void refreshProviderModels(provider, { force: true });
  };

  const startEdit = (id: string) => {
    setEditingId(id);
    setStatus("idle");
    setKeyValue("");
  };

  const testConnection = async () => {
    const trimmed = keyValue.trim();
    if (!trimmed) {
      toast("error", "Enter a key first", `Paste your ${title} API key to test it.`);
      return;
    }

    setStatus("testing");
    try {
      const count =
        provider === "gemini"
          ? await testGeminiConnection(trimmed)
          : provider === "openai"
            ? await testOpenAIConnection(trimmed)
            : await testMistralConnection(trimmed);
      setModelCount(count);
      setStatus("connected");
      if (editingId) {
        updateApiKey(editingId, { key: trimmed });
      } else {
        addApiKey({
          id: crypto.randomUUID(),
          provider,
          key: trimmed,
          enabled: true,
        });
      }
      toast("success", "Connection successful", `${count} models available.`);
      clearForm();
      void refreshProviderModels(provider, { force: true });
    } catch (error) {
      setStatus("failed");
      toast("error", "Connection failed", friendlyApiError(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold tracking-tight">{title}</p>
          <Badge variant="secondary" className="text-xs">
            Primary
          </Badge>
        </div>
        {providerKeys.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={testingAll}
            onClick={testAllKeys}
          >
            {testingAll ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Activity className="size-3.5" />
            )}
            Test All Keys
          </Button>
        ) : null}
      </div>

      {testAllSummary || keyHealthCheckedAt ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-background/60 p-3">
          {testAllSummary ? (
            <p className="text-xs text-muted-foreground">
              {testAllSummary.total} Keys ·{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                {testAllSummary.working} Working
              </span>
              {testAllSummary.rateLimited > 0 ? (
                <>
                  {" · "}
                  <span className="text-amber-600 dark:text-amber-400">
                    {testAllSummary.rateLimited} Rate Limited
                  </span>
                </>
              ) : null}
              {testAllSummary.quotaExhausted > 0 ? (
                <>
                  {" · "}
                  <span className="text-amber-600 dark:text-amber-400">
                    {testAllSummary.quotaExhausted} Quota Exhausted
                  </span>
                </>
              ) : null}
              {testAllSummary.serverError > 0 ? (
                <>
                  {" · "}
                  <span className="text-amber-600 dark:text-amber-400">
                    {testAllSummary.serverError} Server Error
                  </span>
                </>
              ) : null}
              {testAllSummary.invalid > 0 ? (
                <>
                  {" · "}
                  <span className="text-destructive dark:text-red-400">
                    {testAllSummary.invalid} Invalid
                  </span>
                </>
              ) : null}
              {testAllSummary.notTested > 0 ? (
                <>
                  {" · "}
                  <span className="text-muted-foreground">
                    {testAllSummary.notTested} Not Tested
                  </span>
                </>
              ) : null}
            </p>
          ) : null}
          {keyHealthCheckedAt ? (
            <p className="text-[11px] text-muted-foreground">
              Last Checked: {formatTimeAgo(keyHealthCheckedAt)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label>API keys</Label>
        {providerKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No keys added yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {providerKeys.map((entry) => {
              const isTesting = testingKeyIds.has(entry.id);
              const health = entry.health;
              return (
                <li
                  key={entry.id}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg border bg-background/60 p-2",
                    editingId === entry.id && "ring-2 ring-ring/40"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                    <span
                      className={cn(
                        "flex-1 truncate font-mono text-xs",
                        !entry.enabled && "text-muted-foreground line-through"
                      )}
                    >
                      {maskKeyBullets(entry.key)}
                    </span>
                    <KeyHealthBadge
                      status={health?.status ?? "not-tested"}
                      testing={isTesting}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={isTesting || testingAll}
                      onClick={() => testSingleKey(entry)}
                      aria-label={`Test API key ${maskKey(entry.key)}`}
                    >
                      <Activity className="size-4" />
                    </Button>
                    <Switch
                      checked={entry.enabled}
                      onCheckedChange={(checked) =>
                        updateApiKey(entry.id, { enabled: checked })
                      }
                      aria-label={`Toggle API key ${maskKey(entry.key)}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => startEdit(entry.id)}
                      aria-label={`Edit API key ${maskKey(entry.key)}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeApiKey(entry.id)}
                      aria-label={`Delete API key ${maskKey(entry.key)}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {health ? <KeyHealthDetails entry={entry} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={`api-key-${provider}`}>
              {editingId ? "Replace API key" : "New API key"}
            </Label>
            {status !== "idle" ? (
              <Badge
                variant={status === "connected" ? "secondary" : "destructive"}
                className={cn(
                  status === "connected" &&
                    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                )}
              >
                {status === "testing" ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Testing…
                  </>
                ) : status === "connected" ? (
                  <>
                    <Check className="size-3" />
                    Connected · {modelCount} models
                  </>
                ) : (
                  <>
                    <X className="size-3" />
                    Connection failed
                  </>
                )}
              </Badge>
            ) : null}
          </div>
          <div className="relative">
            <Input
              id={`api-key-${provider}`}
              type={visible ? "text" : "password"}
              placeholder={placeholder}
              className="pr-9 font-mono"
              value={keyValue}
              onChange={(event) => setKeyValue(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={visible ? "Hide API key" : "Show API key"}
            >
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={saveKey}>
            {editingId ? <Pencil /> : <Plus />}
            {editingId ? "Save key" : "Add key"}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={status === "testing" || !keyValue.trim()}
            onClick={testConnection}
          >
            {status === "testing" ? <Loader2 className="animate-spin" /> : <Zap />}
            Test connection
          </Button>
          {editingId ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearForm}>
              <X />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
