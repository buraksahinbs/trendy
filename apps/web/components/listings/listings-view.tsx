"use client";

import {
  AlertCircle,
  ChevronDown,
  Lock,
  PackageSearch,
  RefreshCw,
  Search,
  SearchX,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import {
  LISTING_STATUS,
  LISTING_STATUS_ORDER,
  ListingStatusBadge,
  rejectReasonLines,
} from "@/components/listings/listing-status";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebounced } from "@/hooks/use-debounced";
import type { Listing, ListingStatus, ListingsQuery } from "@/lib/api";
import { formatDateTime, formatMoney, formatNumber, formatRelative } from "@/lib/format";
import { useListings, useTrendyolStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

export function ListingsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const status = (params.get("durum") ?? undefined) as ListingStatus | undefined;
  const hasError = params.get("hata") === "1" ? true : undefined;
  const scope = params.get("kapsam");
  const managed = scope === "senkron" ? true : scope === "feed-disi" ? false : undefined;
  const offset = Math.max(0, Number(params.get("sayfa") ?? 0) || 0) * PAGE_SIZE;
  const urlSearch = params.get("ara") ?? "";

  const [search, setSearch] = useState(urlSearch);
  const debouncedSearch = useDebounced(search.trim(), 350);

  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete("sayfa");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Arama kutusu URL'yi gecikmeli günceller
  useEffect(() => {
    if (debouncedSearch !== urlSearch) setParams({ ara: debouncedSearch || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query: ListingsQuery = {
    status,
    hasError,
    managed,
    search: urlSearch || undefined,
    limit: PAGE_SIZE,
    offset,
  };
  const listings = useListings(query);
  const trendyol = useTrendyolStatus();
  const filtered = Boolean(status || hasError || scope || urlSearch);

  return (
    <>
      <PageHeader
        title="Ürünler"
        description="Tedarikçi feed'lerinden gelen varyantlar ve Trendyol'daki karşılıkları."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void listings.refetch()}
            disabled={listings.isFetching}
          >
            <RefreshCw className={listings.isFetching ? "animate-spin" : undefined} />
            Yenile
          </Button>
        }
      />

      {trendyol.data && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <StatusChip label="Tümü" active={!status} onClick={() => setParams({ durum: null })} />
          {LISTING_STATUS_ORDER.filter((s) => (trendyol.data.listings[s] ?? 0) > 0).map((s) => (
            <StatusChip
              key={s}
              label={LISTING_STATUS[s].label}
              count={trendyol.data.listings[s] ?? 0}
              active={status === s}
              onClick={() => setParams({ durum: status === s ? null : s })}
            />
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative sm:w-80">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Barkod, başlık veya model kodu"
            className="h-8 pr-8 pl-8"
            aria-label="Ürün ara"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
              aria-label="Aramayı temizle"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={status ?? "all"}
            onValueChange={(v) => setParams({ durum: v === "all" ? null : v })}
          >
            <SelectTrigger
              size="sm"
              className="w-[calc(50%-0.25rem)] sm:w-44"
              aria-label="Trendyol durumu"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm durumlar</SelectItem>
              {LISTING_STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {LISTING_STATUS[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={scope ?? "all"}
            onValueChange={(v) => setParams({ kapsam: v === "all" ? null : v })}
          >
            <SelectTrigger
              size="sm"
              className="w-[calc(50%-0.25rem)] sm:w-48"
              aria-label="Senkron kapsamı"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm varyantlar</SelectItem>
              <SelectItem value="senkron">Senkronlananlar</SelectItem>
              <SelectItem value="feed-disi">Feed dışı olanlar</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex h-8 items-center gap-2 rounded-md border px-3 text-sm">
            <Switch
              checked={hasError ?? false}
              onCheckedChange={(v) => setParams({ hata: v ? "1" : null })}
              className="scale-90"
            />
            Yalnızca hatalılar
          </label>
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                router.replace(pathname, { scroll: false });
              }}
            >
              <X /> Filtreleri temizle
            </Button>
          )}
        </div>
      </div>

      {listings.isError ? (
        <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />
      ) : listings.isPending ? (
        <ListingsSkeleton />
      ) : listings.data.total === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="Eşleşen ürün yok"
            description="Filtreleri değiştirerek tekrar deneyin."
          />
        ) : (
          <EmptyState
            icon={PackageSearch}
            title="Henüz ürün yok"
            description="Tedarikçi eklenip alan eşleştirmesi yapıldığında ve Trendyol ürünleriniz içe aktarıldığında varyantlar burada görünür."
          />
        )
      ) : (
        <div className="space-y-3">
          <ListingsTable items={listings.data.items} dimmed={listings.isPlaceholderData} />
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            total={listings.data.total}
            onOffset={(o) => setParams({ sayfa: o === 0 ? null : String(o / PAGE_SIZE) }, false)}
          />
        </div>
      )}
    </>
  );
}

function StatusChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "hover:bg-muted inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
        active && "bg-foreground text-background hover:bg-foreground/90 border-transparent",
      )}
    >
      {label}
      {count !== undefined && (
        <span className={cn("tabular-nums", active ? "opacity-70" : "text-muted-foreground")}>
          {formatNumber(count)}
        </span>
      )}
    </button>
  );
}

function ListingsTable({ items, dimmed }: { items: Listing[]; dimmed: boolean }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div
      className={cn(
        "bg-card overflow-hidden rounded-xl border transition-opacity",
        dimmed && "opacity-60",
      )}
    >
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead>Ürün</TableHead>
            <TableHead className="hidden md:table-cell">Barkod</TableHead>
            <TableHead>Durum</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Stok</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Fiyat</TableHead>
            <TableHead className="hidden text-right xl:table-cell">Maliyet</TableHead>
            <TableHead className="hidden lg:table-cell">Son gönderim</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((l) => {
            const reasons = rejectReasonLines(l.rejectReasons);
            const hasDetail = Boolean(l.lastError || reasons.length || l.lockReason);
            const open = expanded === l.variantId;
            return (
              <Fragment key={l.variantId}>
                <TableRow
                  className={cn(hasDetail && "cursor-pointer", open && "bg-muted/30")}
                  onClick={hasDetail ? () => setExpanded(open ? null : l.variantId) : undefined}
                >
                  <TableCell className="max-w-[18rem] whitespace-normal">
                    <div className="flex items-start gap-2">
                      {l.lastError && (
                        <AlertCircle
                          className="text-destructive mt-0.5 size-4 shrink-0"
                          aria-label="Hata var"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-sm font-medium">
                          {l.title ?? <span className="text-muted-foreground">Başlıksız</span>}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {[l.brandName, l.productMainId].filter(Boolean).join(" · ")}
                        </div>
                        <div className="text-muted-foreground font-mono text-xs md:hidden">
                          {l.barcode}
                        </div>
                        <div className="mt-1 text-xs tabular-nums sm:hidden">
                          Stok <span className="font-medium">{formatNumber(l.stock)}</span>
                          {l.tyPrice !== null && (
                            <>
                              {" · "}
                              <span className="font-medium">{formatMoney(l.tyPrice)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="font-mono text-xs">{l.barcode}</div>
                    {l.stockCode && (
                      <div className="text-muted-foreground font-mono text-xs">{l.stockCode}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <ListingStatusBadge status={l.tyStatus} />
                      {!l.managed && (
                        <Badge variant="outline" className="text-muted-foreground font-normal">
                          Feed dışı (senkronlanmaz)
                        </Badge>
                      )}
                      {l.tyStatus === "approved" && l.tyOnSale === false && (
                        <span className="text-muted-foreground text-xs">Satışa kapalı</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    <div className="font-medium">{formatNumber(l.stock)}</div>
                    {l.tyStock !== null && l.tyStock !== l.stock && (
                      <div className="text-muted-foreground text-xs" title="Trendyol'daki stok">
                        TY: {formatNumber(l.tyStock)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    <div className="font-medium">{formatMoney(l.tyPrice)}</div>
                    {l.tyListPrice !== null && l.tyListPrice !== l.tyPrice && (
                      <div className="text-muted-foreground text-xs line-through">
                        {formatMoney(l.tyListPrice)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-right tabular-nums xl:table-cell">
                    {formatMoney(l.costPrice, l.currency)}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {l.lastSentAt ? (
                      <div title={formatDateTime(l.lastSentAt)}>
                        <div className="text-sm">{formatRelative(l.lastSentAt)}</div>
                        <div className="text-muted-foreground text-xs tabular-nums">
                          {[
                            l.lastSentStock !== null && `${formatNumber(l.lastSentStock)} adet`,
                            l.lastSentPrice !== null && formatMoney(l.lastSentPrice),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">Gönderilmedi</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {hasDetail && (
                      <ChevronDown
                        className={cn(
                          "text-muted-foreground size-4 transition-transform",
                          open && "rotate-180",
                        )}
                      />
                    )}
                  </TableCell>
                </TableRow>
                {open && (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={8} className="whitespace-normal">
                      <div className="space-y-3 py-1">
                        {l.lastError && (
                          <DetailBlock title="Son hata" tone="danger">
                            {l.lastError}
                          </DetailBlock>
                        )}
                        {reasons.length > 0 && (
                          <DetailBlock title="Trendyol red nedenleri" tone="danger">
                            <ul className="list-disc space-y-1 pl-4">
                              {reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          </DetailBlock>
                        )}
                        {l.lockReason && (
                          <DetailBlock title="Kilit nedeni" tone="warning">
                            <span className="inline-flex items-center gap-1.5">
                              <Lock className="size-3.5" /> {l.lockReason}
                            </span>
                          </DetailBlock>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function DetailBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "danger" | "warning";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-muted-foreground mb-1 text-xs font-medium">{title}</div>
      <div
        className={cn(
          "rounded-md border p-3 text-sm",
          tone === "danger"
            ? "border-destructive/30 bg-destructive/5 text-destructive"
            : "border-warning/40 bg-warning/10 dark:text-warning text-amber-800",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function ListingsSkeleton() {
  return (
    <div className="bg-card space-y-4 rounded-xl border p-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="hidden h-4 w-28 md:block" />
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="hidden h-4 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}
