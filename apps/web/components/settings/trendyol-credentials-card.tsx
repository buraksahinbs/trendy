"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  CheckCircle2,
  CircleDashed,
  Info,
  Loader2,
  Lock,
  PlugZap,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { OWNER_ONLY_HINT } from "@/components/owner-only";
import { PasswordInput } from "@/components/password-input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { TrendyolCredentialSummary, TrendyolEnv, VerifyResult } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useRole, useSaveCredentials, useVerifyCredentials } from "@/lib/queries";

const schema = z.object({
  sellerId: z
    .string()
    .trim()
    .min(1, "Satıcı ID'yi girin")
    .max(20, "En fazla 20 hane")
    .regex(/^\d+$/, "Satıcı ID yalnızca rakamlardan oluşmalı"),
  apiKey: z.string().trim().min(1, "API Key'i girin").max(200),
  apiSecret: z.string().trim().min(1, "API Secret'ı girin").max(200),
});
type Values = z.infer<typeof schema>;

const META: Record<TrendyolEnv, { title: string; description: string }> = {
  prod: {
    title: "Canlı ortam (prod)",
    description: "Mağazanızın gerçek ürün, stok ve siparişleri bu bilgilerle yönetilir.",
  },
  stage: {
    title: "Test ortamı (stage)",
    description: "Canlıya çıkmadan önce denemeler için Trendyol'un test ortamı.",
  },
};

export function TrendyolCredentialsCard({
  env,
  current,
  activeForSync,
}: {
  env: TrendyolEnv;
  current: TrendyolCredentialSummary | undefined;
  activeForSync: boolean;
}) {
  const { isOwner } = useRole();
  const save = useSaveCredentials(env);
  const verify = useVerifyCredentials(env);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { sellerId: current?.sellerId ?? "", apiKey: "", apiSecret: "" },
  });

  const onSubmit = (v: Values) =>
    save.mutate(v, {
      onSuccess: () => {
        setResult(null);
        form.reset({ sellerId: v.sellerId, apiKey: "", apiSecret: "" });
      },
      onError: (err) => applyApiError(err, form.setError, ["sellerId", "apiKey", "apiSecret"]),
    });

  const meta = META[env];

  return (
    <Card className="gap-5">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {meta.title}
          {activeForSync && (
            <Badge variant="outline" className="font-normal">
              Senkronda kullanılıyor
            </Badge>
          )}
        </CardTitle>
        <CardDescription>{meta.description}</CardDescription>
        <CardAction>
          {!current ? (
            <Badge variant="muted">Tanımlı değil</Badge>
          ) : current.verifiedAt ? (
            <Badge variant="success">
              <CheckCircle2 /> Doğrulandı
            </Badge>
          ) : (
            <Badge variant="warning">
              <CircleDashed /> Doğrulanmadı
            </Badge>
          )}
        </CardAction>
      </CardHeader>
      <Form {...form}>
        <form
          // Sayfa hazır olmadan gönderilirse şifre adres çubuğuna (GET) düşmesin.
          method="post"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
          className="flex flex-1 flex-col gap-5"
        >
          <CardContent className="flex-1 space-y-4">
            {current && (
              <dl className="bg-muted/40 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border px-3 py-2.5 text-xs">
                <dt className="text-muted-foreground">Satıcı ID</dt>
                <dd className="font-mono">{current.sellerId}</dd>
                <dt className="text-muted-foreground">API Key</dt>
                <dd className="font-mono">{current.apiKeyHint}</dd>
                <dt className="text-muted-foreground">Güncelleme</dt>
                <dd>{formatDateTime(current.updatedAt)}</dd>
                {current.verifiedAt && (
                  <>
                    <dt className="text-muted-foreground">Doğrulama</dt>
                    <dd>{formatDateTime(current.verifiedAt)}</dd>
                  </>
                )}
              </dl>
            )}
            {current && (
              <div className="flex flex-col gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={!isOwner || verify.isPending}
                  onClick={() => verify.mutate(undefined, { onSuccess: (r) => setResult(r) })}
                >
                  {verify.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
                  Bağlantıyı test et
                </Button>
                {result && <VerifyResultAlert result={result} />}
              </div>
            )}
            {env === "stage" && (
              <Alert>
                <Info />
                <AlertDescription>
                  Stage ortamı yalnızca Trendyol&apos;a bildirilen sabit IP adreslerinden gelen
                  isteklere açıktır. Kullanmadan önce IP yetkilendirmesi için Trendyol&apos;a
                  başvurmanız gerekir.
                </AlertDescription>
              </Alert>
            )}
            <fieldset disabled={!isOwner || save.isPending} className="space-y-4">
              <FormField
                control={form.control}
                name="sellerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Satıcı ID (Cari ID)</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        placeholder="123456"
                        className="font-mono"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="apiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete="off"
                        placeholder={current ? `Kayıtlı (${current.apiKeyHint})` : ""}
                        className="font-mono"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="apiSecret"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Secret</FormLabel>
                    <FormControl>
                      <PasswordInput
                        autoComplete="off"
                        placeholder={current ? "Kayıtlı (gizli)" : ""}
                        className="font-mono"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Trendyol Satıcı Paneli → Hesap Bilgilerim → Entegrasyon Bilgileri.
                      {current && " Güncellemek için Key ve Secret'ı birlikte yeniden girin."}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </fieldset>
          </CardContent>
          <CardFooter className="justify-between gap-3 border-t">
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Lock className="size-3" />
              {isOwner ? "Bilgiler şifrelenerek saklanır, bir daha gösterilmez." : OWNER_ONLY_HINT}
            </p>
            <Button type="submit" size="sm" disabled={!isOwner || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {current ? "Güncelle" : "Kaydet"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

function VerifyResultAlert({ result }: { result: VerifyResult }) {
  if (result.verified)
    return (
      <Alert variant="success">
        <CheckCircle2 />
        <AlertTitle>Bağlantı başarılı</AlertTitle>
        <AlertDescription>
          {result.approvedContentCount !== null
            ? `Trendyol'da ${formatNumber(result.approvedContentCount)} onaylı ürün bulundu. Ürünleriniz içe aktarılıyor.`
            : "Ürünleriniz içe aktarılıyor."}
        </AlertDescription>
      </Alert>
    );
  const title = {
    invalid_credentials: "Bilgiler hatalı",
    forbidden: "Yetki reddedildi",
    stage_ip_not_allowed: "IP adresi yetkili değil",
    unavailable: "Trendyol'a ulaşılamadı",
  }[result.reason];
  return (
    <Alert variant={result.reason === "unavailable" ? "warning" : "destructive"}>
      {result.reason === "stage_ip_not_allowed" ? <ShieldAlert /> : <XCircle />}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  );
}
