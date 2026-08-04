"use client"

import { Download, Pause, Play, RotateCcw, Square, Trash2, WandSparkles } from "lucide-react"

import { exportAdobeCsv, exportShutterstockCsv, fixShutterstockMetadata, resolveExportFilenames } from "@/lib/export"
import { marketplaceFormat, marketplaceLabel } from "@/lib/marketplace"
import { validateMetadata, validateResults } from "@/lib/validation"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useGenerate } from "@/hooks/use-generate"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

export function UploadToolbar() {
  const images = useAppStore((state) => state.images);
  const selectedIds = useAppStore((state) => state.selectedIds);
  const results = useAppStore((state) => state.results);
  const failedImageIds = useAppStore((state) => state.failedImageIds);
  const platform = useAppStore((state) => state.settings.platform);
  const { run, pause, resume, stop, generating, queueState, progress, completed, total, etaSeconds } =
    useGenerate();

  const partialSelection =
    selectedIds.length > 0 && selectedIds.length < images.length;
  const generateLabel = partialSelection
    ? `Generate Selected (${selectedIds.length})`
    : `Generate All (${images.length})`;

  let statusText: string;
  if (generating && total > 0) {
    statusText = queueState === "paused"
      ? `Paused · ${completed} of ${total}`
      : `Generating ${completed} of ${total}${etaSeconds !== null ? ` · ~${etaSeconds}s left` : ""}`;
  } else if (generating) {
    statusText = "Generating…";
  } else if (results.length > 0) {
    statusText = `Ready · ${images.length} files, ${results.length} results`;
  } else {
    statusText = `Ready · ${images.length} files`;
  }

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
    <div className="sticky top-4 z-50 flex flex-col gap-3 rounded-[20px] border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <p className="min-w-0 truncate text-sm text-muted-foreground">
          {statusText}
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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

          <Button
            variant="ghost"
            size="sm"
            disabled={images.length === 0 || generating}
            onClick={() => {
              useAppStore.getState().clearImages();
              toast("info", "All files removed");
            }}
          >
            <Trash2 />
            Clear All
          </Button>

          {!generating && failedImageIds.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetry}
            >
              <RotateCcw />
              Retry ({failedImageIds.length})
            </Button>
          ) : null}

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

      {generating || progress > 0 ? (
        <Progress
          value={progress}
          className="h-1.5"
          indicatorClassName="bg-gradient-to-r from-primary to-primary/70"
        />
      ) : null}
    </div>
  );
}
