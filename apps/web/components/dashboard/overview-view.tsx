"use client";

import {
  AlertOctagon,
  ArrowRight,
  CheckCircle2,
  History,
  RefreshCcw,
  ShoppingCart,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PanelAlerts } from "@/components/alerts/panel-alerts";
import {
  OnboardingChecklist,
  type ChecklistState,
} from "@/components/dashboard/onboarding-checklist";
import { attentionItems, TrendyolCard } from "@/components/dashboard/trendyol-card";
import { EmptyState } from "@/components/empty-state";
import {
  isRoutineJob,
  JobStatusDot,
  jobTypeLabel,
  reasonLabel,
  summaryLine,
} from "@/components/jobs/job-bits";
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
import { cn } from "@/lib/utils";

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
  const sortedJobs = [...jobList].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // Haber içermeyen rutin kontroller (her 5 dk'lık sipariş çekimi vb.) listeyi doldurmasın.
  const recent = sortedJobs.filter((j) => !isRoutineJob(j)).slice(0, 6);
  const hiddenRoutine = sortedJobs.slice(0, 50).filter(isRoutineJob).length;
  const st = status.data;
  const approved = st?.listings.approved ?? 0;
  const totalListings = Object.values(st?.listings ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const attentionCount = st ? attentionItems(st).reduce((a, i) => a + i.count, 0) : 0;

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

      {/* Fiyat onayları ve gönderim hataları "Dikkat gerektiren" listesinde. */}
      <PanelAlerts className="mb-6" exclude={["price_reviews_pending", "listing_errors"]} />

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
          icon={RefreshCcw}
          label="Senkronda"
          state={statState(status)}
          value={formatNumber(st?.managedVariants ?? 0)}
          hint="Tedarikçi stoğuyla eşitlenen varyant"
          href="/urunler?kapsam=senkron"
        />
        <StatCard
          icon={ShoppingCart}
          label="Bugünkü sipariş"
          state={statState(todayOrders)}
          value={formatNumber(todayOrders.data?.total ?? 0)}
          hint="Bugün 00:00'dan beri"
          href="/siparisler"
        />
        <StatCard
          icon={AlertOctagon}
          label="Dikkat gerektiren"
          state={statState(status)}
          value={formatNumber(attentionCount)}
          hint={attentionCount > 0 ? "Aşağıdaki listeye bakın" : "Bekleyen iş yok"}
          tone={attentionCount > 0 ? "warning" : "default"}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <div className="space-y-6 xl:col-span-3">
          <TrendyolCard status={status} />
        </div>
        <Card className="gap-4 self-start xl:col-span-2">
          <CardHeader>
            <CardTitle>Son işlemler</CardTitle>
            <CardDescription>
              {hiddenRoutine > 0
                ? `Önemli olaylar; ${formatNumber(hiddenRoutine)} rutin kontrol gizlendi`
                : "Çekim, senkron ve sipariş işleri"}
            </CardDescription>
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
            ) : recent.length === 0 && hiddenRoutine === 0 ? (
              <EmptyState
                icon={History}
                title="Henüz işlem yok"
                description="İlk XML çekiminden sonra burada görünecek."
                className="py-10"
              />
            ) : recent.length === 0 ? (
              <p className="text-muted-foreground py-6 text-center text-sm">
                Yeni bir olay yok; rutin kontroller sorunsuz çalışıyor.
              </p>
            ) : (
              <ul className="-mx-2">
                {recent.map((j) => {
                  const line =
                    j.error && j.status === "failed"
                      ? j.error
                      : j.summary?.reason
                        ? reasonLabel(j.summary.reason)
                        : summaryLine(j.summary, j.jobType);
                  return (
                    <li key={j.id} className="flex items-start gap-3 rounded-md px-2 py-2.5">
                      <span className="mt-1.5">
                        <JobStatusDot status={j.status} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">
                          {jobTypeLabel(j.jobType)}
                          {j.summary?.supplierName && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {j.summary.supplierName}
                            </span>
                          )}
                        </div>
                        {line && (
                          <p
                            className={cn(
                              "truncate text-xs",
                              j.status === "failed" ? "text-destructive" : "text-muted-foreground",
                            )}
                            title={line}
                          >
                            {line}
                          </p>
                        )}
                      </div>
                      <span
                        className="text-muted-foreground shrink-0 text-xs"
                        title={formatDateTime(j.startedAt)}
                      >
                        {formatRelative(j.startedAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
