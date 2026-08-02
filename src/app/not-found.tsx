import { Home, Search } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Search className="size-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">404 — Page not found</h1>
            <p className="text-sm text-muted-foreground">
              The page you are looking for does not exist or was moved.
            </p>
          </div>
          <Link href="/" className={cn(buttonVariants())}>
            <Home />
            Back home
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
