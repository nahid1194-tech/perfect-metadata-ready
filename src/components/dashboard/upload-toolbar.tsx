"use client"

import { useEffect, useState } from "react"
import {
  Download,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Trash2,
  WandSparkles,
} from "lucide-react"

import { exportAdobeCsv, exportShutterstockCsv, fixShutterstockMetadata, resolveExportFilenames } from "@/lib/export"
import { marketplaceFormat, marketplaceLabel } from "@/lib/marketplace"
import type { ApiProvider, GenerationStatus } from "@/lib/types"
import { validateMetadata, validateResults } from "@/lib/validation"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { useGenerate } from "@/hooks/use-generate"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"
import { cn } from "@/lib/utils"

const PROVIDER_LABEL: Record<ApiProvider, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  mistral: "Mistral AI",
};

const STATUS_LABEL: Partial<Record<GenerationStatus, string>> = {
  uploading: "Uploading image…",
  waiting: "Waiting in queue…",
  analyzing: "Analyzing image…",
  generating: "Generating Metadata…",
  retrying: "Retrying…",
};

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function StatTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border bg-background/70 px-2.5 py-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-base font-semibold tabular-nums",
          accent ? "text-primary" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function CurrentRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-xs font-medium text-foreground",
          mono && "font-mono tabular-nums"
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function UploadToolbar() {
  const images = useAppStore((state) => state.images);
  const selectedIds = useAppStore((state) => state.selectedIds);
  const results = useAppStore((state) => state.results);
  const failedImageIds = useAppStore((state) => state.failedImageIds);
  const platform = useAppStore((state) => state.settings.platform);
  const activeImageId = useAppStore((state) => state.activeImageId);
  const debugStatus = useAppStore((state) => state.debugStatus);
  const queueItems = useAppStore((state) => state.queueItems);
  const progress = useAppStore((state) => state.progress);
  const autoScroll = useAppStore((state) => state.autoScroll);
  const setAutoScroll = useAppStore((state) => state.setAutoScroll);
  const { run, pause, resume, stop, generating, queueState, total, etaSeconds } =
    useGenerate();

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!generating) {
      setElapsedSeconds(0);
      return;
    }
    setElapsedSeconds(0);
    const id = setInterval(() => setElapsedSeconds((seconds) => seconds + 1), 1000);
    return () => clearInterval(id);
  }, [generating]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const partialSelection =
    selectedIds.length > 0 && selectedIds.length < images.length;
  const generateLabel = partialSelection
    ? `Generate Selected (${selectedIds.length})`
    : `Generate All (${images.length})`;

  const uploaded = images.length;
  const completedCount = Math.min(uploaded, results.length);
  const generatingCount = generating ? 1 : 0;
  const failedCount = failedImageIds.length;
  const remainingCount = Math.max(
    0,
    uploaded - completedCount - generatingCount - failedCount
  );
  const progressPct = generating
    ? Math.round(progress)
    : uploaded > 0
      ? Math.round((results.length / uploaded) * 100)
      : 0;

  const activeImage = images.find((image) => image.id === activeImageId);
  const activeItem = activeImageId ? queueItems[activeImageId] : undefined;
  const activeProvider = generating ? debugStatus.activeProvider : null;
  const activeStatus =
    activeItem?.statusMessage ??
    (activeItem ? STATUS_LABEL[activeItem.status] : undefined) ??
    "Generating Metadata…";

  const handleGenerate = () => {
    if (images.length === 0) {
      toast("error", "No files", "Upload at least one image first.");
      return;
    }
    run(partialSelection ? { ids: selectedIds } : {});
  };

  const handleRetry = () => {
    if (failedImageIds.length === 0) return;
    run({ retryFailed: true });
  };

  const handleClearCompleted = () => {
    if (results.length === 0) return;
    useAppStore.getState().clearResults();
    toast("info", "Results cleared", "Completed results removed.");
  };

  const handleExport = async () => {
    if (results.length === 0) {
      toast("error", "Nothing to export", "Generate metadata first.");
      return;
    }
    const format = marketplaceFormat(platform);
    if (format === "adobe") {
      const errors = validateResults(results, "adobe");
      if (errors.length > 0) {
        const sample = errors
          .slice(0, 2)
          .map((error) => `${error.filename}: ${error.issues.join("; ")}`)
          .join("\n");
        toast(
          "error",
          "Cannot export",
          `${errors.length} row${errors.length > 1 ? "s" : ""} not compliant:\n${sample}`
        );
        return;
      }
    } else {
      let fixed = 0;
      for (const result of results) {
        if (
          validateMetadata(
            result.metadata.shutterstock,
            "shutterstock"
          ).length === 0
        )
          continue;
        const corrected = fixShutterstockMetadata(
          result.metadata.shutterstock
        );
        useAppStore.getState().updateResult(result.id, (current) => ({
          ...current,
          metadata: { ...current.metadata, shutterstock: corrected },
        }));
        fixed++;
      }
      if (fixed > 0) {
        toast(
          "info",
          "CSV auto-corrected",
          `${fixed} row${fixed === 1 ? "" : "s"} fixed to match the Shutterstock CSV format before export.`
        );
      }
    }
    try {
      if (format === "adobe") await exportAdobeCsv(results);
      else await exportShutterstockCsv(results);
      const shortened = resolveExportFilenames(results, format).filter(
        (entry) => entry.shortened
      );
      if (shortened.length > 0) {
        toast(
          "info",
          "CSV downloaded",
          `${shortened.length} filename${shortened.length === 1 ? "" : "s"} shortened to fit the ${marketplaceLabel(platform)} limit.`
        );
      } else {
        toast("success", "CSV downloaded", "UTF-8 with BOM");
      }
    } catch (error) {
      toast(
        "error",
        "Export failed",
        error instanceof Error ? error.message : "Could not generate the CSV file."
      );
    }
  };

  return (
    <div
      className={cn(
        "sticky top-3 z-50 flex flex-col gap-3 rounded-[20px] border p-4 backdrop-blur-md transition-[box-shadow,background-color,border-color] duration-300",
        "bg-[#FCFCFA]/90 dark:bg-card/90",
        scrolled
          ? "shadow-[0_16px_48px_-12px_rgba(0,0,0,0.28)]"
          : "shadow-[0_4px_24px_-8px_rgba(0,0,0,0.12)]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold">
          {generating
            ? "Generation in progress"
            : results.length > 0
              ? `Ready · ${results.length} result${results.length === 1 ? "" : "s"}`
              : `Ready · ${images.length} file${images.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {generating ? (
            <>
              {queueState === "running" && total > 0 ? (
                <Button variant="outline" size="sm" onClick={pause}>
                  <Pause />
                  Pause
                </Button>
              ) : null}
              {queueState === "paused" ? (
                <Button variant="outline" size="sm" onClick={resume}>
                  <Play />
                  Resume
                </Button>
              ) : null}
              <Button variant="destructive" size="sm" onClick={stop}>
                <Square />
                Stop
              </Button>
            </>
          ) : null}

          {!generating && failedImageIds.length > 0 ? (
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RotateCcw />
              Retry ({failedImageIds.length})
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            disabled={results.length === 0 || generating}
            onClick={handleClearCompleted}
          >
            <Trash2 />
            Clear Completed
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={results.length === 0 || generating}
            onClick={handleExport}
          >
            <Download />
            Export CSV
          </Button>

          <Button size="sm" disabled={images.length === 0 || generating} onClick={handleGenerate}>
            <WandSparkles />
            {generateLabel}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <StatTile label="Uploaded" value={uploaded} />
        <StatTile label="Completed" value={completedCount} accent />
        <StatTile label="Generating" value={generatingCount} accent />
        <StatTile label="Failed" value={failedCount} />
        <StatTile label="Remaining" value={remainingCount} />
        <StatTile label="Progress" value={`${Math.min(100, progressPct)}%`} />
      </div>

      {generating ? (
        <div className="flex flex-col gap-2 rounded-xl border bg-background/70 p-3">
          <div className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Current Processing
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <CurrentRow label="Image" value={activeImage?.name ?? "—"} />
            <CurrentRow
              label="API"
              value={activeProvider ? PROVIDER_LABEL[activeProvider] : "—"}
            />
            <CurrentRow
              label="Model"
              value={debugStatus.activeModel ?? "—"}
              mono
            />
            <CurrentRow
              label="Provider Key"
              value={
                debugStatus.activeKeyCount && debugStatus.activeKeyCount > 0
                  ? `${(debugStatus.activeKeyIndex ?? 0) + 1} / ${debugStatus.activeKeyCount}`
                  : "—"
              }
              mono
            />
            <CurrentRow label="Status" value={activeStatus} />
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">Elapsed</span>{" "}
            {generating ? formatDuration(elapsedSeconds) : "—"}
          </span>
          <span>
            <span className="font-medium text-foreground">ETA</span>{" "}
            {generating && etaSeconds !== null ? `~${etaSeconds}s left` : "—"}
          </span>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
          <Switch checked={autoScroll} onCheckedChange={setAutoScroll} aria-label="Auto scroll to current image" />
          Auto Scroll to Current Image
        </label>
      </div>

      {generating || progress > 0 ? (
        <Progress
          value={Math.min(100, progressPct)}
          className="h-1.5"
          indicatorClassName="bg-gradient-to-r from-primary to-primary/70"
        />
      ) : null}
    </div>
  );
}
