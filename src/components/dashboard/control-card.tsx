"use client"

import { useState } from "react"
import { ChevronDown, KeyRound, Sparkles, Zap } from "lucide-react"

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
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
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
  const [keysOpen, setKeysOpen] = useState(false);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">PromptLab</span>
        </div>
        <ThemeToggle />
      </div>

      <Badge
        variant={activeKeyCount > 0 ? "secondary" : "outline"}
        className={cn(
          "w-fit gap-1",
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
        <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{providerLabel}</span>
          <span aria-hidden="true">·</span>
          <span>
            Key {debugStatus.activeKeyIndex != null ? debugStatus.activeKeyIndex + 1 : "–"}/
            {debugStatus.activeKeyCount || "–"}
          </span>
          {debugStatus.activeKeyMasked ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{debugStatus.activeKeyMasked}</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span>Model: {activeModel}</span>
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
