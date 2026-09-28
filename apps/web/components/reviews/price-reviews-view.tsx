"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, CheckCheck, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { OwnerOnly } from "@/components/owner-only";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PriceReview, ReviewStatus } from "@/lib/api";
import { formatChangeRate, formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { useDecideReview, usePriceReviews, useSettings, useTrendyolStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TABS: { value: ReviewStatus; label: string; param: string }[] = [
  { value: "pending", label: "Bekleyen", param: "bekleyen" },
  { value: "approved", label: "Onaylanan", param: "onaylanan" },
  { value: "rejected", label: "Reddedilen", param: "reddedilen" },
];

export function PriceReviewsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = TABS.find((t) => t.param === params.get("sekme")) ?? TABS[0]!;
  const reviews = usePriceReviews(tab.value);
  const settings = useSettings();
  const status = useTrendyolStatus();
  const pending = status.data?.pendingReviews ?? 0;
  const limit = settings.data ? Math.round(settings.data.maxAutoChangeRate * 100) : null;

  return (
    <>
      <PageHeader
        title="Fiyat Onayları"
        description={
          <>
            Fiyat değişimi otomatik gönderim sınırını{limit !== null ? ` (%${limit})` : ""} aşan
            ürünler Trendyol&apos;a gönderilmeden önce onayınızı bekler. Sınırı{" "}
            <Link href="/ayarlar" className="text-foreground underline-offset-4 hover:underline">
              Ayarlar
            </Link>
            &apos;dan değiştirebilirsiniz.
          </>
        }
      />
      <Tabs
        value={tab.value}
        onValueChange={(v) => {
          const t = TABS.find((x) => x.value === v)!;
          router.replace(t.value === "pending" ? pathname : `${pathname}?sekme=${t.param}`, {
            scroll: false,
          });
        }}
        className="mb-4"
      >
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5 px-3">
              {t.label}
              {t.value === "pending" && pending > 0 && (
                <span className="bg-brand text-brand-foreground rounded-full px-1.5 text-[10px] leading-4 font-semibold tabular-nums">
                  {pending}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {reviews.isError ? (
        <ErrorState error={reviews.error} onRetry={() => void reviews.refetch()} />
      ) : reviews.isPending ? (
        <div className="bg-card space-y-4 rounded-xl border p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-8 w-40" />
            </div>
          ))}
        </div>
      ) : reviews.data.length === 0 ? (
        <EmptyState
          icon={CheckCheck}
          title={tab.value === "pending" ? "Onay bekleyen fiyat yok" : "Kayıt yok"}
          description={
            tab.value === "pending"
              ? "Büyük fiyat değişimleri olduğunda burada listelenir; siz onaylayana kadar Trendyol'a gönderilmez."
              : "Bu listede henüz bir karar yok."
          }
        />
      ) : (
        <ReviewsTable items={reviews.data} status={tab.value} />
      )}
    </>
  );
}

function ChangeBadge({ rate }: { rate: number }) {
  const up = rate >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <Badge variant={up ? "info" : "warning"} className="tabular-nums">
      <Icon />
      {formatChangeRate(rate)}
    </Badge>
  );
}

function ReviewsTable({ items, status }: { items: PriceReview[]; status: ReviewStatus }) {
  const decide = useDecideReview();
  const busyId = decide.isPending ? decide.variables?.id : undefined;
  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead>Ürün</TableHead>
            <TableHead className="text-right">Fiyat</TableHead>
            <TableHead className="hidden sm:table-cell">Değişim</TableHead>
            <TableHead className="hidden md:table-cell">
              {status === "pending" ? "Oluşturulma" : "Karar"}
            </TableHead>
            {status === "pending" && <TableHead className="w-44 text-right">İşlem</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((r) => (
            <TableRow key={r.id} className={cn(busyId === r.id && "opacity-60")}>
              <TableCell className="max-w-[20rem] whitespace-normal">
                <div className="line-clamp-2 text-sm font-medium">
                  {r.title ?? <span className="text-muted-foreground">Başlıksız</span>}
                </div>
                <div className="text-muted-foreground font-mono text-xs">{r.barcode}</div>
                <div className="mt-1 sm:hidden">
                  <ChangeBadge rate={r.changeRate} />
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                  <span className="text-muted-foreground">{formatMoney(r.oldPrice)}</span>
                  <ArrowRight className="text-muted-foreground size-3.5" />
                  <span className="font-semibold">{formatMoney(r.newPrice)}</span>
                </div>
                {r.newListPrice !== r.newPrice && (
                  <div className="text-muted-foreground text-xs">
                    Liste fiyatı {formatMoney(r.newListPrice)}
                  </div>
                )}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <ChangeBadge rate={r.changeRate} />
              </TableCell>
              <TableCell className="text-muted-foreground hidden md:table-cell">
                <span title={formatDateTime(r.decidedAt ?? r.createdAt)}>
                  {formatRelative(r.decidedAt ?? r.createdAt)}
                </span>
              </TableCell>
              {status === "pending" && (
                <TableCell>
                  <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:justify-end">
                    <OwnerOnly>
                      {({ disabled }) => (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={disabled || busyId === r.id}
                          onClick={() => decide.mutate({ id: r.id, decision: "reject" })}
                        >
                          <X /> Reddet
                        </Button>
                      )}
                    </OwnerOnly>
                    <OwnerOnly>
                      {({ disabled }) => (
                        <Button
                          size="sm"
                          disabled={disabled || busyId === r.id}
                          onClick={() => decide.mutate({ id: r.id, decision: "approve" })}
                        >
                          <Check /> Onayla
                        </Button>
                      )}
                    </OwnerOnly>
                  </div>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
