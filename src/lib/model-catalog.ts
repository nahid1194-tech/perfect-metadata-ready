import type { ApiProvider } from "@/lib/types";

export const FALLBACK_MODELS: Record<ApiProvider, string[]> = {
  gemini: [
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-pro",
    "gemini-1.5-flash",
  ],
  openai: ["gpt-4.1", "gpt-4o", "gpt-4o-mini"],
  mistral: ["pixtral-large-latest", "pixtral-12b-2409"],
};
