"use client";

import {
  Download,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { OWNER_ONLY_HINT } from "@/components/owner-only";
import { SupplierFormSheet } from "@/components/suppliers/supplier-form-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage, type Supplier } from "@/lib/api";
import { useDeleteSupplier, useFetchSupplier, useRole, useUpdateSupplier } from "@/lib/queries";

function OwnerItem({
  isOwner,
  icon: Icon,
  label,
  onSelect,
  destructive,
}: {
  isOwner: boolean;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}) {
  const item = (
    <DropdownMenuItem
      disabled={!isOwner}
      onSelect={onSelect}
      variant={destructive ? "destructive" : "default"}
    >
      <Icon /> {label}
    </DropdownMenuItem>
  );
  if (isOwner) return item;
  // Devre dışı menü öğesi olay almaz; tooltip sarmalayıcıya bağlanır.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>{item}</div>
      </TooltipTrigger>
      <TooltipContent side="left">{OWNER_ONLY_HINT}</TooltipContent>
    </Tooltip>
  );
}

export function useTogglePause() {
  const update = useUpdateSupplier();
  return {
    isPending: update.isPending,
    toggle: (s: Supplier) =>
      update.mutate(
        { id: s.id, patch: { syncPaused: !s.syncPaused } },
        {
          onSuccess: () =>
            toast.success(s.syncPaused ? "Senkron devam ediyor" : "Senkron duraklatıldı", {
              description: s.syncPaused
                ? `${s.name} için stok ve fiyat güncellemeleri yeniden açıldı.`
                : `${s.name} için Trendyol'a stok ve fiyat güncellemesi gönderilmeyecek.`,
            }),
          onError: (err) => toast.error(errorMessage(err)),
        },
      ),
  };
}

export function FetchNowButton({
  supplier,
  size = "sm",
  variant = "outline",
  label = "Şimdi çek",
}: {
  supplier: Supplier;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
  label?: string;
}) {
  const fetchNow = useFetchSupplier();
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => fetchNow.mutate(supplier.id)}
      disabled={fetchNow.isPending}
    >
      {fetchNow.isPending ? <Loader2 className="animate-spin" /> : <Download />}
      {label}
    </Button>
  );
}

export function SupplierActionsMenu({
  supplier,
  onDeleted,
  triggerVariant = "ghost",
  withFetch = true,
}: {
  supplier: Supplier;
  onDeleted?: () => void;
  triggerVariant?: "ghost" | "outline";
  withFetch?: boolean;
}) {
  const { isOwner } = useRole();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fetchNow = useFetchSupplier();
  const pause = useTogglePause();
  const remove = useDeleteSupplier();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={triggerVariant}
            size="icon-sm"
            aria-label={`${supplier.name} işlemleri`}
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
          {withFetch && (
            <>
              <DropdownMenuItem
                onSelect={() => fetchNow.mutate(supplier.id)}
                disabled={fetchNow.isPending}
              >
                <Download /> Şimdi çek
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <OwnerItem
            isOwner={isOwner}
            icon={supplier.syncPaused ? Play : Pause}
            label={supplier.syncPaused ? "Senkrona devam et" : "Senkronu duraklat"}
            onSelect={() => pause.toggle(supplier)}
          />
          <OwnerItem
            isOwner={isOwner}
            icon={Pencil}
            label="Düzenle"
            onSelect={() => setEditOpen(true)}
          />
          <DropdownMenuSeparator />
          <OwnerItem
            isOwner={isOwner}
            icon={Trash2}
            label="Sil"
            destructive
            onSelect={() => setDeleteOpen(true)}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <SupplierFormSheet open={editOpen} onOpenChange={setEditOpen} supplier={supplier} />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>&ldquo;{supplier.name}&rdquo; silinsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              Tedarikçi, feed ayarları ve bu tedarikçiden okunan ürün kayıtları kalıcı olarak
              silinir. Bu işlem geri alınamaz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-white"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                remove.mutate(supplier.id, {
                  onSuccess: () => {
                    setDeleteOpen(false);
                    onDeleted?.();
                  },
                });
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Evet, sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
