import React from 'react';
import { BloodGroup } from '../../types/requests';

interface BloodTypeBadgeProps {
  bloodGroup: BloodGroup | string;
  size?: 'sm' | 'md' | 'lg';
}

export function BloodTypeBadge({ bloodGroup, size = 'md' }: BloodTypeBadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 min-w-[2.25rem]',
    md: 'text-sm px-2.5 py-1 min-w-[3rem]',
    lg: 'text-lg px-4 py-2 min-w-[4rem]',
  };

  return (
    <span
      className={`inline-flex items-center justify-center font-black tracking-wider rounded-md border border-red-600/40 bg-gradient-to-br from-red-950/80 to-slate-900 text-red-300 shadow-inner ${sizeClasses[size]}`}
    >
      {bloodGroup}
    </span>
  );
}
