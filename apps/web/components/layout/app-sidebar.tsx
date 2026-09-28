"use client";

import {
  BadgePercent,
  Calculator,
  History,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingCart,
  Truck,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark, BrandName } from "@/components/brand";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTrendyolStatus } from "@/lib/queries";

interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  soon?: boolean;
  badge?: "reviews";
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Genel",
    items: [{ title: "Genel Bakış", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "Katalog",
    items: [
      { title: "Tedarikçiler", href: "/tedarikciler", icon: Truck },
      { title: "Ürünler", href: "/urunler", icon: Package },
      { title: "Fiyat Kuralları", href: "/fiyat-kurallari", icon: Calculator },
      { title: "Fiyat Onayları", href: "/fiyat-onaylari", icon: BadgePercent, badge: "reviews" },
    ],
  },
  {
    label: "Operasyon",
    items: [
      { title: "Siparişler", href: "/siparisler", icon: ShoppingCart },
      { title: "İşlem Geçmişi", href: "/islem-gecmisi", icon: History },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);
  const status = useTrendyolStatus();
  const pendingReviews = status.data?.pendingReviews ?? 0;

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.href}>
      <SidebarMenuButton asChild isActive={isActive(pathname, item.href)} tooltip={item.title}>
        <Link href={item.href} onClick={close}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {item.badge === "reviews" && pendingReviews > 0 && (
        <SidebarMenuBadge className="bg-brand text-brand-foreground rounded-full text-[10px] font-semibold tabular-nums">
          {pendingReviews > 99 ? "99+" : pendingReviews}
        </SidebarMenuBadge>
      )}
      {item.soon && (
        <SidebarMenuBadge className="text-muted-foreground bg-muted border text-[10px] font-normal">
          yakında
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b px-3 group-data-[collapsible=icon]:px-2">
        <Link href="/" onClick={close} className="flex items-center gap-2.5">
          <BrandMark className="size-7 group-data-[collapsible=icon]:size-8" />
          <BrandName className="group-data-[collapsible=icon]:hidden" />
        </Link>
      </SidebarHeader>
      <SidebarContent className="pt-2">
        {NAV.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t">
        <SidebarMenu>
          {renderItem({ title: "Ayarlar", href: "/ayarlar", icon: Settings })}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
