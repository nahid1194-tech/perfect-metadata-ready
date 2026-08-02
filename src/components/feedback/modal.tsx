"use client"

import { useEffect } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

export function Modal({
  open,
  onClose,
  label,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            aria-hidden
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={cn(
              "relative w-full max-w-md rounded-[20px] border bg-card p-6 shadow-xl",
              className
            )}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
            {children}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  )
}
