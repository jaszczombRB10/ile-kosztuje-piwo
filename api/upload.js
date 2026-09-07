// Vercel Serverless Function: Upload image proof to Supabase Storage
const SUPABASE_URL = process.env.SUPABASE_URL || "https://agsodpzkytdgicpmphxz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODcxODI3MywiZXhwIjoyMTA0Mjk0MjczfQ.nXVSigEdTUqxVcIOAic59j47lUNn_qI61NQRxs3Deho";

module.exports = async (req, res) => {
  // CORS Headers
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
    const { imageBase64, contentType = "image/jpeg", fileName = "proof" } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64 in request body." });
    }

    // Strip data URL prefix if present (e.g. data:image/jpeg;base64,...)
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Check size limit: 5MB
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ error: "Image exceeds 5MB size limit." });
    }

    // Generate unique storage file name
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const cleanPrefix = fileName.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 30) || "proof";
    const storagePath = `${cleanPrefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/proofs/${storagePath}`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true"
      },
      body: buffer
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("[Upload API] Supabase storage error:", errText);
      return res.status(500).json({ error: "Failed to upload image to Supabase Storage", details: errText });
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/proofs/${storagePath}`;
    return res.status(200).json({
      success: true,
      url: publicUrl,
      fileName: storagePath,
      size: buffer.length
    });

  } catch (err) {
    console.error("[Upload API] Server error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};
