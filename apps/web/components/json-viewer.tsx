"use client";

import { ChevronRight, Copy } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function Primitive({ value }: { value: Json }) {
  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (typeof value === "string")
    return <span className="text-emerald-700 dark:text-emerald-400">&quot;{value}&quot;</span>;
  if (typeof value === "number")
    return <span className="text-sky-700 dark:text-sky-400">{value}</span>;
  return <span className="text-violet-700 dark:text-violet-400">{String(value)}</span>;
}

function Node({ name, value, depth }: { name?: string; value: Json; depth: number }) {
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 1);
  const label = name !== undefined && <span className="text-foreground/80">{name}: </span>;

  if (!isObj) {
    return (
      <div className="pl-5 break-all">
        {label}
        <Primitive value={value} />
      </div>
    );
  }

  const entries: [string, Json][] = Array.isArray(value)
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value);
  const brackets = Array.isArray(value) ? ["[", "]"] : ["{", "}"];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-muted -ml-0.5 inline-flex items-center gap-0.5 rounded px-0.5 text-left"
      >
        <ChevronRight
          className={cn("text-muted-foreground size-3.5 transition-transform", open && "rotate-90")}
        />
        {label}
        <span className="text-muted-foreground">
          {brackets[0]}
          {!open && ` ${entries.length} öğe ${brackets[1]}`}
        </span>
      </button>
      {open && (
        <div className="border-border/60 ml-[7px] border-l pl-2">
          {entries.map(([k, v]) => (
            <Node key={k} name={k} value={v} depth={depth + 1} />
          ))}
        </div>
      )}
      {open && <div className="text-muted-foreground pl-5">{brackets[1]}</div>}
    </div>
  );
}

export function JsonViewer({ value, className }: { value: unknown; className?: string }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      toast.success("JSON kopyalandı");
    } catch {
      toast.error("Kopyalanamadı");
    }
  };
  return (
    <div className={cn("bg-muted/40 relative rounded-lg border p-3 font-mono text-xs", className)}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1.5 right-1.5 size-7"
        onClick={copy}
        aria-label="JSON'u kopyala"
      >
        <Copy className="size-3.5" />
      </Button>
      <div className="overflow-x-auto pr-8 leading-relaxed">
        <Node value={value as Json} depth={0} />
      </div>
    </div>
  );
}
