"use client"

import { useMemo } from "react"
import { AnimatePresence } from "framer-motion"
import { Sparkles } from "lucide-react"

import type { GenerationResult } from "@/lib/types"
import { ImageCard } from "@/components/dashboard/image-card"
import { PendingImageCard } from "@/components/dashboard/pending-image-card"
import { useAppStore } from "@/store/use-app-store"

export function ResultsSection() {
  const images = useAppStore((state) => state.images);
  const results = useAppStore((state) => state.results);
  const queueItems = useAppStore((state) => state.queueItems);

  const cards = useMemo(() => {
    const resultByImage = new Map<string, GenerationResult>();
    for (const result of results) resultByImage.set(result.imageId, result);

    return images
      .map((image) => {
        const result = resultByImage.get(image.id);
        if (result) {
          return { kind: "result" as const, image, result };
        }
        const item = queueItems[image.id];
        if (item) {
          return { kind: "pending" as const, image, item };
        }
        return null;
      })
      .filter((card): card is NonNullable<typeof card> => card !== null);
  }, [images, results, queueItems]);

  const pendingCount = cards.filter((card) => card.kind === "pending").length;

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed bg-card/60 px-6 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-5" />
        </div>
        <p className="text-sm font-semibold">No results yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Upload images and hit “Generate All” — metadata for each image will
          appear here, ready to edit and export.
        </p>
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {pendingCount > 0 ? "Queue" : "Results"}{" "}
          <span className="text-muted-foreground">({cards.length})</span>
        </h2>
      </div>
      <AnimatePresence initial={false}>
        {cards.map((card) =>
          card.kind === "result" ? (
            <ImageCard key={card.result.id} result={card.result} />
          ) : (
            <PendingImageCard key={card.image.id} image={card.image} item={card.item} />
          )
        )}
      </AnimatePresence>
    </section>
  );
}
