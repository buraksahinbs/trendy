"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, errorMessage } from "@/lib/api";
import { useMe } from "@/lib/queries";

export const ROLE_LABEL = { owner: "Sahip", staff: "Personel" } as const;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase("tr-TR"))
    .join("");
}

function TenantAvatar({ name }: { name: string }) {
  return (
    <span className="bg-foreground text-background flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold">
      {initials(name) || "?"}
    </span>
  );
}

export function TenantSwitcher() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const router = useRouter();

  const switchTenant = useMutation({
    mutationFn: api.auth.switchTenant,
    onSuccess: async (_res, tenantId) => {
      // Mağaza değişince tüm veriler yeni tenant için yeniden çekilir.
      await qc.resetQueries();
      const name = me?.tenants.find((t) => t.tenantId === tenantId)?.tenantName;
      toast.success(name ? `${name} mağazasına geçildi` : "Mağaza değiştirildi");
      router.push("/");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!me) return null;
  const active = me.tenants.find((t) => t.tenantId === me.activeTenantId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 max-w-[60vw] gap-2 px-2 sm:max-w-xs">
          <TenantAvatar name={active?.tenantName ?? "?"} />
          <span className="truncate font-medium">{active?.tenantName ?? "Mağaza seçin"}</span>
          {active && (
            <span className="text-muted-foreground hidden text-xs font-normal sm:inline">
              {ROLE_LABEL[active.role]}
            </span>
          )}
          {switchTenant.isPending ? (
            <Loader2 className="text-muted-foreground animate-spin" />
          ) : (
            <ChevronsUpDown className="text-muted-foreground" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          Mağazalar
        </DropdownMenuLabel>
        {me.tenants.map((t) => (
          <DropdownMenuItem
            key={t.tenantId}
            onSelect={() => {
              if (t.tenantId !== me.activeTenantId) switchTenant.mutate(t.tenantId);
            }}
            className="gap-2"
          >
            <TenantAvatar name={t.tenantName} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{t.tenantName}</span>
              <span className="text-muted-foreground text-xs">{ROLE_LABEL[t.role]}</span>
            </div>
            {t.tenantId === me.activeTenantId && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        {me.tenants.length === 0 && (
          <div className="text-muted-foreground px-2 py-1.5 text-sm">Bağlı mağaza yok</div>
        )}
        <DropdownMenuSeparator />
        <div className="text-muted-foreground px-2 py-1.5 text-xs">
          Başka bir mağazaya erişim için mağaza sahibinden davet isteyin.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
