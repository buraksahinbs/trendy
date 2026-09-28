"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Loader2,
  ScanSearch,
  Settings2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PasswordInput } from "@/components/password-input";
import { DetectPanel } from "@/components/suppliers/supplier-form-sheet";
import {
  configFromDraft,
  emptyField,
  getAtPath,
  getNodes,
  guessDraft,
  suggestPaths,
  type MappingDraft,
} from "@/components/mapping/mapping-utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SheetFooter } from "@/components/ui/sheet";
import {
  api,
  errorMessage,
  type DetectInput,
  type DetectResult,
  type Encoding,
  type MappingFieldKey,
} from "@/lib/api";
import { DEFAULT_SCHEDULE, ENCODING_OPTIONS, SCHEDULE_PRESETS } from "@/lib/cron";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/** "https://www.anadolu-toptan.com/xml" → "Anadolu Toptan" */
function nameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const label = host.split(".")[0] ?? host;
    if (/^\d+$/.test(label) || !label) return host;
    return label
      .split(/[-_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

/** Stok senkronu için kullanıcıya gösterilen alanlar; geri kalanı sessizce tahmin edilir. */
const KEY_FIELDS: { key: MappingFieldKey; label: string; hint: string; required: boolean }[] = [
  {
    key: "barcode",
    label: "Barkod",
    hint: "Trendyol ürünleriyle bu alan üzerinden eşleşir.",
    required: true,
  },
  { key: "stock", label: "Stok", hint: "Trendyol'a gönderilecek adet.", required: true },
  {
    key: "costPrice",
    label: "Maliyet",
    hint: "Fiyat kuralı tanımlarsanız satış fiyatı bundan hesaplanır.",
    required: false,
  },
];

const NONE = "__none__";

export function SupplierQuickAdd({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [feedUrl, setFeedUrl] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [encoding, setEncoding] = useState<"auto" | Encoding>("auto");
  const [scheduleCron, setScheduleCron] = useState<string>(DEFAULT_SCHEDULE);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [detected, setDetected] = useState<DetectResult | null>(null);
  const [itemPath, setItemPath] = useState("");
  const [idPath, setIdPath] = useState("");
  const [draft, setDraft] = useState<MappingDraft | null>(null);
  const [showStructure, setShowStructure] = useState(false);

  const auth = username.trim() && password ? { username: username.trim(), password } : undefined;
  const url = feedUrl.trim();
  const canDetect = isHttpUrl(url);

  const detect = useMutation({
    mutationFn: (input: DetectInput) => api.suppliers.detect(input),
    onSuccess: (res, input) => {
      setDetected(res);
      const path = input.itemPath ?? res.itemPath ?? "";
      setItemPath(path);
      setIdPath((cur) =>
        res.idFields.some((f) => f.path === cur) ? cur : (res.idFields[0]?.path ?? ""),
      );
      const sample = res.sampleItems[0];
      setDraft(sample ? guessDraft(sample) : null);
      if (!nameTouched) setName(nameFromUrl(input.feedUrl));
    },
  });

  const runDetect = (overrideItemPath?: string) => {
    const input: DetectInput = { feedUrl: url };
    if (encoding !== "auto") input.encoding = encoding;
    if (auth) input.auth = auth;
    if (overrideItemPath) input.itemPath = overrideItemPath;
    detect.mutate(input);
  };

  const sample = detected?.sampleItems[0];
  const nested = draft?.variantMode === "nested";
  // İç içe yapıda barkod/stok/maliyet ilk varyant düğümünden okunur ("../" üst ürünü gösterir).
  const variantPath = nested ? (draft?.variantPath ?? "") : "";
  const variantNode = useMemo(
    () => (sample && variantPath ? getNodes(sample, variantPath)[0] : undefined),
    [sample, variantPath],
  );
  const pathOptions = useMemo(() => {
    if (!sample) return [];
    if (!variantNode) return suggestPaths(sample);
    return [
      ...suggestPaths(variantNode),
      ...suggestPaths(sample).map((p) => ({ ...p, path: `../${p.path}` })),
    ];
  }, [sample, variantNode]);

  const valueOf = (key: MappingFieldKey): string | undefined => {
    const f = draft?.fields[key];
    if (!sample || !f || f.mode !== "path" || !f.path) return undefined;
    return variantNode ? getAtPath(variantNode, f.path, sample) : getAtPath(sample, f.path);
  };

  const setFieldPath = (key: MappingFieldKey, path: string) =>
    setDraft((d) => (d ? { ...d, fields: { ...d.fields, [key]: emptyField(path) } } : d));

  const missing = KEY_FIELDS.filter((f) => f.required && !draft?.fields[f.key]?.path);

  const create = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("Önce feed'i analiz edin");
      const { config, errors } = configFromDraft(draft);
      if (errors.length) throw new Error(errors.join(" · "));
      const { id } = await api.suppliers.create({
        name: name.trim() || nameFromUrl(url) || "Tedarikçi",
        feedUrl: url,
        scheduleCron,
        ...(itemPath ? { itemPath } : {}),
        ...(idPath ? { externalIdPath: idPath } : {}),
        ...(encoding !== "auto" ? { encoding } : {}),
        ...(auth ? { auth } : {}),
      });
      // Eşleştirme kaydı ilk çekimi de sıraya alır.
      await api.suppliers.saveMapping(id, config);
      return id;
    },
    onSuccess: (id) => {
      toast.success("Tedarikçi eklendi", {
        description: "Ürünler çekiliyor; birkaç saniye içinde listelenecek.",
      });
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      setTimeout(() => void qc.invalidateQueries({ queryKey: ["jobs"] }), 1500);
      onDone();
      router.push(`/tedarikciler/${id}`);
    },
  });

  return (
    <form
      method="post"
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        if (!detected) {
          if (canDetect) runDetect();
          return;
        }
        if (missing.length === 0) create.mutate();
      }}
    >
      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {/* 1) Adres */}
        <div className="space-y-2">
          <Label htmlFor="feedUrl" className="text-sm">
            XML adresi
          </Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="feedUrl"
              type="url"
              inputMode="url"
              autoFocus
              placeholder="https://tedarikci.com/urunler.xml"
              className="font-mono text-xs sm:text-sm"
              value={feedUrl}
              onChange={(e) => {
                setFeedUrl(e.target.value);
                if (detected) {
                  setDetected(null);
                  setDraft(null);
                }
              }}
            />
            <Button
              type="button"
              variant={detected ? "outline" : "default"}
              onClick={() => runDetect()}
              disabled={!canDetect || detect.isPending}
              className="shrink-0"
            >
              {detect.isPending ? <Loader2 className="animate-spin" /> : <ScanSearch />}
              {detected ? "Yeniden analiz et" : "Analiz et"}
            </Button>
          </div>
          {!detected && !detect.isPending && (
            <p className="text-muted-foreground text-xs">
              Tedarikçinizin size verdiği ürün XML linki. Dosyanın yalnızca başı okunur.
            </p>
          )}
          {detect.isPending && (
            <p className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="size-3 animate-spin" />
              Feed okunuyor ve alanlar tanınıyor…
            </p>
          )}
          {detect.isError && !detect.isPending && (
            <Alert variant="destructive">
              <AlertTitle>Feed okunamadı</AlertTitle>
              <AlertDescription>
                {errorMessage(detect.error)} Adres şifre korumalıysa aşağıdaki gelişmiş ayarlardan
                kullanıcı adı ve şifre girin.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* 2) Sonuç */}
        {detected && !detect.isError && (
          <>
            {detected.itemPaths.length === 0 || !sample ? (
              <Alert variant="warning">
                <AlertTitle>Ürün listesi tanınamadı</AlertTitle>
                <AlertDescription>
                  Bu adres bir ürün XML&apos;i gibi görünmüyor. Adresi tedarikçinizle kontrol edin.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="bg-muted/30 rounded-lg border p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">Feed okundu</p>
                      <p className="text-muted-foreground text-xs">
                        {formatNumber(detected.sampleCount)} örnek ürün ·{" "}
                        {nested ? "iç içe varyant yapısı" : "her satır bir varyant"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setShowStructure((v) => !v)}
                    >
                      Yapıyı değiştir
                      <ChevronDown
                        className={cn("transition-transform", showStructure && "rotate-180")}
                      />
                    </Button>
                  </div>
                  {showStructure && (
                    <div className="mt-4">
                      <DetectPanel
                        result={detected}
                        itemPath={itemPath}
                        externalIdPath={idPath}
                        busy={detect.isPending}
                        onItemPath={(p) => runDetect(p)}
                        onIdPath={setIdPath}
                        sample={sample}
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium">Alanlar doğru mu?</p>
                    <p className="text-muted-foreground text-xs">
                      İlk üründen okunan değerlere bakın. Yanlışsa doğru alanı seçin.
                    </p>
                  </div>
                  <div className="divide-y rounded-lg border">
                    {KEY_FIELDS.map((f) => {
                      const path = draft?.fields[f.key]?.path ?? "";
                      const value = valueOf(f.key);
                      const bad = f.required && !path;
                      return (
                        <div
                          key={f.key}
                          className="grid items-center gap-2 p-3 sm:grid-cols-[6.5rem_1fr_9rem]"
                        >
                          <div className="leading-tight">
                            <div className="text-sm font-medium">{f.label}</div>
                            {!f.required && (
                              <div className="text-muted-foreground text-[11px]">isteğe bağlı</div>
                            )}
                          </div>
                          <Select
                            value={path || NONE}
                            onValueChange={(v) => setFieldPath(f.key, v === NONE ? "" : v)}
                          >
                            <SelectTrigger
                              className={cn(
                                "w-full font-mono text-xs",
                                bad && "border-destructive",
                              )}
                              aria-label={`${f.label} alanı`}
                            >
                              {/* Kapalıyken yalnızca alan adı; değer sağ sütunda. */}
                              <SelectValue>{path || "Seçilmedi"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE} className="text-muted-foreground">
                                Seçilmedi
                              </SelectItem>
                              {pathOptions.map((o) => (
                                <SelectItem
                                  key={o.path}
                                  value={o.path}
                                  className="font-mono text-xs"
                                >
                                  {o.path}
                                  <span className="text-muted-foreground ml-2 truncate font-sans">
                                    {o.sample?.slice(0, 24)}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div
                            className={cn(
                              "truncate text-right font-mono text-xs",
                              value ? "text-foreground" : "text-muted-foreground",
                            )}
                            title={value}
                          >
                            {bad ? (
                              <span className="text-destructive inline-flex items-center gap-1 font-sans">
                                <CircleAlert className="size-3.5" />
                                Seçin
                              </span>
                            ) : (
                              (value ?? "—")
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    Başlık, marka, kategori ve görsel gibi diğer alanlar otomatik eşlendi; tedarikçi
                    sayfasındaki &quot;Alan eşleştirme&quot; bölümünden dilediğiniz zaman
                    düzenleyebilirsiniz.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="supplierName" className="text-sm">
                    Tedarikçi adı
                  </Label>
                  <Input
                    id="supplierName"
                    value={name}
                    maxLength={100}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameTouched(true);
                    }}
                  />
                </div>
              </>
            )}
          </>
        )}

        {/* Gelişmiş */}
        <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs transition-colors"
            >
              <Settings2 className="size-3.5" />
              Gelişmiş: şifreli feed, karakter kodlaması, çekim sıklığı
              <ChevronDown
                className={cn("size-3.5 transition-transform", showAdvanced && "rotate-180")}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4 grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="feedUser" className="text-xs">
                Kullanıcı adı
              </Label>
              <Input
                id="feedUser"
                autoComplete="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="feedPass" className="text-xs">
                Şifre
              </Label>
              <PasswordInput
                id="feedPass"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <p className="text-muted-foreground -mt-2 text-xs sm:col-span-2">
              Yalnızca feed şifre korumalıysa (HTTP Basic Auth). Şifrelenerek saklanır.
            </p>
            <div className="grid gap-2">
              <Label className="text-xs">Karakter kodlaması</Label>
              <Select value={encoding} onValueChange={(v) => setEncoding(v as typeof encoding)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Otomatik</SelectItem>
                  {ENCODING_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className="text-xs">Çekim sıklığı</Label>
              <Select value={scheduleCron} onValueChange={setScheduleCron}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCHEDULE_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {create.isError && (
          <Alert variant="destructive">
            <AlertTitle>Tedarikçi eklenemedi</AlertTitle>
            <AlertDescription>{errorMessage(create.error)}</AlertDescription>
          </Alert>
        )}
      </div>

      <SheetFooter className="flex-row items-center justify-between border-t px-6 py-4">
        <div className="text-muted-foreground text-xs">
          {detected && sample ? (
            missing.length > 0 ? (
              <span className="text-destructive">
                {missing.map((m) => m.label).join(" ve ")} alanını seçin
              </span>
            ) : (
              <Badge variant="outline" className="font-normal">
                Hazır
              </Badge>
            )
          ) : (
            "Adım 1/2"
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Vazgeç
          </Button>
          {detected && sample ? (
            <Button type="submit" disabled={missing.length > 0 || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Ekle ve ürünleri çek
              {!create.isPending && <ArrowRight />}
            </Button>
          ) : (
            <Button type="submit" disabled={!canDetect || detect.isPending}>
              {detect.isPending && <Loader2 className="animate-spin" />}
              Devam
              {!detect.isPending && <ArrowRight />}
            </Button>
          )}
        </div>
      </SheetFooter>
    </form>
  );
}
