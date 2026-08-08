import { useState } from 'react';
import { ArrowRight, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AssetSearchInputProps {
  input: string;
  onInputChange: (value: string) => void;
  inputError: string | null;
  onSubmit: () => void;
  loading: boolean;
}

export function AssetSearchInput({ input, onInputChange, inputError, onSubmit, loading }: AssetSearchInputProps) {
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
            <Label htmlFor="assetQuery">Asset / Title search</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="assetQuery"
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder="e.g. Isolated Pastel Sticky Note Collection"
                autoComplete="off"
                className="pl-9"
                aria-invalid={!!inputError && touched}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Search Adobe Stock by image title, keyword, or search phrase.
            </p>
          </div>
          <Button type="submit" disabled={loading} className="sm:w-auto">
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                Searching…
              </>
            ) : (
              <>
                Search
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
