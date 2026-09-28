"use client";

import { AlertTriangle, ClipboardCopy, Lock, MapPin, Package, Truck } from "lucide-react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import {
  channelLabel,
  OrderStatusBadge,
  orderStatusLabel,
  PackageOriginBadge,
} from "@/components/orders/order-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrderAddress, OrderDetail, OrderLine } from "@/lib/api";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { useOrder, useRole } from "@/lib/queries";

export function OrderSheet({ id, onClose }: { id: number | null; onClose: () => void }) {
  const order = useOrder(id);
  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {order.data ? `Sipariş #${order.data.orderNumber}` : "Sipariş"}
            {order.data && <OrderStatusBadge status={order.data.status} />}
          </SheetTitle>
          <SheetDescription>
            {order.data
              ? `${formatDateTime(order.data.orderDate)} · Paket ${order.data.shipmentPackageId}`
              : "Yükleniyor…"}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {order.isError ? (
            <ErrorState error={order.error} onRetry={() => void order.refetch()} />
          ) : order.isPending ? (
            <div className="space-y-4">
              <Skeleton className="h-24 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
            </div>
          ) : (
            <OrderBody order={order.data} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function supplierText(order: OrderDetail) {
  return order.lines
    .map(
      (l) =>
        `${l.supplierStockCode ?? l.stockCode ?? l.barcode ?? "?"} × ${l.quantity}${l.productName ? ` — ${l.productName}` : ""}`,
    )
    .join("\n");
}

function OrderBody({ order }: { order: OrderDetail }) {
  const { isOwner } = useRole();
  const unmatched = order.lines.filter((l) => l.variantId === null).length;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `Sipariş ${order.orderNumber} (paket ${order.shipmentPackageId})\n${supplierText(order)}`,
      );
      toast.success("Tedarikçi listesi kopyalandı");
    } catch {
      toast.error("Kopyalanamadı");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1.5">
        <PackageOriginBadge createdBy={order.createdBy} />
        {order.channelId === 25 && <Badge variant="outline">Luxe</Badge>}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Info label="Tutar" value={formatMoney(order.packageTotalPrice, order.currency ?? "TRY")} />
        <Info label="Statü" value={orderStatusLabel(order.status)} />
        <Info label="Kanal" value={channelLabel(order.channelId) ?? "—"} />
        <Info label="Son güncelleme" value={formatDateTime(order.lastModifiedAt)} />
        <Info
          label="Kargo"
          value={order.cargoProviderName ?? "—"}
          icon={<Truck className="size-3.5" />}
        />
        <Info label="Takip no" value={order.cargoTrackingNumber ?? "—"} mono />
      </dl>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Package className="text-muted-foreground size-4" />
            Ürünler
            <span className="text-muted-foreground font-normal">({order.lines.length})</span>
          </h3>
          <Button variant="outline" size="sm" onClick={copy}>
            <ClipboardCopy /> Tedarikçi için kopyala
          </Button>
        </div>
        {unmatched > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {unmatched} satırın barkodu katalogda bulunamadı; tedarikçi stok kodu gösterilemiyor.
          </p>
        )}
        <ul className="space-y-2">
          {order.lines.map((l) => (
            <LineCard key={l.lineId} line={l} currency={order.currency ?? "TRY"} />
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="text-muted-foreground size-4" />
          Adresler
        </h3>
        {isOwner && ("shipmentAddress" in order || "invoiceAddress" in order) ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <AddressCard title="Teslimat" address={order.shipmentAddress ?? null} />
            <AddressCard title="Fatura" address={order.invoiceAddress ?? null} />
          </div>
        ) : (
          <p className="text-muted-foreground flex items-center gap-2 rounded-md border border-dashed px-3 py-3 text-xs">
            <Lock className="size-3.5" />
            Adres bilgisi yalnızca mağaza sahibine gösterilir.
          </p>
        )}
      </section>
    </div>
  );
}

function LineCard({ line: l, currency }: { line: OrderLine; currency: string }) {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="line-clamp-2 text-sm font-medium">
            {l.productName ?? <span className="text-muted-foreground">Ürün adı yok</span>}
          </div>
          <div className="text-muted-foreground mt-0.5 font-mono text-xs">
            {l.barcode ?? "—"}
            {l.stockCode && ` · ${l.stockCode}`}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums">× {formatNumber(l.quantity)}</div>
          <div className="text-muted-foreground text-xs tabular-nums">
            {formatMoney(l.lineUnitPrice, currency)}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {l.supplierStockCode ? (
          <span className="bg-brand/10 text-brand border-brand/25 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
            Tedarikçi stok kodu
            <span className="font-mono font-semibold">{l.supplierStockCode}</span>
          </span>
        ) : (
          <span className="text-muted-foreground rounded-md border border-dashed px-2 py-1 text-xs">
            {l.variantId === null ? "Katalogda eşleşmedi" : "Tedarikçi stok kodu yok"}
          </span>
        )}
        {l.lineStatus && (
          <span className="text-muted-foreground text-xs">{orderStatusLabel(l.lineStatus)}</span>
        )}
        <span className="text-muted-foreground ml-auto text-xs tabular-nums">
          {[
            l.commissionRate !== null && `Komisyon %${String(l.commissionRate).replace(".", ",")}`,
            l.vatRate !== null && `KDV %${l.vatRate}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </li>
  );
}

function Info({
  label,
  value,
  mono,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground flex items-center gap-1 text-xs">
        {icon}
        {label}
      </dt>
      <dd className={mono ? "truncate font-mono text-xs" : "truncate"}>{value}</dd>
    </div>
  );
}

function AddressCard({ title, address }: { title: string; address: OrderAddress | null }) {
  return (
    <div className="bg-muted/30 rounded-lg border p-3 text-sm">
      <div className="text-muted-foreground mb-1 text-xs font-medium">{title}</div>
      {address ? (
        <div className="space-y-0.5">
          {address.fullName && <div className="font-medium">{address.fullName}</div>}
          {address.fullAddress && (
            <div className="text-muted-foreground">{address.fullAddress}</div>
          )}
          {(address.district || address.city) && (
            <div className="text-muted-foreground">
              {[address.district, address.city].filter(Boolean).join(" / ")}
            </div>
          )}
          {address.phone && (
            <div className="text-muted-foreground font-mono text-xs">{address.phone}</div>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground">—</div>
      )}
    </div>
  );
}
