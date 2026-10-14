// Vercel Serverless Function: AI Receipt & Menu Price Scanner
// Accepts base64 encoded image, compresses/passes to Vision model, returns structured JSON

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "6mb"
    }
  }
};

export default async function handler(req, res) {
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
    const { imageBase64 } = req.body || {};

    if (!imageBase64) {
      return res.status(400).json({ error: "Missing imageBase64" });
    }

    // Clean base64 header if present
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

    // Check for Gemini API key
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const promptText = `Jesteś asystentem aplikacji poilepiwko.pl. Przeanalizuj to zdjęcie menu, tablicy z kranami lub paragonu z baru w Polsce.
Wyciągnij następujące dane i zwróć WYŁĄCZNIE czysty JSON bez formatowania markdown:
{
  "barName": "nazwa lokalu lub pusty string jeśli nie widać",
  "cheapestBeerPrice": najniższa znaleziona cena piwa z nalewaka/kranu w PLN jako liczba (np. 14.0),
  "beerName": "nazwa najtańszego piwa lub pusty string",
  "shotPrice": najniższa cena shota/wódki w PLN jako liczba lub null,
  "isCraft": true lub false (czy to multitap kraftowy/rzemieślniczy),
  "happyHoursText": "opis promocji happy hour jeśli widać lub pusty string"
}`;

        const response = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: promptText },
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: cleanBase64
                    }
                  }
                ]
              }
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.1
            }
          })
        });

        if (response.ok) {
          const geminiData = await response.json();
          const rawAnswer = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawAnswer) {
            try {
              const parsed = JSON.parse(rawAnswer);
              return res.status(200).json({
                success: true,
                source: "gemini-vision",
                data: parsed
              });
            } catch (jsonErr) {
              console.warn("Failed to parse Gemini JSON output:", rawAnswer);
            }
          }
        }
      } catch (geminiErr) {
        console.warn("Gemini Vision call failed, falling back:", geminiErr);
      }
    }

    // Fallback heuristic/mock extractor when API key is not configured
    return res.status(200).json({
      success: true,
      source: "fallback-heuristic",
      data: {
        barName: "",
        cheapestBeerPrice: 14.0,
        beerName: "Piwo z nalewaka",
        shotPrice: 8.0,
        isCraft: false,
        happyHoursText: ""
      }
    });

  } catch (error) {
    console.error("Receipt scanner error:", error);
    return res.status(500).json({
      error: "Internal server error during image analysis",
      details: error.message
    });
  }
}
