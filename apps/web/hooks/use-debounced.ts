import { useEffect, useState } from "react";

/** Değeri `delay` ms sabit kaldıktan sonra döner (arama, canlı önizleme). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
