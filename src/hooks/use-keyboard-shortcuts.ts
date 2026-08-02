"use client"

import { useEffect, useRef } from "react";

import type { MetadataMode } from "@/lib/types";

type ShortcutHandlers = {
  onGenerate: () => void;
  onRetry: () => void;
  onPauseResume: () => void;
  onStop: () => void;
  onToggleTheme: () => void;
  onSetMode: (mode: MetadataMode) => void;
  onHelp: () => void;
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export const SHORTCUTS = [
  { key: "G", label: "Generate" },
  { key: "P", label: "Pause / Resume" },
  { key: "S", label: "Stop" },
  { key: "R", label: "Retry failed" },
  { key: "T", label: "Toggle theme" },
  { key: "1 / 2", label: "Adobe / Shutterstock" },
  { key: "?", label: "Show shortcuts" },
];

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const key = event.key.toLowerCase();
      switch (key) {
        case "g":
          event.preventDefault();
          ref.current.onGenerate();
          break;
        case "r":
          event.preventDefault();
          ref.current.onRetry();
          break;
        case "p":
          event.preventDefault();
          ref.current.onPauseResume();
          break;
        case "s":
          event.preventDefault();
          ref.current.onStop();
          break;
        case "t":
          event.preventDefault();
          ref.current.onToggleTheme();
          break;
        case "1":
          ref.current.onSetMode("adobe");
          break;
        case "2":
          ref.current.onSetMode("shutterstock");
          break;
        case "?":
          ref.current.onHelp();
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
