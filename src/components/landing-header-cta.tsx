"use client";

import { useEffect, useState } from "react";

/**
 * Header link to #contact that appears once the element with `heroCtaId` has scrolled
 * up out of view. While hidden it is `invisible`, so it is also out of the tab order.
 */
export function LandingHeaderCta({ heroCtaId, label, className }: { heroCtaId: string; label: string; className: string }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const heroCta = document.getElementById(heroCtaId);
    if (!heroCta) return;
    const observer = new IntersectionObserver(([entry]) => {
      setShown(!entry.isIntersecting && entry.boundingClientRect.top < 0);
    });
    observer.observe(heroCta);
    return () => observer.disconnect();
  }, [heroCtaId]);

  return (
    <a
      href="#contact"
      className={`${className} motion-safe:transition-all motion-safe:duration-300 ${shown ? "visible opacity-100" : "invisible translate-y-1 opacity-0"}`}
    >
      {label}
    </a>
  );
}
