#!/usr/bin/env python3
import urllib.request
import json
import time
import os
import re

# 1. Load official Warsaw district polygons
districts_raw = json.load(open('scripts/warsaw_districts_raw.json'))

def stitch_ways(members):
    outer_ways = [m['geometry'] for m in members if m.get('role') in ('outer', '') and 'geometry' in m]
    if not outer_ways:
        return []
    segments = [[(pt['lat'], pt['lon']) for pt in w] for w in outer_ways]
    rings = []
    while segments:
        current_ring = list(segments.pop(0))
        extended = True
        while extended and segments:
            extended = False
            for i, seg in enumerate(segments):
                if abs(seg[0][0] - current_ring[-1][0]) < 1e-4 and abs(seg[0][1] - current_ring[-1][1]) < 1e-4:
                    current_ring.extend(seg[1:])
                    segments.pop(i)
                    extended = True
                    break
                elif abs(seg[-1][0] - current_ring[-1][0]) < 1e-4 and abs(seg[-1][1] - current_ring[-1][1]) < 1e-4:
                    current_ring.extend(reversed(seg[:-1]))
                    segments.pop(i)
                    extended = True
                    break
                elif abs(seg[-1][0] - current_ring[0][0]) < 1e-4 and abs(seg[-1][1] - current_ring[0][1]) < 1e-4:
                    current_ring = list(seg[:-1]) + current_ring
                    segments.pop(i)
                    extended = True
                    break
                elif abs(seg[0][0] - current_ring[0][0]) < 1e-4 and abs(seg[0][1] - current_ring[0][1]) < 1e-4:
                    current_ring = list(reversed(seg[1:])) + current_ring
                    segments.pop(i)
                    extended = True
                    break
        rings.append(current_ring)
    return rings

def point_in_polygon(py, px, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        y1, x1 = poly[i]
        y2, x2 = poly[(i + 1) % n]
        if ((y1 > py) != (y2 > py)):
            if px < (x2 - x1) * (py - y1) / (y2 - y1) + x1:
                inside = not inside
    return inside

districts_polys = {}
for el in districts_raw['elements']:
    name = el.get('tags', {}).get('name')
    norm_name = name.replace('-', ' ')
    districts_polys[norm_name] = stitch_ways(el.get('members', []))

def get_official_district(lat, lon):
    for name, rings in districts_polys.items():
        for ring in rings:
            if point_in_polygon(lat, lon, ring):
                return name
    return None

BLACKLIST_IDS = {
    "osm-node-952192677",   # Wodne Ochotnicze Pogotowie Ratunkowe (WOPR)
    "osm-node-4366042671",  # Bufet Instytutu Biologii Doświadczalnej PAN (canteen)
    "osm-node-11730882836", # Sala bankietowa Dedek Park (wedding hall)
    "suburban-tawerna-lesna-wesola" # Outside Warsaw
}

cache_file = 'scripts/address_cache.json'
address_cache = {}
if os.path.exists(cache_file):
    try:
        address_cache = json.load(open(cache_file))
    except Exception:
        address_cache = {}

def reverse_geocode(lat, lon, venue_name):
    key = f"{lat:.5f},{lon:.5f}"
    if key in address_cache:
        return address_cache[key]
    
    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
    req = urllib.request.Request(url, headers={'User-Agent': 'PoIlePiwkoDataAudit/1.0 (dev@poilepiwko.pl)'})
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            addr = data.get('address', {})
            road = addr.get('road') or addr.get('pedestrian') or addr.get('footway')
            num = addr.get('house_number')
            full_addr = f"{road} {num}".strip() if num else (road or "Warszawa")
            address_cache[key] = full_addr
            time.sleep(0.7)
            return full_addr
    except Exception as e:
        print(f"Geocode note for {venue_name}: {e}")
        return "Warszawa"

venues = json.load(open('data/venues.json'))
print(f"Initial venues count: {len(venues)}")

cleaned_venues = []
district_changes = 0
address_updates = 0

for v in venues:
    if v['id'] in BLACKLIST_IDS:
        print(f"Removing blacklisted/non-bar: {v['name']} ({v['id']})")
        continue

    lat = v['latitude']
    lon = v['longitude']
    old_district = v.get('district')
    
    is_pawilony = (old_district == "Pawilony") or (abs(lat - 52.2323) < 0.0016 and abs(lon - 21.0206) < 0.0018)
    is_bulwary = (old_district == "Bulwary") or ("bulwar" in (v.get('address') or '').lower())
    
    if is_pawilony:
        new_district = "Pawilony"
        if v.get('address') in ("Warszawa", "", None):
            v['address'] = "Nowy Świat 22/28 (Pawilony)"
            address_updates += 1
    elif is_bulwary:
        new_district = "Bulwary"
    else:
        official_d = get_official_district(lat, lon)
        if official_d:
            new_district = official_d
        else:
            new_district = old_district or "Śródmieście"

    if new_district != old_district:
        print(f"District updated: {v['name']} -> was '{old_district}', now '{new_district}'")
        v['district'] = new_district
        district_changes += 1

    if v.get('address') in ("Warszawa", "", None) and not is_pawilony:
        real_addr = reverse_geocode(lat, lon, v['name'])
        if real_addr and real_addr != "Warszawa":
            print(f"Address enriched: {v['name']} -> {real_addr}")
            v['address'] = real_addr
            address_updates += 1

    cleaned_venues.append(v)

with open(cache_file, 'w') as f:
    json.dump(address_cache, f, indent=2, ensure_ascii=False)

with open('data/venues.json', 'w') as f:
    json.dump(cleaned_venues, f, indent=2, ensure_ascii=False)

print(f"\nAudit complete!")
print(f"Total venues: {len(cleaned_venues)}")
print(f"District corrections: {district_changes}")
print(f"Address enrichments: {address_updates}")
