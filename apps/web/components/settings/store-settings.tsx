"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, OctagonPause, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { OWNER_ONLY_HINT } from "@/components/owner-only";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, type TenantSettings } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";
import { useRole, useUpdateSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TIERS: { value: TenantSettings["listingLimitTier"]; label: string }[] = [
  { value: "50k", label: "50.000 ürün" },
  { value: "75k", label: "75.000 ürün" },
  { value: "150k", label: "150.000 ürün" },
  { value: "500k", label: "500.000 ürün" },
  { value: "unlimited", label: "Limitsiz" },
];

export function StoreSettings({ settings }: { settings: TenantSettings }) {
  return (
    <div className="grid gap-6">
      <EmergencyStopCard paused={settings.syncPaused} />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <GeneralCard settings={settings} />
        <FxRatesCard rates={settings.fxRates} />
      </div>
    </div>
  );
}

// ── Acil durdurma ───────────────────────────────────────────────────────────

function EmergencyStopCard({ paused }: { paused: boolean }) {
  const { isOwner } = useRole();
  const update = useUpdateSettings();
  const [confirm, setConfirm] = useState(false);

  const apply = () =>
    update.mutate(
      { syncPaused: !paused },
      {
        onSuccess: () => {
          setConfirm(false);
          if (paused)
            toast.success("Senkron yeniden başladı", {
              description: "Stok ve fiyat güncellemeleri bir sonraki turda gönderilecek.",
            });
          else
            toast.warning("Senkron durduruldu", {
              description: "Trendyol'a hiçbir stok veya fiyat güncellemesi gönderilmeyecek.",
            });
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  const control = (
    <Switch
      checked={paused}
      onCheckedChange={() => setConfirm(true)}
      disabled={!isOwner || update.isPending}
      aria-label="Acil durdurma"
      className="data-[state=checked]:bg-destructive scale-125"
    />
  );

  return (
    <Card
      className={cn(
        "gap-0 py-0 transition-colors",
        paused && "border-destructive/50 bg-destructive/5",
      )}
    >
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            paused ? "bg-destructive text-white" : "bg-muted text-muted-foreground",
          )}
        >
          <OctagonPause className="size-5" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            Acil durdurma
            {paused && (
              <span className="bg-destructive rounded-full px-2 py-0.5 text-[11px] font-medium text-white">
                Açık
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {paused
              ? "Tüm stok ve fiyat gönderimleri durduruldu. Feed çekimleri de zamanlanmıyor."
              : "Bir sorun fark ettiğinizde tek tıkla Trendyol'a giden tüm stok ve fiyat güncellemelerini durdurun."}
          </p>
        </div>
        <div className="flex items-center gap-3 sm:pl-4">
          {update.isPending && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          {isOwner ? (
            control
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>{control}</span>
              </TooltipTrigger>
              <TooltipContent>{OWNER_ONLY_HINT}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {paused ? "Senkron yeniden başlatılsın mı?" : "Tüm senkron durdurulsun mu?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {paused
                ? "Stok ve fiyat güncellemeleri yeniden Trendyol'a gönderilmeye başlar. Feed'lerinizin doğru olduğundan emin olun."
                : "Trendyol'a hiçbir stok veya fiyat güncellemesi gönderilmez ve feed çekimleri durur. Trendyol'daki mevcut stoklar olduğu gibi kalır; bu sürede satılan ürünler için stok eksiye düşebilir."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              className={cn(!paused && "bg-destructive hover:bg-destructive/90 text-white")}
              disabled={update.isPending}
              onClick={(e) => {
                e.preventDefault();
                apply();
              }}
            >
              {update.isPending && <Loader2 className="animate-spin" />}
              {paused ? (
                <>
                  <Play /> Senkronu başlat
                </>
              ) : (
                <>
                  <OctagonPause /> Evet, durdur
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Mağaza ve senkron ───────────────────────────────────────────────────────

const generalSchema = z.object({
  name: z.string().trim().min(1, "Mağaza adını girin").max(100, "En fazla 100 karakter"),
  listingLimitTier: z.enum(["50k", "75k", "150k", "500k", "unlimited"]),
  syncEnv: z.enum(["stage", "prod"]),
  safetyStock: z.coerce
    .number<string | number>({ message: "Sayı girin" })
    .int("Tam sayı girin")
    .min(0, "0 veya daha büyük olmalı")
    .max(1000, "En fazla 1000"),
  maxAutoChangePct: z.coerce
    .number<string | number>({ message: "Sayı girin" })
    .min(1, "En az %1")
    .max(500, "En fazla %500"),
  orderPiiRetentionDays: z.coerce
    .number<string | number>({ message: "Sayı girin" })
    .int("Tam sayı girin")
    .min(30, "En az 30 gün")
    .max(3650, "En fazla 3650 gün"),
});
type GeneralValues = z.input<typeof generalSchema>;
type GeneralOutput = z.output<typeof generalSchema>;

function generalDefaults(s: TenantSettings): GeneralValues {
  return {
    name: s.name,
    listingLimitTier: s.listingLimitTier,
    syncEnv: s.syncEnv,
    safetyStock: s.safetyStock,
    maxAutoChangePct: Math.round(s.maxAutoChangeRate * 1000) / 10,
    orderPiiRetentionDays: s.orderPiiRetentionDays ?? 180,
  };
}

function GeneralCard({ settings }: { settings: TenantSettings }) {
  const { isOwner } = useRole();
  const update = useUpdateSettings();
  const form = useForm<GeneralValues, unknown, GeneralOutput>({
    resolver: zodResolver(generalSchema),
    defaultValues: generalDefaults(settings),
  });

  const onSubmit = (v: GeneralOutput) => {
    const patch: Partial<TenantSettings> = {};
    if (v.name !== settings.name) patch.name = v.name;
    if (v.listingLimitTier !== settings.listingLimitTier)
      patch.listingLimitTier = v.listingLimitTier;
    if (v.syncEnv !== settings.syncEnv) patch.syncEnv = v.syncEnv;
    if (v.safetyStock !== settings.safetyStock) patch.safetyStock = v.safetyStock;
    const rate = Math.round(v.maxAutoChangePct * 10) / 1000;
    if (rate !== settings.maxAutoChangeRate) patch.maxAutoChangeRate = rate;
    if (v.orderPiiRetentionDays !== settings.orderPiiRetentionDays)
      patch.orderPiiRetentionDays = v.orderPiiRetentionDays;
    if (Object.keys(patch).length === 0) {
      form.reset(v);
      return;
    }
    update.mutate(patch, {
      onSuccess: (s) => {
        form.reset(generalDefaults(s));
        toast.success("Ayarlar kaydedildi");
      },
      onError: (err) =>
        applyApiError(
          err,
          form.setError,
          [
            "name",
            "listingLimitTier",
            "syncEnv",
            "safetyStock",
            "maxAutoChangePct",
            "orderPiiRetentionDays",
          ],
          { maxAutoChangeRate: "maxAutoChangePct" },
        ),
    });
  };

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>Mağaza ve senkron</CardTitle>
        <CardDescription>Senkronun hangi ortamda ve hangi kurallarla çalışacağı.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-5">
          <CardContent>
            <fieldset disabled={!isOwner || update.isPending} className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Mağaza adı</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="syncEnv"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Senkron ortamı</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!isOwner}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="prod">Canlı (prod)</SelectItem>
                        <SelectItem value="stage">Test (stage)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>Stok ve fiyatlar bu ortama gönderilir.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="listingLimitTier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Listeleme limiti</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!isOwner}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TIERS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Trendyol satıcı panelinizdeki seviye; istek hızı buna göre ayarlanır.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="safetyStock"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Güvenlik stoğu</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={1000}
                        {...field}
                        value={field.value as string | number}
                      />
                    </FormControl>
                    <FormDescription>
                      Tedarikçi stoğu bu sayının altındaysa Trendyol&apos;a 0 gönderilir.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxAutoChangePct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Otomatik fiyat değişim sınırı</FormLabel>
                    <div className="relative">
                      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">
                        %
                      </span>
                      <FormControl>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          max={500}
                          step="0.1"
                          className="pl-7"
                          {...field}
                          value={field.value as string | number}
                        />
                      </FormControl>
                    </div>
                    <FormDescription>
                      Bundan büyük değişimler Fiyat Onayları&apos;na düşer.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="orderPiiRetentionDays"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Kişisel veri saklama süresi (gün)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={30}
                        max={3650}
                        className="sm:w-40"
                        {...field}
                        value={field.value as string | number}
                      />
                    </FormControl>
                    <FormDescription>
                      Kapanmış siparişlerde (teslim, iptal, iade) adres ve iletişim bilgileri bu
                      süre sonunda silinir. Süreyi hukuk danışmanınızla belirleyin.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>
          </CardContent>
          <CardFooter className="justify-between gap-3 border-t">
            <p className="text-muted-foreground text-xs">{isOwner ? "" : OWNER_ONLY_HINT}</p>
            <Button
              type="submit"
              size="sm"
              disabled={!isOwner || update.isPending || !form.formState.isDirty}
            >
              {update.isPending && <Loader2 className="animate-spin" />}
              Kaydet
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

// ── Döviz kurları ───────────────────────────────────────────────────────────

const fxSchema = z.object({
  rates: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{3}$/, "3 harfli kod (ör. USD)")
          .refine((c) => c !== "TRY", "TRY için kur girilmez"),
        rate: z.coerce
          .number<string | number>({ message: "Sayı girin" })
          .positive("0'dan büyük olmalı")
          .max(1_000_000, "Çok büyük"),
      }),
    )
    .superRefine((rows, ctx) => {
      const seen = new Set<string>();
      rows.forEach((r, i) => {
        const c = r.code.trim().toUpperCase();
        if (seen.has(c))
          ctx.addIssue({ code: "custom", path: [i, "code"], message: "Bu kod zaten var" });
        seen.add(c);
      });
    }),
});
type FxValues = z.input<typeof fxSchema>;
type FxOutput = z.output<typeof fxSchema>;

const toRows = (r: Record<string, number>) => ({
  rates: Object.entries(r).map(([code, rate]) => ({ code, rate })),
});

function FxRatesCard({ rates }: { rates: Record<string, number> }) {
  const { isOwner } = useRole();
  const update = useUpdateSettings();
  const form = useForm<FxValues, unknown, FxOutput>({
    resolver: zodResolver(fxSchema),
    defaultValues: toRows(rates),
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: "rates" });

  const onSubmit = (v: FxOutput) =>
    update.mutate(
      { fxRates: Object.fromEntries(v.rates.map((r) => [r.code, r.rate])) },
      {
        onSuccess: (s) => {
          form.reset(toRows(s.fxRates));
          toast.success("Döviz kurları kaydedildi");
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle>Döviz kurları</CardTitle>
        <CardDescription>
          Maliyeti TL dışında olan ürünlerin fiyatı bu kurlarla hesaplanır. Kur girilmemiş para
          birimindeki ürünlere yalnızca stok gönderilir.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-5">
          <CardContent>
            <fieldset disabled={!isOwner || update.isPending} className="space-y-3">
              {fields.length === 0 && (
                <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
                  Henüz kur girilmedi. Tüm maliyetleriniz TL ise gerek yok.
                </p>
              )}
              {fields.map((f, i) => (
                <div key={f.id} className="flex items-start gap-2">
                  <FormField
                    control={form.control}
                    name={`rates.${i}.code`}
                    render={({ field }) => (
                      <FormItem className="w-28">
                        <FormControl>
                          <Input
                            placeholder="USD"
                            maxLength={3}
                            className="font-mono uppercase"
                            aria-label="Para birimi"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <span className="text-muted-foreground mt-2 text-sm">=</span>
                  <FormField
                    control={form.control}
                    name={`rates.${i}.rate`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <div className="relative">
                          <FormControl>
                            <Input
                              type="number"
                              inputMode="decimal"
                              step="0.0001"
                              min={0}
                              placeholder="41,50"
                              className="pr-8 tabular-nums"
                              aria-label="Kur (TL)"
                              {...field}
                              value={field.value as string | number}
                            />
                          </FormControl>
                          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                            ₺
                          </span>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(i)}
                    aria-label="Kuru sil"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ code: "", rate: "" })}
              >
                <Plus /> Kur ekle
              </Button>
            </fieldset>
          </CardContent>
          <CardFooter className="justify-end border-t">
            <Button
              type="submit"
              size="sm"
              disabled={!isOwner || update.isPending || !form.formState.isDirty}
            >
              {update.isPending && <Loader2 className="animate-spin" />}
              Kurları kaydet
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
