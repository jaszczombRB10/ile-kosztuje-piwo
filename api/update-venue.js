// Vercel Serverless Function: Update or insert venue in Supabase with admin privileges
const SUPABASE_URL = process.env.SUPABASE_URL || "https://agsodpzkytdgicpmphxz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODcxODI3MywiZXhwIjoyMTA0Mjk0MjczfQ.nXVSigEdTUqxVcIOAic59j47lUNn_qI61NQRxs3Deho";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { venuePayload, reportPayload } = req.body || {};

    if (!venuePayload || !venuePayload.name || venuePayload.beer_price_pln === undefined) {
      return res.status(400).json({ error: "Missing venuePayload or invalid price." });
    }

    const price = parseFloat(venuePayload.beer_price_pln);
    if (isNaN(price) || price <= 0) {
      return res.status(400).json({ error: "Invalid beer_price_pln value." });
    }

    const headers = {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };

    // Clean payload: remove geom if present (it is a generated column)
    const cleanPayload = { ...venuePayload };
    delete cleanPayload.geom;
    cleanPayload.beer_price_pln = price;
    cleanPayload.last_updated = new Date().toISOString();

    // Check if venue already exists by osm_id, id, or exact name
    let targetVenue = null;
    if (cleanPayload.osm_id) {
      const checkRes = await fetch(SUPABASE_URL + "/rest/v1/venues?osm_id=eq." + encodeURIComponent(cleanPayload.osm_id), { headers });
      if (checkRes.ok) {
        const found = await checkRes.json();
        if (found && found.length > 0) targetVenue = found[0];
      }
    }
    if (!targetVenue && cleanPayload.name) {
      const checkNameRes = await fetch(SUPABASE_URL + "/rest/v1/venues?name=ilike." + encodeURIComponent(cleanPayload.name), { headers });
      if (checkNameRes.ok) {
        const found = await checkNameRes.json();
        if (found && found.length > 0) targetVenue = found[0];
      }
    }

    let saveRes;
    if (targetVenue) {
      // Update existing venue in Supabase
      saveRes = await fetch(SUPABASE_URL + "/rest/v1/venues?id=eq." + targetVenue.id, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          beer_name: cleanPayload.beer_name || targetVenue.beer_name,
          beer_price_pln: price,
          shot_price_pln: cleanPayload.shot_price_pln !== undefined ? cleanPayload.shot_price_pln : targetVenue.shot_price_pln,
          happy_hour: cleanPayload.happy_hour !== undefined ? cleanPayload.happy_hour : targetVenue.happy_hour,
          photo_url: cleanPayload.photo_url || targetVenue.photo_url,
          votes_confirm: (targetVenue.votes_confirm || 0) + 1,
          last_updated: cleanPayload.last_updated
        })
      });
    } else {
      // Insert new venue
      saveRes = await fetch(SUPABASE_URL + "/rest/v1/venues", {
        method: "POST",
        headers,
        body: JSON.stringify(cleanPayload)
      });
    }

    if (!saveRes.ok) {
      const errText = await saveRes.text();
      console.error("[Update Venue API] Supabase error:", errText);
      return res.status(500).json({ error: "Supabase update failed", details: errText });
    }

    const updatedData = await saveRes.json();

    // Log price report audit if provided
    if (reportPayload) {
      fetch(SUPABASE_URL + "/rest/v1/price_reports", {
        method: "POST",
        headers,
        body: JSON.stringify(reportPayload)
      }).catch(e => console.warn("Audit log note:", e));
    }

    return res.status(200).json({
      success: true,
      venue: Array.isArray(updatedData) ? updatedData[0] : updatedData
    });

  } catch (err) {
    console.error("[Update Venue API] Server error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};
