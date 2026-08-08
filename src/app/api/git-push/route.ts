import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";

import type { GitPushFile, GitPushResult } from "@/lib/types";

export const runtime = "nodejs";

const execFileAsync = promisify(execFile);
const DEFAULT_COMMIT_MESSAGE = "Auto-update: Generated SEO metadata for images";
const MAX_BUFFER = 16 * 1024 * 1024;

type PushAction = "push" | "test";

type GitPushRequest = {
  action?: PushAction;
  repoUrl?: string;
  branch?: string;
  token?: string;
  commitMessage?: string;
  outputDir?: string;
  files?: GitPushFile[];
};

type GitOutcome = {
  ok: boolean;
  result: Partial<GitPushResult>;
  status?: number;
};

class GitCommandError extends Error {
  stderr: string;
  code?: string | number;

  constructor(message: string, stderr: string, code?: string | number) {
    super(message);
    this.name = "GitCommandError";
    this.stderr = stderr;
    this.code = code;
  }
}

async function runGit(
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "Never",
      },
      windowsHide: true,
    });
    return { stdout: String(stdout), stderr: String(stderr) };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stderr?: string;
      stdout?: string;
    };
    const message = err.message ?? "Git command failed.";
    const stderr = String(err.stderr ?? "") || message;
    throw new GitCommandError(message, stderr, err.code);
  }
}

function errorToResult(error: unknown, branch?: string): GitPushResult {
  if (!(error instanceof GitCommandError)) {
    const message =
      error instanceof Error ? error.message : "Unknown git error occurred.";
    return {
      ok: false,
      changed: false,
      message,
      branch,
      code: "UNKNOWN",
    };
  }

  const stderr = error.stderr.toLowerCase();
  if (error.code === "ENOENT") {
    return {
      ok: false,
      changed: false,
      message:
        "Git is not installed or is missing from the server PATH. Install Git and restart the dev server.",
      code: "GIT_MISSING",
    };
  }
  if (/not a git repository/i.test(stderr)) {
    return {
      ok: false,
      changed: false,
      message:
        "The output folder is not inside a Git repository. Initialize one with `git init` first.",
      code: "NOT_A_REPO",
    };
  }
  if (/(authentication failed|invalid username or password|could not read username|401|403)/i.test(stderr)) {
    return {
      ok: false,
      changed: false,
      message:
        "GitHub authentication failed. Check that the Personal Access Token is valid and has push permissions.",
      branch,
      code: "AUTH_FAILED",
    };
  }
  if (/(could not resolve host|failed to connect|connection timed out|connection refused|network)/i.test(stderr)) {
    return {
      ok: false,
      changed: false,
      message: "Network error while pushing to GitHub. Check your connection and try again.",
      branch,
      code: "NETWORK",
    };
  }
  if (/(repository not found|does not appear to be a git repository|404)/i.test(stderr)) {
    return {
      ok: false,
      changed: false,
      message:
        "The GitHub repository could not be found. Check the repository URL and that the token has access.",
      branch,
      code: "REPO_NOT_FOUND",
    };
  }
  if (/(rejected|non-fast-forward|fetch first|conflict|merge)/i.test(stderr)) {
    return {
      ok: false,
      changed: false,
      message:
        "Push rejected: the remote branch has commits that are not in your local repository. Pull or rebase first, then retry.",
      branch,
      code: "CONFLICT",
    };
  }
  if (/(nothing to commit|no changes added|working tree clean|everything up-to-date)/i.test(stderr)) {
    return {
      ok: true,
      changed: false,
      message: "No changes to push — the working tree is already up to date.",
      branch,
      code: "NO_CHANGES",
    };
  }
  return {
    ok: false,
    changed: false,
    message: error.stderr || error.message,
    branch,
    code: "GIT_ERROR",
  };
}

function parseRepoUrl(repoUrl: string): string {
  return repoUrl.trim().replace(/\/+$/, "");
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "metadata";
}

function isSafeRelativePath(baseDir: string, path: string): boolean {
  if (!path) return false;
  const resolved = resolve(join(baseDir, path));
  const base = resolve(baseDir);
  return resolved === base || resolved.startsWith(base + sep);
}

async function runPush(
  body: GitPushRequest,
  cwd: string,
  repoUrl: string,
  branch: string,
  token: string
): Promise<GitOutcome> {
  const outputDir = body.outputDir?.trim() || "output";
  const safeOutputDir = safeFileName(outputDir) || "output";
  const target = join(cwd, safeOutputDir);
  const commitMessage = body.commitMessage?.trim() || DEFAULT_COMMIT_MESSAGE;

  try {
    await mkdir(target, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      result: errorToResult(error, branch),
    };
  }

  if (body.files && body.files.length > 0) {
    for (const file of body.files) {
      if (!isSafeRelativePath(target, file.path)) {
        return {
          ok: false,
          result: {
            ok: false,
            changed: false,
            message: `Refusing to write outside the output directory: ${file.path}`,
            code: "INVALID_PATH",
          },
        };
      }
    }
    try {
      for (const file of body.files) {
        const filePath = resolve(target, file.path);
        await mkdir(join(filePath, ".."), { recursive: true });
        await writeFile(filePath, file.content, "utf8");
      }
    } catch (error) {
      return {
        ok: false,
        result: errorToResult(error, branch),
      };
    }
  }

  try {
    await runGit(["add", "-A"], cwd);
  } catch (error) {
    return { ok: false, result: errorToResult(error, branch) };
  }

  try {
    const { stdout } = await runGit(["diff", "--cached", "--quiet"], cwd);
    void stdout;
    return {
      ok: true,
      result: {
        ok: true,
        changed: false,
        message: "No changes to commit — generated metadata is already up to date.",
        branch,
        code: "NO_CHANGES",
      },
    };
  } catch {
    // There are staged changes; fall through to commit.
  }

  try {
    await runGit(
      [
        "-c",
        "user.name=PromptLab Auto-Push",
        "-c",
        "user.email=auto-push@promptlab.local",
        "commit",
        "-m",
        commitMessage,
      ],
      cwd
    );
  } catch (error) {
    return { ok: false, result: errorToResult(error, branch) };
  }

  try {
    const { stdout } = await runGit(["rev-parse", "HEAD"], cwd);
    const commitHash = stdout.trim();
    const remote = token
      ? repoUrl.replace(/^https:\/\//, `https://x-access-token:${encodeURIComponent(token)}@`)
      : repoUrl;
    await runGit(["push", remote, `HEAD:${branch}`], cwd);
    return {
      ok: true,
      result: {
        ok: true,
        changed: true,
        message: `Pushed ${body.files?.length ?? 0} file(s) to ${branch}. Commit ${commitHash.slice(0, 7)}.`,
        commitHash,
        branch,
        code: "PUSHED",
      },
    };
  } catch (error) {
    const result = errorToResult(error, branch);
    if (result.ok) return { ok: true, result };
    return { ok: false, result };
  }
}

async function runTest(
  body: GitPushRequest,
  cwd: string,
  repoUrl: string,
  branch: string,
  token: string
): Promise<GitOutcome> {
  const remote = token
    ? repoUrl.replace(/^https:\/\//, `https://x-access-token:${encodeURIComponent(token)}@`)
    : repoUrl;
  try {
    const { stdout } = await runGit(["ls-remote", "--heads", remote, branch], cwd);
    const found = stdout.trim().length > 0;
    return {
      ok: true,
      result: {
        ok: true,
        changed: false,
        message: found
          ? `Connected to ${repoUrl}. Branch "${branch}" exists on the remote.`
          : `Connected to ${repoUrl}. Branch "${branch}" does not exist yet — it will be created on the first push.`,
        branch,
        code: "CONNECTED",
      },
    };
  } catch (error) {
    return { ok: false, result: errorToResult(error, branch) };
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: GitPushRequest = {};
  try {
    body = (await request.json()) as GitPushRequest;
  } catch {
    return NextResponse.json(
      { ok: false, changed: false, message: "Invalid JSON request body." },
      { status: 400 }
    );
  }

  const cwd = process.cwd();
  const repoUrl = body.repoUrl?.trim() || process.env.GIT_REPOSITORY_URL || "";
  const token = body.token?.trim() || process.env.GITHUB_TOKEN || "";
  const branch = body.branch?.trim() || process.env.GIT_BRANCH || "main";
  const action: PushAction = body.action === "test" ? "test" : "push";

  if (!repoUrl) {
    return NextResponse.json(
      {
        ok: false,
        changed: false,
        message: "No repository URL configured. Add the GitHub repository URL in Git Sync settings.",
        code: "NO_URL",
      },
      { status: 400 }
    );
  }
  if (action === "push" && !token) {
    return NextResponse.json(
      {
        ok: false,
        changed: false,
        message: "No GitHub token configured. Add a Personal Access Token in Git Sync settings.",
        code: "NO_TOKEN",
      },
      { status: 400 }
    );
  }

  const parsedUrl = parseRepoUrl(repoUrl);
  const outcome =
    action === "test"
      ? await runTest(body, cwd, parsedUrl, branch, token)
      : await runPush(body, cwd, parsedUrl, branch, token);

  const result = outcome.result as GitPushResult;
  return NextResponse.json(result, { status: outcome.status ?? (result.ok ? 200 : 500) });
}
