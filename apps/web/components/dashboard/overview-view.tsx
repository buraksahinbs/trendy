"use client";

import {
  AlertOctagon,
  ArrowRight,
  BadgePercent,
  CheckCircle2,
  History,
  ShoppingCart,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PanelAlerts } from "@/components/alerts/panel-alerts";
import {
  OnboardingChecklist,
  type ChecklistState,
} from "@/components/dashboard/onboarding-checklist";
import { TrendyolCard } from "@/components/dashboard/trendyol-card";
import { EmptyState } from "@/components/empty-state";
import { JobStatusBadge, jobTypeLabel, SummaryChips } from "@/components/jobs/job-bits";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
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
import { errorMessage } from "@/lib/api";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import {
  useCredentials,
  useJobs,
  useMe,
  useOrders,
  useSuppliers,
  useTrendyolStatus,
} from "@/lib/queries";

const statState = (q: { isPending: boolean; isError: boolean }) =>
  q.isPending ? "loading" : q.isError ? "error" : "ok";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function OverviewView() {
  const { data: me } = useMe();
  const creds = useCredentials();
  const suppliers = useSuppliers();
  const jobs = useJobs();
  const status = useTrendyolStatus();
  const [today] = useState(startOfToday);
  const todayOrders = useOrders({ from: today, limit: 1, offset: 0 });

  const supplierList = suppliers.data ?? [];
  const jobList = jobs.data ?? [];
  const activeTenant = me?.tenants.find((t) => t.tenantId === me.activeTenantId);
  const recent = [...jobList].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 7);
  const st = status.data;
  const approved = st?.listings.approved ?? 0;
  const totalListings = Object.values(st?.listings ?? {}).reduce((a, b) => a + (b ?? 0), 0);

  const syncEnv = st?.syncEnv ?? "prod";
  const envCred = creds.data?.find((c) => c.env === syncEnv);
  const mapped = supplierList.find((s) => s.mapping);
  const checklist: ChecklistState = {
    credentials: envCred?.verifiedAt ? "verified" : envCred ? "saved" : "none",
    supplier: supplierList.length > 0,
    mappingSupplierId: (mapped ?? supplierList[0])?.id ?? null,
    mapping: Boolean(mapped),
    firstFetch:
      supplierList.some((s) => s.lastFetchedAt) ||
      jobList.some((j) => j.jobType === "xml_fetch" && j.status === "success"),
    firstSync: st?.lastSync?.status === "success" || (st?.managedVariants ?? 0) > 0,
  };
  const setupLoading = creds.isPending || suppliers.isPending || status.isPending;
  const setupDone =
    checklist.credentials === "verified" &&
    checklist.supplier &&
    checklist.mapping &&
    checklist.firstFetch &&
    checklist.firstSync;

  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description={activeTenant ? `${activeTenant.tenantName} mağazasının durumu` : undefined}
      />

      <PanelAlerts className="mb-6" />

      {/* Kurulum bitmeden sıfırlarla dolu kartlar değil, yapılacak iş öne çıkar. */}
      {setupLoading ? (
        <Skeleton className="mb-6 h-72 rounded-xl" />
      ) : (
        !setupDone && (
          <div className="mb-6">
            <OnboardingChecklist state={checklist} />
          </div>
        )
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={CheckCircle2}
          label="Onaylı ürün"
          state={statState(status)}
          value={formatNumber(approved)}
          hint={
            totalListings > 0
              ? `${formatNumber(totalListings)} Trendyol kaydından`
              : "Trendyol ürünleri henüz içe aktarılmadı"
          }
          href="/urunler?durum=approved"
        />
        <StatCard
          icon={BadgePercent}
          label="Onay bekleyen fiyat"
          state={statState(status)}
          value={formatNumber(st?.pendingReviews ?? 0)}
          hint={(st?.pendingReviews ?? 0) > 0 ? "Onayınızı bekliyor" : "Bekleyen yok"}
          tone={(st?.pendingReviews ?? 0) > 0 ? "brand" : "default"}
          href="/fiyat-onaylari"
        />
        <StatCard
          icon={AlertOctagon}
          label="Hatalı ürün"
          state={statState(status)}
          value={formatNumber(st?.listingErrors ?? 0)}
          hint={(st?.listingErrors ?? 0) > 0 ? "Son gönderimde hata aldı" : "Hata yok"}
          tone={(st?.listingErrors ?? 0) > 0 ? "danger" : "default"}
          href="/urunler?hata=1"
        />
        <StatCard
          icon={ShoppingCart}
          label="Bugünkü sipariş"
          state={statState(todayOrders)}
          value={formatNumber(todayOrders.data?.total ?? 0)}
          hint="Bugün 00:00'dan beri"
          href="/siparisler"
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <TrendyolCard status={status} />
        </div>
        <Card className="gap-4 self-start xl:col-span-2">
          <CardHeader>
            <CardTitle>Son işlemler</CardTitle>
            <CardDescription>Çekim, senkron ve sipariş işleri</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm" className="-mr-2">
                <Link href="/islem-gecmisi">
                  Tümü <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {jobs.isPending ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-4 flex-1" />
                  </div>
                ))}
              </div>
            ) : jobs.isError ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {errorMessage(jobs.error)}
              </p>
            ) : recent.length === 0 ? (
              <EmptyState
                icon={History}
                title="Henüz işlem yok"
                description="İlk XML çekiminden sonra burada görünecek."
                className="py-10"
              />
            ) : (
              <ul className="-mx-2 divide-y">
                {recent.map((j) => (
                  <li key={j.id} className="flex flex-col gap-1.5 px-2 py-3">
                    <div className="flex items-center gap-2">
                      <JobStatusBadge status={j.status} />
                      <span className="truncate text-sm font-medium">
                        {jobTypeLabel(j.jobType)}
                        {j.summary?.supplierName && (
                          <span className="text-muted-foreground font-normal">
                            {" "}
                            · {j.summary.supplierName}
                          </span>
                        )}
                      </span>
                      <span
                        className="text-muted-foreground ml-auto shrink-0 text-xs"
                        title={formatDateTime(j.startedAt)}
                      >
                        {formatRelative(j.startedAt)}
                      </span>
                    </div>
                    {j.error && j.status === "failed" ? (
                      <p className="text-destructive line-clamp-1 text-xs">{j.error}</p>
                    ) : (
                      <SummaryChips summary={j.summary} jobType={j.jobType} max={3} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
