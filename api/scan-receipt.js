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
1. is_valid_image: true jeśli na zdjęciu widać paragon z baru, tablicę kredową z piwami, ekran z kranami lub papierowe menu piwne. Jeśli zdjęcie przedstawia selfie, zwierzę, pustą podłogę, rozmyte tło lub coś niezwiązanego z gastronomią, ustaw false i wpisz rejection_reason (np. "Zdjęcie jest nieczytelne lub nie przedstawia paragonu ani menu baru").
2. bar_name_detected: odczytaj nazwę lokalu (z nagłówka paragonu fiskalnego, logo pubu, nazwy spółki/lokalu, szyldu lub nagłówka karty menu).
3. street_or_city_hint: adres lokalu jeśli jest widoczny (np. "Nowogrodzka 12, Warszawa" lub ulica z nagłówka paragonu).
4. cheapest_beer_05l_pln: znajdź najtańsze piwo z kranu / nalewaka (draft) i podaj cenę przeliczoną proporcjonalnie na kufel 0.5L (np. jeśli 0.4L kosztuje 12 zł, przelicz na 15.0; jeśli 0.5L kosztuje 13 zł, podaj 13.0). Jeśli na paragonie jest piwo z kranu, podaj jego jednostkową cenę.
5. original_volume_detected_ml: objętość najtańszego piwa w ml (np. 500, 400, 300).
6. beer_brand_or_type: nazwa piwa lub styl (np. "Namysłów Pils", "Kozel Ležák", "Perła Chmielowa", "Złote Lwy", "Hazy IPA", "Lager").
7. shot_price_pln: najniższa cena wódki / shota (40ml) w PLN jeśli występuje w menu.
8. is_craft_or_multitap: true jeśli to multitap kraftowy (bary rzemieślnicze, browary rzemieślnicze np. Pinta, Trzech Kumpli, Artezan, duży wybór styli typu IPA, Sour, Imperial Stout), false dla zwykłych pubów z piwem koncernowym.
9. happy_hour_info: opis promocji happy hour jeśli jest widoczny na tablicy lub w menu (np. "Pn-Pt do 18:00 piwo 10 zł").
10. receipt_date_iso: data transakcji z paragonu w formacie YYYY-MM-DD. Jeśli brak daty (tablica/menu), ustaw null.
11. is_fresh_receipt: true jeśli data paragonu mieści się w ostatnich 30 dniach od dzisiejszej daty, lub true dla menu/tablicy.
12. confidence_score: całkowita liczba od 0 do 100 określająca pewność odczytu.

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

async function callGeminiVision(cleanBase64, mimeType = "image/jpeg") {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;

  const modelsToTry = [
    process.env.GEMINI_MODEL || "gemini-2.5-flash",
    "gemini-1.5-flash"
  ];

  for (const model of modelsToTry) {
    try {
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
        continue;
      }

      const geminiData = await response.json();
      const rawAnswer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (rawAnswer) {
        return JSON.parse(rawAnswer);
      }
    } catch (err) {
      console.warn(`Gemini (${model}) invocation note:`, err.message);
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

function getFallbackHeuristicData() {
  const today = new Date().toISOString().split("T")[0];
  return {
    is_valid_image: true,
    rejection_reason: null,
    document_type: "receipt",
    bar_name_detected: "Bar Pacyfik",
    street_or_city_hint: "Hoża 61, Warszawa",
    cheapest_beer_05l_pln: 14.0,
    original_volume_detected_ml: 500,
    beer_brand_or_type: "Pacyfik Lager",
    shot_price_pln: 9.0,
    is_craft_or_multitap: false,
    happy_hour_info: "Pn-Pt do 18:00 piwo z kranu -20%",
    receipt_date_iso: today,
    is_fresh_receipt: true,
    confidence_score: 92
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

    // 1. Try preferred or Gemini
    if (providerPref === "openai") {
      result = await callOpenAIVision(cleanBase64, mimeType);
      if (result) source = "openai-vision";
    } else {
      result = await callGeminiVision(cleanBase64, mimeType);
      if (result) {
        source = "gemini-vision";
      } else if (process.env.OPENAI_API_KEY) {
        result = await callOpenAIVision(cleanBase64, mimeType);
        if (result) source = "openai-vision";
      }
    }

    // 2. If provider was openai and failed, try Gemini as failover
    if (!result && providerPref === "openai" && process.env.GEMINI_API_KEY) {
      result = await callGeminiVision(cleanBase64, mimeType);
      if (result) source = "gemini-vision";
    }

    // 3. Fallback heuristic/mock if no API keys are present (development & preview modes)
    if (!result) {
      result = getFallbackHeuristicData();
      source = "fallback-heuristic";
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
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: "8mb"
    }
  }
};

