"use client"

import { useState } from "react"
import { ChevronDown, KeyRound, Sparkles, Zap } from "lucide-react"

import { cn } from "@/lib/utils"
import { ApiKeySettings } from "@/components/dashboard/api-key-settings"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/use-app-store"

export function ControlCard() {
  const apiKeys = useAppStore((state) => state.apiKeys);
  const model = useAppStore((state) => state.model);
  const generating = useAppStore((state) => state.generating);
  const debugStatus = useAppStore((state) => state.debugStatus);
  const [keysOpen, setKeysOpen] = useState(false);
  const activeKeyCount = apiKeys.filter(
    (entry) => entry.enabled && entry.key.trim().length > 0
  ).length;

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
          ? `Gemini · ${model} · ${activeKeyCount} ${activeKeyCount === 1 ? "key" : "keys"}`
          : "Local engine"}
      </Badge>

      {generating && debugStatus.activeKeyIndex != null ? (
        <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <span>
            Active key: {debugStatus.activeKeyIndex + 1}/{debugStatus.activeKeyCount}
          </span>
          <span aria-hidden="true">·</span>
          <span>Model: {debugStatus.activeModel ?? model}</span>
        </p>
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
