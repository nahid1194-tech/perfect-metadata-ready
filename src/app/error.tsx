"use client"

import { useEffect } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="size-6 text-destructive" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">
              {error.message || "An unexpected error occurred."}
            </p>
          </div>
          <Button onClick={reset}>
            <RotateCcw />
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
