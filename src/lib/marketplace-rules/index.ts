import type { CsvFormat } from "@/lib/types";
import type { MarketplaceRules } from "./types";
import { ADOBE_RULES } from "./adobe";
import { SHUTTERSTOCK_RULES } from "./shutterstock";

export type { MarketplaceRules } from "./types";
export { ADOBE_RULES } from "./adobe";
export { SHUTTERSTOCK_RULES } from "./shutterstock";
export { resolveLimits } from "./limits";
export type { FormatLimits, ResolvedLimits } from "./limits";

export function rulesFor(format: CsvFormat): MarketplaceRules {
  return format === "adobe" ? ADOBE_RULES : SHUTTERSTOCK_RULES;
}
