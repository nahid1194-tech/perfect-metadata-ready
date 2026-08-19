"use client"

import { Aperture, Camera } from "lucide-react"

import type { Marketplace } from "@/lib/types"
import { MARKETPLACES, marketplaceFormat } from "@/lib/marketplace"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useAppStore } from "@/store/use-app-store"

const PLATFORM_ICONS: Record<Marketplace, React.ComponentType<{ className?: string }>> = {
  adobe: Aperture,
  shutterstock: Camera,
};

export function MetadataSettings() {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  const isAdobe = marketplaceFormat(settings.platform) === "adobe";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm font-semibold tracking-tight">Metadata Settings</p>

      <div className="flex flex-col gap-2.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Marketplace
        </p>
        <div className="grid grid-cols-2 gap-2">
          {MARKETPLACES.map(({ id, label }) => {
            const Icon = PLATFORM_ICONS[id];
            const active = settings.platform === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setSettings({ platform: id })}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/5 text-foreground ring-2 ring-primary/20"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Output settings
        </p>

        <SliderRow
          label="Title Length"
          value={settings.titleLength}
          unit="ch"
          min={40}
          max={120}
          onChange={(value) => setSettings({ titleLength: value })}
        />
        {!isAdobe ? (
          <SliderRow
            label="Description Length"
            value={settings.descriptionLength}
            unit="ch"
            min={100}
            max={2000}
            step={50}
            onChange={(value) => setSettings({ descriptionLength: value })}
          />
        ) : null}
        <SliderRow
          label="Keyword Count"
          value={settings.keywordCount}
          unit="words"
          min={5}
          max={60}
          onChange={(value) => setSettings({ keywordCount: value })}
        />
        <SliderRow
          label="Concurrent Generations"
          value={settings.maxConcurrent}
          unit="images"
          min={1}
          max={8}
          onChange={(value) => setSettings({ maxConcurrent: value })}
        />

        <div className="h-px bg-border" />

        <OptionRow
          label="Prefix"
          enabled={settings.enablePrefix}
          value={settings.prefix}
          onToggle={(enablePrefix) => setSettings({ enablePrefix })}
          onChange={(prefix) => setSettings({ prefix })}
          placeholder="e.g. Professional photo of"
        />
        <OptionRow
          label="Suffix"
          enabled={settings.enableSuffix}
          value={settings.suffix}
          onToggle={(enableSuffix) => setSettings({ enableSuffix })}
          onChange={(suffix) => setSettings({ suffix })}
          placeholder="e.g. isolated on white"
        />
        <OptionRow
          label="Negative Title Words"
          enabled={settings.enableNegativeTitleWords}
          value={settings.negativeTitleWords}
          onToggle={(enableNegativeTitleWords) =>
            setSettings({ enableNegativeTitleWords })
          }
          onChange={(negativeTitleWords) => setSettings({ negativeTitleWords })}
          placeholder="comma-separated, e.g. ugly, blurry"
        />
        <OptionRow
          label="Negative Keywords"
          enabled={settings.enableNegativeKeywords}
          value={settings.negativeKeywords}
          onToggle={(enableNegativeKeywords) =>
            setSettings({ enableNegativeKeywords })
          }
          onChange={(negativeKeywords) => setSettings({ negativeKeywords })}
          placeholder="comma-separated, e.g. lowres, watermark"
        />
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
          {value} {unit}
        </span>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
    </div>
  );
}

function OptionRow({
  label,
  enabled,
  value,
  onToggle,
  onChange,
  placeholder,
}: {
  label: string;
  enabled: boolean;
  value: string;
  onToggle: (enabled: boolean) => void;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={label} />
      </div>
      {enabled ? (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
        />
      ) : null}
    </div>
  );
}
