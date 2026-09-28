import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { toast } from "sonner";

import { ApiError, errorMessage } from "@/lib/api";

/**
 * API hatasını forma yansıtır: `issues` alan bazında gösterilir, eşleşmeyen
 * hatalar toast olarak çıkar. `fieldMap` API yolunu form alanına çevirir.
 */
export function applyApiError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  fieldMap: Record<string, Path<T>> = {},
) {
  if (err instanceof ApiError && err.issues.length > 0) {
    let unmatched = false;
    for (const issue of err.issues) {
      const target = fieldMap[issue.path] ?? (issue.path as Path<T>);
      if (fields.includes(target)) {
        setError(target, { type: "server", message: issue.message });
      } else {
        unmatched = true;
      }
    }
    if (unmatched) toast.error(err.message);
    return;
  }
  toast.error(errorMessage(err));
}
