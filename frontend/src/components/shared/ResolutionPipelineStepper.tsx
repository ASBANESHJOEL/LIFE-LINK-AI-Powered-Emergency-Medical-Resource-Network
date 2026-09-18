import React from 'react';
import { Check, Clock, AlertTriangle, ChevronRight, Truck, Database, Building2, UserCheck, ShieldCheck } from 'lucide-react';
import { RequestStatus } from '../../types/requests';

interface ResolutionPipelineStepperProps {
  currentStatus: RequestStatus | string;
  allocatedInventoryUnits?: number;
  transferredUnits?: number;
  dispatchedDonorsCount?: number;
  totalQuantity: number;
}

export function ResolutionPipelineStepper({
  currentStatus,
  allocatedInventoryUnits = 0,
  transferredUnits = 0,
  dispatchedDonorsCount = 0,
  totalQuantity,
}: ResolutionPipelineStepperProps) {
  let activeIndex = 0;
  if (currentStatus === 'OPEN') activeIndex = 0;
  else if (currentStatus === 'SEARCHING') activeIndex = 1;
  else if (currentStatus === 'INVENTORY_RESERVED') {
    activeIndex = allocatedInventoryUnits >= totalQuantity ? 4 : 2;
  } else if (currentStatus === 'PEER_TRANSFER_PENDING') activeIndex = 2;
  else if (currentStatus === 'DONORS_NOTIFIED') activeIndex = 3;
  else if (currentStatus === 'EN_ROUTE' || (currentStatus as string) === 'ARRIVED') activeIndex = 4;
  else if (currentStatus === 'FULFILLED') activeIndex = 5;

  const steps = [
    {
      index: 0,
      title: '1. Request Initiated',
      desc: 'Validated hospital request logged',
      icon: <Building2 className="w-4 h-4" />,
    },
    {
      index: 1,
      title: '2. Local Inventory',
      desc: `${allocatedInventoryUnits}/${totalQuantity} units reserved locally`,
      icon: <Database className="w-4 h-4" />,
    },
    {
      index: 2,
      title: '3. Peer Bank Transfer',
      desc: `${transferredUnits} units requested/accepted`,
      icon: <Building2 className="w-4 h-4" />,
    },
    {
      index: 3,
      title: '4. ML Donor Ranking',
      desc: `${dispatchedDonorsCount} candidates dispatched`,
      icon: <UserCheck className="w-4 h-4" />,
    },
    {
      index: 4,
      title: '5. Transit & Fulfilment',
      desc: 'OSRM live tracking & bedside handoff',
      icon: <Truck className="w-4 h-4" />,
    },
  ];

  return (
    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-xl p-6 backdrop-blur-md shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-bold uppercase tracking-wider text-slate-300">
            Emergency Medical Resource Resolution Pipeline
          </h4>
          <p className="text-xs text-slate-400 mt-0.5">
            Hierarchical allocation: Inventory → Peer Network → ML Volunteer Donors
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300">
            Current: {currentStatus}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mt-4">
        {steps.map((step) => {
          const isCompleted = activeIndex > step.index;
          const isCurrent = activeIndex === step.index;
          const isUpcoming = activeIndex < step.index;

          let cardStyle = 'border-slate-800 bg-slate-950/40 text-slate-400';
          let iconBadgeStyle = 'bg-slate-800 text-slate-400';

          if (isCompleted) {
            cardStyle = 'border-emerald-800/60 bg-emerald-950/20 text-emerald-300';
            iconBadgeStyle = 'bg-emerald-600 text-white';
          } else if (isCurrent) {
            cardStyle = 'border-sky-500/80 bg-sky-950/30 text-sky-200 ring-2 ring-sky-500/30 shadow-lg shadow-sky-950/50';
            iconBadgeStyle = 'bg-sky-500 text-white animate-pulse';
          }

          return (
            <div
              key={step.index}
              className={`relative flex flex-col p-4 rounded-lg border transition-all duration-200 ${cardStyle}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold ${iconBadgeStyle}`}>
                  {isCompleted ? <Check className="w-4 h-4" /> : step.icon}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/40">
                  {isCompleted ? 'RESOLVED' : isCurrent ? 'ACTIVE' : 'PENDING'}
                </span>
              </div>
              <p className="text-xs font-bold text-white leading-tight">{step.title}</p>
              <p className="text-[11px] text-slate-400 mt-1 leading-snug">{step.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
