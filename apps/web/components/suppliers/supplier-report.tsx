"use client";

import { CheckCircle2, ClipboardList, Workflow } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { fieldLabel } from "@/components/mapping/mapping-utils";
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
import type { Supplier } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { useSupplierReport } from "@/lib/queries";
import { cn } from "@/lib/utils";

const CODE_LABEL: Record<string, string> = {
  missing: "Boş",
  invalid: "Geçersiz",
  duplicate: "Tekrarlanıyor",
  too_long: "Çok uzun",
  truncated: "Kısaltıldı",
  invalid_chars: "Geçersiz karakter",
  empty: "Boş",
  no_variants: "Varyant bulunamadı",
  too_many: "Çok fazla",
  conflict: "Başka kayıtla çakışıyor",
  not_https: "https değil",
};

export function SupplierReport({
  supplier,
  onOpenMapping,
}: {
  supplier: Supplier;
  onOpenMapping: () => void;
}) {
  const report = useSupplierReport(supplier.id);
  if (report.isError)
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />;
  if (report.isPending)
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-56 rounded-xl" />
      </div>
    );

  const r = report.data;
  if (!supplier.mapping && r.normalized === 0)
    return (
      <EmptyState
        icon={Workflow}
        title="Rapor için eşleştirme gerekli"
        description="Alan eşleştirmesini kaydettiğinizde ürünler işlenir ve sorunlar burada özetlenir."
        action={
          <Button size="sm" onClick={onOpenMapping}>
            Eşleştirmeye git
          </Button>
        }
      />
    );

  const pct = r.supplierProducts ? Math.round((r.normalized / r.supplierProducts) * 100) : 0;
  const errors = r.issues.filter((i) => i.level === "error");
  const warnings = r.issues.filter((i) => i.level === "warning");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Feed'deki ürün"
          value={r.supplierProducts}
          hint={`${formatNumber(r.missing)} kayıp`}
        />
        <Tile label="İşlenen" value={r.normalized} hint={`%${pct} tamamlandı`} progress={pct} />
        <Tile
          label="Senkrona hazır varyant"
          value={r.variants}
          hint={`${formatNumber(r.products)} ürün`}
          tone="success"
        />
        <Tile
          label="Hatalı / uyarılı"
          value={r.withErrors}
          hint={`${formatNumber(r.withWarnings)} ürün uyarılı`}
          tone={r.withErrors > 0 ? "danger" : "default"}
        />
      </div>

      {r.issues.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Sorun bulunamadı"
          description="Tüm ürünler eşleştirmeyle sorunsuz okunuyor."
        />
      ) : (
        <div className="bg-card overflow-hidden rounded-xl border">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <ClipboardList className="text-muted-foreground size-4" />
            <h3 className="text-sm font-semibold">En sık sorunlar</h3>
            <span className="text-muted-foreground ml-auto text-xs">
              {errors.length} hata türü · {warnings.length} uyarı türü
            </span>
          </div>
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-24">Seviye</TableHead>
                <TableHead>Alan</TableHead>
                <TableHead>Sorun</TableHead>
                <TableHead className="text-right">Ürün</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.issues.map((i) => (
                <TableRow key={`${i.level}-${i.field}-${i.code}`}>
                  <TableCell>
                    <Badge variant={i.level === "error" ? "danger" : "warning"}>
                      {i.level === "error" ? "Hata" : "Uyarı"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{fieldLabel(i.field)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {CODE_LABEL[i.code] ?? i.code}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(i.count)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground border-t px-4 py-2.5 text-xs">
            Hatalı varyantlar senkronlanmaz. Ayrıntıları Ürünler sekmesinde, düzeltmeyi Eşleştirme
            sekmesinde yapabilirsiniz.
          </p>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = "default",
  progress,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "default" | "success" | "danger";
  progress?: number;
}) {
  return (
    <div className="bg-card space-y-1 rounded-xl border px-4 py-3.5">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "danger" && "text-destructive",
        )}
      >
        {formatNumber(value)}
      </div>
      {progress !== undefined && (
        <div className="bg-muted h-1 overflow-hidden rounded-full">
          <div className="bg-brand h-full rounded-full" style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="text-muted-foreground text-xs">{hint}</div>
    </div>
  );
}
