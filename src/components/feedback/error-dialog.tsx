"use client"

import { RotateCcw, XCircle } from "lucide-react"

import { Modal } from "@/components/feedback/modal"
import { Button } from "@/components/ui/button"
import { useGenerate } from "@/hooks/use-generate"
import { useAppStore } from "@/store/use-app-store"

export function ErrorDialog() {
  const open = useAppStore((state) => state.errorOpen);
  const close = useAppStore((state) => state.closeError);
  const failedIds = useAppStore((state) => state.failedImageIds);
  const queueItems = useAppStore((state) => state.queueItems);
  const { run } = useGenerate();

  const failed = failedIds.length;
  const reasons = failedIds
    .map((id) => queueItems[id]?.error)
    .filter((reason): reason is string => Boolean(reason));

  const handleRetry = () => {
    close();
    run({ retryFailed: true });
  };

  return (
    <Modal open={open} onClose={close} label="Generation incomplete">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-destructive/15">
          <XCircle className="size-8 text-destructive" />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Generation incomplete</h2>
          <p className="text-sm text-muted-foreground">
            {failed} image{failed === 1 ? "" : "s"} could not be processed.
          </p>
        </div>
        {reasons.length > 0 ? (
          <ul className="max-h-40 w-full space-y-1.5 overflow-y-auto text-left">
            {reasons.map((reason, index) => (
              <li
                key={index}
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
              >
                {reason}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Check your API key and network connection, then retry.
          </p>
        )}
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={handleRetry}>
            <RotateCcw />
            Retry Failed
          </Button>
        </div>
      </div>
    </Modal>
  );
}
