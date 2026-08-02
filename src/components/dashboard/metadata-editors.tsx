"use client"

import { useState } from "react"
import { Check, Copy, Plus, X } from "lucide-react"

import type { MetadataMode } from "@/lib/types"
import {
  ADOBE_CATEGORIES,
  SHUTTERSTOCK_CATEGORIES,
} from "@/lib/stock-spec"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { toast } from "@/store/use-toast-store"

export function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast("success", "Copied to clipboard");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={copy}
      className={copied ? "text-emerald-600 dark:text-emerald-400" : undefined}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function Counter({
  value,
  max,
  error,
}: {
  value: number;
  max?: number;
  error?: boolean;
}) {
  const text = max
    ? `${value}/${max}${value === 1 ? " character" : " characters"}`
    : `${value}${value === 1 ? " character" : " characters"}`;
  return (
    <p
      className={cn(
        "text-xs",
        error ? "font-medium text-destructive" : "text-muted-foreground"
      )}
    >
      {text}
    </p>
  );
}

export function KeywordEditor({
  keywords,
  onChange,
  max,
  min = 0,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  max: number;
  min?: number;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const value = draft.trim().replace(/,+$/, "");
    if (!value) return;
    if (keywords.length >= max) {
      toast("error", "Keyword limit reached", `Maximum ${max} keywords.`);
      return;
    }
    onChange([...keywords, value]);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {keywords.length === 0 ? (
          <span className="text-xs text-muted-foreground">No keywords yet.</span>
        ) : (
          keywords.map((keyword, index) => (
            <Badge
              key={`${keyword}-${index}`}
              variant="secondary"
              className="gap-1 py-0.5 pr-1"
            >
              {keyword}
              <button
                type="button"
                onClick={() => onChange(keywords.filter((_, i) => i !== index))}
                className="rounded-full p-0.5 transition-colors hover:bg-destructive/20 hover:text-destructive"
                aria-label={`Remove ${keyword}`}
              >
                <X className="size-3" />
              </button>
            </Badge>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder="Type a keyword and press Enter (no commas)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!draft.trim()}
          onClick={add}
          aria-label="Add keyword"
        >
          <Plus />
        </Button>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {keywords.length}/{max} keywords
        </p>
        {min > 0 && keywords.length < min ? (
          <p className="text-xs font-medium text-destructive">
            Minimum {min} keywords required
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CategoryEditor({
  mode,
  value,
  onChange,
}: {
  mode: MetadataMode;
  value: string;
  onChange: (value: string) => void;
}) {
  if (mode === "adobe") {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {ADOBE_CATEGORIES.map((category) => (
          <option key={category.id} value={category.id}>
            {category.id} — {category.label}
          </option>
        ))}
      </Select>
    );
  }

  const [primary, secondary] = value
    .split(",")
    .map((part) => part.trim());
  const update = (first: string, second: string) => {
    onChange(second ? `${first}, ${second}` : first);
  };

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Primary category</Label>
        <Select value={primary} onChange={(e) => update(e.target.value, secondary)}>
          <option value="">Select…</option>
          {SHUTTERSTOCK_CATEGORIES.map((category) => (
            <option key={category.id} value={category.id}>
              {category.id} — {category.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">
          Secondary category (optional)
        </Label>
        <Select
          value={secondary}
          onChange={(e) => update(primary, e.target.value)}
        >
          <option value="">None</option>
          {SHUTTERSTOCK_CATEGORIES.map((category) => (
            <option key={category.id} value={category.id}>
              {category.id} — {category.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
