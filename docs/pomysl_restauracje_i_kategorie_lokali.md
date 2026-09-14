# 🍽️ Koncepcja: Restauracje, Gastropuby i Kategorie Lokali w PoIlePiwko

> **Data zapisania:** 14 września 2026 r.  
> **Status:** 💡 Pomysł i strategia biznesowa (zamrożone w backlogu do realizacji w kolejnym etapie)  
> **Powiązanie:** [Karta Klubowa PoIlePiwko Pass](file:///Users/krystian/.gemini/antigravity/scratch/ile-kosztuje-piwo/docs/monetyzacja_karta_klubowa.md)

---

## 🔍 1. Punkt wyjścia (Obserwacja)
Na mapie warszawskich lokali (np. przy ul. Grójeckiej 118 na Ochocie obok baru *Pochwała Niekonsekwencji*) znajduje się lokal **Restauracja Amarant**. Został on zaciągnięty z OpenStreetMap, ponieważ w danych figurował jako serwujący piwo (`drink:beer=yes` / `amenity=pub`). 

W praktyce jest to jednak lokal z polską kuchnią domową i obiadową, a nie klasyczny bar na wieczorne piwo przy ladzie.

---

## 💡 2. Potencjał Biznesowy dla Programu Rabatowego (PoIlePiwko Pass)

Włączenie restauracji i gastropubów do ekosystemu rabatowego to ogromna szansa rynkowa:

1. **Wysoki średni koszyk (AOV):**
   - W klasycznym barze/pijalni gość wydaje 20–40 zł na piwo i shoty.
   - W restauracji gość zamawia obiad lub kolację z napojami za 60–140 zł.
2. **Większa skłonność restauratorów do dawania rabatów:**
   - W barze marża na tanim piwie jest niska, więc rabat boli właściciela.
   - Restaurator chętnie zaoferuje w aplikacji benefit (np. *„Drugie piwo -50% przy zamówieniu dania głównego”* lub *„-15% na cały rachunek z kartą PoIlePiwko Pass”*), ponieważ zależy mu na zapełnieniu stolików w dniach od poniedziałku do czwartku.
3. **Zaspokojenie częstej potrzeby użytkowników:**
   - „Gdzie pójść ze znajomymi coś zjeść na mieście, żeby nie zbankrutować na piwie za 24 zł?”.
4. **Budżety marketingowe:**
   - Restauracje dysponują większymi budżetami na pakiety promocyjne i wyróżnienia na mapie niż małe osiedlowe piwiarnie.

---

## ⚠️ 3. Kluczowe Zasady i Ochrona Charakteru Aplikacji (Guardrails)

Aplikacja **nie może stać się kopią Google Maps** z 5000 losowych punktów gastronomicznych (kebabownie, sushi na wynos, cukiernie).

### Kryteria selekcji restauracji:
- ✅ Posiadają **piwo z kranu / nalewaka / tanka / krafty**.
- ✅ Są gastropubami, browarami restauracyjnymi (np. *Browar Warszawski*, *Bierhalle*) lub restauracjami z dużym ogródkiem i klimatem do posiedzenia ze znajomymi.
- ✅ Przystępują do programu partnerskiego **PoIlePiwko Pass** (oferują rabat dla klubowiczów).

---

## 🛠️ 4. Proponowana Architektura Techniczna (Gdy będziemy wdrażać)

### A. Pole kategoryzacji (`venue_type` w bazie):
- 🍺 `pub_bar` – **Pub / Bar / Pijalnia** (np. *Plan B*, *W Oparach Absurdu*, *BaniaLuka*)
- ⭐ `craft` – **Multitap / Kraft** (np. *Jabeerwocky*, *PINTA*, *The Taps*)
- 🍽️ `restaurant` – **Restauracja & Gastro** (np. *Amarant*, *Bierhalle*, *Kufle i Widelce*)
- 🪩 `club_cafe` – **Klub / Klubokawiarnia** (np. *Bar Studio*, *Chmury*)

### B. Warstwa UI i Filtrowanie:
- **Etykieta w popupie:** Odznaka `🍽️ Restauracja` obok ceny piwa, aby użytkownik wiedział, czy idzie na szybkie piwo przy barze, czy do stolika obiadowego.
- **Szybki filtr na górze mapy:** `Wszystkie` | `Tylko Bary` | `Restauracje & Jedzenie`.
- **Złota karta rabatowa:** Wyróżniony badge `🎟️ Zniżka z PoIlePiwko Pass` dla lokali dających rabat.

---

## 📌 Status
Pomysł został udokumentowany i odłożony do wdrożenia w momencie uruchamiania programu partnerskiego i pozyskiwania pierwszych lokali do karty klubowej.
