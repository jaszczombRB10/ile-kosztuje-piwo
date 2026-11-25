// Vercel Serverless Function: AI Beer & Receipt / Menu Vision Scanner
// Supports Gemini 2.5 Flash API (primary) & OpenAI gpt-4o-mini (configurable via .env)
// Returns strict structured JSON adhering to the AI Beer & Receipt Scanner schema.


const STRUCTURED_PROMPT = `Jesteś wyspecjalizowanym asystentem Vision AI dla polskiej aplikacji poilepiwko.pl.
Twoim zadaniem jest precyzyjna analiza zdjęcia paragonu fiskalnego, tablicy z kranami (taplisty) lub karty menu z lokalu gastronomicznego w Polsce.

Musisz wyodrębnić informacje i ZAWSZE zwrócić poprawny obiekt JSON o następującym schemacie:
{
  "is_valid_image": boolean,
  "rejection_reason": string | null,
  "document_type": "receipt" | "menu_board" | "paper_menu" | "unknown",
  "bar_name_detected": string | null,
  "street_or_city_hint": string | null,
  "cheapest_beer_05l_pln": number | null,
  "original_volume_detected_ml": number | null,
  "beer_brand_or_type": string | null,
  "shot_price_pln": number | null,
  "is_craft_or_multitap": boolean,
  "happy_hour_info": string | null,
  "receipt_date_iso": string | null,
  "is_fresh_receipt": boolean,
  "confidence_score": number
}

SZCZEGÓŁOWE ZASADY ANALIZY:
1. is_valid_image: true jeśli na zdjęciu widać paragon z baru, tablicę kredową z piwami, ekran z kranami lub papierowe menu piwne. Jeśli zdjęcie nie przedstawia paragonu ani menu/cennika napojów, ustaw false i wpisz rejection_reason.
2. bar_name_detected: odczytaj nazwę lokalu TYLKO jeśli faktycznie jest widoczna na zdjęciu (z nagłówka paragonu, logo, nazwy baru/spółki). Jeśli jej nie widać, ZWRÓĆ null (nigdy nie zgaduj ani nie zmyślaj nazwy baru!).
3. street_or_city_hint: adres lokalu TYLKO jeśli jest wyraźnie widoczny na zdjęciu; w przeciwnym razie null.
4. PRIORYTET SEKCJI W KARTACH MENU:
   - ZAWSZE najpierw szukaj sekcji "PIWA BECZKOWE" / "PIWA LANE" / "Z NALEWAKA" / "Z KRANU" / "ON TAP".
   - CAŁKOWICIE IGNORUJ ceny w sekcjach "PIWA BEZALKOHOLOWE" (0,0%, Free), "WINO / PROSECCO" (np. 750ml), "KOKTAJLE", "WHISKY" przy szukaniu ceny piwa!
   - Sekcję "PIWA BUTELKOWE" bierz pod uwagę WYŁĄCZNIE wtedy, gdy na zdjęciu w ogóle nie ma piw beczkowych/lanych.
5. KRYTYCZNA ZASADA POJEMNOŚCI (0.5L = 500 ml):
   - Jeśli to samo piwo beczkowe ma dwie pojemności (np. 300 ml = 19 zł oraz 500 ml = 25 zł), ZAWSZE podaj bezpośrednią cenę za 500 ml (np. 25.0) i original_volume_detected_ml = 500! NIGDY nie przeliczaj proporcjonalnie małego piwa 300 ml, jeśli na karcie podano cenę 500 ml!
   - Przeliczaj na 0.5L proporcjonalnie WYŁĄCZNIE wtedy, gdy w całej sekcji beczkowej istnieje tylko mniejsza objętość (np. 400 ml za 16 zł -> 20.0).
   - Jeśli na paragonie lub karcie nie widać żadnej ceny piwa alkoholowego, ustaw cheapest_beer_05l_pln = null (nigdy nie zmyślaj kwoty!).
6. beer_brand_or_type: nazwa najtańszego wybranego piwa beczkowego 0.5L (np. "Książęce Złote", "Namysłów Pils", "Kozel Ležák", "Żywiec").
7. shot_price_pln: najniższa cena shota/wódki (40ml lub 50ml) w sekcji "WÓDKA" / "SHOTY" jeśli widoczna na zdjęciu; inaczej null.
8. is_craft_or_multitap: true wyłącznie jeśli to multitap / bar kraftowy z wieloma stylami rzemieślniczymi (Pinta, Trzech Kumpli, Artezan, IPA/Sour/Stout), false dla standardowych kart z piwem koncernowym.
9. happy_hour_info: opis promocji happy hour jeśli widoczny, inaczej null.
10. receipt_date_iso: data z paragonu YYYY-MM-DD lub null dla menu.
11. is_fresh_receipt: true dla menu/tablicy lub paragonu z ostatnich 30 dni.
12. confidence_score: całkowita liczba 0-100.

Zwróć WYŁĄCZNIE czysty JSON.`;

const JSON_SCHEMA_GEMINI = {
  type: "OBJECT",
  properties: {
    is_valid_image: { type: "BOOLEAN" },
    rejection_reason: { type: "STRING", nullable: true },
    document_type: { type: "STRING", enum: ["receipt", "menu_board", "paper_menu", "unknown"] },
    bar_name_detected: { type: "STRING", nullable: true },
    street_or_city_hint: { type: "STRING", nullable: true },
    cheapest_beer_05l_pln: { type: "NUMBER", nullable: true },
    original_volume_detected_ml: { type: "INTEGER", nullable: true },
    beer_brand_or_type: { type: "STRING", nullable: true },
    shot_price_pln: { type: "NUMBER", nullable: true },
    is_craft_or_multitap: { type: "BOOLEAN" },
    happy_hour_info: { type: "STRING", nullable: true },
    receipt_date_iso: { type: "STRING", nullable: true },
    is_fresh_receipt: { type: "BOOLEAN" },
    confidence_score: { type: "INTEGER" }
  },
  required: [
    "is_valid_image",
    "document_type",
    "is_craft_or_multitap",
    "is_fresh_receipt",
    "confidence_score"
  ]
};

let cachedDiscoveredFlashModels = null;
let cachedDiscoveredAt = 0;
const MODEL_DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;

function pickBestFlashModels(modelsList = [], excludeSet = new Set()) {
  const candidates = [];
  for (const item of modelsList) {
    const id = String(typeof item === "string" ? item : (item && item.name) || "").replace(/^models\//, "").trim();
    if (!id || excludeSet.has(id)) continue;
    if (Array.isArray(item && item.supportedGenerationMethods) && !item.supportedGenerationMethods.includes("generateContent")) {
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
  return candidates.map(c => c.id);
}

async function discoverCheapestFastestGeminiModels(geminiKey, excludeSet = new Set()) {
  const now = Date.now();
  if (cachedDiscoveredFlashModels && (now - cachedDiscoveredAt) < MODEL_DISCOVERY_TTL_MS) {
    return cachedDiscoveredFlashModels.filter(id => !excludeSet.has(id)).slice(0, 3);
  }
  try {
    const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`;
    const res = await fetch(listUrl);
    if (!res.ok) return [];
    const data = await res.json();
    const ranked = pickBestFlashModels(data && data.models ? data.models : [], new Set());
    if (ranked.length > 0) {
      cachedDiscoveredFlashModels = ranked;
      cachedDiscoveredAt = now;
    }
    return ranked.filter(id => !excludeSet.has(id)).slice(0, 3);
  } catch (err) {
    console.warn("Gemini model discovery note:", err.message);
    return [];
  }
}

async function invokeGeminiSingleModel(model, geminiKey, cleanBase64, mimeType) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: STRUCTURED_PROMPT },
            {
              inlineData: {
                mimeType: mimeType,
                data: cleanBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: JSON_SCHEMA_GEMINI,
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    console.warn(`Gemini (${model}) returned HTTP ${response.status}`);
    return null;
  }

  const geminiData = await response.json();
  const rawAnswer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
  if (rawAnswer) {
    return { data: JSON.parse(rawAnswer), model };
  }
  return null;
}

async function callGeminiVision(cleanBase64, mimeType = "image/jpeg") {
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!geminiKey) return null;

  // Rolling Google aliases auto-route to the newest Flash-Lite (fastest/cheapest) & Flash tiers
  const rawPrimary = [
    process.env.GEMINI_MODEL || null,
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest"
  ].filter(Boolean);

  const modelsToTry = [...new Set(rawPrimary)];
  const tried = new Set();

  for (const model of modelsToTry) {
    tried.add(model);
    try {
      const hit = await invokeGeminiSingleModel(model, geminiKey, cleanBase64, mimeType);
      if (hit) return hit;
    } catch (err) {
      console.warn(`Gemini (${model}) invocation note:`, err.message);
    }
  }

  // Dynamic self-healing discovery if all hardcoded aliases/versions failed or were retired
  const discovered = await discoverCheapestFastestGeminiModels(geminiKey, tried);
  for (const model of discovered) {
    try {
      const hit = await invokeGeminiSingleModel(model, geminiKey, cleanBase64, mimeType);
      if (hit) return hit;
    } catch (err) {
      console.warn(`Gemini discovered (${model}) note:`, err.message);
    }
  }

  return null;
}

async function callOpenAIVision(cleanBase64, mimeType = "image/jpeg") {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: STRUCTURED_PROMPT
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Przeanalizuj to zdjęcie paragonu lub menu i wyodrębnij dane w formacie JSON."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType};base64,${cleanBase64}`
                }
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      console.warn(`OpenAI (${model}) returned HTTP ${response.status}`);
      return null;
    }

    const openaiData = await response.json();
    const rawAnswer = openaiData.choices?.[0]?.message?.content;
    if (rawAnswer) {
      return JSON.parse(rawAnswer);
    }
  } catch (err) {
    console.warn("OpenAI Vision invocation error:", err.message);
  }

  return null;
}

async function callVercelAiGateway(cleanBase64, mimeType = "image/jpeg") {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  if (!gatewayKey) return null;

  const models = [...new Set([
    process.env.AI_GATEWAY_VISION_MODEL || null,
    "google/gemini-3.5-flash-lite",
    "google/gemini-flash-latest"
  ].filter(Boolean))];

  for (const model of models) {
    try {
      const response = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${gatewayKey}`
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          temperature: 0.1,
          messages: [
            { role: "system", content: STRUCTURED_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: "Przeanalizuj to zdjęcie paragonu lub menu i wyodrębnij dane w formacie JSON." },
                { type: "image_url", image_url: { url: `data:${mimeType};base64,${cleanBase64}` } }
              ]
            }
          ]
        })
      });
      if (!response.ok) continue;
      const data = await response.json();
      const rawAnswer = data.choices?.[0]?.message?.content;
      if (rawAnswer) return { data: JSON.parse(rawAnswer), model };
    } catch (err) {
      console.warn(`AI Gateway (${model}) Vision error:`, err.message);
    }
  }
  return null;
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
    const rawImage = (req.body && (req.body.imageBase64 || req.body.image_base64)) || null;

    if (!rawImage) {
      return res.status(400).json({ error: "Missing imageBase64 payload" });
    }

    // Detect MIME type and clean header
    let mimeType = "image/jpeg";
    const mimeMatch = rawImage.match(/^data:(image\/[a-zA-Z0-9.+_-]+);base64,/);
    if (mimeMatch && mimeMatch[1]) {
      mimeType = mimeMatch[1];
    }
    const cleanBase64 = rawImage.replace(/^data:image\/[a-zA-Z0-9.+_-]+;base64,/, "");

    const providerPref = (process.env.AI_PROVIDER || "").toLowerCase();
    let result = null;
    let source = "unknown";
    let modelUsed = null;

    // 1. Try Vercel AI Gateway if configured
    if (!result && process.env.AI_GATEWAY_API_KEY) {
      const gwHit = await callVercelAiGateway(cleanBase64, mimeType);
      if (gwHit && gwHit.data) {
        result = gwHit.data;
        modelUsed = gwHit.model;
        source = "vercel-ai-gateway";
      }
    }

    // 2. Try preferred Gemini / OpenAI direct provider
    if (!result) {
      if (providerPref === "openai") {
        result = await callOpenAIVision(cleanBase64, mimeType);
        if (result) {
          source = "openai-vision";
          modelUsed = process.env.OPENAI_MODEL || "gpt-4o-mini";
        }
      } else {
        const gemHit = await callGeminiVision(cleanBase64, mimeType);
        if (gemHit && gemHit.data) {
          result = gemHit.data;
          modelUsed = gemHit.model;
          source = "gemini-vision";
        } else if (process.env.OPENAI_API_KEY) {
          result = await callOpenAIVision(cleanBase64, mimeType);
          if (result) {
            source = "openai-vision";
            modelUsed = process.env.OPENAI_MODEL || "gpt-4o-mini";
          }
        }
      }
    }

    // 3. Failover to Gemini if OpenAI failed
    if (!result && providerPref === "openai" && (process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY)) {
      const gemHit = await callGeminiVision(cleanBase64, mimeType);
      if (gemHit && gemHit.data) {
        result = gemHit.data;
        modelUsed = gemHit.model;
        source = "gemini-vision";
      }
    }

    // 4. Never fabricate fake venue/price data -> let client run real local Polish OCR
    if (!result) {
      return res.status(200).json({
        success: true,
        source: "client-ocr-needed",
        requiresClientOcr: true,
        data: null
      });
    }

    // Ensure schema validity
    const sanitized = {
      is_valid_image: typeof result.is_valid_image === "boolean" ? result.is_valid_image : true,
      rejection_reason: result.rejection_reason || null,
      document_type: result.document_type || "unknown",
      bar_name_detected: result.bar_name_detected || null,
      street_or_city_hint: result.street_or_city_hint || null,
      cheapest_beer_05l_pln: typeof result.cheapest_beer_05l_pln === "number" ? result.cheapest_beer_05l_pln : null,
      original_volume_detected_ml: typeof result.original_volume_detected_ml === "number" ? result.original_volume_detected_ml : null,
      beer_brand_or_type: result.beer_brand_or_type || null,
      shot_price_pln: typeof result.shot_price_pln === "number" ? result.shot_price_pln : null,
      is_craft_or_multitap: Boolean(result.is_craft_or_multitap),
      happy_hour_info: result.happy_hour_info || null,
      receipt_date_iso: result.receipt_date_iso || null,
      is_fresh_receipt: typeof result.is_fresh_receipt === "boolean" ? result.is_fresh_receipt : true,
      confidence_score: typeof result.confidence_score === "number" ? result.confidence_score : 85
    };

    return res.status(200).json({
      success: true,
      source,
      modelUsed,
      data: sanitized
    });

  } catch (error) {
    console.error("AI Receipt Scanner server error:", error);
    return res.status(500).json({
      error: "Internal server error during image analysis",
      details: error.message
    });
  }
}

module.exports = handler;
module.exports.default = handler;
module.exports.pickBestFlashModels = pickBestFlashModels;
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "8mb"
    }
  }
};

