"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  BadgePercent,
  Calculator,
  CornerDownLeft,
  History,
  LayoutDashboard,
  Loader2,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { ProductThumb } from "@/components/listings/product-thumb";
import { OrderStatusBadge } from "@/components/orders/order-status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useDebounced } from "@/hooks/use-debounced";
import { api } from "@/lib/api";
import { formatMoney, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Item {
  key: string;
  group: "Sayfalar" | "Ürünler" | "Siparişler";
  label: string;
  sub?: string;
  href: string;
  icon?: LucideIcon;
  image?: string | null;
  trailing?: React.ReactNode;
}

const PAGES: Omit<Item, "key" | "group">[] = [
  { label: "Genel Bakış", href: "/", icon: LayoutDashboard },
  { label: "Tedarikçiler", href: "/tedarikciler", icon: Truck },
  { label: "Tedarikçi ekle", href: "/tedarikciler?ekle=1", icon: Truck },
  { label: "Ürünler", href: "/urunler", icon: Package },
  { label: "Hatalı ürünler", href: "/urunler?hata=1", icon: Package },
  { label: "Fiyat Kuralları", href: "/fiyat-kurallari", icon: Calculator },
  { label: "Fiyat Onayları", href: "/fiyat-onaylari", icon: BadgePercent },
  { label: "Siparişler", href: "/siparisler", icon: ShoppingCart },
  { label: "İşlem Geçmişi", href: "/islem-gecmisi", icon: History },
  { label: "Ayarlar", href: "/ayarlar", icon: Settings },
  { label: "Trendyol bağlantısı", href: "/ayarlar?sekme=trendyol", icon: Settings },
];

const norm = (s: string) => s.toLocaleLowerCase("tr").normalize("NFC");

/** ⌘K / Ctrl+K: her sayfadan barkod, ürün adı, model kodu veya sipariş numarasıyla arama. */
export function CommandSearch() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground h-8 gap-2 px-2.5 font-normal sm:w-56 sm:justify-start"
        aria-label="Ara"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Barkod, ürün, sipariş…</span>
        <kbd className="bg-muted ml-auto hidden rounded border px-1.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        >
          <DialogTitle className="sr-only">Ara</DialogTitle>
          <DialogDescription className="sr-only">
            Barkod, ürün adı, model kodu veya sipariş numarasıyla arayın.
          </DialogDescription>
          {open && <SearchBody onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SearchBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const term = useDebounced(query.trim(), 250);
  const remote = term.length >= 2;

  const results = useQuery({
    queryKey: ["command-search", term],
    enabled: remote,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const [listings, orders] = await Promise.all([
        api.trendyol.listings({ search: term, limit: 6, offset: 0 }),
        api.orders.list({ search: term, limit: 5, offset: 0 }),
      ]);
      return { listings: listings.items, orders: orders.items };
    },
  });

  const items = useMemo<Item[]>(() => {
    const q = norm(query.trim());
    const pages = PAGES.filter((p) => !q || norm(p.label).includes(q)).map((p) => ({
      ...p,
      key: `page:${p.href}`,
      group: "Sayfalar" as const,
    }));
    if (!remote || !results.data) return pages;
    const products: Item[] = results.data.listings.map((l) => ({
      key: `listing:${l.variantId}`,
      group: "Ürünler",
      label: l.title ?? l.barcode,
      sub: [Object.values(l.attributes ?? {}).join(" · "), l.barcode].filter(Boolean).join(" — "),
      href: `/urunler?ara=${encodeURIComponent(l.barcode)}`,
      image: l.imageUrl,
      trailing: (
        <span className="text-muted-foreground text-xs tabular-nums">
          {l.stock} adet{l.tyPrice !== null && ` · ${formatMoney(l.tyPrice)}`}
        </span>
      ),
    }));
    const orders: Item[] = results.data.orders.map((o) => ({
      key: `order:${o.id}`,
      group: "Siparişler",
      label: `#${o.orderNumber}`,
      sub: [o.customerName, o.firstProductName, formatRelative(o.orderDate)]
        .filter(Boolean)
        .join(" · "),
      href: `/siparisler?siparis=${o.id}`,
      icon: ShoppingCart,
      trailing: <OrderStatusBadge status={o.status} />,
    }));
    // Arama yapılırken sayfalar en sona
    return [...products, ...orders, ...pages.slice(0, 3)];
  }, [query, remote, results.data]);

  // Liste değişince seçim başa döner
  const [prevItems, setPrevItems] = useState(items);
  if (prevItems !== items) {
    setPrevItems(items);
    setActive(0);
  }

  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    router.push(item.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next =
        e.key === "ArrowDown" ? Math.min(items.length - 1, active + 1) : Math.max(0, active - 1);
      setActive(next);
      listRef.current
        ?.querySelector<HTMLElement>(`[data-index="${next}"]`)
        ?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    }
  };

  let lastGroup = "";
  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-2 border-b px-3">
        <Search className="text-muted-foreground size-4 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Barkod, ürün adı, model kodu veya sipariş no…"
          className="placeholder:text-muted-foreground h-12 flex-1 bg-transparent text-sm outline-none"
          aria-label="Arama"
          role="combobox"
          aria-expanded
          aria-controls="command-search-list"
          aria-activedescendant={items[active] ? `cmd-${items[active].key}` : undefined}
        />
        {results.isFetching && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
      </div>
      <ul
        id="command-search-list"
        ref={listRef}
        role="listbox"
        className="max-h-[60vh] overflow-y-auto p-2"
      >
        {items.length === 0 ? (
          <li className="text-muted-foreground px-3 py-8 text-center text-sm">
            {remote && results.isFetching ? "Aranıyor…" : "Sonuç yok"}
          </li>
        ) : (
          items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <li key={item.key} role="presentation">
                {header && (
                  <div className="text-muted-foreground px-2 pt-2 pb-1 text-[11px] font-medium">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  id={`cmd-${item.key}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => go(item)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm",
                    i === active && "bg-accent",
                  )}
                >
                  {item.group === "Ürünler" ? (
                    <ProductThumb
                      src={item.image}
                      alt=""
                      className="h-9 w-6 rounded"
                      iconClassName="size-3"
                    />
                  ) : (
                    Icon && <Icon className="text-muted-foreground size-4 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.label}</span>
                    {item.sub && (
                      <span className="text-muted-foreground block truncate text-xs">
                        {item.sub}
                      </span>
                    )}
                  </span>
                  {item.trailing}
                  {i === active && (
                    <CornerDownLeft className="text-muted-foreground size-3.5 shrink-0" />
                  )}
                </button>
              </li>
            );
          })
        )}
      </ul>
      <div className="text-muted-foreground flex items-center gap-3 border-t px-3 py-2 text-[11px]">
        <span>
          <kbd className="font-mono">↑↓</kbd> gezin
        </span>
        <span>
          <kbd className="font-mono">↵</kbd> aç
        </span>
        <span>
          <kbd className="font-mono">esc</kbd> kapat
        </span>
        {!remote && <span className="ml-auto">Ürün ve sipariş için en az 2 karakter</span>}
      </div>
    </div>
  );
}
