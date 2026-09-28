"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";
import { keys } from "@/lib/queries";

const schema = z.object({
  email: z.email("Geçerli bir e-posta girin"),
  password: z.string().min(1, "Şifrenizi girin"),
});
type Values = z.infer<typeof schema>;

/** Yalnızca uygulama içi yollara dönülür (açık yönlendirme engeli). */
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const login = useMutation({
    mutationFn: api.auth.login,
    onSuccess: async () => {
      await qc.resetQueries({ queryKey: keys.me });
      router.replace(safeNext(params.get("next")));
    },
    onError: (err) => applyApiError(err, form.setError, ["email", "password"]),
  });

  return (
    <AuthCard
      title="Tekrar hoş geldiniz"
      description="Mağaza panelinize giriş yapın"
      footer={
        <>
          Hesabınız yok mu?{" "}
          <Link
            href="/kayit"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Ücretsiz hesap oluşturun
          </Link>
        </>
      }
    >
      <Form {...form}>
        <form
          // Sayfa hazır olmadan gönderilirse şifre adres çubuğuna (GET) düşmesin.
          method="post"
          onSubmit={form.handleSubmit((v) => login.mutate(v))}
          className="grid gap-4"
          noValidate
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-posta</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="ornek@magaza.com"
                    autoFocus
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Şifre</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="mt-1 w-full" disabled={login.isPending}>
            {login.isPending && <Loader2 className="animate-spin" />}
            Giriş yap
          </Button>
        </form>
      </Form>
    </AuthCard>
  );
}
