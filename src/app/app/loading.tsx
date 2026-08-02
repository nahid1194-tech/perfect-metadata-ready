import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="lg:pl-[360px]">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
          <Skeleton className="h-16 w-full rounded-[20px]" />
          <Skeleton className="h-56 w-full rounded-[20px]" />
          <Skeleton className="h-14 w-full rounded-[20px]" />
          <Skeleton className="h-36 w-full rounded-[20px]" />
          <Skeleton className="h-36 w-full rounded-[20px]" />
        </div>
      </div>
    </div>
  );
}
