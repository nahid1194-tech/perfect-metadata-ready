"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { Menu, X } from "lucide-react"

import { ensureModelCache } from "@/lib/models"
import { ControlCard } from "@/components/dashboard/control-card"
import { ExportSection } from "@/components/dashboard/export-section"
import { ImageUpload } from "@/components/dashboard/image-upload"
import { MetadataSettings } from "@/components/dashboard/metadata-settings"
import { ResultsSection } from "@/components/dashboard/results-section"
import { ContentCheckPanel } from "@/components/dashboard/content-check-panel"
import { UploadToolbar } from "@/components/dashboard/upload-toolbar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useGenerate } from "@/hooks/use-generate"
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts"
import { useAppStore } from "@/store/use-app-store"
import { toast } from "@/store/use-toast-store"

export function DashboardShell() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const setPlatform = useAppStore((state) => state.setSettings);
  const { run, pause, resume, stop, generating, queueState } = useGenerate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const images = useAppStore((state) => state.images);
  const results = useAppStore((state) => state.results);
  const setActiveImageId = useAppStore((state) => state.setActiveImageId);
  const setRiskFilter = useAppStore((state) => state.setRiskFilter);

  const handleFocusImage = (imageId: string) => {
    if (imageId) {
      setRiskFilter("ALL");
      setActiveImageId(imageId);
      return;
    }
    const state = useAppStore.getState();
    const firstFlagged = state.results.find(
      (result) =>
        state.scannedImageIds.includes(result.imageId) &&
        (result.metadata.contentCheck.issues.length > 0 ||
          (state.scanIssues[result.imageId]?.length ?? 0) > 0)
    );
    if (firstFlagged) {
      setRiskFilter("ALL");
      setActiveImageId(firstFlagged.imageId);
    }
  };

  useEffect(() => {
    void ensureModelCache();
  }, []);

  useKeyboardShortcuts({
    onGenerate: () => run(),
    onRetry: () => {
      const failed = useAppStore.getState().failedImageIds;
      if (failed.length > 0) run({ retryFailed: true });
    },
    onPauseResume: () => {
      if (queueState === "running") pause();
      else if (queueState === "paused") resume();
    },
    onStop: () => {
      if (generating) stop();
    },
    onToggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    onSetMode: (mode) => setPlatform({ platform: mode }),
    onHelp: () =>
      toast(
        "info",
        "Keyboard shortcuts",
        "G Generate · P Pause/Resume · S Stop · R Retry failed · T Toggle theme · 1/2 Adobe/Shutterstock · ? Help"
      ),
  });

  const settings = (
    <>
      <ControlCard />
      <div className="my-6 h-px bg-border" />
      <ExportSection />
      <div className="my-6 h-px bg-border" />
      <MetadataSettings />
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[320px] flex-col overflow-y-auto border-r bg-sidebar px-5 py-6 lg:flex xl:w-[360px]">
        {settings}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-4 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(true)}
          aria-label="Open settings"
        >
          <Menu />
        </Button>
        <span className="font-semibold tracking-tight">Perfect Metadata</span>
      </header>

      <AnimatePresence>
        {mobileOpen ? (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-40 w-[340px] overflow-y-auto border-r bg-card p-5 lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            >
              <div className="mb-4 flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close settings"
                >
                  <X />
                </Button>
              </div>
              {settings}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>

      <div className="lg:pl-[320px] xl:pl-[360px]">
        <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
          <Card className="rounded-[20px] shadow-sm">
            <CardHeader className="border-b pb-3">
              <CardTitle>Upload Images</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <ImageUpload />
            </CardContent>
          </Card>

          <UploadToolbar />

          <ContentCheckPanel
            images={images}
            results={results}
            onFocusImage={handleFocusImage}
          />

          <ResultsSection />
        </main>
      </div>
    </div>
  );
}
