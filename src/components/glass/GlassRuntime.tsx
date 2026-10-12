"use client";

import { useEffect } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Feeds the pointer position into `.glass-interactive` as --mx/--my (px, relative to the element)
 * so its ::before specular follows the cursor. One passive document listener, throttled to one
 * write per animation frame, no React state. Detached while reduced motion is requested.
 */
export function GlassRuntime() {
  useEffect(() => {
    const motion = window.matchMedia(REDUCED_MOTION);
    let frame = 0;
    let last: PointerEvent | null = null;

    const flush = () => {
      frame = 0;
      const event = last;
      last = null;
      if (!event || !(event.target instanceof Element)) return;
      const element = event.target.closest<HTMLElement>(".glass-interactive");
      if (!element) return;
      const rect = element.getBoundingClientRect();
      element.style.setProperty("--mx", `${Math.round(event.clientX - rect.left)}px`);
      element.style.setProperty("--my", `${Math.round(event.clientY - rect.top)}px`);
    };

    const onMove = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const attach = () => document.addEventListener("pointermove", onMove, { passive: true });
    const detach = () => {
      document.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      last = null;
    };
    const sync = () => (motion.matches ? detach() : attach());

    sync();
    motion.addEventListener("change", sync);
    return () => {
      motion.removeEventListener("change", sync);
      detach();
    };
  }, []);

  return null;
}
