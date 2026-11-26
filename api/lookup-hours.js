// Vercel Serverless Function: Venue Opening Hours Auto-Lookup
// Priority: 1. Google Maps Places API -> 2. Gemini Google Search & Maps Grounding -> 3. OpenStreetMap + Venue Website JSON-LD/HTML

const DAY_CODES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const ORDERED_WEEK = [1, 2, 3, 4, 5, 6, 0]; // Mon -> Sun

const CITY_DEFAULT_CENTERS = {
  warszawa: [52.2297, 21.0122],
  krakow: [50.0647, 19.9450],
  gdansk: [54.3520, 18.6466],
  wroclaw: [51.1079, 17.0385],
  poznan: [52.4064, 16.9252],
  lodz: [51.7592, 19.4560],
  katowice: [50.2649, 19.0238],
  szczecin: [53.4285, 14.5528],
  lublin: [51.2465, 22.5684],
  bydgoszcz: [53.1235, 18.0084]
};

const DAY_TOKEN_PATTERNS = [
  { idx: 1, re: /^(?:poniedzial(?:ek|ki|ku)?|pon|pn|mo|mon|monday)$/ },
  { idx: 2, re: /^(?:wtore?k[iu]?|wto|wt|tu|tue|tues|tuesday)$/ },
  { idx: 3, re: /^(?:srod[aye]?|sro|sr|we|wed|wednesday)$/ },
  { idx: 4, re: /^(?:czwarte?k[iu]?|czw|cz|th|thu|thur|thurs|thursday)$/ },
  { idx: 5, re: /^(?:piat(?:ek|ki|ku)?|pia|pt|fr|fri|friday)$/ },
  { idx: 6, re: /^(?:sobot[aye]?|sob|sb|sa|sat|saturday)$/ },
  { idx: 0, re: /^(?:niedziel[aei]?|niedz|ndz|nd|nie|su|sun|sunday)$/ }
];

const DAY_KEYWORD_ALTERNATION = "(?:poniedzia[łl](?:ek|ku|ki)?|pon|pn|wtore?k[iu]?|wto|wt|[sś]rod[ayę]?|[sś]ro|[sś]r|czwarte?k[iu]?|czw|cz|pi[aą]t(?:ek|ku|ki)?|pia|pt|sobot[ayę]?|sob|sb|niedziel[aęi]?|niedz|ndz|nd|nie|monday|mon|mo|tuesday|tues|tue|tu|wednesday|wed|we|thursday|thurs|thur|th|friday|fri|fr|saturday|sat|sa|sunday|sun|su|codziennie|daily|weekend)";

let cachedHoursFlashModels = null;
let cachedHoursModelsAt = 0;
const MODEL_DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;

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

function matchSingleDayToken(token) {
  const norm = normalizeTextForMatch(token);
  if (!norm) return null;
  for (const item of DAY_TOKEN_PATTERNS) {
    if (item.re.test(norm)) return item.idx;
  }
  return null;
}

function expandDaySpec(specRaw) {
  const normSpec = normalizeTextForMatch(
    String(specRaw || "").replace(/[–—−]/g, " - ").replace(/,/g, " , ")
  );
  if (!normSpec) return [];
  if (/\b(?:codziennie|daily|caly tydzien)\b/.test(normSpec)) {
    return [...ORDERED_WEEK];
  }
  if (/\bweekend\b/.test(normSpec)) {
    return [6, 0];
  }

  const dashNormalized = String(specRaw || "")
    .replace(/[łŁ]/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[–—−]/g, "-");

  const result = [];
  const commaParts = dashNormalized.split(/[,&+/]+/);
  for (const part of commaParts) {
    const cleanedPart = part.trim();
    if (!cleanedPart) continue;
    const rangeParts = cleanedPart.split(/\s*(?:-|\bdo\b|\bto\b)\s*/).filter(Boolean);
    if (rangeParts.length === 2) {
      const startDay = matchSingleDayToken(rangeParts[0]);
      const endDay = matchSingleDayToken(rangeParts[1]);
      if (startDay !== null && endDay !== null) {
        const startPos = ORDERED_WEEK.indexOf(startDay);
        const endPos = ORDERED_WEEK.indexOf(endDay);
        if (startPos !== -1 && endPos !== -1) {
          let i = startPos;
          for (let guard = 0; guard < 7; guard++) {
            result.push(ORDERED_WEEK[i]);
            if (i === endPos) break;
            i = (i + 1) % 7;
          }
          continue;
        }
      }
    }
    const single = matchSingleDayToken(cleanedPart);
    if (single !== null) {
      result.push(single);
    }
  }
  return [...new Set(result)];
}

function isValidTimePair(h, m, allow24 = true) {
  const hi = parseInt(h, 10);
  const mi = parseInt(m, 10);
  if (Number.isNaN(hi) || Number.isNaN(mi) || mi < 0 || mi > 59 || hi < 0) return false;
  if (hi === 24) return allow24 && mi === 0;
  return hi <= 23;
}

function extractTimeRangesFromTail(tailRaw) {
  const tail = String(tailRaw || "").trim();
  if (!tail) return null;

  if (/\b(?:zamkni[eę]t[eya]?|nieczynn[eya]?|closed|off)\b/i.test(tail)) {
    return "off";
  }
  if (/\b(?:24\/7|24\s*h|ca[łl]odobow[eya]?|ca[łl][aą]\s+dob[eę]|open\s*24\s*hours?)\b/i.test(tail)) {
    return "00:00-24:00";
  }

  const normalizedTail = tail
    .replace(/[–—−]/g, "-")
    .replace(/(\b\d{1,2})\s*h\s*(\d{2})\b/gi, "$1:$2");

  const ranges = [];
  const rangeRegex = /\b(\d{1,2})[:.](\d{2})\s*(?:-|do|to)\s*(\d{1,2})[:.](\d{2})\b/gi;
  let m;
  while ((m = rangeRegex.exec(normalizedTail)) !== null) {
    if (isValidTimePair(m[1], m[2], false) && isValidTimePair(m[3], m[4], true)) {
      ranges.push(`${pad2(parseInt(m[1], 10))}:${m[2]}-${pad2(parseInt(m[3], 10))}:${m[4]}`);
    }
  }
  if (ranges.length > 0) {
    return ranges.join(",");
  }

  const openOnlyMatch = normalizedTail.match(/(?:\bod\s+)?(\d{1,2})[:.](\d{2})\s*\+/i)
    || normalizedTail.match(/\bod\s+(\d{1,2})[:.](\d{2})\b/i);
  if (openOnlyMatch && isValidTimePair(openOnlyMatch[1], openOnlyMatch[2], false)) {
    return `${pad2(parseInt(openOnlyMatch[1], 10))}:${openOnlyMatch[2]}+`;
  }

  return null;
}

function compressScheduleMapToOsm(byDay, includeMissingAsOff = false) {
  if (!byDay || byDay.size === 0) return null;

  if (includeMissingAsOff) {
    const values = new Set(byDay.values());
    if (byDay.size === 7 && values.size === 1) {
      const only = [...values][0];
      if (only === "00:00-24:00") return "24/7";
      if (only !== "off" && !only.includes(",")) {
        return only.includes("+") ? only : only.replace("-", " - ");
      }
    }
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
    const parts = groups.map(g => {
      const first = DAY_CODES[g.days[0]];
      const end = DAY_CODES[g.days[g.days.length - 1]];
      const label = g.days.length === 1 ? first : `${first}-${end}`;
      return g.range === "off" ? `${label} off` : `${label} ${g.range}`;
    });
    const out = parts.join("; ");
    return out.length <= 220 ? out : null;
  }

  if (byDay.size === 7) {
    const values = new Set(byDay.values());
    if (values.size === 1) {
      const only = [...values][0];
      if (only === "00:00-24:00") return "24/7";
      if (only === "off") return null;
      if (!only.includes(",")) {
        return only.includes("+") ? only : only.replace("-", " - ");
      }
    }
  }

  const groups = [];
  for (const dayIdx of ORDERED_WEEK) {
    if (!byDay.has(dayIdx)) continue;
    const range = byDay.get(dayIdx);
    const prevIdx = groups.length > 0 ? groups[groups.length - 1].days[groups[groups.length - 1].days.length - 1] : null;
    const curOrder = ORDERED_WEEK.indexOf(dayIdx);
    const prevOrder = prevIdx !== null ? ORDERED_WEEK.indexOf(prevIdx) : -1;
    const isContiguous = prevIdx !== null && curOrder === prevOrder + 1;
    if (isContiguous && groups[groups.length - 1].range === range) {
      groups[groups.length - 1].days.push(dayIdx);
    } else {
      groups.push({ days: [dayIdx], range });
    }
  }

  if (groups.length === 0 || groups.every(g => g.range === "off")) return null;

  const parts = groups.map(g => {
    const first = DAY_CODES[g.days[0]];
    const end = DAY_CODES[g.days[g.days.length - 1]];
    const label = g.days.length === 1 ? first : `${first}-${end}`;
    return g.range === "off" ? `${label} off` : `${label} ${g.range}`;
  });
  const out = parts.join("; ");
  return out.length <= 220 ? out : null;
}

function parseFlexibleHoursToOsm(raw) {
  if (!raw || typeof raw !== "string") return null;

  let text = raw
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^[ \t]*[•*-]\s+/gm, "")
    .replace(/^\s*(godziny otwarcia|opening hours|hours|godziny)\s*:\s*/gim, "")
    .trim();

  if (!text) return null;

  const looksLikeRefusal = /(nie uda[łl]o|brak danych|brak informacji|nie znaleziono|nie jestem w stanie|nie mam dost[eę]pu|przykro mi|niestety\s+nie|unable to find|no opening hours|unavailable)/i.test(text);
  if (/^\s*brak\s*[.!]?\s*$/i.test(text)) return null;

  const rawLines = text.split(/[\r\n;]+/).map(s => s.trim()).filter(Boolean);
  const inlineSplitRe = new RegExp(`,\\s*(?=${DAY_KEYWORD_ALTERNATION}\\b)`, "i");
  const segments = [];
  for (const line of rawLines) {
    const subParts = line.split(inlineSplitRe).map(s => s.trim()).filter(Boolean);
    segments.push(...subParts);
  }

  const byDay = new Map();
  const leadingDaySpecRe = new RegExp(
    `^((?:${DAY_KEYWORD_ALTERNATION}(?:\\s*(?:-|–|—|,|&|\\+|\\/|\\bdo\\b|\\bto\\b)\\s*${DAY_KEYWORD_ALTERNATION})*))\\s*[:\\-–]?\\s+(.+)$`,
    "i"
  );

  for (const seg of segments) {
    const m = seg.match(leadingDaySpecRe);
    if (!m) continue;
    const daySpec = m[1];
    const tail = m[2];
    const days = expandDaySpec(daySpec);
    const parsedRange = extractTimeRangesFromTail(tail);
    if (days.length > 0 && parsedRange) {
      for (const d of days) {
        byDay.set(d, parsedRange);
      }
    }
  }

  if (byDay.size > 0) {
    const compressed = compressScheduleMapToOsm(byDay, false);
    if (compressed) return compressed;
  }

  if (looksLikeRefusal) return null;

  if (/\b(?:24\/7|24\s*h|ca[łl]odobow[eya]?|ca[łl][aą]\s+dob[eę]|open\s*24\s*hours?)\b/i.test(text)) {
    return "24/7";
  }

  const flatSingle = text.replace(/\s+/g, " ").trim();
  if (flatSingle.length <= 220) {
    const tailRange = extractTimeRangesFromTail(flatSingle);
    if (tailRange && tailRange !== "off") {
      if (tailRange === "00:00-24:00") return "24/7";
      if (!tailRange.includes(",") && !tailRange.includes("+")) {
        return tailRange.replace("-", " - ");
      }
      return tailRange;
    }
  }

  return null;
}

function sanitizeHoursString(raw) {
  return parseFlexibleHoursToOsm(raw);
}

function formatGooglePeriodsToOsm(periods = []) {
  if (!Array.isArray(periods) || periods.length === 0) return null;

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

  return compressScheduleMapToOsm(byDay, true);
}

function normalizeSchemaTime(t) {
  if (!t || typeof t !== "string") return null;
  const m = t.trim().match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?$/);
  if (!m) return null;
  if (!isValidTimePair(m[1], m[2], true)) return null;
  return `${pad2(parseInt(m[1], 10))}:${m[2]}`;
}

function parseOpeningHoursSpecificationList(specs) {
  const arr = Array.isArray(specs) ? specs : [specs];
  const byDay = new Map();
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const opens = normalizeSchemaTime(item.opens);
    const closes = normalizeSchemaTime(item.closes);
    if (!opens || !closes) continue;
    const range = `${opens}-${closes}`;
    const rawDays = Array.isArray(item.dayOfWeek) ? item.dayOfWeek : [item.dayOfWeek];
    for (const rawD of rawDays) {
      if (!rawD) continue;
      const tailToken = String(rawD).split("/").pop().trim();
      const days = expandDaySpec(tailToken);
      for (const d of days) {
        if (byDay.has(d)) {
          const prev = byDay.get(d);
          if (!prev.includes(range)) {
            byDay.set(d, `${prev},${range}`);
          }
        } else {
          byDay.set(d, range);
        }
      }
    }
  }
  return compressScheduleMapToOsm(byDay, false);
}

function collectJsonLdNodes(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectJsonLdNodes(item, out);
    return out;
  }
  out.push(node);
  if (Array.isArray(node["@graph"])) {
    collectJsonLdNodes(node["@graph"], out);
  }
  return out;
}

function extractHoursFromHtml(html) {
  if (!html || typeof html !== "string") return null;

  // 1. Check Schema.org JSON-LD blocks first
  const ldRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = ldRegex.exec(html)) !== null) {
    const rawJson = (match[1] || "").trim();
    if (!rawJson) continue;
    try {
      const parsed = JSON.parse(rawJson);
      const nodes = collectJsonLdNodes(parsed);
      for (const node of nodes) {
        if (node.openingHours) {
          const rawOh = Array.isArray(node.openingHours)
            ? node.openingHours.join("\n")
            : String(node.openingHours);
          const osm = parseFlexibleHoursToOsm(rawOh);
          if (osm) return osm;
        }
        if (node.openingHoursSpecification) {
          const osmSpec = parseOpeningHoursSpecificationList(node.openingHoursSpecification);
          if (osmSpec) return osmSpec;
        }
      }
    } catch (e) {
      // Ignore malformed JSON-LD block and try next
    }
  }

  // 2. Plain text scan around "godziny otwarcia" / "opening hours" / "czynne"
  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&ndash;|&mdash;/gi, "-")
    .replace(/[ \t]+/g, " ");

  const kwRegex = /\b(?:godziny\s+otwarcia|godziny\s+pracy|opening\s+hours|czynne|otwarte)\b/gi;
  let kwMatch;
  while ((kwMatch = kwRegex.exec(plainText)) !== null) {
    const startIdx = kwMatch.index + kwMatch[0].length;
    const windowSlice = plainText.slice(startIdx, startIdx + 300).replace(/^[\s:–—-]+/, "");
    const candidateLines = windowSlice.split("\n").map(l => l.trim()).filter(Boolean).slice(0, 8).join("\n");
    const parsed = parseFlexibleHoursToOsm(candidateLines);
    if (parsed) return parsed;
  }

  return null;
}

async function lookupWebsiteOpeningHours(websiteUrl, diagnostics = []) {
  if (!websiteUrl || typeof websiteUrl !== "string") return null;
  let cleanUrl = websiteUrl.trim();
  if (!/^https?:\/\//i.test(cleanUrl)) return null;

  try {
    const parsedUrl = new URL(cleanUrl);
    const host = (parsedUrl.hostname || "").toLowerCase();
    if (!host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
      return null;
    }
    if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) {
      return null;
    }
  } catch (e) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(cleanUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "User-Agent": "poilepiwko.pl/1.0 (https://www.poilepiwko.pl)"
      }
    });
    clearTimeout(timer);
    if (!res.ok) {
      diagnostics.push(`website:${res.status}`);
      return null;
    }
    const rawHtml = (await res.text()).slice(0, 300 * 1024);
    const extracted = extractHoursFromHtml(rawHtml);
    diagnostics.push(`website:200:${extracted ? "found" : "miss"}`);
    return extracted;
  } catch (err) {
    clearTimeout(timer);
    diagnostics.push(`website:${err.name === "AbortError" ? "timeout" : "err"}`);
    return null;
  }
}

function getCityDefaultCoords(city, lat, lng) {
  if (typeof lat === "number" && typeof lng === "number" && !Number.isNaN(lat) && !Number.isNaN(lng)) {
    return { latitude: lat, longitude: lng };
  }
  const key = normalizeTextForMatch(city);
  const hit = CITY_DEFAULT_CENTERS[key] || CITY_DEFAULT_CENTERS.warszawa;
  return { latitude: hit[0], longitude: hit[1] };
}

function extractPlaceHours(place) {
  if (!place) return null;
  const reg = place.regularOpeningHours;
  const cur = place.currentOpeningHours;
  const fromRegPeriods = reg && reg.periods ? formatGooglePeriodsToOsm(reg.periods) : null;
  if (fromRegPeriods) return fromRegPeriods;

  const fromCurPeriods = cur && cur.periods ? formatGooglePeriodsToOsm(cur.periods) : null;
  if (fromCurPeriods) return fromCurPeriods;

  const regDesc = reg && Array.isArray(reg.weekdayDescriptions) ? reg.weekdayDescriptions.join("\n") : null;
  const fromRegDesc = regDesc ? parseFlexibleHoursToOsm(regDesc) : null;
  if (fromRegDesc) return fromRegDesc;

  const curDesc = cur && Array.isArray(cur.weekdayDescriptions) ? cur.weekdayDescriptions.join("\n") : null;
  const fromCurDesc = curDesc ? parseFlexibleHoursToOsm(curDesc) : null;
  if (fromCurDesc) return fromCurDesc;

  return null;
}

async function lookupLegacyGooglePlaces(apiKey, textQuery, diagnostics) {
  try {
    const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(textQuery)}&language=pl&key=${encodeURIComponent(apiKey)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    const res = await fetch(searchUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) {
      diagnostics.push(`places-legacy-search:${res.status}`);
      return null;
    }
    const json = await res.json();
    const top = json && Array.isArray(json.results) ? json.results[0] : null;
    if (!top || !top.place_id) {
      diagnostics.push(`places-legacy:${(json && json.status) || "empty"}`);
      return null;
    }

    const detUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(top.place_id)}&fields=name,geometry,opening_hours&language=pl&key=${encodeURIComponent(apiKey)}`;
    const detController = new AbortController();
    const detTimer = setTimeout(() => detController.abort(), 4500);
    const detRes = await fetch(detUrl, { signal: detController.signal });
    clearTimeout(detTimer);
    if (!detRes.ok) {
      diagnostics.push(`places-legacy-details:${detRes.status}`);
      return null;
    }
    const detJson = await detRes.json();
    const det = detJson && detJson.result;
    if (!det) return null;

    const oh = det.opening_hours || {};
    let hours = null;
    if (Array.isArray(oh.periods) && oh.periods.length > 0) {
      hours = formatGooglePeriodsToOsm(oh.periods);
    }
    if (!hours && Array.isArray(oh.weekday_text) && oh.weekday_text.length > 0) {
      hours = parseFlexibleHoursToOsm(oh.weekday_text.join("\n"));
    }
    const loc = (det.geometry && det.geometry.location) || (top.geometry && top.geometry.location) || {};
    diagnostics.push(`places-legacy:200:${hours ? "found" : "no-hours"}`);
    return {
      found: Boolean(hours),
      hours: hours || null,
      source: hours ? "google-maps" : null,
      latitude: typeof loc.lat === "number" ? loc.lat : null,
      longitude: typeof loc.lng === "number" ? loc.lng : null,
      matchedName: det.name || top.name || null
    };
  } catch (err) {
    diagnostics.push(`places-legacy:${err.name === "AbortError" ? "timeout" : "err"}`);
    return null;
  }
}

async function lookupGooglePlaces(name, address, city, diagnostics = []) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
    || process.env.GOOGLE_PLACES_API_KEY
    || process.env.GOOGLE_API_KEY
    || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    diagnostics.push("places:no-key");
    return null;
  }

  const textQuery = [name, address, city, "Polska"].filter(Boolean).join(", ");
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.regularOpeningHours,places.currentOpeningHours"
      },
      body: JSON.stringify({
        textQuery,
        languageCode: "pl",
        maxResultCount: 3
      })
    });
    clearTimeout(timer);

    if (!res.ok) {
      diagnostics.push(`places-new:${res.status}`);
      return await lookupLegacyGooglePlaces(apiKey, textQuery, diagnostics);
    }

    const json = await res.json();
    const places = Array.isArray(json && json.places) ? json.places : [];
    if (places.length === 0) {
      diagnostics.push("places-new:200:empty");
      return null;
    }

    const normTarget = normalizeTextForMatch(name);
    let bestPlace = places[0];
    let bestHours = extractPlaceHours(places[0]);
    let bestScore = -1;

    for (const p of places) {
      const pName = normalizeTextForMatch((p.displayName && p.displayName.text) || "");
      const pHours = extractPlaceHours(p);
      let score = 0;
      if (pHours) score += 10;
      if (normTarget && pName) {
        if (pName === normTarget) score += 20;
        else if (pName.includes(normTarget) || normTarget.includes(pName)) score += 12;
      }
      if (score > bestScore) {
        bestScore = score;
        bestPlace = p;
        bestHours = pHours;
      }
    }

    const loc = bestPlace.location || {};
    diagnostics.push(`places-new:200:${bestHours ? "found" : "no-hours"}`);

    if (!bestHours && (typeof loc.latitude !== "number" || typeof loc.longitude !== "number")) {
      return null;
    }

    return {
      found: Boolean(bestHours),
      hours: bestHours || null,
      source: bestHours ? "google-maps" : null,
      latitude: typeof loc.latitude === "number" ? loc.latitude : null,
      longitude: typeof loc.longitude === "number" ? loc.longitude : null,
      matchedName: (bestPlace.displayName && bestPlace.displayName.text) || null
    };
  } catch (err) {
    diagnostics.push(`places-new:${err.name === "AbortError" ? "timeout" : "err"}`);
    return null;
  }
}

async function discoverFlashModelsForHours(geminiKey, excludeSet = new Set()) {
  const now = Date.now();
  if (cachedHoursFlashModels && (now - cachedHoursModelsAt) < MODEL_DISCOVERY_TTL_MS) {
    return cachedHoursFlashModels.filter(id => !excludeSet.has(id)).slice(0, 4);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const candidates = [];
    for (const item of (data && data.models) || []) {
      const id = String((item && item.name) || "").replace(/^models\//, "").trim();
      if (!id) continue;
      if (Array.isArray(item.supportedGenerationMethods) && !item.supportedGenerationMethods.includes("generateContent")) {
        continue;
      }
      if (!/flash/i.test(id)) continue;
      if (/(tts|audio|image|embedding|live|robotics|computer-use|customtools|-latest$)/i.test(id)) continue;
      const verMatch = id.match(/gemini-(\d+)(?:\.(\d+))?/i);
      const major = verMatch ? parseInt(verMatch[1], 10) : 0;
      const minor = (verMatch && verMatch[2]) ? parseInt(verMatch[2], 10) : 0;
      const scoreVer = major * 100 + minor;
      const isLite = /flash-lite/i.test(id) ? 1 : 0;
      const isStable = /(preview|exp)/i.test(id) ? 0 : 1;
      candidates.push({ id, scoreVer, isLite, isStable });
    }
    candidates.sort((a, b) => (b.scoreVer - a.scoreVer) || (b.isLite - a.isLite) || (b.isStable - a.isStable));
    const ranked = candidates.map(c => c.id);
    if (ranked.length > 0) {
      cachedHoursFlashModels = ranked;
      cachedHoursModelsAt = now;
    }
    return ranked.filter(id => !excludeSet.has(id)).slice(0, 4);
  } catch (e) {
    return [];
  }
}

async function invokeGeminiGroundingCall({
  model,
  geminiKey,
  toolType,
  prompt,
  refCoords,
  timeoutMs = 7000,
  diagnostics = []
}) {
  const label = toolType === "googleMaps" ? "gemini-maps" : "gemini-search";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      tools: [toolType === "googleMaps" ? { googleMaps: {} } : { googleSearch: {} }],
      generationConfig: { temperature: 0.0 }
    };
    if (toolType === "googleMaps" && refCoords && typeof refCoords.latitude === "number" && typeof refCoords.longitude === "number") {
      body.toolConfig = {
        retrievalConfig: {
          latLng: {
            latitude: refCoords.latitude,
            longitude: refCoords.longitude
          }
        }
      };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    clearTimeout(timer);

    if (!res.ok) {
      let shortMsg = "";
      try {
        const errText = await res.text();
        try {
          const errJson = JSON.parse(errText);
          shortMsg = String((errJson && errJson.error && errJson.error.message) || errText);
        } catch (e) {
          shortMsg = errText;
        }
      } catch (e) {}
      shortMsg = shortMsg.replace(/[\r\n]+/g, " ").trim().slice(0, 70);
      diagnostics.push(`${label}(${model}):${res.status}${shortMsg ? ":" + shortMsg : ""}`);
      return { httpStatus: res.status, hours: null, rawAnswer: "" };
    }

    const data = await res.json();
    const cand = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
    const answer = cand && cand.content && Array.isArray(cand.content.parts)
      ? cand.content.parts.map(p => p.text || "").join("\n").trim()
      : "";

    let mapsUrl = null;
    const chunks = cand && cand.groundingMetadata && Array.isArray(cand.groundingMetadata.groundingChunks)
      ? cand.groundingMetadata.groundingChunks
      : [];
    for (const ch of chunks) {
      if (ch && ch.maps && ch.maps.uri) {
        mapsUrl = ch.maps.uri;
        break;
      }
    }

    const parsedHours = parseFlexibleHoursToOsm(answer);
    if (!parsedHours) {
      const snippet = answer.replace(/[\r\n]+/g, " ").trim().slice(0, 50);
      diagnostics.push(`${label}(${model}):200:miss(${snippet})`);
      return { httpStatus: 200, hours: null, mapsUrl, rawAnswer: answer };
    }

    diagnostics.push(`${label}(${model}):200:found`);
    return {
      httpStatus: 200,
      hours: parsedHours,
      source: toolType === "googleMaps" ? "google-maps-ai" : "google-search-ai",
      modelUsed: model,
      mapsUrl,
      rawAnswer: answer
    };
  } catch (err) {
    clearTimeout(timer);
    diagnostics.push(`${label}(${model}):${err.name === "AbortError" ? "timeout" : "err"}`);
    return { httpStatus: 0, hours: null, rawAnswer: "" };
  }
}

async function lookupViaGeminiGoogle(name, address, city, lat, lng, diagnostics = []) {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!geminiKey) {
    diagnostics.push("gemini:no-key");
    return null;
  }

  const refCoords = getCityDefaultCoords(city, lat, lng);
  const promptSearch = `Wyszukaj w Google i wizytówce Google Maps oficjalne godziny otwarcia lokalu "${name}", adres "${address || ""}", miasto "${city || "Warszawa"}, Polska".
Zwróć godziny w czystym formacie (bez komentarzy):
- Jeśli codziennie te same godziny: 16:00 - 02:00
- Jeśli różne w dni tygodnia: Mo-Th 12:00-22:00; Fr-Sa 12:00-23:00; Su 14:00-21:00 (lub Pn..Nd)
- Jeśli całodobowy: 24/7
- Jeśli nie można ustalić: BRAK`;

  const promptMaps = `Znajdź na Google Maps dokładne godziny otwarcia lokalu "${name}" pod adresem "${address || ""}" (${city || "Warszawa"}, Polska).
Podaj godziny otwarcia w najkrótszym możliwym formacie (zero zbędnego opisu):
- Codziennie tak samo: HH:MM - HH:MM (np. 16:00 - 02:00)
- Różne dni: osobne linie dla dni tygodnia (np. Pn-Czw 12:00-22:00; Pt-Sb 12:00-23:00; Nd nieczynne) lub pełna lista Pn-Nd
- Całodobowy: 24/7
- Jeśli nie ma żadnych informacji o godzinach otwarcia: BRAK`;

  const seed = [
    process.env.GEMINI_MODEL || null,
    "gemini-flash-lite-latest"
  ].filter(Boolean);
  const seedSet = new Set(seed);
  const discovered = await discoverFlashModelsForHours(geminiKey, seedSet);
  const candidates = [...new Set([
    ...seed,
    ...discovered,
    "gemini-flash-latest"
  ])].slice(0, 4);

  for (const model of candidates) {
    const searchRes = await invokeGeminiGroundingCall({
      model,
      geminiKey,
      toolType: "googleSearch",
      prompt: promptSearch,
      refCoords,
      timeoutMs: 7000,
      diagnostics
    });

    if (searchRes.hours) {
      return {
        found: true,
        hours: searchRes.hours,
        source: searchRes.source,
        modelUsed: model,
        latitude: null,
        longitude: null,
        matchedName: name,
        mapsUrl: searchRes.mapsUrl || null
      };
    }

    if (searchRes.httpStatus === 200) {
      const mapsRes = await invokeGeminiGroundingCall({
        model,
        geminiKey,
        toolType: "googleMaps",
        prompt: promptMaps,
        refCoords,
        timeoutMs: 6500,
        diagnostics
      });
      if (mapsRes.hours) {
        return {
          found: true,
          hours: mapsRes.hours,
          source: mapsRes.source,
          modelUsed: model,
          latitude: null,
          longitude: null,
          matchedName: name,
          mapsUrl: mapsRes.mapsUrl || null
        };
      }
      // Clean 200 BRAK from a working model -> no need to burn quota on other models
      if (/brak/i.test(searchRes.rawAnswer || "") && mapsRes.httpStatus === 200 && /brak/i.test(mapsRes.rawAnswer || "")) {
        break;
      }
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

async function lookupOverpassPoiData(lat, lng, targetName) {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const q = `[out:json][timeout:4];(node["name"](around:180,${lat},${lng});way["name"](around:180,${lat},${lng}););out tags center 30;`;
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

    let bestHoursMatch = null;
    let bestWebsiteMatch = null;
    for (const el of elements) {
      const tags = el.tags || {};
      const elName = normalizeTextForMatch(tags.name || "");
      const nameMatches = !normTarget || (elName && (elName.includes(normTarget) || normTarget.includes(elName)));
      if (!nameMatches) continue;
      if (tags.opening_hours && !bestHoursMatch) {
        bestHoursMatch = el;
      }
      if ((tags.website || tags["contact:website"]) && !bestWebsiteMatch) {
        bestWebsiteMatch = el;
      }
      if (bestHoursMatch && bestWebsiteMatch) break;
    }

    if (!bestHoursMatch && elements.length === 1 && elements[0].tags && elements[0].tags.opening_hours
      && /pub|bar|biergarten|restaurant|cafe|nightclub/.test(elements[0].tags.amenity || "")) {
      bestHoursMatch = elements[0];
    }

    const picked = bestHoursMatch || bestWebsiteMatch;
    if (!picked || !picked.tags) return null;

    return {
      hours: picked.tags.opening_hours
        ? (parseFlexibleHoursToOsm(picked.tags.opening_hours) || picked.tags.opening_hours.trim())
        : null,
      website: picked.tags.website || picked.tags["contact:website"] || null,
      matchedName: picked.tags.name || null,
      latitude: typeof picked.lat === "number" ? picked.lat : (picked.center ? picked.center.lat : null),
      longitude: typeof picked.lon === "number" ? picked.lon : (picked.center ? picked.center.lon : null)
    };
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
  let websiteUrl = null;
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
      const ex = hit.extratags || {};
      const oh = ex.opening_hours;
      const ws = ex.website || ex["contact:website"] || null;
      const hitName = normalizeTextForMatch(hit.name || (hit.display_name || "").split(",")[0]);
      const nameMatches = !normTarget || !hitName || hitName.includes(normTarget) || normTarget.includes(hitName);
      if (nameMatches) {
        if (ws && !websiteUrl) websiteUrl = ws;
        if (oh) {
          osmHours = parseFlexibleHoursToOsm(oh) || oh.trim();
          matchedName = hit.name || null;
          break;
        }
      }
    }
    if (osmHours) break;
  }

  if (!osmHours && foundLat !== null && foundLng !== null) {
    const ov = await lookupOverpassPoiData(foundLat, foundLng, name);
    if (ov) {
      if (ov.hours) osmHours = ov.hours;
      if (ov.website && !websiteUrl) websiteUrl = ov.website;
      if (ov.matchedName) matchedName = ov.matchedName;
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
    websiteUrl,
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
    const includeDebug = body.debug === true;
    const diagnostics = [];

    if (!name && !address) {
      return res.status(400).json({ error: "Podaj nazwę lub adres lokalu." });
    }

    let finalLat = lat;
    let finalLng = lng;
    let matchedName = null;

    // 1. Google Maps Places API (freshest opening hours if key configured)
    const googleRes = await lookupGooglePlaces(name, address, city, diagnostics);
    if (googleRes) {
      if (typeof googleRes.latitude === "number" && typeof googleRes.longitude === "number") {
        finalLat = googleRes.latitude;
        finalLng = googleRes.longitude;
      }
      if (googleRes.found && googleRes.hours) {
        const payload = {
          success: true,
          found: true,
          hours: googleRes.hours,
          source: googleRes.source,
          latitude: finalLat,
          longitude: finalLng,
          matchedName: googleRes.matchedName
        };
        if (includeDebug) payload.debug = diagnostics;
        return res.status(200).json(payload);
      }
      matchedName = googleRes.matchedName;
    }

    // Run OSM lookup in parallel with sequential Gemini Google grounding
    const osmPromise = lookupOpenStreetMap(name, address, city, finalLat, finalLng).catch(() => ({
      found: false,
      hours: null,
      source: null,
      websiteUrl: null,
      latitude: finalLat,
      longitude: finalLng,
      matchedName: null
    }));

    const geminiGoogleRes = await lookupViaGeminiGoogle(name, address, city, finalLat, finalLng, diagnostics);
    const osmRes = await osmPromise;

    if (osmRes && typeof osmRes.latitude === "number" && typeof osmRes.longitude === "number") {
      if (finalLat === null || finalLng === null) {
        finalLat = osmRes.latitude;
        finalLng = osmRes.longitude;
      }
    }

    if (geminiGoogleRes && geminiGoogleRes.found && geminiGoogleRes.hours) {
      const payload = {
        success: true,
        found: true,
        hours: geminiGoogleRes.hours,
        source: geminiGoogleRes.source,
        modelUsed: geminiGoogleRes.modelUsed || null,
        latitude: finalLat,
        longitude: finalLng,
        matchedName: matchedName || (osmRes && osmRes.matchedName) || geminiGoogleRes.matchedName
      };
      if (geminiGoogleRes.mapsUrl) payload.mapsUrl = geminiGoogleRes.mapsUrl;
      if (includeDebug) payload.debug = diagnostics;
      return res.status(200).json(payload);
    }

    if (osmRes && osmRes.found && osmRes.hours) {
      diagnostics.push("osm:found");
      const payload = {
        success: true,
        found: true,
        hours: osmRes.hours,
        source: osmRes.source,
        latitude: finalLat,
        longitude: finalLng,
        matchedName: osmRes.matchedName || matchedName
      };
      if (includeDebug) payload.debug = diagnostics;
      return res.status(200).json(payload);
    }

    // 3b. If OSM has no hours tag but provides venue website URL, scrape JSON-LD/HTML hours
    if (osmRes && osmRes.websiteUrl) {
      const websiteHours = await lookupWebsiteOpeningHours(osmRes.websiteUrl, diagnostics);
      if (websiteHours) {
        const payload = {
          success: true,
          found: true,
          hours: websiteHours,
          source: "venue-website",
          latitude: finalLat,
          longitude: finalLng,
          matchedName: osmRes.matchedName || matchedName
        };
        if (includeDebug) payload.debug = diagnostics;
        return res.status(200).json(payload);
      }
    }

    diagnostics.push("osm:miss");
    const fallbackPayload = {
      success: true,
      found: false,
      hours: null,
      source: null,
      latitude: finalLat,
      longitude: finalLng,
      matchedName: (osmRes && osmRes.matchedName) || matchedName
    };
    if (includeDebug) fallbackPayload.debug = diagnostics;
    return res.status(200).json(fallbackPayload);
  } catch (err) {
    console.error("Lookup hours API error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.formatGooglePeriodsToOsm = formatGooglePeriodsToOsm;
module.exports.parseFlexibleHoursToOsm = parseFlexibleHoursToOsm;
module.exports.extractHoursFromHtml = extractHoursFromHtml;
module.exports.sanitizeHoursString = sanitizeHoursString;
