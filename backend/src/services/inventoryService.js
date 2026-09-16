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

  return {
    allocations,
    allocatedUnits,
    remainingUnits: Math.max(0, quantity - allocatedUnits),
    fullyReserved: allocatedUnits >= quantity
  };
}
