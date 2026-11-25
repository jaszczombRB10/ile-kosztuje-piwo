// Vercel Serverless Function: Venue Opening Hours Auto-Lookup
// Priority: 1. Google Maps Places API -> 2. Gemini Google Search Grounding -> 3. OpenStreetMap (Nominatim + Overpass)

const DAY_CODES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const ORDERED_WEEK = [1, 2, 3, 4, 5, 6, 0]; // Mon -> Sun

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizeTextForMatch(s) {
  return String(s || "")
    .replace(/[łŁ]/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeHoursString(raw) {
  if (!raw || typeof raw !== "string") return null;
  let cleaned = raw
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .replace(/^(godziny otwarcia|opening hours|hours)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length > 140) return null;
  if (/^(24\/7|24h|całodobow)/i.test(cleaned)) return "24/7";

  // Must contain at least one valid HH:MM-HH:MM range (or HH:MM+)
  const hasTimeRange = /\b([01]?\d|2[0-4]):[0-5]\d\s*(?:[-–]\s*([01]?\d|2[0-4]):[0-5]\d|\+)/.test(cleaned);
  if (!hasTimeRange) return null;

  // Reject conversational filler
  if (/(nie udało|brak danych|nie znaleziono|unknown|unavailable|przykro|niestety)/i.test(cleaned)) {
    return null;
  }
  return cleaned;
}

function formatGooglePeriodsToOsm(periods = []) {
  if (!Array.isArray(periods) || periods.length === 0) return null;

  // Google returns a single open period with no close for 24/7
  if (periods.length === 1 && periods[0].open && !periods[0].close) {
    return "24/7";
  }

  const byDay = new Map();
  for (const p of periods) {
    if (!p || !p.open || typeof p.open.day !== "number") continue;
    const oh = pad2(p.open.hour ?? 0);
    const om = pad2(p.open.minute ?? 0);
    let ch = "00";
    let cm = "00";
    if (p.close) {
      ch = pad2(p.close.hour ?? 0);
      cm = pad2(p.close.minute ?? 0);
    }
    const range = `${oh}:${om}-${ch}:${cm}`;
    if (byDay.has(p.open.day)) {
      byDay.set(p.open.day, `${byDay.get(p.open.day)},${range}`);
    } else {
      byDay.set(p.open.day, range);
    }
  }

  if (byDay.size === 0) return null;

  // If all 7 days exist and share identical hours, emit clean compact "HH:MM - HH:MM"
  const distinctRanges = new Set(byDay.values());
  if (byDay.size === 7 && distinctRanges.size === 1) {
    const single = [...distinctRanges][0];
    if (!single.includes(",")) {
      return single.replace("-", " - ");
    }
  }

  // Group contiguous Mon..Sun days that share identical schedules
  const groups = [];
  for (const dayIdx of ORDERED_WEEK) {
    const range = byDay.get(dayIdx) || "off";
    const last = groups[groups.length - 1];
    if (last && last.range === range) {
      last.days.push(dayIdx);
    } else {
      groups.push({ days: [dayIdx], range });
    }
  }

  // Filter out trailing/leading purely "off" days only if all days off (already impossible here)
  const parts = groups.map(g => {
    const first = DAY_CODES[g.days[0]];
    const end = DAY_CODES[g.days[g.days.length - 1]];
    const dayLabel = g.days.length === 1 ? first : `${first}-${end}`;
    return g.range === "off" ? `${dayLabel} off` : `${dayLabel} ${g.range}`;
  });

  return parts.join("; ");
}

async function lookupGooglePlaces(name, address, city) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return null;

  const textQuery = [name, address, city, "Polska"].filter(Boolean).join(", ");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.regularOpeningHours"
      },
      body: JSON.stringify({
        textQuery,
        languageCode: "pl",
        maxResultCount: 1
      })
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    const json = await res.json();
    const place = json && Array.isArray(json.places) ? json.places[0] : null;
    if (!place) return null;

    const periods = place.regularOpeningHours && place.regularOpeningHours.periods;
    const formattedHours = formatGooglePeriodsToOsm(periods);
    const loc = place.location || {};

    if (!formattedHours && (typeof loc.latitude !== "number" || typeof loc.longitude !== "number")) {
      return null;
    }

    return {
      found: Boolean(formattedHours),
      hours: formattedHours || null,
      source: formattedHours ? "google-maps" : null,
      latitude: typeof loc.latitude === "number" ? loc.latitude : null,
      longitude: typeof loc.longitude === "number" ? loc.longitude : null,
      matchedName: (place.displayName && place.displayName.text) || null
    };
  } catch (err) {
    console.warn("Google Places lookup note:", err.message);
    return null;
  }
}

async function lookupViaGeminiGoogleSearch(name, address, city) {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!geminiKey) return null;

  const models = [...new Set([
    process.env.GEMINI_MODEL || null,
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest"
  ].filter(Boolean))];

  const prompt = `Znajdź w Google Maps aktualne godziny otwarcia lokalu "${name}" pod adresem "${address || ""}" w mieście "${city || "Warszawa"}, Polska".
Zwróć WYŁĄCZNIE sam ciąg godzin w jednym z poniższych formatów (zero dodatkowych słów, bez markdown):
- Jeśli codziennie te same godziny: 16:00 - 02:00
- Jeśli różne w dni tygodnia: Mo-Th 16:00-23:00; Fr-Sa 16:00-02:00; Su 14:00-22:00
- Jeśli całodobowy: 24/7
- Jeśli nie masz pewności lub nie możesz znaleźć dokładnych godzin: BRAK`;

  for (const model of models) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.0 }
        })
      });
      clearTimeout(timer);
      if (!res.ok) continue;

      const data = await res.json();
      const answer = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join(" ").trim();
      const validHours = sanitizeHoursString(answer);
      if (validHours) {
        return {
          found: true,
          hours: validHours,
          source: "google-search-ai",
          latitude: null,
          longitude: null,
          matchedName: name
        };
      }
      // Model responded cleanly with BRAK -> no need to loop all fallbacks
      if (answer && /brak/i.test(answer)) return null;
    } catch (err) {
      console.warn(`Gemini Search hours (${model}) note:`, err.message);
    }
  }
  return null;
}

async function fetchNominatim(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&extratags=1&limit=3`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
        "User-Agent": "poilepiwko.pl/1.0 (https://www.poilepiwko.pl)"
      }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function lookupOverpassHours(lat, lng, targetName) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const q = `[out:json][timeout:4];(node["opening_hours"](around:160,${lat},${lng});way["opening_hours"](around:160,${lat},${lng}););out tags center 25;`;
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "data=" + encodeURIComponent(q)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const elements = Array.isArray(data && data.elements) ? data.elements : [];
    const normTarget = normalizeTextForMatch(targetName);

    let best = null;
    for (const el of elements) {
      const tags = el.tags || {};
      if (!tags.opening_hours) continue;
      const elName = normalizeTextForMatch(tags.name || "");
      if (normTarget && elName && (elName.includes(normTarget) || normTarget.includes(elName))) {
        best = el;
        break;
      }
    }

    // If no exact name match, only fallback if single nearby hospitality POI has opening_hours
    if (!best && elements.length === 1 && elements[0].tags && /pub|bar|biergarten|restaurant|cafe|nightclub/.test(elements[0].tags.amenity || "")) {
      best = elements[0];
    }

    if (best && best.tags && best.tags.opening_hours) {
      return {
        hours: sanitizeHoursString(best.tags.opening_hours) || best.tags.opening_hours.trim(),
        matchedName: best.tags.name || null,
        latitude: typeof best.lat === "number" ? best.lat : (best.center ? best.center.lat : null),
        longitude: typeof best.lon === "number" ? best.lon : (best.center ? best.center.lon : null)
      };
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function lookupOpenStreetMap(name, address, city, lat, lng) {
  let foundLat = typeof lat === "number" ? lat : null;
  let foundLng = typeof lng === "number" ? lng : null;
  let osmHours = null;
  let matchedName = null;

  const queries = [];
  if (name && address) queries.push(`${name}, ${address}, ${city || "Warszawa"}`);
  else if (name) queries.push(`${name}, ${city || "Warszawa"}`);
  if (address) queries.push(`${address}, ${city || "Warszawa"}`);

  const normTarget = normalizeTextForMatch(name);

  for (const q of queries) {
    const hits = await fetchNominatim(q);
    for (const hit of hits) {
      const hitLat = parseFloat(hit.lat);
      const hitLng = parseFloat(hit.lon);
      if (!Number.isNaN(hitLat) && !Number.isNaN(hitLng) && (foundLat === null || q.startsWith(name || ""))) {
        foundLat = hitLat;
        foundLng = hitLng;
      }
      const oh = hit.extratags && hit.extratags.opening_hours;
      const hitName = normalizeTextForMatch(hit.name || (hit.display_name || "").split(",")[0]);
      if (oh && (!normTarget || !hitName || hitName.includes(normTarget) || normTarget.includes(hitName))) {
        osmHours = sanitizeHoursString(oh) || oh.trim();
        matchedName = hit.name || null;
        break;
      }
    }
    if (osmHours) break;
  }

  if (!osmHours && foundLat !== null && foundLng !== null) {
    const ov = await lookupOverpassHours(foundLat, foundLng, name);
    if (ov && ov.hours) {
      osmHours = ov.hours;
      matchedName = ov.matchedName || matchedName;
      if (typeof ov.latitude === "number" && typeof ov.longitude === "number") {
        foundLat = ov.latitude;
        foundLng = ov.longitude;
      }
    }
  }

  return {
    found: Boolean(osmHours),
    hours: osmHours,
    source: osmHours ? "openstreetmap" : null,
    latitude: foundLat,
    longitude: foundLng,
    matchedName
  };
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    const address = String(body.address || "").trim();
    const city = String(body.city || "Warszawa").trim();
    const lat = typeof body.lat === "number" ? body.lat : null;
    const lng = typeof body.lng === "number" ? body.lng : null;

    if (!name && !address) {
      return res.status(400).json({ error: "Podaj nazwę lub adres lokalu." });
    }

    let finalLat = lat;
    let finalLng = lng;
    let matchedName = null;

    // 1. Google Maps Places API (freshest opening hours if key configured)
    const googleRes = await lookupGooglePlaces(name, address, city);
    if (googleRes) {
      if (typeof googleRes.latitude === "number" && typeof googleRes.longitude === "number") {
        finalLat = googleRes.latitude;
        finalLng = googleRes.longitude;
      }
      if (googleRes.found && googleRes.hours) {
        return res.status(200).json({
          success: true,
          found: true,
          hours: googleRes.hours,
          source: googleRes.source,
          latitude: finalLat,
          longitude: finalLng,
          matchedName: googleRes.matchedName
        });
      }
      matchedName = googleRes.matchedName;
    }

    // 2. Gemini with live Google Search Grounding (uses GEMINI_API_KEY)
    const geminiSearchRes = await lookupViaGeminiGoogleSearch(name, address, city);
    if (geminiSearchRes && geminiSearchRes.found && geminiSearchRes.hours) {
      // Also run Nominatim quickly if we still lack coordinates
      if (finalLat === null || finalLng === null) {
        const osmCoords = await lookupOpenStreetMap(name, address, city, finalLat, finalLng);
        if (osmCoords.latitude !== null) finalLat = osmCoords.latitude;
        if (osmCoords.longitude !== null) finalLng = osmCoords.longitude;
      }
      return res.status(200).json({
        success: true,
        found: true,
        hours: geminiSearchRes.hours,
        source: geminiSearchRes.source,
        latitude: finalLat,
        longitude: finalLng,
        matchedName: matchedName || geminiSearchRes.matchedName
      });
    }

    // 3. OpenStreetMap (Nominatim extratags + Overpass API) - 100% free without API keys
    const osmRes = await lookupOpenStreetMap(name, address, city, finalLat, finalLng);
    if (osmRes.latitude !== null) finalLat = osmRes.latitude;
    if (osmRes.longitude !== null) finalLng = osmRes.longitude;

    return res.status(200).json({
      success: true,
      found: osmRes.found,
      hours: osmRes.hours || null,
      source: osmRes.source,
      latitude: finalLat,
      longitude: finalLng,
      matchedName: osmRes.matchedName || matchedName
    });
  } catch (err) {
    console.error("Lookup hours API error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.formatGooglePeriodsToOsm = formatGooglePeriodsToOsm;
module.exports.sanitizeHoursString = sanitizeHoursString;
