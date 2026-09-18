import React from 'react';
import { Card, CardContent } from '../ui/card';

interface MetricCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  urgency?: 'normal' | 'warning' | 'critical';
}

export function MetricCard({
  label,
  value,
  subtext,
  icon,
  urgency = 'normal',
}: MetricCardProps) {
  const borderColors = {
    normal: 'border-slate-800 hover:border-slate-700',
    warning: 'border-amber-700/50 bg-amber-950/20',
    critical: 'border-red-600/60 bg-red-950/25 animate-pulse-subtle',
  };

  const valueColors = {
    normal: 'text-white',
    warning: 'text-amber-400',
    critical: 'text-red-400',
  };

  return (
    <Card className={`transition-all duration-200 ${borderColors[urgency]}`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
          {icon && <div className="text-slate-400">{icon}</div>}
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className={`text-2xl font-bold tracking-tight ${valueColors[urgency]}`}>
            {value}
          </span>
          {subtext && <span className="text-xs text-slate-400 font-normal">{subtext}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
