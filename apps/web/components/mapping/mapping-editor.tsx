"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Braces,
  Download,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { MappingPreviewPanel } from "@/components/mapping/mapping-preview";
import {
  applyTransforms,
  blankDraft,
  configFromDraft,
  draftFromConfig,
  emptyField,
  FIELD_DEFS,
  getAtPath,
  getNodes,
  guessDraft,
  suggestPaths,
  suggestVariantPaths,
  type FieldDef,
  type FieldDraft,
  type MappingDraft,
  type PathSuggestion,
} from "@/components/mapping/mapping-utils";
import { PathInput } from "@/components/mapping/path-input";
import { AddTransformMenu, TransformsEditor } from "@/components/mapping/transforms-editor";
import { OWNER_ONLY_HINT } from "@/components/owner-only";
import { FetchNowButton } from "@/components/suppliers/supplier-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDebounced } from "@/hooks/use-debounced";
import { api, ApiError, errorMessage, type MappingConfig, type Supplier } from "@/lib/api";
import { useRole, useSaveMapping, useSupplierProducts } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function MappingEditor({ supplier }: { supplier: Supplier }) {
  const sample = useSupplierProducts(supplier.id, 0, 1);

  if (sample.isError)
    return <ErrorState error={sample.error} onRetry={() => void sample.refetch()} />;
  if (sample.isPending)
    return (
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Skeleton className="h-[36rem] rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  const raw = sample.data.items[0]?.raw;
  if (!raw && !supplier.mapping)
    return (
      <EmptyState
        icon={Download}
        title="Önce feed'i çekin"
        description="Eşleştirme, feed'deki örnek ürünler üzerinden yapılır. İlk çekim tamamlanınca alanları buradan eşleştirebilirsiniz."
        action={<FetchNowButton supplier={supplier} variant="default" />}
      />
    );
  return (
    <MappingForm
      key={supplier.id}
      supplier={supplier}
      sample={raw}
      hasProducts={sample.data.total > 0}
    />
  );
}

function MappingForm({
  supplier,
  sample,
  hasProducts,
}: {
  supplier: Supplier;
  sample: Record<string, unknown> | undefined;
  hasProducts: boolean;
}) {
  const { isOwner } = useRole();
  const save = useSaveMapping(supplier.id);
  const saved = supplier.mapping;
  const [guessed] = useState(() => !saved && Boolean(sample));
  const [draft, setDraft] = useState<MappingDraft>(() =>
    saved ? draftFromConfig(saved) : sample ? guessDraft(sample) : blankDraft(),
  );
  const [mode, setMode] = useState<"visual" | "json">("visual");

  const { config, errors } = useMemo(() => configFromDraft(draft), [draft]);
  const json = JSON.stringify(config);
  const savedJson = useMemo(
    () => (saved ? JSON.stringify(configFromDraft(draftFromConfig(saved)).config) : null),
    [saved],
  );
  const dirty = json !== savedJson;

  const debouncedJson = useDebounced(json, 600);
  const preview = useQuery({
    queryKey: ["suppliers", supplier.id, "mapping-preview", debouncedJson],
    queryFn: () =>
      api.suppliers.previewMapping(supplier.id, JSON.parse(debouncedJson) as MappingConfig, 20),
    enabled: errors.length === 0 && hasProducts,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
  });

  // Öneriler: ürün düzeyi alanlar ürün düğümünden, varyant alanları (nested) varyant düğümünden
  const productPaths = useMemo(() => (sample ? suggestPaths(sample) : []), [sample]);
  const variantNode = useMemo(() => {
    if (!sample || draft.variantMode !== "nested" || !draft.variantPath.trim()) return undefined;
    return getNodes(sample, draft.variantPath.trim())[0];
  }, [sample, draft.variantMode, draft.variantPath]);
  const variantPaths = useMemo<PathSuggestion[]>(() => {
    if (draft.variantMode !== "nested") return productPaths;
    const own = variantNode ? suggestPaths(variantNode) : [];
    return [...own, ...productPaths.map((p) => ({ ...p, path: `../${p.path}` }))];
  }, [draft.variantMode, variantNode, productPaths]);
  const variantListPaths = useMemo(
    () => (sample ? suggestVariantPaths(sample).map((p) => ({ path: p, sample: undefined })) : []),
    [sample],
  );

  const setField = (key: FieldDef["key"], f: FieldDraft) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [key]: f } }));

  const onSave = () =>
    save.mutate(config, {
      onError: (err) =>
        toast.error(errorMessage(err), {
          description:
            err instanceof ApiError
              ? err.issues.map((i) => `${i.path}: ${i.message}`).join("\n")
              : undefined,
        }),
    });

  const disabled = !isOwner || save.isPending;

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0 space-y-4">
        {guessed && !saved && (
          <Alert>
            <Sparkles />
            <AlertDescription>
              Alanlar örnek üründeki adlara göre önceden dolduruldu. Önizlemeyi kontrol edip
              kaydedin.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={mode}
            onValueChange={(v) => v && setMode(v as "visual" | "json")}
          >
            <ToggleGroupItem value="visual" className="px-3 text-xs">
              <Wand2 /> Görsel düzenleyici
            </ToggleGroupItem>
            <ToggleGroupItem value="json" className="px-3 text-xs">
              <Braces /> JSON
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2">
            {saved && dirty && (
              <Button
                variant="ghost"
                size="sm"
                disabled={save.isPending}
                onClick={() => setDraft(draftFromConfig(saved))}
              >
                <RotateCcw /> Geri al
              </Button>
            )}
            <Button
              size="sm"
              onClick={onSave}
              disabled={disabled || errors.length > 0 || !dirty}
              title={!isOwner ? OWNER_ONLY_HINT : undefined}
            >
              {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              {saved ? "Kaydet" : "Eşleştirmeyi kaydet"}
            </Button>
          </div>
        </div>
        {!isOwner && <p className="text-muted-foreground text-xs">{OWNER_ONLY_HINT}</p>}

        {mode === "json" ? (
          <JsonEditor
            config={config}
            disabled={disabled}
            onApply={(c) => {
              setDraft(draftFromConfig(c));
              toast.success("JSON uygulandı");
            }}
          />
        ) : (
          <>
            <Section
              title="Yapı"
              description="Feed'de her ürün düğümü tek bir varyant mı, yoksa altında varyant listesi mi var?"
            >
              <div className="grid gap-4 py-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-xs">Varyant yapısı</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={draft.variantMode}
                    disabled={disabled}
                    onValueChange={(v) =>
                      v && setDraft((d) => ({ ...d, variantMode: v as "flat" | "nested" }))
                    }
                    className="w-full"
                  >
                    <ToggleGroupItem value="flat" className="flex-1 text-xs">
                      Düz liste
                    </ToggleGroupItem>
                    <ToggleGroupItem value="nested" className="flex-1 text-xs">
                      İç içe
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <p className="text-muted-foreground text-xs">
                    {draft.variantMode === "flat"
                      ? "Aynı model koduna sahip düğümler tek üründe toplanır."
                      : "Varyant alanları listedeki her öğeden okunur; ../ ile üst ürün düğümüne çıkılır."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Feed&apos;den kaybolan ürünler</Label>
                  <Select
                    value={draft.missingPolicy}
                    disabled={disabled}
                    onValueChange={(v) =>
                      setDraft((d) => ({ ...d, missingPolicy: v as "zero_stock" | "keep" }))
                    }
                  >
                    <SelectTrigger size="sm" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zero_stock">Stoğu 0 yap (önerilen)</SelectItem>
                      <SelectItem value="keep">Son stoğu koru</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    Tedarikçi bir ürünü feed&apos;den çıkardığında Trendyol&apos;a ne gönderilsin?
                  </p>
                </div>
                {draft.variantMode === "nested" && (
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-xs">
                      Varyant listesi yolu <span className="text-destructive">*</span>
                    </Label>
                    <PathInput
                      value={draft.variantPath}
                      onChange={(v) => setDraft((d) => ({ ...d, variantPath: v }))}
                      suggestions={variantListPaths}
                      placeholder="Varyantlar.Varyant"
                      invalid={!draft.variantPath.trim()}
                      disabled={disabled}
                    />
                    {draft.variantPath.trim() && sample && !variantNode && (
                      <p className="text-destructive text-xs">Örnek üründe bu yolda düğüm yok.</p>
                    )}
                  </div>
                )}
              </div>
            </Section>

            <Section
              title="Alanlar"
              description="Her alanın feed'de nereden okunacağını seçin ya da sabit bir değer girin."
            >
              <div className="divide-y">
                {FIELD_DEFS.map((def) => (
                  <FieldRow
                    key={def.key}
                    def={def}
                    value={draft.fields[def.key]}
                    onChange={(f) => setField(def.key, f)}
                    suggestions={def.scope === "variant" ? variantPaths : productPaths}
                    node={def.scope === "variant" && variantNode ? variantNode : sample}
                    parent={def.scope === "variant" && variantNode ? sample : undefined}
                    disabled={disabled}
                  />
                ))}
              </div>
            </Section>

            <Section
              title="Görseller ve özellikler"
              description="İsteğe bağlı. Yeni ürün açarken kullanılır; stok/fiyat senkronu için gerekmez."
            >
              <div className="space-y-5 py-3">
                <div className="space-y-2">
                  <Label className="text-xs">Görsel alanları</Label>
                  {draft.images.map((img, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex-1">
                        <PathInput
                          value={img.path}
                          onChange={(v) =>
                            setDraft((d) => ({
                              ...d,
                              images: d.images.map((x, j) => (j === i ? { ...x, path: v } : x)),
                            }))
                          }
                          suggestions={variantPaths}
                          placeholder="Resimler.Resim"
                          disabled={disabled}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        onClick={() =>
                          setDraft((d) => ({ ...d, images: d.images.filter((_, j) => j !== i) }))
                        }
                        aria-label="Görsel alanını kaldır"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || draft.images.length >= 10}
                    onClick={() => setDraft((d) => ({ ...d, images: [...d.images, emptyField()] }))}
                  >
                    <Plus /> Görsel alanı ekle
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Özellikler (renk, beden…)</Label>
                  {draft.attributes.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        value={a.name}
                        placeholder="Renk"
                        disabled={disabled}
                        className="h-8 w-28 text-xs sm:w-36"
                        aria-label="Özellik adı"
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            attributes: d.attributes.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          }))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <PathInput
                          value={a.field.path}
                          onChange={(v) =>
                            setDraft((d) => ({
                              ...d,
                              attributes: d.attributes.map((x, j) =>
                                j === i ? { ...x, field: { ...x.field, path: v } } : x,
                              ),
                            }))
                          }
                          suggestions={variantPaths}
                          disabled={disabled}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            attributes: d.attributes.filter((_, j) => j !== i),
                          }))
                        }
                        aria-label="Özelliği kaldır"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || draft.attributes.length >= 30}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        attributes: [...d.attributes, { name: "", field: emptyField() }],
                      }))
                    }
                  >
                    <Plus /> Özellik ekle
                  </Button>
                </div>
              </div>
            </Section>
          </>
        )}
      </div>

      <div className="xl:sticky xl:top-20">
        {hasProducts ? (
          <MappingPreviewPanel
            data={preview.data}
            isFetching={preview.isFetching}
            error={preview.error}
            clientErrors={errors}
          />
        ) : (
          <div className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">
            Önizleme için feed&apos;de ürün olmalı. Çekimi tamamlayın.
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-xl border">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
      <div className="px-4">{children}</div>
    </section>
  );
}

function FieldRow({
  def,
  value,
  onChange,
  suggestions,
  node,
  parent,
  disabled,
}: {
  def: FieldDef;
  value: FieldDraft;
  onChange: (f: FieldDraft) => void;
  suggestions: PathSuggestion[];
  node: unknown;
  parent: unknown;
  disabled: boolean;
}) {
  const raw =
    value.mode === "path"
      ? value.path.trim()
        ? getAtPath(node, value.path, parent)
        : undefined
      : value.constant;
  const out = applyTransforms(raw, value.transforms);
  const empty = value.mode === "path" ? !value.path.trim() : value.constant === "";
  const missing = def.required && empty;
  const pathNotFound = value.mode === "path" && !empty && node !== undefined && raw === undefined;

  return (
    <div className="grid gap-2 py-3 md:grid-cols-[9.5rem_minmax(0,1fr)] md:gap-4">
      <div className="pt-1">
        <div className="flex items-center gap-1 text-sm font-medium">
          {def.label}
          {def.required && <span className="text-destructive">*</span>}
        </div>
        {def.hint && (
          <p className="text-muted-foreground hidden text-[11px] leading-snug md:block">
            {def.hint}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={value.mode}
            disabled={disabled}
            onValueChange={(v) => v && onChange({ ...value, mode: v as "path" | "constant" })}
            aria-label={`${def.label} kaynağı`}
          >
            <ToggleGroupItem value="path" className="h-8 px-2 text-xs">
              Alan
            </ToggleGroupItem>
            <ToggleGroupItem value="constant" className="h-8 px-2 text-xs">
              Sabit
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="min-w-0 flex-1">
            {value.mode === "path" ? (
              <PathInput
                value={value.path}
                onChange={(p) => onChange({ ...value, path: p })}
                suggestions={suggestions}
                invalid={missing}
                disabled={disabled}
                placeholder={def.required ? "Zorunlu alan yolu" : "Eşleştirilmedi"}
              />
            ) : (
              <Input
                value={value.constant}
                onChange={(e) => onChange({ ...value, constant: e.target.value })}
                placeholder={def.placeholder ?? "Sabit değer"}
                disabled={disabled}
                aria-invalid={missing || undefined}
                className="h-8 text-xs"
              />
            )}
          </div>
          <AddTransformMenu
            onAdd={(t) => onChange({ ...value, transforms: [...value.transforms, t] })}
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 px-2"
              disabled={disabled || value.transforms.length >= 10}
              aria-label="Dönüşüm ekle"
            >
              <Wand2 />
              {value.transforms.length > 0 && (
                <Badge variant="muted" className="px-1.5 tabular-nums">
                  {value.transforms.length}
                </Badge>
              )}
            </Button>
          </AddTransformMenu>
        </div>
        {!empty && (
          <p
            className={cn(
              "text-muted-foreground flex min-w-0 items-center gap-1 text-[11px]",
              pathNotFound && "text-amber-700 dark:text-amber-400",
            )}
          >
            {pathNotFound ? (
              <>
                <Info className="size-3 shrink-0" /> Örnek üründe bu alan yok
              </>
            ) : (
              <span className="truncate">
                Örnek: <span className="text-foreground/80">{raw ?? "—"}</span>
                {value.transforms.length > 0 && raw !== out && (
                  <>
                    {" → "}
                    <span className="text-foreground font-medium">{out ?? "boş"}</span>
                  </>
                )}
              </span>
            )}
          </p>
        )}
        <TransformsEditor
          value={value.transforms}
          onChange={(transforms) => onChange({ ...value, transforms })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function JsonEditor({
  config,
  onApply,
  disabled,
}: {
  config: MappingConfig;
  onApply: (c: MappingConfig) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`JSON okunamadı: ${(e as Error).message}`);
      return;
    }
    const c = parsed as Partial<MappingConfig>;
    if (
      !c ||
      typeof c !== "object" ||
      c.version !== 1 ||
      (c.variantMode !== "flat" && c.variantMode !== "nested") ||
      !c.fields ||
      typeof c.fields !== "object"
    ) {
      setError('Geçersiz yapı: "version": 1, "variantMode" ve "fields" gerekli.');
      return;
    }
    setError(null);
    onApply({ missingPolicy: "zero_stock", ...c } as MappingConfig);
  };

  return (
    <div className="bg-card space-y-3 rounded-xl border p-4">
      <p className="text-muted-foreground text-xs">
        Gelişmiş kullanım: eşleştirmeyi doğrudan düzenleyin. Uyguladığınızda önizleme güncellenir;
        kaydetmek için yukarıdaki “Kaydet” düğmesini kullanın.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        disabled={disabled}
        className="min-h-[28rem] font-mono text-xs leading-relaxed"
        aria-label="Eşleştirme JSON"
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setText(JSON.stringify(config, null, 2));
            setError(null);
          }}
        >
          <RotateCcw /> Sıfırla
        </Button>
        <Button size="sm" variant="secondary" onClick={apply} disabled={disabled}>
          Uygula
        </Button>
      </div>
    </div>
  );
}
