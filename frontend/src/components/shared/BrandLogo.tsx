import React from 'react';
import Link from 'next/link';

type BrandLogoProps = {
  href?: string;
  compact?: boolean;
  className?: string;
};

export function BrandLogo({ href = '/', compact = false, className = '' }: BrandLogoProps) {
  const content = (
    <span className={`inline-flex items-center gap-2.5 ${className}`} aria-label="LIFE-LINK">
      <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-red-50 shadow-sm ring-1 ring-red-100">
        <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
          <path d="M24 40.5S7.5 30.7 7.5 18.9C7.5 12.3 12.1 8 17.7 8c3.1 0 5.4 1.5 6.3 3.7C25 9.5 27.3 8 30.4 8c5.6 0 10.1 4.3 10.1 10.9C40.5 30.7 24 40.5 24 40.5Z" fill="#E31B23"/>
          <path d="M10.5 23.5h7.2l3-6.2 4.1 12.4 3.3-8.1h9.4" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
      {!compact && (
        <span className="text-[22px] leading-none font-black tracking-[-0.045em]">
          <span className="text-slate-950">LIFE-</span><span className="text-red-600">LINK</span>
        </span>
      )}
    </span>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
