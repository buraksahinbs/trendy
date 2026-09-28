"use client";

import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  Clock,
  ExternalLink,
  Hash,
  Package,
  Settings2,
  Truck,
  Workflow,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { isConfigMissing, shrinkBlockedText } from "@/components/jobs/job-bits";
import { JobsTable } from "@/components/jobs/jobs-table";
import { MappingEditor } from "@/components/mapping/mapping-editor";
import { OwnerOnly } from "@/components/owner-only";
import { FetchNowButton, SupplierActionsMenu } from "@/components/suppliers/supplier-actions";
import { isSupplierConfigMissing, SupplierBadges } from "@/components/suppliers/supplier-badges";
import { SupplierFormSheet } from "@/components/suppliers/supplier-form-sheet";
import { SupplierProducts } from "@/components/suppliers/supplier-products";
import { SupplierReport } from "@/components/suppliers/supplier-report";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { scheduleLabel } from "@/lib/cron";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { useJobs, useSupplier } from "@/lib/queries";

const TABS = ["urunler", "eslestirme", "rapor", "gecmis"] as const;
type Tab = (typeof TABS)[number];

export function SupplierDetail({ id }: { id: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const supplierQ = useSupplier(id);
  const jobs = useJobs(id);
  const [editOpen, setEditOpen] = useState(false);
  const rawTab = params.get("sekme");
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "urunler";
  const setTab = (t: string) =>
    router.replace(t === "urunler" ? pathname : `${pathname}?sekme=${t}`, { scroll: false });

  const back = (
    <Link
      href="/tedarikciler"
      className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeft className="size-4" /> Tedarikçiler
    </Link>
  );

  if (supplierQ.isPending) return <DetailSkeleton />;
  const notFound = supplierQ.error instanceof ApiError && supplierQ.error.status === 404;
  if (supplierQ.isError && !notFound)
    return (
      <>
        {back}
        <ErrorState error={supplierQ.error} onRetry={() => void supplierQ.refetch()} />
      </>
    );

  const supplier = supplierQ.data;
  if (!supplier || notFound)
    return (
      <>
        {back}
        <EmptyState
          icon={Truck}
          title="Tedarikçi bulunamadı"
          description="Bu tedarikçi silinmiş ya da başka bir mağazaya ait olabilir."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/tedarikciler">Tedarikçilere dön</Link>
            </Button>
          }
        />
      </>
    );

  const latest = [...(jobs.data ?? [])].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const shrink = latest?.summary?.shrinkBlocked;
  const configMissing = isSupplierConfigMissing(supplier) || isConfigMissing(latest);
  const mappingMissing = !configMissing && !supplier.mapping && tab !== "eslestirme";

  return (
    <>
      {back}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{supplier.name}</h1>
          <SupplierBadges supplier={supplier} shrinkBlocked={Boolean(shrink)} />
          <a
            href={supplier.feedUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-muted-foreground hover:text-foreground inline-flex max-w-full items-center gap-1.5 font-mono text-xs break-all"
          >
            {supplier.feedUrl}
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FetchNowButton supplier={supplier} variant="default" />
          <SupplierActionsMenu
            supplier={supplier}
            triggerVariant="outline"
            withFetch={false}
            onDeleted={() => router.push("/tedarikciler")}
          />
        </div>
      </div>

      <div className="mb-6 space-y-3">
        {shrink && (
          <Alert variant="warning">
            <AlertTriangle />
            <AlertTitle>Güvenlik freni devrede</AlertTitle>
            <AlertDescription>
              <p>
                Son çekimde {shrinkBlockedText(shrink)}; stoklar otomatik sıfırlanmadı. Feed
                düzeldiğinde bir sonraki çekimde senkron normale döner.
              </p>
            </AlertDescription>
          </Alert>
        )}
        {configMissing && (
          <Alert variant="warning">
            <Settings2 />
            <AlertTitle>Yapılandırma eksik</AlertTitle>
            <AlertDescription>
              <p>
                Ürün düğümü yolu veya ürün kimlik alanı tanımlı değil; bu tedarikçinin çekimleri
                atlanıyor. Feed&apos;i analiz ederek eksik alanları tamamlayın.
              </p>
              <OwnerOnly>
                {({ disabled }) => (
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-1"
                    onClick={() => setEditOpen(true)}
                    disabled={disabled}
                  >
                    Yapılandırmayı tamamla
                  </Button>
                )}
              </OwnerOnly>
            </AlertDescription>
          </Alert>
        )}
        {mappingMissing && (
          <Alert>
            <Workflow />
            <AlertTitle>Alan eşleştirmesi yapılmadı</AlertTitle>
            <AlertDescription>
              <p>
                Ürünler okunuyor ancak barkod ve stok alanları eşleştirilmeden Trendyol&apos;a
                senkronlanmaz.
              </p>
              <Button size="sm" className="mt-1" onClick={() => setTab("eslestirme")}>
                Eşleştirmeye başla
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {latest?.status === "failed" && (
          <Alert variant="destructive">
            <XCircle />
            <AlertTitle>Son çekim başarısız oldu</AlertTitle>
            <AlertDescription>
              <p className="break-all">{latest.error ?? "Ayrıntı için işlem geçmişine bakın."}</p>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <InfoTile
          icon={Clock}
          label="Son çekim"
          value={supplier.lastFetchedAt ? formatRelative(supplier.lastFetchedAt) : "Henüz yok"}
          hint={supplier.lastFetchedAt ? formatDateTime(supplier.lastFetchedAt) : undefined}
        />
        <InfoTile
          icon={Package}
          label="Feed'deki ürün"
          value={formatNumber(supplier.lastItemCount)}
          hint="Son çekime göre"
        />
        <InfoTile
          icon={CalendarClock}
          label="Çekim sıklığı"
          value={scheduleLabel(supplier.scheduleCron)}
          hint={supplier.active ? "Otomatik çekim açık" : "Otomatik çekim kapalı"}
        />
        <InfoTile
          icon={Hash}
          label="Ürün düğümü"
          value={<span className="font-mono text-sm">{supplier.itemPath ?? "tanımsız"}</span>}
          hint={supplier.externalIdPath ? `Kimlik: ${supplier.externalIdPath}` : "Kimlik alanı yok"}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList>
            <TabsTrigger value="urunler" className="px-3">
              Ürünler
            </TabsTrigger>
            <TabsTrigger value="eslestirme" className="px-3">
              Eşleştirme
              {!supplier.mapping && <span className="bg-brand size-1.5 rounded-full" />}
            </TabsTrigger>
            <TabsTrigger value="rapor" className="px-3">
              Rapor
            </TabsTrigger>
            <TabsTrigger value="gecmis" className="px-3">
              İşlem geçmişi
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="urunler">
          <SupplierProducts supplierId={supplier.id} />
        </TabsContent>
        <TabsContent value="eslestirme">
          <MappingEditor supplier={supplier} />
        </TabsContent>
        <TabsContent value="rapor">
          <SupplierReport supplier={supplier} onOpenMapping={() => setTab("eslestirme")} />
        </TabsContent>
        <TabsContent value="gecmis">
          <JobsTable
            jobs={jobs.data}
            isPending={jobs.isPending}
            error={jobs.error}
            onRetry={() => void jobs.refetch()}
            showSupplier={false}
            emptyDescription="Bu tedarikçi için henüz çekim yapılmadı. “Şimdi çek” ile ilk çekimi başlatın."
          />
        </TabsContent>
      </Tabs>

      <SupplierFormSheet open={editOpen} onOpenChange={setEditOpen} supplier={supplier} />
    </>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Clock;
  label: string;
  value: React.ReactNode;
  hint?: string | undefined;
}) {
  return (
    <Card className="gap-1 px-4 py-4 shadow-none">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="truncate text-base font-semibold">{value}</div>
      {hint && <div className="text-muted-foreground truncate text-xs">{hint}</div>}
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
