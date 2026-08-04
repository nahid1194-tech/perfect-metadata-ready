export type ImageAsset = {
  id: string;
  name: string;
  size: number;
  type: string;
  dataUrl: string;
  apiDataUrl?: string;
  apiMimeType?: string;
};

export type MetadataMode = "adobe" | "shutterstock";

export type StockMetadata = {
  title: string;
  description: string;
  keywords: string[];
  category: string;
};

export type GeneratedMetadata = {
  adobe: StockMetadata;
  shutterstock: StockMetadata;
};

export type GenerationResult = {
  id: string;
  imageId: string;
  createdAt: string;
  imageName: string;
  metadata: GeneratedMetadata;
};

export type CsvFormat = "adobe" | "shutterstock";

export type GenerationMode = "auto" | "api";

export type GenerationStatus =
  | "uploading"
  | "waiting"
  | "analyzing"
  | "generating"
  | "retrying"
  | "completed"
  | "failed";

export type QueueState = "idle" | "running" | "paused" | "stopped";

export type QueueItem = {
  imageId: string;
  status: GenerationStatus;
  progress: number;
  error: string | null;
  statusMessage?: string | null;
  startedAt?: number;
};

export type ApiProvider = "gemini" | "openai" | "mistral";

export type ApiKeyEntry = {
  id: string;
  provider: ApiProvider;
  key: string;
  enabled: boolean;
};

export type Marketplace = "adobe" | "shutterstock";

export type GenerationSpeed = "fast" | "normal" | "slow";

export type GenerationSettings = {
  platform: Marketplace;
  titleLength: number;
  descriptionLength: number;
  keywordCount: number;
  prefix: string;
  suffix: string;
  negativeTitleWords: string;
  negativeKeywords: string;
  enablePrefix: boolean;
  enableSuffix: boolean;
  enableNegativeTitleWords: boolean;
  enableNegativeKeywords: boolean;
  generationSpeed: GenerationSpeed;
};
