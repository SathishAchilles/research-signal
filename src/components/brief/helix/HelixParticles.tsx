"use client";

import { useEffect, useRef, useState } from "react";

// Progressive enhancement over the static SVG helix. Never mounts under reduced motion,
// reduced transparency or the "Solid panels" toggle; the SVG frame is then the final render.
type Geometry = { cx: number; amp: number; period: number; y0: number; y1: number; w: number };

const QUERIES = ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)"];
const COUNT = 160;
const RADIUS = 1.5;
const FRAME_MS = 33;
const BUCKETS = 4;

const allowed = () =>
  document.documentElement.dataset.glass !== "off" && !QUERIES.some((q) => matchMedia(q).matches);

export function HelixParticles(props: Geometry) {
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
  return on ? <ParticleCanvas {...props} /> : null;
}

function ParticleCanvas({ cx, amp, period, y0, y1, w }: Geometry) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;

    const cs = getComputedStyle(c);
    const colors = [cs.getPropertyValue("--signal").trim() || "#3FE0D0", cs.getPropertyValue("--signal-2").trim() || "#3FB8BD"];
    const span = y1 - y0;
    const speed = 0.05 * period; // a twentieth of a period per second, upward (LAB -> PEER)
    const half = COUNT / 2;
    // Even i on strand A, odd i on strand B (phase + pi), offset by half a slot.
    const ys = Float32Array.from({ length: COUNT }, (_, i) => y0 + (((i >> 1) + (i & 1) * 0.5) * span) / half);
    const xs = new Float32Array(COUNT);
    const bucket = new Uint8Array(COUNT); // alpha bucket, +BUCKETS when the particle is in front
    let scale = 1;

    const step = (dt: number) => {
      for (let i = 0; i < COUNT; i++) {
        let y = ys[i] - speed * dt;
        if (y < y0) y += span;
        ys[i] = y;
        const phi = (2 * Math.PI * y) / period + (i & 1) * Math.PI;
        const cos = Math.cos(phi);
        xs[i] = cx + amp * Math.sin(phi);
        bucket[i] = Math.min(BUCKETS - 1, Math.floor(((1 + cos) / 2) * BUCKETS)) + (cos > 0 ? BUCKETS : 0);
      }
    };

    // Batched by strand x depth bucket: at most 16 fills a frame; shadow only on the front pass.
    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      for (let front = 0; front < 2; front++) {
        ctx.shadowBlur = front ? 6 : 0;
        for (let s = 0; s < 2; s++) {
          ctx.fillStyle = colors[s];
          ctx.shadowColor = colors[s];
          for (let b = 0; b < BUCKETS; b++) {
            const key = b + front * BUCKETS;
            ctx.beginPath();
            let any = false;
            for (let i = s; i < COUNT; i += 2) {
              if (bucket[i] !== key) continue;
              ctx.moveTo(xs[i] + RADIUS, ys[i]);
              ctx.arc(xs[i], ys[i], RADIUS, 0, 2 * Math.PI);
              any = true;
            }
            if (!any) continue;
            ctx.globalAlpha = 0.35 + 0.65 * ((b + 0.5) / BUCKETS);
            ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
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
      c.width = Math.max(1, Math.round(c.clientWidth * dpr));
      c.height = Math.max(1, Math.round(c.clientHeight * dpr));
      scale = c.width / w;
      step(0);
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
  }, [cx, amp, period, y0, y1, w]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ opacity: 0, transition: "opacity 600ms" }}
    />
  );
}
