"use client";

import { ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

import type { PathSuggestion } from "@/components/mapping/mapping-utils";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Alan yolu girişi: serbest yazım + örnek üründeki alanlardan öneri listesi (değer örneğiyle).
 */
export function PathInput({
  value,
  onChange,
  suggestions,
  placeholder = "Alan yolu",
  invalid,
  id,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: PathSuggestion[];
  placeholder?: string;
  invalid?: boolean;
  id?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const filtered = useMemo(() => {
    const q = value.trim().toLocaleLowerCase("tr-TR");
    const list = q
      ? suggestions.filter(
          (s) =>
            s.path.toLocaleLowerCase("tr-TR").includes(q) ||
            s.sample?.toLocaleLowerCase("tr-TR").includes(q),
        )
      : suggestions;
    return list.slice(0, 60);
  }, [value, suggestions]);
  const exact = suggestions.some((s) => s.path === value.trim());

  const pick = (p: string) => {
    onChange(p);
    setOpen(false);
  };

  return (
    <Popover open={open && filtered.length > 0 && !disabled} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            id={id}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            className="h-8 pr-8 font-mono text-xs"
            onChange={(e) => {
              onChange(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((a) => Math.min(a + 1, filtered.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && open && filtered[active]) {
                e.preventDefault();
                pick(filtered[active].path);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
            aria-label="Önerileri göster"
          >
            <ChevronsUpDown className="size-3.5" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-72 p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Girişe tıklamak listeyi kapatmasın
          if ((e.target as HTMLElement).closest("[role=combobox]")) e.preventDefault();
        }}
      >
        <div className="text-muted-foreground px-2 pt-1 pb-1.5 text-[11px] font-medium">
          Örnek üründeki alanlar{exact ? "" : " · yazdığınız yol da kullanılabilir"}
        </div>
        <ul role="listbox" className="max-h-64 overflow-y-auto">
          {filtered.map((s, i) => (
            <li key={s.path} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s.path)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left",
                  i === active && "bg-accent",
                )}
              >
                <span className="shrink-0 font-mono text-xs">{s.path}</span>
                {s.sample && (
                  <span className="text-muted-foreground min-w-0 truncate text-xs">{s.sample}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
