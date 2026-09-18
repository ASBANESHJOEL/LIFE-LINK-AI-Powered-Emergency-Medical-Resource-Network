import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'border-transparent bg-slate-800 text-slate-100 hover:bg-slate-700',
    secondary: 'border-transparent bg-slate-800/60 text-slate-300',
    destructive: 'border-transparent bg-red-950/80 text-red-300 border border-red-800/40',
    outline: 'text-slate-300 border-slate-700',
    success: 'border-transparent bg-emerald-950/80 text-emerald-300 border border-emerald-800/40',
    warning: 'border-transparent bg-amber-950/80 text-amber-300 border border-amber-800/40',
    info: 'border-transparent bg-sky-950/80 text-sky-300 border border-sky-800/40',
  };

  return (
    <div
      className={twMerge(
        clsx(
          'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors',
          variants[variant],
          className
        )
      )}
      {...props}
    />
  );
}
