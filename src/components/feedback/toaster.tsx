"use client"

import { CheckCircle2, Info, X, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { useToastStore, type Toast } from "@/store/use-toast-store"

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
};

const styles: Record<Toast["type"], string> = {
  success: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  error: "border-destructive/40 text-destructive",
  info: "border-sky-500/40 text-sky-600 dark:text-sky-400",
};

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const remove = useToastStore((state) => state.remove);

  return (
    <div
      suppressHydrationWarning
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((toast) => {
        const Icon = icons[toast.type];
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-start gap-3 rounded-lg border bg-card p-3 shadow-lg"
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", styles[toast.type])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {toast.description}
                </p>
              ) : null}
            </div>
            <button
              onClick={() => remove(toast.id)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
