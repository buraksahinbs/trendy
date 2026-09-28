"use client";

import {
  ArrowRight,
  Check,
  Download,
  KeyRound,
  ListChecks,
  RefreshCcw,
  Truck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ChecklistState {
  /** "saved": kaydedildi ama doğrulanmadı */
  credentials: "none" | "saved" | "verified";
  supplier: boolean;
  /** Eşleştirmesi olan ilk tedarikçi (yoksa ilk tedarikçi) */
  mappingSupplierId: number | null;
  mapping: boolean;
  firstFetch: boolean;
  firstSync: boolean;
}

interface Step {
  done: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  cta: string;
  note?: string;
}

export function OnboardingChecklist({ state }: { state: ChecklistState }) {
  const supplierHref = state.mappingSupplierId
    ? `/tedarikciler/${state.mappingSupplierId}`
    : "/tedarikciler";
  const steps: Step[] = [
    {
      done: state.credentials === "verified",
      icon: KeyRound,
      title: "Trendyol bilgilerini girin ve doğrulayın",
      description: "Satıcı ID, API Key ve Secret ile mağazanızı bağlayıp bağlantıyı test edin.",
      href: "/ayarlar?sekme=trendyol",
      cta: state.credentials === "saved" ? "Bağlantıyı test et" : "Bilgileri gir",
      ...(state.credentials === "saved" ? { note: "Kaydedildi, doğrulanmadı" } : {}),
    },
    {
      done: state.supplier,
      icon: Truck,
      title: "Tedarikçi ekleyin",
      description: "XML feed adresini girin; ürün düğümünü ve kimlik alanını birlikte bulalım.",
      href: "/tedarikciler",
      cta: "Tedarikçi ekle",
    },
    {
      done: state.mapping,
      icon: Workflow,
      title: "Alanları eşleştirin",
      description: "Barkod, stok ve maliyet gibi alanların feed'de nerede olduğunu gösterin.",
      href: `${supplierHref}?sekme=eslestirme`,
      cta: "Eşleştir",
    },
    {
      done: state.firstFetch,
      icon: Download,
      title: "İlk çekimi yapın",
      description: "Feed'i çekip ürünlerin doğru okunduğunu ve sorunsuz eşleştiğini kontrol edin.",
      href: supplierHref,
      cta: "Tedarikçiye git",
    },
    {
      done: state.firstSync,
      icon: RefreshCcw,
      title: "İlk senkronu tamamlayın",
      description: "Stoklar barkodla Trendyol ürünlerinize eşlenir ve gönderilir.",
      href: "/urunler",
      cta: "Ürünlere git",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const nextIndex = steps.findIndex((s) => !s.done);
  const pct = Math.round((doneCount / steps.length) * 100);

  return (
    <Card className="gap-4 overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="text-brand size-4" />
          Kurulum
        </CardTitle>
        <CardDescription>Mağazanızı otomatik senkrona hazırlamak için birkaç adım.</CardDescription>
        <CardAction className="text-muted-foreground text-sm tabular-nums">
          {doneCount}/{steps.length}
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="bg-muted h-1.5 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="bg-brand h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ol className="divide-y rounded-lg border">
          {steps.map((s, i) => {
            const isNext = i === nextIndex;
            return (
              <li
                key={s.title}
                className={cn(
                  "flex flex-col gap-3 p-4 sm:flex-row sm:items-center",
                  isNext && "bg-muted/40",
                )}
              >
                <div className="flex flex-1 items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                      s.done && "bg-success border-success text-white",
                      isNext && "border-foreground",
                    )}
                  >
                    {s.done ? <Check className="size-4" /> : i + 1}
                  </span>
                  <div className="min-w-0">
                    <div
                      className={cn(
                        "flex flex-wrap items-center gap-2 text-sm font-medium",
                        s.done && "text-muted-foreground",
                      )}
                    >
                      <span className={cn(s.done && "line-through decoration-1")}>{s.title}</span>
                      {s.note && !s.done && (
                        <Badge variant="warning" className="font-normal">
                          {s.note}
                        </Badge>
                      )}
                    </div>
                    {!s.done && <p className="text-muted-foreground text-xs">{s.description}</p>}
                  </div>
                </div>
                {!s.done && (
                  <Button
                    asChild
                    size="sm"
                    variant={isNext ? "default" : "outline"}
                    className="self-start sm:self-center"
                  >
                    <Link href={s.href}>
                      {s.cta} <ArrowRight />
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
