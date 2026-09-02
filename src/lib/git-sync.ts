import type {
  GenerationResult,
  GitPushFile,
  GitPushResult,
} from "@/lib/types";
import { useAppStore } from "@/store/use-app-store";

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildErrorResult(error: unknown, changed = false): GitPushResult {
  const message =
    error instanceof Error ? error.message : "Git push failed unexpectedly.";
  return { ok: false, changed, message, code: "CLIENT_ERROR" };
}

export async function buildCsvFiles(
  results: GenerationResult[]
): Promise<GitPushFile[]> {
  // Lazy-load the CSV builders so the export/papaparse code is only fetched
  // when the user actually pushes to GitHub.
  const { buildAdobeCsv, buildShutterstockCsv } = await import("@/lib/export");
  const [adobeCsv, shutterstockCsv] = await Promise.all([
    buildAdobeCsv(results),
    buildShutterstockCsv(results),
  ]);
  const stamp = dateStamp();
  return [
    { path: `adobe-stock-${stamp}.csv`, content: adobeCsv },
    { path: `shutterstock-${stamp}.csv`, content: shutterstockCsv },
  ];
}

export async function pushToGitHub(): Promise<GitPushResult> {
  const store = useAppStore.getState();
  const config = store.gitConfig;
  const results = store.results;

  if (results.length === 0) {
    return { ok: false, changed: false, message: "Generate metadata first before pushing." };
  }

  store.setGitPushStatus({ state: "pushing", message: "Preparing files and pushing to GitHub…" });

  let files: GitPushFile[] = [];
  try {
    files = await buildCsvFiles(results);
  } catch (error) {
    const result = buildErrorResult(error);
    store.setGitPushStatus({ state: "error", message: result.message });
    return result;
  }

  try {
    const response = await fetch("/api/git-push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "push",
        repoUrl: config.repoUrl,
        branch: config.branch,
        token: config.token,
        commitMessage: config.commitMessage,
        outputDir: config.outputDir,
        files,
      }),
    });
    const result = (await response.json()) as GitPushResult;
    store.setGitPushStatus({
      state: result.ok ? "success" : "error",
      message: result.message,
      commitHash: result.commitHash ?? null,
      branch: result.branch ?? config.branch,
      lastPushedAt: result.ok ? Date.now() : null,
    });
    return result;
  } catch (error) {
    const result = buildErrorResult(error);
    store.setGitPushStatus({ state: "error", message: result.message });
    return result;
  }
}


