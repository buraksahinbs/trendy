import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SupplierDetail } from "@/components/suppliers/supplier-detail";

export const metadata: Metadata = { title: "Tedarikçi" };

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const num = Number(id);
  if (!Number.isInteger(num) || num <= 0) notFound();
  return (
    <Suspense>
      <SupplierDetail id={num} />
    </Suspense>
  );
}
