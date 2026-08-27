import { Skeleton } from "@/components/ui/skeleton";

export function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        // Shaped like CardShowcaseTile so the grid doesn't jump when the real
        // data lands: same hero ratio, the same p-3 stack, a next-fee row and
        // the 4px accent bar the tile paints once colour extraction resolves.
        <div key={i} className="bg-card rounded-xl border shadow-sm overflow-hidden">
          <Skeleton className="aspect-[1.586/1] rounded-none" />
          <div className="p-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            {/* Badge is rounded-md and ~22px tall, not a 20px pill. */}
            <div className="flex gap-1.5">
              <Skeleton className="h-[22px] w-12 rounded-md" />
              <Skeleton className="h-[22px] w-16 rounded-md" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
            <Skeleton className="h-4 w-2/5" />
          </div>
          <Skeleton className="h-1 rounded-none" />
        </div>
      ))}
      <span role="status" className="sr-only">Loading cards…</span>
    </div>
  );
}
