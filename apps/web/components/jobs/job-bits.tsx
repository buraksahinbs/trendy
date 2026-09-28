import { CheckCircle2, CircleSlash, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { JobStatus, JobSummary } from "@/lib/api";
import { formatNumber, formatPercent } from "@/lib/format";

const STATUS: Record<
  JobStatus,
  { label: string; variant: "success" | "danger" | "info" | "muted"; icon: typeof CheckCircle2 }
> = {
  running: { label: "Çalışıyor", variant: "info", icon: Loader2 },
  success: { label: "Başarılı", variant: "success", icon: CheckCircle2 },
  failed: { label: "Hatalı", variant: "danger", icon: XCircle },
  skipped: { label: "Atlandı", variant: "muted", icon: CircleSlash },
};

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const s = STATUS[status] ?? STATUS.skipped;
  return (
    <Badge variant={s.variant}>
      <s.icon className={status === "running" ? "animate-spin" : undefined} />
      {s.label}
    </Badge>
  );
}

export const JOB_TYPE_LABEL: Record<string, string> = {
  xml_fetch: "XML çekimi",
  ty_sync: "Trendyol senkronu",
  ty_import: "Trendyol içe aktarma",
  ty_orders: "Sipariş çekme",
  ty_orders_backfill: "Sipariş geçmişi taraması",
};

export function jobTypeLabel(jobType: string): string {
  return JOB_TYPE_LABEL[jobType] ?? jobType;
}

/** Atlanma/duraklama nedenleri. */
const REASON_LABEL: Record<string, string> = {
  config_missing: "Yapılandırma eksik",
  inactive: "Tedarikçi pasif",
  sync_paused: "Acil durdurma açık",
  no_credentials: "Trendyol bilgileri yok",
  not_verified: "Trendyol bilgileri doğrulanmamış",
  no_tenant: "Mağaza bulunamadı",
};

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}

const SKIP_LABEL: Record<string, string> = {
  unmanaged: "feed dışı",
  not_listed: "Trendyol'da yok",
  not_approved: "onaysız",
  supplier_paused: "tedarikçi duraklatılmış",
  unchanged: "değişmemiş",
};

const PRICE_NOTE_LABEL: Record<string, string> = {
  no_rule: "fiyat kuralı yok",
  no_cost: "maliyet yok",
  fx_missing: "kur eksik",
  blocked: "maliyet altı engellendi",
  needs_review: "onay bekliyor",
  orphan: "sahipsiz",
};

export function isConfigMissing(
  job: { status: JobStatus; summary: JobSummary | null } | undefined,
): boolean {
  return job?.status === "skipped" && job.summary?.reason === "config_missing";
}

export function shrinkBlockedText(sb: NonNullable<JobSummary["shrinkBlocked"]>): string {
  return sb.reason === "empty_feed"
    ? "feed boş geldi"
    : `feed'deki ürün sayısı ${formatPercent(sb.dropRate)} düştü`;
}

type Chip = {
  label: string;
  variant: "success" | "warning" | "danger" | "info" | "muted" | "outline";
};

export function summaryChips(summary: JobSummary | null, jobType?: string): Chip[] {
  if (!summary) return [];
  const chips: Chip[] = [];
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  const push = (v: number | null, label: string, variant: Chip["variant"], showZero = false) => {
    if (v === null || (!showZero && v === 0)) return;
    chips.push({ label: `${formatNumber(v)} ${label}`, variant });
  };

  if (summary.reason) chips.push({ label: reasonLabel(summary.reason), variant: "warning" });

  if (jobType === "ty_sync") {
    push(n(summary.sent), "gönderildi", "success", true);
    push(n(summary.batches), "batch", "outline");
    push(n(summary.reviews), "fiyat onaya düştü", "warning");
    push(n(summary.stockCapped), "stok 20.000'e indirildi", "info");
    for (const [k, v] of Object.entries(summary.skipped ?? {}))
      if (k !== "unchanged") push(v, SKIP_LABEL[k] ?? k, "muted");
    for (const [k, v] of Object.entries(summary.priceNotes ?? {}))
      push(v, `fiyat: ${PRICE_NOTE_LABEL[k] ?? k}`, k === "blocked" ? "danger" : "muted");
    return chips;
  }
  if (jobType === "ty_orders" || jobType === "ty_orders_backfill") {
    push(n(summary.fetched), "paket okundu", "outline", true);
    push(n(summary.created), "yeni sipariş", "success");
    push(n(summary.updated), "güncellendi", "info");
    push(n(summary.windows), "zaman aralığı", "muted");
    return chips;
  }
  if (jobType === "ty_import") {
    push(n(summary.approved), "onaylı", "success", true);
    push(n(summary.unapproved), "onaysız", "muted");
    push(n(summary.created), "yeni eşleşme", "info");
    push(n(summary.unseen), "Trendyol'da görünmüyor", "warning");
    return chips;
  }

  if (summary.notModified) chips.push({ label: "Feed değişmemiş", variant: "info" });
  if (summary.shrinkBlocked)
    chips.push({
      label:
        summary.shrinkBlocked.reason === "empty_feed"
          ? "Güvenlik freni · boş feed"
          : `Güvenlik freni · ${formatPercent(summary.shrinkBlocked.dropRate)} düşüş`,
      variant: "warning",
    });
  push(n(summary.itemCount), "ürün", "outline", true);
  const inserted = n(summary.inserted);
  if (inserted) chips.push({ label: `+${formatNumber(inserted)} yeni`, variant: "success" });
  push(n(summary.updated), "güncellendi", "info");
  push(n(summary.unchanged), "aynı", "muted");
  push(n(summary.missing), "kayıp", "warning");
  push(n(summary.invalidItems), "kimliksiz", "danger");
  push(n(summary.duplicateIds), "tekrar eden kimlik", "warning");
  const norm = summary.normalize;
  if (norm) {
    if (norm.skipped === "mapping_missing")
      chips.push({ label: "Eşleştirme yok", variant: "warning" });
    else if (norm.skipped === "mapping_invalid")
      chips.push({ label: "Eşleştirme geçersiz", variant: "danger" });
    else {
      push(norm.variants, "varyant işlendi", "success");
      push(norm.itemsWithErrors, "hatalı ürün", "danger");
      push(norm.conflicts, "çakışma", "warning");
    }
  }
  return chips;
}

export function SummaryChips({
  summary,
  jobType,
  max,
}: {
  summary: JobSummary | null;
  jobType?: string;
  max?: number;
}) {
  const chips = summaryChips(summary, jobType);
  if (chips.length === 0) return <span className="text-muted-foreground">—</span>;
  const shown = max ? chips.slice(0, max) : chips;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <Badge key={c.label} variant={c.variant} className="font-normal">
          {c.label}
        </Badge>
      ))}
      {max && chips.length > max && (
        <Badge variant="muted" className="font-normal">
          +{chips.length - max}
        </Badge>
      )}
    </div>
  );
}
