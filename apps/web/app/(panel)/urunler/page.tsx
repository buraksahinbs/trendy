import type { Metadata } from "next";
import { Suspense } from "react";

import { ListingsView } from "@/components/listings/listings-view";

export const metadata: Metadata = { title: "Ürünler" };

export default function ProductsPage() {
  return (
    <Suspense>
      <ListingsView />
    </Suspense>
  );
}
