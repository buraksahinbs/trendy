import { sql } from "drizzle-orm";
import type { TenantTx } from "./client.js";

/**
 * Uyarılar (ROADMAP Faz 12 "Alarm kuralları"). Ayrı bir tablo tutulmaz: kurallar iş logları,
 * tedarikçiler ve kanal durumundan her istekte hesaplanır; sorun düzelince uyarı kendiliğinden
 * kaybolur. Tenant bağlamında çalışır (RLS).
 */
export type AlertLevel = "critical" | "warning" | "info";

export interface Alert {
  code: string;
  level: AlertLevel;
  title: string;
  message: string;
  /** İlgili kayıt (ör. tedarikçi id). */
  ref?: { type: "supplier"; id: number; name: string };
}

/** Siparişlerin bu süreden uzun çekilememesi uyarı sebebidir (çekim 5 dk'da bir). */
export const ORDERS_STALE_MS = 30 * 60_000;
const ORDER = { critical: 0, warning: 1, info: 2 } as const;

type LatestJob = {
  job_type: string;
  status: string;
  error_code: string | null;
  started_at: Date | string;
};

/** Not: ham SQL'de tarih parametreleri ISO metin olarak geçirilir (postgres.js `Date` kabul etmez). */
export async function tenantAlerts(
  tx: TenantTx,
  tenantId: number,
  now: Date = new Date(),
): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const add = (a: Alert) => void alerts.push(a);

  const [t] = await tx.execute<{
    sync_paused: boolean;
    sync_env: string;
    verified_at: Date | string | null;
  }>(sql`
    SELECT t.sync_paused, t.sync_env,
      (SELECT c.verified_at FROM trendyol_credentials c WHERE c.env = t.sync_env) AS verified_at
    FROM tenants t WHERE t.id = ${tenantId}
  `);
  if (!t) return [];

  // Trendyol işlerinin son durumları.
  const latest = await tx.execute<LatestJob>(sql`
    SELECT DISTINCT ON (job_type) job_type, status, summary->>'errorCode' AS error_code, started_at
    FROM job_logs WHERE job_type IN ('ty_sync', 'ty_import', 'ty_orders') AND status <> 'running'
    ORDER BY job_type, started_at DESC, id DESC
  `);
  if (latest.some((j) => j.status === "failed" && j.error_code === "auth")) {
    add({
      code: "credentials_invalid",
      level: "critical",
      title: "Trendyol API bilgileri geçersiz",
      message:
        "Trendyol istekleri yetki hatası (401/403) veriyor. API bilgileri değişmiş olabilir; Ayarlar > Trendyol'dan güncelleyip bağlantıyı test edin.",
    });
  }

  const [deprecated] = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM job_logs
    WHERE summary->>'errorCode' = 'deprecated_endpoint' AND started_at > ${new Date(now.getTime() - 7 * 86_400_000).toISOString()}
  `);
  if ((deprecated?.n ?? 0) > 0) {
    add({
      code: "deprecated_endpoint",
      level: "critical",
      title: "Trendyol bir servisi kapattı",
      message:
        "Trendyol kullanımdan kalkmış bir servis için hata (426) döndü. Destek ekibimiz bilgilendirilmeli.",
    });
  }

  const lastSyncs = await tx.execute<{ status: string }>(sql`
    SELECT status FROM job_logs WHERE job_type = 'ty_sync' AND status <> 'running'
    ORDER BY started_at DESC, id DESC LIMIT 3
  `);
  if (lastSyncs.length === 3 && lastSyncs.every((j) => j.status === "failed")) {
    add({
      code: "sync_failing",
      level: "critical",
      title: "Stok/fiyat senkronu art arda başarısız",
      message:
        "Son 3 senkron denemesi hata verdi; Trendyol'daki stoklar güncel olmayabilir. İşlem geçmişinden hatayı inceleyin.",
    });
  }

  const [rate] = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM job_logs
    WHERE summary->>'errorCode' = 'rate_limit' AND started_at > ${new Date(now.getTime() - 3_600_000).toISOString()}
  `);
  if ((rate?.n ?? 0) >= 3) {
    add({
      code: "rate_limited",
      level: "warning",
      title: "Trendyol istek limitine takılıyor",
      message:
        "Son bir saatte istekler sık sık limit hatası (429) aldı. Ayarlar'daki listeleme limiti seviyesinin doğru olduğundan emin olun.",
    });
  }

  if (t.verified_at) {
    const [o] = await tx.execute<{ last_ok: Date | string | null }>(sql`
      SELECT max(started_at) AS last_ok FROM job_logs WHERE job_type = 'ty_orders' AND status = 'success'
    `);
    const since = o?.last_ok ? new Date(o.last_ok) : new Date(t.verified_at);
    if (now.getTime() - since.getTime() > ORDERS_STALE_MS) {
      add({
        code: "orders_stale",
        level: "warning",
        title: "Siparişler güncel değil",
        message: `Siparişler ${Math.round((now.getTime() - since.getTime()) / 60_000)} dakikadır çekilemedi.`,
      });
    }
  } else {
    add({
      code: "credentials_unverified",
      level: "info",
      title: "Trendyol bağlantısı kurulmadı",
      message: `Senkron ortamı (${t.sync_env === "prod" ? "canlı" : "test"}) için API bilgilerini girip bağlantıyı test edin.`,
    });
  }

  if (t.sync_paused) {
    add({
      code: "sync_paused",
      level: "warning",
      title: "Senkron durduruldu",
      message:
        "Acil durdurma açık: Trendyol'a stok ve fiyat gönderilmiyor. Siparişler çekilmeye devam ediyor.",
    });
  }

  // Tedarikçi başına son çekimler.
  const suppliers = await tx.execute<{
    id: number | string;
    name: string;
    active: boolean;
    has_mapping: boolean;
    product_count: number;
    statuses: string[] | null;
    last_summary: Record<string, unknown> | null;
  }>(sql`
    SELECT s.id, s.name, s.active, s.mapping IS NOT NULL AS has_mapping,
      (SELECT count(*)::int FROM supplier_products sp WHERE sp.supplier_id = s.id) AS product_count,
      -- status enum; metne çevrilmezse sürücü enum dizisini diziye çevirmez ("{failed,...}" metni döner).
      (SELECT array_agg(status::text ORDER BY started_at DESC) FROM (
         SELECT status, started_at FROM job_logs j
         WHERE j.job_type = 'xml_fetch' AND j.status <> 'running' AND j.summary->>'supplierId' = s.id::text
         ORDER BY started_at DESC, id DESC LIMIT 3) x) AS statuses,
      (SELECT summary FROM job_logs j
         WHERE j.job_type = 'xml_fetch' AND j.status <> 'running' AND j.summary->>'supplierId' = s.id::text
         ORDER BY started_at DESC, id DESC LIMIT 1) AS last_summary
    FROM suppliers s ORDER BY s.id
  `);
  for (const s of suppliers) {
    if (!s.active) continue;
    const ref = { type: "supplier" as const, id: Number(s.id), name: s.name };
    const statuses = s.statuses ?? [];
    const last = s.last_summary ?? {};
    if (statuses.length === 3 && statuses.every((x) => x === "failed")) {
      add({
        code: "supplier_failing",
        level: "critical",
        title: `${s.name}: feed çekilemiyor`,
        message: "Son 3 çekim başarısız oldu; bu tedarikçinin stokları güncellenmiyor.",
        ref,
      });
    } else if (last.shrinkBlocked) {
      const rate = Number((last.shrinkBlocked as { dropRate?: number }).dropRate ?? 0);
      add({
        code: "supplier_shrink_blocked",
        level: "warning",
        title: `${s.name}: güvenlik freni devrede`,
        message: `Feed'deki ürün sayısı %${Math.round(rate * 100)} düştü; kaybolan ürünlerin stokları otomatik sıfırlanmadı. Feed'i kontrol edin.`,
        ref,
      });
    } else if (last.reason === "config_missing") {
      add({
        code: "supplier_config_missing",
        level: "warning",
        title: `${s.name}: yapılandırma eksik`,
        message: "Ürün düğümü yolu veya ürün kimliği alanı tanımlı değil; feed çekilemiyor.",
        ref,
      });
    }
    if (!s.has_mapping && s.product_count > 0) {
      add({
        code: "supplier_mapping_missing",
        level: "info",
        title: `${s.name}: alan eşleştirmesi yok`,
        message: "Ürünler çekildi ama eşleştirme yapılmadığı için Trendyol'a stok gönderilmiyor.",
        ref,
      });
    }
  }

  const [counts] = await tx.execute<{ reviews: number; listing_errors: number }>(sql`
    SELECT (SELECT count(*)::int FROM price_reviews WHERE status = 'pending') AS reviews,
           (SELECT count(*)::int FROM channel_listings WHERE last_error IS NOT NULL) AS listing_errors
  `);
  if ((counts?.listing_errors ?? 0) > 0) {
    add({
      code: "listing_errors",
      level: "warning",
      title: "Trendyol bazı güncellemeleri reddetti",
      message: `${counts!.listing_errors} ürünün son stok/fiyat gönderimi hata aldı; bir sonraki turda yeniden denenecek.`,
    });
  }
  if ((counts?.reviews ?? 0) > 0) {
    add({
      code: "price_reviews_pending",
      level: "info",
      title: "Onay bekleyen fiyatlar",
      message: `${counts!.reviews} ürünün fiyat değişikliği onayınızı bekliyor.`,
    });
  }

  return alerts.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
}
