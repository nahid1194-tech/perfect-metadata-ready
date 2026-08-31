import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Info,
  Loader2,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
} from "lucide-react";
import type { ContentCheck, ContentIssue, GenerationResult, ImageAsset, RiskLevel } from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";
import {
  CONTENT_CHECK_DISCLAIMER,
  CONTENT_RISK_META,
  isVectorAssetName,
  mergeContentIssues,
  resolveContentCheck,
} from "@/lib/content-check";
import { analyzeSimilarity, vectorStructureIssues } from "@/lib/similarity";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/upload-process";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateForImage(
  image: ImageAsset,
  vectorNotes: ContentIssue[]
): ContentCheck {
  const issues = vectorNotes.length > 0 ? vectorNotes : [];
  return {
    riskLevel: issues.length > 0 ? "REVIEW" : "LOW",
    confidence: 0,
    issues,
    recommendation:
      "This asset has not been AI-reviewed yet (no generated metadata is available), so this local-preview estimate is not a full Adobe Stock review.",
  };
}

export function ContentCheckPanel({
  images,
  results,
  onFocusImage,
}: {
  images: ImageAsset[];
  results: GenerationResult[];
  onFocusImage: (imageId: string) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [scanLabel, setScanLabel] = useState("");
  const scannedImageIds = useAppStore((state) => state.scannedImageIds);
  const scanEstimates = useAppStore((state) => state.scanEstimates);
  const scanIssues = useAppStore((state) => state.scanIssues);
  const scanSizeLabel = useAppStore((state) => state.scanSizeLabel);
  const recordScanResults = useAppStore((state) => state.recordScanResults);
  const clearScan = useAppStore((state) => state.clearScan);

  const resultById = useMemo(
    () => new Map(results.map((result) => [result.imageId, result])),
    [results]
  );

  const scannedAssets = useMemo(
    () =>
      images
        .filter((image) => scannedImageIds.includes(image.id))
        .map((image) => {
          const result = resultById.get(image.id);
          const estimate = scanEstimates[image.id];
          const resolved = result
            ? resolveContentCheck(
                result.metadata.contentCheck,
                scanIssues[image.id] ?? []
              )
            : estimate
              ? resolveContentCheck(estimate, scanIssues[image.id] ?? [])
              : null;
          return { image, result, check: resolved };
        }),
    [images, scannedImageIds, resultById, scanEstimates, scanIssues]
  );

  const counts = useMemo(() => {
    const breakdown: Record<RiskLevel, number> = {
      LOW: 0,
      REVIEW: 0,
      HIGH: 0,
      VERY_HIGH: 0,
    };
    let flagged = 0;
    let similar = 0;
    for (const item of scannedAssets) {
      if (!item.check) continue;
      breakdown[item.check.riskLevel]++;
      if (item.check.riskLevel !== "LOW") flagged++;
      if (item.check.issues.some((issue) => issue.category === "SIMILARITY")) {
        similar++;
      }
    }
    return { ...breakdown, total: scannedAssets.length, flagged, similar };
  }, [scannedAssets]);

  const photos = useMemo(
    () => scannedAssets.filter((item) => !isVectorAssetName(item.image.name)).length,
    [scannedAssets]
  );
  const vectors = scannedAssets.filter((item) =>
    isVectorAssetName(item.image.name)
  ).length;

  const runScan = async () => {
    if (images.length === 0 || scanning) return;
    clearScan();
    setScanning(true);
    setProgress(2);
    setScanLabel("Reading the uploaded files…");
    await sleep(0);

    const totalBytes = images.reduce(
      (sum, image) => sum + Math.max(0, image.size ?? 0),
      0
    );
    setScanLabel("Comparing assets for duplicates and similar content…");
    const similarity = await analyzeSimilarity(images, { concurrency: 3 });
    setScanLabel("Checking vector structure and file notes…");

    const estimates: Record<string, ContentCheck> = {};
    const issues: Record<string, ContentIssue[]> = {};
    const total = images.length;
    let done = 0;
    for (const image of images) {
      const vectorNotes = await vectorStructureIssues(image);
      if (vectorNotes.length > 0) {
        issues[image.id] = mergeContentIssues(
          similarity[image.id] ?? [],
          vectorNotes
        );
      } else if (similarity[image.id]) {
        issues[image.id] = [...similarity[image.id]];
      }
      if (!resultById.get(image.id)) {
        estimates[image.id] = estimateForImage(image, vectorNotes);
      }
      done++;
      setProgress(Math.max(4, Math.round((done / total) * 100)));
      await sleep(0);
    }

    recordScanResults({
      scannedImageIds: images.map((image) => image.id),
      estimates,
      issues,
      sizeLabel: formatBytes(totalBytes),
    });
    setScanning(false);
    setProgress(100);
  };

  const scanAgain = async () => {
    await runScan();
  };

  const showEstimateArea = scannedAssets.some(
    (item) => !item.result && item.check
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <ScanSearch className="h-4 w-4 text-indigo-400" />
          <span className="font-medium text-slate-100">Check Content</span>
          {counts.total > 0 && (
            <span className="text-xs text-slate-400">
              {scanSizeLabel} scanned
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {scannedAssets.some((item) => item.check?.issues.length) && (
            <button
              type="button"
              onClick={() => onFocusImage("")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs",
                "font-medium text-slate-200 transition hover:bg-slate-800"
              )}
              title="Open the issues marked in the results list below"
            >
              <ShieldAlert className="h-3.5 w-3.5 text-orange-400" />
              Review issues
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={scanAgain}
            disabled={scanning || images.length === 0}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold",
              "bg-indigo-600 text-white transition hover:bg-indigo-500",
              "disabled:cursor-not-allowed disabled:opacity-50",
              scannedImageIds.length > 0 && "bg-slate-700 hover:bg-slate-600"
            )}
          >
            {scannedImageIds.length > 0 ? (
              <>
                <RotateCcw className="h-3.5 w-3.5" />
                Re-scan
              </>
            ) : (
              <>
                <ScanSearch className="h-3.5 w-3.5" />
                Check Content
              </>
            )}
          </button>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {scanning && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-400" />
              {scanLabel}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {!scanning && scannedAssets.length === 0 && (
          <p className="flex items-start gap-2 text-xs text-slate-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
            Upload one or more images or EPS/vectors, then run Check Content to
            review them against Adobe Stock rejection guidelines before
            submitting. Existing generated results are reused — no extra AI
            requests are made.
          </p>
        )}

        {!scanning && scannedAssets.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-slate-200">
                Content Check Complete
              </span>
              <span className="text-slate-400">
                {counts.total} scanned ({photos} photos, {vectors} vectors)
              </span>
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-semibold",
                    "bg-emerald-500/10 text-emerald-400"
                  )}
                >
                  Low {counts.LOW}
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-semibold",
                    "bg-amber-500/10 text-amber-400"
                  )}
                >
                  Review {counts.REVIEW}
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-semibold",
                    "bg-orange-500/10 text-orange-400"
                  )}
                >
                  High {counts.HIGH}
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 font-semibold",
                    "bg-red-500/10 text-red-400"
                  )}
                >
                  Very High {counts.VERY_HIGH}
                </span>
              </div>
              {counts.similar > 0 && (
                <span className="flex items-center gap-1 rounded bg-orange-500/10 px-1.5 py-0.5 font-medium text-orange-400">
                  <AlertTriangle className="h-3 w-3" />
                  {counts.similar} similar-content flagged
                </span>
              )}
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {scannedAssets.map(({ image, result, check }) => {
                if (!check) return null;
                const meta = CONTENT_RISK_META[check.riskLevel];
                const issueCount = check.issues.length;
                return (
                  <div
                    key={image.id}
                    className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/40 px-2.5 py-2"
                  >
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-slate-800">
                      {image.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image.previewUrl}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">
                          EPS
                        </div>
                      )}
                      <span
                        className={cn(
                          "absolute bottom-0 left-0 right-0 h-0.5",
                          meta.dotClassName
                        )}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-slate-200">
                        {image.name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold",
                            meta.badgeClassName
                          )}
                        >
                          {check.riskLevel === "LOW" ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <AlertTriangle className="h-3 w-3" />
                          )}
                          {meta.label}
                        </span>
                        {issueCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                            <ShieldAlert className="h-3 w-3" />
                            {issueCount} issue{issueCount === 1 ? "" : "s"}
                          </span>
                        )}
                        {!result && (
                          <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                            local estimate
                          </span>
                        )}
                        {check.issues.some(
                          (issue) => issue.category === "SIMILARITY"
                        ) && (
                          <span className="inline-flex items-center gap-1 rounded bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-medium text-orange-400">
                            similar content
                          </span>
                        )}
                      </div>
                    </div>
                    {result && (
                      <button
                        type="button"
                        onClick={() => onFocusImage(image.id)}
                        className={cn(
                          "shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-[10px]",
                          "font-medium text-slate-300 transition hover:bg-slate-800"
                        )}
                      >
                        View file
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {showEstimateArea && (
              <p className="flex items-start gap-2 text-[11px] text-slate-500">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" />
                Some files above show a local estimate because they have no
                generated metadata yet. Run Generate on them first so Check
                Content can produce a full AI assessment.
              </p>
            )}

            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] leading-relaxed text-slate-400">
              {CONTENT_CHECK_DISCLAIMER}
            </div>

            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <p className="text-[11px] leading-relaxed text-slate-400">
                {counts.flagged > 0 ? (
                  <>
                    {counts.flagged} file{(counts.flagged === 1 ? "" : "s")}{" "}
                    flagged for review. Open each{" "}
                    <span className="font-medium text-slate-300">
                      View Issues
                    </span>{" "}
                    panel in the results below for the specific reasons, then
                    revise the files before submitting to Adobe Stock.
                  </>
                ) : (
                  "No files were flagged. Nothing in the scan points to a potential Adobe Stock rejection reason right now — just double-check the flagged guidance before you submit."
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}