"use client";

import {
  ArrowRight,
  Check,
  KeyRound,
  ListChecks,
  RefreshCcw,
  Truck,
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
  // Tedarikçi var ama alanları onaylanmamışsa (eski akışla eklenmiş) ikinci adım eşleştirmeye götürür.
  const supplierStep: Step =
    state.supplier && !state.mapping
      ? {
          done: false,
          icon: Truck,
          title: "Tedarikçi alanlarını onaylayın",
          description: "Barkod ve stok alanının feed'de nerede olduğunu seçin.",
          href: `${supplierHref}?sekme=eslestirme`,
          cta: "Alanları seç",
        }
      : {
          done: state.supplier && state.mapping,
          icon: Truck,
          title: "Tedarikçi XML'ini ekleyin",
          description:
            "Adresi yapıştırın; yapı ve alanlar otomatik bulunur, siz yalnızca kontrol edin.",
          href: "/tedarikciler?ekle=1",
          cta: "Tedarikçi ekle",
        };
  const steps: Step[] = [
    {
      done: state.credentials === "verified",
      icon: KeyRound,
      title: "Trendyol mağazanızı bağlayın",
      description:
        "Satıcı ID, API Key ve Secret: Trendyol satıcı paneli › Hesap Bilgilerim › Entegrasyon Bilgileri.",
      href: "/ayarlar?sekme=trendyol",
      cta: state.credentials === "saved" ? "Bağlantıyı test et" : "Bağla",
      ...(state.credentials === "saved" ? { note: "Kaydedildi, doğrulanmadı" } : {}),
    },
    supplierStep,
    {
      done: state.firstFetch && state.firstSync,
      icon: RefreshCcw,
      title: "İlk senkronu kontrol edin",
      description:
        "Ürünler barkodla Trendyol'daki ürünlerinize eşlenir ve stoklar otomatik gönderilir. Sonucu Ürünler'de görün.",
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
        <CardDescription>Üç adımda stoklarınız tedarikçinizle otomatik eşitlenir.</CardDescription>
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
