import { useState } from 'react';
import { ArrowRight, FileSearch, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AssetIdSearchInputProps {
  input: string;
  onInputChange: (value: string) => void;
  inputError: string | null;
  onSubmit: () => void;
  loading: boolean;
}

export function AssetIdSearchInput({ input, onInputChange, inputError, onSubmit, loading }: AssetIdSearchInputProps) {
  const [touched, setTouched] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    onSubmit();
  };

  return (
    <Card className="border-border/70">
      <CardContent className="p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="assetIdQuery">Asset ID (media ID)</Label>
            <div className="relative">
              <FileSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="assetIdQuery"
                inputMode="numeric"
                value={input}
                onChange={(e) => onInputChange(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="e.g. 300113090"
                autoComplete="off"
                className="pl-9 font-mono"
                aria-invalid={!!inputError && touched}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Look up one asset by its numeric Adobe Stock media ID. Without an API key this opens the matching search on
              Adobe Stock.
            </p>
          </div>
          <Button type="submit" disabled={loading} className="sm:w-auto">
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                Loading…
              </>
            ) : (
              <>
                Look up
                <ArrowRight />
              </>
            )}
          </Button>
        </form>
        {inputError && touched && <p className="mt-2 text-sm text-destructive">{inputError}</p>}
      </CardContent>
    </Card>
  );
}
