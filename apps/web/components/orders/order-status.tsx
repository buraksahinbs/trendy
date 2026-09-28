import { Badge } from "@/components/ui/badge";

type Variant = "success" | "warning" | "danger" | "info" | "muted" | "outline";

export const ORDER_STATUS: Record<string, { label: string; variant: Variant }> = {
  Created: { label: "Yeni", variant: "info" },
  Picking: { label: "Hazırlanıyor", variant: "warning" },
  Invoiced: { label: "Faturalandı", variant: "warning" },
  Shipped: { label: "Kargoda", variant: "info" },
  Delivered: { label: "Teslim edildi", variant: "success" },
  Cancelled: { label: "İptal", variant: "danger" },
  UnDelivered: { label: "Teslim edilemedi", variant: "danger" },
  Returned: { label: "İade", variant: "muted" },
  UnSupplied: { label: "Tedarik edilemedi", variant: "danger" },
  Awaiting: { label: "Bekliyor", variant: "muted" },
  UnPacked: { label: "Paketten çıkarıldı", variant: "muted" },
  AtCollectionPoint: { label: "Teslim noktasında", variant: "info" },
  Verified: { label: "Onaylandı", variant: "success" },
};

export const ORDER_STATUS_ORDER = [
  "Created",
  "Picking",
  "Invoiced",
  "Shipped",
  "AtCollectionPoint",
  "Delivered",
  "Cancelled",
  "UnDelivered",
  "Returned",
  "UnSupplied",
  "Awaiting",
  "UnPacked",
  "Verified",
];

export function orderStatusLabel(status: string | null): string {
  if (!status) return "—";
  return ORDER_STATUS[status]?.label ?? status;
}

export function OrderStatusBadge({ status }: { status: string | null }) {
  const s = status ? ORDER_STATUS[status] : undefined;
  return <Badge variant={s?.variant ?? "outline"}>{s?.label ?? status ?? "—"}</Badge>;
}

export function PackageOriginBadge({ createdBy }: { createdBy: string | null }) {
  if (createdBy === "split")
    return (
      <Badge variant="outline" className="font-normal">
        Bölünmüş paket
      </Badge>
    );
  if (createdBy === "cancel")
    return (
      <Badge variant="outline" className="font-normal">
        Kısmi iptal
      </Badge>
    );
  if (createdBy === "transfer")
    return (
      <Badge variant="outline" className="font-normal">
        Aktarılmış paket
      </Badge>
    );
  return null;
}

export function channelLabel(channelId: number | null): string | null {
  if (channelId === 25) return "Luxe";
  if (channelId === 1) return "Standart";
  return channelId === null ? null : `Kanal ${channelId}`;
}
