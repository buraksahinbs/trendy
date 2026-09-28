"use client";

import { ChevronDown, History } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { JobStatusBadge, jobTypeLabel, SummaryChips } from "@/components/jobs/job-bits";
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

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (isPending) return <TableSkeleton />;
  if (!jobs || jobs.length === 0)
    return <EmptyState icon={History} title="Henüz işlem yok" description={emptyDescription} />;

  const sorted = [...jobs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      <Table>
        <TableHeader className="bg-muted/40">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-28">Durum</TableHead>
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
                    <JobStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{jobTypeLabel(job.jobType)}</span>
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
                    {job.error && !open ? (
                      <span className="text-destructive line-clamp-1 text-xs">{job.error}</span>
                    ) : (
                      <SummaryChips summary={job.summary} jobType={job.jobType} max={4} />
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
                        <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {open && (
                  <TableRow className="bg-muted/20 hover:bg-muted/20">
                    <TableCell colSpan={6} className="whitespace-normal">
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
                            <SummaryChips summary={job.summary} jobType={job.jobType} />
                          </div>
                          <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                            <dt>Başladı</dt>
                            <dd className="text-foreground">{formatDateTime(job.startedAt)}</dd>
                            <dt>Bitti</dt>
                            <dd className="text-foreground">{formatDateTime(job.finishedAt)}</dd>
                            <dt>İş no</dt>
                            <dd className="text-foreground font-mono">#{job.id}</dd>
                          </dl>
                        </div>
                        {job.summary && <JsonViewer value={job.summary} />}
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
