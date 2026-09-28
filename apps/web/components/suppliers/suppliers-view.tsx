"use client";

import { Plus, Truck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { OwnerOnly } from "@/components/owner-only";
import { PageHeader } from "@/components/page-header";
import { SupplierActionsMenu, FetchNowButton } from "@/components/suppliers/supplier-actions";
import { SupplierBadges } from "@/components/suppliers/supplier-badges";
import { SupplierFormSheet } from "@/components/suppliers/supplier-form-sheet";
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
import type { Job } from "@/lib/api";
import { scheduleLabel } from "@/lib/cron";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useJobs, useSuppliers } from "@/lib/queries";

function feedHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Her tedarikçinin en son işi (güvenlik freni uyarısı için). */
export function latestJobBySupplier(jobs: Job[] | undefined) {
  const map = new Map<number, Job>();
  for (const j of jobs ?? []) {
    const id = j.summary?.supplierId;
    if (typeof id !== "number") continue;
    const prev = map.get(id);
    if (!prev || j.startedAt > prev.startedAt) map.set(id, j);
  }
  return map;
}

export function SuppliersView() {
  const suppliers = useSuppliers();
  const jobs = useJobs();
  // Kurulum listesinden "?ekle=1" ile gelinirse ekleme penceresi açık başlar.
  const params = useSearchParams();
  const [createOpen, setCreateOpen] = useState(() => params.get("ekle") === "1");
  const latest = latestJobBySupplier(jobs.data);

  const addButton = (
    <OwnerOnly>
      {({ disabled }) => (
        <Button onClick={() => setCreateOpen(true)} disabled={disabled}>
          <Plus /> Tedarikçi ekle
        </Button>
      )}
    </OwnerOnly>
  );

  return (
    <>
      <PageHeader
        title="Tedarikçiler"
        description="XML feed'lerini yönetin; ürünler seçtiğiniz sıklıkta otomatik çekilir."
        actions={suppliers.data && suppliers.data.length > 0 ? addButton : undefined}
      />

      {suppliers.isPending ? (
        <SuppliersSkeleton />
      ) : suppliers.isError ? (
        <ErrorState error={suppliers.error} onRetry={() => void suppliers.refetch()} />
      ) : suppliers.data.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Henüz tedarikçi eklemediniz"
          description="Tedarikçinizin XML feed adresini ekleyin; ürün yapısını otomatik analiz edip düzenli olarak çekelim."
          action={addButton}
        />
      ) : (
        <div className="bg-card overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>Tedarikçi</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead className="hidden lg:table-cell">Sıklık</TableHead>
                <TableHead>Son çekim</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Ürün</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.data.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-[16rem]">
                    <Link href={`/tedarikciler/${s.id}`} className="group block min-w-0">
                      <span className="block truncate font-medium group-hover:underline">
                        {s.name}
                      </span>
                      <span className="text-muted-foreground block truncate font-mono text-xs">
                        {feedHost(s.feedUrl)}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <SupplierBadges
                      supplier={s}
                      shrinkBlocked={Boolean(latest.get(s.id)?.summary?.shrinkBlocked)}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell">
                    {scheduleLabel(s.scheduleCron)}
                  </TableCell>
                  <TableCell>
                    <span
                      title={formatDateTime(s.lastFetchedAt)}
                      className={s.lastFetchedAt ? "" : "text-muted-foreground"}
                    >
                      {s.lastFetchedAt ? formatRelative(s.lastFetchedAt) : "Henüz çekilmedi"}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">
                    {formatNumber(s.lastItemCount)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <span className="hidden md:inline-flex">
                        <FetchNowButton supplier={s} variant="ghost" />
                      </span>
                      <SupplierActionsMenu supplier={s} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <SupplierFormSheet open={createOpen} onOpenChange={setCreateOpen} supplier={null} />
    </>
  );
}

function SuppliersSkeleton() {
  return (
    <div className="bg-card divide-y rounded-xl border">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-5 w-16" />
          <Skeleton className="ml-auto h-8 w-24" />
        </div>
      ))}
    </div>
  );
}
