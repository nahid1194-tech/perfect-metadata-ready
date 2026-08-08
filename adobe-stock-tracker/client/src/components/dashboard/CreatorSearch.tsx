import { useState } from 'react';
import { ArrowRight, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface CreatorSearchProps {
  input: string;
  onInputChange: (value: string) => void;
  inputError: string | null;
  onSubmit: () => void;
  loading: boolean;
}

export function CreatorSearch({ input, onInputChange, inputError, onSubmit, loading }: CreatorSearchProps) {
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
            <Label htmlFor="creatorId">Adobe Stock Creator ID</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="creatorId"
                value={input}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder="e.g. 214711383"
                autoComplete="off"
                inputMode="numeric"
                className="pl-9"
                aria-invalid={!!inputError && touched}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the numeric contributor ID shown in the Adobe Stock contributor profile URL.
            </p>
          </div>
          <Button type="submit" disabled={loading} className="sm:w-auto">
            {loading ? (
              <>
                <Loader2 className="animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                Analyze
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
