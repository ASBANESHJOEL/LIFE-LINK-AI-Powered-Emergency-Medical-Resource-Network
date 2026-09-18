import React from 'react';
import { Badge } from '../ui/badge';
import { UrgencyLevel } from '../../types/requests';

interface UrgencyBadgeProps {
  urgency: UrgencyLevel;
}

export function UrgencyBadge({ urgency }: UrgencyBadgeProps) {
  switch (urgency) {
    case 'CRITICAL':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-950/80 text-red-300 border border-red-800/60 animate-pulse">
          <span className="h-2 w-2 rounded-full bg-red-500"></span>
          CRITICAL EMERGENCY
        </span>
      );
    case 'HIGH':
    case 'URGENT':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-amber-950/80 text-amber-300 border border-amber-800/60">
          <span className="h-2 w-2 rounded-full bg-amber-500"></span>
          HIGH PRIORITY
        </span>
      );
    case 'MEDIUM':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wider bg-amber-950/70 text-amber-300 border border-amber-800/50">
          <span className="h-2 w-2 rounded-full bg-amber-400"></span>
          MEDIUM PRIORITY
        </span>
      );
    case 'LOW':
    case 'STANDARD':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
          <span className="h-2 w-2 rounded-full bg-slate-400"></span>
          STANDARD PRIORITY
        </span>
      );
    default:
      return <Badge variant="secondary">{urgency}</Badge>;
  }
}
