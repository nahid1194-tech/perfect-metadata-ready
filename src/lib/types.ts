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

export type KeyHealthStatus =
  | "working"
  | "rate-limited"
  | "quota-exhausted"
  | "invalid-key"
  | "permission-denied"
  | "api-disabled"
  | "model-unavailable"
  | "server-error"
  | "not-tested";

export type KeyHealthCheck = {
  status: KeyHealthStatus;
  message: string;
  httpStatus: number | null;
  apiCode: string | null;
  rawDetail: string;
  model: string | null;
  latencyMs: number | null;
  checkedAt: number | null;
  cooldownUntil: number | null;
};

export type KeyModelReason =
  | "rate-limited"
  | "quota-exhausted"
  | "model-unavailable"
  | "server-error";

export type KeyModelState = {
  until: number | null;
  reason: KeyModelReason;
};

export type ApiKeyEntry = {
  id: string;
  provider: ApiProvider;
  key: string;
  enabled: boolean;
  health?: KeyHealthCheck;
  models?: string[];
  modelStates?: Record<string, KeyModelState>;
  modelsFetchedAt?: number | null;
};

export type Marketplace = "adobe" | "shutterstock";

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
};

export type GitSyncConfig = {
  enabled: boolean;
  autoPush: boolean;
  repoUrl: string;
  branch: string;
  token: string;
  commitMessage: string;
  outputDir: string;
};

export type GitPushState = "idle" | "pushing" | "success" | "error";

export type GitPushStatus = {
  state: GitPushState;
  message: string | null;
  commitHash: string | null;
  branch: string | null;
  lastPushedAt: number | null;
};

export type GitPushResult = {
  ok: boolean;
  changed: boolean;
  message: string;
  commitHash?: string;
  branch?: string;
  code?: string;
};

export type GitPushFile = {
  path: string;
  content: string;
};
