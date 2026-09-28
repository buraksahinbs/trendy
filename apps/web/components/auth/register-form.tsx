"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { AuthCard } from "@/components/auth/auth-card";
import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
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
import { api, ApiError } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";
import { keys } from "@/lib/queries";

const schema = z
  .object({
    tenantName: z.string().trim().min(1, "Mağaza adını girin").max(100, "En fazla 100 karakter"),
    email: z.email("Geçerli bir e-posta girin").max(254),
    password: z
      .string()
      .min(10, "Şifre en az 10 karakter olmalı")
      .max(200, "Şifre en fazla 200 karakter olabilir"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Şifreler eşleşmiyor",
  });
type Values = z.infer<typeof schema>;

export function RegisterForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { tenantName: "", email: "", password: "", confirm: "" },
  });

  const register = useMutation({
    mutationFn: ({ tenantName, email, password }: Values) =>
      api.auth.register({ tenantName, email, password }),
    onSuccess: async () => {
      await qc.resetQueries({ queryKey: keys.me });
      router.replace("/");
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "email_taken") {
        form.setError("email", { type: "server", message: err.message });
        return;
      }
      applyApiError(err, form.setError, ["tenantName", "email", "password"]);
    },
  });

  return (
    <AuthCard
      title="Hesap oluşturun"
      description="Birkaç dakikada mağazanızı bağlamaya başlayın"
      footer={
        <>
          Zaten hesabınız var mı?{" "}
          <Link
            href="/giris"
            className="text-foreground font-medium underline-offset-4 hover:underline"
          >
            Giriş yapın
          </Link>
        </>
      }
    >
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => register.mutate(v))}
          className="grid gap-4"
          noValidate
        >
          <FormField
            control={form.control}
            name="tenantName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mağaza adı</FormLabel>
                <FormControl>
                  <Input placeholder="Örn. Deniz Ev Tekstili" autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormDescription>En az 10 karakter.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Şifre (tekrar)</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" className="mt-1 w-full" disabled={register.isPending}>
            {register.isPending && <Loader2 className="animate-spin" />}
            Hesap oluştur
          </Button>
        </form>
      </Form>
    </AuthCard>
  );
}
