"use client"

import { useEffect } from "react"
import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAppStore } from "@/store/use-app-store"

export function ThemeToggle() {
  const theme = useAppStore((state) => state.theme)
  const setTheme = useAppStore((state) => state.setTheme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", theme === "dark")
  }, [theme])

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  )
}
