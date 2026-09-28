"use client";

import { History, Loader2 } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/api";
import { useBackfillOrders } from "@/lib/queries";

const DAY = 24 * 60 * 60 * 1000;
/** `datetime-local` biçimi (yerel saat) */
const toLocal = (d: Date) => {
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
};

export function BackfillDialog({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const backfill = useBackfillOrders();
  const now = new Date();
  const [from, setFrom] = useState(() => toLocal(new Date(Date.now() - DAY)));
  const [to, setTo] = useState(() => toLocal(new Date()));

  const fromDate = new Date(from);
  const toDate = new Date(to);
  let problem: string | null = null;
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()))
    problem = "Tarihleri girin.";
  else if (toDate <= fromDate) problem = "Bitiş başlangıçtan sonra olmalı.";
  else if (toDate.getTime() > now.getTime() + 60_000) problem = "Bitiş tarihi gelecekte olamaz.";
  else if (fromDate.getTime() < now.getTime() - 90 * DAY)
    problem = "Trendyol yalnızca son 3 ayın siparişlerini veriyor.";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) backfill.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <History /> Geçmişi yeniden çek
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Geçmiş siparişleri yeniden çek</DialogTitle>
          <DialogDescription>
            Trendyol bir kesinti duyurduğunda, etkilenen zaman aralığındaki siparişleri yeniden
            tarayın. Normal şartlarda gerekmez; siparişler 5 dakikada bir otomatik çekilir.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="bf-from">Başlangıç</Label>
            <Input
              id="bf-from"
              type="datetime-local"
              value={from}
              min={toLocal(new Date(now.getTime() - 90 * DAY))}
              max={toLocal(now)}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bf-to">Bitiş</Label>
            <Input
              id="bf-to"
              type="datetime-local"
              value={to}
              max={toLocal(now)}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        {(problem || backfill.error) && (
          <Alert variant="destructive">
            <AlertDescription>{problem ?? errorMessage(backfill.error)}</AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Vazgeç
          </Button>
          <Button
            disabled={Boolean(problem) || backfill.isPending}
            onClick={() =>
              backfill.mutate(
                { from: fromDate.toISOString(), to: toDate.toISOString() },
                { onSuccess: () => setOpen(false) },
              )
            }
          >
            {backfill.isPending && <Loader2 className="animate-spin" />}
            Taramayı başlat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
