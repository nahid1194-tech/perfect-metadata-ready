"use client"

import { ArrowRight, Crown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { toast } from "@/store/use-toast-store"

export function NotificationCard() {
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-400/15">
          <Crown className="size-4.5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold">PromptLab Premium</p>
          <p className="text-sm text-muted-foreground">
            Generate unlimited images, batch export and priority AI processing.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="self-start sm:self-auto"
        onClick={() => toast("info", "Premium plans", "Premium plans are coming soon.")}
      >
        See plans
        <ArrowRight />
      </Button>
    </div>
  )
}
