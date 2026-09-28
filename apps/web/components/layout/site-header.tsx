"use client";

import { OctagonPause } from "lucide-react";
import Link from "next/link";

import { AlertsBell } from "@/components/alerts/panel-alerts";
import { TenantSwitcher } from "@/components/layout/tenant-switcher";
import { UserMenu } from "@/components/layout/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useTrendyolStatus } from "@/lib/queries";

export function SiteHeader() {
  const status = useTrendyolStatus();
  return (
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-5" />
      <TenantSwitcher />
      <div className="ml-auto flex items-center gap-1">
        {status.data?.syncPaused && (
          <Link
            href="/ayarlar"
            className="border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 mr-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors"
            title="Tüm stok ve fiyat gönderimleri durduruldu"
          >
            <OctagonPause className="size-3.5" />
            <span className="hidden sm:inline">Senkron durduruldu</span>
          </Link>
        )}
        <AlertsBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
