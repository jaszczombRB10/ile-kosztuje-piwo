# 🍺 Ile Kosztuje Piwo? (Warszawa)

Interaktywny tracker cen piwa w warszawskich barach, pubach i multitapach, zoptymalizowany i stworzony w oparciu o architekturę szwedzkiej aplikacji **Vad Kostar Ölen** (Ölkartan).

## 🚀 Jak uruchomić lokalnie

W terminalu przejdź do katalogu projektu:
```bash
cd /Users/krystian/.gemini/antigravity/scratch/ile-kosztuje-piwo
python3 server.py
```
Otwórz w przeglądarce: **[http://localhost:8080](http://localhost:8080)**

Możesz także otworzyć plik `index.html` bezpośrednio w dowolnej przeglądarce.

## 🎯 Główne funkcje prototypu

1. **Ciemna mapa w stylu CartoDB Dark Matter**:
   - Wycentrowana na Śródmieście i Pawilony Nowy Świat (`52.2319° N, 21.0185° E`).
2. **Dynamiczne odznaki cenowe (3 poziomy cenowe)**:
   - 🟢 **Zielony (≤ 12.00 zł)**: Lokale studenckie i shot bary (Pijalnia, Pawilony, BaniaLuka).
   - 🟡 **Bursztynowy (13.00 – 18.00 zł)**: Standardowe puby, lane lagery (Kozel, Namysłów, Żywiec).
   - 🔴 **Czerwony (19.00+ zł)**: Multitapy kraftowe (Jabeerwocky, Kufle i Kapsle, Same Krafty).
   - ⭐ **Fioletowa gwiazdka**: Wyróżnienie lokali rzemieślniczych (craft beer).
3. **Filtry i wyszukiwarka na żywo**:
   - Szybkie filtry: *Wszystkie, Pawilony, Śródmieście, Praga, Bulwary, ≤12 zł, 13–18 zł, 19+ zł, Krafty, Happy Hour*.
   - Wyszukiwanie po nazwie baru, ulicy lub marce piwa.
4. **Ranking Top 10 (Szuflada wysuwana z prawej)**:
   - Kliknięcie w bar w rankingu płynnie przenosi kamerę mapy (`flyTo`) i otwiera szczegółowy dymek z cenami.
5. **Moduł społecznościowy ("Zgłoś cenę")**:
   - Użytkownicy mogą aktualizować cenę w istniejącym lokalu lub dodać nowy bar.
   - Zmiany zapisują się natychmiast w `localStorage` i pojawiają się na mapie w czasie rzeczywistym.
6. **Live Ticker**:
   - Animowany pasek z najświeższymi ofertami i cenami z różnych dzielnic Warszawy.

## 🗂 Struktura projektu

```
ile-kosztuje-piwo/
├── index.html        # Główny layout i UI
├── styles.css        # Stylistyka dark theme, odznaki Leaflet, animacje
├── app.js            # Silnik mapy, logika filtrów, ranking i crowdsourcing
├── server.py         # Lokalny serwer developerski
├── README.md         # Dokumentacja projektu
└── data/
    └── venues.json   # Baza 29 kultowych warszawskich lokali
```
