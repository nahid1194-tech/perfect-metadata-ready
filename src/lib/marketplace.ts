import type { CsvFormat, Marketplace } from "@/lib/types";

export const MARKETPLACES: {
  id: Marketplace;
  label: string;
  format: CsvFormat;
}[] = [
  { id: "adobe", label: "Adobe Stock", format: "adobe" },
  { id: "shutterstock", label: "Shutterstock", format: "shutterstock" },
  { id: "magnific", label: "Magnific", format: "magnific" },
];

export function marketplaceFormat(platform: Marketplace): CsvFormat {
  return MARKETPLACES.find((item) => item.id === platform)?.format ?? "adobe";
}

export function marketplaceLabel(platform: Marketplace): string {
  return MARKETPLACES.find((item) => item.id === platform)?.label ?? platform;
}
