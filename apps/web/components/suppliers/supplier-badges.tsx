import { AlertTriangle, Circle, PauseCircle, Settings2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Supplier } from "@/lib/api";

export function isSupplierConfigMissing(s: Pick<Supplier, "itemPath" | "externalIdPath">) {
  return !s.itemPath || !s.externalIdPath;
}

export function SupplierBadges({
  supplier,
  shrinkBlocked = false,
}: {
  supplier: Supplier;
  shrinkBlocked?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {supplier.active ? (
        <Badge variant="success">
          <Circle className="fill-current" />
          Aktif
        </Badge>
      ) : (
        <Badge variant="muted">
          <Circle />
          Pasif
        </Badge>
      )}
      {supplier.syncPaused && (
        <Badge variant="warning">
          <PauseCircle />
          Senkron duraklatıldı
        </Badge>
      )}
      {isSupplierConfigMissing(supplier) && (
        <Badge variant="warning">
          <Settings2 />
          Yapılandırma eksik
        </Badge>
      )}
      {shrinkBlocked && (
        <Badge variant="danger">
          <AlertTriangle />
          Güvenlik freni
        </Badge>
      )}
    </div>
  );
}
