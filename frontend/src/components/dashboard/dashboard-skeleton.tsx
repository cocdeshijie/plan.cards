import { Skeleton } from "@/components/ui/skeleton";

/**
 * Mirrors the summary grid in src/app/summary/page.tsx: Alerts and 5/24 share a
 * row at lg, then Portfolio and Credits each span both columns. Keep the count
 * and the span rule in step with that file — rendering three boxes for four
 * widgets made a whole full-width panel pop into existence on first paint.
 */
export function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading summary"
      className="grid grid-cols-1 lg:grid-cols-2 gap-6"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className={`bg-card rounded-xl border p-5 space-y-4 ${i >= 2 ? "lg:col-span-2" : ""}`}
        >
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-5 w-32" />
          </div>
          {i === 2 ? (
            // Portfolio Overview: four centred stat tiles.
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((__, j) => (
                <div key={j} className="flex flex-col items-center space-y-1">
                  <Skeleton className="h-5 w-5 rounded" />
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))}
            </div>
          ) : i === 3 ? (
            // Credits & Benefits: dashed benefit tiles. The real widget's grid
            // is `grid-cols-1 lg:grid-cols-2` (credits-widget.tsx:677), so the
            // second column has to appear at the same breakpoint or the
            // placeholder reflows in the opposite direction to the thing it
            // stands in for.
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {Array.from({ length: 2 }).map((__, j) => (
                <Skeleton key={j} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
