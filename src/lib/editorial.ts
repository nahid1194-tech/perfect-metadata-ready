import type {
  EditorialAssessment,
  EditorialSignal,
  EditorialStatus,
} from "@/lib/types";

export const DEFAULT_EDITORIAL_ASSESSMENT: EditorialAssessment = {
  status: "REVIEW_REQUIRED",
  confidence: 0,
  signals: [],
  reason: "Not assessed by AI yet. Review the image for editorial context.",
};

export const VALID_EDITORIAL_STATUSES: EditorialStatus[] = [
  "STANDARD",
  "POTENTIAL_EDITORIAL",
  "REVIEW_REQUIRED",
];

export const VALID_EDITORIAL_SIGNALS: EditorialSignal[] = [
  "brand-product",
  "news-context",
  "cultural-commentary",
  "trademarked-location",
  "editorial-concept",
];

export const EDITORIAL_SIGNAL_LABELS: Record<EditorialSignal, string> = {
  "brand-product": "Brand/product",
  "news-context": "News context",
  "cultural-commentary": "Cultural commentary",
  "trademarked-location": "Trademarked location",
  "editorial-concept": "Editorial concept",
};

export const EDITORIAL_STATUS_META: Record<
  EditorialStatus,
  {
    label: string;
    shortLabel: string;
    badgeClassName: string;
    dotClassName: string;
    cardBorderClassName: string;
  }
> = {
  STANDARD: {
    label: "Standard",
    shortLabel: "Standard",
    badgeClassName: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    dotClassName: "bg-emerald-500",
    cardBorderClassName: "border-border",
  },
  POTENTIAL_EDITORIAL: {
    label: "Potential Editorial",
    shortLabel: "Editorial",
    badgeClassName: "bg-red-500/15 text-red-700 dark:text-red-400",
    dotClassName: "bg-red-500",
    cardBorderClassName: "border-red-500/70 ring-1 ring-red-500/30",
  },
  REVIEW_REQUIRED: {
    label: "Review Required",
    shortLabel: "Review",
    badgeClassName: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    dotClassName: "bg-amber-500",
    cardBorderClassName: "border-amber-500/60",
  },
};

export function normalizeEditorialAssessment(
  raw: unknown,
  fallback: EditorialAssessment = DEFAULT_EDITORIAL_ASSESSMENT
): EditorialAssessment {
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as {
    status?: unknown;
    confidence?: unknown;
    signals?: unknown;
    reason?: unknown;
  };
  const status = VALID_EDITORIAL_STATUSES.includes(value.status as EditorialStatus)
    ? (value.status as EditorialStatus)
    : fallback.status;
  let confidence =
    typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? Math.round(value.confidence)
      : Math.round(fallback.confidence);
  confidence = Math.max(0, Math.min(100, confidence));
  const signals: EditorialSignal[] = Array.isArray(value.signals)
    ? value.signals
        .map((item) => String(item).trim())
        .filter((item): item is EditorialSignal =>
          VALID_EDITORIAL_SIGNALS.includes(item as EditorialSignal)
        )
    : fallback.signals;
  const reason =
    typeof value.reason === "string" && value.reason.trim()
      ? value.reason.trim().slice(0, 300)
      : fallback.reason;
  return { status, confidence, signals, reason };
}

export function applyEditorialOverride(
  assessment: EditorialAssessment,
  status: EditorialStatus
): EditorialAssessment {
  if (assessment.status === status) return assessment;
  return {
    status,
    confidence: assessment.confidence,
    signals: assessment.signals,
    reason:
      status === "POTENTIAL_EDITORIAL"
        ? "Marked for editorial review by the user. AI classification is a recommendation; verify Adobe Stock eligibility before submission."
        : "Marked as standard by the user. AI classification is a recommendation; verify Adobe Stock eligibility before submission.",
  };
}