"use client"

import { useEffect, useState } from "react"
import { Download, Loader2, RotateCcw, Square, Trash2, UploadCloud, WandSparkles } from "lucide-react"

import { exportAdobeCsv, exportMagnificCsv, exportShutterstockCsv, fixMagnificMetadata, fixShutterstockMetadata, resolveExportFilenames } from "@/lib/export"
import { pushToGitHub } from "@/lib/git-sync"
import { marketplaceFormat, marketplaceLabel } from "@/lib/marketplace"
import { validateMetadata, validateResults } from "@/lib/validation"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useGenerate } from "@/hooks/use-generate"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"
import { cn } from "@/lib/utils"

const PROVIDER_LABEL: Record<string, string> = {
  gemini: "Gemini",
  openai: "OpenAI",
  mistral: "Mistral AI",
};

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
    <div className="flex flex-col gap-0.5 rounded-xl border border-white/10 bg-white/10 px-2.5 py-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-blue-200/70">
        {label}
      </span>
      <span
        className={cn(
          "text-base font-semibold tabular-nums",
          accent ? "text-sky-300" : "text-white"
        )}
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
  const queueItems = useAppStore((state) => state.queueItems);
  const failedImageIds = useAppStore((state) => state.failedImageIds);
  const platform = useAppStore((state) => state.settings.platform);
  const progress = useAppStore((state) => state.progress);
  const debugStatus = useAppStore((state) => state.debugStatus);
  const gitPushStatus = useAppStore((state) => state.gitPushStatus);
  const { run, stop, generating, queueState } = useGenerate();

  const [scrolled, setScrolled] = useState(false);
  const [pushing, setPushing] = useState(false);

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
  const generatingCount = Object.values(queueItems).filter((item) =>
    ["analyzing", "generating", "retrying"].includes(item.status)
  ).length;
  const failedCount = failedImageIds.length;
  const remainingCount = Math.max(
    0,
    uploaded - completedCount - failedCount - generatingCount
  );
  const progressPct =
    uploaded > 0 ? Math.round((results.length / uploaded) * 100) : 0;

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

  const handleClearAll = () => {
    if (images.length === 0 && results.length === 0) return;
    if (generating) stop();
    useAppStore.getState().clearAll();
    toast("info", "Cleared", "All images and results removed.");
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
    } else if (format === "shutterstock") {
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
    } else {
      let fixed = 0;
      for (const result of results) {
        if (
          validateMetadata(
            result.metadata.magnific,
            "magnific"
          ).length === 0
        )
          continue;
        const corrected = fixMagnificMetadata(
          result.metadata.magnific
        );
        useAppStore.getState().updateResult(result.id, (current) => ({
          ...current,
          metadata: { ...current.metadata, magnific: corrected },
        }));
        fixed++;
      }
      if (fixed > 0) {
        toast(
          "info",
          "CSV auto-corrected",
          `${fixed} row${fixed === 1 ? "" : "s"} fixed to match the Magnific CSV format before export.`
        );
      }
    }
    try {
      if (format === "adobe") await exportAdobeCsv(results);
      else if (format === "shutterstock") await exportShutterstockCsv(results);
      else await exportMagnificCsv(results);
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

  const handlePush = async () => {
    if (results.length === 0) {
      toast("error", "Nothing to push", "Generate metadata first.");
      return;
    }
    setPushing(true);
    try {
      const result = await pushToGitHub();
      toast(
        result.ok ? "success" : "error",
        result.ok ? "Pushed to GitHub" : "Git push failed",
        result.message
      );
    } finally {
      setPushing(false);
    }
  };

  return (
    <div
      className={cn(
        "sticky top-16 z-30 flex flex-col gap-3 rounded-[20px] border p-4 transition-[box-shadow,background-color,border-color] duration-300 lg:top-3",
        "border-white/10 bg-[#0B1F3A] text-white",
        scrolled
          ? "shadow-[0_16px_48px_-12px_rgba(0,0,0,0.4)]"
          : "shadow-[0_4px_24px_-8px_rgba(0,0,0,0.25)]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-white">
          {results.length > 0
            ? `Ready · ${results.length} result${results.length === 1 ? "" : "s"}`
            : `Ready · ${images.length} file${images.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {failedImageIds.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              onClick={handleRetry}
            >
              <RotateCcw />
              Retry ({failedImageIds.length})
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            className="text-white/85 hover:bg-white/10 hover:text-white"
            disabled={images.length === 0 && results.length === 0}
            onClick={handleClearAll}
          >
            <Trash2 />
            Clear All
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            disabled={results.length === 0}
            onClick={handleExport}
          >
            <Download />
            Export CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
            disabled={results.length === 0 || pushing || gitPushStatus.state === "pushing"}
            onClick={handlePush}
          >
            {pushing || gitPushStatus.state === "pushing" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <UploadCloud />
            )}
            Push to GitHub
          </Button>

          {generating ? (
            <Button
              size="sm"
              variant="outline"
              className="border-red-400/40 bg-red-500/15 text-red-100 hover:bg-red-500/25 hover:text-white"
              onClick={stop}
            >
              <Square className="size-3.5" />
              Stop
            </Button>
          ) : null}

          <Button
            size="sm"
            className="bg-sky-400 text-sky-950 hover:bg-sky-300"
            disabled={images.length === 0 || generating}
            onClick={handleGenerate}
          >
            <WandSparkles />
            {generateLabel}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Generated" value={`${completedCount} / ${uploaded}`} accent />
        <StatTile label="Processing" value={generatingCount} />
        <StatTile label="Waiting" value={remainingCount} />
        <StatTile label="Failed" value={failedCount} />
      </div>

      {generating ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-blue-100/85">
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3 animate-spin" />
            Analyzing:{" "}
            {(() => {
              const activeNames = Object.values(queueItems)
                .filter((item) =>
                  ["analyzing", "generating", "retrying"].includes(item.status)
                )
                .map((item) => images.find((image) => image.id === item.imageId)?.name)
                .filter(Boolean);
              return activeNames.length > 0
                ? activeNames.join(", ")
                : "Preparing…";
            })()}
          </span>
          {debugStatus.activeProvider ? (
            <span>
              Provider:{" "}
              {PROVIDER_LABEL[debugStatus.activeProvider] ??
                debugStatus.activeProvider}
            </span>
          ) : null}
          {debugStatus.activeModel ? (
            <span>Model: {debugStatus.activeModel}</span>
          ) : null}
          {queueState === "paused" ? (
            <span className="text-amber-300">Paused</span>
          ) : null}
        </div>
      ) : null}

      {progress > 0 ? (
        <Progress
          value={Math.min(100, progressPct)}
          className="h-1.5 bg-white/15"
          indicatorClassName="bg-gradient-to-r from-sky-400 to-blue-600"
        />
      ) : null}
    </div>
  );
}
