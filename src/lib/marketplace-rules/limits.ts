import type { GenerationSettings } from "@/lib/types";
import {
  ADOBE_KEYWORDS_MAX,
  ADOBE_TITLE_MAX,
  MAGNIFIC_KEYWORDS_MAX,
  MAGNIFIC_TITLE_MAX,
  SHUTTERSTOCK_KEYWORDS_MAX,
  SHUTTERSTOCK_KEYWORDS_MIN,
  SHUTTERSTOCK_TITLE_MAX,
} from "@/lib/stock-spec";

export type FormatLimits = {
  titleMax: number;
  keywordCount: number;
};

export type ResolvedLimits = {
  adobe: FormatLimits;
  shutterstock: FormatLimits;
  magnific: FormatLimits;
};

export function resolveLimits(settings: GenerationSettings): ResolvedLimits {
  return {
    adobe: {
      titleMax: Math.min(settings.titleLength, ADOBE_TITLE_MAX),
      keywordCount: Math.max(
        1,
        Math.min(settings.keywordCount, ADOBE_KEYWORDS_MAX)
      ),
    },
    shutterstock: {
      titleMax: Math.min(settings.titleLength, SHUTTERSTOCK_TITLE_MAX),
      keywordCount: Math.max(
        SHUTTERSTOCK_KEYWORDS_MIN,
        Math.min(settings.keywordCount, SHUTTERSTOCK_KEYWORDS_MAX)
      ),
    },
    magnific: {
      titleMax: Math.min(settings.titleLength, MAGNIFIC_TITLE_MAX),
      keywordCount: Math.max(
        1,
        Math.min(settings.keywordCount, MAGNIFIC_KEYWORDS_MAX)
      ),
    },
  };
}
