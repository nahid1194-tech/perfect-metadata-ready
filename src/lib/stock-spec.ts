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

export function isValidAdobeCategory(value: string): boolean {
  const id = Number(value.trim());
  return Number.isInteger(id) && ADOBE_CATEGORY_IDS.has(id);
}

const SHUTTERSTOCK_CATEGORY_ALIASES: Record<string, string[]> = {
  Abstract: ["abstract", "fractal", "blur"],
  "Animals/Wildlife": [
    "animal",
    "animals",
    "wildlife",
    "fauna",
    "pet",
    "pets",
  ],
  Arts: [
    "art",
    "artwork",
    "painting",
    "drawing",
    "illustration",
    "craft",
    "crafts",
    "sculpture",
    "artist",
  ],
  "Backgrounds/Textures": [
    "background",
    "texture",
    "textures",
    "wallpaper",
    "seamless",
    "backdrop",
  ],
  "Beauty/Fashion": [
    "beauty",
    "fashion",
    "cosmetic",
    "cosmetics",
    "makeup",
    "hairstyle",
    "jewelry",
  ],
  "Buildings/Landmarks": [
    "building",
    "buildings",
    "architecture",
    "architectural",
    "landmark",
    "landmarks",
    "city",
    "urban",
    "skyline",
    "house",
  ],
  "Business/Finance": [
    "business",
    "finance",
    "financial",
    "money",
    "office",
    "corporate",
    "workplace",
  ],
  Celebrities: ["celebrity", "celebrities", "public figure", "red carpet"],
  Education: [
    "education",
    "school",
    "learning",
    "student",
    "students",
    "graduation",
    "classroom",
    "university",
  ],
  "Food and Drink": [
    "food",
    "drink",
    "drinks",
    "cooking",
    "kitchen",
    "restaurant",
    "cuisine",
    "culinary",
    "beverage",
    "beverages",
  ],
  "Healthcare/Medical": [
    "health",
    "healthcare",
    "medical",
    "medicine",
    "health care",
    "wellness",
    "hospital",
    "doctor",
    "nurse",
    "pharmacy",
  ],
  Holidays: [
    "holiday",
    "holidays",
    "christmas",
    "easter",
    "halloween",
    "seasonal",
    "festival",
    "vacation",
    "birthday",
    "wedding",
    "celebration",
    "travel",
    "tourism",
  ],
  Industrial: [
    "industrial",
    "industry",
    "construction",
    "factory",
    "manufacturing",
    "mining",
    "machinery",
    "tool",
    "tools",
  ],
  Interiors: ["interior", "interiors", "indoors", "room"],
  Miscellaneous: ["miscellaneous", "other", "generic", "misc"],
  Nature: [
    "nature",
    "landscape",
    "environment",
    "plants",
    "flowers",
    "trees",
    "sky",
    "ocean",
    "river",
    "mountain",
    "mountains",
    "sunset",
    "wilderness",
    "forest",
  ],
  Objects: ["object", "objects", "product", "products", "still life", "item", "items"],
  "Parks/Outdoor": [
    "park",
    "parks",
    "outdoor",
    "outdoors",
    "camping",
    "hiking",
    "garden",
    "playground",
  ],
  People: [
    "people",
    "person",
    "man",
    "woman",
    "child",
    "children",
    "portrait",
    "human",
    "family",
    "model",
  ],
  Religion: [
    "religion",
    "religious",
    "spiritual",
    "church",
    "temple",
    "faith",
    "prayer",
    "praying",
  ],
  Science: [
    "science",
    "scientific",
    "chemistry",
    "laboratory",
    "lab",
    "space",
    "astronomy",
    "biology",
    "microscope",
  ],
  "Signs/Symbols": [
    "sign",
    "signs",
    "symbol",
    "symbols",
    "icon",
    "icons",
    "logo",
    "logos",
    "flag",
    "arrow",
    "arrows",
    "typography",
  ],
  "Sports/Recreation": [
    "sport",
    "sports",
    "fitness",
    "exercise",
    "athlete",
    "athletes",
    "recreation",
    "hobby",
    "hobbies",
    "yoga",
    "cycling",
    "running",
  ],
  Technology: [
    "technology",
    "tech",
    "computer",
    "phone",
    "smartphone",
    "gadget",
    "gadgets",
    "device",
    "devices",
    "electronics",
    "digital",
    "robot",
    "software",
  ],
  Transportation: [
    "transport",
    "transportation",
    "car",
    "cars",
    "automobile",
    "vehicle",
    "vehicles",
    "airplane",
    "train",
    "bus",
    "boat",
    "bicycle",
    "road",
    "highway",
  ],
  Vintage: ["vintage", "retro", "antique", "nostalgia", "old fashioned", "sepia"],
};

function normalizeCategoryPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchShutterstockCategory(part: string): string | null {
  const raw = part.trim();
  if (!raw) return null;

  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    const byId = SHUTTERSTOCK_CATEGORIES.find((c) => c.id === id);
    return byId ? byId.label : null;
  }

  const normalized = normalizeCategoryPart(raw);

  const exact = SHUTTERSTOCK_CATEGORIES.find(
    (c) => normalizeCategoryPart(c.label) === normalized
  );
  if (exact) return exact.label;

  for (const category of SHUTTERSTOCK_CATEGORIES) {
    const aliases = SHUTTERSTOCK_CATEGORY_ALIASES[category.label] ?? [];
    if (aliases.some((alias) => normalizeCategoryPart(alias) === normalized))
      return category.label;
  }

  if (normalized.length >= 3) {
    for (const category of SHUTTERSTOCK_CATEGORIES) {
      const name = normalizeCategoryPart(category.label);
      if (name.includes(normalized) || normalized.includes(name))
        return category.label;
    }
  }

  let best: { label: string; score: number } | null = null;
  const words = new Set(normalized.split(" ").filter((w) => w.length > 2));
  for (const category of SHUTTERSTOCK_CATEGORIES) {
    const corpus = [
      category.label,
      ...(SHUTTERSTOCK_CATEGORY_ALIASES[category.label] ?? []),
    ]
      .map(normalizeCategoryPart)
      .join(" ");
    let score = 0;
    for (const word of words) if (corpus.includes(word)) score++;
    if (score > 0 && (!best || score > best.score))
      best = { label: category.label, score };
  }
  return best ? best.label : null;
}

export function normalizeShutterstockCategories(value: string): string[] {
  const out: string[] = [];
  for (const part of value.split(",")) {
    const matched = matchShutterstockCategory(part);
    if (matched && !out.includes(matched)) out.push(matched);
    if (out.length >= 2) break;
  }
  if (out.length === 0) out.push("Miscellaneous");
  return out;
}

export function isValidShutterstockCategories(value: string): boolean {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 2) return false;
  return parts.every((part) => matchShutterstockCategory(part) !== null);
}

export function categoryLabel(
  platform: "adobe" | "shutterstock",
  value: string
): string {
  const list = platform === "adobe" ? ADOBE_CATEGORIES : SHUTTERSTOCK_CATEGORIES;
  const id = Number(value.trim());
  return list.find((c) => c.id === id)?.label ?? value;
}
