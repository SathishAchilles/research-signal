"use client";

import { useEffect, useRef, useState } from "react";

// Optional ambient glow behind the brief's figure stage: a shapeless field of slow-drifting
// cyan motes (no strands, no DNA geometry). Decorative only; the figure stage is complete
// without it. It fills its positioned parent (absolute inset-0).
//
// Placement rules:
// - Never put this canvas under (or inside) an element with backdrop-filter. Animating pixels
//   behind glass forces a re-blur of that layer on every frame.
// - Never place it over figure images; it sits behind the stage frames.
//
// It never mounts under reduced motion, reduced transparency, more contrast, forced colors or
// the "Solid panels" toggle (data-glass="off").

const QUERIES = [
  "(prefers-reduced-motion: reduce)",
  "(prefers-reduced-transparency: reduce)",
  "(prefers-contrast: more)",
  "(forced-colors: active)",
];
const COUNT = 90;
const RADIUS = 1.5;
const FRAME_MS = 33; // 30fps cap
const BUCKETS = 4;
const SPEED = 12; // CSS px per second, upward

const allowed = () =>
  document.documentElement.dataset.glass !== "off" && !QUERIES.some((q) => matchMedia(q).matches);

export function HelixParticles({ className = "" }: { className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(allowed());
    const idle = typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(sync) : 0;
    const timer = idle ? 0 : window.setTimeout(sync, 200);
    const mqs = QUERIES.map((q) => matchMedia(q));
    mqs.forEach((m) => m.addEventListener("change", sync));
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-glass"] });
    return () => {
      if (idle) window.cancelIdleCallback(idle);
      window.clearTimeout(timer);
      mqs.forEach((m) => m.removeEventListener("change", sync));
      mo.disconnect();
    };
  }, []);
  return on ? <AmbientCanvas className={className} /> : null;
}

// Deterministic PRNG so the field looks the same on every mount (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function AmbientCanvas({ className }: { className: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;

    const cs = getComputedStyle(c);
    const colors = [cs.getPropertyValue("--signal").trim() || "#3FE0D0", cs.getPropertyValue("--signal-2").trim() || "#3FB8BD"];

    // Positions are normalised (0..1) so a resize keeps the field; depth drives speed and alpha.
    const rand = rng(0x5eed);
    const nx = Float32Array.from({ length: COUNT }, () => rand());
    const ny = Float32Array.from({ length: COUNT }, () => rand());
    const depth = Float32Array.from({ length: COUNT }, () => rand());
    const sway = Float32Array.from({ length: COUNT }, () => rand() * 2 * Math.PI);
    const bucket = Uint8Array.from(depth, (d) => Math.min(BUCKETS - 1, Math.floor(d * BUCKETS)));
    let w = 1;
    let h = 1;
    let scale = 1;
    let clock = 0;

    const step = (dt: number) => {
      clock += dt;
      for (let i = 0; i < COUNT; i++) {
        let y = ny[i] - ((0.4 + 0.6 * depth[i]) * SPEED * dt) / h;
        if (y < 0) y += 1;
        ny[i] = y;
      }
    };

    // Batched by colour x depth bucket: at most 8 fills a frame; shadow only on the front bucket.
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (let b = 0; b < BUCKETS; b++) {
        const front = b === BUCKETS - 1;
        ctx.shadowBlur = front ? 6 : 0;
        ctx.globalAlpha = 0.2 + 0.6 * ((b + 0.5) / BUCKETS);
        for (let s = 0; s < 2; s++) {
          ctx.fillStyle = colors[s];
          ctx.shadowColor = colors[s];
          ctx.beginPath();
          let any = false;
          for (let i = s; i < COUNT; i += 2) {
            if (bucket[i] !== b) continue;
            const x = nx[i] * w + 6 * Math.sin(clock * 0.3 + sway[i]);
            const y = ny[i] * h;
            const r = RADIUS * (0.6 + 0.6 * depth[i]);
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, 2 * Math.PI);
            any = true;
          }
          if (any) ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    };

    let raf = 0;
    let last = 0;
    let inView = false;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (last && t - last < FRAME_MS) return;
      step(last ? Math.min((t - last) / 1000, 0.1) : 0);
      last = t;
      draw();
    };
    const update = () => {
      if (!document.hidden && inView) {
        if (!raf) {
          last = 0;
          raf = requestAnimationFrame(tick);
        }
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const ro = new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      w = Math.max(1, c.clientWidth);
      h = Math.max(1, c.clientHeight);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      scale = dpr;
      draw();
    });
    ro.observe(c);
    const io = new IntersectionObserver(
      ([e]) => {
        inView = e.isIntersecting;
        update();
      },
      { threshold: 0 },
    );
    io.observe(c);
    document.addEventListener("visibilitychange", update);

    // 600ms opacity fade; will-change only while it runs.
    const endFade = () => {
      c.style.willChange = "";
    };
    c.addEventListener("transitionend", endFade, { once: true });
    c.style.willChange = "opacity";
    const fade = requestAnimationFrame(() => {
      c.style.opacity = "1";
    });

    return () => {
      cancelAnimationFrame(fade);
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
      c.removeEventListener("transitionend", endFade);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      style={{ opacity: 0, transition: "opacity 600ms" }}
    />
  );
}
