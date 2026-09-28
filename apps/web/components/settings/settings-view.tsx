"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { StoreSettings } from "@/components/settings/store-settings";
import { TrendyolCredentialsCard } from "@/components/settings/trendyol-credentials-card";
import { WebhookCard } from "@/components/settings/webhook-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCredentials, useMe, useSettings } from "@/lib/queries";

const TABS = ["magaza", "trendyol", "hesap"] as const;
type Tab = (typeof TABS)[number];

export function SettingsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const raw = params.get("sekme");
  const tab: Tab = TABS.includes(raw as Tab) ? (raw as Tab) : "magaza";

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    if (t === "magaza") next.delete("sekme");
    else next.set("sekme", t);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="Ayarlar"
        description="Senkron kuralları, Trendyol bağlantısı ve hesap güvenliği."
      />
      <Tabs value={tab} onValueChange={setTab} className="gap-6">
        <TabsList>
          <TabsTrigger value="magaza" className="px-3">
            Mağaza ve senkron
          </TabsTrigger>
          <TabsTrigger value="trendyol">Trendyol</TabsTrigger>
          <TabsTrigger value="hesap">Hesap</TabsTrigger>
        </TabsList>
        <TabsContent value="magaza">
          <StoreSettingsTab />
        </TabsContent>
        <TabsContent value="trendyol">
          <TrendyolSettings />
        </TabsContent>
        <TabsContent value="hesap">
          <AccountSettings />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StoreSettingsTab() {
  const settings = useSettings();
  if (settings.isError)
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  if (settings.isPending)
    return (
      <div className="grid gap-6">
        <Skeleton className="h-24 rounded-xl" />
        <div className="grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  return <StoreSettings settings={settings.data} />;
}

function TrendyolSettings() {
  const creds = useCredentials();
  const settings = useSettings();
  if (creds.isError) return <ErrorState error={creds.error} onRetry={() => void creds.refetch()} />;
  if (creds.isPending)
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[30rem] rounded-xl" />
        <Skeleton className="h-[30rem] rounded-xl" />
      </div>
    );
  return (
    <div className="grid gap-6">
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {(["prod", "stage"] as const).map((env) => (
          <TrendyolCredentialsCard
            key={env}
            env={env}
            current={creds.data.find((c) => c.env === env)}
            activeForSync={settings.data?.syncEnv === env}
          />
        ))}
      </div>
      <WebhookCard />
    </div>
  );
}

function AccountSettings() {
  const { data: me } = useMe();
  return (
    <div className="space-y-6">
      {me && (
        <div className="text-muted-foreground max-w-xl text-sm">
          Giriş e-postası: <span className="text-foreground font-medium">{me.email}</span>
        </div>
      )}
      <ChangePasswordForm />
    </div>
  );
}
