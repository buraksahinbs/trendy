"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Download, Loader2, RefreshCcw } from "lucide-react";
import Link from "next/link";

import { ErrorState } from "@/components/error-state";
import { LISTING_STATUS, LISTING_STATUS_ORDER } from "@/components/listings/listing-status";
import { OwnerOnly } from "@/components/owner-only";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ListingStatus, TrendyolStatus } from "@/lib/api";
import { formatNumber, formatRelative } from "@/lib/format";
import { useTriggerTrendyol } from "@/lib/queries";
import { cn } from "@/lib/utils";

const BAR_COLOR: Record<ListingStatus, string> = {
  approved: "bg-success",
  pending: "bg-sky-500",
  rejected: "bg-destructive",
  locked: "bg-warning",
  archived: "bg-zinc-400 dark:bg-zinc-600",
  blacklisted: "bg-rose-800",
  unknown: "bg-zinc-300 dark:bg-zinc-700",
};

export function TrendyolCard({ status }: { status: UseQueryResult<TrendyolStatus> }) {
  const sync = useTriggerTrendyol("sync");
  const importer = useTriggerTrendyol("import");
  const st = status.data;
  const last = st?.lastSync;

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>Trendyol senkronu</CardTitle>
        <CardDescription>
          {!st
            ? "Stok ve fiyatlar 15 dakikada bir ve feed değişince gönderilir."
            : st.syncPaused
              ? "Acil durdurma açık: stok ve fiyat gönderilmiyor."
              : last
                ? `Son senkron ${formatRelative(last.finishedAt ?? last.startedAt)} · ${formatNumber(st.managedVariants)} varyant takipte`
                : "Henüz senkron çalışmadı."}
        </CardDescription>
        <CardAction className="flex gap-1">
          <OwnerOnly>
            {({ disabled }) => (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled || importer.isPending}
                onClick={() => importer.mutate()}
                className="hidden sm:inline-flex"
                title="Trendyol'daki ürün listenizi yeniden çek"
              >
                {importer.isPending ? <Loader2 className="animate-spin" /> : <Download />}
                İçe aktar
              </Button>
            )}
          </OwnerOnly>
          <OwnerOnly>
            {({ disabled }) => (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || sync.isPending || st?.syncPaused}
                onClick={() => sync.mutate()}
              >
                {sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
                Şimdi senkronla
              </Button>
            )}
          </OwnerOnly>
        </CardAction>
      </CardHeader>
      <CardContent>
        {status.isError ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} className="py-8" />
        ) : status.isPending ? (
          <div className="space-y-4">
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <TrendyolBody status={status.data} />
        )}
      </CardContent>
    </Card>
  );
}

/** Dikkat gerektiren durumlar; Genel Bakış'taki sayı da buradan hesaplanır. */
export function attentionItems(st: TrendyolStatus) {
  const items: {
    key: string;
    count: number;
    text: string;
    href: string;
    tone: "warning" | "danger";
  }[] = [];
  const add = (
    key: string,
    count: number,
    text: string,
    href: string,
    tone: "warning" | "danger",
  ) => {
    if (count > 0) items.push({ key, count, text, href, tone });
  };
  add(
    "reviews",
    st.pendingReviews,
    "fiyat değişikliği onayınızı bekliyor",
    "/fiyat-onaylari",
    "warning",
  );
  add("errors", st.listingErrors, "üründe gönderim hatası var", "/urunler?hata=1", "danger");
  add(
    "locked",
    st.listings.locked ?? 0,
    "ürün Trendyol tarafından kilitlendi",
    "/urunler?durum=locked",
    "warning",
  );
  add(
    "rejected",
    st.listings.rejected ?? 0,
    "ürün reddedildi",
    "/urunler?durum=rejected",
    "danger",
  );
  return items;
}

function TrendyolBody({ status }: { status: TrendyolStatus }) {
  const entries = LISTING_STATUS_ORDER.map((s) => [s, status.listings[s] ?? 0] as const).filter(
    ([, n]) => n > 0,
  );
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const attention = attentionItems(status);
  const failed = status.lastSync?.status === "failed" ? status.lastSync : null;

  if (total === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-5 text-center text-sm">
        Trendyol ürünleriniz henüz içe aktarılmadı. API bilgilerinizi doğruladığınızda içe aktarma
        otomatik başlar.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="bg-muted flex h-2 gap-px overflow-hidden rounded-full">
          {entries.map(([s, n]) => (
            <div
              key={s}
              className={cn("h-full", BAR_COLOR[s])}
              style={{ width: `${Math.max(1.5, (n / total) * 100)}%` }}
              title={`${LISTING_STATUS[s].label}: ${formatNumber(n)}`}
            />
          ))}
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {entries.map(([s, n]) => (
            <Link
              key={s}
              href={`/urunler?durum=${s}`}
              className="hover:text-foreground flex items-center gap-1.5"
            >
              <span className={cn("size-1.5 rounded-full", BAR_COLOR[s])} />
              {LISTING_STATUS[s].label} <span className="tabular-nums">{formatNumber(n)}</span>
            </Link>
          ))}
        </div>
      </div>

      {failed && (
        <p className="text-destructive text-sm">
          Son senkron başarısız oldu ({formatRelative(failed.startedAt)}): {failed.error}
        </p>
      )}

      {attention.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CheckCircle2 className="text-success size-4" />
          Her şey yolunda; bekleyen bir işiniz yok.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {attention.map((a) => (
            <li key={a.key}>
              <Link
                href={a.href}
                className="hover:bg-muted/50 flex items-center gap-3 px-3 py-2.5 text-sm transition-colors"
              >
                <span
                  className={cn(
                    "size-1.5 shrink-0 rounded-full",
                    a.tone === "danger" ? "bg-destructive" : "bg-warning",
                  )}
                />
                <span className="flex-1">
                  <span className="font-medium tabular-nums">{formatNumber(a.count)}</span> {a.text}
                </span>
                <ArrowRight className="text-muted-foreground size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {status.pendingBatches > 0 && (
        <p className="text-muted-foreground text-xs">
          {formatNumber(status.pendingBatches)} gönderimin sonucu Trendyol&apos;dan bekleniyor.
        </p>
      )}
    </div>
  );
}
