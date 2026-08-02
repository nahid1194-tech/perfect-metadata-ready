import * as React from "react"

import { cn } from "@/lib/utils"

function Progress({
  value = 0,
  className,
  indicatorClassName,
  ...props
}: React.ComponentProps<"div"> & {
  value?: number
  indicatorClassName?: string
}) {
  return (
    <div
      data-slot="progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/15",
        className
      )}
      {...props}
    >
      <div
        data-slot="progress-indicator"
        className={cn(
          "h-full w-full flex-1 rounded-full bg-primary transition-all duration-300 ease-out",
          indicatorClassName
        )}
        style={{ transform: `translateX(-${100 - value}%)` }}
      />
    </div>
  )
}

export { Progress }
