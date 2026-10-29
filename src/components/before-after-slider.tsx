"use client";

import { useState } from "react";

interface BeforeAfterSliderProps {
  originalSrc: string;
  editedSrc: string;
  name: string;
}

/**
 * Stacks the edited image over the original and clips it at the range value: the
 * original shows left of the divider, the edited image right of it.
 */
export function BeforeAfterSlider({ originalSrc, editedSrc, name }: BeforeAfterSliderProps) {
  const [position, setPosition] = useState(50);
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md bg-neutral-200">
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our own image route */}
        <img src={originalSrc} alt={`Original photo ${name}`} className="block h-auto w-full" />
        {/* eslint-disable-next-line @next/next/no-img-element -- served by our own image route */}
        <img
          src={editedSrc}
          alt={`Edited photo ${name}`}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ clipPath: `inset(0 0 0 ${position}%)` }}
        />
        <div aria-hidden="true" className="absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${position}%` }} />
        <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">Before</span>
        <span className="absolute right-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">After</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        aria-label={`Before/after comparison for ${name}`}
        className="w-full cursor-ew-resize rounded accent-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      />
    </div>
  );
}
