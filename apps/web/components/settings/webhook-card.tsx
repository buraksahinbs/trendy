"use client";

import { AlertTriangle, Check, Copy, KeyRound, Loader2, RefreshCw, Webhook } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ErrorState } from "@/components/error-state";
import { OWNER_ONLY_HINT } from "@/components/owner-only";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/format";
import { useCreateWebhook, useRole, useWebhook } from "@/lib/queries";

export function WebhookCard() {
  const { isOwner } = useRole();
  const webhook = useWebhook(isOwner);
  const create = useCreateWebhook();
  const [confirm, setConfirm] = useState(false);
  const [secret, setSecret] = useState<{ url: string; apiKey: string } | null>(null);

  const generate = () =>
    create.mutate(undefined, {
      onSuccess: (r) => {
        setSecret({ url: r.url, apiKey: r.apiKey });
        setConfirm(false);
        toast.success("Webhook adresi oluşturuldu");
      },
    });

  const configured = webhook.data?.configured === true;

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="text-muted-foreground size-4" />
          Sipariş webhook&apos;u
        </CardTitle>
        <CardDescription>
          Trendyol yeni siparişleri bu adrese anında bildirir. Yalnızca hızlandırıcıdır: siparişler
          her durumda 5 dakikada bir otomatik çekilir.
        </CardDescription>
        {configured && (
          <CardAction>
            <Badge variant="success">
              <Check /> Tanımlı
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!isOwner ? (
          <p className="text-muted-foreground text-sm">{OWNER_ONLY_HINT}</p>
        ) : webhook.isError ? (
          <ErrorState error={webhook.error} onRetry={() => void webhook.refetch()} />
        ) : webhook.isPending ? (
          <Skeleton className="h-20 rounded-lg" />
        ) : (
          <>
            {secret ? (
              <Alert variant="warning">
                <AlertTriangle />
                <AlertTitle>API anahtarını şimdi kopyalayın</AlertTitle>
                <AlertDescription>
                  <p>
                    Bu anahtar bir daha gösterilmez. Trendyol satıcı panelinde webhook tanımlarken
                    adres ve anahtarı girin (kimlik doğrulama: API_KEY).
                  </p>
                </AlertDescription>
              </Alert>
            ) : null}
            {(secret || webhook.data?.configured) && (
              <div className="space-y-3">
                <CopyField
                  label="Webhook adresi"
                  value={secret?.url ?? (webhook.data?.configured ? webhook.data.url : "")}
                />
                {secret && (
                  <CopyField label="API anahtarı (x-api-key)" value={secret.apiKey} secret />
                )}
                {!secret && webhook.data?.configured && (
                  <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-xs">
                    <span>Kimlik doğrulama: API_KEY</span>
                    <span title={formatDateTime(webhook.data.lastReceivedAt)}>
                      Son bildirim:{" "}
                      {webhook.data.lastReceivedAt
                        ? formatRelative(webhook.data.lastReceivedAt)
                        : "henüz gelmedi"}
                    </span>
                  </div>
                )}
              </div>
            )}
            {!configured && !secret && (
              <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-5 text-center text-sm">
                Henüz webhook tanımlı değil.
              </p>
            )}
            <Button
              variant={configured ? "outline" : "default"}
              size="sm"
              disabled={create.isPending}
              onClick={() => (configured ? setConfirm(true) : generate())}
            >
              {create.isPending ? (
                <Loader2 className="animate-spin" />
              ) : configured ? (
                <RefreshCw />
              ) : (
                <KeyRound />
              )}
              {configured ? "Yeni adres ve anahtar üret" : "Webhook adresi oluştur"}
            </Button>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Yeni webhook anahtarı üretilsin mi?</AlertDialogTitle>
            <AlertDialogDescription>
              Mevcut adres ve anahtar hemen geçersiz olur. Trendyol panelindeki webhook tanımını
              yeni bilgilerle güncellemeniz gerekir; o zamana kadar siparişler yine 5 dakikada bir
              çekilir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={create.isPending}
              onClick={(e) => {
                e.preventDefault();
                generate();
              }}
            >
              {create.isPending && <Loader2 className="animate-spin" />}
              Yeniden üret
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function CopyField({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Kopyalanamadı");
    }
  };
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground text-xs font-medium">{label}</div>
      <div className="flex gap-2">
        <code
          className={
            "bg-muted/50 flex-1 truncate rounded-md border px-3 py-2 font-mono text-xs" +
            (secret ? " border-warning/50" : "")
          }
          title={value}
        >
          {value}
        </code>
        <Button variant="outline" size="icon" onClick={copy} aria-label={`${label} kopyala`}>
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
}
