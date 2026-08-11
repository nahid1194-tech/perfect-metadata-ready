"use client"

import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"

type ImagePreviewModalProps = {
  src: string;
  isVideo?: boolean;
  alt?: string;
  onClose: () => void;
};

export function ImagePreviewModal({
  src,
  isVideo = false,
  alt,
  onClose,
}: ImagePreviewModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? "Image preview"}
      className="fixed inset-0 z-[100] bg-black/85"
      onClick={onClose}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute top-4 right-4 z-10 flex size-10 items-center justify-center rounded-full bg-white/10 text-white outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60 hover:bg-white/20"
      >
        <X className="size-5" />
      </button>

      <div
        className="flex h-full w-full items-center justify-center p-6"
        onClick={(event) => event.stopPropagation()}
      >
        {isVideo ? (
          <video
            src={src}
            autoPlay
            loop
            muted
            controls
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt ?? "Preview"}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </div>,
    document.body
  );
}
