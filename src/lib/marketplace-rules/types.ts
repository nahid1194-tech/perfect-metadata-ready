import type { CsvFormat } from "@/lib/types";

export type MarketplaceRules = {
  id: CsvFormat;
  label: string;
  titleMax: number;
  descriptionMax: number;
  keywordMin: number;
  keywordMax: number;
  keywordMaxWords: number;
  titleGuidance: string;
  descriptionGuidance: string;
  keywordGuidance: string;
  categoryGuidance: string;
  trademarkTerms: string[];
  cameraTerms: string[];
  titleFillerTerms: string[];
  keywordFillerTerms: string[];
  titleListPattern: RegExp;
  forbidBrands: boolean;
  forbidCameraInfo: boolean;
  forbidPii: boolean;
  forbidLinks: boolean;
};
