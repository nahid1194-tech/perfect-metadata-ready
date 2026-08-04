"use client"

import { useState } from "react"
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react"

import { maskKey } from "@/lib/api-keys"
import {
  friendlyApiError,
  testGeminiConnection,
  testMistralConnection,
  testOpenAIConnection,
} from "@/lib/generate"
import { refreshProviderModels } from "@/lib/models"
import type { ApiProvider } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

type ConnStatus = "idle" | "testing" | "connected" | "failed";

const PROVIDER_META: Record<
  ApiProvider,
  { label: string; title: string; placeholder: string }
> = {
  gemini: {
    label: "Gemini",
    title: "Gemini API Keys",
    placeholder: "AIza… (paste Gemini key)",
  },
  openai: {
    label: "OpenAI",
    title: "OpenAI API Keys",
    placeholder: "sk-… (paste OpenAI key)",
  },
  mistral: {
    label: "Mistral AI",
    title: "Mistral AI API Keys",
    placeholder: "… (paste Mistral key)",
  },
};

export function ApiKeySettings() {
  const primaryProvider = useAppStore((state) => state.primaryProvider);
  const apiKeys = useAppStore((state) => state.apiKeys);

  const hasFallback = apiKeys.some(
    (entry) => entry.provider !== primaryProvider && entry.enabled
  );
  const meta = PROVIDER_META[primaryProvider];

  return (
    <div className="flex flex-col gap-5">
      <PrimaryProviderPicker />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="default">
          <Zap className="size-3" />
          Primary Provider: {meta.label}
        </Badge>
        {hasFallback ? (
          <Badge variant="outline">
            <Check className="size-3" />
            Fallback Available
          </Badge>
        ) : null}
      </div>

      <ProviderKeys
        provider={primaryProvider}
        title={meta.title}
        placeholder={meta.placeholder}
      />

      <p className="text-xs text-muted-foreground">
        Only the primary provider&apos;s keys are shown here. Keys for the other
        providers stay saved and hidden, and they remain active as automatic
        fallbacks in the background. The primary provider is tried first for
        every image; if it is rate-limited or unavailable, the queue switches to
        the next compatible model, then the next key, then the hidden fallback
        providers automatically, retries the same image, and continues without
        losing progress. Keys are saved in browser localStorage and loaded
        automatically. If no active keys are added, a local engine generates
        results on-device.
      </p>
    </div>
  );
}

function PrimaryProviderPicker() {
  const primaryProvider = useAppStore((state) => state.primaryProvider);
  const setPrimaryProvider = useAppStore((state) => state.setPrimaryProvider);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="primary-provider">Primary provider</Label>
      <Select
        id="primary-provider"
        value={primaryProvider}
        onChange={(event) => {
          const value = event.target.value;
          const next: ApiProvider =
            value === "openai"
              ? "openai"
              : value === "mistral"
                ? "mistral"
                : "gemini";
          setPrimaryProvider(next);
          toast(
            "info",
            "Primary provider",
            `Primary Provider: ${
              next === "gemini"
                ? "Gemini"
                : next === "openai"
                  ? "OpenAI"
                  : "Mistral AI"
            }`
          );
        }}
      >
        <option value="gemini">Gemini</option>
        <option value="openai">OpenAI</option>
        <option value="mistral">Mistral AI</option>
      </Select>
      <p className="text-xs text-muted-foreground">
        Used first for every image; the remaining providers are used as
        automatic fallbacks.
      </p>
    </div>
  );
}

function ProviderKeys({
  provider,
  title,
  placeholder,
}: {
  provider: ApiProvider;
  title: string;
  placeholder: string;
}) {
  const apiKeys = useAppStore((state) => state.apiKeys);
  const addApiKey = useAppStore((state) => state.addApiKey);
  const updateApiKey = useAppStore((state) => state.updateApiKey);
  const removeApiKey = useAppStore((state) => state.removeApiKey);

  const providerKeys = apiKeys.filter((entry) => entry.provider === provider);

  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState(0);
  const [keyValue, setKeyValue] = useState("");

  const clearForm = () => {
    setKeyValue("");
    setVisible(false);
    setStatus("idle");
    setEditingId(null);
  };

  const saveKey = () => {
    const trimmed = keyValue.trim();
    if (editingId) {
      if (!trimmed) {
        toast("info", "No changes", "Paste a new key to replace the current one.");
        return;
      }
      updateApiKey(editingId, { key: trimmed });
      toast("success", "Key updated");
    } else {
      if (!trimmed) {
        toast("error", "Enter a key first", `Paste your ${title} API key to add it.`);
        return;
      }
      addApiKey({
        id: crypto.randomUUID(),
        provider,
        key: trimmed,
        enabled: true,
      });
      toast("success", "Key added");
    }
    clearForm();
    void refreshProviderModels(provider, { force: true });
  };

  const startEdit = (id: string) => {
    setEditingId(id);
    setStatus("idle");
    setKeyValue("");
  };

  const testConnection = async () => {
    const trimmed = keyValue.trim();
    if (!trimmed) {
      toast("error", "Enter a key first", `Paste your ${title} API key to test it.`);
      return;
    }

    setStatus("testing");
    try {
      const count =
        provider === "gemini"
          ? await testGeminiConnection(trimmed)
          : provider === "openai"
            ? await testOpenAIConnection(trimmed)
            : await testMistralConnection(trimmed);
      setModelCount(count);
      setStatus("connected");
      if (editingId) {
        updateApiKey(editingId, { key: trimmed });
      } else {
        addApiKey({
          id: crypto.randomUUID(),
          provider,
          key: trimmed,
          enabled: true,
        });
      }
      toast("success", "Connection successful", `${count} models available.`);
      clearForm();
      void refreshProviderModels(provider, { force: true });
    } catch (error) {
      setStatus("failed");
      toast("error", "Connection failed", friendlyApiError(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold tracking-tight">{title}</p>
        <Badge variant="secondary" className="text-xs">
          Primary
        </Badge>
      </div>

      <div className="flex flex-col gap-2">
        <Label>API keys</Label>
        {providerKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No keys added yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {providerKeys.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border bg-background/60 p-2",
                  editingId === entry.id && "ring-2 ring-ring/40"
                )}
              >
                <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                <span
                  className={cn(
                    "flex-1 truncate font-mono text-xs",
                    !entry.enabled && "text-muted-foreground line-through"
                  )}
                >
                  {maskKey(entry.key)}
                </span>
                <Switch
                  checked={entry.enabled}
                  onCheckedChange={(checked) =>
                    updateApiKey(entry.id, { enabled: checked })
                  }
                  aria-label={`Toggle API key ${maskKey(entry.key)}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => startEdit(entry.id)}
                  aria-label={`Edit API key ${maskKey(entry.key)}`}
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeApiKey(entry.id)}
                  aria-label={`Delete API key ${maskKey(entry.key)}`}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={`api-key-${provider}`}>
              {editingId ? "Replace API key" : "New API key"}
            </Label>
            {status !== "idle" ? (
              <Badge
                variant={status === "connected" ? "secondary" : "destructive"}
                className={cn(
                  status === "connected" &&
                    "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                )}
              >
                {status === "testing" ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Testing…
                  </>
                ) : status === "connected" ? (
                  <>
                    <Check className="size-3" />
                    Connected · {modelCount} models
                  </>
                ) : (
                  <>
                    <X className="size-3" />
                    Connection failed
                  </>
                )}
              </Badge>
            ) : null}
          </div>
          <div className="relative">
            <Input
              id={`api-key-${provider}`}
              type={visible ? "text" : "password"}
              placeholder={placeholder}
              className="pr-9 font-mono"
              value={keyValue}
              onChange={(event) => setKeyValue(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              aria-label={visible ? "Hide API key" : "Show API key"}
            >
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={saveKey}>
            {editingId ? <Pencil /> : <Plus />}
            {editingId ? "Save key" : "Add key"}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={status === "testing" || !keyValue.trim()}
            onClick={testConnection}
          >
            {status === "testing" ? <Loader2 className="animate-spin" /> : <Zap />}
            Test connection
          </Button>
          {editingId ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearForm}>
              <X />
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
