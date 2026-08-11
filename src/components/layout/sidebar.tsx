"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Download, Home, LayoutDashboard, Settings, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { Separator } from "@/components/ui/separator"

const mainNav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/app", label: "Dashboard", icon: LayoutDashboard },
];

const toolNav = [
  { href: "/app#generate", label: "Generate", icon: Sparkles },
  { href: "/app#settings", label: "Settings", icon: Settings },
  { href: "/app#history", label: "Export", icon: Download },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-14 items-center border-b px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          Perfect Metadata
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-6 overflow-y-auto p-3">
        <div className="flex flex-col gap-1">
          <p className="px-2 text-xs font-medium text-muted-foreground">Navigation</p>
          {mainNav.map(({ href, label, icon: Icon }) => (
            <NavLink key={href} href={href} active={pathname === href} icon={Icon}>
              {label}
            </NavLink>
          ))}
        </div>

        <Separator />

        <div className="flex flex-col gap-1">
          <p className="px-2 text-xs font-medium text-muted-foreground">Tools</p>
          {toolNav.map(({ href, label, icon: Icon }) => (
            <NavLink key={href} href={href} active={pathname === href} icon={Icon}>
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      <div className="border-t p-4 text-xs text-muted-foreground">
        Perfect Metadata v0.1.0
      </div>
    </aside>
  );
}

function NavLink({
  href,
  active,
  icon: Icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="size-4" />
      {children}
    </Link>
  );
}
