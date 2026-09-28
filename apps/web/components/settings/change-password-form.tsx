"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { PasswordInput } from "@/components/password-input";
import { Button } from "@/components/ui/button";
import {
  Card,
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
import { api, ApiError } from "@/lib/api";
import { applyApiError } from "@/lib/form-errors";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Mevcut şifrenizi girin"),
    newPassword: z
      .string()
      .min(10, "Şifre en az 10 karakter olmalı")
      .max(200, "Şifre en fazla 200 karakter olabilir"),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ["confirm"],
    message: "Şifreler eşleşmiyor",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Yeni şifre mevcut şifreyle aynı olmamalı",
  });
type Values = z.infer<typeof schema>;

export function ChangePasswordForm() {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });

  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }: Values) =>
      api.auth.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      form.reset();
      toast.success("Şifreniz değiştirildi", {
        description: "Diğer cihazlardaki oturumlarınız kapatıldı.",
      });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "invalid_credentials") {
        form.setError("currentPassword", { type: "server", message: err.message });
        return;
      }
      applyApiError(err, form.setError, ["currentPassword", "newPassword"]);
    },
  });

  return (
    <Card className="max-w-xl gap-5">
      <CardHeader>
        <CardTitle>Şifre değiştir</CardTitle>
        <CardDescription>
          Şifreniz değiştiğinde bu cihaz dışındaki tüm oturumlarınız kapatılır.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((v) => change.mutate(v))}
          noValidate
          className="grid gap-5"
        >
          <CardContent className="grid gap-4">
            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Mevcut şifre</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Yeni şifre</FormLabel>
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
                  <FormLabel>Yeni şifre (tekrar)</FormLabel>
                  <FormControl>
                    <PasswordInput autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="justify-end border-t">
            <Button type="submit" size="sm" disabled={change.isPending}>
              {change.isPending && <Loader2 className="animate-spin" />}
              Şifreyi değiştir
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
