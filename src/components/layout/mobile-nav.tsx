"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Download,
  Home,
  LayoutDashboard,
  Menu,
  Settings,
  Sparkles,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"

const links = [
  { href: "/", label: "Home", icon: Home },
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
  { href: "/app#generate", label: "Generate", icon: Sparkles },
  { href: "/app#settings", label: "Settings", icon: Settings },
  { href: "/app#history", label: "Export", icon: Download },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-background/70 backdrop-blur-sm animate-in fade-in-0"
          />
          <div className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-card animate-in slide-in-from-left duration-200">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <span className="font-semibold">PromptLab</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close navigation"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 p-3">
              {links.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                    pathname === href
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </Link>
              ))}
            </nav>
            <div className="border-t p-4 text-xs text-muted-foreground">
              PromptLab v0.1.0
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
