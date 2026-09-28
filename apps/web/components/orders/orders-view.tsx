"use client";

import { Download, Loader2, Search, SearchX, ShoppingCart, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { BackfillDialog } from "@/components/orders/backfill-dialog";
import { OrderSheet } from "@/components/orders/order-sheet";
import {
  ORDER_STATUS,
  ORDER_STATUS_ORDER,
  OrderStatusBadge,
  PackageOriginBadge,
} from "@/components/orders/order-status";
import { OwnerOnly } from "@/components/owner-only";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebounced } from "@/hooks/use-debounced";
import type { Order, OrdersQuery } from "@/lib/api";
import { formatDateTime, formatMoney, formatNumber, formatRelative } from "@/lib/format";
import { useOrders, useRole, useSyncOrders } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const RANGES: { value: string; label: string; days: number | null }[] = [
  { value: "bugun", label: "Bugün", days: 0 },
  { value: "7g", label: "Son 7 gün", days: 7 },
  { value: "30g", label: "Son 30 gün", days: 30 },
  { value: "tumu", label: "Tüm zamanlar", days: null },
];

function rangeFrom(value: string): string | undefined {
  const r = RANGES.find((x) => x.value === value);
  if (!r || r.days === null) return undefined;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - r.days);
  return d.toISOString();
}

export function OrdersView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { isOwner } = useRole();
  const syncOrders = useSyncOrders();

  const status = params.get("durum") ?? undefined;
  const range = params.get("aralik") ?? "tumu";
  const offset = Math.max(0, Number(params.get("sayfa") ?? 0) || 0) * PAGE_SIZE;
  const urlSearch = params.get("ara") ?? "";
  const openId = Number(params.get("siparis")) || null;

  const [search, setSearch] = useState(urlSearch);
  const debounced = useDebounced(search.trim(), 350);

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

  useEffect(() => {
    if (debounced !== urlSearch) setParams({ ara: debounced || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const from = useMemo(() => rangeFrom(range), [range]);
  const query: OrdersQuery = {
    status,
    search: urlSearch || undefined,
    from,
    limit: PAGE_SIZE,
    offset,
  };
  const orders = useOrders(query);
  const filtered = Boolean(status || urlSearch || range !== "tumu");

  return (
    <>
      <PageHeader
        title="Siparişler"
        description="Trendyol siparişleri 5 dakikada bir çekilir. Satırlardaki tedarikçi stok kodunu tedarikçinize iletin."
        actions={
          <>
            <BackfillDialog disabled={!isOwner} />
            <OwnerOnly>
              {({ disabled }) => (
                <Button
                  size="sm"
                  disabled={disabled || syncOrders.isPending}
                  onClick={() => syncOrders.mutate()}
                >
                  {syncOrders.isPending ? <Loader2 className="animate-spin" /> : <Download />}
                  Şimdi çek
                </Button>
              )}
            </OwnerOnly>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative sm:w-80">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sipariş no, paket no, barkod, stok kodu"
            className="h-8 pr-8 pl-8"
            aria-label="Sipariş ara"
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
            <SelectTrigger size="sm" className="w-[calc(50%-0.25rem)] sm:w-44" aria-label="Statü">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm statüler</SelectItem>
              {ORDER_STATUS_ORDER.map((s) => (
                <SelectItem key={s} value={s}>
                  {ORDER_STATUS[s]!.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={range}
            onValueChange={(v) => setParams({ aralik: v === "tumu" ? null : v })}
          >
            <SelectTrigger
              size="sm"
              className="w-[calc(50%-0.25rem)] sm:w-40"
              aria-label="Tarih aralığı"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      {orders.isError ? (
        <ErrorState error={orders.error} onRetry={() => void orders.refetch()} />
      ) : orders.isPending ? (
        <div className="bg-card space-y-4 rounded-xl border p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="hidden h-4 w-28 md:block" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-20" />
            </div>
          ))}
        </div>
      ) : orders.data.total === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchX}
            title="Eşleşen sipariş yok"
            description="Filtreleri değiştirerek tekrar deneyin."
          />
        ) : (
          <EmptyState
            icon={ShoppingCart}
            title="Henüz sipariş yok"
            description="Trendyol API bilgileriniz doğrulandıktan sonra siparişler otomatik çekilir ve burada listelenir."
          />
        )
      ) : (
        <div className="space-y-3">
          <OrdersTable
            items={orders.data.items}
            dimmed={orders.isPlaceholderData}
            onOpen={(id) => setParams({ siparis: String(id) }, false)}
          />
          <Pagination
            offset={offset}
            limit={PAGE_SIZE}
            total={orders.data.total}
            onOffset={(o) => setParams({ sayfa: o === 0 ? null : String(o / PAGE_SIZE) }, false)}
          />
        </div>
      )}

      <OrderSheet id={openId} onClose={() => setParams({ siparis: null }, false)} />
    </>
  );
}

function OrdersTable({
  items,
  dimmed,
  onOpen,
}: {
  items: Order[];
  dimmed: boolean;
  onOpen: (id: number) => void;
}) {
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
            <TableHead>Sipariş</TableHead>
            <TableHead className="hidden md:table-cell">Tarih</TableHead>
            <TableHead className="hidden lg:table-cell">Müşteri</TableHead>
            <TableHead className="hidden sm:table-cell">Ürün</TableHead>
            <TableHead className="text-right">Tutar</TableHead>
            <TableHead>Statü</TableHead>
            <TableHead className="hidden xl:table-cell">Kargo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((o) => (
            <TableRow
              key={o.id}
              className="cursor-pointer"
              onClick={() => onOpen(o.id)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(o.id)}
              tabIndex={0}
            >
              <TableCell>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">#{o.orderNumber}</span>
                  {o.channelId === 25 && (
                    <Badge variant="outline" className="font-normal">
                      Luxe
                    </Badge>
                  )}
                  <PackageOriginBadge createdBy={o.createdBy} />
                </div>
                <div className="text-muted-foreground font-mono text-xs">{o.shipmentPackageId}</div>
                <div className="text-muted-foreground text-xs md:hidden">
                  {formatRelative(o.orderDate)}
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="text-sm" title={formatDateTime(o.orderDate)}>
                  {formatRelative(o.orderDate)}
                </div>
                <div className="text-muted-foreground text-xs">{formatDateTime(o.orderDate)}</div>
              </TableCell>
              <TableCell className="hidden max-w-[12rem] truncate lg:table-cell">
                {o.customerName ?? <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="text-muted-foreground hidden sm:table-cell">
                {formatNumber(o.lineCount)} satır · {formatNumber(o.itemCount)} adet
              </TableCell>
              <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                {formatMoney(o.packageTotalPrice, o.currency ?? "TRY")}
              </TableCell>
              <TableCell>
                <OrderStatusBadge status={o.status} />
              </TableCell>
              <TableCell className="hidden xl:table-cell">
                <div className="text-sm">{o.cargoProviderName ?? "—"}</div>
                {o.cargoTrackingNumber && (
                  <div className="text-muted-foreground font-mono text-xs">
                    {o.cargoTrackingNumber}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
