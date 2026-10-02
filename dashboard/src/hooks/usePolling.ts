import { useEffect, useRef } from "react";

/** Runs `fn` immediately, then every `intervalMs`, until `deps` change or the component unmounts. */
export function usePolling(fn: () => void, intervalMs: number, deps: unknown[]) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    fnRef.current();
    const id = window.setInterval(() => fnRef.current(), intervalMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
