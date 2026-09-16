import { supabaseAdmin } from '../lib/supabaseAdmin.js';

function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((value) => value === null || value === undefined)) return null;
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Finds verified peer blood banks that can contribute without dropping an
 * inventory lot below its configured critical level. V1 uses exact blood
 * group/component matches for peer resolution; clinical compatibility is not
 * delegated to ML.
 */
export async function createPeerTransferOffers({ request }) {
  const { data: existingOffers, error: existingError } = await supabaseAdmin
    .from('blood_bank_transfer_offers')
    .select('id')
    .eq('request_id', request.id)
    .eq('status', 'OFFERED');
  if (existingError) throw new Error(existingError.message || 'Failed to inspect existing transfer offers');

  if (existingOffers?.length) {
    const { error } = await supabaseAdmin
      .from('blood_bank_transfer_offers')
      .update({ status: 'EXPIRED' })
      .eq('request_id', request.id)
      .eq('status', 'OFFERED');
    if (error) throw new Error(error.message || 'Failed to expire previous transfer offers');
  }

  const { data: allocations, error: allocationError } = await supabaseAdmin
    .from('request_inventory_allocations')
    .select('allocated_units')
    .eq('request_id', request.id)
    .eq('status', 'RESERVED');
  if (allocationError) throw new Error(allocationError.message || 'Failed to calculate request allocation');

  const alreadyReserved = (allocations || []).reduce((sum, row) => sum + Number(row.allocated_units || 0), 0);
  let remainingUnits = Math.max(0, Number(request.quantity) - alreadyReserved);
  if (remainingUnits === 0) return { remainingUnits: 0, offers: [] };

  const { data: banks, error: bankError } = await supabaseAdmin
    .from('blood_banks')
    .select('id, name, latitude, longitude, verified')
    .eq('verified', true);
  if (bankError) throw new Error(bankError.message || 'Failed to load verified blood banks');

  const { data: inventory, error: inventoryError } = await supabaseAdmin
    .from('blood_inventory')
    .select('id, blood_bank_id, blood_group, component_type, available_units, critical_level, expiry_date, last_updated')
    .eq('blood_group', request.blood_group)
    .eq('component_type', request.resource_type)
    .gt('available_units', 0)
    .gt('expiry_date', new Date().toISOString());
  if (inventoryError) throw new Error(inventoryError.message || 'Failed to load peer inventory');

  const bankById = new Map((banks || []).map((bank) => [bank.id, bank]));
  const candidateMap = new Map();

  for (const lot of inventory || []) {
    const bank = bankById.get(lot.blood_bank_id);
    if (!bank) continue;
    const transferable = Math.max(0, Number(lot.available_units) - Number(lot.critical_level));
    if (transferable <= 0) continue;

    const current = candidateMap.get(bank.id) || {
      bloodBankId: bank.id,
      bloodBankName: bank.name,
      distanceKm: haversineKm(request.hospital_latitude, request.hospital_longitude, bank.latitude, bank.longitude),
      transferableUnits: 0,
      earliestExpiry: lot.expiry_date
    };
    current.transferableUnits += transferable;
    if (new Date(lot.expiry_date) < new Date(current.earliestExpiry)) current.earliestExpiry = lot.expiry_date;
    candidateMap.set(bank.id, current);
  }

  const candidates = [...candidateMap.values()].sort((a, b) => {
    if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm;
    if (a.distanceKm === null && b.distanceKm !== null) return 1;
    if (a.distanceKm !== null && b.distanceKm === null) return -1;
    const expiryDiff = new Date(a.earliestExpiry) - new Date(b.earliestExpiry);
    if (expiryDiff !== 0) return expiryDiff;
    return b.transferableUnits - a.transferableUnits;
  });

  const offers = [];
  for (const candidate of candidates) {
    if (remainingUnits <= 0) break;
    const offeredUnits = Math.min(remainingUnits, candidate.transferableUnits);
    offers.push({
      requestId: request.id,
      bloodBankId: candidate.bloodBankId,
      bloodGroup: request.blood_group,
      componentType: request.resource_type,
      offeredUnits,
      distanceKm: candidate.distanceKm === null ? null : Number(candidate.distanceKm.toFixed(2)),
      earliestExpiry: candidate.earliestExpiry,
      transferableUnits: candidate.transferableUnits
    });
    remainingUnits -= offeredUnits;
  }

  if (offers.length) {
    const { error: insertError } = await supabaseAdmin
      .from('blood_bank_transfer_offers')
      .insert(offers.map(({ earliestExpiry, transferableUnits, ...offer }) => offer));
    if (insertError) throw new Error(insertError.message || 'Failed to create peer transfer offers');
  }

  return { remainingUnits, offers };
}
