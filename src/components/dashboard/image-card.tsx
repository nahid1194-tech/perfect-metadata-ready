"use client"

import { memo, useState } from "react"
import { motion } from "framer-motion"
import { FileImage, Loader2, RefreshCw, Trash2 } from "lucide-react"

import type { GenerationResult } from "@/lib/types"
import { marketplaceFormat, marketplaceLabel } from "@/lib/marketplace"
import {
  ADOBE_KEYWORDS_MAX,
  ADOBE_TITLE_MAX,
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

export const ImageCard = memo(function ImageCard({ result }: { result: GenerationResult }) {
  const platform = useAppStore((state) => state.settings.platform);
  const images = useAppStore((state) => state.images);
  const updateResult = useAppStore((state) => state.updateResult);
  const removeResult = useAppStore((state) => state.removeResult);
  const { regenerate } = useGenerate();
  const [regenerating, setRegenerating] = useState(false);

  const format = marketplaceFormat(platform);
  const metadata = result.metadata[format];
  const isAdobe = format === "adobe";
  const keywordMax = isAdobe ? ADOBE_KEYWORDS_MAX : SHUTTERSTOCK_KEYWORDS_MAX;

  const image = images.find((item) => item.id === result.imageId);
  const previewable =
    image && (image.type.startsWith("image/") || image.type.startsWith("video/"));

  const patch = (field: keyof typeof metadata, value: string | string[]) =>
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
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className="rounded-[20px] border bg-card p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            {previewable && image.type.startsWith("video/") ? (
              <video
                src={image.apiDataUrl ?? image.dataUrl}
                muted
                className="h-24 w-28 rounded-xl bg-muted object-cover ring-1 ring-foreground/10"
              />
            ) : previewable ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.apiDataUrl ?? image.dataUrl}
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

          <p className="min-w-0 flex-1 truncate pt-1 text-sm font-medium">
            {result.imageName}
          </p>
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
                isAdobe &&
                  metadata.title.length > ADOBE_TITLE_MAX &&
                  "border-destructive focus-visible:border-destructive"
              )}
            />
            <div className="flex items-center justify-between">
              <Counter
                value={metadata.title.length}
                max={isAdobe ? ADOBE_TITLE_MAX : undefined}
                error={isAdobe && metadata.title.length > ADOBE_TITLE_MAX}
              />
              {isAdobe && metadata.title.includes(",") ? (
                <p className="text-xs font-medium text-destructive">
                  Commas are not allowed in Adobe titles
                </p>
              ) : null}
            </div>
          </div>

          {!isAdobe ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Description</Label>
                <CopyButton text={metadata.description} />
              </div>
              <Textarea
                value={metadata.description}
                onChange={(e) => patch("description", e.target.value)}
                rows={3}
              />
              <div className="flex items-center justify-between">
                <Counter
                  value={metadata.description.length}
                  max={SHUTTERSTOCK_TITLE_MAX}
                  error={metadata.description.length > SHUTTERSTOCK_TITLE_MAX}
                />
                {!metadata.description.trim() ? (
                  <p className="text-xs font-medium text-destructive">Required</p>
                ) : null}
              </div>
            </div>
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
              min={isAdobe ? 0 : SHUTTERSTOCK_KEYWORDS_MIN}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Category</Label>
            <CategoryEditor
              mode={format}
              value={metadata.category}
              onChange={(category) => patch("category", category)}
            />
          </div>
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
      </div>
    </motion.article>
  );
});
