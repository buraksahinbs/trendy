import Link from "next/link";

import { BrandMark, BrandName } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col overflow-hidden">
      {/* Arka plan: ince ızgara + yumuşak marka ışığı */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:44px_44px] opacity-50 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]"
      />
      <div
        aria-hidden
        className="bg-brand/15 pointer-events-none absolute -top-40 left-1/2 h-80 w-[36rem] -translate-x-1/2 rounded-full blur-3xl"
      />
      <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/giris" className="flex items-center gap-2">
          <BrandMark />
          <BrandName />
        </Link>
        <ThemeToggle />
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 pt-4 pb-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="text-muted-foreground relative z-10 pb-6 text-center text-xs">
        Tedarikçi XML&apos;lerinizi Trendyol mağazanızla senkron tutun.
      </footer>
    </div>
  );
}
