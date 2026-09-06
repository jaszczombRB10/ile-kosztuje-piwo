import json
import os
import sys
import ssl
import urllib.request
import urllib.error

# Usage: python3 scripts/seed_supabase.py <SUPABASE_URL> <SUPABASE_SERVICE_ROLE_KEY>

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 scripts/seed_supabase.py <SUPABASE_URL> <SUPABASE_KEY>")
        print("Example: python3 scripts/seed_supabase.py https://xyz.supabase.co eyJhbGci...")
        sys.exit(1)

    supabase_url = sys.argv[1].rstrip("/")
    supabase_key = sys.argv[2]

    venues_file = "/Users/krystian/.gemini/antigravity/scratch/ile-kosztuje-piwo/data/venues.json"
    with open(venues_file, "r", encoding="utf-8") as f:
        venues = json.load(f)

    print(f"Uploading {len(venues)} venues to Supabase ({supabase_url})...")

    endpoint = f"{supabase_url}/rest/v1/venues"
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates"
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
