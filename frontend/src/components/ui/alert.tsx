import * as React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'destructive' | 'success' | 'warning' | 'info';
}

export function Alert({ className, variant = 'default', ...props }: AlertProps) {
  const variants = {
    default: 'border-slate-700 bg-slate-800/80 text-slate-200',
    destructive: 'border-red-800/60 bg-red-950/40 text-red-200',
    success: 'border-emerald-800/60 bg-emerald-950/40 text-emerald-200',
    warning: 'border-amber-800/60 bg-amber-950/40 text-amber-200',
    info: 'border-sky-800/60 bg-sky-950/40 text-sky-200',
  };

  return (
    <div
      role="alert"
      className={twMerge(
        clsx('relative w-full rounded-xl border p-4 backdrop-blur-sm [&>svg~*]:pl-7 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4', variants[variant], className)
      )}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5 className={twMerge(clsx('mb-1 font-semibold leading-none tracking-tight text-white', className))} {...props} />
  );
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <div className={twMerge(clsx('text-xs leading-relaxed text-slate-300', className))} {...props} />;
}
