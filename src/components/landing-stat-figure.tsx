"use client";

import { useEffect, useRef, useState } from "react";

const DURATION_MS = 1200;

/**
 * A stat figure that counts up from zero the first time it scrolls into view, when the
 * visitor allows motion. The real figure stays in the DOM text throughout (only made
 * transparent while an aria-hidden copy counts), so screen readers and no-JS visitors
 * always get the exact sourced value.
 */
export function LandingStatFigure({ figure, className }: { figure: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState<string | null>(null);

  useEffect(() => {
    const match = /^(\d+(?:\.(\d+))?)(.*)$/.exec(figure);
    const element = ref.current;
    if (!match || !element || !window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const target = Number(match[1]);
    const decimals = match[2]?.length ?? 0;
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / DURATION_MS);
          const eased = 1 - (1 - progress) ** 3;
          if (progress < 1) {
            setDisplay(`${(target * eased).toFixed(decimals)}${match[3]}`);
            frame = requestAnimationFrame(tick);
          } else {
            setDisplay(null);
          }
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [figure]);

  return (
    <span ref={ref} className="relative inline-block">
      <span className={display === null ? className : `${className} opacity-0`}>{figure}</span>
      {display === null ? null : (
        <span aria-hidden="true" className={`absolute inset-y-0 left-0 whitespace-nowrap ${className}`}>
          {display}
        </span>
      )}
    </span>
  );
}
