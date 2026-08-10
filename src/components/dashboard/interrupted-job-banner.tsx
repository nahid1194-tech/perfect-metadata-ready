"use client"

import { AlertTriangle, RotateCcw, X } from "lucide-react"

import {
  dismissBackgroundJob,
  resumeInterruptedBackgroundJob,
} from "@/lib/background-queue"
import type { PersistedJob } from "@/lib/types"
import { Button } from "@/components/ui/button"

export function InterruptedJobBanner({
  job,
  hasImages,
  onDismiss,
}: {
  job: PersistedJob;
  hasImages: boolean;
  onDismiss: () => void;
}) {
  const handleResume = () => {
    resumeInterruptedBackgroundJob();
    onDismiss();
  };

  const handleDismiss = () => {
    dismissBackgroundJob();
    onDismiss();
  };

  const summary = `${job.completed}/${job.total} complete${job.failed > 0 ? `, ${job.failed} failed` : ""}${
    job.remaining > 0 ? `, ${job.remaining} remaining` : ""
  }`;

  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-amber-500/40 bg-amber-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-amber-700 dark:text-amber-400">
            Previous generation was interrupted
          </p>
          <p className="text-amber-700/80 dark:text-amber-400/80">
            {hasImages
              ? `Progress and completed metadata were restored (${summary}). Press Resume to continue with the remaining files.`
              : `Progress was preserved (${summary}), but the image files could not be restored after the refresh. Re-upload the remaining files to continue.`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {hasImages && job.remaining > 0 ? (
          <Button
            size="sm"
            variant="outline"
            className="border-amber-500/40 bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-400"
            onClick={handleResume}
          >
            <RotateCcw />
            Resume
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="text-amber-700/80 hover:bg-amber-500/15 hover:text-amber-700 dark:text-amber-400"
          onClick={handleDismiss}
        >
          <X />
          Dismiss
        </Button>
      </div>
    </div>
  );
}
