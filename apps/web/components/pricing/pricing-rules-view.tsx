"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { Calculator, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { OwnerOnly } from "@/components/owner-only";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebounced } from "@/hooks/use-debounced";
import {
  api,
  errorMessage,
  type PricingRule,
  type PricingRuleInput,
  type RuleScope,
  type Supplier,
} from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";
import { formatChangeRate, formatMoney } from "@/lib/format";
import {
  useDeletePricingRule,
  usePricingRules,
  useSavePricingRule,
  useSettings,
  useSuppliers,
} from "@/lib/queries";

const SCOPES: { value: RuleScope; label: string; hint: string }[] = [
  { value: "general", label: "Genel", hint: "Başka kural eşleşmeyen tüm ürünler" },
  { value: "supplier", label: "Tedarikçi", hint: "Seçilen tedarikçinin ürünleri" },
  { value: "category", label: "Kategori", hint: "Feed'deki kategori adıyla birebir" },
  { value: "brand", label: "Marka", hint: "Feed'deki marka adıyla birebir" },
];
const scopeLabel = (s: RuleScope) => SCOPES.find((x) => x.value === s)!.label;
/** Aynı ürüne birden çok kural uyarsa en spesifik olan kazanır. */
const SCOPE_ORDER: RuleScope[] = ["brand", "category", "supplier", "general"];

const ROUNDINGS = [
  { value: "none", label: "Yuvarlama yok" },
  { value: "90", label: "x,90 ile bitsin" },
  { value: "99", label: "x,99 ile bitsin" },
  { value: "50", label: "x,50 ile bitsin" },
  { value: "0", label: "Tam lira (x,00)" },
];

// ── Form ────────────────────────────────────────────────────────────────────

/** "1,5" ve "1.5" kabul edilir; boş → null. */
const parseNum = (s: string) => {
  const t = s.trim().replace(/\s/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
const numField = (opts: { required?: boolean; min?: number; max?: number; label: string }) =>
  z.string().superRefine((v, ctx) => {
    const n = parseNum(v);
    if (n === null) {
      if (opts.required) ctx.addIssue({ code: "custom", message: `${opts.label} girin` });
      return;
    }
    if (Number.isNaN(n)) ctx.addIssue({ code: "custom", message: "Sayı girin (ör. 1,5)" });
    else if (opts.min !== undefined && n < opts.min)
      ctx.addIssue({ code: "custom", message: `En az ${String(opts.min).replace(".", ",")}` });
    else if (opts.max !== undefined && n > opts.max)
      ctx.addIssue({ code: "custom", message: `En fazla ${String(opts.max).replace(".", ",")}` });
  });

const formSchema = z
  .object({
    scope: z.enum(["general", "supplier", "category", "brand"]),
    scopeKey: z.string().trim().max(200),
    multiplier: numField({ required: true, min: 0.1, max: 20, label: "Çarpan" }),
    addFixed: numField({ min: 0, max: 1_000_000, label: "Sabit tutar" }),
    rounding: z.string(),
    commissionPct: numField({ min: 0, max: 90, label: "Komisyon" }),
    minMarginPct: numField({ min: 0, max: 90, label: "Asgari kâr" }),
    minPrice: numField({ min: 0.01, max: 1_000_000, label: "Asgari fiyat" }),
    maxPrice: numField({ min: 0.01, max: 1_000_000, label: "Azami fiyat" }),
    listMultiplier: numField({ min: 1, max: 5, label: "Liste fiyatı çarpanı" }),
  })
  .superRefine((v, ctx) => {
    if (v.scope !== "general" && !v.scopeKey) {
      ctx.addIssue({
        code: "custom",
        path: ["scopeKey"],
        message: v.scope === "supplier" ? "Tedarikçi seçin" : "Değer girin",
      });
    }
    const min = parseNum(v.minPrice);
    const max = parseNum(v.maxPrice);
    if (min !== null && max !== null && max < min) {
      ctx.addIssue({ code: "custom", path: ["maxPrice"], message: "Asgari fiyattan küçük olamaz" });
    }
  });
type FormValues = z.infer<typeof formSchema>;
const FIELDS = Object.keys(formSchema.shape) as (keyof FormValues)[];

const tl = (s: string) => {
  const n = parseNum(s);
  return n === null ? null : Math.round(n * 100);
};
const pct = (s: string) => {
  const n = parseNum(s);
  return n === null ? null : Math.round(n * 100) / 10_000;
};
const text = (n: number | null, scale = 1) =>
  n === null ? "" : String(Math.round(n * scale * 10_000) / 10_000).replace(".", ",");

function toInput(v: FormValues): PricingRuleInput {
  const list = parseNum(v.listMultiplier);
  return {
    scope: v.scope,
    scopeKey: v.scope === "general" ? null : v.scopeKey.trim(),
    multiplier: parseNum(v.multiplier) ?? 1,
    addFixed: tl(v.addFixed) ?? 0,
    rounding:
      v.rounding === "none" ? { kind: "none" } : { kind: "ending", kurus: Number(v.rounding) },
    commissionRate: pct(v.commissionPct),
    minMarginRate: pct(v.minMarginPct),
    minPrice: tl(v.minPrice),
    maxPrice: tl(v.maxPrice),
    listPriceRule:
      list === null || list === 1 ? { kind: "same" } : { kind: "multiplier", value: list },
  };
}

function toForm(r: PricingRule | null, defaultScope: RuleScope): FormValues {
  if (!r) {
    return {
      scope: defaultScope,
      scopeKey: "",
      multiplier: "",
      addFixed: "",
      rounding: "90",
      commissionPct: "",
      minMarginPct: "",
      minPrice: "",
      maxPrice: "",
      listMultiplier: "",
    };
  }
  return {
    scope: r.scope,
    scopeKey: r.scopeKey ?? "",
    multiplier: text(r.multiplier),
    addFixed: r.addFixed ? text(r.addFixed, 0.01) : "",
    rounding: r.rounding.kind === "none" ? "none" : String(r.rounding.kurus),
    commissionPct: text(r.commissionRate, 100),
    minMarginPct: text(r.minMarginRate, 100),
    minPrice: text(r.minPrice, 0.01),
    maxPrice: text(r.maxPrice, 0.01),
    listMultiplier: r.listPriceRule.kind === "same" ? "" : text(r.listPriceRule.value),
  };
}

// ── Sayfa ───────────────────────────────────────────────────────────────────

export function PricingRulesView() {
  const rules = usePricingRules();
  const suppliers = useSuppliers();
  const [editing, setEditing] = useState<PricingRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<PricingRule | null>(null);
  const hasGeneral = rules.data?.some((r) => r.scope === "general") ?? false;
  const supplierName = (id: string | null) =>
    suppliers.data?.find((s) => String(s.id) === id)?.name ?? `#${id}`;

  const sorted = [...(rules.data ?? [])].sort(
    (a, b) => SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope) || a.id - b.id,
  );

  return (
    <>
      <PageHeader
        title="Fiyat Kuralları"
        description="Tedarikçi maliyetinden Trendyol satış fiyatını hesaplayan kurallar. Bir ürüne birden çok kural uyarsa en spesifik olan kullanılır: marka › kategori › tedarikçi › genel."
        actions={
          <OwnerOnly>
            {({ disabled }) => (
              <Button disabled={disabled} onClick={() => setEditing("new")}>
                <Plus /> Kural ekle
              </Button>
            )}
          </OwnerOnly>
        }
      />

      {rules.isSuccess && rules.data.length > 0 && !hasGeneral && (
        <Alert className="mb-4">
          <AlertDescription>
            Genel kural yok: hiçbir kurala uymayan ürünlerde yalnızca stok gönderilir, fiyat
            gönderilmez.
          </AlertDescription>
        </Alert>
      )}

      {rules.isError ? (
        <ErrorState error={rules.error} onRetry={() => void rules.refetch()} />
      ) : rules.isPending ? (
        <div className="bg-card space-y-4 rounded-xl border p-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : rules.data.length === 0 ? (
        <EmptyState
          icon={Calculator}
          title="Henüz fiyat kuralı yok"
          description="Kural tanımlanana kadar Trendyol'a yalnızca stok gönderilir; fiyatlar değişmez. Başlamak için bir genel kural ekleyin."
          action={
            <OwnerOnly>
              {({ disabled }) => (
                <Button disabled={disabled} onClick={() => setEditing("new")}>
                  <Plus /> Genel kural ekle
                </Button>
              )}
            </OwnerOnly>
          }
        />
      ) : (
        <div className="bg-card overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="hover:bg-transparent">
                <TableHead>Kapsam</TableHead>
                <TableHead>Hesap</TableHead>
                <TableHead className="hidden md:table-cell">Sınırlar</TableHead>
                <TableHead className="w-28 text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge variant={r.scope === "general" ? "secondary" : "outline"}>
                      {scopeLabel(r.scope)}
                    </Badge>
                    {r.scopeKey !== null && (
                      <div className="mt-1 text-sm font-medium">
                        {r.scope === "supplier" ? supplierName(r.scopeKey) : r.scopeKey}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm whitespace-normal">
                    <RuleFormula rule={r} />
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden text-sm whitespace-normal md:table-cell">
                    <RuleLimits rule={r} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <OwnerOnly>
                        {({ disabled }) => (
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={disabled}
                            aria-label="Düzenle"
                            onClick={() => setEditing(r)}
                          >
                            <Pencil />
                          </Button>
                        )}
                      </OwnerOnly>
                      <OwnerOnly>
                        {({ disabled }) => (
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={disabled}
                            aria-label="Sil"
                            onClick={() => setDeleting(r)}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </OwnerOnly>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-muted-foreground mt-4 text-xs">
        Döviz cinsinden maliyetler için kurları{" "}
        <Link href="/ayarlar" className="text-foreground underline-offset-4 hover:underline">
          Ayarlar
        </Link>
        &apos;dan girin. Büyük fiyat değişimleri gönderilmeden önce Fiyat Onayları&apos;na düşer.
      </p>

      <RuleSheet
        rule={editing === "new" ? null : editing}
        open={editing !== null}
        defaultScope={hasGeneral ? "supplier" : "general"}
        suppliers={suppliers.data ?? []}
        onOpenChange={(o) => !o && setEditing(null)}
      />
      <DeleteDialog rule={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

function RuleFormula({ rule: r }: { rule: PricingRule }) {
  const parts = [`Maliyet × ${text(r.multiplier)}`];
  if (r.addFixed) parts.push(`+ ${formatMoney(r.addFixed)}`);
  const rounding =
    r.rounding.kind === "none"
      ? null
      : r.rounding.kurus === 0
        ? "tam liraya yuvarla"
        : `x,${String(r.rounding.kurus).padStart(2, "0")} ile bitir`;
  return (
    <div className="space-y-0.5">
      <div className="font-medium tabular-nums">{parts.join(" ")}</div>
      <div className="text-muted-foreground text-xs">
        {[
          rounding,
          r.listPriceRule.kind === "multiplier" && `liste fiyatı × ${text(r.listPriceRule.value)}`,
        ]
          .filter(Boolean)
          .join(" · ") || "yuvarlama yok"}
      </div>
    </div>
  );
}

function RuleLimits({ rule: r }: { rule: PricingRule }) {
  const items = [
    r.commissionRate !== null && `komisyon %${text(r.commissionRate, 100)}`,
    r.minMarginRate !== null && `asgari kâr %${text(r.minMarginRate, 100)}`,
    r.minPrice !== null && `en az ${formatMoney(r.minPrice)}`,
    r.maxPrice !== null && `en çok ${formatMoney(r.maxPrice)}`,
  ].filter(Boolean);
  return <>{items.length ? items.join(" · ") : "—"}</>;
}

// ── Ekle / düzenle ──────────────────────────────────────────────────────────

function RuleSheet({
  rule,
  open,
  defaultScope,
  suppliers,
  onOpenChange,
}: {
  rule: PricingRule | null;
  open: boolean;
  defaultScope: RuleScope;
  suppliers: Supplier[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>{rule ? "Kuralı düzenle" : "Fiyat kuralı ekle"}</SheetTitle>
          <SheetDescription>
            Hesap sırası: maliyet → kur → çarpan → sabit tutar → asgari kâr → yuvarlama → fiyat
            sınırları.
          </SheetDescription>
        </SheetHeader>
        {open && (
          <RuleForm
            key={rule?.id ?? "new"}
            rule={rule}
            defaultScope={defaultScope}
            suppliers={suppliers}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function RuleForm({
  rule,
  defaultScope,
  suppliers,
  onDone,
}: {
  rule: PricingRule | null;
  defaultScope: RuleScope;
  suppliers: Supplier[];
  onDone: () => void;
}) {
  const save = useSavePricingRule();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(rule, defaultScope),
  });
  const scope = useWatch({ control: form.control, name: "scope" });

  const submit = form.handleSubmit((v) =>
    save.mutate(
      { ...(rule ? { id: rule.id } : {}), input: toInput(v) },
      {
        onSuccess: () => {
          toast.success(rule ? "Kural güncellendi" : "Kural eklendi", {
            description: "Fiyatlar bir sonraki senkronda bu kurala göre hesaplanacak.",
          });
          onDone();
        },
        onError: (err) => applyApiError(err, form.setError, FIELDS),
      },
    ),
  );

  return (
    <Form {...form}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="scope"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Kapsam</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      form.setValue("scopeKey", "");
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SCOPES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>{SCOPES.find((s) => s.value === scope)?.hint}</FormDescription>
                </FormItem>
              )}
            />
            {scope !== "general" && (
              <FormField
                control={form.control}
                name="scopeKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {scope === "supplier"
                        ? "Tedarikçi"
                        : scope === "brand"
                          ? "Marka"
                          : "Kategori"}
                    </FormLabel>
                    {scope === "supplier" ? (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Seçin" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <FormControl>
                        <Input placeholder={scope === "brand" ? "Acme" : "Ayakkabı"} {...field} />
                      </FormControl>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <NumInput control={form.control} name="multiplier" label="Çarpan" placeholder="1,5" />
            <NumInput
              control={form.control}
              name="addFixed"
              label="Sabit ekleme"
              placeholder="0"
              suffix="₺"
              description="Kargo, paketleme vb."
            />
            <FormField
              control={form.control}
              name="rounding"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Yuvarlama</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ROUNDINGS.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />
            <NumInput
              control={form.control}
              name="listMultiplier"
              label="Liste fiyatı çarpanı"
              placeholder="1"
              description="Üstü çizili fiyat; boş = satış fiyatı"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <NumInput
              control={form.control}
              name="commissionPct"
              label="Trendyol komisyonu"
              placeholder="20"
              suffix="%"
            />
            <NumInput
              control={form.control}
              name="minMarginPct"
              label="Asgari kâr"
              placeholder="10"
              suffix="%"
              description="Komisyon sonrası maliyet üzerine"
            />
            <NumInput control={form.control} name="minPrice" label="Asgari fiyat" suffix="₺" />
            <NumInput control={form.control} name="maxPrice" label="Azami fiyat" suffix="₺" />
          </div>

          <PreviewBox control={form.control} />
        </div>
        <SheetFooter className="flex-row justify-end border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={onDone}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Loader2 className="animate-spin" />}
            {rule ? "Kaydet" : "Kural ekle"}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  );
}

function NumInput({
  control,
  name,
  label,
  placeholder,
  suffix,
  description,
}: {
  control: Control<FormValues>;
  name: keyof FormValues;
  label: string;
  placeholder?: string;
  suffix?: string;
  description?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <div className="relative">
            <FormControl>
              <Input
                inputMode="decimal"
                placeholder={placeholder}
                className={suffix ? "pr-8 tabular-nums" : "tabular-nums"}
                {...field}
              />
            </FormControl>
            {suffix && (
              <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
                {suffix}
              </span>
            )}
          </div>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

/** Örnek maliyetle canlı hesap; sunucudaki senkron motoruyla aynı sonucu verir. */
function PreviewBox({ control }: { control: Control<FormValues> }) {
  const values = useWatch({ control }) as FormValues;
  const settings = useSettings();
  const [cost, setCost] = useState("100");
  const parsed = formSchema.safeParse(values);
  const costKurus = tl(cost);
  const input = parsed.success && costKurus && costKurus > 0 ? toInput(parsed.data) : null;
  const debounced = useDebounced(
    input ? JSON.stringify({ rule: input, cost: costKurus }) : null,
    300,
  );
  const preview = useQuery({
    queryKey: ["pricing-preview", debounced, settings.data?.maxAutoChangeRate],
    queryFn: () => api.pricing.preview(JSON.parse(debounced!)),
    enabled: debounced !== null,
    placeholderData: (prev) => prev,
  });

  const r = preview.data;
  return (
    <div className="bg-muted/40 space-y-3 rounded-xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">Örnek hesap</div>
        <div className="relative w-36">
          <Input
            aria-label="Örnek maliyet"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            className="bg-background h-8 pr-8 text-right tabular-nums"
          />
          <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm">
            ₺
          </span>
        </div>
      </div>
      {!input ? (
        <p className="text-muted-foreground text-sm">Hesap için çarpanı ve örnek maliyeti girin.</p>
      ) : preview.isError ? (
        <p className="text-destructive text-sm">{errorMessage(preview.error)}</p>
      ) : !r ? (
        <Skeleton className="h-10 w-full" />
      ) : r.status === "blocked" ? (
        <p className="text-destructive text-sm">
          {r.reason === "below_cost"
            ? "Hesaplanan fiyat maliyetin altında kalıyor; bu kuralla fiyat gönderilmez. Azami fiyatı kontrol edin."
            : "Bu değerlerle geçerli bir fiyat hesaplanamıyor."}
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <div>
            <div className="text-muted-foreground text-xs">Satış fiyatı</div>
            <div className="text-xl font-semibold tabular-nums">{formatMoney(r.salePrice)}</div>
          </div>
          {r.listPrice !== r.salePrice && (
            <div>
              <div className="text-muted-foreground text-xs">Liste fiyatı</div>
              <div className="text-muted-foreground tabular-nums line-through">
                {formatMoney(r.listPrice)}
              </div>
            </div>
          )}
          {costKurus && (
            <div className="text-muted-foreground text-xs">
              maliyete göre {formatChangeRate(r.salePrice / costKurus - 1)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Silme ───────────────────────────────────────────────────────────────────

function DeleteDialog({ rule, onClose }: { rule: PricingRule | null; onClose: () => void }) {
  const del = useDeletePricingRule();
  return (
    <AlertDialog open={rule !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kural silinsin mi?</AlertDialogTitle>
          <AlertDialogDescription>
            {rule?.scope === "general"
              ? "Genel kural silinirse başka kurala uymayan ürünlerin fiyatı artık güncellenmez (stok gönderimi devam eder)."
              : "Bu kapsamdaki ürünler bundan sonra bir üst kurala göre fiyatlanır."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Vazgeç</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive hover:bg-destructive/90 text-white"
            disabled={del.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (!rule) return;
              del.mutate(rule.id, {
                onSuccess: () => {
                  toast.success("Kural silindi");
                  onClose();
                },
                onError: (err) => toast.error(errorMessage(err)),
              });
            }}
          >
            {del.isPending && <Loader2 className="animate-spin" />}
            Sil
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
