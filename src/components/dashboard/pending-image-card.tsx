"use client"

import { motion } from "framer-motion"
import {
  AlertTriangle,
  Clock,
  FileImage,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react"

import type { GenerationStatus, ImageAsset, QueueItem } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { useGenerate } from "@/hooks/use-generate"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

const STATUS_META: Record<GenerationStatus, { label: string; className: string }> = {
  uploading: {
    label: "Uploading",
    className: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  waiting: {
    label: "Waiting",
    className: "bg-muted text-muted-foreground",
  },
  analyzing: {
    label: "Analyzing",
    className: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  generating: {
    label: "Generating Metadata",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  retrying: {
    label: "Retrying",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  completed: {
    label: "Completed",
    className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  failed: {
    label: "Failed",
    className: "bg-destructive/15 text-destructive",
  },
};

function isPreviewable(type: string): boolean {
  return type.startsWith("image/") || type.startsWith("video/");
}

export function PendingImageCard({
  image,
  item,
  active = false,
}: {
  image: ImageAsset;
  item: QueueItem;
  active?: boolean;
}) {
  const generating = useAppStore((state) => state.generating);
  const removeImage = useAppStore((state) => state.removeImage);
  const removeResult = useAppStore((state) => state.removeResult);
  const { cancelImage, regenerate } = useGenerate();

  const meta = STATUS_META[item.status];
  const inProgress =
    item.status === "uploading" ||
    item.status === "analyzing" ||
    item.status === "generating" ||
    item.status === "retrying";
  const showBar = inProgress || item.status === "waiting";
  const previewable = isPreviewable(image.type);

  const handleRetry = async () => {
    try {
      await regenerate(image.id);
    } catch (error) {
      toast(
        "error",
        "Retry failed",
        error instanceof Error ? error.message : "Could not retry this image."
      );
    }
  };

  const handleRemove = () => {
    const store = useAppStore.getState();
    const result = store.results.find((item) => item.imageId === image.id);
    if (result) removeResult(result.id);
    removeImage(image.id);
    toast("info", "File removed", image.name);
  };

  return (
    <motion.article
      id={`card-${image.id}`}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ type: "spring", stiffness: 260, damping: 26 }}
      className={cn(
        "scroll-mt-24 rounded-[20px] border bg-card p-4 shadow-sm transition-[border-color,box-shadow] duration-300 sm:p-5",
        active &&
          "border-primary shadow-[0_8px_40px_-8px] shadow-primary/25 ring-2 ring-primary/30"
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            {previewable && image.dataUrl ? (
              image.type.startsWith("video/") ? (
                <video
                  src={image.apiDataUrl ?? image.dataUrl}
                  muted
                  className="h-20 w-24 rounded-xl bg-muted object-cover ring-1 ring-foreground/10"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image.apiDataUrl ?? image.dataUrl}
                  alt={image.name}
                  className="h-20 w-24 rounded-xl bg-muted object-cover ring-1 ring-foreground/10"
                />
              )
            ) : (
              <div className="flex h-20 w-24 items-center justify-center rounded-xl bg-muted ring-1 ring-foreground/10">
                <FileImage className="size-6 text-muted-foreground" />
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">
                {image.name}
              </p>
              <Badge variant="secondary" className={cn("gap-1", meta.className)}>
                {inProgress ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : item.status === "waiting" ? (
                  <Clock className="size-3" />
                ) : null}
                {meta.label}
              </Badge>
            </div>

            {item.statusMessage ? (
              <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
                <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
                <span className="min-w-0">{item.statusMessage}</span>
              </div>
            ) : item.error ? (
              <div className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0">{item.error}</span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {item.status === "waiting"
                  ? "Queued and waiting for the batch to reach it."
                  : item.status === "uploading"
                    ? "Reading the file into memory…"
                    : "Processing image…"}
              </p>
            )}
          </div>
        </div>

        {showBar ? (
          <Progress
            value={item.progress}
            className="h-1.5"
            indicatorClassName={cn(
              item.status === "failed" && "bg-destructive",
              item.status === "completed" && "bg-emerald-500"
            )}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {item.status === "failed" ? (
            <>
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <RefreshCw />
                Retry
              </Button>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                disabled={generating}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleRemove}
              >
                <Trash2 />
                Remove
              </Button>
            </>
          ) : inProgress ? (
            <>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => cancelImage(image.id)}
              >
                <X />
                Cancel
              </Button>
            </>
          ) : (
            <>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                disabled={generating}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={handleRemove}
              >
                <Trash2 />
                Remove
              </Button>
            </>
          )}
        </div>
      </div>
    </motion.article>
  );
}
