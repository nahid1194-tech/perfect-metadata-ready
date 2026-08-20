export type EpsConversionStatus =
  | "queued"
  | "uploading"
  | "converting"
  | "ready"
  | "failed";

export type ImageAsset = {
  id: string;
  name: string;
  size: number;
  type: string;
  /** Preview source. Object URL (blob:) for freshly picked files, or a
   *  base64 data URL fallback for restored assets. Never the full original
   *  read as base64 for new uploads. */
  dataUrl?: string;
  /** Optimized analysis image (base64 data URL) sent to the AI. */
  apiDataUrl?: string;
  /** Compressed analysis blob — deferred base64 conversion at generation time. */
  apiBlob?: Blob;
  apiMimeType?: string;
  /** Object URL for instant local preview of the original file. */
  previewUrl?: string;
  /** Original file bytes kept locally for export/preview. For EPS/PS this is
   *  the rendered PNG (browsers cannot display the raw vector file). */
  blob?: Blob;
  width?: number;
  height?: number;
  /** True once the AI analysis image has been prepared at upload time. */
  prepared?: boolean;
  /** EPS/PS conversion status — only set for vector files. */
  epsStatus?: EpsConversionStatus;
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
  qualityScore?: number;
  timingMs?: Record<string, number>;
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
  | "failed"
  | "cancelled";

export type QueueState = "idle" | "running" | "paused" | "stopped";

export type DebugStatus = {
  activeProvider: ApiProvider | null;
  activeKeyIndex: number | null;
  activeKeyCount: number;
  activeModel: string | null;
  activeKeyMasked: string | null;
  remainingKeys: number | null;
  fallbackActive: boolean;
};

export type JobStatus =
  | "queued"
  | "processing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type WorkerSnapshot = {
  jobId: string;
  results: GenerationResult[];
  queueItems: Record<string, QueueItem>;
  batchTotal: number;
  batchCompleted: number;
  progress: number;
  generating: boolean;
  queueState: QueueState;
  activeImageId: string | null;
  failedImageIds: string[];
  etaSeconds: number | null;
  debugStatus: DebugStatus;
  successOpen: boolean;
  errorOpen: boolean;
  apiPrepared?: Record<string, { apiDataUrl?: string; apiMimeType?: string }>;
};

export type PersistedJobImage = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  apiDataUrl?: string;
  apiMimeType?: string;
};

export type PersistedJob = {
  jobId: string;
  status: JobStatus;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  remaining: number;
  currentImageId: string | null;
  currentImageName: string | null;
  progress: number;
  results: GenerationResult[];
  queueItems: Record<string, QueueItem>;
  errors: Record<string, string>;
  failedImageIds: string[];
  images: PersistedJobImage[];
  settings: GenerationSettings;
  apiKeys: ApiKeyEntry[];
  primaryProvider: ApiProvider;
  providerModels: Record<ApiProvider, string[]>;
  providerModelsFetchedAt: Record<ApiProvider, number | null>;
  createdAt: number;
  updatedAt: number;
};

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
  maxConcurrent: number;
};

export type GitSyncConfig = {
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

export type ImageAnalysis = {
  assetType: string;
  orientation: "horizontal" | "vertical" | "square" | "unknown";
  composition: string;
  background: string;
  primarySubject: string;
  primaryDetails: string;
  secondarySubjects: string[];
  visualDetails: string[];
  concepts: string[];
  visibleText: string[];
  colors: string[];
  summary: string;
};

export type ValidationComponent =
  | "title"
  | "description"
  | "keywords"
  | "category";

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  format: CsvFormat;
  component: ValidationComponent;
  severity: ValidationSeverity;
  message: string;
};
