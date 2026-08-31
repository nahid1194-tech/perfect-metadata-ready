"use client"

import { useEffect, useMemo, useRef } from "react"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import { ListChecks, Sparkles } from "lucide-react"

import type { GenerationResult, RiskLevel } from "@/lib/types"
import { ImageCard } from "@/components/dashboard/image-card"
import { PendingImageCard } from "@/components/dashboard/pending-image-card"
import { useAppStore } from "@/store/use-app-store"
import {
  CONTENT_RISK_META,
  normalizeContentCheck,
  resolveContentCheck,
} from "@/lib/content-check"
import { cn } from "@/lib/utils"

const VIRTUALIZE_THRESHOLD = 20;

const RISK_FILTERS: (RiskLevel | "ALL")[] = [
  "ALL",
  "LOW",
  "REVIEW",
  "HIGH",
  "VERY_HIGH",
];

export function ResultsSection() {
  const images = useAppStore((state) => state.images);
  const results = useAppStore((state) => state.results);
  const queueItems = useAppStore((state) => state.queueItems);
  const activeImageId = useAppStore((state) => state.activeImageId);
  const autoScroll = useAppStore((state) => state.autoScroll);
  const scannedImageIds = useAppStore((state) => state.scannedImageIds);
  const scanIssues = useAppStore((state) => state.scanIssues);
  const riskFilter = useAppStore((state) => state.riskFilter);
  const setRiskFilter = useAppStore((state) => state.setRiskFilter);
  const prevActiveRef = useRef<string | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  useEffect(() => {
    if (activeImageId && activeImageId !== prevActiveRef.current) {
      prevActiveRef.current = activeImageId;
      if (autoScroll) {
        requestAnimationFrame(() => {
          document
            .getElementById(`card-${activeImageId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    }
    if (!activeImageId) prevActiveRef.current = null;
  }, [activeImageId, autoScroll]);

  useEffect(() => {
    if (!activeImageId || !autoScroll) return;
    const id = setInterval(() => {
      const el = document.getElementById(`card-${activeImageId}`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < 56 || rect.bottom > window.innerHeight - 96) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 1600);
    return () => clearInterval(id);
  }, [activeImageId, autoScroll]);

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

  const riskByImageId = useMemo(() => {
    const map = new Map<string, RiskLevel>();
    for (const result of results) {
      if (!scannedImageIds.includes(result.imageId)) continue;
      const check = resolveContentCheck(
        normalizeContentCheck(result.metadata.contentCheck),
        scanIssues[result.imageId] ?? []
      );
      map.set(result.imageId, check.riskLevel);
    }
    return map;
  }, [results, scannedImageIds, scanIssues]);

  const anyScannedResult = useMemo(
    () =>
      cards.some(
        (card) => card.kind === "result" && riskByImageId.has(card.result.imageId)
      ),
    [cards, riskByImageId]
  );

  const filteredCards = useMemo(() => {
    if (riskFilter === "ALL") return cards;
    return cards.filter((card) => {
      if (card.kind !== "result") return true;
      return riskByImageId.get(card.result.imageId) === riskFilter;
    });
  }, [cards, riskFilter, riskByImageId]);

  useEffect(() => {
    if (
      !activeImageId ||
      !autoScroll ||
      cards.length <= VIRTUALIZE_THRESHOLD
    )
      return;
    const index = cards.findIndex((card) => {
      const cardImageId =
        card.kind === "result" ? card.result.imageId : card.image.id;
      return cardImageId === activeImageId;
    });
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: "center" });
    }
  }, [activeImageId, autoScroll, cards]);

  if (cards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed bg-card/60 px-6 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-5" />
        </div>
        <p className="text-sm font-semibold">No results yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Upload images and hit &ldquo;Generate All&rdquo; &mdash; metadata for each image will
          appear here, ready to edit and export.
        </p>
      </div>
    );
  }

  const renderItem = (card: NonNullable<(typeof cards)[number]>) =>
    card.kind === "result" ? (
      <div className="pb-3">
        <ImageCard result={card.result} />
      </div>
    ) : (
      <div className="pb-3">
        <PendingImageCard
          image={card.image}
          item={card.item}
          active={card.image.id === activeImageId}
        />
      </div>
    );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          {pendingCount > 0 ? "Queue" : "Results"}{" "}
          <span className="text-muted-foreground">({filteredCards.length})</span>
        </h2>
        {anyScannedResult ? (
          <div className="flex flex-wrap items-center gap-1">
            <ListChecks className="mr-0.5 size-3.5 text-muted-foreground" />
            {RISK_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setRiskFilter(filter)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  riskFilter === filter
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
              >
                {filter === "ALL"
                  ? "All"
                  : CONTENT_RISK_META[filter].label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {filteredCards.length === 0 && cards.length > 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-[20px] border border-dashed bg-card/60 px-6 py-8 text-center">
          <p className="text-sm font-semibold">No results match this filter</p>
          <button
            type="button"
            onClick={() => setRiskFilter("ALL")}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Show all results
          </button>
        </div>
      ) : filteredCards.length <= VIRTUALIZE_THRESHOLD ? (
        <div className="flex flex-col">
          {filteredCards.map((card) => (
            <div
              key={card.kind === "result" ? card.result.id : card.image.id}
            >
              {renderItem(card)}
            </div>
          ))}
        </div>
      ) : (
        <Virtuoso
          ref={virtuosoRef}
          useWindowScroll
          data={filteredCards}
          itemContent={(_, card) => renderItem(card)}
        />
      )}
    </section>
  );
}
