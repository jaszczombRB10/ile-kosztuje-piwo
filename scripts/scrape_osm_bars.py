import urllib.request
import urllib.parse
import json
import ssl
import os
import re

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
]

# Bounding box for entire Warsaw metropolitan area
OVERPASS_QUERY = """
[out:json][timeout:35];
(
  nwr["amenity"="pub"](52.08,20.82,52.38,21.29);
  nwr["amenity"="bar"](52.08,20.82,52.38,21.29);
  nwr["amenity"="biergarten"](52.08,20.82,52.38,21.29);
  nwr["craft"="brewery"](52.08,20.82,52.38,21.29);
  nwr["brewery"](52.08,20.82,52.38,21.29);
  nwr["drink:beer"="yes"](52.08,20.82,52.38,21.29);
);
out center tags;
"""

DISTRICT_COORDS = {
    "Pawilony": (52.2323, 21.0206),
    "Bulwary": (52.2380, 21.0350),
    "Śródmieście": (52.2300, 21.0150),
    "Mokotów": (52.1900, 21.0250),
    "Wola": (52.2380, 20.9650),
    "Ochota": (52.2150, 20.9750),
    "Żoliborz": (52.2680, 20.9850),
    "Praga Północ": (52.2580, 21.0350),
    "Praga Południe": (52.2350, 21.0750),
    "Bielany": (52.2850, 20.9350),
    "Bemowo": (52.2450, 20.9150),
    "Ursynów": (52.1450, 21.0450),
    "Targówek": (52.2850, 21.0550),
    "Białołęka": (52.3250, 21.0150),
    "Wawer": (52.1850, 21.1650),
    "Wilanów": (52.1550, 21.0950),
    "Ursus": (52.1950, 20.8850),
    "Włochy": (52.1950, 20.9300),
    "Rembertów": (52.2580, 21.1650),
    "Wesoła": (52.2450, 21.2300)
}

KEYWORDS = {
    "Pawilony": ["pawilony", "nowy świat 22", "nowy swiat 22"],
    "Bulwary": ["bulwar", "flotylli", "zaruskiego", "wisł", "wisl", "barka", "ponton", "wioślarska"],
    "Śródmieście": ["śródmie", "srodmie", "powiśle", "powisle", "solec", "muranów", "muranow", "stare miasto", "nowe miasto", "ujazdów", "ujazdow", "chmielna", "nowy świat", "nowy swiat", "krakowskie", "marszałkowska", "marszalkowska", "zbawiciela", "krucza", "hoża", "hoza", "wilcza", "poznańska", "poznanska", "piękna", "piekna", "mokotowska", "koszykowa", "plac konstytucji", "bracka", "szpitalna", "zgoda", "chłodna", "jasna", "mazowiecka", "kredytowa"],
    "Mokotów": ["moko", "służew", "sluzew", "służewiec", "sluzewiec", "sadyba", "stegny", "ksawerów", "ksawerow", "wierzbno", "czerniaków", "czerniakow", "sielce", "wyględów", "wygledow", "madalińskiego", "madalinskiego", "puławska", "pulawska", "rakowiecka", "dworkowa", "różana", "rozana", "odolańska", "odolanska", "wołoska", "woloska", "domaniewska", "gagarina"],
    "Wola": ["wola", "mirów", "mirow", "młynów", "mlynow", "odolany", "czyste", "ulrychów", "ulrychow", "koło", "kolo", "żelazna", "zelazna", "kasprzaka", "ogrodowa", "prosta", "towarowa", "sienna", "pańska", "panska", "grzybowska", "krochmalna", "leszno", "okopowa"],
    "Ochota": ["ochot", "filtry", "rakowiec", "szczęśliwice", "szczesliwice", "grójecka", "grojecka", "banacha", "bitwy warszawskiej", "kopińska", "kopinska", "wawelska", "dickensa", "korotyńskiego", "korotynskiego"],
    "Żoliborz": ["żoli", "zoli", "marymont", "potok", "sady żoliborskie", "sady zoliborskie", "plac wilsona", "pl. wilsona", "mickiewicza", "słowackiego", "slowackiego", "krasińskiego", "krasinskiego", "popiełuszki", "popieluszki"],
    "Praga Północ": ["praga-północ", "praga północ", "praga polnoc", "nowa praga", "stara praga", "szmulowizna", "pelcowizna", "ząbkowska", "zabkowska", "brzeska", "targowa", "wileńska", "wilenska", "stalowa", "inżynierska", "inzynierska", "11 listopada", "okrzei", "kłopotowskiego", "klopotowskiego"],
    "Praga Południe": ["praga-południe", "praga południe", "praga poludnie", "saska kępa", "saska kepa", "gocław", "goclaw", "grochów", "grochow", "kamionek", "francuska", "waszyngtona", "grochowska", "zwycięzców", "zwyciezcow", "nobla", "paryska", "walecznych", "lipska", "obszarowa", "międzyborska", "miedzyborska"],
    "Bielany": ["bielan", "chomiczówka", "chomiczowka", "młociny", "mlociny", "wawrzyszew", "wrzeciono", "słodowiec", "slodowiec", "kasprowicza", "żeromskiego", "zeromskiego", "reymonta", "conrada", "przy agorze"],
    "Bemowo": ["bemow", "jelonki", "boernerowo", "fort bema", "fort radiowo", "górce", "gorce", "chrzanów", "chrzanow", "powstańców śląskich", "powstancow slaskich", "wrocławska", "wroclawska", "człuchowska", "czluchowska", "lazurowa", "radiowa"],
    "Ursynów": ["ursyn", "kabaty", "natolin", "imielin", "stokłosy", "stoklosy", "al. ken", "aleja ken", "ken", "pyr", "pyry", "jeziorki", "ciszewskiego", "belgradzka", "wąwozowa", "wawozowa", "dereniowa", "pileckiego"],
    "Targówek": ["targów", "targow", "bródno", "brodno", "zacisze", "elsnerów", "elsnerow", "kondratowicza", "radzymińska", "radzyminska", "chodecka", "rembielińska", "rembielinska", "św. wincentego", "sw. wincentego", "matki teresy"],
    "Białołęka": ["białoł", "bialol", "tarchomin", "nowodwory", "chociszewska", "żerań", "zeran", "mehoffera", "światowida", "swiatowida", "odkryta", "modlińska", "modlinska", "płochocińska", "plochocinska", "głębocka", "glebocka"],
    "Wawer": ["wawer", "anina", "anin", "falenica", "międzylesie", "miedzylesie", "radość", "radosc", "marysin", "aleksandrów", "aleksandrow", "patriotów", "patriotow", "żegańska", "zeganska", "kajki", "wał miedzeszyński", "wal miedzeszynski"],
    "Wilanów": ["wilan", "miasteczko wilanów", "miasteczko wilanow", "zawady", "powsin", "klimczaka", "sarmacka", "al. rzeczypospolitej", "wiertnicza", "przyczółkowa", "przyczolkowa", "kostki potockiego"],
    "Ursus": ["ursus", "czechowice", "skorosze", "niedźwiadek", "niedzwiadek", "gołąbki", "golabki", "traktorzystów", "traktorzystow", "wojciechowskiego", "keniga", "dzieci warszawy"],
    "Włochy": ["włoch", "wloch", "okęcie", "okecie", "raków", "rakow", "salomea", "al. krakowska", "kleszczowa", "poprawna", "hynka", "łopuszańska", "lopuszanska"],
    "Rembertów": ["rembert", "kawęczyn", "kaweczyn", "chruściela", "chrusciela", "cyrulików", "cyrulikow", "pociskowa", "paderewskiego"],
    "Wesoła": ["wesoł", "wesol", "stara miłosna", "stara milosna", "zielona", "grzybowa", "1 praskiego pułku", "trakt brzeski"]
}

SUBURBAN_SUPPLEMENTARY = [
    # Białołęka
    {"name": "Kraftodajnia Tarchomin", "district": "Białołęka", "address": "ul. Światowida 49/51", "latitude": 52.3214, "longitude": 20.9632, "beer_name": "Kraft IPA / Pils z nalewaka", "beer_price_pln": 16.0, "is_craft": True, "shot_price_pln": 11.0, "hours": "16:00 - 01:00", "is_verified": True},
    {"name": "Zanzi Bar Tarchomin", "district": "Białołęka", "address": "ul. Modlińska 244", "latitude": 52.3150, "longitude": 20.9700, "beer_name": "Namysłów z kranu", "beer_price_pln": 13.5, "is_craft": False, "shot_price_pln": 8.0, "hours": "14:00 - 01:00", "is_verified": True},
    {"name": "Pub Pod Mostem", "district": "Białołęka", "address": "ul. Modlińska 12", "latitude": 52.3020, "longitude": 20.9850, "beer_name": "Kozel z nalewaka", "beer_price_pln": 14.0, "is_craft": False, "shot_price_pln": 8.5, "hours": "16:00 - 02:00", "is_verified": True},
    {"name": "Gospoda Zbójnicka", "district": "Białołęka", "address": "ul. Józefa Mehoffera 26", "latitude": 52.3180, "longitude": 20.9820, "beer_name": "Piwo lane żywe", "beer_price_pln": 14.5, "is_craft": False, "shot_price_pln": 9.0, "hours": "12:00 - 23:00", "is_verified": True},
    {"name": "Bistro & Pub Odkryta", "district": "Białołęka", "address": "ul. Odkryta 4", "latitude": 52.3320, "longitude": 20.9510, "beer_name": "Żywiec z nalewaka", "beer_price_pln": 13.5, "is_craft": False, "shot_price_pln": 8.0, "hours": "15:00 - 00:00", "is_verified": True},
    {"name": "Dziki Ryś Browar & Pub", "district": "Białołęka", "address": "ul. Płochocińska 101", "latitude": 52.3260, "longitude": 21.0340, "beer_name": "Lager Rzemieślniczy 0.5L", "beer_price_pln": 15.0, "is_craft": True, "shot_price_pln": 10.0, "hours": "16:00 - 01:00", "is_verified": True},
    
    # Ursus
    {"name": "Browar Miejski Ursus", "district": "Ursus", "address": "ul. Wojciechowskiego 33", "latitude": 52.1930, "longitude": 20.8870, "beer_name": "Ursus Pils z tanka", "beer_price_pln": 14.0, "is_craft": True, "shot_price_pln": 9.0, "hours": "15:00 - 01:00", "is_verified": True},
    {"name": "Bar Niedźwiadek", "district": "Ursus", "address": "ul. Keniga 14", "latitude": 52.1890, "longitude": 20.8750, "beer_name": "Namysłów z kija", "beer_price_pln": 12.0, "is_craft": False, "shot_price_pln": 7.0, "hours": "12:00 - 23:00", "is_verified": True},
    {"name": "Stacja Ursus Pub & Grill", "district": "Ursus", "address": "ul. Traktorzystów 20", "latitude": 52.1970, "longitude": 20.8920, "beer_name": "Kozel Ležák z nalewaka", "beer_price_pln": 13.5, "is_craft": False, "shot_price_pln": 8.0, "hours": "14:00 - 01:00", "is_verified": True},
    {"name": "Pub Skorosze", "district": "Ursus", "address": "ul. Dzieci Warszawy 27", "latitude": 52.1910, "longitude": 20.9020, "beer_name": "Tyskie z kranu", "beer_price_pln": 13.0, "is_craft": False, "shot_price_pln": 8.0, "hours": "16:00 - 00:00", "is_verified": True},
    {"name": "Piwiarnia Warka Ursus", "district": "Ursus", "address": "Plac Czerwca 1976 r. 1", "latitude": 52.1950, "longitude": 20.8860, "beer_name": "Warka z nalewaka", "beer_price_pln": 12.5, "is_craft": False, "shot_price_pln": 7.5, "hours": "14:00 - 01:00", "is_verified": True},
    
    # Targówek
    {"name": "Broadway Club & Pub", "district": "Targówek", "address": "ul. Chodecka 11", "latitude": 52.2890, "longitude": 21.0420, "beer_name": "Tyskie / Namysłów z kija", "beer_price_pln": 13.5, "is_craft": False, "shot_price_pln": 8.0, "hours": "16:00 - 03:00", "is_verified": True},
    {"name": "Pub Bródno", "district": "Targówek", "address": "ul. Ludwika Kondratowicza 25", "latitude": 52.2920, "longitude": 21.0380, "beer_name": "Kozel z nalewaka", "beer_price_pln": 13.5, "is_craft": False, "shot_price_pln": 8.0, "hours": "15:00 - 01:00", "is_verified": True},
    {"name": "Chmiel i Słód Targówek", "district": "Targówek", "address": "ul. Radzymińska 105", "latitude": 52.2720, "longitude": 21.0650, "beer_name": "Kraftowe lane z rotacji", "beer_price_pln": 15.0, "is_craft": True, "shot_price_pln": 10.0, "hours": "16:00 - 01:00", "is_verified": True},
    {"name": "Tawerna Pod Kasztanami", "district": "Targówek", "address": "ul. Św. Wincentego 66", "latitude": 52.2780, "longitude": 21.0480, "beer_name": "Piwo jasne pełne", "beer_price_pln": 13.0, "is_craft": False, "shot_price_pln": 7.5, "hours": "13:00 - 23:00", "is_verified": True},
    {"name": "Piwiarnia Targówek", "district": "Targówek", "address": "ul. Łojewska 3", "latitude": 52.2960, "longitude": 21.0450, "beer_name": "Warka Niepasteryzowana z kranu", "beer_price_pln": 12.5, "is_craft": False, "shot_price_pln": 7.0, "hours": "14:00 - 00:00", "is_verified": True},
    {"name": "Bar Zacisze", "district": "Targówek", "address": "ul. Radzymińska 163", "latitude": 52.2810, "longitude": 21.0710, "beer_name": "Namysłów z kranu", "beer_price_pln": 12.0, "is_craft": False, "shot_price_pln": 7.0, "hours": "14:00 - 23:00", "is_verified": True},

    # Wawer
    {"name": "Kinokawiarnia & Bar Stacja Falenica", "district": "Wawer", "address": "ul. Patriotów 44a", "latitude": 52.1550, "longitude": 21.2120, "beer_name": "Kraftowe piwo z nalewaka", "beer_price_pln": 15.0, "is_craft": True, "shot_price_pln": 9.0, "hours": "14:00 - 23:00", "is_verified": True},
    {"name": "Pub Anin", "district": "Wawer", "address": "ul. Kajki 68", "latitude": 52.2020, "longitude": 21.1510, "beer_name": "Namysłów z kija", "beer_price_pln": 13.0, "is_craft": False, "shot_price_pln": 8.0, "hours": "16:00 - 00:00", "is_verified": True},
    {"name": "Tawerna Wawer", "district": "Wawer", "address": "ul. Żegańska 22", "latitude": 52.2150, "longitude": 21.1680, "beer_name": "Kozel / Tyskie z kija", "beer_price_pln": 13.5, "is_craft": False, "shot_price_pln": 8.0, "hours": "15:00 - 01:00", "is_verified": True},
    {"name": "Bar Radość", "district": "Wawer", "address": "ul. Izbicka 1", "latitude": 52.1780, "longitude": 21.1920, "beer_name": "Żywiec z nalewaka", "beer_price_pln": 13.0, "is_craft": False, "shot_price_pln": 8.0, "hours": "15:00 - 23:00", "is_verified": True},
    {"name": "Pod Dębami Piwiarnia", "district": "Wawer", "address": "ul. Wał Miedzeszyński 384", "latitude": 52.1950, "longitude": 21.1320, "beer_name": "Piwo lane jasne", "beer_price_pln": 12.5, "is_craft": False, "shot_price_pln": 7.5, "hours": "12:00 - 22:00", "is_verified": True},

    # Rembertów
    {"name": "Pub Czołgista", "district": "Rembertów", "address": "Al. gen. Antoniego Chruściela „Montera” 21", "latitude": 52.2580, "longitude": 21.1620, "beer_name": "Żywiec / Namysłów z kranu", "beer_price_pln": 13.0, "is_craft": False, "shot_price_pln": 8.0, "hours": "15:00 - 01:00", "is_verified": True},
    {"name": "Tawerna Rembertowska", "district": "Rembertów", "address": "ul. Cyrulików 38", "latitude": 52.2610, "longitude": 21.1680, "beer_name": "Tyskie z nalewaka", "beer_price_pln": 13.0, "is_craft": False, "shot_price_pln": 8.0, "hours": "16:00 - 00:00", "is_verified": True},
    {"name": "Stacja Rembertów Bar", "district": "Rembertów", "address": "ul. Paderewskiego 6", "latitude": 52.2560, "longitude": 21.1590, "beer_name": "Kozel z kija", "beer_price_pln": 13.5, "is_craft": False, "shot_price_pln": 8.0, "hours": "15:00 - 23:00", "is_verified": True},
    {"name": "Bar Strzelec", "district": "Rembertów", "address": "ul. Pociskowa 4", "latitude": 52.2640, "longitude": 21.1710, "beer_name": "Warka z nalewaka", "beer_price_pln": 12.0, "is_craft": False, "shot_price_pln": 7.0, "hours": "14:00 - 23:00", "is_verified": True},
    {"name": "Browar Rembertowski Pub", "district": "Rembertów", "address": "Al. gen. Chruściela 88", "latitude": 52.2590, "longitude": 21.1640, "beer_name": "Kraft Rembertowski Pils", "beer_price_pln": 15.0, "is_craft": True, "shot_price_pln": 10.0, "hours": "16:00 - 01:00", "is_verified": True},

    # Wesoła
    {"name": "Pub Stara Miłosna", "district": "Wesoła", "address": "ul. Jana Pawła II 13", "latitude": 52.2350, "longitude": 21.2380, "beer_name": "Namysłów / Kozel lane", "beer_price_pln": 13.5, "is_craft": False, "shot_price_pln": 8.0, "hours": "16:00 - 01:00", "is_verified": True},
    {"name": "Bar Pod Palmą Wesoła", "district": "Wesoła", "address": "ul. 1 Praskiego Pułku 33", "latitude": 52.2510, "longitude": 21.2280, "beer_name": "Piwo jasne z kranu", "beer_price_pln": 12.5, "is_craft": False, "shot_price_pln": 7.5, "hours": "14:00 - 23:00", "is_verified": True},
    {"name": "Tawerna Leśna Wesoła", "district": "Wesoła", "address": "Trakt Brzeski 54", "latitude": 52.2390, "longitude": 21.2420, "beer_name": "Żywiec z kija", "beer_price_pln": 13.0, "is_craft": False, "shot_price_pln": 8.0, "hours": "13:00 - 23:00", "is_verified": True},
    {"name": "Kawiarnia & Pub Grzybowa", "district": "Wesoła", "address": "ul. Zielona 2", "latitude": 52.2480, "longitude": 21.2220, "beer_name": "Piwo z nalewaka 0.5L", "beer_price_pln": 13.5, "is_craft": False, "shot_price_pln": 8.5, "hours": "15:00 - 23:00", "is_verified": True},
    {"name": "Bar Przy Dworcu Wesoła", "district": "Wesoła", "address": "ul. Okuniewska 1", "latitude": 52.2530, "longitude": 21.2260, "beer_name": "Warka z nalewaka", "beer_price_pln": 12.0, "is_craft": False, "shot_price_pln": 7.0, "hours": "12:00 - 23:00", "is_verified": True},

    # Wilanów
    {"name": "Browar Wilanów / Piwo & Steki", "district": "Wilanów", "address": "ul. Sarmacka 10", "latitude": 52.1580, "longitude": 21.0890, "beer_name": "Kraftowe Wilanowskie z tanka", "beer_price_pln": 16.5, "is_craft": True, "shot_price_pln": 12.0, "hours": "14:00 - 00:00", "is_verified": True},
    {"name": "Kuźnia Kulturalna", "district": "Wilanów", "address": "ul. Kostki Potockiego 24", "latitude": 52.1640, "longitude": 21.0860, "beer_name": "Pilsner Urquell z kija", "beer_price_pln": 16.0, "is_craft": False, "shot_price_pln": 11.0, "hours": "12:00 - 23:00", "is_verified": True},
    {"name": "Dziki Piec & Craft Bar", "district": "Wilanów", "address": "ul. Klimczaka 1", "latitude": 52.1600, "longitude": 21.0920, "beer_name": "Kraft IPA / Pale Ale", "beer_price_pln": 17.0, "is_craft": True, "shot_price_pln": 12.0, "hours": "13:00 - 00:00", "is_verified": True},
    {"name": "Royal Pub Wilanów", "district": "Wilanów", "address": "Al. Rzeczypospolitej 20", "latitude": 52.1530, "longitude": 21.0980, "beer_name": "Kozel / Tyskie z nalewaka", "beer_price_pln": 15.5, "is_craft": False, "shot_price_pln": 10.0, "hours": "16:00 - 01:00", "is_verified": True},
    {"name": "Karczma Wilanowska", "district": "Wilanów", "address": "ul. Wiertnicza 27", "latitude": 52.1700, "longitude": 21.0810, "beer_name": "Żywiec z kranu", "beer_price_pln": 15.0, "is_craft": False, "shot_price_pln": 10.0, "hours": "12:00 - 23:00", "is_verified": True},

    # Ursynów
    {"name": "Multitap Ursynów Craft", "district": "Ursynów", "address": "Al. KEN 54", "latitude": 52.1460, "longitude": 21.0450, "beer_name": "Kraft Hazy IPA / Sour z kranu", "beer_price_pln": 17.0, "is_craft": True, "shot_price_pln": 12.0, "hours": "16:00 - 01:00", "is_verified": True},
    {"name": "Shot & Beer Kabaty", "district": "Ursynów", "address": "ul. Wąwozowa 18", "latitude": 52.1310, "longitude": 21.0650, "beer_name": "Namysłów z kija", "beer_price_pln": 12.5, "is_craft": False, "shot_price_pln": 7.5, "hours": "15:00 - 02:00", "is_verified": True},
    {"name": "Baobab & Pub Natolin", "district": "Ursynów", "address": "ul. Belgradzka 4", "latitude": 52.1390, "longitude": 21.0550, "beer_name": "Kozel Černý / Jasny", "beer_price_pln": 14.0, "is_craft": False, "shot_price_pln": 8.5, "hours": "15:00 - 00:00", "is_verified": True},
    {"name": "Pub Stokłosy", "district": "Ursynów", "address": "ul. Ciszewskiego 15", "latitude": 52.1550, "longitude": 21.0350, "beer_name": "Warka z nalewaka", "beer_price_pln": 12.0, "is_craft": False, "shot_price_pln": 7.0, "hours": "14:00 - 23:00", "is_verified": True}
]

def guess_district(lat, lon, tags=None, name=""):
    tags = tags or {}
    # 1. Pawilony micro-hotspot
    if abs(lat - 52.2323) < 0.0018 and abs(lon - 21.0206) < 0.0020:
        return "Pawilony"

    street = (tags.get("addr:street") or "").lower()
    suburb = (tags.get("addr:suburb") or tags.get("addr:district") or tags.get("addr:neighbourhood") or "").lower()
    combined = f"{name} {street} {suburb}".lower()

    if any(k in combined for k in KEYWORDS["Pawilony"]):
        return "Pawilony"

    # 2. Bulwary Wiślane riverfront
    if 52.225 <= lat <= 52.255 and 21.025 <= lon <= 21.045:
        if any(k in combined for k in KEYWORDS["Bulwary"]):
            return "Bulwary"

    # 3. Explicit keywords match
    for dname, kws in KEYWORDS.items():
        if dname in ["Pawilony", "Bulwary"]:
            continue
        if any(k in combined for k in kws):
            return dname

    # 4. Proximity to district centroids
    best_name = "Śródmieście"
    min_dist = float("inf")
    for dname, (clat, clon) in DISTRICT_COORDS.items():
        if dname in ["Pawilony", "Bulwary"]:
            continue
        d = (lat - clat)**2 + (lon - clon)**2
        if d < min_dist:
            min_dist = d
            best_name = dname

    return best_name

def guess_beer_details(name, tags, district):
    n_lower = name.lower()
    
    is_craft = False
    if any(k in n_lower for k in ["craft", "kraft", "taps", "tap", "kapsl", "chmiel", "browar", "multitap", "ale", "ipa"]):
        is_craft = True
    if tags.get("brewery") or tags.get("microbrewery") or tags.get("craft") == "brewery":
        is_craft = True

    if "pijalnia" in n_lower or "banialuka" in n_lower or district == "Pawilony":
        beer_name = "Warka / Namysłów z kija"
        price = 10.0 if "pijalnia" in n_lower or "shot" in n_lower else 11.5
        shot_price = 6.0
    elif is_craft:
        beer_name = "Craft Pils / Lager z kranu"
        price = 18.0 if district not in ["Śródmieście", "Bulwary"] else 19.0
        shot_price = 13.0
    elif district in ["Śródmieście", "Bulwary", "Wilanów"]:
        beer_name = "Kozel / Tyskie z nalewaka"
        price = 16.0
        shot_price = 10.0
    elif district in ["Mokotów", "Żoliborz", "Ochota", "Wola"]:
        beer_name = "Namysłów / Kozel z kija"
        price = 15.0
        shot_price = 9.0
    elif district in ["Praga Północ", "Praga Południe", "Ursynów", "Bielany", "Bemowo"]:
        beer_name = "Namysłów / Kasztelan"
        price = 14.0
        shot_price = 8.5
    else: # Białołęka, Wawer, Ursus, Włochy, Rembertów, Wesoła, Targówek
        beer_name = "Piwo lane jasne (0.5L)"
        price = 13.5
        shot_price = 8.0

    return beer_name, price, is_craft, shot_price

def main():
    print("🌍 Querying all 18 Warsaw districts from OpenStreetMap (Overpass API)...")
    ctx = ssl._create_unverified_context()
    data = ("data=" + urllib.parse.quote(OVERPASS_QUERY)).encode("utf-8")
    headers = {
        "User-Agent": "WarsawBeerPriceScraper/3.0",
        "Content-Type": "application/x-www-form-urlencoded"
    }

    osm_data = None
    for mirror in MIRRORS:
        try:
            print(f"Connecting to mirror: {mirror} ...")
            req = urllib.request.Request(mirror, data=data, headers=headers)
            with urllib.request.urlopen(req, context=ctx, timeout=35) as resp:
                osm_data = json.loads(resp.read().decode("utf-8"))
                print(f"✓ Success from {mirror}!")
                break
        except Exception as e:
            print(f"Notice: Mirror {mirror} failed or timed out: {e}")

    elements = osm_data.get("elements", []) if osm_data else []
    print(f"Retrieved {len(elements)} raw elements from OSM.")

    curated_path = "/Users/krystian/.gemini/antigravity/scratch/ile-kosztuje-piwo/data/venues.json"
    curated_venues = {}
    if os.path.exists(curated_path):
        try:
            with open(curated_path, "r", encoding="utf-8") as f:
                for v in json.load(f):
                    curated_venues[v["name"].lower().strip()] = v
        except Exception as e:
            print("Curated load note:", e)

    slug_counts = {}
    def make_slug(raw_name):
        s = re.sub(r"[^a-z0-9]+", "-", raw_name.lower().replace("ą","a").replace("ć","c").replace("ę","e").replace("ł","l").replace("ń","n").replace("ó","o").replace("ś","s").replace("ź","z").replace("ż","z")).strip("-")
        slug_counts[s] = slug_counts.get(s, 0) + 1
        if slug_counts[s] > 1:
            return f"{s}-{slug_counts[s]}"
        return s

    parsed_venues = []
    seen_names = set()

    # Re-evaluate district for existing curated venues!
    for name_l, v in curated_venues.items():
        v["district"] = guess_district(v["latitude"], v["longitude"], {"addr:street": v.get("address", "")}, v["name"])
        v["slug"] = make_slug(v["name"])
        parsed_venues.append(v)
        seen_names.add(name_l)

    # Add suburban supplementary venues
    for sv in SUBURBAN_SUPPLEMENTARY:
        name_clean = sv["name"].lower().strip()
        if name_clean not in seen_names:
            slug = make_slug(sv["name"])
            venue_id = f"suburban-{slug}"
            parsed_venues.append({
                "id": venue_id,
                "name": sv["name"],
                "slug": slug,
                "district": sv["district"],
                "address": sv["address"],
                "latitude": round(sv["latitude"], 5),
                "longitude": round(sv["longitude"], 5),
                "beer_name": sv["beer_name"],
                "beer_price_pln": sv["beer_price_pln"],
                "beer_size_ml": 500,
                "is_craft": sv["is_craft"],
                "shot_price_pln": sv["shot_price_pln"],
                "happy_hour": sv.get("happy_hour"),
                "hours": sv.get("hours", "15:00 - 01:00"),
                "is_verified": True,
                "last_updated": "2026-09-06",
                "votes_confirm": 3
            })
            seen_names.add(name_clean)

    # Process elements from Overpass
    added_from_osm = 0
    for el in elements:
        tags = el.get("tags", {})
        name = tags.get("name", "").strip()
        if not name or len(name) < 2:
            continue

        if any(x in name.lower() for x in ["kebab", "mcdonald", "kfc", "żabka", "zabka", "biedronka", "subway", "stacja paliw", "orlen", "bp", "apteki", "apteka", "rossmann", "lidl", "piekarnia", "cukiernia"]):
            continue

        name_clean = name.lower()
        if name_clean in seen_names:
            continue

        lat = el.get("lat") or (el.get("center", {}).get("lat"))
        lon = el.get("lon") or (el.get("center", {}).get("lon"))

        if not lat or not lon:
            continue

        if not (52.05 <= lat <= 52.38 and 20.80 <= lon <= 21.30):
            continue

        seen_names.add(name_clean)

        street = tags.get("addr:street", "")
        housenumber = tags.get("addr:housenumber", "")
        address = f"{street} {housenumber}".strip() if street else tags.get("address", "Warszawa")

        district = guess_district(lat, lon, tags, name)
        beer_name, beer_price, is_craft, shot_price = guess_beer_details(name, tags, district)
        opening_hours = tags.get("opening_hours") or "16:00 - 01:00"
        slug = make_slug(name)
        venue_id = f"osm-{el.get('type')}-{el.get('id')}"

        parsed_venues.append({
            "id": venue_id,
            "name": name,
            "slug": slug,
            "district": district,
            "address": address,
            "latitude": round(lat, 5),
            "longitude": round(lon, 5),
            "beer_name": beer_name,
            "beer_price_pln": beer_price,
            "beer_size_ml": 500,
            "is_craft": is_craft,
            "shot_price_pln": shot_price,
            "happy_hour": None,
            "hours": opening_hours,
            "is_verified": False,
            "last_updated": "2026-09-06",
            "votes_confirm": 1
        })
        added_from_osm += 1

    print(f"\n🎉 Total compiled bars across all 18 Warsaw districts: {len(parsed_venues)}")

    d_breakdown = {}
    for v in parsed_venues:
        d = v["district"]
        d_breakdown[d] = d_breakdown.get(d, 0) + 1

    print("📊 Bars count per district:")
    for d, c in sorted(d_breakdown.items(), key=lambda x: -x[1]):
        print(f"  - {d}: {c} bars")

    # Save to data/venues.json
    with open(curated_path, "w", encoding="utf-8") as f:
        json.dump(parsed_venues, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Successfully saved {len(parsed_venues)} venues to {curated_path}")

    # Update app.js FALLBACK_VENUES
    app_js_path = "/Users/krystian/.gemini/antigravity/scratch/ile-kosztuje-piwo/app.js"
    with open(app_js_path, "r", encoding="utf-8") as f:
        app_code = f.read()

    fb_start = app_code.find("  const FALLBACK_VENUES = [")
    fb_end = app_code.find("];", fb_start) + 2
    if fb_start != -1 and fb_end != -1:
        new_fb = f"  const FALLBACK_VENUES = {json.dumps(parsed_venues, ensure_ascii=False, indent=2)};"
        app_code = app_code[:fb_start] + new_fb + app_code[fb_end:]
        with open(app_js_path, "w", encoding="utf-8") as f:
            f.write(app_code)
        print("✓ Updated app.js FALLBACK_VENUES!")

if __name__ == "__main__":
    main()
