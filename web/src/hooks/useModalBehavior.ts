import { useEffect, useRef } from "react";

/**
 * Standard overlay behavior: Escape closes, and the page behind the overlay
 * stops scrolling while it is open. Pass `open: false` to suspend (e.g. while
 * a confirm action is in flight and closing must go through the Cancel path).
 */
export function useModalBehavior(open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);
}
