export const ADOBE_TITLE_MAX = 70;
export const ADOBE_KEYWORDS_MAX = 49;

export const SHUTTERSTOCK_TITLE_MAX = 2048;
export const SHUTTERSTOCK_KEYWORDS_MIN = 7;
export const SHUTTERSTOCK_KEYWORDS_MAX = 50;

export const FILENAME_MAX = 30;
export const CSV_MAX_ROWS = 5000;

export const ADOBE_CATEGORIES = [
  { id: 1, label: "Animals" },
  { id: 2, label: "Buildings and Architecture" },
  { id: 3, label: "Business" },
  { id: 4, label: "Drinks" },
  { id: 5, label: "The Environment" },
  { id: 6, label: "States of Mind" },
  { id: 7, label: "Food" },
  { id: 8, label: "Graphic Resources" },
  { id: 9, label: "Hobbies and Leisure" },
  { id: 10, label: "Industry" },
  { id: 11, label: "Landscape" },
  { id: 12, label: "Lifestyle" },
  { id: 13, label: "People" },
  { id: 14, label: "Plants and Flowers" },
  { id: 15, label: "Culture and Religion" },
  { id: 16, label: "Science" },
  { id: 17, label: "Social Issues" },
  { id: 18, label: "Sports" },
  { id: 19, label: "Technology" },
  { id: 20, label: "Transport" },
  { id: 21, label: "Travel" },
] as const;

export const SHUTTERSTOCK_CATEGORIES = [
  { id: 1, label: "Abstract" },
  { id: 2, label: "Animals/Wildlife" },
  { id: 3, label: "Arts" },
  { id: 4, label: "Backgrounds/Textures" },
  { id: 5, label: "Beauty/Fashion" },
  { id: 6, label: "Buildings/Landmarks" },
  { id: 7, label: "Business/Finance" },
  { id: 8, label: "Celebrities" },
  { id: 9, label: "Education" },
  { id: 10, label: "Food and Drink" },
  { id: 11, label: "Healthcare/Medical" },
  { id: 12, label: "Holidays" },
  { id: 13, label: "Industrial" },
  { id: 14, label: "Interiors" },
  { id: 15, label: "Miscellaneous" },
  { id: 16, label: "Nature" },
  { id: 17, label: "Objects" },
  { id: 18, label: "Parks/Outdoor" },
  { id: 19, label: "People" },
  { id: 20, label: "Religion" },
  { id: 21, label: "Science" },
  { id: 22, label: "Signs/Symbols" },
  { id: 23, label: "Sports/Recreation" },
  { id: 24, label: "Technology" },
  { id: 25, label: "Transportation" },
  { id: 26, label: "Vintage" },
] as const;

export const ADOBE_CATEGORY_IDS: Set<number> = new Set(
  ADOBE_CATEGORIES.map((c) => c.id)
);
export const SHUTTERSTOCK_CATEGORY_IDS: Set<number> = new Set(
  SHUTTERSTOCK_CATEGORIES.map((c) => c.id)
);

export function isValidAdobeCategory(value: string): boolean {
  const id = Number(value.trim());
  return Number.isInteger(id) && ADOBE_CATEGORY_IDS.has(id);
}

export function isValidShutterstockCategories(value: string): boolean {
  const ids = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && SHUTTERSTOCK_CATEGORY_IDS.has(id));
  return ids.length >= 1 && ids.length <= 2;
}

export function categoryLabel(
  platform: "adobe" | "shutterstock",
  value: string
): string {
  const list = platform === "adobe" ? ADOBE_CATEGORIES : SHUTTERSTOCK_CATEGORIES;
  const id = Number(value.trim());
  return list.find((c) => c.id === id)?.label ?? value;
}
