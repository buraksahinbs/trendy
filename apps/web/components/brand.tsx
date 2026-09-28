import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-brand text-brand-foreground flex size-8 shrink-0 items-center justify-center rounded-lg shadow-sm",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="size-[55%]" fill="none">
        <path
          d="M4 16.5 9.5 11l3.5 3.5L20 7.5"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 7.5h5v5"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function BrandName({ className }: { className?: string }) {
  return <span className={cn("text-base font-semibold tracking-tight", className)}>trendy</span>;
}
