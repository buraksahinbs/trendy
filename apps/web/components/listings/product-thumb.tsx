"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Tedarikçi görseli. Adresler her tedarikçide farklı alan adında olduğu için next/image
 * (izinli alan adı listesi ister) yerine düz <img> kullanılır. Panel adresi tedarikçiye
 * sızmasın diye referrer gönderilmez; yüklenemezse yer tutucu gösterilir.
 */
export function ProductThumb({
  src,
  alt,
  className,
  iconClassName,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const show = Boolean(src) && !failed;
  return (
    <div
      className={cn(
        "bg-muted text-muted-foreground relative flex shrink-0 items-center justify-center overflow-hidden",
        className,
      )}
    >
      {show ? (
        // eslint-disable-next-line @next/next/no-img-element -- bkz. bileşen açıklaması
        <img
          src={src!}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <ImageOff className={cn("size-4 opacity-50", iconClassName)} aria-hidden />
      )}
    </div>
  );
}
