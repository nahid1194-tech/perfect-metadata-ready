"use client"

import { useEffect, useRef, useState } from "react"

import { normalizeSpeed } from "@/lib/rate-limiter"
import type { GenerationSpeed } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { useAppStore } from "@/store/use-app-store"

const MODES: { id: GenerationSpeed; icon: string; label: string; tag?: string }[] = [
  { id: "super-fast", icon: "🚀", label: "Super Fast" },
  { id: "fast", icon: "⚡", label: "Fast" },
  { id: "normal", icon: "⚖️", label: "Normal", tag: "Default" },
];

const QUEUE_LABEL: Record<GenerationSpeed, string> = {
  "super-fast": "No delay",
  fast: "~0.35s delay",
  normal: "~1.5s delay",
};

const ESTIMATE: Record<GenerationSpeed, number> = {
  "super-fast": 15,
  fast: 12,
  normal: 4,
};

export function GenerationSpeedSettings() {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const generating = useAppStore((state) => state.generating);
  const batchCompleted = useAppStore((state) => state.batchCompleted);
  const batchTotal = useAppStore((state) => state.batchTotal);

  const speed = normalizeSpeed(settings.generationSpeed);

  const [liveRate, setLiveRate] = useState<number | null>(null);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (generating) {
      if (startedAtRef.current === null) startedAtRef.current = Date.now();
      if (batchCompleted > 0) {
        const elapsedMinutes = (Date.now() - startedAtRef.current) / 60000;
        if (elapsedMinutes >= 1 / 12) {
          setLiveRate(batchCompleted / elapsedMinutes);
        }
      }
    } else {
      startedAtRef.current = null;
      setLiveRate(null);
    }
  }, [generating, batchCompleted]);

  const done = Math.min(batchCompleted, batchTotal);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold tracking-tight">Generation Speed</p>

      <p className="text-xs text-muted-foreground">
        Sequential — 1 image at a time in every mode. Speed comes from delay tuning,
        retries and key rotation.
      </p>

      <div className="flex flex-col gap-2">
        {MODES.map(({ id, icon, label, tag }) => {
          const active = speed === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setSettings({ generationSpeed: id })}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                  : "border-border hover:border-primary/40"
              )}
            >
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                <span>
                  <span aria-hidden="true" className="mr-1.5">{icon}</span>
                  {label}
                </span>
                {tag ? (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {tag}
                  </Badge>
                ) : null}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span>1 image at a time</span>
                <span aria-hidden="true">·</span>
                <span>{QUEUE_LABEL[id]}</span>
                <span aria-hidden="true">·</span>
                <span>~{ESTIMATE[id]} images/min (est.)</span>
              </span>
            </button>
          );
        })}
      </div>

      {generating ? (
        <p className="text-xs text-muted-foreground">
          {liveRate !== null
            ? `Live throughput: ~${Math.round(liveRate)} images/min (${done}/${batchTotal})`
            : `Processing ${done}/${batchTotal}…`}
        </p>
      ) : null}
    </div>
  );
}
