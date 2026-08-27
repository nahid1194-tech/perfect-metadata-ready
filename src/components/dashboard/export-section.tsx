/* eslint-disable jsx-a11y/alt-text -- lucide-react Image is an SVG icon, not an HTML img */
"use client"

import { useState } from "react"
import { Download, FileSpreadsheet, Image } from "lucide-react"

import { exportAdobeCsv, exportMagnificCsv, exportShutterstockCsv, fixMagnificMetadata, fixShutterstockMetadata, resolveExportFilenames } from "@/lib/export"
import { validateMetadata, validateResults } from "@/lib/validation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

export function ExportSection() {
  const results = useAppStore((state) => state.results);
  const [exporting, setExporting] = useState<"adobe" | "shutterstock" | "magnific" | null>(null);

  const handleExport = async (format: "adobe" | "shutterstock" | "magnific") => {
    if (results.length === 0) return;
    setExporting(format);
    try {
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
        await exportAdobeCsv(results);
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
        await exportShutterstockCsv(results);
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
        await exportMagnificCsv(results);
      }
      const shortened = resolveExportFilenames(results, format).filter(
        (entry) => entry.shortened
      );
      const marketplaceName = format === "adobe" ? "Adobe Stock" : format === "shutterstock" ? "Shutterstock" : "Magnific";
      if (shortened.length > 0) {
        toast(
          "info",
          "CSV downloaded",
          `${shortened.length} filename${shortened.length === 1 ? "" : "s"} shortened to fit the ${marketplaceName} limit.`
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
    } finally {
      setExporting(null);
    }
  };

  const hasResults = results.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight">Export Metadata</span>
        {hasResults ? (
          <Badge variant="secondary" className="text-[10px]">
            {results.length} image{results.length === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasResults || exporting !== null}
          onClick={() => handleExport("adobe")}
          className="justify-start gap-2"
        >
          {exporting === "adobe" ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Download className="size-3.5" />
          )}
          Adobe CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasResults || exporting !== null}
          onClick={() => handleExport("shutterstock")}
          className="justify-start gap-2"
        >
          {exporting === "shutterstock" ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <FileSpreadsheet className="size-3.5" />
          )}
          Shutterstock CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasResults || exporting !== null}
          onClick={() => handleExport("magnific")}
          className="justify-start gap-2"
        >
          {exporting === "magnific" ? (
            <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <Image className="size-3.5" aria-hidden="true" />
          )}
          Magnific CSV
        </Button>
      </div>

      {!hasResults ? (
        <p className="text-xs text-muted-foreground">
          No metadata available. Generate metadata first.
        </p>
      ) : null}
    </div>
  );
}
