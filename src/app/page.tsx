import Link from "next/link";
import { ArrowRight, FileSpreadsheet, ImagePlus, WandSparkles } from "lucide-react";

import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const features = [
  {
    icon: ImagePlus,
    title: "Upload any image",
    description:
      "Drag and drop an image and the engine reads it instantly — no server upload needed.",
  },
  {
    icon: WandSparkles,
    title: "Generate metadata",
    description:
      "Get titles, descriptions, tags, and categories for Adobe Stock and Shutterstock in one click.",
  },
  {
    icon: FileSpreadsheet,
    title: "Export to CSV",
    description:
      "Download your results as a CSV spreadsheet formatted for Adobe Stock or Shutterstock.",
  },
];

export default function Home() {
  return (
    <AppLayout>
      <section className="flex flex-col gap-10 py-8 sm:py-14">
        <div className="flex max-w-2xl flex-col items-start gap-4">
          <Badge variant="secondary">Image metadata studio</Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Turn images into{" "}
            <span className="text-primary">stock metadata</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            Perfect Metadata analyzes your images and generates structured metadata
            for Adobe Stock and Shutterstock. Everything runs in your browser.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button size="lg" render={<Link href="/app" />}>
              Open dashboard
              <ArrowRight />
            </Button>
            <Button variant="outline" size="lg" render={<Link href="/app#settings" />}>
              Configure API key
            </Button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, description }) => (
            <Card key={title}>
              <CardHeader>
                <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" />
                </div>
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>How it works</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-3 text-sm text-muted-foreground">
              <li>
                <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                  1
                </span>
                Upload an image on the dashboard.
              </li>
              <li>
                <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                  2
                </span>
                Optionally add an API key for AI-generated metadata, or use the
                on-device engine.
              </li>
              <li>
                <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
                  3
                </span>
                Edit the metadata and export everything as a CSV file.
              </li>
            </ol>
          </CardContent>
        </Card>
      </section>
    </AppLayout>
  );
}
