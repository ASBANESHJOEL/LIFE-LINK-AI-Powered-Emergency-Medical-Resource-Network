import { supabaseAdmin } from '../lib/supabaseAdmin.js';

/**
 * Atomically reserves usable blood inventory for an emergency request.
 * The database RPC locks inventory rows and prevents over-allocation.
 */
export async function reserveBloodInventory({ requestId, bloodGroup, componentType, quantity }) {
  const { data, error } = await supabaseAdmin.rpc('reserve_blood_inventory', {
    p_request_id: requestId,
    p_blood_group: bloodGroup,
    p_component_type: componentType,
    p_quantity: quantity
  });

  if (error) {
    const err = new Error(error.message || 'Failed to reserve blood inventory');
    err.code = error.code;
    throw err;
  }

  const allocations = data || [];
  const allocatedUnits = allocations.reduce((sum, row) => sum + Number(row.allocated_units || 0), 0);

  let remainingUnits;
  if (allocations.length > 0) {
    remainingUnits = Number(allocations[allocations.length - 1].remaining_request_units ?? 0);
  } else {
    const { data: currentAllocations } = await supabaseAdmin
      .from('request_inventory_allocations')
      .select('allocated_units')
      .eq('request_id', requestId)
      .eq('status', 'RESERVED');
    const alreadyReserved = (currentAllocations || []).reduce((sum, r) => sum + Number(r.allocated_units || 0), 0);
    remainingUnits = Math.max(0, Number(quantity) - alreadyReserved);
  }

  return {
    allocations,
    allocatedUnits,
    remainingUnits,
    fullyReserved: remainingUnits === 0
  };
}
