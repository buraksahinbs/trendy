"use client";

import { OctagonPause } from "lucide-react";
import Link from "next/link";

import { AlertsBell } from "@/components/alerts/panel-alerts";
import { CommandSearch } from "@/components/layout/command-search";
import { TenantSwitcher } from "@/components/layout/tenant-switcher";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { formatRelative } from "@/lib/format";
import { useTrendyolStatus } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
      <TenantSwitcher />
      <div className="ml-auto flex items-center gap-1.5">
        <CommandSearch />
        <SyncPill />
        <AlertsBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}

/**
 * Senkron durumu her sayfada görünür: mağazaya stok/fiyat gönderen bir üründe "şu an gönderim
 * yapılıyor mu, hangi ortama?" sorusu Ayarlar'a gitmeden cevaplanmalı.
 */
function SyncPill() {
  const status = useTrendyolStatus();
  const st = status.data;
  if (!st) return null;
  const paused = st.syncPaused;
  const stage = st.syncEnv === "stage";
  const last = st.lastSync?.finishedAt ?? st.lastSync?.startedAt;
  const title = paused
    ? "Tüm stok ve fiyat gönderimleri durduruldu"
    : `Stok ve fiyatlar ${stage ? "test (stage)" : "canlı"} ortama gönderiliyor${
        last ? ` · son senkron ${formatRelative(last)}` : ""
      }`;
  return (
    <Link
      href="/ayarlar"
      title={title}
      className={cn(
        "mr-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
        paused
          ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15"
          : "hover:bg-muted text-muted-foreground",
      )}
    >
      {paused ? (
        <OctagonPause className="size-3.5" />
      ) : (
        <span className="relative flex size-2">
          <span className="bg-success absolute inline-flex size-full animate-ping rounded-full opacity-40 motion-reduce:hidden" />
          <span className="bg-success relative inline-flex size-2 rounded-full" />
        </span>
      )}
      <span className="hidden md:inline">{paused ? "Senkron durduruldu" : "Senkron aktif"}</span>
      {stage && !paused && (
        <span className="bg-warning/15 text-warning rounded px-1 text-[10px]">Test ortamı</span>
      )}
    </Link>
  );
}
