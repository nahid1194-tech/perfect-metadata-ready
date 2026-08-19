import type { ApiProvider } from "@/lib/types";

// Fast-first fallback chain used only when live model discovery is not
// available. The queue prefers the fastest suitable vision model and, on a
// quality failure, automatically jumps to the next higher-quality model.
export const GEMINI_MULTI_MODEL_FALLBACK = [
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-pro",
];

export const FALLBACK_MODELS: Record<ApiProvider, string[]> = {
  gemini: [
    "gemini-3.6-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
  mistral: ["pixtral-large-latest", "pixtral-12b-2409"],
};
