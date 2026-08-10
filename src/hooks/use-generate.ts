"use client"

import {
  cancelBackgroundImage,
  pauseBackgroundJob,
  resumeBackgroundQueue,
  retryBackgroundImage,
  startBackgroundJob,
  stopBackgroundJob,
} from "@/lib/background-queue";
import { useAppStore } from "@/store/use-app-store";

export function useGenerate() {
  const generating = useAppStore((state) => state.generating);
  const queueState = useAppStore((state) => state.queueState);
  const progress = useAppStore((state) => state.progress);
  const completed = useAppStore((state) => state.batchCompleted);
  const total = useAppStore((state) => state.batchTotal);
  const etaSeconds = useAppStore((state) => state.etaSeconds);

  return {
    run: startBackgroundJob,
    pause: pauseBackgroundJob,
    resume: resumeBackgroundQueue,
    stop: stopBackgroundJob,
    regenerate: retryBackgroundImage,
    cancelImage: cancelBackgroundImage,
    generating,
    queueState,
    progress,
    completed,
    total,
    etaSeconds,
  };
}
