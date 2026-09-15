"""
LIFE-LINK Data Ingestion Layer
Extracts records from Supabase PostgreSQL tables:
- donors
- emergency_requests
- donor_dispatches

If Supabase is unconfigured or empty in the local environment, falls back
to the high-fidelity synthetic generator.
"""

import os
import sys
import pandas as pd
from dotenv import load_dotenv

# Add project root and ml root to python path
current_dir = os.path.dirname(os.path.abspath(__file__))
ml_dir = os.path.dirname(current_dir)
project_root = os.path.dirname(ml_dir)
sys.path.extend([current_dir, ml_dir, project_root])

# Load .env from ml directory, backend directory, or root
load_dotenv(os.path.join(ml_dir, ".env"))
load_dotenv(os.path.join(project_root, "backend", ".env"))
load_dotenv(os.path.join(project_root, ".env"))

from generate_synthetic_data import generate_synthetic_dataset


def fetch_from_supabase(output_dir: str = "ml/data/raw"):
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_KEY")
    
    os.makedirs(output_dir, exist_ok=True)

    if not supabase_url or not supabase_key or "<your-" in supabase_url:
        print("[fetch_data] Supabase credentials not found or unconfigured in .env.")
        print("[fetch_data] Initiating reproducible synthetic dataset generator...")
        return generate_synthetic_dataset(output_dir=output_dir)

    try:
        from supabase import create_client, Client
        print(f"[fetch_data] Connecting to Supabase at: {supabase_url[:28]}...")
        supabase: Client = create_client(supabase_url, supabase_key)

        print("[fetch_data] Querying 'donors' table...")
        res_donors = supabase.table("donors").select("*").execute()
        donors_data = res_donors.data or []

        print("[fetch_data] Querying 'emergency_requests' table...")
        res_reqs = supabase.table("emergency_requests").select("*").execute()
        reqs_data = res_reqs.data or []

        print("[fetch_data] Querying 'donor_dispatches' table...")
        res_disp = supabase.table("donor_dispatches").select("*").execute()
        disp_data = res_disp.data or []

        if len(disp_data) < 50:
            print(f"[fetch_data] Supabase contains {len(disp_data)} dispatches (insufficient for robust ML training).")
            print("[fetch_data] Augmenting/Falling back to synthetic data generator...")
            return generate_synthetic_dataset(output_dir=output_dir)

        df_donors = pd.DataFrame(donors_data)
        df_requests = pd.DataFrame(reqs_data)
        df_dispatches = pd.DataFrame(disp_data)

        df_donors.to_csv(os.path.join(output_dir, "donors.csv"), index=False)
        df_requests.to_csv(os.path.join(output_dir, "emergency_requests.csv"), index=False)
        df_dispatches.to_csv(os.path.join(output_dir, "donor_dispatches.csv"), index=False)

        print(f"[fetch_data] Successfully fetched from Supabase:")
        print(f"  - Donors: {len(df_donors)}")
        print(f"  - Requests: {len(df_requests)}")
        print(f"  - Dispatches: {len(df_dispatches)}")
        return df_donors, df_requests, df_dispatches

    except Exception as e:
        print(f"[fetch_data] Supabase fetch encountered error: {e}")
        print("[fetch_data] Running fallback synthetic generator...")
        return generate_synthetic_dataset(output_dir=output_dir)


if __name__ == "__main__":
    fetch_from_supabase()
