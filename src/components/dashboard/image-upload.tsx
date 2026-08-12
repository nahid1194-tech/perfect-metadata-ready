"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { FileImage, ImagePlus, Loader2, X } from "lucide-react"

import {
  formatBytes,
  isPreviewableType,
  isSupportedFile,
  processUploadFiles,
} from "@/lib/upload-process"
import { EPS_MAX_FILE_SIZE_MB } from "@/lib/image-process"
import { cn } from "@/lib/utils"
import { Progress } from "@/components/ui/progress"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

const MAX_IMAGES = 100;

type UploadItem = {
  file: File;
  phase: "reading" | "compressing" | "converting";
  progress: number;
};

export function ImageUpload() {
  const images = useAppStore((state) => state.images);
  const addImages = useAppStore((state) => state.addImages);
  const removeImage = useAppStore((state) => state.removeImage);
  const selectedIds = useAppStore((state) => state.selectedIds);
  const toggleSelected = useAppStore((state) => state.toggleSelected);
  const generating = useAppStore((state) => state.generating);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<UploadItem[]>([]);
  const [galleryHidden, setGalleryHidden] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (generating) setGalleryHidden(true);
  }, [generating]);

  const readFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const list = Array.from(fileList);
      if (list.length > MAX_IMAGES) {
        toast(
          "error",
          "Too many images",
          `You can upload up to ${MAX_IMAGES} images in a single batch (${list.length} selected).`
        );
        return;
      }
      const accepted: File[] = [];
      for (const file of list) {
        if (!isSupportedFile(file)) {
          toast(
            "error",
            "Unsupported file",
            `${file.name} is not a supported file type.`
          );
          continue;
        }
        accepted.push(file);
      }

      if (accepted.length === 0) return;

      setQueue(accepted.map((file) => ({ file, phase: "reading", progress: 0 })));
      const patchItem = (file: File, patch: Partial<UploadItem>) =>
        setQueue((current) =>
          current.map((item) =>
            item.file === file ? { ...item, ...patch } : item
          )
        );

      const { assets, failures } = await processUploadFiles(
        accepted,
        patchItem,
        (asset) => addImages([asset])
      );

      setQueue([]);
      for (const failure of failures) {
        toast(
          "error",
          failure.kind === "eps-render"
            ? "Could not render EPS"
            : failure.kind === "eps-too-large"
              ? "EPS too large"
              : failure.tooLarge
                ? "Image too large"
                : "Could not process file",
          failure.message
        );
      }
      if (failures.length === 0) {
        toast(
          "success",
          "Upload complete",
          `${assets.length} file${assets.length === 1 ? "" : "s"} added.`
        );
      } else if (assets.length > 0) {
        toast(
          "info",
          "Upload complete",
          `${assets.length} added, ${failures.length} failed.`
        );
      } else {
        toast("error", "Upload failed", "No files could be added.");
      }
    },
    [addImages]
  );

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const files = event.dataTransfer.files;
    if (files?.length) readFiles(files);
  };

  return (
    <div className="flex flex-col gap-4">
      <motion.div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        whileHover={{ scale: 1.005 }}
        transition={{ duration: 0.15 }}
        className={cn(
          "flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center outline-none transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60"
        )}
      >
        <motion.div
          animate={dragging ? { scale: 1.12, y: -2 } : { scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 20 }}
          className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"
        >
          <ImagePlus className="size-6" />
        </motion.div>
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold">
            Drag &amp; Drop Your Images Here
          </p>
          <p className="text-sm text-muted-foreground">
            or browse — JPG, PNG, WEBP, SVG, EPS, Videos · up to {MAX_IMAGES} images · EPS up to {EPS_MAX_FILE_SIZE_MB} MB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*,.svg,.eps,.ps"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) readFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </motion.div>

      {queue.length > 0 ? (
        <div className="flex flex-col gap-2">
          {queue.map((item, index) => (
            <div key={index} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium">{item.file.name}</span>
                {item.phase === "compressing" || item.phase === "converting" ? (
                  <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    {item.phase === "converting" ? "Converting…" : "Compressing…"}
                  </span>
                ) : (
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {item.progress}%
                  </span>
                )}
              </div>
              <Progress
                value={item.phase === "compressing" || item.phase === "converting" ? 100 : item.progress}
                className="h-1"
                indicatorClassName={
                  item.phase === "compressing" || item.phase === "converting"
                    ? "animate-pulse bg-primary/70"
                    : undefined
                }
              />
            </div>
          ))}
        </div>
      ) : null}

      {images.length > 0 && !galleryHidden ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={selectedIds.length === images.length}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      selectedIds.length > 0 && selectedIds.length < images.length;
                  }
                }}
                disabled={generating}
                onChange={(e) => {
                  useAppStore
                    .getState()
                    .setSelected(e.target.checked ? images.map((img) => img.id) : []);
                }}
                className="size-4 accent-primary"
              />
              {images.length}/{MAX_IMAGES} images · {selectedIds.length} selected
            </label>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
              {images.length}/{MAX_IMAGES} uploaded
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <AnimatePresence initial={false}>
              {images.map((image) => {
                const selected = selectedIds.includes(image.id);
                const previewSrc = image.apiDataUrl ?? image.dataUrl;
                return (
                  <motion.div
                    key={image.id}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ type: "spring", stiffness: 300, damping: 24 }}
                    className="group relative"
                  >
                    {isPreviewableType(image.type) ? (
                      image.type.startsWith("video/") ? (
                        <video
                          src={previewSrc}
                          muted
                          className={cn(
                            "h-28 w-full rounded-xl bg-muted object-cover ring-1 transition-shadow",
                            selected ? "ring-2 ring-primary" : "ring-foreground/10"
                          )}
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={previewSrc}
                          alt={image.name}
                          className={cn(
                            "h-28 w-full rounded-xl object-cover ring-1 transition-shadow",
                            selected ? "ring-2 ring-primary" : "ring-foreground/10"
                          )}
                        />
                      )
                    ) : (
                      <div
                        className={cn(
                          "flex h-28 w-full items-center justify-center rounded-xl bg-muted ring-1 transition-shadow",
                          selected ? "ring-2 ring-primary" : "ring-foreground/10"
                        )}
                      >
                        <FileImage className="size-8 text-muted-foreground" />
                      </div>
                    )}
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={generating}
                      onChange={() => toggleSelected(image.id)}
                      className="absolute top-1.5 left-1.5 size-4 accent-primary"
                      aria-label={`Select ${image.name}`}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        removeImage(image.id);
                        toast("info", "File removed", image.name);
                      }}
                      disabled={generating}
                      className="absolute top-1.5 right-1.5 rounded-md bg-background/80 p-1 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-destructive hover:text-white disabled:pointer-events-none disabled:opacity-50"
                      aria-label={`Remove ${image.name}`}
                    >
                      <X className="size-3.5" />
                    </button>
                    <div className="mt-1 px-0.5">
                      <p className="truncate text-xs font-medium">{image.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatBytes(image.size)}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      ) : null}
    </div>
  );
}
