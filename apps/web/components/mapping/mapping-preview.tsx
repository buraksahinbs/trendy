"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, Loader2, XCircle } from "lucide-react";
import { useState } from "react";

import { fieldLabel } from "@/components/mapping/mapping-utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ApiError, errorMessage, type MappingPreview } from "@/lib/api";
import { formatMoney, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type Item = MappingPreview["items"][number];

export function MappingPreviewPanel({
  data,
  isFetching,
  error,
  clientErrors,
}: {
  data: MappingPreview | undefined;
  isFetching: boolean;
  error: unknown;
  clientErrors: string[];
}) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const items = (data?.items ?? []).filter((i) => !onlyIssues || i.issues.length > 0);
  const allValid = data && data.valid === data.sampled;

  return (
    <div className="bg-card flex flex-col rounded-xl border">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Canlı önizleme</h3>
        {isFetching && <Loader2 className="text-muted-foreground size-3.5 animate-spin" />}
        {data && clientErrors.length === 0 && (
          <Badge variant={allValid ? "success" : "warning"} className="ml-auto tabular-nums">
            {allValid ? <CheckCircle2 /> : <AlertTriangle />}
            Geçerli {formatNumber(data.valid)} / örnek {formatNumber(data.sampled)}
          </Badge>
        )}
      </div>

      <div className="space-y-3 p-4">
        {clientErrors.length > 0 ? (
          <div className="border-warning/40 bg-warning/10 dark:text-warning rounded-lg border p-3 text-sm text-amber-800">
            <div className="mb-1 font-medium">Önizleme için tamamlanmalı:</div>
            <ul className="list-disc space-y-0.5 pl-5">
              {clientErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : error ? (
          <ServerError error={error} />
        ) : !data ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
              <span>
                Feed&apos;deki {formatNumber(data.total)} üründen ilk {formatNumber(data.sampled)}{" "}
                tanesi
              </span>
              <label className="flex items-center gap-1.5">
                <Switch checked={onlyIssues} onCheckedChange={setOnlyIssues} className="scale-75" />
                Yalnızca sorunlu
              </label>
            </div>
            {items.length === 0 ? (
              <p className="text-muted-foreground rounded-lg border border-dashed py-6 text-center text-sm">
                Sorunlu ürün yok.
              </p>
            ) : (
              <ul className={cn("space-y-2 transition-opacity", isFetching && "opacity-60")}>
                {items.map((item, i) => (
                  <PreviewItem key={item.externalId} item={item} defaultOpen={i === 0} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ServerError({ error }: { error: unknown }) {
  return (
    <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm">
      <div className="font-medium">{errorMessage(error)}</div>
      {error instanceof ApiError && error.issues.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          {error.issues.map((i) => (
            <li key={i.path + i.message}>
              {i.path && <span className="font-mono">{i.path}: </span>}
              {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PreviewItem({ item, defaultOpen }: { item: Item; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const errors = item.issues.filter((i) => i.level === "error").length;
  const warnings = item.issues.length - errors;
  const p = item.product;
  const ok = p && errors === 0;

  return (
    <li className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-muted/40 flex w-full items-center gap-2.5 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        {ok ? (
          <CheckCircle2 className="text-success size-4 shrink-0" />
        ) : p ? (
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
        ) : (
          <XCircle className="text-destructive size-4 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {p?.title ?? <span className="text-muted-foreground">Başlık yok</span>}
          </div>
          <div className="text-muted-foreground truncate font-mono text-[11px]">
            {item.externalId}
            {p && ` · ${p.variants.length} varyant`}
          </div>
        </div>
        {errors > 0 && <Badge variant="danger">{errors} hata</Badge>}
        {warnings > 0 && <Badge variant="warning">{warnings} uyarı</Badge>}
        <ChevronDown
          className={cn("text-muted-foreground size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          {item.issues.length > 0 && (
            <ul className="space-y-1">
              {item.issues.map((iss, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <Badge
                    variant={iss.level === "error" ? "danger" : "warning"}
                    className="shrink-0 font-normal"
                  >
                    {fieldLabel(iss.field)}
                  </Badge>
                  <span className="pt-0.5">
                    {iss.message}
                    {iss.barcode && (
                      <span className="text-muted-foreground font-mono"> ({iss.barcode})</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {p && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <Row label="Model kodu" value={p.productMainId} mono />
                <Row label="Marka" value={p.brandName} />
                <Row label="Kategori" value={p.sourceCategory} />
                <Row label="KDV" value={p.vatRate !== null ? `%${p.vatRate}` : null} />
                <Row label="Desi" value={p.desi !== null ? String(p.desi) : null} />
                <Row label="Menşei" value={p.origin} />
                {p.description && (
                  <Row label="Açıklama" value={p.description.slice(0, 160)} clamp />
                )}
              </dl>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Barkod</th>
                      <th className="px-2 py-1.5 text-right font-medium">Stok</th>
                      <th className="px-2 py-1.5 text-right font-medium">Maliyet</th>
                      <th className="hidden px-2 py-1.5 text-left font-medium sm:table-cell">
                        Stok kodu
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.variants.map((v) => (
                      <tr key={v.barcode} className="border-t">
                        <td className="px-2 py-1.5 font-mono">
                          {v.barcode}
                          {Object.keys(v.attributes).length > 0 && (
                            <div className="text-muted-foreground font-sans">
                              {Object.entries(v.attributes)
                                .map(([k, val]) => `${k}: ${val}`)
                                .join(" · ")}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {formatNumber(v.stock)}
                        </td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                          {formatMoney(v.costPrice, v.currency)}
                        </td>
                        <td className="text-muted-foreground hidden px-2 py-1.5 font-mono sm:table-cell">
                          {v.stockCode ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {item.createMissing.length > 0 && (
                <p className="text-muted-foreground text-[11px]">
                  Trendyol&apos;da yeni ürün açmak için eksik (stok/fiyat senkronunu etkilemez):{" "}
                  {item.createMissing.map(fieldLabel).join(", ")}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Row({
  label,
  value,
  mono,
  clamp,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  clamp?: boolean;
}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          mono && "font-mono",
          clamp && "line-clamp-2",
          !value && "text-muted-foreground",
        )}
      >
        {value ?? "—"}
      </dd>
    </>
  );
}
