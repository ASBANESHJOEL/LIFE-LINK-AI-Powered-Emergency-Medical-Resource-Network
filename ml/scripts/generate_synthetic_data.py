"""
LIFE-LINK Synthetic Data Generator
Generates clinically grounded, zero-leakage synthetic data matching the Supabase PostgreSQL schema:
- donors
- emergency_requests
- donor_dispatches

Strictly adheres to:
1. Exact blood group compatibility and population distribution
2. Latent donor propensity with realistic temporal and dispatch-context variance
3. Target construction from dispatch outcome (ACCEPTED/COMPLETED vs DECLINED/NO_RESPONSE/MISSED/EXPIRED)
4. Full isolation of post-acceptance variables
"""

import os
import uuid
import random
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

BLOOD_TYPES = ['O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', 'AB-']
BLOOD_PROBABILITIES = [0.38, 0.30, 0.18, 0.04, 0.05, 0.02, 0.02, 0.01]

# Red Blood Cell Compatibility Matrix (Donor -> Compatible Recipients)
RBC_COMPATIBILITY = {
    'O-': {'O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'},
    'O+': {'O+', 'A+', 'B+', 'AB+'},
    'A-': {'A-', 'A+', 'AB-', 'AB+'},
    'A+': {'A+', 'AB+'},
    'B-': {'B-', 'B+', 'AB-', 'AB+'},
    'B+': {'B+', 'AB+'},
    'AB-': {'AB-', 'AB+'},
    'AB+': {'AB+'}
}

RESOURCE_TYPES = ['BLOOD', 'PLATELETS', 'PLASMA']
RESOURCE_PROBABILITIES = [0.70, 0.18, 0.12]

URGENCY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
URGENCY_PROBABILITIES = [0.10, 0.35, 0.35, 0.20]
URGENCY_MAP = {'LOW': 0, 'MEDIUM': 1, 'HIGH': 2, 'CRITICAL': 3}


def is_compatible(donor_blood: str, request_blood: str) -> bool:
    return request_blood in RBC_COMPATIBILITY.get(donor_blood, set())


def generate_synthetic_dataset(
    num_donors: int = 450,
    num_requests: int = 900,
    num_dispatches: int = 3500,
    random_state: int = 42,
    output_dir: str = "ml/data/raw"
):
    np.random.seed(random_state)
    random.seed(random_state)
    os.makedirs(output_dir, exist_ok=True)

    base_time = datetime(2025, 1, 1, 0, 0, 0)
    
    # 1. Generate Donors
    donors = []
    donor_propensities = {}
    
    for _ in range(num_donors):
        donor_id = str(uuid.uuid4())
        blood_type = np.random.choice(BLOOD_TYPES, p=BLOOD_PROBABILITIES)
        is_verified = bool(np.random.rand() < 0.88)
        is_eligible = bool(np.random.rand() < 0.84)
        is_available = bool(np.random.rand() < 0.78)
        
        # Latent donor responsiveness parameter Beta(3, 2)
        latent_propensity = np.random.beta(3.2, 2.1)
        donor_propensities[donor_id] = latent_propensity
        
        # Last donation: between 30 and 450 days ago, or None
        if np.random.rand() < 0.75:
            days_ago = int(np.random.exponential(scale=120) + 30)
            days_ago = min(days_ago, 730)
            last_donation_date = (base_time - timedelta(days=days_ago)).strftime('%Y-%m-%d')
        else:
            last_donation_date = None

        created_days_ago = random.randint(180, 500)
        donor_created_at = base_time - timedelta(days=created_days_ago)

        donors.append({
            'id': donor_id,
            'user_id': str(uuid.uuid4()),
            'blood_type': blood_type,
            'is_verified': is_verified,
            'is_eligible': is_eligible,
            'is_available': is_available,
            'last_donation_date': last_donation_date,
            'created_at': donor_created_at.isoformat()
        })
    
    df_donors = pd.DataFrame(donors)

    # 2. Generate Emergency Requests
    requests = []
    for _ in range(num_requests):
        request_id = str(uuid.uuid4())
        hospital_id = str(uuid.uuid4())
        blood_type = np.random.choice(BLOOD_TYPES, p=BLOOD_PROBABILITIES)
        resource_type = np.random.choice(RESOURCE_TYPES, p=RESOURCE_PROBABILITIES)
        urgency = np.random.choice(URGENCY_LEVELS, p=URGENCY_PROBABILITIES)
        requested_quantity = float(random.choice([1, 2, 2, 3, 4, 6]))
        
        # Dispatch time over 120 days
        req_offset_hours = random.randint(0, 120 * 24)
        req_time = base_time + timedelta(hours=req_offset_hours, minutes=random.randint(0, 59))

        requests.append({
            'id': request_id,
            'hospital_id': hospital_id,
            'blood_type': blood_type,
            'resource_type': resource_type,
            'requested_quantity': requested_quantity,
            'urgency_level': urgency,
            'status': 'OPEN',
            'created_at': req_time.isoformat()
        })

    df_requests = pd.DataFrame(requests)

    # 3. Generate Donor Dispatches
    dispatches = []
    donors_dict = {d['id']: d for d in donors}
    donor_id_list = list(donors_dict.keys())

    for req in requests:
        req_id = req['id']
        req_blood = req['blood_type']
        req_resource = req['resource_type']
        req_urgency = req['urgency_level']
        req_qty = req['requested_quantity']
        req_created = datetime.fromisoformat(req['created_at'])

        # Dispatches per request (between 2 and 6 donors)
        k_dispatches = min(random.randint(2, 6), num_donors)
        
        # Sample candidate donors (biased towards compatible blood types)
        sampled_donors = random.sample(donor_id_list, k_dispatches)
        
        for donor_id in sampled_donors:
            donor = donors_dict[donor_id]
            donor_blood = donor['blood_type']
            
            # Dispatch time is within 2-15 mins of request
            disp_time = req_created + timedelta(minutes=random.randint(2, 15))
            
            # Contextual feature calculation for realistic simulation
            exact_match = (donor_blood == req_blood)
            compat = is_compatible(donor_blood, req_blood)
            disp_hour = disp_time.hour
            disp_dow = disp_time.weekday()
            is_wknd = (disp_dow in [5, 6])
            is_night = (disp_hour >= 22 or disp_hour < 6)
            is_biz = (9 <= disp_hour < 18 and not is_wknd)
            
            # Base probability calculation based on latent factor and context
            propensity = donor_propensities[donor_id]
            
            # Logit model for simulated response
            logit = -1.15  # Balanced base intercept
            logit += 1.45 * propensity
            logit += 0.80 * (1.0 if exact_match else 0.0)
            logit += 0.55 * (1.0 if compat else -0.90)
            logit += 0.70 * (1.0 if donor['is_available'] else -0.65)
            logit += 0.55 * (1.0 if donor['is_eligible'] else -0.70)
            logit += 0.25 * (1.0 if donor['is_verified'] else 0.0)
            logit += 0.40 * (URGENCY_MAP[req_urgency] / 3.0)
            logit += 0.25 * (1.0 if is_biz else 0.0)
            logit -= 0.75 * (1.0 if is_night else 0.0)
            logit -= 0.30 * (1.0 if is_wknd else 0.0)
            logit += 0.15 * (1.0 if req_resource == 'BLOOD' else 0.0)
            
            # Add stochastic noise for realistic uncertainty and hard examples
            noise = np.random.normal(0, 0.45)
            prob = 1.0 / (1.0 + np.exp(-(logit + noise)))
            
            is_positive = (np.random.rand() < prob)
            
            if is_positive:
                outcome_status = random.choice(['ACCEPTED', 'ACCEPTED', 'COMPLETED'])
                responded_offset = random.randint(1, 15)
                responded_at = (disp_time + timedelta(minutes=responded_offset)).isoformat()
                accepted_at = responded_at
                completed_at = (disp_time + timedelta(hours=random.randint(1, 3))).isoformat() if outcome_status == 'COMPLETED' else None
            else:
                outcome_status = random.choice(['DECLINED', 'NO_RESPONSE', 'NO_RESPONSE', 'MISSED', 'EXPIRED'])
                if outcome_status == 'DECLINED':
                    responded_at = (disp_time + timedelta(minutes=random.randint(2, 20))).isoformat()
                else:
                    responded_at = None
                accepted_at = None
                completed_at = None

            dispatches.append({
                'id': str(uuid.uuid4()),
                'request_id': req_id,
                'donor_id': donor_id,
                'status': outcome_status,
                'dispatched_at': disp_time.isoformat(),
                'responded_at': responded_at,
                'accepted_at': accepted_at,
                'completed_at': completed_at,
                'created_at': disp_time.isoformat()
            })

    # Sort dispatches chronologically
    dispatches.sort(key=lambda x: x['dispatched_at'])
    df_dispatches = pd.DataFrame(dispatches)

    # Save to raw directory
    df_donors.to_csv(os.path.join(output_dir, "donors.csv"), index=False)
    df_requests.to_csv(os.path.join(output_dir, "emergency_requests.csv"), index=False)
    df_dispatches.to_csv(os.path.join(output_dir, "donor_dispatches.csv"), index=False)

    print(f"[Synthetic Generator] Successfully generated:")
    print(f"  - Donors: {len(df_donors)}")
    print(f"  - Requests: {len(df_requests)}")
    print(f"  - Dispatches: {len(df_dispatches)}")
    pos_count = sum(df_dispatches['status'].isin(['ACCEPTED', 'COMPLETED']))
    print(f"  - Positive Outlines (ACCEPTED/COMPLETED): {pos_count} ({pos_count/len(df_dispatches)*100:.2f}%)")
    print(f"  - Saved to: {output_dir}")
    
    return df_donors, df_requests, df_dispatches


if __name__ == "__main__":
    generate_synthetic_dataset()
