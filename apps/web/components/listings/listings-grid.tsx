"use client";

import { AlertCircle } from "lucide-react";

import { ListingStatusBadge, rejectReasonLines } from "@/components/listings/listing-status";
import { ProductThumb } from "@/components/listings/product-thumb";
import { Badge } from "@/components/ui/badge";
import type { Listing } from "@/lib/api";
import { formatMoney, formatNumber, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Kart görünümü: ürünü görselinden tanımak için. Ayrıntılı işlemler tablo görünümündedir. */
export function ListingsGrid({ items, dimmed }: { items: Listing[]; dimmed: boolean }) {
  return (
    <ul
      className={cn(
        "grid grid-cols-2 gap-3 transition-opacity sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6",
        dimmed && "opacity-60",
      )}
    >
      {items.map((l) => (
        <ListingCard key={l.variantId} listing={l} />
      ))}
    </ul>
  );
}

function ListingCard({ listing: l }: { listing: Listing }) {
  const issue = l.lastError ?? l.lockReason ?? rejectReasonLines(l.rejectReasons)[0] ?? null;
  const attrs = Object.values(l.attributes ?? {}).filter(Boolean);
  const outOfStock = l.managed && l.stock === 0;
  return (
    <li className="bg-card group flex flex-col overflow-hidden rounded-xl border">
      <div className="relative">
        {/* Trendyol görsel oranı 1200x1800 (2:3) */}
        <ProductThumb
          src={l.imageUrl}
          alt={l.title ?? l.barcode}
          className="aspect-[2/3] w-full"
          iconClassName="size-8"
        />
        <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
          <ListingStatusBadge status={l.tyStatus} />
          {!l.managed && (
            <Badge variant="outline" className="bg-background/90 font-normal backdrop-blur">
              Feed dışı
            </Badge>
          )}
        </div>
        {outOfStock && (
          <div className="bg-background/85 absolute inset-x-0 bottom-0 py-1 text-center text-xs font-medium backdrop-blur">
            Stokta yok
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm leading-snug font-medium" title={l.title ?? ""}>
            {l.title ?? <span className="text-muted-foreground">Başlıksız</span>}
          </div>
          {attrs.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {attrs.map((v) => (
                <span
                  key={v}
                  className="bg-muted text-foreground/80 rounded px-1.5 py-px text-[11px] font-medium"
                >
                  {v}
                </span>
              ))}
            </div>
          )}
          <div className="text-muted-foreground mt-1 truncate text-xs">
            {l.brandName && <>{l.brandName} · </>}
            <span className="font-mono">{l.barcode}</span>
          </div>
        </div>

        {issue && (
          <p className="text-destructive flex items-start gap-1 text-xs leading-snug" title={issue}>
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            <span className="line-clamp-2">{issue}</span>
          </p>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 border-t pt-2">
          <div className="tabular-nums">
            <div className="text-muted-foreground text-[11px]">Stok</div>
            <div className="text-sm font-medium">{formatNumber(l.stock)}</div>
            {l.tyStock !== null && l.tyStock !== l.stock && (
              <div className="text-muted-foreground text-[11px]">
                Trendyol&apos;da {formatNumber(l.tyStock)}
              </div>
            )}
          </div>
          <div className="text-right tabular-nums">
            {l.tyListPrice !== null && l.tyListPrice !== l.tyPrice && (
              <div className="text-muted-foreground text-[11px] line-through">
                {formatMoney(l.tyListPrice)}
              </div>
            )}
            <div className="text-sm font-semibold">{formatMoney(l.tyPrice)}</div>
          </div>
        </div>
        <div className="text-muted-foreground text-[11px]">
          {l.lastSentAt ? `Son gönderim ${formatRelative(l.lastSentAt)}` : "Henüz gönderilmedi"}
        </div>
      </div>
    </li>
  );
}
