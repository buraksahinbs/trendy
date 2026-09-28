"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Transform } from "@/lib/api";

export const TRANSFORM_LABEL: Record<Transform["type"], string> = {
  trim: "Boşlukları kırp",
  strip_html: "HTML temizle",
  replace: "Bul ve değiştir",
  map: "Değer eşle",
  upper: "BÜYÜK harf",
  lower: "küçük harf",
  split: "Böl ve parça al",
  prefix: "Başına ekle",
  default: "Boşsa varsayılan",
};

const TEMPLATES: Record<Transform["type"], Transform> = {
  trim: { type: "trim" },
  strip_html: { type: "strip_html" },
  replace: { type: "replace", find: "", replace: "" },
  map: { type: "map", values: { "": "" } },
  upper: { type: "upper" },
  lower: { type: "lower" },
  split: { type: "split", separator: ",", index: 0 },
  prefix: { type: "prefix", value: "" },
  default: { type: "default", value: "" },
};

const PRIMARY: Transform["type"][] = ["trim", "strip_html", "replace", "map"];
const MORE: Transform["type"][] = ["upper", "lower", "split", "prefix", "default"];

export function AddTransformMenu({
  onAdd,
  children,
}: {
  onAdd: (t: Transform) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Dönüşüm ekle
        </DropdownMenuLabel>
        {PRIMARY.map((t) => (
          <DropdownMenuItem key={t} onSelect={() => onAdd(structuredClone(TEMPLATES[t]))}>
            {TRANSFORM_LABEL[t]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {MORE.map((t) => (
          <DropdownMenuItem key={t} onSelect={() => onAdd(structuredClone(TEMPLATES[t]))}>
            {TRANSFORM_LABEL[t]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Dönüşüm zinciri: sırayla uygulanır. */
export function TransformsEditor({
  value,
  onChange,
  disabled,
}: {
  value: Transform[];
  onChange: (v: Transform[]) => void;
  disabled?: boolean;
}) {
  if (value.length === 0) return null;
  const set = (i: number, t: Transform) => onChange(value.map((x, j) => (j === i ? t : x)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x!);
    onChange(next);
  };
  return (
    <ol className="space-y-2">
      {value.map((t, i) => (
        <li key={i} className="bg-muted/40 rounded-md border px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground w-4 text-center text-[11px] tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 text-xs font-medium">{TRANSFORM_LABEL[t.type]}</span>
            <div className="flex">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6"
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
                aria-label="Yukarı taşı"
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6"
                disabled={disabled || i === value.length - 1}
                onClick={() => move(i, 1)}
                aria-label="Aşağı taşı"
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-6"
                disabled={disabled}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label="Dönüşümü kaldır"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
          <TransformParams t={t} onChange={(nt) => set(i, nt)} disabled={disabled} />
        </li>
      ))}
    </ol>
  );
}

const small = "h-7 text-xs";

function TransformParams({
  t,
  onChange,
  disabled,
}: {
  t: Transform;
  onChange: (t: Transform) => void;
  disabled?: boolean;
}) {
  switch (t.type) {
    case "replace":
      return (
        <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
          <Input
            className={small}
            placeholder="Bul"
            value={t.find}
            disabled={disabled}
            onChange={(e) => onChange({ ...t, find: e.target.value })}
          />
          <Input
            className={small}
            placeholder="Yerine (boş = sil)"
            value={t.replace}
            disabled={disabled}
            onChange={(e) => onChange({ ...t, replace: e.target.value })}
          />
        </div>
      );
    case "split":
      return (
        <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
          <Input
            className={small}
            placeholder="Ayraç"
            value={t.separator}
            disabled={disabled}
            onChange={(e) => onChange({ ...t, separator: e.target.value })}
          />
          <Input
            className={small}
            type="number"
            min={-20}
            max={20}
            placeholder="Parça (0 = ilk, -1 = son)"
            value={t.index}
            disabled={disabled}
            onChange={(e) => onChange({ ...t, index: Number(e.target.value) || 0 })}
          />
        </div>
      );
    case "prefix":
    case "default":
      return (
        <div className="mt-2 pl-6">
          <Input
            className={small}
            placeholder={t.type === "prefix" ? "Ör. https://cdn.ornek.com/" : "Varsayılan değer"}
            value={t.value}
            disabled={disabled}
            onChange={(e) => onChange({ ...t, value: e.target.value })}
          />
        </div>
      );
    case "map":
      return <MapParams t={t} onChange={onChange} disabled={disabled} />;
    default:
      return null;
  }
}

function MapParams({
  t,
  onChange,
  disabled,
}: {
  t: Extract<Transform, { type: "map" }>;
  onChange: (t: Transform) => void;
  disabled?: boolean;
}) {
  const rows = Object.entries(t.values);
  const setRows = (r: [string, string][]) => onChange({ ...t, values: Object.fromEntries(r) });
  return (
    <div className="mt-2 space-y-1.5 pl-6">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            className={small}
            placeholder="Feed'deki değer"
            value={k}
            disabled={disabled}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
          />
          <span className="text-muted-foreground text-xs">→</span>
          <Input
            className={small}
            placeholder="Yeni değer"
            value={v}
            disabled={disabled}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            disabled={disabled || rows.length === 1}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            aria-label="Satırı sil"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={disabled || rows.some(([k]) => k === "")}
          onClick={() => setRows([...rows, ["", ""]])}
        >
          <Plus className="size-3.5" /> Satır ekle
        </Button>
        <Input
          className={`${small} flex-1`}
          placeholder="Eşleşmezse (boş = aynen bırak)"
          value={t.default ?? ""}
          disabled={disabled}
          onChange={(e) => {
            const { default: _omit, ...rest } = t;
            void _omit;
            onChange(e.target.value ? { ...rest, default: e.target.value } : rest);
          }}
        />
      </div>
    </div>
  );
}
