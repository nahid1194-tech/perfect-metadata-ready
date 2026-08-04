"use client"

import { CheckCircle2, Download, FileSpreadsheet, RotateCcw } from "lucide-react"

import { exportAdobeCsv, exportShutterstockCsv, fixShutterstockMetadata, resolveExportFilenames } from "@/lib/export"
import { validateMetadata, validateResults } from "@/lib/validation"
import { Modal } from "@/components/feedback/modal"
import { Button } from "@/components/ui/button"
import { useGenerate } from "@/hooks/use-generate"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

export function SuccessDialog() {
  const open = useAppStore((state) => state.successOpen);
  const close = useAppStore((state) => state.closeSuccess);
  const results = useAppStore((state) => state.results);
  const { run } = useGenerate();

  const handleExport = async (format: "adobe" | "shutterstock") => {
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
          `${shortened.length} filename${shortened.length === 1 ? "" : "s"} shortened to fit the ${format === "adobe" ? "Adobe Stock" : "Shutterstock"} limit.`
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

  const handleGenerateAgain = () => {
    close();
    run();
  };

  return (
    <Modal open={open} onClose={close} label="Metadata generated successfully">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15">
          <CheckCircle2 className="size-8 text-emerald-500" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">
            Metadata generated successfully
          </h2>
          <p className="text-sm text-muted-foreground">
            CSV ready · {results.length} result{results.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2">
          <Button onClick={() => handleExport("adobe")}>
            <Download />
            Adobe CSV
          </Button>
          <Button onClick={() => handleExport("shutterstock")}>
            <FileSpreadsheet />
            Shutterstock CSV
          </Button>
        </div>
        <Button variant="outline" className="w-full" onClick={handleGenerateAgain}>
          <RotateCcw />
          Generate Again
        </Button>
      </div>
    </Modal>
  );
}
