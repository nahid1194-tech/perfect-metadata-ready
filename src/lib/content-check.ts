import type {
  ContentCheck,
  ContentIssue,
  ContentIssueCategory,
  ContentIssueSeverity,
  RiskLevel,
} from "@/lib/types";

export const DEFAULT_CONTENT_CHECK: ContentCheck = {
  riskLevel: "LOW",
  confidence: 0,
  issues: [],
  recommendation:
    "Run generation so the content risk assessment can be performed.",
};

export const RISK_ORDER: RiskLevel[] = ["LOW", "REVIEW", "HIGH", "VERY_HIGH"];

export const VALID_RISK_LEVELS: RiskLevel[] = [
  "LOW",
  "REVIEW",
  "HIGH",
  "VERY_HIGH",
];

export const VALID_CATEGORIES: ContentIssueCategory[] = [
  "IP",
  "QUALITY",
  "METADATA",
  "AI",
  "VECTOR",
  "SIMILARITY",
  "EDITORIAL",
  "RELEASE",
];

export const VALID_SEVERITIES: ContentIssueSeverity[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
];

export const CATEGORY_LABELS: Record<ContentIssueCategory, string> = {
  IP: "Intellectual property",
  QUALITY: "Image quality",
  METADATA: "Metadata",
  AI: "Generative AI",
  VECTOR: "Vector / EPS",
  SIMILARITY: "Similar content",
  EDITORIAL: "Editorial / news",
  RELEASE: "Release / property",
};

export const CONTENT_RISK_META: Record<
  RiskLevel,
  {
    label: string;
    shortLabel: string;
    badgeClassName: string;
    dotClassName: string;
    cardBorderClassName: string;
  }
> = {
  LOW: {
    label: "Low Risk",
    shortLabel: "Low",
    badgeClassName: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    dotClassName: "bg-emerald-500",
    cardBorderClassName: "border-border",
  },
  REVIEW: {
    label: "Review",
    shortLabel: "Review",
    badgeClassName: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    dotClassName: "bg-amber-500",
    cardBorderClassName: "border-amber-500/60",
  },
  HIGH: {
    label: "High Risk",
    shortLabel: "High",
    badgeClassName: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    dotClassName: "bg-orange-500",
    cardBorderClassName:
      "border-orange-500/70 ring-1 ring-orange-500/30",
  },
  VERY_HIGH: {
    label: "Very High Risk",
    shortLabel: "Very High",
    badgeClassName: "bg-red-500/15 text-red-700 dark:text-red-400",
    dotClassName: "bg-red-500",
    cardBorderClassName:
      "border-red-500/80 ring-1 ring-red-500/30 shadow-[0_8px_40px_-12px] shadow-red-500/20",
  },
};

export const SEVERITY_META: Record<
  ContentIssueSeverity,
  { label: string; className: string; dotClassName: string }
> = {
  LOW: {
    label: "Low",
    className: "text-slate-600 dark:text-slate-400",
    dotClassName: "bg-slate-400",
  },
  MEDIUM: {
    label: "Medium",
    className: "text-amber-700 dark:text-amber-400",
    dotClassName: "bg-amber-500",
  },
  HIGH: {
    label: "High",
    className: "text-red-700 dark:text-red-400",
    dotClassName: "bg-red-500",
  },
};

export const VECTOR_NOT_VERIFIED_ISSUE: ContentIssue = {
  category: "VECTOR",
  severity: "MEDIUM",
  reason: "Vector structure could not be fully verified.",
};

export function normalizeContentCheck(
  raw: unknown,
  fallback: ContentCheck = DEFAULT_CONTENT_CHECK
): ContentCheck {
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as {
    riskLevel?: unknown;
    confidence?: unknown;
    issues?: unknown;
    recommendation?: unknown;
  };
  const riskLevel = VALID_RISK_LEVELS.includes(value.riskLevel as RiskLevel)
    ? (value.riskLevel as RiskLevel)
    : fallback.riskLevel;
  let confidence =
    typeof value.confidence === "number" && Number.isFinite(value.confidence)
      ? Math.round(value.confidence)
      : Math.round(fallback.confidence);
  confidence = Math.max(0, Math.min(100, confidence));
  const recommendation =
    typeof value.recommendation === "string" && value.recommendation.trim()
      ? value.recommendation.trim().slice(0, 200)
      : fallback.recommendation;
  const issues: ContentIssue[] = Array.isArray(value.issues)
    ? value.issues
        .map((item): ContentIssue | null => {
          if (!item || typeof item !== "object") return null;
          const issue = item as {
            category?: unknown;
            severity?: unknown;
            reason?: unknown;
          };
          const category = VALID_CATEGORIES.includes(
            issue.category as ContentIssueCategory
          )
            ? (issue.category as ContentIssueCategory)
            : null;
          const severity = VALID_SEVERITIES.includes(
            issue.severity as ContentIssueSeverity
          )
            ? (issue.severity as ContentIssueSeverity)
            : null;
          const reason =
            typeof issue.reason === "string" && issue.reason.trim()
              ? issue.reason.trim().slice(0, 200)
              : "";
          if (!category || !severity || !reason) return null;
          return { category, severity, reason };
        })
        .filter((issue): issue is ContentIssue => issue !== null)
        .slice(0, 12)
    : fallback.issues;
  return { riskLevel, confidence, issues, recommendation };
}

export function mergeContentIssues(
  base: ContentIssue[],
  extra: ContentIssue[]
): ContentIssue[] {
  const seen = new Set<string>();
  const out: ContentIssue[] = [];
  const push = (issue: ContentIssue) => {
    const key = `${issue.category}:${issue.reason}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(issue);
  };
  for (const issue of base) push(issue);
  for (const issue of extra) push(issue);
  return out.slice(0, 16);
}

export function escalateRiskLevel(
  base: RiskLevel,
  issues: ContentIssue[]
): RiskLevel {
  let level = base;
  const hasSimilarity = issues.some(
    (issue) => issue.category === "SIMILARITY"
  );
  if (hasSimilarity) {
    const baseIndex = RISK_ORDER.indexOf(level);
    const highIndex = RISK_ORDER.indexOf("HIGH");
    if (baseIndex < highIndex) level = "HIGH";
  }
  return level;
}

export function hasRealAssessment(check: ContentCheck): boolean {
  return (
    check.confidence > 0 ||
    check.issues.length > 0 ||
    check.recommendation !== DEFAULT_CONTENT_CHECK.recommendation
  );
}

export const NOT_ASSESSED_ISSUE: ContentIssue = {
  category: "METADATA",
  severity: "MEDIUM",
  reason:
    "This asset has not been AI-reviewed for content risk yet — regenerate its metadata so Content Check can run a full assessment.",
};

export function withNotAssessedFallback(check: ContentCheck): ContentCheck {
  if (hasRealAssessment(check)) return check;
  return {
    ...check,
    riskLevel: "REVIEW",
    confidence: 0,
    issues: [NOT_ASSESSED_ISSUE],
    recommendation:
      "Regenerate this image's metadata so Content Check can run a full AI assessment.",
  };
}

export function resolveContentCheck(
  check: ContentCheck,
  extraIssues: ContentIssue[] = []
): ContentCheck {
  const normalized = normalizeContentCheck(withNotAssessedFallback(check));
  const issues = mergeContentIssues(normalized.issues, extraIssues);
  return {
    ...normalized,
    riskLevel: escalateRiskLevel(normalized.riskLevel, issues),
    issues,
  };
}

const VECTOR_EXTENSION = /\.(eps|ps)$/i;
const SVG_EXTENSION = /\.svg$/i;

export function isVectorAssetName(name: string): boolean {
  return VECTOR_EXTENSION.test(name) || SVG_EXTENSION.test(name);
}

export const CONTENT_CHECK_DISCLAIMER =
  "Content Check is an AI-assisted pre-submission review. It cannot guarantee Adobe Stock acceptance or rejection. Review flagged content and Adobe's current submission requirements before submitting.";