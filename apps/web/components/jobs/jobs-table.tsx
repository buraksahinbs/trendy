"use client";

import { ChevronDown, History } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import {
  isRoutineJob,
  JobStatusDot,
  jobTypeLabel,
  reasonLabel,
  summaryChips,
  summaryLine,
} from "@/components/jobs/job-bits";
import { JsonViewer } from "@/components/json-viewer";
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
import { formatDateTime, formatDuration, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

export function JobsTable({
  jobs,
  isPending,
  error,
  onRetry,
  showSupplier = true,
  emptyDescription = "XML çekimleri ve senkron işleri burada listelenecek.",
}: {
  jobs: Job[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  showSupplier?: boolean;
  emptyDescription?: string;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const [showRoutine, setShowRoutine] = useState(false);

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isPending) return <TableSkeleton />;
  if (!jobs || jobs.length === 0)
    return <EmptyState icon={History} title="Henüz işlem yok" description={emptyDescription} />;

  const all = [...jobs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  // Haber içermeyen rutin kontroller (yeni siparişsiz çekim, değişmemiş feed…) varsayılan gizli.
  const routineCount = all.filter(isRoutineJob).length;
  const sorted = showRoutine ? all : all.filter((j) => !isRoutineJob(j));

  return (
    <div className="space-y-2">
      {routineCount > 0 && (
        <p className="text-muted-foreground text-xs">
          {showRoutine
            ? "Rutin kontroller de gösteriliyor. "
            : `${routineCount} rutin kontrol gizlendi (yeni bir şey getirmeyen çekim ve senkronlar). `}
          <button
            type="button"
            onClick={() => setShowRoutine((v) => !v)}
            className="text-foreground underline-offset-2 hover:underline"
          >
            {showRoutine ? "Gizle" : "Göster"}
          </button>
        </p>
      )}
      {sorted.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border px-4 py-10 text-center text-sm">
          Yeni bir olay yok; rutin kontroller sorunsuz çalışıyor.
        </p>
      ) : (
        <div className="bg-card overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>İşlem</TableHead>
                <TableHead>Başlangıç</TableHead>
                <TableHead className="hidden md:table-cell">Süre</TableHead>
                <TableHead>Özet</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((job) => {
                const open = expanded.has(job.id);
                const hasDetails = Boolean(job.error || job.summary);
                const supplierId = job.summary?.supplierId;
                const supplierName = job.summary?.supplierName;
                return (
                  <Fragment key={job.id}>
                    <TableRow
                      className={cn(hasDetails && "cursor-pointer", open && "bg-muted/30")}
                      onClick={hasDetails ? () => toggle(job.id) : undefined}
                    >
                      <TableCell>
                        <div className="flex items-start gap-2.5">
                          <span className="mt-1.5">
                            <JobStatusDot status={job.status} />
                          </span>
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {jobTypeLabel(job.jobType)}
                              {job.status !== "success" && (
                                <span
                                  className={cn(
                                    "ml-2 text-xs font-normal",
                                    job.status === "failed"
                                      ? "text-destructive"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {job.status === "failed"
                                    ? "hata"
                                    : job.status === "running"
                                      ? "sürüyor"
                                      : "atlandı"}
                                </span>
                              )}
                            </span>
                            {showSupplier && supplierName && (
                              <span className="text-muted-foreground text-xs">
                                {supplierId ? (
                                  <Link
                                    href={`/tedarikciler/${supplierId}`}
                                    className="hover:text-foreground hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {supplierName}
                                  </Link>
                                ) : (
                                  supplierName
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span title={formatDateTime(job.startedAt)} className="text-sm">
                          {formatRelative(job.startedAt)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden tabular-nums md:table-cell">
                        {job.status === "running"
                          ? "sürüyor…"
                          : formatDuration(job.startedAt, job.finishedAt)}
                      </TableCell>
                      <TableCell className="max-w-[28rem] whitespace-normal">
                        {job.error ? (
                          <span className="text-destructive line-clamp-1 text-sm">{job.error}</span>
                        ) : (
                          <span className="text-muted-foreground line-clamp-1 text-sm">
                            {job.summary?.reason
                              ? reasonLabel(job.summary.reason)
                              : summaryLine(job.summary, job.jobType) || "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {hasDetails && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={open ? "Ayrıntıları gizle" : "Ayrıntıları göster"}
                            aria-expanded={open}
                          >
                            <ChevronDown
                              className={cn("transition-transform", open && "rotate-180")}
                            />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={5} className="whitespace-normal">
                          <div className="grid gap-3 py-2 lg:grid-cols-2">
                            <div className="space-y-3">
                              {job.error && (
                                <div>
                                  <div className="text-muted-foreground mb-1 text-xs font-medium">
                                    Hata
                                  </div>
                                  <pre className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-3 font-mono text-xs whitespace-pre-wrap">
                                    {job.error}
                                  </pre>
                                </div>
                              )}
                              <div>
                                <div className="text-muted-foreground mb-1 text-xs font-medium">
                                  Özet
                                </div>
                                <ul className="list-inside list-disc space-y-0.5 text-sm">
                                  {summaryChips(job.summary, job.jobType).map((c) => (
                                    <li key={c.label}>{c.label}</li>
                                  ))}
                                </ul>
                              </div>
                              <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                                <dt>Başladı</dt>
                                <dd className="text-foreground">{formatDateTime(job.startedAt)}</dd>
                                <dt>Bitti</dt>
                                <dd className="text-foreground">
                                  {formatDateTime(job.finishedAt)}
                                </dd>
                                <dt>İş no</dt>
                                <dd className="text-foreground font-mono">#{job.id}</dd>
                              </dl>
                            </div>
                            {job.summary && (
                              <details className="text-xs">
                                <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">
                                  Ham veri
                                </summary>
                                <JsonViewer value={job.summary} className="mt-2" />
                              </details>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="bg-card space-y-3 rounded-xl border p-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="ml-auto h-5 w-40" />
        </div>
      ))}
    </div>
  );
}
