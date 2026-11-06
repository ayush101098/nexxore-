'use client';

import { useEffect, useRef } from 'react';

/**
 * The signature Loop motion: a light pulse travels Sense → Decide → Act and
 * arcs back, pausing at each stage while that stage's card lifts and its border
 * brightens to the current regime accent.
 *
 * Zero animation libraries (hand-rolled rAF) → well under the 15KB budget.
 * - Runs only while scrolled into view (IntersectionObserver) AND the tab is
 *   visible (document.visibilityState).
 * - Animates transform/opacity only (GPU-cheap).
 * - prefers-reduced-motion: no positional motion — stages highlight in
 *   sequence via opacity/border only, pulse hidden.
 */
const TRAVEL_MS = 700; // one leg
const PAUSE_MS = 400; // dwell at a stage
const easeInstrument = (t: number) => 1 - Math.pow(1 - t, 3);

export function LoopAnimator() {
  const pulseRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const pulse = pulseRef.current;
    const root = pulse?.closest('[data-loop-root]') as HTMLElement | null;
    if (!pulse || !root) return;

    const stages = Array.from(root.querySelectorAll<HTMLElement>('[data-loop-stage]'));
    if (stages.length === 0) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const centers = () =>
      stages.map((el) => {
        const r = el.getBoundingClientRect();
        const rootR = root.getBoundingClientRect();
        return { x: r.left - rootR.left + r.width / 2, y: r.top - rootR.top + r.height / 2 };
      });

    let pts = centers();
    const onResize = () => {
      pts = centers();
    };
    window.addEventListener('resize', onResize);

    const setActive = (idx: number) => {
      stages.forEach((el, i) => el.classList.toggle('is-active', i === idx));
    };

    // ── Reduced motion: sequence the highlight only, no movement ──
    if (reduced) {
      pulse.style.display = 'none';
      let idx = 0;
      setActive(0);
      const id = window.setInterval(() => {
        idx = (idx + 1) % stages.length;
        setActive(idx);
      }, TRAVEL_MS + PAUSE_MS);
      return () => {
        window.clearInterval(id);
        window.removeEventListener('resize', onResize);
      };
    }

    // ── Full motion ──
    let raf = 0;
    let running = false;
    let leg = 0; // travelling from stage `leg` to `leg+1` (wraps)
    let phase: 'travel' | 'pause' = 'travel';
    let phaseStart = 0;

    const place = (x: number, y: number) => {
      pulse.style.transform = `translate(${x}px, ${y}px)`;
    };

    const frame = (now: number) => {
      if (!running) return;
      const n = pts.length;
      const from = pts[leg % n]!;
      const to = pts[(leg + 1) % n]!;
      if (phase === 'travel') {
        const t = Math.min(1, (now - phaseStart) / TRAVEL_MS);
        const e = easeInstrument(t);
        place(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
        pulse.style.opacity = '1';
        if (t >= 1) {
          phase = 'pause';
          phaseStart = now;
          setActive((leg + 1) % n);
        }
      } else {
        place(to.x, to.y);
        if (now - phaseStart >= PAUSE_MS) {
          phase = 'travel';
          phaseStart = now;
          leg = (leg + 1) % n;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      if (running) return;
      running = true;
      phaseStart = performance.now();
      const first = pts[0]!;
      place(first.x, first.y);
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && document.visibilityState === 'visible') start();
        else stop();
      },
      { threshold: 0.35 },
    );
    io.observe(root);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stop();
      else if (io) {
        // resume if still in view
        const r = root.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      io.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <span ref={pulseRef} className="nx-loop__pulse" aria-hidden="true" />;
}
