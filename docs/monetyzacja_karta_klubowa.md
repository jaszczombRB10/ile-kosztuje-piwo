# 🍺 Karta Klubowa „PoIlePiwko Pass” – Strategia Monetyzacji i Projekt Karty 💳✨

> **Link do tej konwersacji (zapisana na stałe):** [Przejdź do tej rozmowy](conversation://7d8d935f-6ad4-4c25-9514-14ee99a567b6)  
> **Data opracowania:** 14 września 2026 r.  
> **Status:** Opracowane (Gotowe do wdrożenia w Etapie 1)

---

## 🎨 Wizualizacja Wirtualnej Karty Klubowej

Oto zaprojektowany koncept wirtualnej karty członkowskiej **PoIlePiwko Pass**, przygotowanej do integracji z Apple Wallet oraz Google Wallet:

![Wizualizacja Wirtualnej Karty Klubowej PoIlePiwko Pass](/Users/krystian/.gemini/antigravity/brain/7d8d935f-6ad4-4c25-9514-14ee99a567b6/poilepiwko_pass_card_1789339599477.jpg)

### Cechy wizualne projektu:
* **Materiał i stylistyka:** Matowy obsydian / ciemne szkło (Dark Frosted Glass) z motywem bursztynowej fali piwa w płynnym gradiencie.
* **Akcenty:** Złote tłoczenia (Gold Foil), złota fazowana ramka dookoła karty.
* **Identyfikacja:** Emblemat kufla piwa ze złotą pianą i gwiazdką, napis `POILEPIWKO PASS` oraz `WARSZAWA -10% PIWNY RABAT`.
* **Personalizacja użytkownika:** `Member Name: KRYSTIAN`, unikalny numer wczesnego piwosza `Membership No. #000001` oraz data ważności.
* **Weryfikacja w barze:** Czytelny kod QR (lub kod kreskowy) do szybkiej weryfikacji lub natychmiastowego rzucenia okiem przez barmana.

---

## 🎯 1. Koncepcja Biznesowa (The Core Value)

**PoIlePiwko Pass** to wirtualna karta członkowska dla mieszkańców Warszawy i bywalców lokali, która:
1. **Dla Użytkownika:** Daje gwarantowane **10% zniżki na piwo** (lub happy hour przez cały dzień) w oficjalnych lokalach partnerskich w Warszawie.
2. **Dla Baru:** Generuje stały dopływ klientów z aplikacji (zwłaszcza w dniach niedziela–czwartek), bez ponoszenia kosztów tradycyjnej reklamy.
3. **Dla Twórcy (Ciebie):** Zapewnia **powtarzalny, pasywny przychód abonamentowy (MRR / ARR)** od tysięcy użytkowników oraz pakiety sponsorskie B2B od barów.

---

## 💰 2. Model Monetyzacji i Cennik

### A. Subskrypcja Użytkowników (B2C) – Główny motor przychodu
Cena musi być psychologicznym „no-brainerem” (zwracać się po 1–2 wyjściach na miasto):
* **Pakiet Roczny:** **24,99 zł / rok** (wychodzi ok. 2,08 zł / miesiąc – mniej niż cena gumy do żucia).
* **Pakiet Miesięczny:** **4,99 zł / miesiąc** (dla osób wychodzących okazjonalnie lub turystów).
* **Okres próbny:** **14 dni darmowego testu** przy rejestracji karty.

#### 📈 Przykładowa kalkulacja przychodu B2C:
* **1 000 subskrybentów:** 25 000 zł rocznie
* **3 000 subskrybentów:** 75 000 zł rocznie
* **10 000 subskrybentów:** 250 000 zł rocznie (potencjał studencki Warszawy to ponad 200 tys. osób).

---

### B. Oferta dla Barów (B2B) – Druga noga finansowa

#### Faza 1 (Pierwsze 15–20 barów – BEZPŁATNY PILOTAŻ):
* **Cena dla baru: 0 zł.**
* Bar oferuje 10% rabatu na okazanie karty, a w zamian otrzymuje:
  * Złotą odznakę `⭐ Lokal Partnerski (-10%)` na mapie i w profilu lokalu.
  * Priorytet w filtrach wyszukiwania (`Pokaż ze zniżką klubu`).
  * Darmowy napływ gości.

#### Faza 2 (Po osiągnięciu bazy klubowiczów):
* **Pakiet Podstawowy:** 50 zł / rok (lub darmowy w zamian za rabat 10%).
* **Pakiet „Bar Miesiąca” / VIP:** 99 zł / miesiąc:
  * Wyróżniony pulsujący marker na mapie.
  * Powiadomienie push do klubowiczów w okolicy w piątek/sobotę: *„Dziś w lokalu X zniżka 15% na kranach!”*.
  * Baner na samej górze rankingu piw w aplikacji.

---

## 📲 3. Integracja z Apple Wallet & Google Wallet

### A. Apple Wallet (`.pkpass`):
* Format: Standardowy **Store Card Pass** lub **Generic Pass**.
* Kolorystyka: Głęboka czerń/obsydian (`#0f172a`), złoty gradient bursztynowy (`#f59e0b` / `#fbbf24`), biała typografia.
* Przycisk w profilu: `Dodaj do Apple Wallet` (z oficjalną czarną plakietką Apple).

### B. Google Wallet (Google Pay API for Passes):
* Przycisk `Zapisz w Google Wallet`.
* Powiadomienia geolokalizacyjne: telefon wyświetla przypomnienie w promieniu 100m od lokalu partnerskiego.

---

## 🛡️ 4. Aspekty Prawne (Ustawa o wychowaniu w trzeźwości)

* Rabaty i karty lojalnościowe w ramach **zamkniętego klubu członkowskiego** (tylko dla pełnoletnich zarejestrowanych osób po weryfikacji 18+) są w 100% legalne i powszechnie stosowane.
* W regulaminie programu zaznaczamy, że rabat jest przyznawany przez lokal na mocy jego wewnętrznej polityki cenowej, a aplikacja świadczy usługę identyfikacji członka klubu.

---

## 🗺️ 5. Harmonogram Wdrożenia (Roadmap)

| Etap | Zadanie | Czas realizacji |
| :--- | :--- | :--- |
| **Etap 1** | Zaprojektowanie wirtualnej karty w profilu aplikacji (HTML/CSS glassmorphism) | 1–2 dni |
| **Etap 2** | Przygotowanie szablonu wiadomości do menedżerów barów i pozyskanie pierwszych 5–10 lokali pilotażowych | 1 tydzień |
| **Etap 3** | Wdrożenie endpointu generowania `.pkpass` dla Apple Wallet oraz Google Pass | 3–5 dni |
| **Etap 4** | Podpięcie bramek płatności (Stripe / BLIK) i start sprzedaży subskrypcji | 1 tydzień |
