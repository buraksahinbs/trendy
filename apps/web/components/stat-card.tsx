import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "danger" | "warning" | "brand";

export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  state,
  tone = "default",
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  state: "loading" | "error" | "ok";
  tone?: StatTone;
  href?: string;
}) {
  const card = (
    <Card
      className={cn("h-full gap-3 py-5", href && "hover:border-foreground/20 transition-colors")}
    >
      <CardHeader className="px-5">
        <CardDescription className="flex items-center gap-2 text-sm">{label}</CardDescription>
        <CardAction>
          <span
            className={cn(
              "bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-lg",
              tone === "danger" && "bg-destructive/10 text-destructive",
              tone === "warning" && "bg-warning/15 dark:text-warning text-amber-700",
              tone === "brand" && "bg-brand/10 text-brand",
            )}
          >
            <Icon className="size-4" />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-1 px-5">
        {state === "loading" ? (
          <>
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-28" />
          </>
        ) : (
          <>
            <div
              className={cn(
                "text-2xl font-semibold tracking-tight tabular-nums",
                tone === "danger" && "text-destructive",
              )}
            >
              {state === "error" ? "—" : value}
            </div>
            <p className="text-muted-foreground truncate text-xs">
              {state === "error" ? "Veri alınamadı" : hint}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-2">
      {card}
    </Link>
  ) : (
    card
  );
}
