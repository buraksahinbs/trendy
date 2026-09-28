import type { Metadata } from "next";
import { Suspense } from "react";

import { SuppliersView } from "@/components/suppliers/suppliers-view";

export const metadata: Metadata = { title: "Tedarikçiler" };

export default function SuppliersPage() {
  return (
    <Suspense>
      <SuppliersView />
    </Suspense>
  );
}
