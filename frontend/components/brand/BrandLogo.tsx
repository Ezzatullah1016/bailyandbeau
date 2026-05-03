'use client';

import { useState } from 'react';

type Props = {
  className?: string;
  variant?: 'dark' | 'light';
};

/** Replace `public/brand-logo.svg` with the client artwork; falls back to wordmark if the file is missing. */
export function BrandLogo({ className = '', variant = 'light' }: Props) {
  const [useFallback, setUseFallback] = useState(false);

  if (useFallback) {
    return (
      <span
        className={`font-headline font-extrabold tracking-tight ${variant === 'dark' ? 'text-[#3d3b62]' : 'text-[#eccdca]'} ${className}`}
      >
        Bailey &amp; Beau
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- dynamic client logo swap
    <img
      src="/brand-logo.svg"
      alt="Bailey & Beau"
      className={`h-9 w-auto max-w-[200px] object-contain ${className}`}
      onError={() => setUseFallback(true)}
    />
  );
}
