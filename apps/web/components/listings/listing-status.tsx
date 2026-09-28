import { Badge } from "@/components/ui/badge";
import type { ListingStatus } from "@/lib/api";

type Variant = "success" | "warning" | "danger" | "info" | "muted" | "outline";

export const LISTING_STATUS: Record<ListingStatus, { label: string; variant: Variant }> = {
  approved: { label: "Onaylı", variant: "success" },
  pending: { label: "Onay bekliyor", variant: "info" },
  rejected: { label: "Reddedildi", variant: "danger" },
  locked: { label: "Kilitli", variant: "warning" },
  archived: { label: "Arşivde", variant: "muted" },
  blacklisted: { label: "Kara liste", variant: "danger" },
  unknown: { label: "Trendyol'da yok", variant: "muted" },
};

export const LISTING_STATUS_ORDER: ListingStatus[] = [
  "approved",
  "pending",
  "rejected",
  "locked",
  "archived",
  "blacklisted",
  "unknown",
];

export function ListingStatusBadge({ status }: { status: ListingStatus | null }) {
  if (status === null)
    return (
      <Badge variant="outline" className="text-muted-foreground font-normal">
        Trendyol&apos;da değil
      </Badge>
    );
  const s = LISTING_STATUS[status] ?? LISTING_STATUS.unknown;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/** Trendyol'un `rejectReasonDetails` listesini okunur satırlara çevirir. */
export function rejectReasonLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => {
      if (typeof r === "string") return r;
      if (r && typeof r === "object") {
        const o = r as { rejectReason?: unknown; rejectReasonDetail?: unknown };
        return [o.rejectReason, o.rejectReasonDetail]
          .filter((x): x is string => typeof x === "string" && x.length > 0)
          .join(": ");
      }
      return "";
    })
    .filter(Boolean);
}
