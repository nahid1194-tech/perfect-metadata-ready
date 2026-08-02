"use client"

import { usePathname } from "next/navigation"
import { CircleHelp } from "lucide-react"

import { MobileNav } from "@/components/layout/mobile-nav"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { toast } from "@/store/use-toast-store"

const titles: Record<string, string> = {
  "/": "Home",
  "/app": "Dashboard",
};

export function Header() {
  const pathname = usePathname();
  const title = titles[pathname] ?? "PromptLab";

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur sm:px-4">
      <MobileNav />

      <h1 className="text-sm font-semibold sm:text-base">{title}</h1>

      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Keyboard shortcuts"
          onClick={() =>
            toast(
              "info",
              "Keyboard shortcuts",
              "G Generate · R Retry failed · T Toggle theme · 1 Adobe · 2 Shutterstock · ? Help"
            )
          }
        >
          <CircleHelp />
        </Button>
        <ThemeToggle />
        <Avatar className="size-8">
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            PL
          </AvatarFallback>
        </Avatar>
      </div>
    </header>
  );
}
