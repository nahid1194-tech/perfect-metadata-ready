"use client"

import { lazy, memo, Suspense, useState } from "react"
import { motion } from "framer-motion"
import { ChevronDown, FileImage, Loader2, Maximize2, RefreshCw, ShieldAlert, Trash2 } from "lucide-react"

import type { EditorialStatus, GenerationResult } from "@/lib/types"
import { marketplaceFormat, marketplaceLabel } from "@/lib/marketplace"
import {
  EDITORIAL_SIGNAL_LABELS,
  EDITORIAL_STATUS_META,
  applyEditorialOverride,
  normalizeEditorialAssessment,
} from "@/lib/editorial"
import {
  CATEGORY_LABELS,
  CONTENT_CHECK_DISCLAIMER,
  CONTENT_RISK_META,
  normalizeContentCheck,
  resolveContentCheck,
  SEVERITY_META,
} from "@/lib/content-check"
import {
  ADOBE_KEYWORDS_MAX,
  ADOBE_TITLE_MAX,
  MAGNIFIC_KEYWORDS_MAX,
  MAGNIFIC_TITLE_MAX,
  SHUTTERSTOCK_KEYWORDS_MAX,
  SHUTTERSTOCK_KEYWORDS_MIN,
  SHUTTERSTOCK_TITLE_MAX,
} from "@/lib/stock-spec"
import { cn } from "@/lib/utils"
import {
  CategoryEditor,
  CopyButton,
  Counter,
  KeywordEditor,
} from "@/components/dashboard/metadata-editors"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useGenerate } from "@/hooks/use-generate"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

// The fullscreen preview only mounts when the user clicks "Preview"; keep its
// code out of the initial dashboard bundle until it is actually needed.
const ImagePreviewModal = lazy(() =>
  import("@/components/dashboard/image-preview-modal").then((m) => ({
    default: m.ImagePreviewModal,
  }))
);

function qualityColor(score: number): string {
  if (score >= 90) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
  if (score >= 70) return "bg-amber-500/15 text-amber-700 dark:text-amber-400"
  return "bg-red-500/15 text-red-700 dark:text-red-400"
}

export const ImageCard = memo(function ImageCard({ result }: { result: GenerationResult }) {
  const platform = useAppStore((state) => state.settings.platform);
  const image = useAppStore((state) =>
    state.images.find((img) => img.id === result.imageId)
  );
  const updateResult = useAppStore((state) => state.updateResult);
  const removeResult = useAppStore((state) => state.removeResult);
  const { regenerate } = useGenerate();
  const [regenerating, setRegenerating] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [timingOpen, setTimingOpen] = useState(false);
  const [editorialOpen, setEditorialOpen] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);

  const format = marketplaceFormat(platform);
  const isMagnific = format === "magnific";
  const metadata = isMagnific ? result.metadata.magnific : result.metadata[format];
  const isAdobe = format === "adobe";
  const isShutterstock = format === "shutterstock";
  const keywordMax = isAdobe ? ADOBE_KEYWORDS_MAX : isShutterstock ? SHUTTERSTOCK_KEYWORDS_MAX : MAGNIFIC_KEYWORDS_MAX;

  const editorial = normalizeEditorialAssessment(result.metadata.editorialAssessment);
  const editorialMeta = EDITORIAL_STATUS_META[editorial.status];

  const scannedImageIds = useAppStore((state) => state.scannedImageIds);
  const scanIssues = useAppStore((state) => state.scanIssues);
  const scanned = scannedImageIds.includes(result.imageId);
  const contentCheck = normalizeContentCheck(result.metadata.contentCheck);
  const resolvedCheck = scanned
    ? resolveContentCheck(contentCheck, scanIssues[result.imageId] ?? [])
    : null;
  const riskMeta = resolvedCheck ? CONTENT_RISK_META[resolvedCheck.riskLevel] : null;

  const setEditorialStatus = (status: EditorialStatus) =>
    updateResult(result.id, (current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        editorialAssessment: applyEditorialOverride(
          current.metadata.editorialAssessment,
          status
        ),
      },
    }));

  const previewable =
    image && (image.type.startsWith("image/") || image.type.startsWith("video/"));
  const previewSrc = image?.previewUrl ?? image?.apiDataUrl ?? image?.dataUrl;
  const previewIsVideo = image?.type.startsWith("video/") ?? false;

  const patch = (field: string, value: string | string[]) =>
    updateResult(result.id, (current) => ({
      ...current,
      metadata: {
        ...current.metadata,
        [format]: { ...current.metadata[format], [field]: value },
      },
    }));

  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      await regenerate(result.imageId);
      toast("success", "Regenerated", result.imageName);
    } catch (error) {
      toast(
        "error",
        "Regeneration failed",
        error instanceof Error ? error.message : "Could not regenerate this image."
      );
    } finally {
      setRegenerating(false);
    }
  };

  const handleDelete = () => {
    removeResult(result.id);
    const remaining = useAppStore.getState().results.some(
      (item) => item.imageId === result.imageId
    );
    if (!remaining) {
      useAppStore.getState().removeImage(result.imageId);
    }
    toast("info", "Result deleted", result.imageName);
  };

  return (
    <>
      <motion.article
        layout
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className={cn(
          "rounded-[20px] border bg-card p-4 shadow-sm sm:p-5",
          editorialMeta.cardBorderClassName,
          riskMeta?.cardBorderClassName
        )}
      >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div className="relative">
              {previewable && image.type.startsWith("video/") ? (
                <video
                  src={image.previewUrl ?? image.apiDataUrl ?? image.dataUrl}
                  muted
                  className="h-24 w-28 rounded-xl bg-muted object-cover ring-1 ring-foreground/10"
                />
              ) : previewable ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image.previewUrl ?? image.apiDataUrl ?? image.dataUrl}
                  alt={result.imageName}
                  className="h-24 w-28 rounded-xl bg-muted object-cover ring-1 ring-foreground/10"
                />
              ) : (
                <div className="flex h-24 w-28 items-center justify-center rounded-xl bg-muted ring-1 ring-foreground/10">
                  <FileImage className="size-7 text-muted-foreground" />
                </div>
              )}
              <Badge className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-foreground text-background">
                {marketplaceLabel(platform)}
              </Badge>
            </div>
            {previewSrc ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPreviewOpen(true)}
                aria-label="Preview image"
              >
                <Maximize2 />
                Preview
              </Button>
            ) : null}
          </div>

          <p className="min-w-0 flex-1 truncate pt-1 text-sm font-medium">
            {result.imageName}
          </p>
          <Badge
            variant="secondary"
            className={cn(
              "shrink-0 gap-1.5 text-xs font-semibold",
              editorialMeta.badgeClassName
            )}
          >
            <span className={cn("size-2 rounded-full", editorialMeta.dotClassName)} />
            {editorialMeta.label}
          </Badge>
          {resolvedCheck && riskMeta ? (
            <Badge
              variant="secondary"
              className={cn("shrink-0 gap-1.5 text-xs font-semibold", riskMeta.badgeClassName)}
            >
              <span className={cn("size-2 rounded-full", riskMeta.dotClassName)} />
              {riskMeta.label}
            </Badge>
          ) : null}
          {result.qualityScore != null ? (
            <Badge
              variant="secondary"
              className={cn("shrink-0 text-xs font-semibold", qualityColor(result.qualityScore))}
            >
              {result.qualityScore}/100
            </Badge>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Title</Label>
              <CopyButton text={metadata.title} />
            </div>
            <Input
              value={metadata.title}
              onChange={(e) => patch("title", e.target.value)}
              className={cn(
                (isAdobe && metadata.title.length > ADOBE_TITLE_MAX) ||
                  (isMagnific && metadata.title.length > MAGNIFIC_TITLE_MAX) &&
                  "border-destructive focus-visible:border-destructive"
              )}
            />
            <div className="flex items-center justify-between">
              <Counter
                value={metadata.title.length}
                max={isAdobe ? ADOBE_TITLE_MAX : isMagnific ? MAGNIFIC_TITLE_MAX : undefined}
                error={(isAdobe && metadata.title.length > ADOBE_TITLE_MAX) ||
                  (isMagnific && metadata.title.length > MAGNIFIC_TITLE_MAX)}
              />
              {isAdobe && metadata.title.includes(",") ? (
                <p className="text-xs font-medium text-destructive">
                  Commas are not allowed in Adobe titles
                </p>
              ) : null}
            </div>
          </div>

          {isShutterstock ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Description</Label>
                <CopyButton text={(metadata as { description?: string }).description ?? ""} />
              </div>
              <Textarea
                value={(metadata as { description?: string }).description ?? ""}
                onChange={(e) => patch("description", e.target.value)}
                rows={3}
              />
              <div className="flex items-center justify-between">
                <Counter
                  value={((metadata as { description?: string }).description ?? "").length}
                  max={SHUTTERSTOCK_TITLE_MAX}
                  error={((metadata as { description?: string }).description ?? "").length > SHUTTERSTOCK_TITLE_MAX}
                />
                {!(metadata as { description?: string }).description?.trim() ? (
                  <p className="text-xs font-medium text-destructive">Required</p>
                ) : null}
              </div>
            </div>
          ) : null}

          {isMagnific ? (
            <>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>Prompt</Label>
                  <CopyButton text={(metadata as { prompt?: string }).prompt ?? ""} />
                </div>
                <Textarea
                  value={(metadata as { prompt?: string }).prompt ?? ""}
                  onChange={(e) => patch("prompt", e.target.value)}
                  rows={2}
                  placeholder="AI generation prompt"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>Model</Label>
                  <CopyButton text={(metadata as { model?: string }).model ?? ""} />
                </div>
                <Input
                  value={(metadata as { model?: string }).model ?? ""}
                  onChange={(e) => patch("model", e.target.value)}
                  placeholder="AI Generated"
                />
              </div>
            </>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Keywords</Label>
              <CopyButton text={metadata.keywords.join(", ")} />
            </div>
            <KeywordEditor
              keywords={metadata.keywords}
              onChange={(keywords) => patch("keywords", keywords)}
              max={keywordMax}
              min={isShutterstock ? SHUTTERSTOCK_KEYWORDS_MIN : 0}
            />
          </div>

          {!isMagnific ? (
            <div className="flex flex-col gap-1.5">
              <Label>Category</Label>
              <CategoryEditor
                mode={format}
                value={(metadata as { category?: string }).category ?? ""}
                onChange={(category) => patch("category", category)}
              />
            </div>
          ) : null}
        </div>

        <div className="border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditorialOpen((open) => !open)}
            >
              <ChevronDown className={cn("size-3 transition-transform", editorialOpen && "rotate-180")} />
              Editorial Details
            </Button>
            {resolvedCheck && resolvedCheck.issues.length > 0 ? (
              <Button
                variant={issuesOpen ? "default" : "outline"}
                size="sm"
                onClick={() => setIssuesOpen((open) => !open)}
              >
                <ShieldAlert className={cn("size-3", resolvedCheck.riskLevel !== "LOW" && "text-orange-500")} />
                View Issues
                <span className="ml-0.5 rounded-full bg-background/80 px-1.5 text-[10px] font-semibold">
                  {resolvedCheck.issues.length}
                </span>
              </Button>
            ) : null}
          </div>

          {issuesOpen && resolvedCheck ? (
            <div className="mt-2 flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide",
                    riskMeta?.badgeClassName
                  )}
                >
                  <span className={cn("size-2 rounded-full", riskMeta?.dotClassName)} />
                  {riskMeta?.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  AI confidence: {resolvedCheck.confidence}/100
                </span>
              </div>
              {resolvedCheck.recommendation ? (
                <p className="text-sm">{resolvedCheck.recommendation}</p>
              ) : null}
              <div className="space-y-1.5">
                {resolvedCheck.issues.map((issue, index) => (
                  <div key={`${issue.category}-${index}`} className="flex items-start gap-2 text-xs">
                    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">
                      {CATEGORY_LABELS[issue.category]}
                    </span>
                    <span className={cn("shrink-0 font-semibold", SEVERITY_META[issue.severity].className)}>
                      {SEVERITY_META[issue.severity].label}
                    </span>
                    <span className="text-muted-foreground">{issue.reason}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">{CONTENT_CHECK_DISCLAIMER}</p>
            </div>
          ) : null}

          {editorialOpen ? (
            <div className="mt-2 flex flex-col gap-2 rounded-xl border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide",
                    editorialMeta.badgeClassName
                  )}
                >
                  <span className={cn("size-2 rounded-full", editorialMeta.dotClassName)} />
                  {editorialMeta.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  AI confidence: {editorial.confidence}/100
                </span>
              </div>
              <p className="text-sm">{editorial.reason}</p>
              {editorial.signals.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {editorial.signals.map((signal) => (
                    <span
                      key={signal}
                      className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
                    >
                      {EDITORIAL_SIGNAL_LABELS[signal]}
                    </span>
                  ))}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                AI classification is a recommendation. Verify Adobe Stock
                eligibility before submission.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant={
                    editorial.status === "POTENTIAL_EDITORIAL" ? "default" : "outline"
                  }
                  onClick={() => setEditorialStatus("POTENTIAL_EDITORIAL")}
                >
                  Mark as Editorial
                </Button>
                <Button
                  size="sm"
                  variant={editorial.status === "STANDARD" ? "default" : "outline"}
                  onClick={() => setEditorialStatus("STANDARD")}
                >
                  Mark as Standard
                </Button>
                <Button
                  size="sm"
                  variant={editorial.status === "REVIEW_REQUIRED" ? "default" : "outline"}
                  onClick={() => setEditorialStatus("REVIEW_REQUIRED")}
                >
                  Mark for Review
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            disabled={regenerating}
            onClick={handleRegenerate}
          >
            {regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Regenerate
          </Button>
          {result.timingMs && Object.keys(result.timingMs).length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTimingOpen((o) => !o)}
            >
              <ChevronDown className={cn("size-3 transition-transform", timingOpen && "rotate-180")} />
              Timing
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 />
            Delete
          </Button>
        </div>
        {timingOpen && result.timingMs ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-2 font-mono text-xs text-muted-foreground sm:grid-cols-3">
            {Object.entries(result.timingMs)
              .filter(([, ms]) => ms >= 1)
              .sort(([, a], [, b]) => b - a)
              .map(([key, ms]) => (
                <div key={key} className="flex items-center justify-between gap-1">
                  <span className="truncate">{key}</span>
                  <span className="shrink-0 font-semibold text-foreground">
                    {(ms / 1000).toFixed(1)}s
                  </span>
                </div>
              ))}
          </div>
        ) : null}
      </div>
    </motion.article>

    {previewOpen && previewSrc ? (
      <Suspense fallback={null}>
        <ImagePreviewModal
          src={previewSrc}
          isVideo={previewIsVideo}
          alt={result.imageName}
          onClose={() => setPreviewOpen(false)}
        />
      </Suspense>
    ) : null}
  </>
  );
});
