// Vercel Serverless Function: Administrator & Moderation API
const SUPABASE_URL = process.env.SUPABASE_URL || "https://agsodpzkytdgicpmphxz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODcxODI3MywiZXhwIjoyMTA0Mjk0MjczfQ.nXVSigEdTUqxVcIOAic59j47lUNn_qI61NQRxs3Deho";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "poilepiwko2026!";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { password, action, payload } = req.body || {};

    // Authentication check
    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Nieprawidłowe hasło administratora (Unauthorized)." });
    }

    const headers = {
      "apikey": SUPABASE_SERVICE_ROLE_KEY,
      "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
      "Prefer": "return=representation"
    };

    // 1. Auth check ping
    if (action === "auth") {
      return res.status(200).json({ success: true, message: "Zalogowano pomyślnie." });
    }

    // 2. List all venues for moderation
    if (action === "list-venues") {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/venues?order=last_updated.desc`, {
        headers
      });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(500).json({ error: "Błąd bazy danych Supabase", details: errText });
      }
      const venues = await response.json();
      return res.status(200).json({ success: true, venues });
    }

    // 3. Verify venue (mark as officially checked)
    if (action === "verify-venue") {
      const { venueId, isVerified = true } = payload || {};
      if (!venueId) return res.status(400).json({ error: "Brak venueId." });

      const response = await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${encodeURIComponent(venueId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          is_verified: isVerified,
          last_updated: new Date().toISOString()
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(500).json({ error: "Błąd aktualizacji lokalu", details: errText });
      }
      const updated = await response.json();
      return res.status(200).json({ success: true, venue: updated[0] || null });
    }

    // 4. Delete venue permanently
    if (action === "delete-venue") {
      const { venueId, osmId } = payload || {};
      if (!venueId && !osmId) return res.status(400).json({ error: "Brak venueId ani osmId." });

      let query = venueId ? `id=eq.${encodeURIComponent(venueId)}` : `osm_id=eq.${encodeURIComponent(osmId)}`;
      const response = await fetch(`${SUPABASE_URL}/rest/v1/venues?${query}`, {
        method: "DELETE",
        headers
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(500).json({ error: "Błąd usuwania lokalu", details: errText });
      }

      // Also clean any price_reports matching this venue_id
      if (venueId) {
        fetch(`${SUPABASE_URL}/rest/v1/price_reports?venue_id=eq.${encodeURIComponent(venueId)}`, {
          method: "DELETE",
          headers
        }).catch(() => {});
      }

      return res.status(200).json({ success: true, message: "Lokal został usunięty z bazy." });
    }

    // 5. Update venue details (quick edit)
    if (action === "update-venue") {
      const { venueId, updates } = payload || {};
      if (!venueId || !updates) return res.status(400).json({ error: "Brak venueId lub updates." });

      const cleanUpdates = { ...updates };
      delete cleanUpdates.geom;
      delete cleanUpdates.id;
      delete cleanUpdates.created_at;
      cleanUpdates.last_updated = new Date().toISOString();

      if (cleanUpdates.beer_price_pln !== undefined) {
        cleanUpdates.beer_price_pln = parseFloat(cleanUpdates.beer_price_pln);
      }
      if (cleanUpdates.shot_price_pln !== undefined && cleanUpdates.shot_price_pln !== null) {
        cleanUpdates.shot_price_pln = parseFloat(cleanUpdates.shot_price_pln) || null;
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/venues?id=eq.${encodeURIComponent(venueId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(cleanUpdates)
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(500).json({ error: "Błąd edycji lokalu", details: errText });
      }
      const updated = await response.json();
      return res.status(200).json({ success: true, venue: updated[0] || null });
    }

    // 6. List price reports & uploaded photos
    if (action === "list-reports") {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/price_reports?order=created_at.desc&limit=60`, {
        headers
      });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(500).json({ error: "Błąd pobierania raportów", details: errText });
      }
      const reports = await response.json();
      return res.status(200).json({ success: true, reports });
    }

    // 7. Delete a specific report
    if (action === "delete-report") {
      const { reportId } = payload || {};
      if (!reportId) return res.status(400).json({ error: "Brak reportId." });

      const response = await fetch(`${SUPABASE_URL}/rest/v1/price_reports?id=eq.${encodeURIComponent(reportId)}`, {
        method: "DELETE",
        headers
      });
      if (!response.ok) {
        const errText = await response.text();
        return res.status(500).json({ error: "Błąd usuwania raportu", details: errText });
      }
      return res.status(200).json({ success: true, message: "Raport usunięty." });
    }

    return res.status(400).json({ error: "Nieobsługiwana akcja: " + action });

  } catch (err) {
    console.error("Admin API Error:", err);
    return res.status(500).json({ error: "Błąd serwera", message: err.message });
  }
};
