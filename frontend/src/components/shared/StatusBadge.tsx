import React from 'react';
import { Badge } from '../ui/badge';
import { RequestStatus } from '../../types/requests';
import { DispatchStatus } from '../../types/dispatch';

interface StatusBadgeProps {
  status: RequestStatus | DispatchStatus | string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  switch (status) {
    case 'OPEN':
      return <Badge variant="info">REQUEST INITIATED</Badge>;
    case 'SEARCHING':
      return <Badge variant="warning">SEARCHING RESOURCES</Badge>;
    case 'INVENTORY_RESERVED':
      return <Badge variant="success">INVENTORY RESERVED</Badge>;
    case 'PEER_TRANSFER_PENDING':
      return <Badge variant="warning">PEER TRANSFER PENDING</Badge>;
    case 'DONORS_NOTIFIED':
      return <Badge variant="info">DONORS NOTIFIED</Badge>;
    case 'EN_ROUTE':
      return <Badge variant="warning">EN ROUTE</Badge>;
    case 'ARRIVED':
      return <Badge variant="info">ARRIVED AT FACILITY</Badge>;
    case 'FULFILLED':
    case 'COMPLETED':
      return <Badge variant="success">FULFILLED / COMPLETED</Badge>;
    case 'CANCELLED':
    case 'DECLINED':
      return <Badge variant="destructive">{status}</Badge>;
    case 'ESCALATED':
      return <Badge variant="destructive">ESCALATED TO REGULATOR</Badge>;
    case 'TIMEOUT':
      return <Badge variant="destructive">DISPATCH TIMEOUT</Badge>;
    case 'ACCEPTED':
      return <Badge variant="success">ACCEPTED</Badge>;
    case 'NOTIFIED':
      return <Badge variant="info">NOTIFIED</Badge>;
    default:
      return <Badge variant="secondary">{status.replace(/_/g, ' ')}</Badge>;
  }
}
