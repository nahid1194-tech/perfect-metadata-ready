"use client"

import { useState } from "react"
import { ChevronDown, KeyRound, Sparkles, Zap, Clock, AlertTriangle } from "lucide-react"

import { cn } from "@/lib/utils"
import { bestModelFor } from "@/lib/models"
import type { ApiProvider } from "@/lib/types"
import { ApiKeySettings } from "@/components/dashboard/api-key-settings"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/use-app-store"

const PROVIDER_LABEL: Record<ApiProvider, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  mistral: "Mistral AI",
};

function Diag({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-semibold text-foreground">{value}</span>
    </div>
  );
}

function ErrorLog() {
  const queueItems = useAppStore((state) => state.queueItems);
  const failedIds = useAppStore((state) => state.failedImageIds);
  const images = useAppStore((state) => state.images);

  const failedItems = failedIds
    .map((id) => {
      const item = queueItems[id];
      const image = images.find((img) => img.id === id);
      return item && item.error
        ? { id, name: image?.name ?? id, error: item.error }
        : null;
    })
    .filter(Boolean) as { id: string; name: string; error: string }[];

  if (failedItems.length === 0) {
    return <p className="text-xs text-muted-foreground">No errors.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {failedItems.map((item) => (
        <div key={item.id} className="rounded-lg bg-destructive/5 p-2">
          <p className="truncate text-xs font-medium text-foreground">{item.name}</p>
          <p className="break-words text-xs text-destructive">{item.error}</p>
        </div>
      ))}
    </div>
  );
}

export function ControlCard() {
  const apiKeys = useAppStore((state) => state.apiKeys);
  const generating = useAppStore((state) => state.generating);
  const primaryProvider = useAppStore((state) => state.primaryProvider);
  const debugStatus = useAppStore((state) => state.debugStatus);
  const batchCompleted = useAppStore((state) => state.batchCompleted);
  const batchTotal = useAppStore((state) => state.batchTotal);
  const activeImageId = useAppStore((state) => state.activeImageId);
  const queueItems = useAppStore((state) => state.queueItems);
  const [keysOpen, setKeysOpen] = useState(false);
  const [perfOpen, setPerfOpen] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const results = useAppStore((state) => state.results);
  const geminiKeyCount = apiKeys.filter(
    (entry) =>
      entry.provider === "gemini" && entry.enabled && entry.key.trim().length > 0
  ).length;
  const openaiKeyCount = apiKeys.filter(
    (entry) =>
      entry.provider === "openai" && entry.enabled && entry.key.trim().length > 0
  ).length;
  const mistralKeyCount = apiKeys.filter(
    (entry) =>
      entry.provider === "mistral" && entry.enabled && entry.key.trim().length > 0
  ).length;
  const activeKeyCount = geminiKeyCount + openaiKeyCount + mistralKeyCount;
  const primaryModel = bestModelFor(primaryProvider);
  const primaryKeyCount =
    primaryProvider === "gemini"
      ? geminiKeyCount
      : primaryProvider === "openai"
        ? openaiKeyCount
        : mistralKeyCount;
  const providerLabel = debugStatus.activeProvider
    ? PROVIDER_LABEL[debugStatus.activeProvider]
    : null;
  const activeModel =
    debugStatus.activeModel ??
    bestModelFor(debugStatus.activeProvider ?? primaryProvider);
  const activeQueueItem = activeImageId ? queueItems[activeImageId] : null;
  const activeStatus =
    activeQueueItem?.statusMessage ??
    (activeQueueItem?.status === "generating"
      ? "Generating metadata…"
      : activeQueueItem?.status === "retrying"
        ? "Retrying…"
        : activeQueueItem?.status
          ? "Analyzing image…"
          : null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">Perfect Metadata</span>
        </div>
        <ThemeToggle />
      </div>

      <Badge
        variant={activeKeyCount > 0 ? "secondary" : "outline"}
        className={cn(
          "max-w-full gap-1 truncate",
          activeKeyCount > 0 &&
            "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        )}
      >
        {activeKeyCount > 0 ? <Zap className="size-3" /> : <Sparkles className="size-3" />}
        {activeKeyCount > 0
          ? `Primary ${PROVIDER_LABEL[primaryProvider]} · ${primaryModel} (${primaryKeyCount} keys) · Auto-fallback on`
          : "Local engine"}
      </Badge>

      {generating && providerLabel ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">API: {providerLabel}</span>
          <span aria-hidden="true">·</span>
          <span>Model: {activeModel}</span>
          <span aria-hidden="true">·</span>
          <span>
            Key: {debugStatus.activeKeyIndex != null ? debugStatus.activeKeyIndex + 1 : "–"}/
            {debugStatus.activeKeyCount || "–"}
          </span>
          {debugStatus.activeKeyMasked ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{debugStatus.activeKeyMasked}</span>
            </>
          ) : null}
          {activeStatus ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Status: {activeStatus}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {activeKeyCount > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border bg-background/60 p-3">
          <p className="text-xs font-semibold tracking-tight text-muted-foreground">
            Diagnostics
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-xs">
            <Diag label="Current provider" value={providerLabel ?? "–"} />
            <Diag label="Active model" value={activeModel ?? "–"} />
            <Diag label="Active API key" value={debugStatus.activeKeyMasked ?? "–"} />
            <Diag
              label="Queue progress"
              value={generating ? `${batchCompleted}/${batchTotal}` : "Idle"}
            />
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="justify-between"
        onClick={() => setPerfOpen((open) => !open)}
        aria-expanded={perfOpen}
      >
        <span className="flex items-center gap-2">
          <Clock />
          Performance
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", perfOpen && "rotate-180")}
        />
      </Button>

      {perfOpen ? (
        <div className="rounded-xl border bg-background/60 p-3">
          {results.length === 0 ? (
            <p className="text-xs text-muted-foreground">No results yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {results.slice(-5).reverse().map((r) => {
                const totalMs = r.timingMs
                  ? Object.values(r.timingMs).reduce((s, v) => s + v, 0)
                  : null;
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 font-mono text-xs">
                    <span className="truncate text-muted-foreground">{r.imageName}</span>
                    <span className="shrink-0 flex items-center gap-2">
                      {r.qualityScore != null ? (
                        <Badge variant="secondary" className={cn(
                          "text-[10px]",
                          r.qualityScore >= 90
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                            : r.qualityScore >= 70
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                              : "bg-red-500/15 text-red-700 dark:text-red-400"
                        )}>
                          {r.qualityScore}
                        </Badge>
                      ) : null}
                      {totalMs != null ? (
                        <span className="text-muted-foreground">{(totalMs / 1000).toFixed(1)}s</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="justify-between"
        onClick={() => setErrorsOpen((open) => !open)}
        aria-expanded={errorsOpen}
      >
        <span className="flex items-center gap-2">
          <AlertTriangle />
          Error Log
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", errorsOpen && "rotate-180")}
        />
      </Button>

      {errorsOpen ? (
        <div className="rounded-xl border bg-background/60 p-3">
          <ErrorLog />
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="justify-between"
        onClick={() => setKeysOpen((open) => !open)}
        aria-expanded={keysOpen}
      >
        <span className="flex items-center gap-2">
          <KeyRound />
          API Keys
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", keysOpen && "rotate-180")}
        />
      </Button>

      {keysOpen ? (
        <div className="rounded-xl border bg-background/60 p-3">
          <ApiKeySettings />
        </div>
      ) : null}
    </div>
  )
}
