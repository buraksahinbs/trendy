"use client";

import { Loader2, RefreshCw, Store } from "lucide-react";

import { BrandMark } from "@/components/brand";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { ApiError, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/queries";

export function AppShell({
  defaultOpen,
  children,
}: {
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const me = useMe();

  // Oturum yoksa QueryCache girişe yönlendirir; o sırada boş ekran yerine yükleniyor gösterilir.
  if (me.isPending || (me.error instanceof ApiError && me.error.isUnauthenticated)) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4">
        <BrandMark className="size-10 animate-pulse" />
        <Loader2 className="text-muted-foreground size-4 animate-spin" />
      </div>
    );
  }

  if (me.isError) {
    return (
      <FullScreenMessage
        title="Panel yüklenemedi"
        description={errorMessage(me.error)}
        action={
          <Button variant="outline" onClick={() => void me.refetch()}>
            <RefreshCw /> Tekrar dene
          </Button>
        }
      />
    );
  }

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          {me.data.activeTenantId === null ? (
            <FullScreenMessage
              icon={<Store className="size-5" />}
              title="Aktif bir mağaza yok"
              description="Hesabınız şu an hiçbir mağazaya bağlı değil. Mağaza sahibinden sizi yeniden eklemesini isteyin."
            />
          ) : (
            <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              {children}
            </div>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function FullScreenMessage({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      {icon ?? <BrandMark className="size-10" />}
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-muted-foreground max-w-sm text-sm">{description}</p>
      {action}
    </div>
  );
}
