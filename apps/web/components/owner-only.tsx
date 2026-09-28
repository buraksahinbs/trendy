"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRole } from "@/lib/queries";

export const OWNER_ONLY_HINT = "Bu işlemi yalnızca mağaza sahibi yapabilir";

/**
 * Personel (staff) için alt öğeyi devre dışı gösterir ve nedenini tooltip ile açıklar.
 * Alt öğe `disabled` prop'unu desteklemelidir.
 */
export function OwnerOnly({
  children,
}: {
  children: (props: { disabled: boolean }) => React.ReactNode;
}) {
  const { isOwner } = useRole();
  if (isOwner) return <>{children({ disabled: false })}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Devre dışı butonlar olay üretmez; tooltip için sarmalayıcı gerekir */}
        <span className="inline-flex" tabIndex={0}>
          {children({ disabled: true })}
        </span>
      </TooltipTrigger>
      <TooltipContent>{OWNER_ONLY_HINT}</TooltipContent>
    </Tooltip>
  );
}
