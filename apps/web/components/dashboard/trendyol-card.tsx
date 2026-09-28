"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { Download, Loader2, RefreshCcw } from "lucide-react";
import Link from "next/link";

import { ErrorState } from "@/components/error-state";
import { JobStatusBadge, SummaryChips } from "@/components/jobs/job-bits";
import { LISTING_STATUS, LISTING_STATUS_ORDER } from "@/components/listings/listing-status";
import { OwnerOnly } from "@/components/owner-only";
import { Badge } from "@/components/ui/badge";
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
import type { ListingStatus, StatusJob, TrendyolStatus } from "@/lib/api";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
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

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Trendyol senkronu
          {status.data && (
            <Badge variant="outline" className="font-normal">
              {status.data.syncEnv === "prod" ? "Canlı" : "Test ortamı"}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Stok ve fiyatlar 15 dakikada bir ve feed değişince gönderilir.
        </CardDescription>
        <CardAction className="flex gap-2">
          <OwnerOnly>
            {({ disabled }) => (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || importer.isPending}
                onClick={() => importer.mutate()}
                className="hidden sm:inline-flex"
              >
                {importer.isPending ? <Loader2 className="animate-spin" /> : <Download />}
                İçe aktar
              </Button>
            )}
          </OwnerOnly>
          <OwnerOnly>
            {({ disabled }) => (
              <Button
                size="sm"
                disabled={disabled || sync.isPending || status.data?.syncPaused}
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
            <Skeleton className="h-3 w-full rounded-full" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          </div>
        ) : (
          <TrendyolBody status={status.data} />
        )}
      </CardContent>
    </Card>
  );
}

function TrendyolBody({ status }: { status: TrendyolStatus }) {
  const entries = LISTING_STATUS_ORDER.map((s) => [s, status.listings[s] ?? 0] as const).filter(
    ([, n]) => n > 0,
  );
  const total = entries.reduce((a, [, n]) => a + n, 0);

  return (
    <div className="space-y-5">
      {total > 0 ? (
        <div className="space-y-2.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted-foreground">Trendyol kayıtları</span>
            <span className="font-medium tabular-nums">{formatNumber(total)}</span>
          </div>
          <div className="bg-muted flex h-2.5 gap-0.5 overflow-hidden rounded-full">
            {entries.map(([s, n]) => (
              <div
                key={s}
                className={cn("h-full", BAR_COLOR[s])}
                style={{ width: `${Math.max(1.5, (n / total) * 100)}%` }}
                title={`${LISTING_STATUS[s].label}: ${formatNumber(n)}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {entries.map(([s, n]) => (
              <Link
                key={s}
                href={`/urunler?durum=${s}`}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
              >
                <span className={cn("size-2 rounded-full", BAR_COLOR[s])} />
                {LISTING_STATUS[s].label}
                <span className="text-foreground font-medium tabular-nums">{formatNumber(n)}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-5 text-center text-sm">
          Trendyol ürünleriniz henüz içe aktarılmadı. API bilgilerinizi doğruladığınızda içe aktarma
          otomatik başlar.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <JobTile title="Son senkron" job={status.lastSync} jobType="ty_sync" />
        <JobTile title="Son içe aktarma" job={status.lastImport} jobType="ty_import" />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Metric label="Senkronlanan varyant" value={formatNumber(status.managedVariants)} />
        <Metric label="Bekleyen batch" value={formatNumber(status.pendingBatches)} />
        <Metric
          label="Hatalı kayıt"
          value={formatNumber(status.listingErrors)}
          danger={status.listingErrors > 0}
        />
      </dl>
    </div>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-muted/40 rounded-lg px-3 py-2.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums", danger && "text-destructive")}>
        {value}
      </dd>
    </div>
  );
}

function JobTile({
  title,
  job,
  jobType,
}: {
  title: string;
  job: StatusJob | null;
  jobType: string;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium">{title}</span>
        {job && <JobStatusBadge status={job.status} />}
      </div>
      {job ? (
        <>
          <div className="text-sm font-medium" title={formatDateTime(job.startedAt)}>
            {formatRelative(job.startedAt)}
          </div>
          {job.status === "failed" && job.error ? (
            <p className="text-destructive line-clamp-2 text-xs">{job.error}</p>
          ) : (
            <SummaryChips summary={job.summary} jobType={jobType} max={3} />
          )}
        </>
      ) : (
        <div className="text-muted-foreground text-sm">Henüz çalışmadı</div>
      )}
    </div>
  );
}
