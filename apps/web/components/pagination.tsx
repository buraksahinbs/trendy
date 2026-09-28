import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

export function Pagination({
  offset,
  limit,
  total,
  onOffset,
}: {
  offset: number;
  limit: number;
  total: number;
  onOffset: (offset: number) => void;
}) {
  if (total === 0) return null;
  const from = offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-sm tabular-nums">
        {formatNumber(from)}–{formatNumber(to)} / {formatNumber(total)}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOffset(Math.max(0, offset - limit))}
          disabled={offset === 0}
        >
          <ChevronLeft /> Önceki
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOffset(offset + limit)}
          disabled={to >= total}
        >
          Sonraki <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
