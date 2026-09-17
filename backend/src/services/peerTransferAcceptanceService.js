import { supabaseAdmin } from '../lib/supabaseAdmin.js';

export async function acceptPeerTransferOffer({ offerId, bloodBankId }) {
  const { data, error } = await supabaseAdmin.rpc('accept_blood_bank_transfer_offer', {
    p_offer_id: offerId,
    p_blood_bank_id: bloodBankId
  });

  if (error) {
    const err = new Error(error.message || 'Failed to accept peer blood-bank transfer offer');
    err.code = error.code;
    throw err;
  }

  const result = data?.[0];
  if (!result) throw new Error('Peer transfer acceptance returned no result');

  return result;
}
