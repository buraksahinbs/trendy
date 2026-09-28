"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ROLE_LABEL } from "@/components/layout/tenant-switcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

export function UserMenu() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const router = useRouter();

  const logout = useMutation({
    mutationFn: api.auth.logout,
    onSuccess: () => {
      qc.clear();
      router.replace("/giris");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!me) return null;
  const letter = me.email[0]?.toLocaleUpperCase("tr-TR") ?? "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Hesap menüsü">
          <Avatar className="size-7">
            <AvatarFallback className="bg-brand/15 text-brand text-xs font-semibold">
              {letter}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="truncate text-sm font-medium">{me.email}</span>
          {me.role && <span className="text-muted-foreground text-xs">{ROLE_LABEL[me.role]}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/ayarlar?sekme=hesap">
            <KeyRound /> Şifre değiştir
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/ayarlar">
            <Settings /> Ayarlar
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut /> Çıkış yap
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
