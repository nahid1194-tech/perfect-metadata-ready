import { cn } from "@/lib/utils"

function Slider({ className, ...props }: React.ComponentProps<"input">) {
  const min = Number(props.min ?? 0);
  const max = Number(props.max ?? 100);
  const value = Number(props.value ?? props.defaultValue ?? min);
  const fill = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  return (
    <input
      type="range"
      data-slot="slider"
      className={cn(
        "h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted outline-none",
        "[&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110",
        "[&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow-sm",
        className
      )}
      style={{
        background: `linear-gradient(to right, var(--primary) ${fill}%, var(--muted) ${fill}%)`,
      }}
      {...props}
    />
  )
}

export { Slider }
