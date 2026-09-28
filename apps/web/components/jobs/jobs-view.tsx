"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { JOB_TYPE_LABEL } from "@/components/jobs/job-bits";
import { JobsTable } from "@/components/jobs/jobs-table";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { JobStatus } from "@/lib/api";
import { useJobs, useSuppliers } from "@/lib/queries";

const STATUS_FILTERS: { value: JobStatus | "all"; label: string }[] = [
  { value: "all", label: "Tüm durumlar" },
  { value: "running", label: "Çalışıyor" },
  { value: "success", label: "Başarılı" },
  { value: "failed", label: "Hatalı" },
  { value: "skipped", label: "Atlandı" },
];

export function JobsView() {
  const [supplier, setSupplier] = useState("all");
  const [status, setStatus] = useState<JobStatus | "all">("all");
  const [jobType, setJobType] = useState("all");
  const suppliers = useSuppliers();
  const jobs = useJobs(supplier === "all" ? undefined : Number(supplier));
  const filtered = jobs.data?.filter(
    (j) =>
      (status === "all" || j.status === status) && (jobType === "all" || j.jobType === jobType),
  );

  return (
    <>
      <PageHeader
        title="İşlem Geçmişi"
        description="XML çekimi, Trendyol senkronu ve sipariş işlerinin son 50 kaydı."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void jobs.refetch()}
            disabled={jobs.isFetching}
          >
            <RefreshCw className={jobs.isFetching ? "animate-spin" : undefined} />
            Yenile
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {suppliers.data && suppliers.data.length > 0 && (
          <Select value={supplier} onValueChange={setSupplier}>
            <SelectTrigger size="sm" className="w-52" aria-label="Tedarikçi filtresi">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tüm tedarikçiler</SelectItem>
              {suppliers.data.map((s) => (
                <SelectItem key={s.id} value={String(s.id)}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select value={jobType} onValueChange={setJobType}>
          <SelectTrigger size="sm" className="w-52" aria-label="İşlem türü filtresi">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tüm işlem türleri</SelectItem>
            {Object.entries(JOB_TYPE_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as JobStatus | "all")}>
          <SelectTrigger size="sm" className="w-40" aria-label="Durum filtresi">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <JobsTable
        jobs={filtered}
        isPending={jobs.isPending}
        error={jobs.error}
        onRetry={() => void jobs.refetch()}
        emptyDescription={
          status === "all" && jobType === "all"
            ? "XML çekimleri, senkron ve sipariş işleri burada listelenecek."
            : "Bu filtreyle eşleşen işlem yok."
        }
      />
    </>
  );
}
