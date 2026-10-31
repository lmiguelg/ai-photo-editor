"use client";

import Image from "next/image";
import { useState } from "react";

interface BeforeAfterSliderProps {
  originalSrc: string;
  editedSrc: string;
  name: string;
  /** Intrinsic pixel size of both images; when given, both layers render with next/image. */
  width?: number;
  height?: number;
}

const IMAGE_SIZES = "(min-width: 1024px) 480px, (min-width: 768px) 50vw, 100vw";

/**
 * Stacks the edited image over the original and clips it at the range value: the
 * original shows left of the divider, the edited image right of it.
 */
export function BeforeAfterSlider({ originalSrc, editedSrc, name, width, height }: BeforeAfterSliderProps) {
  const [position, setPosition] = useState(50);
  const clip = { clipPath: `inset(0 0 0 ${position}%)` };
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-md bg-neutral-200">
        {width && height ? (
          <>
            <Image
              src={originalSrc}
              alt={`Original photo ${name}`}
              width={width}
              height={height}
              sizes={IMAGE_SIZES}
              className="block h-auto w-full"
            />
            <Image
              src={editedSrc}
              alt={`Edited photo ${name}`}
              fill
              sizes={IMAGE_SIZES}
              className="object-cover"
              style={clip}
            />
          </>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- served by our own image route */}
            <img src={originalSrc} alt={`Original photo ${name}`} className="block h-auto w-full" />
            {/* eslint-disable-next-line @next/next/no-img-element -- served by our own image route */}
            <img
              src={editedSrc}
              alt={`Edited photo ${name}`}
              className="absolute inset-0 h-full w-full object-cover"
              style={clip}
            />
          </>
        )}
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
