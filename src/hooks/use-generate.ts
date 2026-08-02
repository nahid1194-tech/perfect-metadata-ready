"use client"

import {
  cancelImage,
  pauseQueue,
  resumeQueue,
  retryImage,
  runQueue,
  stopQueue,
} from "@/lib/queue";
import { useAppStore } from "@/store/use-app-store";

export function useGenerate() {
  const generating = useAppStore((state) => state.generating);
  const queueState = useAppStore((state) => state.queueState);
  const progress = useAppStore((state) => state.progress);
  const completed = useAppStore((state) => state.batchCompleted);
  const total = useAppStore((state) => state.batchTotal);
  const etaSeconds = useAppStore((state) => state.etaSeconds);

  return {
    run: runQueue,
    pause: pauseQueue,
    resume: resumeQueue,
    stop: stopQueue,
    regenerate: retryImage,
    cancelImage,
    generating,
    queueState,
    progress,
    completed,
    total,
    etaSeconds,
  };
}
