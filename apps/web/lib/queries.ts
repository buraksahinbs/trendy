"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  api,
  errorMessage,
  type ListingsQuery,
  type MappingConfig,
  type OrdersQuery,
  type PricingRuleInput,
  type ReviewStatus,
  type Supplier,
  type SupplierInput,
  type SupplierPatch,
  type TenantSettings,
  type TrendyolEnv,
} from "@/lib/api";

export const keys = {
  me: ["me"] as const,
  credentials: ["trendyol", "credentials"] as const,
  status: ["trendyol", "status"] as const,
  listings: (q: ListingsQuery) => ["trendyol", "listings", q] as const,
  reviews: (status: ReviewStatus) => ["trendyol", "reviews", status] as const,
  settings: ["settings"] as const,
  pricingRules: ["pricing-rules"] as const,
  alerts: ["alerts"] as const,
  webhook: ["settings", "webhook"] as const,
  orders: (q: OrdersQuery) => ["orders", q] as const,
  order: (id: number) => ["orders", "detail", id] as const,
  suppliers: ["suppliers"] as const,
  supplier: (id: number) => ["suppliers", id] as const,
  supplierProducts: (id: number, offset: number, limit: number) =>
    ["suppliers", id, "products", { offset, limit }] as const,
  supplierReport: (id: number) => ["suppliers", id, "report"] as const,
  jobs: (supplierId?: number) => ["jobs", supplierId ?? "all"] as const,
};

export function useMe() {
  return useQuery({ queryKey: keys.me, queryFn: api.auth.me, staleTime: 60_000 });
}

/** Aktif mağazadaki rol; owner değilse yazma işlemleri kapatılır. */
export function useRole() {
  const { data } = useMe();
  return { role: data?.role ?? null, isOwner: data?.role === "owner" };
}

// ── Trendyol ────────────────────────────────────────────────────────────────

export function useCredentials() {
  return useQuery({ queryKey: keys.credentials, queryFn: api.trendyol.credentials });
}

export function useTrendyolStatus() {
  return useQuery({
    queryKey: keys.status,
    queryFn: api.trendyol.status,
    // Senkron sürüyorsa ya da batch bekliyorsa durumu canlı tut
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.lastSync?.status === "running" || d.pendingBatches > 0) ? 10_000 : 60_000;
    },
  });
}

export function useListings(q: ListingsQuery) {
  return useQuery({
    queryKey: keys.listings(q),
    queryFn: () => api.trendyol.listings(q),
    placeholderData: keepPreviousData,
  });
}

export function usePriceReviews(status: ReviewStatus) {
  return useQuery({
    queryKey: keys.reviews(status),
    queryFn: () => api.trendyol.priceReviews(status),
  });
}

export function useDecideReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: "approve" | "reject" }) =>
      api.trendyol.decideReview(id, decision),
    onSuccess: (_r, { decision }) => {
      toast.success(decision === "approve" ? "Fiyat onaylandı" : "Fiyat reddedildi", {
        description:
          decision === "approve"
            ? "Yeni fiyat bir sonraki senkronda Trendyol'a gönderilecek."
            : "Bu fiyat gönderilmeyecek.",
      });
    },
    onError: (err) => toast.error(errorMessage(err)),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["trendyol", "reviews"] }),
        qc.invalidateQueries({ queryKey: keys.status }),
        qc.invalidateQueries({ queryKey: keys.alerts }),
      ]),
  });
}

export function useSaveCredentials(env: TrendyolEnv) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sellerId: string; apiKey: string; apiSecret: string }) =>
      api.trendyol.saveCredentials(env, input),
    onSuccess: () => {
      toast.success(`${env === "prod" ? "Canlı" : "Test"} ortam bilgileri kaydedildi`, {
        description: "Bağlantıyı test ederek bilgilerin doğru olduğundan emin olun.",
      });
      return qc.invalidateQueries({ queryKey: keys.credentials });
    },
  });
}

export function useVerifyCredentials(env: TrendyolEnv) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.trendyol.verify(env),
    onSuccess: (res) => {
      if (res.verified) {
        toast.success("Bağlantı başarılı", {
          description:
            res.approvedContentCount !== null
              ? `Trendyol'da ${res.approvedContentCount.toLocaleString("tr-TR")} onaylı ürün görüldü. İçe aktarma başlatıldı.`
              : "Trendyol ürünleriniz içe aktarılıyor.",
        });
        void qc.invalidateQueries({ queryKey: keys.status });
      }
      return qc.invalidateQueries({ queryKey: keys.credentials });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useTriggerTrendyol(kind: "sync" | "import") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => (kind === "sync" ? api.trendyol.sync() : api.trendyol.import()),
    onSuccess: (res) => {
      const what = kind === "sync" ? "Senkron" : "İçe aktarma";
      if (res.queued) toast.success(`${what} sıraya alındı`);
      else
        toast.info(`${what} zaten sırada`, { description: "Mevcut iş bitince sonuç görünecek." });
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: keys.status });
        void qc.invalidateQueries({ queryKey: ["jobs"] });
      }, 1500);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

// ── Ayarlar ─────────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: api.settings.get });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<TenantSettings>) => api.settings.update(patch),
    onSuccess: (data) => {
      qc.setQueryData(keys.settings, data);
      void qc.invalidateQueries({ queryKey: keys.status });
      void qc.invalidateQueries({ queryKey: keys.me });
      void qc.invalidateQueries({ queryKey: keys.alerts });
    },
  });
}

// ── Fiyat kuralları ─────────────────────────────────────────────────────────

export function usePricingRules() {
  return useQuery({ queryKey: keys.pricingRules, queryFn: api.pricing.list });
}

export function useSavePricingRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: number; input: PricingRuleInput }) =>
      id ? api.pricing.update(id, input) : api.pricing.create(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.status });
      return qc.invalidateQueries({ queryKey: keys.pricingRules });
    },
  });
}

export function useDeletePricingRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.pricing.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.pricingRules }),
  });
}

// ── Tedarikçiler ────────────────────────────────────────────────────────────

export function useSuppliers() {
  return useQuery({ queryKey: keys.suppliers, queryFn: api.suppliers.list });
}

export function useSupplier(id: number) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.supplier(id),
    queryFn: () => api.suppliers.get(id),
    // Listeden gelen kayıt varsa anında göster
    initialData: () => qc.getQueryData<Supplier[]>(keys.suppliers)?.find((s) => s.id === id),
    initialDataUpdatedAt: () => qc.getQueryState(keys.suppliers)?.dataUpdatedAt,
  });
}

export function useSupplierProducts(id: number, offset: number, limit: number) {
  return useQuery({
    queryKey: keys.supplierProducts(id, offset, limit),
    queryFn: () => api.suppliers.products(id, { offset, limit }),
    placeholderData: keepPreviousData,
  });
}

export function useSupplierReport(id: number) {
  return useQuery({ queryKey: keys.supplierReport(id), queryFn: () => api.suppliers.report(id) });
}

export function useJobs(supplierId?: number) {
  return useQuery({
    queryKey: keys.jobs(supplierId),
    queryFn: () => api.jobs.list(supplierId ? { limit: 50, supplierId } : { limit: 50 }),
    // Çalışan bir iş varsa listeyi canlı tut
    refetchInterval: (query) =>
      query.state.data?.some((j) => j.status === "running") ? 5_000 : false,
  });
}

export function useCreateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SupplierInput) => api.suppliers.create(input),
    onSuccess: () => {
      toast.success("Tedarikçi eklendi", {
        description: "Şimdi ilk çekimi yapıp alan eşleştirmesini tamamlayın.",
      });
      return qc.invalidateQueries({ queryKey: keys.suppliers });
    },
  });
}

export function useUpdateSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: SupplierPatch }) =>
      api.suppliers.update(id, patch),
    onSuccess: (supplier) => {
      qc.setQueryData(keys.supplier(supplier.id), supplier);
      return qc.invalidateQueries({ queryKey: keys.suppliers });
    },
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.suppliers.remove(id),
    onSuccess: (_r, id) => {
      toast.success("Tedarikçi silindi");
      qc.removeQueries({ queryKey: keys.supplier(id) });
      return qc.invalidateQueries({ queryKey: keys.suppliers, exact: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useFetchSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.suppliers.fetchNow(id),
    onSuccess: (res) => {
      if (res.queued)
        toast.success("Çekim sıraya alındı", {
          description: "Sonuç birkaç saniye içinde işlem geçmişinde görünecek.",
        });
      else toast.info("Bu tedarikçi için zaten bir çekim sırada");
      // İş kaydı kuyruktan hemen sonra oluşur; kısa bir gecikmeyle tazele.
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["jobs"] });
        void qc.invalidateQueries({ queryKey: keys.suppliers });
      }, 1500);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useSaveMapping(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mapping: MappingConfig) => api.suppliers.saveMapping(id, mapping),
    onSuccess: (supplier) => {
      qc.setQueryData(keys.supplier(id), supplier);
      toast.success("Eşleştirme kaydedildi", {
        description: "Ürünler yeni eşleştirmeyle yeniden işlenmek üzere sıraya alındı.",
      });
      void qc.invalidateQueries({ queryKey: keys.suppliers, exact: true });
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["jobs"] });
        void qc.invalidateQueries({ queryKey: keys.supplierReport(id) });
      }, 1500);
    },
  });
}

// ── Siparişler ──────────────────────────────────────────────────────────────

export function useOrders(q: OrdersQuery) {
  return useQuery({
    queryKey: keys.orders(q),
    queryFn: () => api.orders.list(q),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useOrder(id: number | null) {
  return useQuery({
    queryKey: keys.order(id ?? 0),
    queryFn: () => api.orders.get(id!),
    enabled: id !== null,
  });
}

export function useSyncOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.orders.sync(),
    onSuccess: (res) => {
      if (res.queued)
        toast.success("Sipariş çekimi sıraya alındı", {
          description: "Yeni siparişler birkaç saniye içinde listede görünecek.",
        });
      else toast.info("Sipariş çekimi zaten sırada");
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["orders"] });
        void qc.invalidateQueries({ queryKey: ["jobs"] });
      }, 3000);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useBackfillOrders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { from: string; to: string }) => api.orders.backfill(input),
    onSuccess: () => {
      toast.success("Geçmiş sipariş taraması sıraya alındı", {
        description: "İlerlemeyi İşlem Geçmişi'nden takip edebilirsiniz.",
      });
      setTimeout(() => void qc.invalidateQueries({ queryKey: ["jobs"] }), 1500);
    },
  });
}

export function useWebhook(enabled: boolean) {
  return useQuery({ queryKey: keys.webhook, queryFn: api.settings.webhook, enabled });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.settings.createWebhook(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.webhook }),
    onError: (err) => toast.error(errorMessage(err)),
  });
}

// ── Uyarılar ────────────────────────────────────────────────────────────────

export function useAlerts() {
  return useQuery({ queryKey: keys.alerts, queryFn: api.alerts, refetchInterval: 60_000 });
}
