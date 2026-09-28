"use client";

import { AlertOctagon, AlertTriangle, ArrowRight, Bell, Info } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PanelAlert } from "@/lib/api";
import { useAlerts } from "@/lib/queries";
import { cn } from "@/lib/utils";

const CODE_LINK: Record<string, { href: string; label: string }> = {
  credentials_invalid: { href: "/ayarlar?sekme=trendyol", label: "Bilgileri güncelle" },
  credentials_unverified: { href: "/ayarlar?sekme=trendyol", label: "Bağlantıyı test et" },
  price_reviews_pending: { href: "/fiyat-onaylari", label: "Fiyatları incele" },
  listing_errors: { href: "/urunler?hata=1", label: "Hatalı ürünler" },
  sync_paused: { href: "/ayarlar", label: "Senkron ayarları" },
  sync_failing: { href: "/islem-gecmisi", label: "İşlem geçmişi" },
  orders_stale: { href: "/siparisler", label: "Siparişler" },
  rate_limited: { href: "/islem-gecmisi", label: "İşlem geçmişi" },
  deprecated_endpoint: { href: "/islem-gecmisi", label: "İşlem geçmişi" },
};

export function alertLink(a: PanelAlert): { href: string; label: string } | null {
  if (a.ref?.type === "supplier") {
    const tab = a.code === "supplier_mapping_missing" ? "?sekme=eslestirme" : "";
    return { href: `/tedarikciler/${a.ref.id}${tab}`, label: "Tedarikçiye git" };
  }
  return CODE_LINK[a.code] ?? null;
}

const ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;

/** Genel Bakış üstündeki uyarı listesi (en kritik önce). */
export function PanelAlerts({
  className,
  exclude = [],
}: {
  className?: string;
  /** Sayfada başka bir yerde zaten gösterilen uyarı kodları (tekrar gösterilmez). */
  exclude?: string[];
}) {
  const alerts = useAlerts();
  const shown = (alerts.data ?? []).filter((a) => !exclude.includes(a.code));
  if (!shown.length) return null;
  const major = shown.filter((a) => a.level !== "info");
  const info = shown.filter((a) => a.level === "info");
  return (
    <div className={cn("space-y-2", className)}>
      {major.map((a) => {
        const Icon = ICON[a.level];
        const link = alertLink(a);
        return (
          <Alert
            key={`${a.code}-${a.ref?.id ?? ""}`}
            variant={a.level === "critical" ? "destructive" : "warning"}
            className={cn(a.level === "critical" && "border-destructive/40 bg-destructive/5")}
          >
            <Icon />
            <AlertTitle>{a.title}</AlertTitle>
            <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p>{a.message}</p>
              {link && (
                <Button
                  asChild
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 self-start bg-transparent sm:self-center"
                >
                  <Link href={link.href}>
                    {link.label} <ArrowRight />
                  </Link>
                </Button>
              )}
            </AlertDescription>
          </Alert>
        );
      })}
      {info.length > 0 && (
        <ul className="bg-card divide-y rounded-lg border">
          {info.map((a) => {
            const link = alertLink(a);
            return (
              <li
                key={`${a.code}-${a.ref?.id ?? ""}`}
                className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 text-sm">
                    <span className="font-medium">{a.title}</span>
                    <span className="text-muted-foreground"> — {a.message}</span>
                  </div>
                </div>
                {link && (
                  <Button
                    asChild
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 self-end sm:self-center"
                  >
                    <Link href={link.href}>
                      {link.label} <ArrowRight />
                    </Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Başlıktaki zil: uyarı sayısı ve kısa liste. */
export function AlertsBell() {
  const alerts = useAlerts();
  const list = alerts.data ?? [];
  const critical = list.some((a) => a.level === "critical");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Uyarılar">
          <Bell />
          {list.length > 0 && (
            <span
              className={cn(
                "absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-4 font-semibold text-white tabular-nums",
                critical ? "bg-destructive" : "bg-brand",
              )}
            >
              {list.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Uyarılar</div>
        {list.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">
            Her şey yolunda görünüyor.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {list.map((a) => {
              const Icon = ICON[a.level];
              const link = alertLink(a);
              const body = (
                <div className="flex gap-2.5 px-4 py-3">
                  <Icon
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      a.level === "critical" && "text-destructive",
                      a.level === "warning" && "text-amber-600 dark:text-amber-400",
                      a.level === "info" && "text-muted-foreground",
                    )}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{a.title}</div>
                    <p className="text-muted-foreground line-clamp-2 text-xs">{a.message}</p>
                  </div>
                </div>
              );
              return (
                <li key={`${a.code}-${a.ref?.id ?? ""}`}>
                  {link ? (
                    <Link
                      href={link.href}
                      className="hover:bg-muted/50 block"
                      onClick={() => setOpen(false)}
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
