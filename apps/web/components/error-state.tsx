"use client";

import { AlertTriangle, Construction, RefreshCw } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api";

export function ErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const notReady = error instanceof ApiError && error.code === "not_implemented";
  return (
    <EmptyState
      icon={notReady ? Construction : AlertTriangle}
      title={notReady ? "Bu bölüm henüz hazır değil" : "Veriler yüklenemedi"}
      description={errorMessage(error)}
      className={className}
      action={
        onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw /> Tekrar dene
          </Button>
        )
      }
    />
  );
}
