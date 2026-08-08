"use client"

import { useEffect, useState } from "react"
import { Download, RotateCcw, Trash2, WandSparkles } from "lucide-react"

import { exportAdobeCsv, exportShutterstockCsv, fixShutterstockMetadata, resolveExportFilenames } from "@/lib/export"
import { marketplaceFormat, marketplaceLabel } from "@/lib/marketplace"
import { validateMetadata, validateResults } from "@/lib/validation"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useGenerate } from "@/hooks/use-generate"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"
import { cn } from "@/lib/utils"

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

export function UploadToolbar() {
  const images = useAppStore((state) => state.images);
  const selectedIds = useAppStore((state) => state.selectedIds);
  const results = useAppStore((state) => state.results);
  const failedImageIds = useAppStore((state) => state.failedImageIds);
  const platform = useAppStore((state) => state.settings.platform);
  const progress = useAppStore((state) => state.progress);
  const { run, stop, generating } = useGenerate();

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (generating) return null;

  const partialSelection =
    selectedIds.length > 0 && selectedIds.length < images.length;
  const generateLabel = partialSelection
    ? `Generate Selected (${selectedIds.length})`
    : `Generate All (${images.length})`;

  const uploaded = images.length;
  const completedCount = Math.min(uploaded, results.length);
  const failedCount = failedImageIds.length;
  const remainingCount = Math.max(
    0,
    uploaded - completedCount - failedCount
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
          {results.length > 0
            ? `Ready · ${results.length} result${results.length === 1 ? "" : "s"}`
            : `Ready · ${images.length} file${images.length === 1 ? "" : "s"}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {failedImageIds.length > 0 ? (
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RotateCcw />
              Retry ({failedImageIds.length})
            </Button>
          ) : null}

          <Button
            variant="ghost"
            size="sm"
            disabled={images.length === 0 && results.length === 0}
            onClick={handleClearAll}
          >
            <Trash2 />
            Clear All
          </Button>

          <Button
            variant="outline"
            size="sm"
            disabled={results.length === 0}
            onClick={handleExport}
          >
            <Download />
            Export CSV
          </Button>

          <Button size="sm" disabled={images.length === 0} onClick={handleGenerate}>
            <WandSparkles />
            {generateLabel}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <StatTile label="Uploaded" value={uploaded} />
        <StatTile label="Completed" value={completedCount} accent />
        <StatTile label="Failed" value={failedCount} />
        <StatTile label="Remaining" value={remainingCount} />
        <StatTile label="Progress" value={`${Math.min(100, progressPct)}%`} />
      </div>

      {progress > 0 ? (
        <Progress
          value={Math.min(100, progressPct)}
          className="h-1.5"
          indicatorClassName="bg-gradient-to-r from-primary to-primary/70"
        />
      ) : null}
    </div>
  );
}
