"use client";

import Image from "next/image";
import { useState, type ChangeEvent } from "react";

interface BeforeAfterSliderProps {
  originalSrc: string;
  editedSrc: string;
  name: string;
  /** Intrinsic pixel size of both images; when given, both layers render with next/image. */
  width?: number;
  height?: number;
  /** Preload both images (next/image mode only), for a slider shown above the fold. */
  preload?: boolean;
}

const IMAGE_SIZES = "(min-width: 1024px) 640px, 100vw";

/**
 * Stacks the edited image over the original and clips it at the range value: the
 * original shows left of the divider, the edited image right of it. With width and
 * height (the landing page) it renders the larger showcase look with next/image, a
 * drag handle and the range input laid over the image.
 */
export function BeforeAfterSlider({ originalSrc, editedSrc, name, width, height, preload }: BeforeAfterSliderProps) {
  const [position, setPosition] = useState(50);
  const clip = { clipPath: `inset(0 0 0 ${position}%)` };
  const label = `Before/after comparison for ${name}`;
  const onChange = (event: ChangeEvent<HTMLInputElement>) => setPosition(Number(event.target.value));
  if (width && height) {
    return (
      <div className="group relative overflow-hidden rounded-2xl bg-neutral-800 shadow-2xl shadow-black/40 ring-1 ring-white/10 has-[input:focus-visible]:ring-4 has-[input:focus-visible]:ring-amber-300">
        <Image
          src={originalSrc}
          alt={`Original photo ${name}`}
          width={width}
          height={height}
          sizes={IMAGE_SIZES}
          preload={preload}
          className="block h-auto w-full"
        />
        <Image
          src={editedSrc}
          alt={`Edited photo ${name}`}
          fill
          sizes={IMAGE_SIZES}
          preload={preload}
          className="object-cover"
          style={clip}
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0" style={{ left: `${position}%` }}>
          <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_12px_rgba(0,0,0,0.5)]" />
          <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-900 shadow-lg ring-4 ring-white/30 motion-safe:animate-landing-nudge group-hover:motion-safe:animate-none group-has-[input:focus-visible]:motion-safe:animate-none">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 6-6 6 6 6M15 6l6 6-6 6" />
              </svg>
            </div>
          </div>
        </div>
        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">Before</span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">After</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={position}
          onChange={onChange}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        />
      </div>
    );
  }
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
          style={clip}
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
        onChange={onChange}
        aria-label={label}
        className="w-full cursor-ew-resize rounded accent-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      />
    </div>
  );
}
