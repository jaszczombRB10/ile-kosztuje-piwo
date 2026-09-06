// ==========================================================================
// SUPABASE CONFIGURATION - ILE KOSZTUJE PIWO
// ==========================================================================

const SUPABASE_CONFIG = {
  url: "https://agsodpzkytdgicpmphxz.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3MTgyNzMsImV4cCI6MjEwNDI5NDI3M30.u2SKFT2u3GuUa4Phc4ijcbHmYdviDDRizFZXkhyNYGg"
};

// Pomocnik sprawdzający, czy konfiguracja została uzupełniona
function isSupabaseConfigured() {
  return Boolean(
    SUPABASE_CONFIG.url && 
    SUPABASE_CONFIG.anonKey && 
    !SUPABASE_CONFIG.url.includes("YOUR_") &&
    SUPABASE_CONFIG.url.startsWith("https://")
  );
}

// CARTO BASEMAPS CONFIGURATION
// Od sierpnia 2024 CARTO wymaga darmowego klucza API na domenach zewnętrznych.
// Darmowy klucz (5 mln odsłon/mc, bez karty): https://carto.com/basemaps/apikey/
const MAP_CONFIG = {
  cartoApiKey: "cb1_2zfc_1_475ac10cb6f273993fced4db"
};
