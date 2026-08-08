"use client"

import { useState } from "react"
import { CheckCircle2, Eye, EyeOff, GitBranch, Loader2, RefreshCw, UploadCloud, XCircle } from "lucide-react"

import { pushToGitHub, testGitConnection } from "@/lib/git-sync"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

export function GitSyncSettings() {
  const gitConfig = useAppStore((state) => state.gitConfig);
  const setGitConfig = useAppStore((state) => state.setGitConfig);
  const gitPushStatus = useAppStore((state) => state.gitPushStatus);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState<"push" | "test" | null>(null);

  const status = gitPushStatus.state;
  const isBusy = busy !== null;

  const handlePush = async () => {
    setBusy("push");
    try {
      const result = await pushToGitHub();
      toast(
        result.ok ? "success" : "error",
        result.ok ? "Pushed to GitHub" : "Git push failed",
        result.message
      );
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    setBusy("test");
    try {
      const result = await testGitConnection();
      toast(
        result.ok ? "success" : "error",
        result.ok ? "Connection OK" : "Connection failed",
        result.message
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2.5">
        <p className="text-sm font-semibold tracking-tight">Git Sync</p>
        <Badge variant={gitConfig.enabled ? "secondary" : "outline"}>
          <GitBranch className="size-3" />
          {gitConfig.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="git-enabled">Enable auto-push</Label>
          <Switch
            id="git-enabled"
            checked={gitConfig.enabled}
            onCheckedChange={(enabled) => setGitConfig({ enabled })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Push generated metadata files to GitHub after a batch finishes.
        </p>
      </div>

      {gitConfig.enabled ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="git-repo-url">Repository URL</Label>
            <Input
              id="git-repo-url"
              type="url"
              placeholder="https://github.com/user/repo.git"
              value={gitConfig.repoUrl}
              onChange={(event) => setGitConfig({ repoUrl: event.target.value })}
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="git-branch">Branch</Label>
            <Input
              id="git-branch"
              value={gitConfig.branch}
              onChange={(event) => setGitConfig({ branch: event.target.value })}
              placeholder="main"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="git-token">Personal Access Token</Label>
            <div className="relative">
              <Input
                id="git-token"
                type={showToken ? "text" : "password"}
                value={gitConfig.token}
                onChange={(event) => setGitConfig({ token: event.target.value })}
                placeholder="ghp_…"
                className="pr-9 font-mono"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowToken((v) => !v)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored locally in your browser. Needs repo push permissions.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="git-commit-message">Commit message</Label>
            <Input
              id="git-commit-message"
              value={gitConfig.commitMessage}
              onChange={(event) => setGitConfig({ commitMessage: event.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="git-output-dir">Output folder</Label>
            <Input
              id="git-output-dir"
              value={gitConfig.outputDir}
              onChange={(event) => setGitConfig({ outputDir: event.target.value })}
              placeholder="output"
            />
            <p className="text-xs text-muted-foreground">
              Generated CSVs are written here before being committed.
            </p>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="git-auto-push">Push automatically after batch</Label>
              <Switch
                id="git-auto-push"
                checked={gitConfig.autoPush}
                onCheckedChange={(autoPush) => setGitConfig({ autoPush })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isBusy}
              onClick={handleTest}
            >
              {busy === "test" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Test connection
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isBusy}
              onClick={handlePush}
            >
              {busy === "push" ? <Loader2 className="animate-spin" /> : <UploadCloud />}
              Push now
            </Button>
          </div>

          <div
            className={cn(
              "flex flex-col gap-1 rounded-xl border p-3",
              status === "success" && "border-emerald-500/40 bg-emerald-500/10",
              status === "error" && "border-destructive/40 bg-destructive/10",
              (status === "idle" || status === "pushing") && "border-border bg-background/60"
            )}
          >
            <div className="flex items-center gap-2">
              {status === "pushing" ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : status === "success" ? (
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              ) : status === "error" ? (
                <XCircle className="size-4 text-destructive" />
              ) : (
                <GitBranch className="size-4 text-muted-foreground" />
              )}
              <p className="text-xs font-semibold">
                {status === "pushing"
                  ? "Pushing…"
                  : status === "success"
                    ? "Push succeeded"
                    : status === "error"
                      ? "Push failed"
                      : "Status"}
              </p>
            </div>
            {gitPushStatus.message ? (
              <p className="text-xs break-words text-muted-foreground">
                {gitPushStatus.message}
              </p>
            ) : null}
            {gitPushStatus.commitHash ? (
              <p className="font-mono text-xs text-muted-foreground">
                commit {gitPushStatus.commitHash.slice(0, 7)}
                {gitPushStatus.branch ? ` · ${gitPushStatus.branch}` : ""}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
