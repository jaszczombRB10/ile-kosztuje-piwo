import json
import os
import sys
import ssl
import urllib.request
import urllib.error

# Usage: python3 scripts/seed_supabase.py <SUPABASE_URL> <SUPABASE_SERVICE_ROLE_KEY>

DEFAULT_URL = "https://agsodpzkytdgicpmphxz.supabase.co"
DEFAULT_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODcxODI3MywiZXhwIjoyMTA0Mjk0MjczfQ.nXVSigEdTUqxVcIOAic59j47lUNn_qI61NQRxs3Deho"

def main():
    supabase_url = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else DEFAULT_URL
    supabase_key = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_KEY

    venues_file = "/Users/krystian/.gemini/antigravity/scratch/ile-kosztuje-piwo/data/venues.json"
    with open(venues_file, "r", encoding="utf-8") as f:
        venues = json.load(f)

    print(f"Uploading {len(venues)} venues to Supabase ({supabase_url})...")

    # Clean existing venues first to prevent duplicate key conflicts across multiple unique constraints (slug + osm_id)
    try:
        del_endpoint = f"{supabase_url}/rest/v1/venues?id=neq.00000000-0000-0000-0000-000000000000"
        del_headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}"
        }
        del_req = urllib.request.Request(del_endpoint, headers=del_headers, method="DELETE")
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(del_req, context=ctx) as r:
            print("Reset existing venues in Supabase table.")
    except Exception as e:
        print("Note on reset:", e)

    endpoint = f"{supabase_url}/rest/v1/venues"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json"
    }
    ctx = ssl._create_unverified_context()

    chunk_size = 50
    total_chunks = (len(venues) - 1) // chunk_size + 1

    for i in range(0, len(venues), chunk_size):
        chunk = venues[i:i+chunk_size]
        payload = []
        for v in chunk:
            payload.append({
                "osm_id": v.get("id"),
                "name": v["name"],
                "slug": v["slug"],
                "district": v["district"],
                "address": v["address"],
                "latitude": v["latitude"],
                "longitude": v["longitude"],
                "beer_name": v.get("beer_name", "Piwo z kranu"),
                "beer_price_pln": v["beer_price_pln"],
                "beer_size_ml": v.get("beer_size_ml", 500),
                "shot_price_pln": v.get("shot_price_pln"),
                "is_craft": v.get("is_craft", False),
                "happy_hour": v.get("happy_hour"),
                "hours": v.get("hours", "16:00 - 02:00"),
                "is_verified": v.get("is_verified", False),
                "votes_confirm": v.get("votes_confirm", 1)
            })

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, context=ctx) as resp:
                print(f"Batch {i//chunk_size + 1}/{total_chunks} uploaded successfully!")
        except urllib.error.HTTPError as e:
            print(f"HTTPError on batch {i//chunk_size + 1}: {e.code} {e.reason}")
            try:
                print("Details:", e.read().decode("utf-8"))
            except Exception:
                pass
        except Exception as e:
            print(f"Error on batch {i//chunk_size + 1}: {e}")

    print("All venues processing finished!")

if __name__ == "__main__":
    main()
