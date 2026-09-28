"use client";

import { ChevronDown, ChevronLeft, ChevronRight, PackageSearch } from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { JsonViewer } from "@/components/json-viewer";
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
import type { SupplierProduct } from "@/lib/api";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { useSupplierProducts } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

// Tabloda gösterilecek ham alanlar için tercih sırası (Türkçe ve İngilizce adlar).
const PREFERRED = [
  /^(urun_?)?ad[iı]?$|name|isim|baslik|başlık|title/i,
  /fiyat|price/i,
  /stok|stock|miktar|quantity|adet/i,
  /barkod|barcode|ean|gtin/i,
];

/** XML'den gelen değeri tek satırlık metne çevirir; `#text` düğümlerini açar. */
function cellValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && !Array.isArray(v) && "#text" in v) {
    return cellValue((v as Record<string, unknown>)["#text"]);
  }
  return null;
}

export function pickColumns(items: SupplierProduct[], max = 3): string[] {
  const first = items[0]?.raw;
  if (!first) return [];
  const keys = Object.keys(first).filter((k) => cellValue(first[k]) !== null);
  const chosen: string[] = [];
  for (const re of PREFERRED) {
    const k = keys.find((key) => re.test(key) && !chosen.includes(key));
    if (k) chosen.push(k);
    if (chosen.length >= max) return chosen;
  }
  for (const k of keys) {
    if (chosen.length >= max) break;
    if (!chosen.includes(k)) chosen.push(k);
  }
  return chosen;
}

export function SupplierProducts({ supplierId }: { supplierId: number }) {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const products = useSupplierProducts(supplierId, page * PAGE_SIZE, PAGE_SIZE);
  const data = products.data;
  const columns = useMemo(() => pickColumns(data?.items ?? []), [data]);

  if (products.isError)
    return <ErrorState error={products.error} onRetry={() => void products.refetch()} />;
  if (products.isPending) return <ProductsSkeleton />;
  if (!data || data.total === 0)
    return (
      <EmptyState
        icon={PackageSearch}
        title="Henüz ürün okunmadı"
        description="İlk XML çekimi tamamlandığında tedarikçinin ürünleri burada listelenecek."
      />
    );

  const from = page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, data.total);
  const lastPage = Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1);

  return (
    <div className="space-y-3">
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
        <span>
          Toplam <span className="text-foreground font-medium">{formatNumber(data.total)}</span>{" "}
          ürün
        </span>
        {data.missing > 0 && (
          <Badge variant="warning" className="font-normal">
            {formatNumber(data.missing)} ürün feed&apos;de artık yok
          </Badge>
        )}
      </div>
      <div
        className={cn(
          "bg-card overflow-hidden rounded-xl border transition-opacity",
          products.isPlaceholderData && "opacity-60",
        )}
      >
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10" />
              <TableHead>Kimlik</TableHead>
              {columns.map((c) => (
                <TableHead key={c} className="hidden md:table-cell">
                  {c}
                </TableHead>
              ))}
              <TableHead className="hidden sm:table-cell">Son görülme</TableHead>
              <TableHead className="w-24">Durum</TableHead>
              <TableHead className="w-28">Eşleştirme</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((p) => {
              const open = expanded === p.id;
              return (
                <Fragment key={p.id}>
                  <TableRow
                    className={cn("cursor-pointer", open && "bg-muted/30")}
                    onClick={() => setExpanded(open ? null : p.id)}
                  >
                    <TableCell>
                      <ChevronDown
                        className={cn(
                          "text-muted-foreground size-4 transition-transform",
                          open && "rotate-180",
                        )}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs font-medium">{p.externalId}</TableCell>
                    {columns.map((c) => (
                      <TableCell key={c} className="hidden max-w-[16rem] truncate md:table-cell">
                        {cellValue(p.raw[c]) ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    ))}
                    <TableCell
                      className="text-muted-foreground hidden sm:table-cell"
                      title={formatDateTime(p.lastSeenAt)}
                    >
                      {formatRelative(p.lastSeenAt)}
                    </TableCell>
                    <TableCell>
                      {p.missingSince ? (
                        <Badge
                          variant="warning"
                          title={`${formatDateTime(p.missingSince)} tarihinden beri feed'de yok`}
                        >
                          kayıp
                        </Badge>
                      ) : (
                        <Badge variant="success">feed&apos;de</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <IssueBadge product={p} />
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={columns.length + 5}
                        className="bg-muted/20 whitespace-normal"
                      >
                        <div className="space-y-3 py-1">
                          {p.normalizeIssues && p.normalizeIssues.length > 0 && (
                            <ul className="space-y-1">
                              {p.normalizeIssues.map((iss, i) => (
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
                                      <span className="text-muted-foreground font-mono">
                                        {" "}
                                        ({iss.barcode})
                                      </span>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <JsonViewer
                            value={p.raw}
                            className="bg-background max-h-96 overflow-y-auto"
                          />
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
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-sm tabular-nums">
          {formatNumber(from)}–{formatNumber(to)} / {formatNumber(data.total)}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPage((p) => Math.max(0, p - 1));
              setExpanded(null);
            }}
            disabled={page === 0}
          >
            <ChevronLeft /> Önceki
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setPage((p) => Math.min(lastPage, p + 1));
              setExpanded(null);
            }}
            disabled={page >= lastPage}
          >
            Sonraki <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function IssueBadge({ product: p }: { product: SupplierProduct }) {
  const issues = p.normalizeIssues ?? [];
  const errors = issues.filter((i) => i.level === "error").length;
  if (errors > 0) return <Badge variant="danger">{errors} hata</Badge>;
  if (issues.length > 0) return <Badge variant="warning">{issues.length} uyarı</Badge>;
  if (p.normalizedAt) return <Badge variant="success">sorunsuz</Badge>;
  return <span className="text-muted-foreground text-xs">işlenmedi</span>;
}

function ProductsSkeleton() {
  return (
    <div className="bg-card space-y-3 rounded-xl border p-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  );
}
