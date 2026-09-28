"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiError } from "@/lib/api";

const AUTH_PAGES = ["/giris", "/kayit"];

// Oturum düştüğünde (401 unauthenticated) girişe yönlendir; geri dönüş adresi korunur.
function redirectToLogin() {
  const { pathname, search } = window.location;
  if (AUTH_PAGES.includes(pathname)) return;
  const next = encodeURIComponent(pathname + search);
  window.location.assign(`/giris?next=${next}`);
}

function makeClient() {
  const onError = (err: unknown) => {
    if (err instanceof ApiError && err.isUnauthenticated) redirectToLogin();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (count, err) => {
          if (err instanceof ApiError && err.status > 0 && err.status < 500) return false;
          return count < 2;
        },
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster position="top-right" richColors closeButton />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
