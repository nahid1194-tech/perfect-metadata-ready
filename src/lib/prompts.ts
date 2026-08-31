import type {
  GeneratedMetadata,
  GenerationSettings,
  ImageAnalysis,
  ValidationIssue,
} from "@/lib/types";
import {
  ADOBE_CATEGORIES,
  SHUTTERSTOCK_CATEGORIES,
} from "@/lib/stock-spec";
import { rulesFor, resolveLimits } from "@/lib/marketplace-rules";

const ADOBE_CATEGORY_GUIDE = ADOBE_CATEGORIES.map(
  (c) => `${c.id} ${c.label}`
).join(", ");

const SHUTTERSTOCK_CATEGORY_GUIDE = SHUTTERSTOCK_CATEGORIES.map(
  (c) => c.label
).join(", ");

const FILENAME_INSTRUCTION = `The uploaded filename is NOT a source of information and must be completely ignored. Never infer or borrow the subject, title, keywords, description, or category from the filename or any of its parts (including UUIDs, hashes, random IDs, or timestamps). Never echo, repeat, or include the filename or any word/token from it anywhere in the output. Base every decision ONLY on the image pixels and the VERIFIED BACKGROUND FACTS below.`;

export const EMPTY_ANALYSIS: ImageAnalysis = {
  assetType: "",
  orientation: "unknown",
  composition: "",
  background: "",
  primarySubject: "",
  primaryDetails: "",
  secondarySubjects: [],
  visualDetails: [],
  concepts: [],
  visibleText: [],
  colors: [],
  summary: "",
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item) => item.length > 0);
}

export function buildSettingsPrompt(settings: GenerationSettings): string {
  const limits = resolveLimits(settings);
  const parts: string[] = [
    `Title length: exactly ${limits.adobe.titleMax} characters or fewer for adobe.title and exactly ${limits.shutterstock.titleMax} characters or fewer for shutterstock.title and exactly ${limits.magnific.titleMax} characters or fewer for magnific.title. Never exceed the limit and always end on a complete word; if too long, rewrite the title shorter.`,
    `Keywords: adobe.keywords must contain EXACTLY ${limits.adobe.keywordCount} unique keywords, shutterstock.keywords must contain EXACTLY ${limits.shutterstock.keywordCount} unique keywords, and magnific.keywords must contain EXACTLY ${limits.magnific.keywordCount} unique keywords.`,
    `Description: up to ${settings.descriptionLength} characters.`,
  ];
  if (settings.enablePrefix && settings.prefix.trim()) {
    parts.push(`Prefix every title with: "${settings.prefix.trim()}"`);
  }
  if (settings.enableSuffix && settings.suffix.trim()) {
    parts.push(`Suffix every title with: "${settings.suffix.trim()}"`);
  }
  if (settings.enableNegativeTitleWords && settings.negativeTitleWords.trim()) {
    parts.push(`Never use in titles: ${settings.negativeTitleWords.trim()}`);
  }
  if (settings.enableNegativeKeywords && settings.negativeKeywords.trim()) {
    parts.push(`Never use as keywords: ${settings.negativeKeywords.trim()}`);
  }
  return parts.join("\n- ");
}

export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text;
}

export function parseAnalysis(text: string): ImageAnalysis | null {
  try {
    const json = JSON.parse(extractJson(text)) as Record<string, unknown> | null;
    if (!json || typeof json !== "object") return null;
    const orientation = asString(json.orientation);
    const analysis: ImageAnalysis = {
      assetType: asString(json.assetType),
      orientation:
        orientation === "horizontal" ||
        orientation === "vertical" ||
        orientation === "square"
          ? orientation
          : "unknown",
      composition: asString(json.composition),
      background: asString(json.background),
      primarySubject: asString(json.primarySubject),
      primaryDetails: asString(json.primaryDetails),
      secondarySubjects: asStringArray(json.secondarySubjects),
      visualDetails: asStringArray(json.visualDetails),
      concepts: asStringArray(json.concepts),
      visibleText: asStringArray(json.visibleText),
      colors: asStringArray(json.colors),
      summary: asString(json.summary),
    };
    const hasContent =
      analysis.summary.length > 0 ||
      analysis.primarySubject.length > 0 ||
      analysis.primaryDetails.length > 0 ||
      analysis.secondarySubjects.length > 0 ||
      analysis.visualDetails.length > 0;
    return hasContent ? analysis : null;
  } catch {
    return null;
  }
}

function interpolate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return key in values ? values[key] : match;
  });
}

const ANALYSIS_SCHEMA = `{"assetType":"photograph or vector illustration or icon","orientation":"horizontal or vertical or square or unknown","composition":"","background":"","primarySubject":"","primaryDetails":"","secondarySubjects":[],"visualDetails":[],"concepts":[],"visibleText":[],"colors":[],"summary":""}`;

export function buildAnalysisPrompt(args: {
  bgRules: string;
}): string {
  const { bgRules } = args;
  return `You are a professional stock-photography and illustration analyst. Analyze the ENTIRE image through SEVEN separate, exhaustive passes, then output a structured visual analysis. Only describe what is visually supported. Never invent objects, text, logos, brands, people, or attributes that are not clearly visible.

${FILENAME_INSTRUCTION}

Perform these passes:

PASS 1 - GLOBAL SCENE: What is the overall scene? What is the setting, context, and atmosphere? What is happening?

PASS 2 - PRIMARY SUBJECT: Identify the single most important subject. Describe it with the most specific, searchable label possible (e.g. "silver laptop" not "device"; "glass of iced coffee" not "drink"; "conference room" not "room"). Include action, state, and material.

PASS 3 - SECONDARY SUBJECTS AND DETAILS: Every other subject and object in the image. Describe each with specific labels, actions, and notable details.

PASS 4 - VISUAL CHARACTERISTICS: Dominant colors, lighting, texture, style, medium, design type, and technique (e.g. flat vector illustration, photograph, icon, line art, watercolor, 3D render). Be precise about the medium.

PASS 5 - COMPOSITION: Framing, orientation (horizontal, vertical, square), perspective, angle, focal point, layout, symmetry, negative space, and depth.

PASS 6 - CONCEPTUAL MEANING: Abstract concepts, themes, moods, and commercial use cases (e.g. "corporate branding", "web design", "social media banner") that the image genuinely supports. Only include concepts that are visually or contextually supported.

PASS 7 - BACKGROUND: Describe the background in full detail, strictly consistent with these verified pixel-analysis facts:
${bgRules}

OCR / VISIBLE TEXT:
- If any text is CLEARLY VISIBLE in the image (signs, labels, posters, screens, book covers, packaging), transcribe it exactly into the "visibleText" array.
- If there is NO readable text, "visibleText" must be an empty array [].
- NEVER invent text and NEVER use the filename as image text.

HALLUCINATION GUARD:
- Never infer things that are not clearly visible. For example: call a laptop a laptop, never a tablet; a generic interior is NOT a hospital unless medical equipment/context is visible; do not call someone a "businessman" unless a business setting is clearly visible; never add "luxury", "technology", or "transparent" unless the image proves it.
- Only use occupation, gender, ethnicity, age, or profession terms when clearly visible.

Return ONLY the JSON object (no markdown, no comments) in EXACTLY this shape:
${ANALYSIS_SCHEMA}

JSON:`;
}

export function buildMetadataPrompt(args: {
  settings: GenerationSettings;
  bgRules: string;
  analysis: ImageAnalysis;
  platform: "adobe" | "shutterstock" | "magnific";
}): string {
  const { settings, bgRules, analysis, platform } = args;
  const rules = rulesFor(platform);

  const keywordTarget =
    platform === "adobe"
      ? resolveLimits(settings).adobe.keywordCount
      : platform === "shutterstock"
        ? resolveLimits(settings).shutterstock.keywordCount
        : resolveLimits(settings).magnific.keywordCount;

  const sectionSpecific = (mp: "adobe" | "shutterstock" | "magnific"): string => {
    const r = rulesFor(mp);
    let category = "";
    if (mp === "adobe") {
      category = interpolate(r.categoryGuidance, {
        ADOBE_CATEGORIES: ADOBE_CATEGORY_GUIDE,
      });
    } else if (mp === "shutterstock") {
      category = interpolate(r.categoryGuidance, {
        SHUTTERSTOCK_CATEGORIES: SHUTTERSTOCK_CATEGORY_GUIDE,
      });
    } else {
      category = r.categoryGuidance;
    }
    const title = interpolate(r.titleGuidance, {
      titleMax: String(r.titleMax),
    });
    const description =
      mp === "shutterstock"
        ? interpolate(r.descriptionGuidance, {
            descriptionMax: String(r.descriptionMax),
          })
        : r.descriptionGuidance;
    return [
      `### ${r.label}`,
      title,
      description,
      `- ${r.keywordGuidance}`,
      `- Category: ${category}`,
    ].join("\n");
  };

  return `You are an expert metadata writer for stock marketplaces. Using the VISUAL ANALYSIS below, generate accurate, detailed, marketplace-compliant metadata. Base EVERYTHING on the visual analysis and the verified background facts. Never invent anything not supported by the analysis.

${FILENAME_INSTRUCTION}

VISUAL ANALYSIS:
${JSON.stringify(analysis, null, 2)}

VERIFIED BACKGROUND FACTS (from pixel analysis — keep strictly consistent):
${bgRules}

TARGET MARKETPLACE: ${rules.label}
Generate metadata for ALL THREE marketplaces, but the ${rules.label} section is the primary target and must be optimized with the highest accuracy and searchability.

${sectionSpecific("adobe")}

${sectionSpecific("shutterstock")}

${sectionSpecific("magnific")}

=== ADDITIONAL RULES ===
TITLE (all marketplaces):
- The title must describe the image accurately and naturally, NOT be a list of keywords, and must respect each marketplace's character limit, always ending on a complete word.
- Never include generic filler such as "professional", "high quality", "premium", "beautiful", or "stunning".
- Never include brands, logos, trademarks, camera information, model numbers, or artist names.

KEYWORDS (all marketplaces):
- Each keyword must be ONE word or a natural TWO-word phrase. NEVER more than two words.
- STRONGLY prefer single-word keywords over two-word phrases. Only use a two-word phrase when the single word alone would lose critical meaning (e.g., "latte art" is better than "latte" + "art").
- Put the strongest, most searchable high-intent terms first: primary subject → action → important objects → style → medium → colors → composition → setting → commercial concepts.
- For ${rules.label}: exactly ${keywordTarget} keywords.
- For the OTHER marketplaces, also provide the count specified in their respective marketplace sections above.
- Every keyword must be visually supported by the image analysis.
- NO duplicates or near-duplicates (case-insensitive). For example, "business" and "business strategy" are near-duplicates — keep only the stronger one.
- NO truncated words, filename fragments, UUIDs, SEO filler, or weak generic terms.
- NO keyword stuffing: do not pad the list with weak or loosely related terms just to hit the count. Quality over quantity.
- Never use brands, trademarks, camera info, or unrelated trending terms.

MAGNIFIC SPECIFIC RULES:
- magnific.prompt: Write a brief, descriptive prompt that could recreate this image with an AI image generator (e.g. "A serene mountain landscape at golden hour with a calm lake reflection").
- magnific.model: Write "AI Generated" or the specific AI model if known.
- Always include '_ai_generated' in magnific.keywords for AI-generated content.

CATEGORY:
- adobe.category: the single numeric ID (1-21) whose label best fits the actual asset, from the Adobe category list.
- shutterstock.category: 1-2 exact official category names.
- magnific.category: leave empty (not used in Magnific CSV).

=== EDITORIAL CLASSIFICATION (extra analysis field — does NOT affect title, keywords, description, or category) ===
Classify the image as a RECOMMENDATION for Adobe Stock "Illustrative Editorial" eligibility. Illustrative Editorial is conceptual imagery designed to illustrate articles on current events or newsworthy topics, often featuring real brands/products (e.g. building signs, soda cans, cars, computers) presented in a NON-COMMERCIAL, commentary, or news context. It is NOT ordinary editorial/documentary photography, which Adobe does not currently accept.

- POTENTIAL_EDITORIAL only when the image genuinely fits illustrative editorial: recognisable real-world brands/products used in news or cultural commentary, editorial cartoons about product launches or industry developments, conceptual imagery featuring brand logos in news/cultural commentary contexts, photos of branded products or signage illustrating current events, or trademarked buildings/locations depicted in an editorial/news context.
- STANDARD when the image is ordinary commercial stock content, even if a brand/logo appears in a purely commercial, decorative, or product-style context. A brand alone is NOT enough to flag editorial — consider context, purpose, composition, storytelling, news relevance, and commentary.
- REVIEW_REQUIRED when the context is insufficient or ambiguous. Never force a decision.
- Disqualifiers from illustrative editorial: recognisable people, restricted events (e.g. conventions, sports games, premieres), tight crops of copyrighted or trademarked material (stamps, fine art), or digitally created/manipulated versions of trademarked logos.
- Baseline this decision ONLY on the visual content and the VERIFIED BACKGROUND FACTS. Never decide from the filename, its keywords, folder names, or existing metadata — a file named "Apple-news.png" is still just an image and must be judged by its pixels.
- "status" is one of: "STANDARD", "POTENTIAL_EDITORIAL", "REVIEW_REQUIRED".
- "confidence" is an integer 0-100.
- "signals" must be a subset of: "brand-product", "news-context", "cultural-commentary", "trademarked-location", "editorial-concept".
- "reason" is ONE short sentence explaining the classification.
- This classification is a recommendation only and must NEVER leak into the title, keywords, description, or category (do not add words like "editorial", "news", "current events", or "journalism" unless the image genuinely depicts those concepts).

CONSISTENCY:
- The title, description, and keywords must all describe the SAME image. Every major concept in the title must be reflected in the keywords.

USER PREFERENCES:
${buildSettingsPrompt(settings)}

Return ONLY this JSON (no markdown, no comments):
{"adobe":{"title":"","keywords":[],"category":""},"shutterstock":{"title":"","description":"","keywords":[],"category":""},"magnific":{"title":"","keywords":[],"prompt":"","model":""},"editorialAssessment":{"status":"STANDARD or POTENTIAL_EDITORIAL or REVIEW_REQUIRED","confidence":0,"signals":[],"reason":""}}`;
}

export function buildRefinePrompt(args: {
  settings: GenerationSettings;
  bgRules: string;
  analysis: ImageAnalysis;
  metadata: GeneratedMetadata;
  issues: ValidationIssue[];
  platform: "adobe" | "shutterstock" | "magnific";
}): string {
  const { settings, bgRules, analysis, metadata, issues, platform } = args;
  const failing = issues
    .filter((issue) => issue.format === platform)
    .map((issue) => `- ${issue.component.toUpperCase()}: ${issue.message}`);

  const relevantSection = platform === "adobe" 
    ? metadata.adobe 
    : platform === "shutterstock" 
      ? metadata.shutterstock 
      : metadata.magnific;

  return `You are an expert metadata writer. Some parts of the generated ${platform} metadata below FAILED quality validation. Regenerate ONLY the ${platform} metadata (the full JSON for ${platform} only is NOT required — return the complete JSON for ALL marketplaces), fixing every issue listed, while keeping everything that was already correct.

${FILENAME_INSTRUCTION}

VISUAL ANALYSIS:
${JSON.stringify(analysis, null, 2)}

VERIFIED BACKGROUND FACTS:
${bgRules}

CURRENT ${platform.toUpperCase()} METADATA (with issues):
${JSON.stringify(relevantSection, null, 2)}

FAILING CHECKS TO FIX:
${failing.join("\n") || "- No specific issues, just improve overall quality."}

USER PREFERENCES:
${buildSettingsPrompt(settings)}

Rules to enforce:
- Each keyword must be ONE word or a natural TWO-word phrase (never more).
- The title must be accurate, natural, within the character limit, end on a complete word, and never be a keyword list or contain filler/brands/camera info.
- Only use terms supported by the visual analysis.
- Fix ONLY the failing components; do not change unrelated content.
- Return the COMPLETE JSON for ALL marketplaces, with ${platform} fixed and the others unchanged. Keep "editorialAssessment" exactly as it was:
{"adobe":{"title":"","keywords":[],"category":""},"shutterstock":{"title":"","description":"","keywords":[],"category":""},"magnific":{"title":"","keywords":[],"prompt":"","model":""},"editorialAssessment":{"status":"STANDARD or POTENTIAL_EDITORIAL or REVIEW_REQUIRED","confidence":0,"signals":[],"reason":""}}`;
}
