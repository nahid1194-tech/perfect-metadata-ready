// Central mapping of Gemini thinking support per model family. Gemini 2.5
// series exposes configurable thinking via `generationConfig.thinkingConfig.
// thinkingBudget`; Gemini 3.x series uses `generationConfig.thinkingConfig.
// thinkingLevel`. Models outside those families do not support configurable
// thinking and must simply omit the parameter.

export type ThinkingLevel = "HIGH" | "LOW";

export type ThinkingConfigResolved =
  | { kind: "budget"; parameter: "thinkingBudget"; value: number }
  | { kind: "level"; parameter: "thinkingLevel"; value: "low" | "high" };

type BudgetRange = { min: number; max: number };

// Documented ranges (Google AI docs):
//   Gemini 2.5 Pro       : 128..32768  (thinking cannot be disabled)
//   Gemini 2.5 Flash     : 0..24576    (0 disables thinking)
//   Gemini 2.5 Flash-Lite: 0..24576    (0 = disabled by default)
function budgetRange(model: string): BudgetRange | null {
  if (!/^gemini-2\.5/i.test(model)) return null;
  if (/flash-lite/i.test(model)) return { min: 0, max: 24576 };
  if (/flash/i.test(model)) return { min: 0, max: 24576 };
  if (/pro/i.test(model)) return { min: 128, max: 32768 };
  return { min: 0, max: 24576 };
}

// Models that ship a configurable thinking control. Unknown/future families
// default to "not supported" so the parameter is safely omitted.
export function supportsThinking(model: string): boolean {
  if (!model) return false;
  return /^gemini-3/i.test(model) || budgetRange(model) !== null;
}

export function resolveThinkingConfig(
  model: string,
  level: ThinkingLevel
): ThinkingConfigResolved | null {
  if (/^gemini-3/i.test(model)) {
    return {
      kind: "level",
      parameter: "thinkingLevel",
      value: level === "HIGH" ? "high" : "low",
    };
  }
  const range = budgetRange(model);
  if (!range) return null;
  return {
    kind: "budget",
    parameter: "thinkingBudget",
    value: level === "HIGH" ? range.max : range.min,
  };
}

// Models that rejected the thinking parameter at runtime. Once an API call
// reports a thinking-parameter error, the request is retried without the
// parameter and the model is remembered so we do not repeat the invalid call.
const runtimeUnsupported = new Set<string>();

export function markThinkingUnsupported(model: string): void {
  runtimeUnsupported.add(model);
}

export function isKnownThinkingUnsupported(model: string): boolean {
  return runtimeUnsupported.has(model);
}

// Matches Gemini error messages that point at the thinking parameter, e.g.
// "Invalid value at 'generation_config.thinking_config.thinkingBudget'" or
// "model does not support the thinkingLevel parameter".
const THINKING_ERROR_PATTERN =
  /thinking[^\n]{0,90}\b(invalid|unsupported|not supported|does not|unavailable|must be)\b/i;

export function isThinkingParamError(
  error: unknown,
  model: string
): boolean {
  if (!supportsThinking(model)) return false;
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  if (!message) return false;
  const hasThinking = /thinking/i.test(message);
  const pointsAtParameter =
    /(thinking\s*budget|thinking\s*level|thinkingBudget|thinkingLevel|thinking_config|thinkingConfig)/i.test(
      message
    );
  const isValidationFailure =
    /(invalid|unsupported|not supported|does not|unavailable|unknown field)/i.test(
      message
    );
  return (
    hasThinking && (pointsAtParameter || THINKING_ERROR_PATTERN.test(message)) && isValidationFailure
  );
}

export const THINKING_OPTION_LABELS: Record<
  ThinkingLevel,
  { label: string; description: string }
> = {
  HIGH: {
    label: "High Thinking — Maximum Quality",
    description: "Highest available reasoning — best metadata accuracy.",
  },
  LOW: {
    label: "Low Thinking — Fast Generation",
    description: "Fastest generation with the least reasoning overhead.",
  },
};

export const THINKING_UNAVAILABLE_NOTE =
  "Thinking control unavailable for this model.";