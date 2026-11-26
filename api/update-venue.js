// Vercel Serverless Function: Update/insert venues and read/write proof photo reports in Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || "https://agsodpzkytdgicpmphxz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODcxODI3MywiZXhwIjoyMTA0Mjk0MjczfQ.nXVSigEdTUqxVcIOAic59j47lUNn_qI61NQRxs3Deho";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const META_PREFIX = "__poile_meta_v1__:";
const ALLOWED_AMENITIES = new Set([
  "dart", "bilard", "pilkarzyki", "planszowki", "kregle", "karaoke", "sport", "ogrodek"
]);

function sanitizeAmenities(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const key = String(item || "").trim().toLowerCase();
    if (ALLOWED_AMENITIES.has(key) && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

function getAdminHeaders(extra = {}) {
  return {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
    ...extra
  };
}

function encodeReportMeta(reportPayload = {}, cleanPayload = {}) {
  let rawHh = typeof reportPayload.happy_hour_info === "string" ? reportPayload.happy_hour_info.trim() : "";
  if (rawHh.startsWith(META_PREFIX)) {
    rawHh = "";
  }
  const meta = {};
  if (typeof reportPayload.reported_by_name === "string" && reportPayload.reported_by_name.trim()) {
    meta.author = reportPayload.reported_by_name.trim().slice(0, 60);
  }
  if (typeof reportPayload.reported_by_username === "string" && reportPayload.reported_by_username.trim()) {
    meta.username = reportPayload.reported_by_username.trim().slice(0, 40);
  }
  if (typeof reportPayload.reported_by_avatar === "string" && reportPayload.reported_by_avatar.trim()) {
    meta.avatar = reportPayload.reported_by_avatar.trim().slice(0, 200);
  }
  if (reportPayload.verified_by_receipt) {
    meta.verified_by_receipt = true;
  }
  if (typeof reportPayload.receipt_date === "string" && reportPayload.receipt_date.trim()) {
    meta.receipt_date = reportPayload.receipt_date.trim().slice(0, 32);
  }
  const conf = Number(reportPayload.receipt_confidence);
  if (Number.isFinite(conf) && conf > 0) {
    meta.confidence = Math.round(conf);
  }
  if (rawHh) {
    meta.hh = rawHh.slice(0, 240);
  }
  const osmId = reportPayload.venue_osm_id || cleanPayload.osm_id;
  if (typeof osmId === "string" && osmId.trim() && !UUID_RE.test(osmId.trim())) {
    meta.osm_id = osmId.trim().slice(0, 120);
  }
  const vName = reportPayload.venue_name || cleanPayload.name;
  if (typeof vName === "string" && vName.trim()) {
    meta.venue_name = vName.trim().slice(0, 120);
  }

  if (Object.keys(meta).length === 0) return rawHh || null;
  return META_PREFIX + JSON.stringify(meta);
}

function decodeReportMeta(rawStr) {
  const defaults = {
    reported_by_name: "Społeczność",
    reported_by_username: null,
    reported_by_avatar: "🍺",
    verified_by_receipt: false,
    receipt_date: null,
    receipt_confidence: null,
    happy_hour_info: null,
    venue_osm_id: null,
    venue_name: null
  };

  if (typeof rawStr !== "string" || !rawStr.trim()) {
    return defaults;
  }

  if (rawStr.startsWith(META_PREFIX)) {
    try {
      const parsed = JSON.parse(rawStr.slice(META_PREFIX.length));
      if (parsed && typeof parsed === "object") {
        const username = typeof parsed.username === "string" && parsed.username.trim() ? parsed.username.trim() : null;
        const author = typeof parsed.author === "string" && parsed.author.trim()
          ? parsed.author.trim()
          : (username ? `@${username}` : "Społeczność");
        return {
          reported_by_name: author,
          reported_by_username: username,
          reported_by_avatar: typeof parsed.avatar === "string" && parsed.avatar.trim() ? parsed.avatar.trim() : "🍺",
          verified_by_receipt: Boolean(parsed.verified_by_receipt),
          receipt_date: typeof parsed.receipt_date === "string" && parsed.receipt_date.trim() ? parsed.receipt_date.trim() : null,
          receipt_confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : null,
          happy_hour_info: typeof parsed.hh === "string" && parsed.hh.trim() ? parsed.hh.trim() : null,
          venue_osm_id: typeof parsed.osm_id === "string" && parsed.osm_id.trim() ? parsed.osm_id.trim() : null,
          venue_name: typeof parsed.venue_name === "string" && parsed.venue_name.trim() ? parsed.venue_name.trim() : null
        };
      }
    } catch (e) {
      // Fallback below
    }
  }

  return {
    ...defaults,
    happy_hour_info: rawStr.trim()
  };
}

function formatPhotoReportRow(row) {
  const decoded = decodeReportMeta(row.happy_hour_info);
  return {
    id: row.id || null,
    venue_id: row.venue_id || null,
    url: row.proof_image_url,
    proof_image_url: row.proof_image_url,
    created_at: row.created_at || null,
    reported_beer_name: row.reported_beer_name || "Piwo z kranu",
    reported_price_pln: row.reported_price_pln != null && !isNaN(parseFloat(row.reported_price_pln))
      ? parseFloat(row.reported_price_pln)
      : null,
    reported_shot_pln: row.reported_shot_pln != null && !isNaN(parseFloat(row.reported_shot_pln))
      ? parseFloat(row.reported_shot_pln)
      : null,
    ...decoded
  };
}

function getQueryParams(req) {
  if (req.query && typeof req.query === "object" && Object.keys(req.query).length > 0) {
    return req.query;
  }
  try {
    const parsedUrl = new URL(req.url || "/", "https://www.poilepiwko.pl");
    const out = {};
    parsedUrl.searchParams.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  } catch (e) {
    return {};
  }
}

async function resolveVenueRecord(headers, { id, osmId, name }) {
  if (id && UUID_RE.test(String(id).trim())) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${encodeURIComponent(String(id).trim())}&limit=1`, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (rows && rows.length > 0) return rows[0];
    }
  }
  if (osmId && UUID_RE.test(String(osmId).trim())) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${encodeURIComponent(String(osmId).trim())}&limit=1`, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (rows && rows.length > 0) return rows[0];
    }
  }
  const nonUuidOsm = (osmId && !UUID_RE.test(String(osmId).trim()) && String(osmId).trim())
    || (id && !UUID_RE.test(String(id).trim()) && String(id).trim())
    || "";
  if (nonUuidOsm) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/venues?osm_id=eq.${encodeURIComponent(nonUuidOsm)}&limit=1`, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (rows && rows.length > 0) return rows[0];
    }
  }
  if (name && String(name).trim()) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/venues?name=ilike.${encodeURIComponent(String(name).trim())}&limit=1`, { headers });
    if (r.ok) {
      const rows = await r.json();
      if (rows && rows.length > 0) return rows[0];
    }
  }
  return null;
}

async function handleGetPhotos(req, res, headers) {
  const q = getQueryParams(req);
  const action = q.action || "photos";

  if (action === "all-latest-photos") {
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
    const reportsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/price_reports?proof_image_url=not.is.null&order=created_at.desc&limit=500&select=venue_id,proof_image_url,happy_hour_info,created_at`,
      { headers }
    );
    if (!reportsRes.ok) {
      const errText = await reportsRes.text();
      return res.status(500).json({ error: "Failed to fetch photo index", details: errText });
    }
    const rows = await reportsRes.json();
    const byVenueId = {};
    const byOsmId = {};
    const byName = {};
    const seenUrlsByKey = new Map();

    function trackEntry(mapObj, key, url, createdAt, verifiedReceipt) {
      if (!key || !url) return;
      const trackKey = `${key}::${url}`;
      const existing = mapObj[key];
      if (!existing) {
        seenUrlsByKey.set(trackKey, true);
        mapObj[key] = {
          url,
          count: 1,
          latest_at: createdAt || null,
          verified_by_receipt: Boolean(verifiedReceipt)
        };
      } else {
        if (!seenUrlsByKey.has(trackKey)) {
          seenUrlsByKey.set(trackKey, true);
          existing.count += 1;
        }
        if (verifiedReceipt) {
          existing.verified_by_receipt = true;
        }
      }
    }

    (rows || []).forEach(row => {
      if (!row || !row.proof_image_url) return;
      const url = String(row.proof_image_url).trim();
      if (!url) return;
      const meta = decodeReportMeta(row.happy_hour_info);
      if (row.venue_id) {
        trackEntry(byVenueId, String(row.venue_id), url, row.created_at, meta.verified_by_receipt);
      }
      if (meta.venue_osm_id) {
        trackEntry(byOsmId, String(meta.venue_osm_id), url, row.created_at, meta.verified_by_receipt);
      }
      if (meta.venue_name) {
        trackEntry(byName, meta.venue_name.toLowerCase(), url, row.created_at, meta.verified_by_receipt);
      }
    });

    return res.status(200).json({
      success: true,
      byVenueId,
      byOsmId,
      byName
    });
  }

  // action === "photos"
  res.setHeader("Cache-Control", "no-store");
  const venueIdParam = q.venueId ? String(q.venueId).trim() : "";
  const osmIdParam = q.osmId ? String(q.osmId).trim() : "";
  const nameParam = q.name ? String(q.name).trim() : "";

  if (!venueIdParam && !osmIdParam && !nameParam) {
    return res.status(400).json({ error: "Missing venueId, osmId, or name query param." });
  }

  const targetVenue = await resolveVenueRecord(headers, {
    id: venueIdParam,
    osmId: osmIdParam,
    name: nameParam
  });
  const resolvedVenueId = (targetVenue && targetVenue.id) || (UUID_RE.test(venueIdParam) ? venueIdParam : null);
  const effectiveOsmId = osmIdParam || (targetVenue && targetVenue.osm_id) || (!UUID_RE.test(venueIdParam) ? venueIdParam : "");
  const effectiveName = (nameParam || (targetVenue && targetVenue.name) || "").toLowerCase();

  const requests = [];
  if (resolvedVenueId) {
    requests.push(
      fetch(
        `${SUPABASE_URL}/rest/v1/price_reports?venue_id=eq.${encodeURIComponent(resolvedVenueId)}&proof_image_url=not.is.null&order=created_at.desc&limit=50`,
        { headers }
      )
    );
  }
  requests.push(
    fetch(
      `${SUPABASE_URL}/rest/v1/price_reports?venue_id=is.null&proof_image_url=not.is.null&order=created_at.desc&limit=50`,
      { headers }
    )
  );

  const responses = await Promise.all(requests);
  const collected = [];

  for (let i = 0; i < responses.length; i++) {
    const r = responses[i];
    if (!r.ok) continue;
    const rows = await r.json();
    const isNullVenueBucket = (resolvedVenueId && i === 1) || (!resolvedVenueId && i === 0);
    (rows || []).forEach(row => {
      if (!row || !row.proof_image_url) return;
      const formatted = formatPhotoReportRow(row);
      if (isNullVenueBucket) {
        const matchOsm = effectiveOsmId && formatted.venue_osm_id && formatted.venue_osm_id === effectiveOsmId;
        const matchName = effectiveName && formatted.venue_name && formatted.venue_name.toLowerCase() === effectiveName;
        if (!matchOsm && !matchName) return;
      }
      collected.push(formatted);
    });
  }

  // Deduplicate by normalized URL keeping newest entry first
  collected.sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return (isNaN(tb) ? 0 : tb) - (isNaN(ta) ? 0 : ta);
  });

  const seenUrls = new Set();
  const photos = [];
  for (const item of collected) {
    const u = String(item.url || "").trim();
    if (!u || seenUrls.has(u)) continue;
    seenUrls.add(u);
    photos.push(item);
  }

  return res.status(200).json({
    success: true,
    venue_id: resolvedVenueId,
    photos
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Server configuration error: SUPABASE_SERVICE_ROLE_KEY is missing." });
  }

  const headers = getAdminHeaders();

  try {
    if (req.method === "GET") {
      return await handleGetPhotos(req, res, headers);
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed. Use GET or POST." });
    }

    const { venuePayload, reportPayload } = req.body || {};

    const isMetaOnly = Boolean(venuePayload.hours_only || venuePayload.meta_only);

    if (!venuePayload || !venuePayload.name || (!isMetaOnly && venuePayload.beer_price_pln === undefined)) {
      return res.status(400).json({ error: "Missing venuePayload or invalid price." });
    }

    const price = isMetaOnly
      ? parseFloat(venuePayload.beer_price_pln || 0)
      : parseFloat(venuePayload.beer_price_pln);
    if (!isMetaOnly && (isNaN(price) || price <= 0)) {
      return res.status(400).json({ error: "Invalid beer_price_pln value." });
    }

    const cleanPayload = { ...venuePayload };
    delete cleanPayload.geom;
    if (!isNaN(price) && price > 0) cleanPayload.beer_price_pln = price;
    cleanPayload.last_updated = new Date().toISOString();

    const targetVenue = await resolveVenueRecord(headers, {
      id: cleanPayload.id,
      osmId: cleanPayload.osm_id,
      name: cleanPayload.name
    });

    if (isMetaOnly && targetVenue) {
      const metaPatch = {};
      if (cleanPayload.hours) metaPatch.hours = String(cleanPayload.hours);
      if (cleanPayload.amenities !== undefined) {
        metaPatch.amenities = sanitizeAmenities(cleanPayload.amenities);
      }
      if (Object.keys(metaPatch).length === 0) {
        return res.status(200).json({ success: true, venue: targetVenue, report: null });
      }
      const metaRes = await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${encodeURIComponent(targetVenue.id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(metaPatch)
      });
      if (!metaRes.ok) {
        const errText = await metaRes.text();
        console.error("[Update Venue API] Supabase meta-only error:", errText);
        return res.status(500).json({ error: "Supabase meta update failed", details: errText });
      }
      const metaData = await metaRes.json();
      return res.status(200).json({
        success: true,
        venue: Array.isArray(metaData) ? metaData[0] : metaData,
        report: null
      });
    }

    let saveRes;
    if (targetVenue) {
      // Strictly whitelist live public.venues columns on PATCH
      const patchBody = {
        beer_name: cleanPayload.beer_name || targetVenue.beer_name,
        beer_price_pln: price,
        shot_price_pln: cleanPayload.shot_price_pln !== undefined ? cleanPayload.shot_price_pln : targetVenue.shot_price_pln,
        happy_hour: cleanPayload.happy_hour !== undefined ? cleanPayload.happy_hour : targetVenue.happy_hour,
        hours: cleanPayload.hours ? cleanPayload.hours : targetVenue.hours,
        amenities: cleanPayload.amenities !== undefined
          ? sanitizeAmenities(cleanPayload.amenities)
          : (Array.isArray(targetVenue.amenities) ? targetVenue.amenities : []),
        is_verified: cleanPayload.is_verified !== undefined ? Boolean(cleanPayload.is_verified) : targetVenue.is_verified,
        votes_confirm: (targetVenue.votes_confirm || 0) + 1,
        last_updated: cleanPayload.last_updated
      };

      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${encodeURIComponent(targetVenue.id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patchBody)
      });
    } else {
      // Strictly whitelist live public.venues columns on INSERT
      const baseSlug = String(cleanPayload.slug || cleanPayload.name || "bar")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `bar-${Date.now()}`;

      const insertBody = {
        osm_id: (cleanPayload.osm_id && !UUID_RE.test(String(cleanPayload.osm_id)))
          ? String(cleanPayload.osm_id)
          : `user-${Date.now()}`,
        name: String(cleanPayload.name).trim(),
        slug: baseSlug,
        district: String(cleanPayload.district || "Śródmieście").trim(),
        address: String(cleanPayload.address || cleanPayload.district || "Warszawa").trim(),
        latitude: Number.isFinite(parseFloat(cleanPayload.latitude)) ? parseFloat(cleanPayload.latitude) : 52.2297,
        longitude: Number.isFinite(parseFloat(cleanPayload.longitude)) ? parseFloat(cleanPayload.longitude) : 21.0122,
        beer_name: String(cleanPayload.beer_name || "Piwo z kranu").trim(),
        beer_price_pln: price,
        beer_size_ml: parseInt(cleanPayload.beer_size_ml, 10) || 500,
        shot_price_pln: cleanPayload.shot_price_pln != null && !isNaN(parseFloat(cleanPayload.shot_price_pln))
          ? parseFloat(cleanPayload.shot_price_pln)
          : null,
        is_craft: Boolean(cleanPayload.is_craft),
        happy_hour: cleanPayload.happy_hour || null,
        hours: cleanPayload.hours || "16:00 - 02:00",
        amenities: sanitizeAmenities(cleanPayload.amenities),
        is_verified: cleanPayload.is_verified !== undefined ? Boolean(cleanPayload.is_verified) : false,
        votes_confirm: parseInt(cleanPayload.votes_confirm, 10) || 1,
        last_updated: cleanPayload.last_updated
      };

      saveRes = await fetch(`${SUPABASE_URL}/rest/v1/venues`, {
        method: "POST",
        headers,
        body: JSON.stringify(insertBody)
      });

      if (saveRes.status === 409) {
        insertBody.slug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
        saveRes = await fetch(`${SUPABASE_URL}/rest/v1/venues`, {
          method: "POST",
          headers,
          body: JSON.stringify(insertBody)
        });
      }
    }

    if (!saveRes.ok) {
      const errText = await saveRes.text();
      console.error("[Update Venue API] Supabase error:", errText);
      return res.status(500).json({ error: "Supabase update failed", details: errText });
    }

    const updatedData = await saveRes.json();
    const savedVenue = Array.isArray(updatedData) ? updatedData[0] : updatedData;

    // Persist proof photo / price report audit row synchronously before returning
    let savedReport = null;
    if (reportPayload || cleanPayload.photo_url) {
      const rp = reportPayload || {};
      let beerLabel = String(rp.reported_beer_name || cleanPayload.beer_name || "Piwo z kranu").trim();
      if (beerLabel.length < 2) beerLabel = "Piwo z kranu";

      const cleanReport = {
        venue_id: (savedVenue && savedVenue.id) || (targetVenue && targetVenue.id) || null,
        reported_beer_name: beerLabel.slice(0, 120),
        reported_price_pln: parseFloat(rp.reported_price_pln) || price,
        reported_shot_pln: rp.reported_shot_pln != null && !isNaN(parseFloat(rp.reported_shot_pln))
          ? parseFloat(rp.reported_shot_pln)
          : null,
        proof_image_url: rp.proof_image_url || cleanPayload.photo_url || null,
        happy_hour_info: encodeReportMeta(rp, cleanPayload)
      };

      try {
        const reportRes = await fetch(`${SUPABASE_URL}/rest/v1/price_reports`, {
          method: "POST",
          headers,
          body: JSON.stringify(cleanReport)
        });
        if (reportRes.ok) {
          const repJson = await reportRes.json();
          const repRow = Array.isArray(repJson) ? repJson[0] : repJson;
          if (repRow) {
            savedReport = repRow.proof_image_url ? formatPhotoReportRow(repRow) : repRow;
          }
        } else {
          const repErr = await reportRes.text();
          console.warn("[Update Venue API] price_reports insert note:", repErr);
        }
      } catch (e) {
        console.warn("[Update Venue API] Audit log note:", e);
      }
    }

    return res.status(200).json({
      success: true,
      venue: savedVenue,
      report: savedReport
    });

  } catch (err) {
    console.error("[Update Venue API] Server error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};
