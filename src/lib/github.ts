const API = "https://api.github.com";

export type GithubScanResult = {
  ref: string;
  files: Array<{ path: string; size: number; mime: string }>;
  truncated: boolean;
};

const SUPPORTED_EXT =
  /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|svg|eps|ps|mp4|webm|mov|m4v)$/i;

export function parseGithubRepo(input: string): {
  owner: string;
  repo: string;
} {
  let value = input.trim();
  if (!value) throw new Error("Enter a repository.");
  value = value.replace(/^https?:\/\/(www\.)?github\.com\//, "");
  value = value.replace(/^git@github\.com:/, "");
  value = value.replace(/\.git$/, "");
  value = value.replace(/\/tree\/.*$/, "");
  value = value.replace(/\/blob\/.*$/, "");
  const parts = value.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Enter a repository as owner/repo or a GitHub URL.");
  }
  return { owner: parts[0], repo: parts[1] };
}

function mimeForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "svg":
      return "image/svg+xml";
    case "eps":
    case "ps":
      return "application/postscript";
    case "mp4":
    case "m4v":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    default:
      return "application/octet-stream";
  }
}

export async function scanGithubRepo(args: {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
  token?: string;
}): Promise<GithubScanResult> {
  const { owner, repo, branch, path, token } = args;
  const headers: Record<string, string> = token
    ? { Authorization: `Bearer ${token}` }
    : {};

  const repoRes = await fetch(`${API}/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) {
    if (repoRes.status === 404) {
      throw new Error(`Repository "${owner}/${repo}" not found.`);
    }
    if (repoRes.status === 401 || repoRes.status === 403) {
      throw new Error(
        "GitHub rate limit or auth error. Add a token or try again later."
      );
    }
    throw new Error(`GitHub error ${repoRes.status}.`);
  }
  const repoData = (await repoRes.json()) as { default_branch?: string };
  const ref = branch?.trim() || repoData.default_branch || "HEAD";

  const treeRes = await fetch(
    `${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    { headers }
  );
  if (!treeRes.ok) {
    if (treeRes.status === 404) {
      throw new Error(`Branch or ref "${ref}" not found.`);
    }
    throw new Error(
      `GitHub error ${treeRes.status} while reading the repository tree.`
    );
  }
  const treeData = (await treeRes.json()) as {
    tree?: Array<{ path?: string; type?: string; size?: number }>;
    truncated?: boolean;
  };

  const prefix = path?.trim()?.replace(/\/+$/, "");
  const files = (treeData.tree ?? [])
    .filter((entry) => entry.type === "blob" && SUPPORTED_EXT.test(entry.path ?? ""))
    .filter((entry) => !prefix || (entry.path ?? "").startsWith(`${prefix}/`))
    .map((entry) => ({
      path: entry.path ?? "",
      size: entry.size ?? 0,
      mime: mimeForPath(entry.path ?? ""),
    }));

  return { ref, files, truncated: treeData.truncated === true };
}

export async function downloadGithubFile(args: {
  owner: string;
  repo: string;
  ref: string;
  path: string;
  token?: string;
  mime: string;
}): Promise<File> {
  const { owner, repo, ref, path, token, mime } = args;
  const name = path.split("/").pop() ?? path;
  const useRaw = !token && !ref.includes("/");

  if (useRaw) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Could not download ${name} (${res.status}).`);
    }
    const blob = await res.blob();
    return new File([blob], name, { type: mime });
  }

  const contentsUrl = `${API}/repos/${owner}/${repo}/contents/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(contentsUrl, {
    headers: {
      Accept: "application/vnd.github.raw+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Could not download ${name} (${res.status}).`);
  }
  const blob = await res.blob();
  return new File([blob], name, { type: mime });
}
