"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, KeyRound, Loader2, ScanSearch, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch, type Control } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { JsonViewer } from "@/components/json-viewer";
import { PasswordInput } from "@/components/password-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  api,
  errorMessage,
  type DetectInput,
  type DetectResult,
  type Encoding,
  type Supplier,
  type SupplierPatch,
} from "@/lib/api";
import { DEFAULT_SCHEDULE, ENCODING_OPTIONS, SCHEDULE_PRESETS } from "@/lib/cron";
import { applyApiError } from "@/lib/form-errors";
import { formatNumber } from "@/lib/format";
import { useCreateSupplier, useUpdateSupplier } from "@/lib/queries";
import { cn } from "@/lib/utils";

const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

const schema = z
  .object({
    name: z.string().trim().min(1, "Tedarikçi adını girin").max(100, "En fazla 100 karakter"),
    feedUrl: z
      .string()
      .trim()
      .min(1, "Feed adresini girin")
      .refine(isHttpUrl, "http:// veya https:// ile başlayan geçerli bir adres girin"),
    itemPath: z.string().trim().max(200),
    externalIdPath: z.string().trim().max(200),
    encoding: z.enum(["auto", "utf-8", "iso-8859-9", "windows-1254"]),
    scheduleCron: z.string().min(1),
    active: z.boolean(),
    useAuth: z.boolean(),
    removeAuth: z.boolean(),
    username: z.string(),
    password: z.string(),
  })
  .superRefine((v, ctx) => {
    if (!v.useAuth) return;
    if (!v.username.trim())
      ctx.addIssue({ code: "custom", path: ["username"], message: "Kullanıcı adını girin" });
    if (!v.password) ctx.addIssue({ code: "custom", path: ["password"], message: "Şifreyi girin" });
  });
type Values = z.infer<typeof schema>;

const FIELDS = [
  "name",
  "feedUrl",
  "itemPath",
  "externalIdPath",
  "encoding",
  "scheduleCron",
  "username",
  "password",
] as const;

function defaults(s: Supplier | null): Values {
  return {
    name: s?.name ?? "",
    feedUrl: s?.feedUrl ?? "",
    itemPath: s?.itemPath ?? "",
    externalIdPath: s?.externalIdPath ?? "",
    encoding: s?.encoding ?? "auto",
    scheduleCron: s?.scheduleCron ?? DEFAULT_SCHEDULE,
    active: s?.active ?? true,
    useAuth: false,
    removeAuth: false,
    username: "",
    password: "",
  };
}

export function SupplierFormSheet({
  open,
  onOpenChange,
  supplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null: yeni tedarikçi */
  supplier: Supplier | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b px-6 py-5">
          <SheetTitle>{supplier ? "Tedarikçiyi düzenle" : "Tedarikçi ekle"}</SheetTitle>
          <SheetDescription>
            {supplier
              ? "Feed ayarlarını güncelleyin. Değişiklikler bir sonraki çekimde geçerli olur."
              : "Tedarikçinizin XML feed adresini girin; ürün düğümünü ve kimlik alanını birlikte bulalım."}
          </SheetDescription>
        </SheetHeader>
        {open && (
          <SupplierForm
            key={supplier?.id ?? "new"}
            supplier={supplier}
            onDone={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SupplierForm({ supplier, onDone }: { supplier: Supplier | null; onDone: () => void }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults(supplier),
  });
  const create = useCreateSupplier();
  const update = useUpdateSupplier();
  const router = useRouter();
  const [detected, setDetected] = useState<DetectResult | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  const [feedUrl, itemPath, externalIdPath, useAuth, scheduleCron, removeAuth] = useWatch({
    control: form.control,
    name: ["feedUrl", "itemPath", "externalIdPath", "useAuth", "scheduleCron", "removeAuth"],
  });

  const detect = useMutation({
    mutationFn: (input: DetectInput) => api.suppliers.detect(input),
    onSuccess: (res, input) => {
      setDetected(res);
      const opts = { shouldDirty: true, shouldValidate: true };
      // İlk analizde öneriyi uygula; kullanıcı yol seçtiyse ona dokunma.
      if (!input.itemPath && res.itemPath) form.setValue("itemPath", res.itemPath, opts);
      const currentId = form.getValues("externalIdPath");
      const first = res.idFields[0];
      if (first && !res.idFields.some((f) => f.path === currentId)) {
        form.setValue("externalIdPath", first.path, opts);
      }
    },
  });

  const runDetect = (overrideItemPath?: string) => {
    const v = form.getValues();
    const input: DetectInput = { feedUrl: v.feedUrl.trim() };
    if (v.encoding !== "auto") input.encoding = v.encoding;
    if (v.useAuth && v.username && v.password)
      input.auth = { username: v.username, password: v.password };
    if (overrideItemPath) input.itemPath = overrideItemPath;
    detect.mutate(input);
  };

  const onSubmit = async (v: Values) => {
    const itemPathVal = v.itemPath.trim() || null;
    const idPathVal = v.externalIdPath.trim() || null;
    const encodingVal: Encoding | null = v.encoding === "auto" ? null : v.encoding;
    try {
      if (!supplier) {
        const { id } = await create.mutateAsync({
          name: v.name.trim(),
          feedUrl: v.feedUrl.trim(),
          scheduleCron: v.scheduleCron,
          ...(itemPathVal ? { itemPath: itemPathVal } : {}),
          ...(idPathVal ? { externalIdPath: idPathVal } : {}),
          ...(encodingVal ? { encoding: encodingVal } : {}),
          ...(v.useAuth ? { auth: { username: v.username.trim(), password: v.password } } : {}),
        });
        // Yapılandırma tamsa ilk çekimi hemen başlat; kullanıcı detay sayfasında devam eder.
        if (itemPathVal && idPathVal) void api.suppliers.fetchNow(id).catch(() => undefined);
        onDone();
        router.push(`/tedarikciler/${id}`);
        return;
      } else {
        const patch: SupplierPatch = {};
        if (v.name.trim() !== supplier.name) patch.name = v.name.trim();
        if (v.feedUrl.trim() !== supplier.feedUrl) patch.feedUrl = v.feedUrl.trim();
        if (itemPathVal !== supplier.itemPath) patch.itemPath = itemPathVal;
        if (idPathVal !== supplier.externalIdPath) patch.externalIdPath = idPathVal;
        if (encodingVal !== supplier.encoding) patch.encoding = encodingVal;
        if (v.scheduleCron !== supplier.scheduleCron) patch.scheduleCron = v.scheduleCron;
        if (v.active !== supplier.active) patch.active = v.active;
        if (v.useAuth) patch.auth = { username: v.username.trim(), password: v.password };
        else if (v.removeAuth && supplier.hasAuth) patch.auth = null;
        if (Object.keys(patch).length > 0) {
          await update.mutateAsync({ id: supplier.id, patch });
          toast.success("Değişiklikler kaydedildi");
        }
      }
      onDone();
    } catch (err) {
      applyApiError(err, form.setError, FIELDS, {
        "auth.username": "username",
        "auth.password": "password",
      });
    }
  };

  const pending = create.isPending || update.isPending;
  const canDetect = isHttpUrl(feedUrl.trim());
  const presetKnown = SCHEDULE_PRESETS.some((p) => p.value === scheduleCron);
  const sample = detected?.sampleItems[0];

  return (
    <Form {...form}>
      <form
        // Sayfa hazır olmadan gönderilirse şifre adres çubuğuna (GET) düşmesin.
        method="post"
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex min-h-0 flex-1 flex-col"
        noValidate
      >
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tedarikçi adı</FormLabel>
                <FormControl>
                  <Input placeholder="Örn. Anadolu Toptan" autoFocus={!supplier} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="space-y-3">
            <FormField
              control={form.control}
              name="feedUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Feed adresi (XML)</FormLabel>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <FormControl>
                      <Input
                        type="url"
                        inputMode="url"
                        placeholder="https://tedarikci.com/urunler.xml"
                        className="font-mono text-xs sm:text-sm"
                        {...field}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => runDetect()}
                      disabled={!canDetect || detect.isPending}
                      className="shrink-0"
                    >
                      {detect.isPending ? <Loader2 className="animate-spin" /> : <ScanSearch />}
                      Feed&apos;i analiz et
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
            {detect.isPending && (
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                <Loader2 className="size-3 animate-spin" />
                Feed&apos;in başı indiriliyor ve yapısı inceleniyor; bu birkaç saniye sürebilir…
              </p>
            )}
            {detect.isError && !detect.isPending && (
              <Alert variant="destructive">
                <AlertTitle>Feed analiz edilemedi</AlertTitle>
                <AlertDescription>{errorMessage(detect.error)}</AlertDescription>
              </Alert>
            )}
            {detected && !detect.isError && (
              <DetectPanel
                result={detected}
                itemPath={itemPath}
                externalIdPath={externalIdPath}
                busy={detect.isPending}
                onItemPath={(p) => {
                  form.setValue("itemPath", p, { shouldDirty: true, shouldValidate: true });
                  runDetect(p);
                }}
                onIdPath={(p) =>
                  form.setValue("externalIdPath", p, { shouldDirty: true, shouldValidate: true })
                }
                sample={sample}
              />
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="itemPath"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Ürün düğümü yolu</FormLabel>
                  <FormControl>
                    <Input placeholder="/Urunler/Urun" className="font-mono" {...field} />
                  </FormControl>
                  <FormDescription>
                    Her ürünü temsil eden, tekrar eden XML düğümü. Örneğin{" "}
                    <code className="bg-muted rounded px-1">&lt;Urunler&gt;&lt;Urun&gt;…</code>{" "}
                    yapısı için <code className="bg-muted rounded px-1">/Urunler/Urun</code>.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="externalIdPath"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Ürün kimlik alanı</FormLabel>
                  <FormControl>
                    <Input placeholder="UrunKodu" className="font-mono" {...field} />
                  </FormControl>
                  <FormDescription>
                    Ürün düğümü içinde her ürünü benzersiz tanımlayan alan. Nokta ile iç içe alan (
                    <code className="bg-muted rounded px-1">Kimlik.Kod</code>),{" "}
                    <code className="bg-muted rounded px-1">@</code> ile XML niteliği (
                    <code className="bg-muted rounded px-1">@id</code>) seçilir.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="encoding"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Karakter kodlaması</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="auto">Otomatik (XML bildiriminden)</SelectItem>
                      {ENCODING_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Türkçe karakterler bozuk görünüyorsa değiştirin.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scheduleCron"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Çekim sıklığı</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SCHEDULE_PRESETS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                      {!presetKnown && (
                        <SelectItem value={scheduleCron}>Özel ({scheduleCron})</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>Feed bu aralıklarla otomatik çekilir.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {supplier && (
            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between gap-4 rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel>Otomatik çekim</FormLabel>
                    <FormDescription>
                      Kapalıyken feed zamanlanmış olarak çekilmez; elle çekim yapılabilir.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
          )}

          <Separator />

          {supplier ? (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <KeyRound className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <div className="flex-1 space-y-0.5">
                  <div className="text-sm font-medium">Feed kimlik doğrulaması</div>
                  <p className="text-muted-foreground text-xs">
                    {removeAuth
                      ? "Kaydettiğinizde kayıtlı kullanıcı adı/şifre silinecek."
                      : supplier.hasAuth
                        ? "Kullanıcı adı/şifre kayıtlı (gösterilmez)."
                        : "Tanımlı değil. Feed şifre korumalıysa ekleyin."}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!useAuth && !removeAuth && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => form.setValue("useAuth", true)}
                    >
                      {supplier.hasAuth ? "Değiştir" : "Ekle"}
                    </Button>
                  )}
                  {supplier.hasAuth && !useAuth && !removeAuth && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => form.setValue("removeAuth", true, { shouldDirty: true })}
                    >
                      Kaldır
                    </Button>
                  )}
                  {(useAuth || removeAuth) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        form.setValue("useAuth", false);
                        form.setValue("removeAuth", false);
                        form.setValue("username", "");
                        form.setValue("password", "");
                      }}
                    >
                      Vazgeç
                    </Button>
                  )}
                </div>
              </div>
              {useAuth && <AuthFields control={form.control} />}
            </div>
          ) : (
            <Collapsible open={showAuth} onOpenChange={setShowAuth}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="hover:bg-muted/50 flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors"
                >
                  <span className="flex items-center gap-3">
                    <KeyRound className="text-muted-foreground size-4" />
                    <span>
                      <span className="block text-sm font-medium">Feed şifre korumalı mı?</span>
                      <span className="text-muted-foreground block text-xs">
                        HTTP Basic Auth kullanıcı adı ve şifresi (isteğe bağlı)
                      </span>
                    </span>
                  </span>
                  <ChevronDown
                    className={cn("size-4 transition-transform", showAuth && "rotate-180")}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-4 pt-4">
                <FormField
                  control={form.control}
                  name="useAuth"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-3">
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="font-normal">Kimlik doğrulama kullan</FormLabel>
                    </FormItem>
                  )}
                />
                {useAuth && <AuthFields control={form.control} />}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
        <SheetFooter className="flex-row justify-end border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={onDone}>
            Vazgeç
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {supplier ? "Kaydet" : "Tedarikçiyi ekle"}
          </Button>
        </SheetFooter>
      </form>
    </Form>
  );
}

function AuthFields({ control }: { control: Control<Values> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField
        control={control}
        name="username"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Kullanıcı adı</FormLabel>
            <FormControl>
              <Input autoComplete="off" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={control}
        name="password"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Şifre</FormLabel>
            <FormControl>
              <PasswordInput autoComplete="new-password" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <p className="text-muted-foreground text-xs sm:col-span-2">
        Bilgiler şifrelenerek saklanır ve bir daha gösterilmez.
      </p>
    </div>
  );
}

function DetectPanel({
  result,
  itemPath,
  externalIdPath,
  busy,
  onItemPath,
  onIdPath,
  sample,
}: {
  result: DetectResult;
  itemPath: string;
  externalIdPath: string;
  busy: boolean;
  onItemPath: (p: string) => void;
  onIdPath: (p: string) => void;
  sample: Record<string, unknown> | undefined;
}) {
  const [showSample, setShowSample] = useState(false);
  const itemPathKnown = result.itemPaths.some((p) => p.path === itemPath);

  if (result.itemPaths.length === 0) {
    return (
      <Alert variant="warning">
        <AlertTitle>Tekrarlayan ürün düğümü bulunamadı</AlertTitle>
        <AlertDescription>
          Feed&apos;in yapısı tanınamadı. Ürün düğümü yolunu aşağıya elle girebilirsiniz.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      className={cn(
        "bg-muted/30 space-y-4 rounded-lg border p-4 transition-opacity",
        busy && "pointer-events-none opacity-60",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Sparkles className="text-brand size-4" />
        Analiz sonucu
        <Badge variant="outline" className="ml-auto font-normal">
          {formatNumber(result.sampleCount)} örnek ürün okundu
        </Badge>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Önerilen ürün düğümü</Label>
        <Select value={itemPathKnown ? itemPath : ""} onValueChange={onItemPath}>
          <SelectTrigger className="bg-background w-full font-mono text-xs">
            <SelectValue placeholder="Bir düğüm seçin" />
          </SelectTrigger>
          <SelectContent>
            {result.itemPaths.map((p) => (
              <SelectItem key={p.path} value={p.path} className="font-mono text-xs">
                {p.path}
                <span className="text-muted-foreground ml-2 font-sans">
                  {formatNumber(p.count)} adet
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Kimlik alanı adayları</Label>
        {result.idFields.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            Bu düğümde benzersiz görünen bir alan bulunamadı; kimlik alanını elle girin.
          </p>
        ) : (
          <RadioGroup value={externalIdPath} onValueChange={onIdPath} className="gap-2">
            {result.idFields.map((f) => (
              <label
                key={f.path}
                className={cn(
                  "bg-background hover:border-foreground/20 flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                  externalIdPath === f.path && "border-foreground/40 ring-foreground/10 ring-2",
                )}
              >
                <RadioGroupItem value={f.path} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-xs font-medium">{f.path}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {f.samples.length > 0 ? `ör. ${f.samples.slice(0, 3).join(", ")}` : "örnek yok"}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        )}
      </div>

      {sample && (
        <Collapsible open={showSample} onOpenChange={setShowSample}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="-ml-2 h-7 text-xs">
              <ChevronDown className={cn("transition-transform", showSample && "rotate-180")} />
              İlk ürünün önizlemesi
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <JsonViewer value={sample} className="bg-background max-h-72 overflow-y-auto" />
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
