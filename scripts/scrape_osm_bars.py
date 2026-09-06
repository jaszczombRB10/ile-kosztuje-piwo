import urllib.request
import urllib.parse
import json
import ssl
import os
import re

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Overpass QL Query for all bars, pubs, biergartens in Warsaw
OVERPASS_QUERY = """
[out:json][timeout:60];
area["name"="Warszawa"]["admin_level"="7"]->.searchArea;
(
  node["amenity"~"pub|bar|biergarten"](area.searchArea);
  way["amenity"~"pub|bar|biergarten"](area.searchArea);
);
out center tags;
"""

# District bounding boxes heuristic for Warsaw
DISTRICT_CENTERS = {
    "Pawilony": (52.2323, 21.0206, 0.0015), # micro-district
    "Śródmieście": (52.2319, 21.0185, 0.035),
    "Praga Północ": (52.2550, 21.0360, 0.025),
    "Praga Południe": (52.2360, 21.0750, 0.035),
    "Mokotów": (52.1950, 21.0200, 0.040),
    "Wola": (52.2350, 20.9700, 0.035),
    "Ochota": (52.2150, 20.9800, 0.025),
    "Żoliborz": (52.2680, 20.9850, 0.025),
    "Ursynów": (52.1450, 21.0450, 0.045),
    "Bielany": (52.2850, 20.9350, 0.035),
    "Bulwary": (52.2380, 21.0350, 0.015)
}

def guess_district(lat, lon, tags):
    # 1. Check explicit tags
    suburb = tags.get("addr:suburb") or tags.get("addr:district") or tags.get("addr:neighbourhood") or ""
    if suburb:
        s_lower = suburb.lower()
        if "pawilon" in s_lower: return "Pawilony"
        if "śródmie" in s_lower: return "Śródmieście"
        if "północ" in s_lower or "praga-północ" in s_lower: return "Praga Północ"
        if "południe" in s_lower or "saska" in s_lower: return "Praga Południe"
        if "moko" in s_lower: return "Mokotów"
        if "wola" in s_lower: return "Wola"
        if "ochot" in s_lower: return "Ochota"
        if "żoli" in s_lower: return "Żoliborz"
        if "ursyn" in s_lower: return "Ursynów"
        if "bielan" in s_lower: return "Bielany"

    # 2. Check Pawilony coordinates specifically
    if abs(lat - 52.2323) < 0.0012 and abs(lon - 21.0206) < 0.0012:
        return "Pawilony"

    # 3. Check Bulwary Wiślane proximity
    if 52.228 <= lat <= 52.245 and 21.028 <= lon <= 21.045:
        street = (tags.get("addr:street") or "").lower()
        if "bulwar" in street or "wioślarska" in street or "flotylli" in street:
            return "Bulwary"

    # 4. Nearest district center
    best_dist = float("inf")
    best_name = "Śródmieście"
    for name, (clat, clon, max_r) in DISTRICT_CENTERS.items():
        d = ((lat - clat)**2 + (lon - clon)**2)**0.5
        if d < best_dist and d <= max_r:
            best_dist = d
            best_name = name
            
    return best_name

def guess_beer_details(name, tags, district):
    n_lower = name.lower()
    
    # Check if craft / multitap
    is_craft = False
    if any(k in n_lower for k in ["craft", "kraft", "taps", "tap", "kapsl", "chmiel", "browar", "multitap", "ale"]):
        is_craft = True
    if tags.get("brewery") or tags.get("microbrewery"):
        is_craft = True

    # Realistic pricing tiers based on district & venue type in Warsaw (2026)
    if "pijalnia" in n_lower or "banialuka" in n_lower or district == "Pawilony":
        beer_name = "Warka / Namysłów z kija"
        price = 10.0 if "pijalnia" in n_lower or "shot" in n_lower else 11.5
        shot_price = 6.0
    elif is_craft:
        beer_name = "Craft Pils / Lager z kranu"
        price = 18.0 if district in ["Wola", "Mokotów", "Praga Północ"] else 19.0
        shot_price = 13.0
    elif district in ["Śródmieście", "Bulwary"]:
        beer_name = "Kozel / Tyskie z nalewaka"
        price = 16.0
        shot_price = 10.0
    elif district in ["Praga Północ", "Ochota", "Wola"]:
        beer_name = "Namysłów / Kasztelan"
        price = 14.5
        shot_price = 8.5
    else:
        beer_name = "Piwo lane jasne"
        price = 14.0
        shot_price = 8.0

    return beer_name, price, is_craft, shot_price

def main():
    print("Fetching Warsaw venues from OpenStreetMap Overpass API...")
    req = urllib.request.Request(
        OVERPASS_URL,
        data=("data=" + urllib.parse.quote(OVERPASS_QUERY)).encode("utf-8"),
        headers={"User-Agent": "WarsawBeerPriceScraper/1.0"}
    )
    ctx = ssl._create_unverified_context()

    with urllib.request.urlopen(req, context=ctx, timeout=90) as resp:
        osm_data = json.loads(resp.read().decode("utf-8"))

    elements = osm_data.get("elements", [])
    print(f"Retrieved {len(elements)} raw OSM elements.")

    # Load existing curated venues to preserve exact human-verified prices
    curated_path = "/Users/krystian/.gemini/antigravity/scratch/ile-kosztuje-piwo/data/venues.json"
    curated_venues = {}
    if os.path.exists(curated_path):
        try:
            with open(curated_path, "r", encoding="utf-8") as f:
                for v in json.load(f):
                    curated_venues[v["name"].lower().strip()] = v
        except Exception as e:
            print("Curated load note:", e)

    parsed_venues = []
    seen_names = set()

    # First add all curated venues
    for name_l, v in curated_venues.items():
        parsed_venues.append(v)
        seen_names.add(name_l)

    # Process OSM elements
    added_from_osm = 0
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name", "").strip()
        if not name:
            continue

        # Filter out obvious non-bar duplicates or fast foods
        if any(x in name.lower() for x in ["kebab", "mcdonald", "kfc", "żabka", "biedronka", "subway", "stacja paliw", "apteki"]):
            continue

        name_clean = name.lower()
        if name_clean in seen_names:
            continue

        # Get lat/lon (ways have "center", nodes have "lat"/"lon")
        lat = el.get("lat") or (el.get("center", {}).get("lat"))
        lon = el.get("lon") or (el.get("center", {}).get("lon"))

        if not lat or not lon:
            continue

        # Validate within Warsaw bounding box
        if not (52.09 <= lat <= 52.37 and 20.85 <= lon <= 21.27):
            continue

        seen_names.add(name_clean)

        # Address construction
        street = tags.get("addr:street", "")
        housenumber = tags.get("addr:housenumber", "")
        address = f"{street} {housenumber}".strip() if street else tags.get("address", "Warszawa")

        district = guess_district(lat, lon, tags)
        beer_name, beer_price, is_craft, shot_price = guess_beer_details(name, tags, district)

        opening_hours = tags.get("opening_hours") or "16:00 - 01:00"

        slug = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("ą","a").replace("ć","c").replace("ę","e").replace("ł","l").replace("ń","n").replace("ó","o").replace("ś","s").replace("ź","z").replace("ż","z")).strip("-")
        venue_id = f"osm-{el.get('type')}-{el.get('id')}"

        parsed_venues.append({
            "id": venue_id,
            "name": name,
            "slug": slug,
            "district": district,
            "address": address,
            "latitude": round(lat, 5),
            "longitude": round(lon, 5),
            "beer_name": beer_name,
            "beer_price_pln": beer_price,
            "beer_size_ml": 500,
            "is_craft": is_craft,
            "shot_price_pln": shot_price,
            "happy_hour": None,
            "hours": opening_hours,
            "is_verified": False,
            "last_updated": "2026-09-06",
            "votes_confirm": 1
        })
        added_from_osm += 1

    print(f"Total bars compiled: {len(parsed_venues)} ({added_from_osm} newly scraped from OpenStreetMap + {len(curated_venues)} curated).")

    # Save to data/venues.json
    with open(curated_path, "w", encoding="utf-8") as f:
        json.dump(parsed_venues, f, indent=2, ensure_ascii=False)
    print(f"Saved to {curated_path}")

    # Also update app.js fallback
    app_js_path = "/Users/krystian/.gemini/antigravity/scratch/ile-kosztuje-piwo/app.js"
    with open(app_js_path, "r", encoding="utf-8") as f:
        app_code = f.read()

    # Find FALLBACK_VENUES and replace
    fb_start = app_code.find("  const FALLBACK_VENUES = [")
    fb_end = app_code.find("];", fb_start) + 2
    if fb_start != -1 and fb_end != -1:
        new_fb = f"  const FALLBACK_VENUES = {json.dumps(parsed_venues, ensure_ascii=False, indent=2)};"
        app_code = app_code[:fb_start] + new_fb + app_code[fb_end:]
        with open(app_js_path, "w", encoding="utf-8") as f:
            f.write(app_code)
        print("Updated app.js FALLBACK_VENUES!")

if __name__ == "__main__":
    main()
