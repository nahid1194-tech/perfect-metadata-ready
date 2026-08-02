import { cn } from "@/lib/utils"

function Switch({
  checked,
  onCheckedChange,
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<"button">, "onChange" | "onClick"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className
      )}
      {...props}
    >
      <span
        className={cn(
          "block size-4 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-4.5" : "translate-x-0.5"
        )}
      />
    </button>
  )
}

export { Switch }
