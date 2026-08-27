import type { CsvFormat } from "@/lib/types";
import type { MarketplaceRules } from "./types";
import { ADOBE_RULES } from "./adobe";
import { SHUTTERSTOCK_RULES } from "./shutterstock";
import { MAGNIFIC_RULES } from "./magnific";

export type { MarketplaceRules } from "./types";
export { ADOBE_RULES } from "./adobe";
export { SHUTTERSTOCK_RULES } from "./shutterstock";
export { MAGNIFIC_RULES } from "./magnific";
export { resolveLimits } from "./limits";
export type { FormatLimits, ResolvedLimits } from "./limits";

export function rulesFor(format: CsvFormat): MarketplaceRules {
  if (format === "adobe") return ADOBE_RULES;
  if (format === "shutterstock") return SHUTTERSTOCK_RULES;
  return MAGNIFIC_RULES;
}
