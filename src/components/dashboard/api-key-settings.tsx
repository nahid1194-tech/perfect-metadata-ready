"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
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
import { friendlyApiError, testGeminiConnection } from "@/lib/generate"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

type FormValues = {
  key: string;
  model: string;
};

type ConnStatus = "idle" | "testing" | "connected" | "failed";

export function ApiKeySettings() {
  const apiKeys = useAppStore((state) => state.apiKeys);
  const addApiKey = useAppStore((state) => state.addApiKey);
  const updateApiKey = useAppStore((state) => state.updateApiKey);
  const removeApiKey = useAppStore((state) => state.removeApiKey);
  const setModel = useAppStore((state) => state.setModel);
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<ConnStatus>("idle");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modelCount, setModelCount] = useState(0);

  const { register, handleSubmit, watch, reset } = useForm<FormValues>({
    defaultValues: { key: "", model: useAppStore.getState().model },
  });
  const watchedKey = watch("key");

  const saveKey = (values: FormValues) => {
    const trimmed = values.key.trim();
    setModel(values.model);
    if (editingId) {
      if (trimmed) {
        updateApiKey(editingId, { key: trimmed });
        toast("success", "Key updated");
      } else {
        toast("info", "No changes", "Paste a new key to replace the current one.");
      }
      setEditingId(null);
    } else {
      if (!trimmed) {
        toast("error", "Enter a key first", "Paste your Gemini API key to add it.");
        return;
      }
      addApiKey({ id: crypto.randomUUID(), key: trimmed, enabled: true });
      toast("success", "Key added");
    }
    setStatus("idle");
    reset({ key: "", model: values.model });
  };

  const startEdit = (id: string) => {
    setEditingId(id);
    setStatus("idle");
    reset({ key: "", model: useAppStore.getState().model });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setStatus("idle");
    reset({ key: "", model: useAppStore.getState().model });
  };

  const testConnection = async () => {
    const key = watchedKey.trim();
    if (!key) {
      toast("error", "Enter a key first", "Paste your Gemini API key to test it.");
      return;
    }

    setStatus("testing");
    try {
      const count = await testGeminiConnection(key);
      setModelCount(count);
      setStatus("connected");
      if (editingId) {
        updateApiKey(editingId, { key });
        setEditingId(null);
      } else {
        addApiKey({ id: crypto.randomUUID(), key, enabled: true });
      }
      toast("success", "Connection successful", `${count} models available.`);
      reset({ key: "", model: useAppStore.getState().model });
    } catch (error) {
      setStatus("failed");
      toast("error", "Connection failed", friendlyApiError(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label>API keys</Label>
        {apiKeys.length === 0 ? (
          <p className="text-xs text-muted-foreground">No keys added yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {apiKeys.map((entry) => (
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

      <form onSubmit={handleSubmit(saveKey)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="api-key">
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
              id="api-key"
              type={visible ? "text" : "password"}
              placeholder={editingId ? "AIza… (paste new key)" : "AIza…"}
              className="pr-9 font-mono"
              {...register("key")}
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="model">Model</Label>
          <Select id="model" {...register("model")}>
            {MODELS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" size="sm">
            {editingId ? <Pencil /> : <Plus />}
            {editingId ? "Save key" : "Add key"}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={status === "testing" || !watchedKey.trim()}
            onClick={testConnection}
          >
            {status === "testing" ? <Loader2 className="animate-spin" /> : <Zap />}
            Test connection
          </Button>
          {editingId ? (
            <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>
              <X />
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      <p className="text-xs text-muted-foreground">
        Keys are saved in browser localStorage and loaded automatically. Requests
        use the first active key, then rotate across keys on quota, rate-limit, or
        invalid-key errors. If no active key is available the queue pauses. When
        no keys are added, a local engine generates results on-device.
      </p>
    </div>
  );
}
