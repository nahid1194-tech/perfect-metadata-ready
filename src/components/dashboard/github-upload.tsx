"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { FolderDown, FolderGit2, Loader2, Search } from "lucide-react"

import {
  downloadGithubFile,
  parseGithubRepo,
  scanGithubRepo,
  type GithubScanResult,
} from "@/lib/github"
import { formatBytes, processUploadFiles } from "@/lib/upload-process"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

const MAX_IMPORT = 100;

export function GithubUpload() {
  const addImages = useAppStore((state) => state.addImages);
  const [repoInput, setRepoInput] = useState("");
  const [branch, setBranch] = useState("");
  const [path, setPath] = useState("");
  const [token, setToken] = useState("");
  const [scanning, setScanning] = useState(false);
  const [adding, setAdding] = useState(false);
  const [status, setStatus] = useState("");
  const [scan, setScan] = useState<GithubScanResult | null>(null);
  const [repo, setRepo] = useState<{ owner: string; repo: string } | null>(null);

  const handleScan = async () => {
    let parsed: { owner: string; repo: string };
    try {
      parsed = parseGithubRepo(repoInput);
    } catch (error) {
      toast(
        "error",
        "Invalid repository",
        error instanceof Error ? error.message : "Enter owner/repo."
      );
      return;
    }
    setScanning(true);
    setScan(null);
    setStatus("");
    try {
      const result = await scanGithubRepo({
        ...parsed,
        branch: branch.trim(),
        path: path.trim(),
        token: token.trim() || undefined,
      });
      setRepo(parsed);
      setScan(result);
      if (result.files.length === 0) {
        toast(
          "info",
          "No images found",
          "No supported image files were found in that repository path."
        );
      }
    } catch (error) {
      toast(
        "error",
        "Scan failed",
        error instanceof Error ? error.message : "Could not scan the repository."
      );
    } finally {
      setScanning(false);
    }
  };

  const handleAddAll = async () => {
    if (!scan || !repo || scan.files.length === 0 || adding) return;
    const files = scan.files.slice(0, MAX_IMPORT);
    setAdding(true);
    try {
      const fileObjects: File[] = [];
      for (let i = 0; i < files.length; i++) {
        setStatus(`Downloading ${i + 1}/${files.length}…`);
        fileObjects.push(
          await downloadGithubFile({
            ...repo,
            ref: scan.ref,
            path: files[i].path,
            token: token.trim() || undefined,
            mime: files[i].mime,
          })
        );
      }
      setStatus("Processing files…");
      const { assets, failures } = await processUploadFiles(fileObjects);
      if (assets.length > 0) addImages(assets);
      const skipped = scan.files.length - files.length;
      let summary = `${assets.length} image${assets.length === 1 ? "" : "s"} added.`;
      if (failures.length > 0) {
        summary += ` ${failures.length} failed.`;
      }
      if (skipped > 0) {
        summary += ` ${skipped} skipped (${MAX_IMPORT} max).`;
      }
      toast(
        failures.length === 0 ? "success" : "info",
        "GitHub import complete",
        summary
      );
      setScan(null);
      setRepo(null);
    } catch (error) {
      toast(
        "error",
        "Import failed",
        error instanceof Error ? error.message : "Could not import the files."
      );
    } finally {
      setAdding(false);
      setStatus("");
    }
  };

  const totalSize = scan
    ? scan.files.slice(0, MAX_IMPORT).reduce((sum, file) => sum + file.size, 0)
    : 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        <FolderGit2 className="size-4" />
        <h3 className="text-sm font-semibold">Import from GitHub</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-repo">Repository</Label>
          <Input
            id="gh-repo"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="owner/repo"
            disabled={scanning || adding}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-branch">Branch (optional)</Label>
          <Input
            id="gh-branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
            disabled={scanning || adding}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-path">Folder path (optional)</Label>
          <Input
            id="gh-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="images/2026"
            disabled={scanning || adding}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="gh-token">Token (optional)</Label>
          <Input
            id="gh-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_…"
            disabled={scanning || adding}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={scanning || adding || !repoInput.trim()}
          onClick={handleScan}
        >
          {scanning ? <Loader2 className="animate-spin" /> : <Search />}
          Scan
        </Button>
        {scan && scan.files.length > 0 ? (
          <Button size="sm" disabled={adding} onClick={handleAddAll}>
            {adding ? <Loader2 className="animate-spin" /> : <FolderDown />}
            Add {scan.files.length > MAX_IMPORT ? `first ${MAX_IMPORT} of ` : ""}
            {scan.files.length} image{scan.files.length === 1 ? "" : "s"}
          </Button>
        ) : null}
      </div>

      {scan && scan.files.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-muted-foreground">
            Found {scan.files.length} image{scan.files.length === 1 ? "" : "s"}{" "}
            ({formatBytes(totalSize)})
            {scan.truncated ? " — tree truncated by GitHub" : ""}.
          </p>
          {!token.trim() ? (
            <p className="text-[11px] text-muted-foreground">
              Tip: add a GitHub token to raise the 60 requests/hour limit on
              public repositories.
            </p>
          ) : null}
        </div>
      ) : null}

      {scanning || adding ? (
        <p className="text-xs font-medium text-muted-foreground">
          {status || (scanning ? "Scanning repository…" : "Importing…")}
        </p>
      ) : null}
    </motion.section>
  );
}
