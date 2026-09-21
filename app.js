// ==========================================================================
// POILEPIWKO - WARSZAWA (Warsaw Beer Price Tracker & Pub Crawl)
// ==========================================================================

(function () {
  "use strict";

  // Configuration
  const WARSAW_CENTER = [52.2319, 21.0185]; // Centered on Śródmieście / Nowy Świat
  const DEFAULT_ZOOM = 13;

  const DISTRICT_CENTERS = {
    "all": { coords: [52.2319, 21.0067], zoom: 12 },
    "Pawilony": { coords: [52.2323, 21.0206], zoom: 17 },
    "Bulwary": { coords: [52.2380, 21.0350], zoom: 15 },
    "Śródmieście": { coords: [52.2300, 21.0150], zoom: 14 },
    "Mokotów": { coords: [52.1900, 21.0250], zoom: 13 },
    "Wola": { coords: [52.2380, 20.9650], zoom: 14 },
    "Ochota": { coords: [52.2150, 20.9750], zoom: 14 },
    "Żoliborz": { coords: [52.2680, 20.9850], zoom: 14 },
    "Praga Północ": { coords: [52.2580, 21.0350], zoom: 14 },
    "Praga Południe": { coords: [52.2350, 21.0750], zoom: 14 },
    "Bielany": { coords: [52.2850, 20.9350], zoom: 13 },
    "Bemowo": { coords: [52.2450, 20.9150], zoom: 13 },
    "Ursynów": { coords: [52.1450, 21.0450], zoom: 13 },
    "Targówek": { coords: [52.2850, 21.0550], zoom: 13 },
    "Białołęka": { coords: [52.3250, 21.0150], zoom: 13 },
    "Wawer": { coords: [52.1850, 21.1650], zoom: 13 },
    "Wilanów": { coords: [52.1550, 21.0950], zoom: 13 },
    "Ursus": { coords: [52.1950, 20.8850], zoom: 14 },
    "Włochy": { coords: [52.1950, 20.9300], zoom: 13 },
    "Rembertów": { coords: [52.2580, 21.1650], zoom: 13 },
    "Wesoła": { coords: [52.2450, 21.2300], zoom: 13 }
  };

  const CRAWL_HOTSPOTS = {
    "pawilony": { name: "Pawilony Nowy Świat", coords: [52.2323, 21.0206] },
    "nowogrodzka": { name: "Nowogrodzka & Poznańska", coords: [52.2289, 21.0118] },
    "bulwary": { name: "Bulwary Wiślane", coords: [52.2385, 21.0295] },
    "zbawiciela": { name: "Plac Zbawiciela", coords: [52.2199, 21.0185] },
    "praga": { name: "Praga (Ząbkowska / Okrzei)", coords: [52.2530, 21.0390] },
    "wola": { name: "Wola (Chłodna / Grzybowska)", coords: [52.2355, 20.9880] }
  };

  let map;
  let mapTileLayer = null;
  let allVenues = [];
  let activeMarkers = [];
  let clusterGroup = null;
  let cityMarkersGroup = null;
  let currentFilter = "all";
  let filterState = {
    priceTier: "all",
    maxPrice: null,
    openNow: false,
    craftOnly: false,
    happyHourOnly: false,
    favoritesOnly: false,
    nonAlcoholicOnly: false
  };
  let currentDistrict = "all";
  let searchQuery = "";
  let supabaseClient = null;
  let userLocation = null;
  let userMarker = null;
  let isSimulatedLocation = false;
  let isLocationFarAway = false;
  let rankingMode = "cheapest"; // "cheapest" | "nearest"
  let currentPhotoBase64 = null;
  let currentPhotoContentType = "image/jpeg";

  // Pub Crawl state
  let crawlMapLayer = null;
  let activeCrawlRoute = null;
  let currentCrawlStopsCount = 3;
  let currentCrawlVibe = "cheap";

  // Piwny Paszport & Happy Hour state
  const PASSPORT_STORAGE_KEY = "poilepiwko_passport_visited";
  const PASSPORT_BADGES_KEY = "poilepiwko_unlocked_badges";
  let visitedVenues = loadVisitedVenues();

  // Ulubione lokale (Favorites) state
  const FAVORITES_STORAGE_KEY = "poilepiwko_favorite_venues";
  let favoriteVenues = loadFavoriteVenues();

  // Supabase Auth & Community Social State
  let currentUser = null;
  let currentProfile = null;
  let myFollowingIds = [];
  let myNotifications = [];
  let unreadNotificationsCount = 0;
  let knownNotificationIds = new Set();
  let isFetchingNotifications = false;

  function loadFavoriteVenues() {
    try {
      const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveFavoriteVenues(favs) {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favs));
    } catch (e) {}
  }

  function isVenueFavorite(venueId) {
    return favoriteVenues.includes(venueId);
  }

  function updateFavoriteCounters() {
    const count = favoriteVenues.length;
    const badge = document.getElementById("fav-count-badge");
    if (badge) badge.textContent = count;
    const drawerBadge = document.getElementById("drawer-fav-count");
    if (drawerBadge) drawerBadge.textContent = count;
  }

  function loadVisitedVenues() {
    try {
      const raw = localStorage.getItem(PASSPORT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function isVenueVisited(venueId) {
    return visitedVenues.includes(venueId);
  }

  function getActiveHappyHour(venue, now = new Date()) {
    const rule = venue.happy_hour_rule;
    if (!rule || !Array.isArray(rule.days)) return null;

    const currentDay = now.getDay();
    if (!rule.days.includes(currentDay)) return null;

    const curM = now.getHours() * 60 + now.getMinutes();
    const startM = (rule.start_hour || 0) * 60 + (rule.start_minute || 0);
    const endM = (rule.end_hour || 0) * 60 + (rule.end_minute || 0);

    if (endM <= startM) {
      // Midnight crossing (e.g. 20:00 - 02:00)
      const isActive = (curM >= startM || curM < endM);
      if (!isActive) return null;
      const minutesLeft = curM >= startM ? (24 * 60 - curM) + endM : endM - curM;
      return { rule, minutesLeft };
    } else {
      if (curM >= startM && curM < endM) {
        const minutesLeft = endM - curM;
        return { rule, minutesLeft };
      }
    }
    return null;
  }

  function formatMinutesLeft(minutes) {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  // Initialize Supabase client if configured in config.js
  function initSupabase() {
    if (typeof isSupabaseConfigured === "function" && isSupabaseConfigured() && window.supabase) {
      try {
        supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
        console.log("⚡ Supabase connected successfully!");
        setupSupabaseRealtime();
        setupSupabaseAuth();
      } catch (err) {
        console.warn("Supabase init error:", err);
      }
    }
  }

  // Subscribe to real-time changes
  function setupSupabaseRealtime() {
    if (!supabaseClient) return;
    try {
      supabaseClient
        .channel("public-venues")
        .on("postgres_changes", { event: "*", schema: "public", table: "venues" }, (payload) => {
          console.log("Realtime event from Supabase:", payload);
          if (payload.eventType === "INSERT") {
            allVenues.unshift(payload.new);
            renderMarkers();
          } else if (payload.eventType === "UPDATE") {
            const idx = allVenues.findIndex(v => v.id === payload.new.id || v.osm_id === payload.new.osm_id);
            if (idx !== -1) {
              allVenues[idx] = Object.assign({}, allVenues[idx], payload.new);
              renderMarkers();
            }
          }
        })
        .subscribe();
    } catch (e) {
      console.warn("Realtime subscription note:", e);
    }
  }

  // Haversine distance calculator
  function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Theme Management (Ciemny, Jasny, Auto / Systemowy)
  const THEME_STORAGE_KEY = "poilepiwko_theme";

  function getSavedThemePreference() {
    return localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  }

  function getEffectiveTheme() {
    const pref = getSavedThemePreference();
    if (pref === "auto") {
      return (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) ? "light" : "dark";
    }
    return pref; // 'dark' or 'light'
  }

  function updateMapTilesForTheme(isLight) {
    const cartoKey = (typeof MAP_CONFIG !== "undefined" && MAP_CONFIG.cartoApiKey) ? `?key=${MAP_CONFIG.cartoApiKey}` : "";
    const variant = isLight ? "light_all" : "dark_all";
    if (mapTileLayer) {
      mapTileLayer.setUrl(`https://{s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png${cartoKey}`);
    }
    if (typeof window.__updateFriendsMapTheme === "function") {
      window.__updateFriendsMapTheme(isLight);
    }
  }

  function applyTheme(themePref) {
    if (!["dark", "light", "auto"].includes(themePref)) {
      themePref = "dark";
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePref);
    } catch (e) {}

    const effectiveTheme = (themePref === "auto")
      ? (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark")
      : themePref;

    const isLight = effectiveTheme === "light";
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    document.body.classList.toggle("theme-light", isLight);

    // Update browser navigation bar color (iOS Safari / Android Chrome)
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", isLight ? "#f8fafc" : "#0d1615");
    }

    // Update Leaflet map tiles
    updateMapTilesForTheme(isLight);

    // Update segmented control buttons in Profile
    const themeBtns = document.querySelectorAll(".theme-pill-btn");
    themeBtns.forEach(btn => {
      const isActive = btn.getAttribute("data-theme") === themePref;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-checked", isActive ? "true" : "false");
    });
  }

  function setupThemeEventListeners() {
    const themeBtns = document.querySelectorAll(".theme-pill-btn");
    themeBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const theme = btn.getAttribute("data-theme");
        if (theme) {
          applyTheme(theme);
          showMapToast(
            theme === "dark" ? "🌙 Włączono tryb ciemny" :
            theme === "light" ? "☀️ Włączono tryb jasny" :
            "⚙️ Włączono motyw automatyczny"
          );
        }
      });
    });

    // Listen for system theme changes if user has chosen 'auto'
    if (window.matchMedia) {
      try {
        window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
          if (getSavedThemePreference() === "auto") {
            applyTheme("auto");
          }
        });
      } catch (e) {}
    }
  }

  // Map Toast Notification Banner
  function showMapToast(msg, durationMs = 2800) {
    const toast = document.getElementById("map-toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.style.display = "block";
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
    });
    clearTimeout(window.__mapToastTimer);
    window.__mapToastTimer = setTimeout(() => {
      toast.style.opacity = "0";
      setTimeout(() => { toast.style.display = "none"; }, 300);
    }, durationMs);
  }

  // Set User Location (either real GPS or simulated Warsaw center for testing / foreign locations)
  function setUserLocation(coords, isSimulated = false, isFar = false) {
    userLocation = coords;
    isSimulatedLocation = isSimulated;
    isLocationFarAway = isFar;

    const btnLocate = document.getElementById("btn-locate-me");
    const btnLocateFloat = document.getElementById("btn-locate-float");

    const labelText = isSimulated ? "Centrum (Nowy Świat)" : "Moja pozycja";
    if (btnLocate) btnLocate.innerHTML = `<span>📍</span><span>${labelText}</span>`;
    if (btnLocateFloat) {
      const floatSpan = btnLocateFloat.querySelector("span.locate-label");
      if (floatSpan) floatSpan.textContent = labelText;
      btnLocateFloat.classList.add("active");
      btnLocateFloat.classList.remove("locating");
    }

    if (userMarker && map) map.removeLayer(userMarker);

    if (map) {
      const popupHtml = isSimulated
        ? `<div style="font-weight:700;padding:6px 8px;font-size:0.85rem;color:#f8fafc;background:#0f172a;border-radius:6px;">📍 Pozycja w Warszawie: Nowy Świat / Centrum</div>`
        : `<div style="font-weight:700;padding:6px 8px;font-size:0.85rem;color:#f8fafc;background:#0f172a;border-radius:6px;">📍 Twoja lokalizacja GPS<div style="font-weight:400;font-size:0.75rem;color:#94a3b8;margin-top:2px;">Bary posortowane według odległości od Ciebie</div></div>`;

      const markerClass = isSimulated ? "user-gps-pulse-marker simulated" : "user-gps-pulse-marker";
      const gpsIcon = L.divIcon({
        className: "custom-user-gps-icon",
        html: `<div class="${markerClass}">
          <div class="user-gps-ring"></div>
          <div class="user-gps-core"></div>
        </div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      userMarker = L.marker(userLocation, {
        icon: gpsIcon,
        zIndexOffset: 1200,
        title: isSimulated ? "Pozycja w Warszawie: Nowy Świat" : "Twoja lokalizacja GPS"
      }).addTo(map).bindPopup(popupHtml);

      if (isFar) {
        // User is far away (e.g. Stockholm) - keep map inside Poland bounds at Warsaw center
        map.flyTo(WARSAW_CENTER, 13, { duration: 1.2 });
      } else {
        map.flyTo(userLocation, 16, { duration: 1.2 });
      }
    }

    renderRankingList(getFilteredVenues());
    renderMarkers();
  }

  // Request & Acquire User Location via GPS
  function requestUserLocation(options = {}) {
    const { flyTo = true, silent = false } = options;
    const btnLocateFloat = document.getElementById("btn-locate-float");
    const btnLocate = document.getElementById("btn-locate-me");

    if (!navigator.geolocation) {
      if (!silent) showMapToast("⚠️ Twoja przeglądarka nie obsługuje GPS. Ustawiono Warszawę Centrum.");
      setUserLocation(WARSAW_CENTER, true, false);
      return;
    }

    if (btnLocateFloat) {
      btnLocateFloat.classList.add("locating");
      btnLocateFloat.setAttribute("title", "Ustalanie pozycji GPS...");
    }
    if (btnLocate) {
      btnLocate.innerHTML = "<span>📍</span><span>Lokalizowanie...</span>";
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (btnLocateFloat) {
          btnLocateFloat.classList.remove("locating");
          btnLocateFloat.classList.add("active");
          btnLocateFloat.setAttribute("title", "Moja lokalizacja GPS (aktywna)");
        }
        const coords = [pos.coords.latitude, pos.coords.longitude];
        const distFromWarsaw = calculateDistanceKm(coords[0], coords[1], WARSAW_CENTER[0], WARSAW_CENTER[1]);

        if (distFromWarsaw > 150) {
          // User is far from Warsaw (abroad or other Polish city)
          setUserLocation(coords, false, true);
          if (!silent) {
            showMapToast(`📍 Jesteś poza Warszawą (~${Math.round(distFromWarsaw)} km). Wycentrowano na centrum.`);
          }
        } else {
          setUserLocation(coords, false, false);
          if (flyTo && map) {
            map.flyTo(coords, Math.max(map.getZoom(), 16), { duration: 1.2 });
          }
          if (!silent) {
            showMapToast("📍 Zlokalizowano! Pokazuję bary najbliżej Ciebie.");
          }
        }
      },
      (err) => {
        if (btnLocateFloat) {
          btnLocateFloat.classList.remove("locating");
        }
        console.warn("[GPS] Geolocation unavailable or denied:", err.code, err.message);
        if (!silent) {
          if (err.code === 1) { // PERMISSION_DENIED
            showMapToast("⚠️ Brak dostępu do GPS. Włącz lokalizację w ustawieniach przeglądarki.");
          } else {
            showMapToast("⚠️ Nie udało się ustalić pozycji GPS. Spróbuj ponownie.");
          }
        }
        if (!userLocation) {
          setUserLocation(WARSAW_CENTER, true, false);
        }
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }

  // Auto-detect Geolocation on application boot
  function initUserGeolocation() {
    if (!navigator.geolocation) return;

    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "geolocation" }).then((perm) => {
        if (perm.state === "granted" || perm.state === "prompt") {
          requestUserLocation({ flyTo: true, silent: true });
        }
      }).catch(() => {
        requestUserLocation({ flyTo: true, silent: true });
      });
    } else {
      // iOS Safari and older browsers
      requestUserLocation({ flyTo: true, silent: true });
    }
  }

  // Exact Bounding Box of Poland (South-West to North-East)
  const POLAND_BOUNDS = [
    [48.8, 14.0], // South-West (below Bieszczady / Czech border)
    [55.2, 24.4]  // North-East (above Baltic / Lithuania border)
  ];

  // Polish Cities for Nationwide Expansion (Vad Kostar Ölen style)
  const EXPANSION_CITIES = [
    { name: "WARSZAWA", count: 349, coords: [52.2319, 21.0185], status: "active", sub: "349 barów · od 10 zł", zoom: 13 },
    { name: "KRAKÓW", count: 0, coords: [50.0647, 19.9450], status: "coming_soon", sub: "wkrótce", zoom: 13 },
    { name: "GDAŃSK", count: 0, coords: [54.3520, 18.6466], status: "coming_soon", sub: "wkrótce", zoom: 13 },
    { name: "WROCŁAW", count: 0, coords: [51.1079, 17.0385], status: "coming_soon", sub: "wkrótce", zoom: 13 },
    { name: "POZNAŃ", count: 0, coords: [52.4064, 16.9252], status: "coming_soon", sub: "wkrótce", zoom: 13 }
  ];

  // Initialize Leaflet Map
  function initMap() {
    map = L.map("map", {
      center: WARSAW_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: 6,
      maxZoom: 19,
      maxBounds: POLAND_BOUNDS,
      maxBoundsViscosity: 0.95,
      zoomControl: false
    });

    // Zoom control at bottom-right
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // CartoDB Dark Matter / Positron Tiles with streets & labels (dark_all / light_all)
    const cartoKey = (typeof MAP_CONFIG !== "undefined" && MAP_CONFIG.cartoApiKey) ? `?key=${MAP_CONFIG.cartoApiKey}` : "";
    const isLight = getEffectiveTheme() === "light";
    const initialVariant = isLight ? "light_all" : "dark_all";
    mapTileLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${initialVariant}/{z}/{x}/{y}{r}.png${cartoKey}`, {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> | &copy; OpenStreetMap',
      minZoom: 6,
      maxZoom: 19,
      subdomains: "abcd"
    }).addTo(map);

    initClusters();

    map.on("zoomend", updateZoomOverview);

    // Ensure Leaflet recalculates dimensions once DOM has rendered
    setTimeout(() => { if (map) map.invalidateSize(); }, 200);
    setTimeout(() => { if (map) map.invalidateSize(); }, 600);
    window.addEventListener("resize", () => { if (map) map.invalidateSize(); });
  }

  // Initialize Marker Clusters (60 FPS Performance on Mobile)
  function initClusters() {
    if (window.L && L.markerClusterGroup && !clusterGroup) {
      clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 42,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 16,
        chunkedLoading: true,
        iconCreateFunction: function(cluster) {
          const markers = cluster.getAllChildMarkers();
          const count = markers.length;

          let minPrice = Infinity;
          let hasOpen = false;
          markers.forEach(m => {
            const v = m._venueData;
            if (v) {
              if (v._isOpen) hasOpen = true;
              if (typeof v.beer_price_pln === "number" && v.beer_price_pln < minPrice) {
                minPrice = v.beer_price_pln;
              }
            }
          });

          let clusterClass = "beer-cluster-mid";
          if (!hasOpen) {
            clusterClass = "beer-cluster-closed";
          } else if (minPrice <= 12.0) {
            clusterClass = "beer-cluster-low";
          } else if (minPrice > 18.0) {
            clusterClass = "beer-cluster-high";
          }

          const priceLabel = minPrice !== Infinity ? `od ${minPrice.toFixed(minPrice % 1 === 0 ? 0 : 1)}zł` : "";

          return L.divIcon({
            html: `<div class="beer-cluster ${clusterClass}">
                    <span class="cluster-count">${count}</span>
                    <span class="cluster-sub">${hasOpen ? priceLabel : '✕'}</span>
                   </div>`,
            className: 'beer-cluster-wrap',
            iconSize: [44, 44],
            iconAnchor: [22, 22]
          });
        }
      });
      map.addLayer(clusterGroup);
    }
  }

  // Render country-level city overview labels when zoomed out (Vad Kostar Ölen style)
  function renderCityOverviewMarkers() {
    if (!cityMarkersGroup) {
      cityMarkersGroup = L.layerGroup().addTo(map);
    }
    cityMarkersGroup.clearLayers();

    EXPANSION_CITIES.forEach(city => {
      const isComingSoon = city.status === "coming_soon";
      let subText = city.sub;
      if (city.name === "WARSZAWA") {
        const total = (allVenues && allVenues.length) ? allVenues.length : 349;
        const prices = (allVenues && allVenues.length)
          ? allVenues.map(v => v.beer_price_pln).filter(p => typeof p === "number" && p > 0)
          : [];
        const minP = prices.length > 0 ? Math.min(...prices).toFixed(0) : "10";
        subText = `${total} barów · od ${minP} zł`;
      }

      const icon = L.divIcon({
        className: `city-overview-marker ${isComingSoon ? 'coming-soon' : ''}`,
        html: `
          <div class="city-overview-box">
            <div class="city-overview-name">${escapeHtml(city.name)}</div>
            <div class="city-overview-sub">${escapeHtml(subText)}</div>
          </div>
        `,
        iconSize: [130, 48],
        iconAnchor: [65, 24]
      });

      const m = L.marker(city.coords, { icon });
      m.on("click", () => {
        if (!isComingSoon) {
          map.flyTo(city.coords, city.zoom, { duration: 1.2 });
        } else {
          alert(`📍 ${city.name} - zbieranie bazy barów i cen piwa już wkrótce!\nJeśli chcesz pomóc jako lokalny ambasador w mieście ${city.name}, napisz do nas 🍻`);
        }
      });
      cityMarkersGroup.addLayer(m);
    });
  }

  // Zoom level switch: cities view (<= 10) vs bars view (> 10)
  function updateZoomOverview() {
    if (!map) return;
    const z = map.getZoom();
    if (z <= 10) {
      if (clusterGroup && map.hasLayer(clusterGroup)) map.removeLayer(clusterGroup);
      renderCityOverviewMarkers();
      if (cityMarkersGroup && !map.hasLayer(cityMarkersGroup)) map.addLayer(cityMarkersGroup);
    } else {
      if (cityMarkersGroup && map.hasLayer(cityMarkersGroup)) map.removeLayer(cityMarkersGroup);
      if (clusterGroup && !map.hasLayer(clusterGroup)) map.addLayer(clusterGroup);
    }
  }

  // Check if venue is currently open based on hours
  function isVenueOpen(venue, now = new Date()) {
    if (!venue.hours) return true;
    const hStr = venue.hours.toLowerCase().trim();
    if (hStr.includes("24/7") || hStr.includes("24h") || hStr.includes("całodobow")) return true;

    const match = hStr.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
    if (!match) return true;

    const openHour = parseInt(match[1], 10);
    const openMin = parseInt(match[2], 10);
    const closeHour = parseInt(match[3], 10);
    const closeMin = parseInt(match[4], 10);

    const curMinutes = now.getHours() * 60 + now.getMinutes();
    const openMinutes = openHour * 60 + openMin;
    let closeMinutes = closeHour * 60 + closeMin;

    if (closeMinutes <= openMinutes) {
      // Crosses midnight (e.g. 16:00 - 02:00)
      if (curMinutes < (closeHour * 60 + closeMin)) {
        return true;
      }
      return curMinutes >= openMinutes;
    } else {
      return curMinutes >= openMinutes && curMinutes <= closeMinutes;
    }
  }

  function formatDisplayHours(raw) {
    if (!raw) return "";
    let s = raw.trim();
    if (/^\d{1,2}\+$/.test(s)) {
      const h = s.replace("+", "");
      return `od ${h}:00`;
    }
    if (/^\d{1,2}:\d{2}\+$/.test(s)) {
      return `od ${s.replace("+", "")}`;
    }
    s = s.replace(/\bMo\b/g, "Pn")
         .replace(/\bTu\b/g, "Wt")
         .replace(/\bWe\b/g, "Śr")
         .replace(/\bTh\b/g, "Czw")
         .replace(/\bFr\b/g, "Pt")
         .replace(/\bSa\b/g, "Sb")
         .replace(/\bSu\b/g, "Nd")
         .replace(/\bPH\b/g, "Święta")
         .replace(/\boff\b/g, "zamknięte")
         .replace(/(\d{1,2}):00\+/g, "od $1:00")
         .replace(/(\d{1,2})\+/g, "od $1:00");
    return s;
  }

  function isNonAlcoholicVenue(venue) {
    if (!venue) return false;
    if (venue.has_non_alcoholic === true || venue.is_non_alcoholic === true) return true;
    if (venue.has_non_alcoholic === false) return false;
    if (venue.beer_name && /(?:0\.0|bezalk|0%|zero|free)/i.test(venue.beer_name)) return true;
    if (venue.is_craft === true) return true;
    if (venue.happy_hour && /(?:0\.0|bezalk|0%|zero|free)/i.test(venue.happy_hour)) return true;
    return false;
  }

  function isGardenVenue(venue) {
    if (!venue) return false;
    if (venue.has_garden === true) return true;
    if (venue.tags && Array.isArray(venue.tags) && (venue.tags.includes("ogródek") || venue.tags.includes("garden") || venue.tags.includes("patio"))) return true;
    const d = (venue.district || "").toLowerCase();
    if (d === "bulwary" || d === "pawilony") return true;
    const knownGardenSlugs = new Set([
      "pub-lolek-pole-mokotowskie", "zielona-ges", "bolek", "bez-slowa", "wieczorny",
      "pol-na-pul", "moko-tuff-pub", "singers", "boston-port", "bar-kepa-potocka",
      "prochownia-zoliborz", "cuda-na-kiju", "wozownia-bar", "plan-b", "piotrus",
      "hala-koszyki", "browary-warszawskie", "fabryka-norblina", "nocny-market",
      "koneser", "hydrozagadka", "sklad-butelek", "w-oparach-absurdu", "bar-pacyfik",
      "browar-warszawski", "pokoj-na-lato", "piano-bar", "tawerna-korsarz", "chmielobrody",
      "jabeerwocky", "same-krafty"
    ]);
    if (venue.slug && knownGardenSlugs.has(venue.slug.toLowerCase())) return true;
    const text = `${venue.name || ""} ${venue.address || ""} ${venue.slug || ""}`.toLowerCase();
    const gardenKeywords = ["ogród", "garden", "park", "pole mokotowskie", "plaż", "letni", "taras", "patio", "plener", "dziedziniec", "barka", "skwer", "bulwar", "dąb", "wisł", "nadwisł", "wiata", "altana", "pod chmurką"];
    return gardenKeywords.some(k => text.includes(k));
  }

  // Determine Price Tier and Style
  function getPriceTier(price) {
    if (price <= 12.0) return { tier: "low", class: "marker-low", color: "#22c55e" };
    if (price <= 18.0) return { tier: "mid", class: "marker-mid", color: "#f59e0b" };
    return { tier: "high", class: "marker-high", color: "#ef4444" };
  }

  // Create Custom HTML Marker Badge (Vad Kostar Ölen Style: grey ✕ circle if closed, green checkmark if visited)
  function createMarkerIcon(venue) {
    const open = isVenueOpen(venue);
    const price = venue.beer_price_pln;
    const tier = getPriceTier(price);
    const craftClass = venue.is_craft ? "marker-craft-halo" : "";
    const visited = isVenueVisited(venue.id);
    const visitedBadge = visited ? `<span class="marker-visited-badge" title="Odwiedzony bar!">✓</span>` : "";

    if (!open) {
      const size = [32, 32];
      return L.divIcon({
        className: "custom-price-div-icon",
        html: `<div class="price-badge-marker marker-closed" style="width:${size[0]}px; height:${size[1]}px;" title="Zamknięte teraz · ${escapeHtml(formatDisplayHours(venue.hours) || '')}">
                <span class="closed-x">✕</span>
                ${visitedBadge}
               </div>`,
        iconSize: size,
        iconAnchor: [size[0] / 2, size[1] / 2]
      });
    }

    const size = price <= 12.0 ? [44, 44] : [38, 38];
    return L.divIcon({
      className: "custom-price-div-icon",
      html: `<div class="price-badge-marker ${tier.class} ${craftClass}" style="width:${size[0]}px; height:${size[1]}px;">
              ${price.toFixed(price % 1 === 0 ? 0 : 1)}<span style="font-size:9px;margin-left:1px;">zł</span>
              ${visitedBadge}
             </div>`,
      iconSize: size,
      iconAnchor: [size[0] / 2, size[1] / 2]
    });
  }

  function buildGoogleMapsNavigationUrl(venue) {
    if (!venue) return "#";
    const name = venue.name || "";
    let addr = venue.address && venue.address !== "Warszawa" ? venue.address : "";
    if ((venue.district === "Pawilony" || name.toLowerCase().includes("pawilon")) && !addr.toLowerCase().includes("nowy świat") && !addr.toLowerCase().includes("foksal")) {
      addr = "Nowy Świat 22/28";
    }
    const parts = [name];
    if (addr) parts.push(addr);
    else if (venue.district) parts.push(venue.district);
    parts.push("Warszawa");

    const query = parts.filter(Boolean).join(", ");
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}&travelmode=walking`;
  }

  // Create Venue Popup HTML
  function createPopupContent(venue) {
    const open = isVenueOpen(venue);
    const price = venue.beer_price_pln;
    const tier = getPriceTier(price);
    const mapsUrl = buildGoogleMapsNavigationUrl(venue);
    const visited = isVenueVisited(venue.id);
    const activeHh = getActiveHappyHour(venue);
    const isFav = isVenueFavorite(venue.id);
    const hasZero = isNonAlcoholicVenue(venue);

    let walkInfo = "";
    if (userLocation) {
      const distKm = calculateDistanceKm(userLocation[0], userLocation[1], venue.latitude, venue.longitude);
      if (distKm <= 15) {
        const distM = Math.round(distKm * 1000);
        const walkMin = Math.max(1, Math.round(distKm / 4.8 * 60));
        walkInfo = `<div class="venue-dist-tag">🚶 <strong>${distM < 1000 ? distM + ' m' : distKm.toFixed(1) + ' km'}</strong> (${walkMin} min pieszo)</div>`;
      } else {
        walkInfo = `<div class="venue-dist-tag distant">📍 <strong>${Math.round(distKm)} km</strong> od Ciebie</div>`;
      }
    }

    const statusBadge = open
      ? `<span class="venue-status-badge open"><span class="status-dot"></span> Otwarte teraz</span>`
      : `<span class="venue-status-badge closed"><span class="status-dot"></span> Zamknięte</span>`;

    const proofUrl = venue.photo_url || venue.proof_image_url;

    let hhLivePromoHtml = "";
    if (activeHh) {
      hhLivePromoHtml = `
        <div class="hh-live-promo-box">
          <div>
            <div class="hh-live-promo-title">
              <span class="pulse-dot"></span>
              HAPPY HOUR TRWA TERAZ!
            </div>
            <div class="hh-live-promo-desc">${escapeHtml(activeHh.rule.description || "Piwo w promocji")}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div class="hh-live-promo-price">${activeHh.rule.promo_price.toFixed(2)} zł</div>
            <div class="hh-live-promo-time">jeszcze ${formatMinutesLeft(activeHh.minutesLeft)}</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="venue-card">
        <div class="venue-header">
          <div class="venue-title-group">
            <div class="venue-name">
              <span>${escapeHtml(venue.name)}</span>
              ${venue.is_verified ? '<span class="venue-badge-verified" title="Zweryfikowany lokal">✓</span>' : ''}
              ${venue.old_name ? `<span class="venue-old-name" title="Poprzednia nazwa lokalu">(d. ${escapeHtml(venue.old_name)})</span>` : ''}
            </div>
            <div class="venue-district">📍 ${escapeHtml(venue.district)} · ${escapeHtml(venue.address)}</div>
            ${walkInfo}
          </div>
        </div>

        <div class="venue-meta-bar">
          ${statusBadge}
          ${venue.is_verified
            ? `<span class="venue-verified-pill" title="Cena zweryfikowana w lokalu"><span class="ver-dot"></span> Zweryfikowana</span>`
            : `<span class="venue-unverified-pill" title="Cena szacunkowa na podstawie dzielnicy – pomóż zaktualizować!"><span class="unver-dot"></span> Szacunek</span>`
          }
          ${venue.hours ? `<span class="venue-hours-chip">🕒 ${escapeHtml(formatDisplayHours(venue.hours))}</span>` : ''}
        </div>

        ${hhLivePromoHtml}

        <div class="venue-price-box">
          <div class="price-beer-info">
            <div class="price-beer-title">
              Najtańsze piwo (0.5L)
              ${!venue.is_verified ? '<span class="price-est-badge" title="Cena orientacyjna dla dzielnicy – zgłoś aktualną cenę!">szacunek</span>' : ''}
            </div>
            <div class="price-beer-brand">${escapeHtml(venue.beer_name || "Piwo z nalewaka / kranu")}</div>
          </div>
          <div class="price-val ${tier.tier}">
            ${price.toFixed(2)}<span class="price-currency"> zł</span>
          </div>
        </div>

        ${(venue.shot_price_pln || venue.is_craft || (venue.happy_hour && !activeHh) || hasZero) ? `
          <div class="venue-chips-row">
            ${venue.shot_price_pln ? `<span class="venue-chip">🥃 Shot: <strong>${venue.shot_price_pln.toFixed(2)} zł</strong></span>` : ''}
            ${venue.is_craft ? `<span class="venue-chip craft">⭐ Kraft / Multitap</span>` : ''}
            ${(venue.happy_hour && !activeHh) ? `<span class="venue-chip hh">⚡ ${escapeHtml(venue.happy_hour)}</span>` : ''}
            ${hasZero ? `<span class="venue-chip chip-bezalko" title="Dostępne piwo bezalkoholowe / 0.0%">🌱 0.0% / Bezalko</span>` : ''}
          </div>
        ` : ''}

        <div class="venue-social-row">
          <button type="button" class="btn-fav-toggle ${isFav ? 'active' : ''}" onclick="window.__toggleFavorite('${venue.id}')" data-id="${venue.id}" title="${isFav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}">
            <span>${isFav ? '❤️ W ulubionych' : '🤍 Do ulubionych'}</span>
          </button>
          <button type="button" class="btn-share-venue" onclick="window.__shareVenue('${venue.id}')" title="Udostępnij bezpośredni link do tego lokalu">
            <span>📤 Udostępnij</span>
          </button>
        </div>

        <button type="button" class="btn-toggle-visited ${visited ? 'visited' : ''}" onclick="window.__toggleVisited('${venue.id}')" title="Zapisz ten bar w swoim Piwnym Paszporcie">
          ${visited ? '✓ Byłem tu! (Zaznaczone w Paszporcie)' : '🎖️ Zaznacz: Byłem tu!'}
        </button>

        <div class="venue-actions">
          <button type="button" class="venue-btn-confirm" onclick="window.__confirmPrice('${venue.id}')" title="Potwierdź, że cena jest aktualna">
            ${venue.votes_confirm > 0 ? `👍 Aktualna (${venue.votes_confirm})` : `👍 Potwierdź cenę`}
          </button>
          <button type="button" class="venue-btn-edit ${!venue.is_verified ? 'highlight-edit' : ''}" onclick="window.__editVenuePrice('${venue.id}')" title="${!venue.is_verified ? 'Podaj aktualną cenę z tego lokalu' : 'Zgłoś nową cenę lub inną nazwę lokalu'}">
            ${!venue.is_verified ? '✏️ Podaj cenę' : '✏️ Zgłoś zmianę'}
          </button>
        </div>

        <div class="venue-nav-wrap">
          <a href="${mapsUrl}" target="_blank" rel="noopener" class="venue-btn-map">
            <span>🧭 Prowadź w Google Maps</span>
            <span class="nav-arrow">→</span>
          </a>
        </div>

        ${proofUrl ? `
          <div class="venue-proof-wrap">
            <button type="button" class="venue-proof-badge" onclick="window.__openLightbox('${escapeHtml(proofUrl)}', '${escapeHtml(venue.name)} - menu / paragon')">
              📸 Zobacz paragon / menu
            </button>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Confirm Price Click Handler (Real Community Confirmation)
  window.__confirmPrice = function (venueId) {
    const venue = allVenues.find(v => v.id === venueId);
    if (!venue) return;
    venue.votes_confirm = (venue.votes_confirm || 0) + 1;
    saveLocalVotes(venueId, venue.votes_confirm);

    // Sync confirmation to Supabase in real time
    if (supabaseClient) {
      supabaseClient
        .from("venues")
        .update({ votes_confirm: venue.votes_confirm })
        .or(`osm_id.eq.${venue.id},id.eq.${venue.id}`)
        .then(({ error }) => {
          if (error) console.warn("Supabase vote update note:", error);
        });

      supabaseClient
        .from("price_reports")
        .insert({
          reported_beer_name: venue.beer_name || "Piwo z kranu",
          reported_price_pln: venue.beer_price_pln,
          happy_hour_info: `Potwierdzenie ceny przez użytkownika (głos #${venue.votes_confirm})`
        })
        .then(({ error }) => {
          if (error) console.warn("Supabase report log note:", error);
        });
    }

    // Refresh UI & Barometer
    updateBarometerStats();
    renderMarkers();
    alert(`Dziękujemy! Potwierdziłeś aktualność ceny dla baru: ${venue.name}. Ten lokal ma teraz ${venue.votes_confirm} ${venue.votes_confirm === 1 ? 'potwierdzenie' : 'potwierdzenia'}.`);
  };

  // Render Markers on Map based on filters (Clustered for 60 FPS performance)
  function renderMarkers() {
    if (clusterGroup) {
      clusterGroup.clearLayers();
    } else {
      activeMarkers.forEach(m => map.removeLayer(m));
    }
    activeMarkers = [];

    const filtered = getFilteredVenues();

    const countEl = document.getElementById("results-count");
    if (countEl) {
      if (currentDistrict !== "all") {
        countEl.textContent = `${filtered.length} barów w: ${currentDistrict}`;
      } else {
        countEl.textContent = `${filtered.length} barów w Warszawie`;
      }
    }

    const newMarkers = [];
    filtered.forEach(venue => {
      venue._isOpen = isVenueOpen(venue);
      const icon = createMarkerIcon(venue);
      const marker = L.marker([venue.latitude, venue.longitude], { icon })
        .bindPopup(() => createPopupContent(venue), {
          maxWidth: 320,
          minWidth: 280,
          className: "custom-leaflet-popup",
          autoPanPadding: [16, 16]
        });

      marker._venueData = venue;
      marker.on("click", () => {
        if (window.innerWidth <= 820 && window.__openVkoVenueSheet) {
          setTimeout(() => {
            if (marker.closePopup) marker.closePopup();
            window.__openVkoVenueSheet(venue, "map");
          }, 40);
        }
      });
      marker.on("popupopen", () => {
        const v = marker._venueData;
        if (v) {
          const slug = v.slug || v.id;
          if (slug && window.location.hash !== `#${slug}`) {
            try {
              history.replaceState(null, "", `#${slug}`);
            } catch (e) {}
          }
        }
      });
      newMarkers.push(marker);
    });

    activeMarkers = newMarkers;

    if (clusterGroup) {
      clusterGroup.addLayers(newMarkers);
    } else {
      newMarkers.forEach(m => m.addTo(map));
    }

    if (!window.__mapPopupCloseAttached && map) {
      window.__mapPopupCloseAttached = true;
      map.on("popupclose", () => {
        if (window.location.hash) {
          try {
            history.replaceState(null, "", window.location.pathname + window.location.search);
          } catch (e) {}
        }
      });
    }

    updateZoomOverview();
    renderRankingList(filtered);
    if (window.__renderExploreBars) {
      window.__renderExploreBars(filtered);
    }
  }

  // Update District Select Dropdown with Live Bar Counts
  function updateDistrictCounts() {
    const select = document.getElementById("district-select");
    if (!select) return;

    const counts = {};
    allVenues.forEach(v => {
      const d = v.district;
      counts[d] = (counts[d] || 0) + 1;
    });

    Array.from(select.options).forEach(opt => {
      const val = opt.value;
      if (val === "all") {
        opt.textContent = `🏙️ Cała Warszawa (${allVenues.length} barów)`;
      } else if (counts[val] !== undefined) {
        let baseName = opt.getAttribute("data-base-name");
        if (!baseName) {
          baseName = opt.textContent.replace(/\s*\(\d+.*\)$/, "").trim();
          opt.setAttribute("data-base-name", baseName);
        }
        opt.textContent = `${baseName} (${counts[val]})`;
      }
    });
  }

  // Filter Logic
  function getFilteredVenues() {
    return allVenues.filter(venue => {
      // District filter
      if (currentDistrict !== "all") {
        const vDist = (venue.district || "").toLowerCase();
        const cDist = currentDistrict.toLowerCase();
        if (currentDistrict === "Pawilony") {
          if (vDist !== "pawilony") return false;
        } else if (currentDistrict === "Bulwary") {
          if (!vDist.includes("bulwary")) return false;
        } else {
          if (vDist !== cDist && !vDist.includes(cDist)) {
            return false;
          }
        }
      }

      // Text search match
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesText = 
          venue.name.toLowerCase().includes(q) ||
          (venue.old_name && venue.old_name.toLowerCase().includes(q)) ||
          venue.district.toLowerCase().includes(q) ||
          venue.address.toLowerCase().includes(q) ||
          (venue.beer_name && venue.beer_name.toLowerCase().includes(q));
        if (!matchesText) return false;
      }

      const price = venue.beer_price_pln;

      // Price criteria (slider or tier)
      if (filterState.maxPrice !== null && filterState.maxPrice < 35) {
        if (price > filterState.maxPrice) return false;
      } else if (filterState.priceTier === "tier-low") {
        if (price > 12.0) return false;
      } else if (filterState.priceTier === "tier-mid") {
        if (price <= 12.0 || price > 18.0) return false;
      } else if (filterState.priceTier === "tier-high") {
        if (price <= 18.0) return false;
      }

      // Toggles
      if (filterState.openNow && !isVenueOpen(venue)) return false;
      if (filterState.craftOnly && !venue.is_craft) return false;
      if (filterState.happyHourOnly && !(venue.happy_hour || venue.happy_hour_rule)) return false;
      if (filterState.favoritesOnly && !isVenueFavorite(venue.id)) return false;
      if (filterState.nonAlcoholicOnly && !isNonAlcoholicVenue(venue)) return false;

      // Fallback for legacy currentFilter
      if (currentFilter && currentFilter !== "all" && filterState.priceTier === "all" && filterState.maxPrice === null && !filterState.openNow && !filterState.craftOnly && !filterState.happyHourOnly && !filterState.favoritesOnly && !filterState.nonAlcoholicOnly) {
        switch (currentFilter) {
          case "open-now": return isVenueOpen(venue);
          case "favorites": return isVenueFavorite(venue.id);
          case "non-alcoholic": return isNonAlcoholicVenue(venue);
          case "pawilony": return venue.district.toLowerCase() === "pawilony";
          case "srodmiescie": return venue.district.toLowerCase().includes("śródmieście");
          case "praga": return venue.district.toLowerCase().includes("praga");
          case "bulwary": return venue.district.toLowerCase().includes("bulwary");
          case "tier-low": return price <= 12.0;
          case "tier-mid": return price > 12.0 && price <= 18.0;
          case "tier-high": return price > 18.0;
          case "craft": return venue.is_craft === true;
          case "happy-hour": return !!(venue.happy_hour || venue.happy_hour_rule);
        }
      }

      return true;
    });
  }

  function getActiveFilterCount() {
    let count = 0;
    if (filterState.priceTier !== "all" || (filterState.maxPrice !== null && filterState.maxPrice < 35)) count++;
    if (filterState.openNow) count++;
    if (filterState.craftOnly) count++;
    if (filterState.happyHourOnly) count++;
    if (filterState.favoritesOnly) count++;
    if (filterState.nonAlcoholicOnly) count++;
    if (currentDistrict !== "all") count++;
    return count;
  }

  function updateFilterBadge() {
    const count = getActiveFilterCount();
    const btn = document.getElementById("btn-open-filter-modal");
    const badge = document.getElementById("filter-active-badge");
    if (badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = "inline-flex";
      } else {
        badge.style.display = "none";
      }
    }
    if (btn) {
      if (count > 0) btn.classList.add("has-filters");
      else btn.classList.remove("has-filters");
    }
    const topDot = document.getElementById("top-filter-dot");
    if (topDot) {
      topDot.style.display = count > 0 ? "block" : "none";
    }
    const btnTopFilter = document.getElementById("btn-top-filter");
    if (btnTopFilter) {
      if (count > 0) btnTopFilter.classList.add("has-filters");
      else btnTopFilter.classList.remove("has-filters");
    }
  }

  function syncQuickChipsWithFilterState() {
    const chips = document.querySelectorAll(".filter-chip[data-filter]");
    chips.forEach(c => {
      const f = c.getAttribute("data-filter");
      let isActive = false;
      if (f === "all") {
        isActive = (filterState.priceTier === "all" && filterState.maxPrice === null && !filterState.openNow && !filterState.craftOnly && !filterState.happyHourOnly && !filterState.favoritesOnly && !filterState.nonAlcoholicOnly);
      } else if (f === "tier-low") {
        isActive = (filterState.priceTier === "tier-low" && filterState.maxPrice === null);
      } else if (f === "tier-mid") {
        isActive = (filterState.priceTier === "tier-mid" && filterState.maxPrice === null);
      } else if (f === "tier-high") {
        isActive = (filterState.priceTier === "tier-high" && filterState.maxPrice === null);
      } else if (f === "open-now") {
        isActive = filterState.openNow;
      } else if (f === "craft") {
        isActive = filterState.craftOnly;
      } else if (f === "happy-hour") {
        isActive = filterState.happyHourOnly;
      } else if (f === "favorites") {
        isActive = filterState.favoritesOnly;
      } else if (f === "non-alcoholic") {
        isActive = filterState.nonAlcoholicOnly;
      }
      if (isActive) c.classList.add("active");
      else c.classList.remove("active");
    });
    const btnTopTime = document.getElementById("btn-top-time");
    if (btnTopTime) {
      if (filterState.openNow) btnTopTime.classList.add("active-open-now");
      else btnTopTime.classList.remove("active-open-now");
    }
    updateFilterBadge();
  }

  function syncFilterModalUI() {
    // Price cards
    document.querySelectorAll(".filter-price-card").forEach(card => {
      const p = card.getAttribute("data-price");
      if (filterState.maxPrice !== null && filterState.maxPrice < 35) {
        card.classList.remove("active");
      } else {
        if (p === filterState.priceTier) card.classList.add("active");
        else card.classList.remove("active");
      }
    });

    // Slider
    const slider = document.getElementById("filter-price-slider");
    const sliderVal = document.getElementById("filter-slider-val");
    if (slider && sliderVal) {
      if (filterState.maxPrice !== null && filterState.maxPrice < 35) {
        slider.value = filterState.maxPrice;
        sliderVal.textContent = `≤ ${filterState.maxPrice} zł`;
      } else {
        slider.value = 35;
        sliderVal.textContent = "Dowolna";
      }
    }

    // Toggles
    const toggleMap = {
      "openNow": document.getElementById("filter-toggle-open"),
      "happyHourOnly": document.getElementById("filter-toggle-happyhour"),
      "craftOnly": document.getElementById("filter-toggle-craft"),
      "nonAlcoholicOnly": document.getElementById("filter-toggle-nonalco"),
      "favoritesOnly": document.getElementById("filter-toggle-favorites")
    };
    for (const [key, el] of Object.entries(toggleMap)) {
      if (el) {
        if (filterState[key]) el.classList.add("active");
        else el.classList.remove("active");
      }
    }

    // District chips inside modal
    document.querySelectorAll(".filter-dist-chip").forEach(ch => {
      const d = ch.getAttribute("data-dist");
      if (d === currentDistrict) ch.classList.add("active");
      else ch.classList.remove("active");
    });

    updateFilterMatchingCount();
  }

  function updateFilterMatchingCount() {
    const matching = getFilteredVenues();
    const countEl = document.getElementById("filter-matching-count");
    if (countEl) countEl.textContent = matching.length;
  }

  function openFilterModal() {
    const modal = document.getElementById("filter-modal");
    if (!modal) return;
    syncFilterModalUI();
    modal.style.display = "flex";
    modal.classList.add("active");
  }

  function closeFilterModal() {
    const modal = document.getElementById("filter-modal");
    if (!modal) return;
    modal.classList.remove("active");
    modal.style.display = "none";
  }

  function resetAllFilters() {
    filterState = {
      priceTier: "all",
      maxPrice: null,
      openNow: false,
      craftOnly: false,
      happyHourOnly: false,
      favoritesOnly: false,
      nonAlcoholicOnly: false
    };
    currentFilter = "all";
    currentDistrict = "all";
    const districtSelect = document.getElementById("district-select");
    if (districtSelect) districtSelect.value = "all";
    syncFilterModalUI();
    syncQuickChipsWithFilterState();
    renderMarkers();
  }

  // Lightbox Modal Handlers
  window.__openLightbox = function (url, caption) {
    const lbModal = document.getElementById("lightbox-modal");
    const lbImg = document.getElementById("lightbox-img");
    const lbCap = document.getElementById("lightbox-caption");
    if (!lbModal || !lbImg) return;

    lbImg.src = url;
    if (lbCap) lbCap.textContent = caption || "";
    lbModal.style.display = "flex";
  };

  window.__closeLightbox = function () {
    const lbModal = document.getElementById("lightbox-modal");
    const lbImg = document.getElementById("lightbox-img");
    if (lbModal) lbModal.style.display = "none";
    if (lbImg) lbImg.src = "";
  };

  // Client-Side Image Compression using HTML Canvas
  function compressImage(file, maxWidth = 1200, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxWidth) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxWidth) / height);
              height = maxWidth;
            }
          }

          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);

          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(dataUrl);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Client-Side Profile Photo Square Center-Crop and Compression (240x240 ~20KB)
  function cropAndCompressAvatarPhoto(file, targetDim = 240, quality = 0.84) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = new Image();
        img.onload = function () {
          try {
            const minDim = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
            const sx = ((img.naturalWidth || img.width) - minDim) / 2;
            const sy = ((img.naturalHeight || img.height) - minDim) / 2;
            const canvas = document.createElement("canvas");
            canvas.width = targetDim;
            canvas.height = targetDim;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, targetDim, targetDim);
            const dataUrl = canvas.toDataURL("image/jpeg", quality);
            resolve(dataUrl);
          } catch (err) {
            reject(err);
          }
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Warsaw Districts Division for Left vs Right Bank
  const LEFT_BANK_DISTRICTS = new Set([
    "Śródmieście", "Mokotów", "Wola", "Ochota", "Żoliborz", "Bielany", "Bemowo", "Ursynów", "Włochy", "Ursus", "Wilanów", "Pawilony", "Bulwary"
  ]);
  const RIGHT_BANK_DISTRICTS = new Set([
    "Praga Północ", "Praga Południe", "Targówek", "Białołęka", "Wawer", "Rembertów", "Wesoła"
  ]);

  // Update Warsaw Beer Barometer Statistics
  function updateBarometerStats() {
    if (!allVenues || allVenues.length === 0) return;

    const validVenues = allVenues.filter(v => typeof v.beer_price_pln === "number" && v.beer_price_pln > 0);
    if (validVenues.length === 0) return;

    // Total venues count
    const totalEl = document.getElementById("baro-total-venues");
    if (totalEl) totalEl.textContent = allVenues.length;

    // Craft count
    const craftCount = allVenues.filter(v => v.is_craft).length;
    const craftEl = document.getElementById("baro-craft-count");
    if (craftEl) craftEl.textContent = `w 18 dzielnicach (${craftCount} kraft)`;

    // Community confirmations count
    const totalVotes = allVenues.reduce((acc, v) => acc + (v.votes_confirm || 0), 0);
    const votesEl = document.getElementById("baro-total-votes");
    const votesSubEl = document.getElementById("baro-total-votes-sub");
    if (votesEl) votesEl.textContent = totalVotes.toLocaleString("pl-PL");
    if (votesSubEl) {
      if (totalVotes === 0) {
        votesSubEl.textContent = "bądź pierwszym! ✨";
      } else if (totalVotes === 1) {
        votesSubEl.textContent = "1 potwierdzenie od ludzi 👍";
      } else {
        votesSubEl.textContent = `${totalVotes} potwierdzeń od ludzi 👍`;
      }
    }

    // Warsaw average
    const sumWarsaw = validVenues.reduce((acc, v) => acc + v.beer_price_pln, 0);
    const avgWarsaw = sumWarsaw / validVenues.length;
    const avgWarsawEl = document.getElementById("baro-avg-price");
    if (avgWarsawEl) avgWarsawEl.textContent = `${avgWarsaw.toFixed(2)} zł`;

    // Group stats by district
    const districtData = {};
    validVenues.forEach(v => {
      const d = v.district || "Inne";
      if (!districtData[d]) {
        districtData[d] = { count: 0, sum: 0, min: Infinity, max: -Infinity };
      }
      districtData[d].count += 1;
      districtData[d].sum += v.beer_price_pln;
      if (v.beer_price_pln < districtData[d].min) districtData[d].min = v.beer_price_pln;
      if (v.beer_price_pln > districtData[d].max) districtData[d].max = v.beer_price_pln;
    });

    const districtList = Object.entries(districtData).map(([name, data]) => ({
      name,
      avg: data.sum / data.count,
      min: data.min,
      max: data.max,
      count: data.count
    })).sort((a, b) => a.avg - b.avg);

    // Cheapest and Priciest District KPI
    if (districtList.length > 0) {
      const cheapest = districtList[0];
      const priciest = districtList[districtList.length - 1];

      const cheapEl = document.getElementById("baro-cheapest-district");
      const cheapSub = document.getElementById("baro-cheapest-sub");
      if (cheapEl) cheapEl.textContent = cheapest.name;
      if (cheapSub) cheapSub.textContent = `śr. ${cheapest.avg.toFixed(2)} zł (od ${cheapest.min.toFixed(0)} zł)`;

      const priceEl = document.getElementById("baro-priciest-district");
      const priceSub = document.getElementById("baro-priciest-sub");
      if (priceEl) priceEl.textContent = priciest.name;
      if (priceSub) priceSub.textContent = `śr. ${priciest.avg.toFixed(2)} zł`;
    }

    // Left vs Right Bank
    let leftSum = 0, leftCount = 0;
    let rightSum = 0, rightCount = 0;
    validVenues.forEach(v => {
      if (LEFT_BANK_DISTRICTS.has(v.district)) {
        leftSum += v.beer_price_pln;
        leftCount++;
      } else if (RIGHT_BANK_DISTRICTS.has(v.district)) {
        rightSum += v.beer_price_pln;
        rightCount++;
      }
    });

    const leftBankEl = document.getElementById("baro-left-bank");
    if (leftBankEl) {
      const leftAvg = leftCount > 0 ? (leftSum / leftCount).toFixed(2) : "--";
      leftBankEl.textContent = `śr. ${leftAvg} zł (${leftCount} barów)`;
    }

    const rightBankEl = document.getElementById("baro-right-bank");
    if (rightBankEl) {
      const rightAvg = rightCount > 0 ? (rightSum / rightCount).toFixed(2) : "--";
      rightBankEl.textContent = `śr. ${rightAvg} zł (${rightCount} barów)`;
    }

    // District Bars Breakdown
    const baroListEl = document.getElementById("baro-district-list");
    if (baroListEl && districtList.length > 0) {
      const maxAvg = districtList[districtList.length - 1].avg || 1;
      baroListEl.innerHTML = districtList.map(item => {
        const pct = Math.min(100, Math.max(25, (item.avg / maxAvg) * 100));
        const tier = getPriceTier(item.avg);
        return `
          <div class="district-bar-row" onclick="window.__selectDistrictFromBaro('${escapeHtml(item.name)}')">
            <span class="d-row-name" title="${escapeHtml(item.name)} (${item.count} lokali)">${escapeHtml(item.name)}</span>
            <div class="d-row-bar-wrap">
              <div class="d-row-bar-fill" style="width:${pct}%;background:${tier.color};"></div>
            </div>
            <span class="d-row-price">${item.avg.toFixed(2)} zł</span>
          </div>
        `;
      }).join("");
    }
  }

  // Handle District Selection from Barometer Chart
  window.__selectDistrictFromBaro = function (districtName) {
    const modal = document.getElementById("barometer-modal");
    if (modal) modal.classList.remove("active");

    const select = document.getElementById("district-select");
    if (select) {
      select.value = districtName;
    }
    currentDistrict = districtName;
    const target = DISTRICT_CENTERS[districtName] || DISTRICT_CENTERS["all"];
    if (map && target) {
      map.flyTo(target.coords, target.zoom, { duration: 1.2 });
    }
    renderMarkers();
  };

  // Render Ranking Leaderboard (Feature A: Piwny Kompas or Najtańsze or Odwiedzone)
  function renderRankingList(venuesToRank) {
    const listEl = document.getElementById("ranking-list");
    if (!listEl) return;

    let sorted = [...venuesToRank].filter(v => typeof v.beer_price_pln === "number" && v.beer_price_pln > 0);

    if (rankingMode === "visited") {
      sorted = sorted.filter(v => isVenueVisited(v.id)).sort((a, b) => a.beer_price_pln - b.beer_price_pln);
      if (sorted.length === 0) {
        listEl.innerHTML = `
          <div class="ranking-empty-card" style="text-align:center;padding:32px 16px;display:flex;flex-direction:column;align-items:center;gap:12px;">
            <div style="font-size:42px;">🎖️</div>
            <div class="ranking-empty-title" style="font-weight:700;font-size:1.05rem;">Brak odwiedzonych lokali</div>
            <div class="ranking-empty-desc" style="font-size:0.78rem;line-height:1.45;max-width:280px;">
              Kliknij na dowolny bar na mapie i wciśnij <strong>„Byłem tu!”</strong>, aby zbierać pieczątki i zdobywać odznaki w Piwnym Paszporcie Warszawy.
            </div>
            <button type="button" id="btn-browse-all-bars" class="btn-primary" style="margin-top:6px;font-size:0.8rem;padding:8px 16px;">
              💰 Zobacz najtańsze bary
            </button>
          </div>
        `;
        const btnBrowse = document.getElementById("btn-browse-all-bars");
        if (btnBrowse) {
          btnBrowse.addEventListener("click", () => {
            const tabCheapest = document.getElementById("tab-rank-cheapest");
            if (tabCheapest) tabCheapest.click();
          });
        }
        return;
      }
    } else if (rankingMode === "favorites") {
      sorted = sorted.filter(v => isVenueFavorite(v.id)).sort((a, b) => a.beer_price_pln - b.beer_price_pln);
      if (sorted.length === 0) {
        listEl.innerHTML = `
          <div class="ranking-empty-card" style="text-align:center;padding:32px 16px;display:flex;flex-direction:column;align-items:center;gap:12px;">
            <div style="font-size:42px;">❤️</div>
            <div class="ranking-empty-title" style="font-weight:700;font-size:1.05rem;">Brak ulubionych barów</div>
            <div class="ranking-empty-desc" style="font-size:0.78rem;line-height:1.45;max-width:280px;">
              Kliknij <strong>„🤍 Do ulubionych”</strong> na karcie dowolnego lokalu na mapie, aby zapisać go w szybkim dostępie.
            </div>
            <button type="button" id="btn-browse-fav-all" class="btn-primary" style="margin-top:6px;font-size:0.8rem;padding:8px 16px;">
              💰 Zobacz najtańsze bary
            </button>
          </div>
        `;
        const btnBrowse = document.getElementById("btn-browse-fav-all");
        if (btnBrowse) {
          btnBrowse.addEventListener("click", () => {
            const tabCheapest = document.getElementById("tab-rank-cheapest");
            if (tabCheapest) tabCheapest.click();
          });
        }
        return;
      }
    } else if (rankingMode === "nearest") {
      if (!userLocation) {
        listEl.innerHTML = `
          <div class="ranking-empty-card" style="text-align:center;padding:26px 16px;display:flex;flex-direction:column;align-items:center;gap:12px;">
            <div style="font-size:38px;">🧭</div>
            <div class="ranking-empty-title" style="font-weight:700;font-size:1.05rem;">Włącz Piwny Kompas</div>
            <div class="ranking-empty-desc" style="font-size:0.78rem;line-height:1.45;max-width:280px;">
              Jesteś w Sztokholmie 🇸🇪 lub Safari zablokowało GPS? Ustaw pozycję w centrum Warszawy, aby zobaczyć najbliższe bary i czas spaceru:
            </div>
            <button type="button" class="btn-simulate-warsaw" id="btn-simulate-warsaw" style="width:100%;max-width:280px;font-size:0.82rem;">
              📍 Ustaw pozycję: Centrum (Nowy Świat)
            </button>
            <button type="button" class="btn-retry-gps" id="btn-enable-gps" style="width:100%;max-width:280px;font-size:0.78rem;">
              🎯 Spróbuj pobrać GPS z telefonu
            </button>
          </div>
        `;
        const btnSimulate = document.getElementById("btn-simulate-warsaw");
        if (btnSimulate) {
          btnSimulate.addEventListener("click", () => {
            setUserLocation([52.2323, 21.0206], true, false); // Nowy Świat / Pawilony
          });
        }
        const btnEnable = document.getElementById("btn-enable-gps");
        if (btnEnable) {
          btnEnable.addEventListener("click", () => {
            const btnLocate = document.getElementById("btn-locate-me");
            if (btnLocate) btnLocate.click();
          });
        }
        return;
      }

      // Sort by distance ascending
      sorted = sorted.map(v => {
        const distKm = calculateDistanceKm(userLocation[0], userLocation[1], v.latitude, v.longitude);
        const distM = Math.round(distKm * 1000);
        const walkMin = Math.max(1, Math.round(distKm / 4.8 * 60));
        return Object.assign({}, v, { _distKm: distKm, _distM: distM, _walkMin: walkMin });
      }).sort((a, b) => a._distKm - b._distKm).slice(0, 10);

    } else {
      // Sort by price ascending
      sorted = sorted.sort((a, b) => a.beer_price_pln - b.beer_price_pln).slice(0, 10);
    }

    if (sorted.length === 0) {
      listEl.innerHTML = '<div class="ranking-empty-desc" style="text-align:center;padding:24px;">Brak lokali spełniających kryteria.</div>';
      return;
    }

    let bannerHtml = "";
    if (rankingMode === "nearest") {
      if (isLocationFarAway) {
        const distFromWarsaw = Math.round(calculateDistanceKm(userLocation[0], userLocation[1], WARSAW_CENTER[0], WARSAW_CENTER[1]));
        bannerHtml = `
          <div class="ranking-banner-faraway" style="border-radius:10px;padding:8px 12px;margin:8px 10px;font-size:0.75rem;display:flex;flex-direction:column;gap:6px;">
            <div>🇸🇪 Wykryto lokalizację: <strong>${distFromWarsaw} km od Warszawy</strong> (np. Sztokholm).</div>
            <button type="button" id="btn-switch-to-warsaw" style="background:#ea580c;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:0.75rem;font-weight:700;cursor:pointer;">
              📍 Przełącz na Centrum Warszawy (spacer w minutach)
            </button>
          </div>
        `;
      } else if (isSimulatedLocation) {
        bannerHtml = `
          <div class="ranking-banner-simulated" style="border-radius:10px;padding:6px 12px;margin:6px 10px;font-size:0.72rem;display:flex;align-items:center;justify-content:space-between;">
            <span>📍 Pozycja: <strong>Centrum (Nowy Świat)</strong></span>
            <button type="button" id="btn-refresh-gps" style="background:none;border:none;text-decoration:underline;cursor:pointer;font-size:0.72rem;font-weight:600;">Włącz GPS</button>
          </div>
        `;
      }
    } else if (rankingMode === "favorites") {
      bannerHtml = `
        <div class="ranking-banner-favorites" style="border-radius:10px;padding:8px 12px;margin:8px 10px;font-size:0.75rem;display:flex;align-items:center;justify-content:space-between;">
          <span>❤️ Twoje ulubione lokale (<strong>${sorted.length}</strong>)</span>
          <span style="font-size:0.7rem;">wg ceny</span>
        </div>
      `;
    }

    listEl.innerHTML = bannerHtml + sorted.map((venue, idx) => {
      let distanceBadge = "";
      if (userLocation) {
        const distKm = venue._distKm !== undefined ? venue._distKm : calculateDistanceKm(userLocation[0], userLocation[1], venue.latitude, venue.longitude);
        const distM = venue._distM !== undefined ? venue._distM : Math.round(distKm * 1000);
        const walkMin = venue._walkMin !== undefined ? venue._walkMin : Math.max(1, Math.round(distKm / 4.8 * 60));
        const formattedDist = distM < 1000 ? `${distM}m` : `${distKm.toFixed(1)}km`;
        distanceBadge = `<span style="color:#38bdf8;font-weight:600;"> · 🚶 ${formattedDist} (~${walkMin} min)</span>`;
      }

      const hasProof = !!(venue.photo_url || venue.proof_image_url);
      const isVisited = isVenueVisited(venue.id);
      const isFav = isVenueFavorite(venue.id);
      const visitedChip = isVisited ? `<span style="color:#4ade80;font-size:0.7rem;font-weight:700;margin-left:4px;">✓ Byłem</span>` : "";
      const favChip = isFav ? `<span style="color:#fb7185;font-size:0.75rem;margin-left:4px;" title="W Twoich ulubionych">❤️</span>` : "";

      return `
        <div class="ranked-card" onclick="window.__zoomToVenue('${venue.id}')">
          <div class="ranked-pos">#${idx + 1}</div>
          <div class="ranked-info">
            <div class="ranked-name">
              ${escapeHtml(venue.name)}
              ${venue.old_name ? `<span style="font-size:0.75rem;font-weight:400;color:var(--text-muted);margin-left:4px;">(d. ${escapeHtml(venue.old_name)})</span>` : ''}
              ${hasProof ? '<span title="Posiada zdjęcie menu/paragonu" style="font-size:12px;margin-left:4px;">📸</span>' : ''}
              ${favChip}
              ${visitedChip}
            </div>
            <div class="ranked-sub">
              ${escapeHtml(venue.beer_name || "Piwo z kija")} · ${escapeHtml(venue.district)}
              ${distanceBadge}
            </div>
          </div>
          <div class="ranked-price">${venue.beer_price_pln.toFixed(2)} zł</div>
        </div>
      `;
    }).join("");

    const btnSwitchWarsaw = document.getElementById("btn-switch-to-warsaw");
    if (btnSwitchWarsaw) {
      btnSwitchWarsaw.addEventListener("click", () => {
        setUserLocation([52.2323, 21.0206], true, false);
      });
    }
    const btnRefreshGps = document.getElementById("btn-refresh-gps");
    if (btnRefreshGps) {
      btnRefreshGps.addEventListener("click", () => {
        const btnLocate = document.getElementById("btn-locate-me");
        if (btnLocate) btnLocate.click();
      });
    }
  }

  // Zoom & Pan to a specific venue from Ranking Drawer, Search or Deep Link
  window.__zoomToVenue = function (venueId) {
    const venue = allVenues.find(v => v.id === venueId || (v.slug && v.slug.toLowerCase() === venueId.toLowerCase()));
    if (!venue) return;

    // Update URL hash for deep linking
    const slug = venue.slug || venue.id;
    if (slug && window.location.hash !== `#${slug}`) {
      try {
        history.replaceState(null, "", `#${slug}`);
      } catch (e) {}
    }

    // Close drawer and modals on small screens
    const drawer = document.getElementById("ranking-drawer");
    if (drawer) {
      drawer.classList.remove("open");
    }
    const crawlModal = document.getElementById("pubcrawl-modal");
    if (crawlModal) {
      crawlModal.classList.remove("active");
    }
    const hhModal = document.getElementById("happyhour-modal");
    if (hhModal) {
      hhModal.classList.remove("active");
    }
    const passportModal = document.getElementById("passport-modal");
    if (passportModal) {
      passportModal.classList.remove("active");
    }
    const commModal = document.getElementById("community-modal");
    if (commModal) commModal.style.display = "none";
    const pubProfModal = document.getElementById("public-profile-modal");
    if (pubProfModal) pubProfModal.style.display = "none";
    const mobileSearchSheet = document.getElementById("mobile-search-sheet");
    if (mobileSearchSheet) mobileSearchSheet.style.display = "none";

    // If venue is hidden by current district or filter chip, reset to show all so marker exists
    if (!activeMarkers.some(m => m._venueData && m._venueData.id === venue.id)) {
      resetAllFilters();
    }

    const targetMarker = activeMarkers.find(m => {
      const ll = m.getLatLng();
      return Math.abs(ll.lat - venue.latitude) < 0.0001 && Math.abs(ll.lng - venue.longitude) < 0.0001;
    });

    if (clusterGroup && targetMarker) {
      clusterGroup.zoomToShowLayer(targetMarker, () => {
        targetMarker.openPopup();
      });
    } else {
      map.flyTo([venue.latitude, venue.longitude], 17, { duration: 1.2 });
      setTimeout(() => {
        if (targetMarker) {
          targetMarker.openPopup();
        }
      }, 1300);
    }
  };

  // Local Storage Helpers
  function loadLocalUpdates() {
    try {
      const saved = localStorage.getItem("warsaw_user_venues");
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function saveLocalVenue(venue) {
    try {
      const list = loadLocalUpdates();
      const idx = list.findIndex(v => v.id === venue.id);
      if (idx >= 0) {
        list[idx] = venue;
      } else {
        list.push(venue);
      }
      localStorage.setItem("warsaw_user_venues", JSON.stringify(list));
    } catch (e) {
      console.error(e);
    }
  }

  function saveLocalVotes(venueId, votes) {
    try {
      const votesMap = JSON.parse(localStorage.getItem("warsaw_venue_votes") || "{}");
      votesMap[venueId] = votes;
      localStorage.setItem("warsaw_venue_votes", JSON.stringify(votesMap));
    } catch (e) {}
  }

  function applyLocalVotes() {
    try {
      const votesMap = JSON.parse(localStorage.getItem("warsaw_venue_votes") || "{}");
      allVenues.forEach(v => {
        if (votesMap[v.id]) v.votes_confirm = votesMap[v.id];
      });
    } catch (e) {}
  }

  // ==========================================================================
  // PUB CRAWL GENERATOR LOGIC (poilepiwko)
  // ==========================================================================

  function getCrawlCandidatePool(startVal, userLoc, validVenues) {
    let startCoords = WARSAW_CENTER;
    let pool = [];

    if (startVal === "bulwary") {
      startCoords = (CRAWL_HOTSPOTS.bulwary && CRAWL_HOTSPOTS.bulwary.coords) || [52.2385, 21.0295];
      pool = validVenues.filter(v => {
        // Hard exclusion: Pawilony, Praga / Right Bank, west of escarpment
        if (v.district === "Pawilony") return false;
        if (v.district && v.district.startsWith("Praga")) return false;
        if (v.longitude < 21.025) return false;
        if (v.district === "Bulwary") return true;
        // Powiśle / Waterfront strip
        if (v.longitude >= 21.026 && v.latitude >= 52.225 && v.latitude <= 52.248) {
          return calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 0.95;
        }
        return false;
      });
    } else if (startVal === "pawilony") {
      startCoords = (CRAWL_HOTSPOTS.pawilony && CRAWL_HOTSPOTS.pawilony.coords) || [52.2323, 21.0206];
      pool = validVenues.filter(v => {
        if (v.district === "Bulwary") return false;
        if (v.district === "Pawilony") return true;
        return calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 0.35;
      });
    } else if (startVal === "nowogrodzka") {
      startCoords = (CRAWL_HOTSPOTS.nowogrodzka && CRAWL_HOTSPOTS.nowogrodzka.coords) || [52.2289, 21.0118];
      pool = validVenues.filter(v => {
        if (v.district === "Pawilony" || v.district === "Bulwary") return false;
        return calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 0.65;
      });
    } else if (startVal === "zbawiciela") {
      startCoords = (CRAWL_HOTSPOTS.zbawiciela && CRAWL_HOTSPOTS.zbawiciela.coords) || [52.2199, 21.0185];
      pool = validVenues.filter(v => {
        if (v.district === "Pawilony" || v.district === "Bulwary") return false;
        return calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 0.60;
      });
    } else if (startVal === "praga") {
      startCoords = (CRAWL_HOTSPOTS.praga && CRAWL_HOTSPOTS.praga.coords) || [52.2530, 21.0390];
      pool = validVenues.filter(v => {
        // Strict right bank
        if (v.longitude < 21.025) return false;
        if (v.district === "Pawilony" || v.district === "Bulwary" || v.district === "Śródmieście") return false;
        if (v.district === "Praga Północ") return true;
        return calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 1.1;
      });
    } else if (startVal === "wola") {
      startCoords = (CRAWL_HOTSPOTS.wola && CRAWL_HOTSPOTS.wola.coords) || [52.2355, 20.9880];
      pool = validVenues.filter(v => {
        if (v.district === "Pawilony" || v.district === "Bulwary") return false;
        return calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 0.85;
      });
    } else if (startVal === "gps") {
      if (userLoc) {
        const distFromWarsaw = calculateDistanceKm(userLoc[0], userLoc[1], WARSAW_CENTER[0], WARSAW_CENTER[1]);
        if (distFromWarsaw < 60) {
          startCoords = userLoc;
        }
      }
      pool = validVenues.filter(v => calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 1.0);
      if (pool.length < 4) {
        pool = validVenues.filter(v => calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 1.8);
      }
      if (pool.length < 4) {
        pool = validVenues.filter(v => calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 3.0);
      }
    } else if (startVal.toLowerCase() === "śródmieście") {
      startCoords = (DISTRICT_CENTERS["Śródmieście"] && DISTRICT_CENTERS["Śródmieście"].coords) || WARSAW_CENTER;
      // Śródmieście is large, so prefer venues within 1.2km of central hub
      pool = validVenues.filter(v => v.district && v.district.toLowerCase() === "śródmieście" && calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 1.2);
      if (pool.length < 4) {
        pool = validVenues.filter(v => v.district && v.district.toLowerCase() === "śródmieście");
      }
    } else if (DISTRICT_CENTERS[startVal]) {
      startCoords = DISTRICT_CENTERS[startVal].coords;
      pool = validVenues.filter(v => v.district && v.district.toLowerCase() === startVal.toLowerCase());
      if (pool.length < 4) {
        pool = validVenues.filter(v => calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 1.8);
      }
    } else {
      pool = validVenues.filter(v => v.district && v.district.toLowerCase() === startVal.toLowerCase());
      if (pool.length < 4) {
        pool = validVenues.filter(v => calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude) <= 2.0);
      }
    }

    return { startCoords, pool };
  }

  function generatePubCrawlRoute(startVal, stopsCount, vibe) {
    const validVenues = allVenues.filter(v => v.latitude && v.longitude && typeof v.beer_price_pln === "number" && v.beer_price_pln > 0);
    if (!validVenues || validVenues.length === 0) return null;

    const { startCoords, pool } = getCrawlCandidatePool(startVal, userLocation, validVenues);
    if (!pool || pool.length === 0) return null;

    const actualStops = Math.min(stopsCount, pool.length);
    const prices = pool.map(v => v.beer_price_pln);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = Math.max(1, maxPrice - minPrice);

    // Score candidates relative to this specific area and vibe
    const scored = pool.map(v => {
      const distFromStartKm = calculateDistanceKm(startCoords[0], startCoords[1], v.latitude, v.longitude);
      let baseScore = 100;
      const priceNorm = (v.beer_price_pln - minPrice) / priceRange;

      const isOpen = isVenueOpen(v);
      if (isOpen) baseScore += 12;

      if (vibe === "cheap") {
        // Cheaper beer within this area gets massive bonus
        baseScore += (1 - priceNorm) * 50 - 15;
        if (v.beer_price_pln <= 12) baseScore += 12;
        else if (v.beer_price_pln <= 15) baseScore += 6;
        if (v.happy_hour) baseScore += 8;
      } else if (vibe === "craft") {
        if (v.is_craft) baseScore += 50;
        else baseScore -= 25;
        if (v.beer_price_pln >= 17) baseScore += 8;
      } else if (vibe === "party") {
        if (v.happy_hour) baseScore += 25;
        if (v.shot_price_pln && v.shot_price_pln <= 9) baseScore += 20;
        if (v.district && v.district.toLowerCase() === "pawilony") baseScore += 12;
      } else if (vibe === "mix") {
        if (v.is_craft) baseScore += 16;
        if (priceNorm <= 0.4) baseScore += 16;
        if (v.happy_hour) baseScore += 10;
      }

      baseScore -= distFromStartKm * 14;
      baseScore += (Math.random() - 0.5) * 6; // Freshness on re-roll

      return { venue: v, baseScore, distFromStartKm, isOpen };
    });

    const routeStops = [];
    let currentPos = startCoords;
    let remaining = [...scored];
    const isPawilony = startVal === "pawilony";

    for (let i = 0; i < actualStops; i++) {
      if (remaining.length === 0) break;

      if (i === 0) {
        // First stop: closest to hub with top vibe score
        remaining.sort((a, b) => b.baseScore - a.baseScore);
        const topSlice = remaining.slice(0, Math.min(3, remaining.length));
        const chosen = topSlice[Math.floor(Math.random() * topSlice.length)];
        const legDistM = Math.round(calculateDistanceKm(startCoords[0], startCoords[1], chosen.venue.latitude, chosen.venue.longitude) * 1000);

        routeStops.push({
          venue: chosen.venue,
          legDistMeters: legDistM,
          legMinutes: Math.max(1, Math.round(legDistM / 75))
        });
        currentPos = [chosen.venue.latitude, chosen.venue.longitude];
        remaining = remaining.filter(r => r.venue.id !== chosen.venue.id);
      } else {
        // Subsequent stops: prioritize realistic walking distance
        const candidates = remaining.map(item => {
          const dM = Math.round(calculateDistanceKm(currentPos[0], currentPos[1], item.venue.latitude, item.venue.longitude) * 1000);
          let legScore = item.baseScore;

          if (isPawilony) {
            if (dM <= 250) legScore += 35;
            else legScore -= (dM - 250) / 10;
          } else {
            if (dM < 40) {
              legScore -= 6;
            } else if (dM <= 450) {
              legScore += 32; // optimal walking leg
            } else if (dM <= 750) {
              legScore += 16;
            } else {
              legScore -= (dM - 750) / 15;
            }
          }

          // Avoid immediately backtracking to previous-previous stop
          if (i >= 2) {
            const prevPrev = routeStops[i - 2];
            const distToPrevPrev = Math.round(calculateDistanceKm(item.venue.latitude, item.venue.longitude, prevPrev.venue.latitude, prevPrev.venue.longitude) * 1000);
            if (distToPrevPrev < 90 && !isPawilony) {
              legScore -= 25;
            }
          }

          // Mix vibe variety: prefer alternating craft / non-craft
          if (vibe === "mix") {
            const lastStop = routeStops[i - 1];
            if (!!item.venue.is_craft !== !!lastStop.venue.is_craft) {
              legScore += 12;
            }
          }

          return { ...item, dM, legScore };
        }).sort((a, b) => b.legScore - a.legScore);

        const topPicks = candidates.slice(0, Math.min(2, candidates.length));
        const chosen = topPicks[Math.floor(Math.random() * topPicks.length)];

        routeStops.push({
          venue: chosen.venue,
          legDistMeters: chosen.dM,
          legMinutes: Math.max(1, Math.round(chosen.dM / 75))
        });
        currentPos = [chosen.venue.latitude, chosen.venue.longitude];
        remaining = remaining.filter(r => r.venue.id !== chosen.venue.id);
      }
    }

    let totalDistMeters = 0;
    let totalCost = 0;
    for (let i = 0; i < routeStops.length; i++) {
      totalCost += routeStops[i].venue.beer_price_pln;
      if (i > 0) {
        totalDistMeters += routeStops[i].legDistMeters;
      }
    }
    const avgPrice = routeStops.length > 0 ? (totalCost / routeStops.length) : 0;

    return {
      stops: routeStops,
      totalDistance: totalDistMeters,
      totalCost,
      avgPrice,
      startCoords,
      startVal,
      vibe,
      stopsCount: actualStops
    };
  }

  function buildGoogleMapsDirectionsUrl(venues) {
    if (!venues || venues.length < 2) return "#";
    const origin = `${venues[0].latitude},${venues[0].longitude}`;
    const destination = `${venues[venues.length - 1].latitude},${venues[venues.length - 1].longitude}`;

    if (venues.length === 2) {
      return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
    }

    const waypoints = venues.slice(1, -1).map(v => `${v.latitude},${v.longitude}`).join("%7C");
    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=walking`;
  }

  function renderPubCrawlResult(route) {
    activeCrawlRoute = route;
    const resultBox = document.getElementById("crawl-result-container");
    const statDist = document.getElementById("crawl-stat-dist");
    const statCost = document.getElementById("crawl-stat-cost");
    const statAvg = document.getElementById("crawl-stat-avg");
    const timelineList = document.getElementById("crawl-timeline-list");
    const gmapsLink = document.getElementById("btn-crawl-gmaps-link");

    if (!resultBox || !timelineList) return;

    const distText = route.totalDistance >= 1000
      ? (route.totalDistance / 1000).toFixed(1) + " km"
      : Math.round(route.totalDistance) + " m";

    if (statDist) statDist.textContent = distText;
    if (statCost) statCost.textContent = route.totalCost.toFixed(2) + " zł";
    if (statAvg) statAvg.textContent = route.avgPrice.toFixed(2) + " zł / piwo";

    const gmapsUrl = buildGoogleMapsDirectionsUrl(route.stops.map(s => s.venue));
    if (gmapsLink) {
      gmapsLink.href = gmapsUrl;
    }

    let html = "";
    route.stops.forEach((stop, idx) => {
      const v = stop.venue;
      const isOpen = isVenueOpen(v);

      if (idx > 0) {
        html += `
          <div class="crawl-leg-transit">
            <div class="crawl-leg-dots"></div>
            <span>🚶 ~${stop.legDistMeters}m (ok. ${stop.legMinutes} min spaceru)</span>
          </div>
        `;
      }

      const craftChip = v.is_craft ? `<span class="crawl-stop-chip craft">💎 Kraft</span>` : "";
      const hhChip = v.happy_hour ? `<span class="crawl-stop-chip hh">⚡ ${escapeHtml(v.happy_hour)}</span>` : "";
      const openChip = isOpen ? `<span class="crawl-stop-chip" style="color:#4ade80;">● Otwarte</span>` : `<span class="crawl-stop-chip" style="color:#94a3b8;">○ Sprawdź godz.</span>`;

      html += `
        <div class="crawl-stop-card" onclick="window.__zoomToVenue('${v.id}')" title="Kliknij, aby zobaczyć ten bar na mapie">
          <div class="crawl-stop-badge">${idx + 1}</div>
          <div class="crawl-stop-info">
            <div class="crawl-stop-header">
              <span class="crawl-stop-name">${escapeHtml(v.name)}</span>
              <span class="crawl-stop-price">${v.beer_price_pln.toFixed(2)} zł</span>
            </div>
            <div class="crawl-stop-address">📍 ${escapeHtml(v.address || v.district)} · ${escapeHtml(v.beer_name || 'Piwo')}</div>
            <div class="crawl-stop-chips">
              ${craftChip}
              ${hhChip}
              ${openChip}
            </div>
          </div>
        </div>
      `;
    });

    timelineList.innerHTML = html;
    resultBox.style.display = "block";
  }

  let activeCrawlStep = 0;
  let crawlMarkerInstances = [];
  let lastCompletedCrawlRoute = null;

  function updateCrawlStepUI() {
    if (!activeCrawlRoute || !activeCrawlRoute.stops.length) return;
    const activeStepIndicator = document.getElementById("crawl-active-step-indicator");
    const activeSub = document.getElementById("crawl-active-sub");
    const checkinLabel = document.getElementById("crawl-checkin-label");
    const activeGmaps = document.getElementById("btn-crawl-active-gmaps");

    const totalStops = activeCrawlRoute.stops.length;
    const currentStop = activeCrawlRoute.stops[activeCrawlStep];
    if (!currentStop) return;

    if (activeStepIndicator) {
      activeStepIndicator.innerHTML = `📍 Przystanek <strong>${activeCrawlStep + 1}</strong> z <strong>${totalStops}</strong>: <span class="crawl-current-name">${escapeHtml(currentStop.venue.name)}</span> <span class="crawl-current-price">(${currentStop.venue.beer_price_pln.toFixed(2)} zł)</span>`;
    }
    if (activeSub) {
      activeSub.textContent = `Koszt trasy: ~${activeCrawlRoute.totalCost.toFixed(2)} zł · śr. ${activeCrawlRoute.avgPrice.toFixed(2)} zł/piwo`;
    }
    if (checkinLabel) {
      if (activeCrawlStep >= totalStops - 1) {
        checkinLabel.textContent = "🏆 Wypite! Zakończ 🎉";
      } else {
        checkinLabel.textContent = "Wypite! Kolejny →";
      }
    }
    if (activeGmaps) {
      activeGmaps.href = buildGoogleMapsNavigationUrl(currentStop.venue);
    }

    // Refresh marker DOM classes
    crawlMarkerInstances.forEach((markerObj, idx) => {
      const el = markerObj.marker.getElement();
      if (!el) return;
      const badge = el.querySelector(".crawl-marker-badge");
      if (!badge) return;

      badge.classList.remove("visited-stop", "active-stop");
      if (idx < activeCrawlStep) {
        badge.classList.add("visited-stop");
        badge.textContent = "✓";
      } else if (idx === activeCrawlStep) {
        badge.classList.add("active-stop");
        badge.textContent = `${idx + 1}`;
      } else {
        badge.textContent = `${idx + 1}`;
      }
    });
  }

  function advancePubCrawlStep() {
    if (!activeCrawlRoute || !activeCrawlRoute.stops.length) return;
    const currentStop = activeCrawlRoute.stops[activeCrawlStep];
    if (!currentStop) return;

    // Stamp passport if not visited
    if (!visitedVenues.includes(currentStop.venue.id)) {
      toggleVisitedVenue(currentStop.venue.id);
    }

    // Trigger toast & cheer sound
    if (typeof triggerCheersAnimation === "function") {
      triggerCheersAnimation(`Wypite w: ${currentStop.venue.name}! 🍻`);
    }

    if (activeCrawlStep < activeCrawlRoute.stops.length - 1) {
      activeCrawlStep++;
      updateCrawlStepUI();
      const nextStop = activeCrawlRoute.stops[activeCrawlStep];
      if (map && nextStop) {
        map.flyTo([nextStop.venue.latitude, nextStop.venue.longitude], 16, { duration: 0.9 });
        setTimeout(() => {
          if (crawlMarkerInstances[activeCrawlStep]) {
            crawlMarkerInstances[activeCrawlStep].marker.openPopup();
          }
        }, 950);
      }
    } else {
      // Completed last stop!
      lastCompletedCrawlRoute = activeCrawlRoute;
      clearCrawlFromMap();
      openCrawlCompleteModal(lastCompletedCrawlRoute);
    }
  }

  function openCrawlCompleteModal(route) {
    if (!route || !route.stops.length) return;
    const modal = document.getElementById("crawl-complete-modal");
    if (!modal) return;

    const stopsCountEl = document.getElementById("crawl-done-stops-count");
    const costEl = document.getElementById("crawl-done-cost");
    const distEl = document.getElementById("crawl-done-dist");
    const listEl = document.getElementById("crawl-done-stops-list");

    if (stopsCountEl) stopsCountEl.textContent = route.stops.length;
    if (costEl) costEl.textContent = `~${route.totalCost.toFixed(2)} zł`;
    if (distEl) {
      distEl.textContent = route.totalDistance >= 1000 
        ? `${(route.totalDistance / 1000).toFixed(1)} km` 
        : `${Math.round(route.totalDistance)} m`;
    }

    if (listEl) {
      listEl.innerHTML = route.stops.map((s, idx) => `
        <div class="celebration-stop-item">
          <div class="celebration-stop-left">
            <span class="celebration-stop-check">✓</span>
            <span class="celebration-stop-name">${idx + 1}. ${escapeHtml(s.venue.name)}</span>
          </div>
          <span class="celebration-stop-price">${s.venue.beer_price_pln.toFixed(2)} zł</span>
        </div>
      `).join("");
    }

    modal.style.display = "flex";

    // Trigger celebratory sound & canvas confetti
    if (typeof playFanfareChime === "function") playFanfareChime();
    if (typeof launchConfetti === "function") launchConfetti("crawl-confetti-canvas", 3500);

    // Vibrate triumphal pattern
    if (navigator.vibrate) {
      try { navigator.vibrate([100, 50, 100, 50, 200]); } catch (e) {}
    }
  }

  function shareCompletedCrawl(route) {
    if (!route || !route.stops.length) return;
    const stopsText = route.stops.map((s, i) => `${i + 1}. ${s.venue.name} (${s.venue.beer_price_pln.toFixed(2)} zł)`).join("\n");
    const distText = route.totalDistance >= 1000 ? (route.totalDistance / 1000).toFixed(1) + " km" : Math.round(route.totalDistance) + " m";
    const text = `🏆 Właśnie pokonaliśmy Pub Crawl na poilepiwko.pl!\n` +
      `Zaliczone bary (${route.stops.length}):\n${stopsText}\n` +
      `🚶 Spacer: ~${distText} | Koszt piwek: ~${route.totalCost.toFixed(2)} zł\n` +
      `Kto podejmie wyzwanie? Sprawdź na https://poilepiwko.pl! 🍻`;

    if (navigator.share) {
      navigator.share({
        title: "Pub Crawl Ukończony! - poilepiwko",
        text: text
      }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        alert("📋 Podsumowanie Pub Crawlu skopiowane do schowka!");
      }).catch(() => {
        prompt("Skopiuj podsumowanie:", text);
      });
    } else {
      prompt("Skopiuj podsumowanie:", text);
    }
  }

  function showCrawlOnMap(route) {
    if (!map || !route || !route.stops.length) return;
    activeCrawlRoute = route;
    activeCrawlStep = 0;
    crawlMarkerInstances = [];

    if (!crawlMapLayer) {
      crawlMapLayer = L.layerGroup().addTo(map);
    } else {
      crawlMapLayer.clearLayers();
    }

    const latlngs = route.stops.map(s => [s.venue.latitude, s.venue.longitude]);

    // Underglow polyline
    L.polyline(latlngs, {
      color: "#ea580c",
      weight: 9,
      opacity: 0.35
    }).addTo(crawlMapLayer);

    // Dashed main polyline
    const mainPoly = L.polyline(latlngs, {
      color: "#f97316",
      weight: 5,
      opacity: 0.95,
      dashArray: "8, 8",
      lineCap: "round",
      lineJoin: "round"
    }).addTo(crawlMapLayer);

    // Numbered stop markers with live status
    route.stops.forEach((stop, idx) => {
      const v = stop.venue;
      const isVisited = idx < activeCrawlStep;
      const isActive = idx === activeCrawlStep;
      let badgeClass = "crawl-marker-badge";
      let badgeContent = `${idx + 1}`;
      if (isVisited) {
        badgeClass += " visited-stop";
        badgeContent = "✓";
      } else if (isActive) {
        badgeClass += " active-stop";
      }

      const badgeIcon = L.divIcon({
        className: "crawl-marker-wrap",
        html: `<div class="${badgeClass}">${badgeContent}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -18]
      });

      const popupHtml = `
        <div class="crawl-popup-card">
          <div class="crawl-popup-header">
            <span class="crawl-popup-badge">🚶 Przystanek #${idx + 1} z ${route.stops.length}</span>
          </div>
          <div class="crawl-popup-title">${escapeHtml(v.name)}</div>
          <div class="crawl-popup-price">
            🍺 ${v.beer_price_pln.toFixed(2)} zł
            <span class="crawl-popup-beer-name">(${escapeHtml(v.beer_name || 'Piwo z nalewaka')})</span>
          </div>
          <div class="crawl-popup-address">📍 ${escapeHtml(v.address || v.district)}</div>
          <button type="button" class="crawl-popup-btn" onclick="window.__zoomToVenue('${v.id}')">
            Pokaż szczegóły lokalu
          </button>
        </div>
      `;

      const marker = L.marker([v.latitude, v.longitude], { icon: badgeIcon })
        .addTo(crawlMapLayer)
        .bindPopup(popupHtml);

      crawlMarkerInstances.push({ marker, stop, idx });
    });
    window.__crawlMarkerInstances = crawlMarkerInstances;

    map.fitBounds(mainPoly.getBounds(), { padding: [60, 60], maxZoom: 16 });

    const activeBar = document.getElementById("active-crawl-bar");
    if (activeBar) {
      activeBar.style.display = "flex";
    }

    updateCrawlStepUI();

    if (window.__closePubCrawl) window.__closePubCrawl();
  }
  window.__showCrawlOnMap = showCrawlOnMap;
  window.__generatePubCrawlRoute = generatePubCrawlRoute;

  function clearCrawlFromMap() {
    if (crawlMapLayer) {
      crawlMapLayer.clearLayers();
    }
    crawlMarkerInstances = [];
    const activeBar = document.getElementById("active-crawl-bar");
    if (activeBar) {
      activeBar.style.display = "none";
    }
  }

  function shareCrawlRoute(route) {
    if (!route || !route.stops.length) return;
    const stopsText = route.stops.map((s, i) => `${i + 1}. ${s.venue.name} (${s.venue.beer_price_pln.toFixed(2)} zł)`).join("\n");
    const distText = route.totalDistance >= 1000 ? (route.totalDistance / 1000).toFixed(1) + " km" : Math.round(route.totalDistance) + " m";
    const gmaps = buildGoogleMapsDirectionsUrl(route.stops.map(s => s.venue));
    const text = `🍻 Pub Crawl poilepiwko:\n${stopsText}\n🚶 Spacer: ~${distText} | Koszt piwek: ${route.totalCost.toFixed(2)} zł\n🧭 Nawigacja piesza: ${gmaps}\nSprawdź w poilepiwko!`;

    if (navigator.share) {
      navigator.share({
        title: "Pub Crawl - poilepiwko",
        text: text
      }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        alert("📋 Pub Crawl skopiowany do schowka! Możesz wysłać go znajomym.");
      }).catch(() => {
        prompt("Skopiuj Pub Crawl:", text);
      });
    } else {
      prompt("Skopiuj Pub Crawl:", text);
    }
  }

  // ==========================================================================
  // HAPPY HOURS & LIVE PROMOTIONS ENGINE
  // ==========================================================================

  let selectedCalendarDay = (new Date()).getDay();

  function renderHappyHourModal() {
    const now = new Date();
    const nowCountEl = document.getElementById("hh-now-count");
    const nowClockEl = document.getElementById("hh-now-clock-text");
    const nowListEl = document.getElementById("hh-now-list");
    const calendarListEl = document.getElementById("hh-calendar-list");

    // 1. Render Active Now Tab
    const activeVenues = allVenues
      .map(v => ({ venue: v, hh: getActiveHappyHour(v, now) }))
      .filter(item => item.hh !== null)
      .sort((a, b) => (a.hh.rule.promo_price || 99) - (b.hh.rule.promo_price || 99));

    if (nowCountEl) nowCountEl.textContent = activeVenues.length;

    const timeStr = now.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    if (nowClockEl) {
      if (activeVenues.length > 0) {
        nowClockEl.textContent = `Aktualnie ${activeVenues.length} ${activeVenues.length === 1 ? 'bar ma' : activeVenues.length < 5 ? 'bary mają' : 'barów ma'} aktywną promocję (stan na ${timeStr})`;
      } else {
        nowClockEl.textContent = `Brak aktywnych promocji o tej godzinie (${timeStr}). Zobacz Rozpiskę Tygodnia lub sprawdź ok. 16:00-19:00!`;
      }
    }

    if (nowListEl) {
      if (activeVenues.length === 0) {
        nowListEl.innerHTML = `
          <div style="text-align:center;padding:28px 16px;color:var(--text-muted);font-size:0.82rem;">
            <div style="font-size:36px;margin-bottom:8px;">🕒</div>
            <div style="font-weight:700;color:#fff;margin-bottom:4px;">Aktualnie brak trwających Happy Hours</div>
            <div>Większość warszawskich lokali odpala promocje studenckie i biforowe w godzinach 16:00 - 19:00.</div>
            <button type="button" id="btn-switch-to-calendar" class="btn-primary" style="margin-top:12px;font-size:0.78rem;padding:7px 14px;">
              📅 Sprawdź Rozpiskę Tygodnia
            </button>
          </div>
        `;
        const btnSwitch = document.getElementById("btn-switch-to-calendar");
        if (btnSwitch) {
          btnSwitch.addEventListener("click", () => {
            const tabCal = document.getElementById("tab-hh-calendar");
            if (tabCal) tabCal.click();
          });
        }
      } else {
        nowListEl.innerHTML = activeVenues.map(({ venue, hh }) => {
          const rule = hh.rule;
          const regPrice = venue.beer_price_pln;
          const promoPrice = rule.promo_price;
          const savePln = (regPrice - promoPrice).toFixed(2);
          return `
            <div class="hh-card" onclick="window.__zoomToVenue('${venue.id}')" title="Kliknij, aby pokazać na mapie">
              <div class="hh-card-info">
                <div class="hh-card-title">
                  <span>${escapeHtml(venue.name)}</span>
                  <span class="hh-card-tag active-now">⚡ Trwa teraz</span>
                </div>
                <div class="hh-card-desc">${escapeHtml(rule.description || "Piwo w promocji")}</div>
                <div class="hh-card-meta">
                  <span>📍 ${escapeHtml(venue.district)}</span>
                  <span class="hh-countdown-badge">⏳ Jeszcze ${formatMinutesLeft(hh.minutesLeft)}</span>
                  ${parseFloat(savePln) > 0 ? `<span style="color:#4ade80;font-weight:700;">Taniej o ${savePln} zł!</span>` : ''}
                </div>
              </div>
              <div class="hh-card-prices">
                <div class="hh-price-promo">${promoPrice.toFixed(2)} zł</div>
                <div class="hh-price-regular">standard: ${regPrice.toFixed(2)} zł</div>
              </div>
            </div>
          `;
        }).join("");
      }
    }

    // 2. Render Calendar Tab
    if (calendarListEl) {
      const dayVenues = allVenues.filter(v => v.happy_hour_rule && Array.isArray(v.happy_hour_rule.days) && v.happy_hour_rule.days.includes(selectedCalendarDay))
        .sort((a, b) => (a.happy_hour_rule.promo_price || 99) - (b.happy_hour_rule.promo_price || 99));

      if (dayVenues.length === 0) {
        calendarListEl.innerHTML = `
          <div style="text-align:center;padding:24px 16px;color:var(--text-muted);font-size:0.8rem;">
            Brak wprowadzonych Happy Hours na ten dzień tygodnia w naszej bazie.
          </div>
        `;
      } else {
        calendarListEl.innerHTML = dayVenues.map(venue => {
          const rule = venue.happy_hour_rule;
          const regPrice = venue.beer_price_pln;
          const promoPrice = rule.promo_price;
          const startStr = `${String(rule.start_hour).padStart(2, '0')}:${String(rule.start_minute || 0).padStart(2, '0')}`;
          const endStr = `${String(rule.end_hour).padStart(2, '0')}:${String(rule.end_minute || 0).padStart(2, '0')}`;
          const isCurrentlyActive = getActiveHappyHour(venue, now) !== null;

          return `
            <div class="hh-card" onclick="window.__zoomToVenue('${venue.id}')" title="Kliknij, aby pokazać na mapie">
              <div class="hh-card-info">
                <div class="hh-card-title">
                  <span>${escapeHtml(venue.name)}</span>
                  <span class="hh-card-tag ${isCurrentlyActive ? 'active-now' : ''}">${isCurrentlyActive ? '⚡ Trwa teraz' : escapeHtml(rule.label || 'Promocja')}</span>
                </div>
                <div class="hh-card-desc">${escapeHtml(rule.description || "Piwo z kranu w promocji")}</div>
                <div class="hh-card-meta">
                  <span>📍 ${escapeHtml(venue.district)}</span>
                  <span>🕒 ${startStr} - ${endStr}</span>
                </div>
              </div>
              <div class="hh-card-prices">
                <div class="hh-price-promo">${promoPrice.toFixed(2)} zł</div>
                <div class="hh-price-regular">standard: ${regPrice.toFixed(2)} zł</div>
              </div>
            </div>
          `;
        }).join("");
      }
    }
  }

  function initHappyHours() {
    const hhModal = document.getElementById("happyhour-modal");
    const btnHeader = document.getElementById("btn-happyhour-header");
    const btnClose = document.getElementById("btn-close-happyhour");
    const tabNow = document.getElementById("tab-hh-now");
    const tabCal = document.getElementById("tab-hh-calendar");
    const contentNow = document.getElementById("hh-tab-content-now");
    const contentCal = document.getElementById("hh-tab-content-calendar");
    const pills = document.querySelectorAll("#hh-days-pills .hh-day-pill");

    function openModal() {
      if (!hhModal) return;
      // Close other panels
      const drawer = document.getElementById("ranking-drawer");
      if (drawer) drawer.classList.remove("open");
      const baroModal = document.getElementById("barometer-modal");
      if (baroModal) baroModal.classList.remove("active");
      const crawlModal = document.getElementById("pubcrawl-modal");
      if (crawlModal) crawlModal.classList.remove("active");
      const passportModal = document.getElementById("passport-modal");
      if (passportModal) passportModal.classList.remove("active");

      // Highlight current day pill by default
      selectedCalendarDay = (new Date()).getDay();
      pills.forEach(p => {
        const d = parseInt(p.getAttribute("data-day"), 10);
        if (d === selectedCalendarDay) p.classList.add("active");
        else p.classList.remove("active");
      });

      renderHappyHourModal();
      hhModal.classList.add("active");
    }

    function closeModal() {
      if (hhModal) hhModal.classList.remove("active");
    }

    window.__openHappyHours = openModal;
    window.__closeHappyHours = closeModal;

    if (btnHeader) btnHeader.addEventListener("click", openModal);
    if (btnClose) btnClose.addEventListener("click", closeModal);
    if (hhModal) {
      hhModal.addEventListener("click", (e) => {
        if (e.target === hhModal) closeModal();
      });
    }

    // Tabs switching
    if (tabNow && tabCal && contentNow && contentCal) {
      tabNow.addEventListener("click", () => {
        tabNow.classList.add("active");
        tabCal.classList.remove("active");
        contentNow.style.display = "block";
        contentCal.style.display = "none";
        renderHappyHourModal();
      });
      tabCal.addEventListener("click", () => {
        tabCal.classList.add("active");
        tabNow.classList.remove("active");
        contentNow.style.display = "none";
        contentCal.style.display = "block";
        renderHappyHourModal();
      });
    }

    // Calendar day pills
    pills.forEach(pill => {
      pill.addEventListener("click", () => {
        pills.forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        selectedCalendarDay = parseInt(pill.getAttribute("data-day"), 10);
        renderHappyHourModal();
      });
    });
  }

  // ==========================================================================
  // PIWNY PASZPORT WARSZAWY & GAMIFICATION
  // ==========================================================================

  function saveVisitedVenues(list) {
    try {
      localStorage.setItem(PASSPORT_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  function loadUnlockedBadges() {
    try {
      const raw = localStorage.getItem(PASSPORT_BADGES_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveUnlockedBadges(list) {
    try {
      localStorage.setItem(PASSPORT_BADGES_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  const PASSPORT_BADGES = [
    {
      id: "student_pawilony",
      name: "Student na Pawilonach",
      icon: "🎓",
      desc: "Odwiedź co najmniej 3 bary w Pawilonach Nowy Świat",
      check: (visited, vMap) => {
        const c = visited.filter(id => vMap[id] && (vMap[id].district === "Pawilony" || (vMap[id].name && vMap[id].name.toLowerCase().includes("pawilony")))).length;
        return { unlocked: c >= 3, progress: `${Math.min(c, 3)}/3` };
      }
    },
    {
      id: "veteran_pawilony",
      name: "Weteran Pawilonów",
      icon: "🔥",
      desc: "Odwiedź co najmniej 10 barów w Pawilonach",
      check: (visited, vMap) => {
        const c = visited.filter(id => vMap[id] && (vMap[id].district === "Pawilony" || (vMap[id].name && vMap[id].name.toLowerCase().includes("pawilony")))).length;
        return { unlocked: c >= 10, progress: `${Math.min(c, 10)}/10` };
      }
    },
    {
      id: "craft_connoisseur",
      name: "Koneser Kraftu",
      icon: "💎",
      desc: "Odwiedź co najmniej 3 multitapy lub bary kraftowe",
      check: (visited, vMap) => {
        const c = visited.filter(id => vMap[id] && vMap[id].is_craft).length;
        return { unlocked: c >= 3, progress: `${Math.min(c, 3)}/3` };
      }
    },
    {
      id: "wisla_sailor",
      name: "Bulwarowy Żeglarz",
      icon: "🌊",
      desc: "Odwiedź co najmniej 2 bary na Bulwarach Wiślanych",
      check: (visited, vMap) => {
        const c = visited.filter(id => vMap[id] && (vMap[id].district === "Bulwary" || (vMap[id].address && vMap[id].address.toLowerCase().includes("bulwar")))).length;
        return { unlocked: c >= 2, progress: `${Math.min(c, 2)}/2` };
      }
    },
    {
      id: "praga_artist",
      name: "Praski Odkrywca",
      icon: "🎨",
      desc: "Odwiedź co najmniej 3 bary po prawej stronie Wisły (Praga)",
      check: (visited, vMap) => {
        const c = visited.filter(id => vMap[id] && vMap[id].district && vMap[id].district.includes("Praga")).length;
        return { unlocked: c >= 3, progress: `${Math.min(c, 3)}/3` };
      }
    },
    {
      id: "district_explorer",
      name: "Dzielnicowy Podróżnik",
      icon: "🧭",
      desc: "Odwiedź lokale w co najmniej 4 różnych dzielnicach",
      check: (visited, vMap) => {
        const districts = new Set(visited.map(id => vMap[id] && vMap[id].district).filter(Boolean));
        return { unlocked: districts.size >= 4, progress: `${Math.min(districts.size, 4)}/4` };
      }
    },
    {
      id: "pub_crawler",
      name: "Pub Crawler",
      icon: "🚀",
      desc: "Odwiedź co najmniej 3 bary w ramach warszawskiej trasy",
      check: (visited, vMap) => {
        return { unlocked: visited.length >= 3, progress: `${Math.min(visited.length, 3)}/3` };
      }
    },
    {
      id: "cheap_hunter",
      name: "Łowca Taniochy",
      icon: "💰",
      desc: "Odwiedź co najmniej 3 bary z piwem do 11 zł",
      check: (visited, vMap) => {
        const c = visited.filter(id => vMap[id] && typeof vMap[id].beer_price_pln === "number" && vMap[id].beer_price_pln <= 11.0).length;
        return { unlocked: c >= 3, progress: `${Math.min(c, 3)}/3` };
      }
    },
    {
      id: "happy_hour_hunter",
      name: "Łowca Okazji",
      icon: "⚡",
      desc: "Odwiedź bar oferujący zniżki Happy Hour",
      check: (visited, vMap) => {
        const c = visited.filter(id => vMap[id] && (vMap[id].happy_hour || vMap[id].happy_hour_rule)).length;
        return { unlocked: c >= 1, progress: `${Math.min(c, 1)}/1` };
      }
    },
    {
      id: "warsaw_king",
      name: "Król Warszawskiej Nocy",
      icon: "👑",
      desc: "Odwiedź łącznie co najmniej 20 lokali w Warszawie",
      check: (visited, vMap) => {
        return { unlocked: visited.length >= 20, progress: `${Math.min(visited.length, 20)}/20` };
      }
    },
    {
      id: "pubquiz_master",
      name: "Mistrz Pub Quizu",
      icon: "🧠",
      desc: "Zdobądź komplet 100% punktów w Warszawskim Pub Quizie (min. 5 pytań)",
      check: (visited, vMap) => {
        const won = localStorage.getItem("poilepiwko_pubquiz_won") === "true";
        return { unlocked: won, progress: won ? "100%" : "0%" };
      }
    }
  ];

  const PASSPORT_RANKS = [
    { min: 0, title: "Nowicjusz w Warszawie", icon: "🎓", sub: "Rozpocznij przygodę — zaznacz pierwszy odwiedzony bar!", nextMin: 1, nextTitle: "Bywalec Barowy" },
    { min: 1, title: "Bywalec Barowy", icon: "🍺", sub: "Znasz już dobre miejscówki w stolicy. Czas na więcej!", nextMin: 5, nextTitle: "Koneser Chmielu" },
    { min: 5, title: "Koneser Chmielu", icon: "🍻", sub: "Imponujący dorobek! Warszawa nie ma przed Tobą tajemnic.", nextMin: 10, nextTitle: "Mistrz Stolicy" },
    { min: 10, title: "Mistrz Stolicy", icon: "🌟", sub: "Jesteś prawdziwym ekspertem warszawskiej gastronomii!", nextMin: 20, nextTitle: "Legenda Warszawskiej Nocy" },
    { min: 20, title: "Legenda Warszawskiej Nocy", icon: "👑", sub: "Absolutny mistrz! Twoja wiedza o barach przeszła do historii.", nextMin: null, nextTitle: null }
  ];

  function getPassportRank(count) {
    let activeRank = PASSPORT_RANKS[0];
    for (const r of PASSPORT_RANKS) {
      if (count >= r.min) activeRank = r;
    }
    return activeRank;
  }

  let appToastTimer = null;
  function showAppToast(title, desc, icon = "🍺", duration = 3200) {
    const toast = document.getElementById("passport-toast");
    const iconEl = document.getElementById("toast-icon");
    const titleEl = document.getElementById("toast-title");
    const descEl = document.getElementById("toast-desc");
    if (!toast) return;

    if (iconEl) iconEl.textContent = icon;
    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = desc;

    toast.style.display = "flex";

    if (appToastTimer) clearTimeout(appToastTimer);
    appToastTimer = setTimeout(() => {
      toast.style.display = "none";
    }, duration);
  }

  function showPassportToast(badge) {
    showAppToast("Odblokowano nową odznakę!", `${badge.name} (${badge.desc})`, badge.icon || "🎉", 4200);
  }

  function updatePassportCounters() {
    const count = visitedVenues.length;
    const total = (allVenues && allVenues.length) || 349;
    const headerCount = document.getElementById("passport-header-count");
    if (headerCount) headerCount.textContent = `${count}/${total}`;

    const drawerCount = document.getElementById("drawer-visited-count");
    if (drawerCount) drawerCount.textContent = count;
  }

  function renderPassportModal() {
    const vMap = {};
    allVenues.forEach(v => { vMap[v.id] = v; });

    const count = visitedVenues.length;
    const total = (allVenues && allVenues.length) || 349;
    const pct = ((count / total) * 100).toFixed(1);

    const districts = new Set(visitedVenues.map(id => vMap[id] && vMap[id].district).filter(Boolean));

    // Badges
    const badgeEvaluations = PASSPORT_BADGES.map(b => ({
      ...b,
      res: b.check(visitedVenues, vMap)
    }));
    const unlockedCount = badgeEvaluations.filter(b => b.res.unlocked).length;

    // Rank & Level Progress
    const currentRank = getPassportRank(count);
    const rankIconEl = document.getElementById("passport-rank-icon");
    const rankTitleEl = document.getElementById("passport-rank-title");
    const rankSubEl = document.getElementById("passport-rank-sub");
    const progressBar = document.getElementById("passport-progress-bar");
    const progressLabel = document.getElementById("passport-progress-label");

    if (rankIconEl) rankIconEl.textContent = currentRank.icon;
    if (rankTitleEl) rankTitleEl.textContent = currentRank.title;
    if (rankSubEl) rankSubEl.textContent = currentRank.sub;

    if (progressBar && progressLabel) {
      if (currentRank.nextMin !== null) {
        const range = currentRank.nextMin - currentRank.min;
        const progressInLevel = count - currentRank.min;
        const pctLevel = Math.min(100, Math.round((progressInLevel / range) * 100));
        progressBar.style.width = `${pctLevel}%`;
        progressLabel.textContent = `${count} / ${currentRank.nextMin} do rangi: ${currentRank.nextTitle}`;
      } else {
        progressBar.style.width = "100%";
        progressLabel.textContent = "Maksymalna ranga osiągnięta! 👑";
      }
    }

    // KPIs
    const statVisited = document.getElementById("stat-visited-count");
    const statPct = document.getElementById("stat-visited-percent");
    const statDist = document.getElementById("stat-visited-districts");
    const statBadges = document.getElementById("stat-badges-unlocked");
    const listCount = document.getElementById("passport-list-count");

    if (statVisited) statVisited.textContent = count;
    if (statPct) statPct.textContent = `${pct}%`;
    if (statDist) statDist.textContent = `${districts.size} / 18`;
    if (statBadges) statBadges.textContent = `${unlockedCount} / ${PASSPORT_BADGES.length}`;
    if (listCount) listCount.textContent = count;

    // Badges Showcase Grid
    const badgesGrid = document.getElementById("passport-badges-grid");
    if (badgesGrid) {
      badgesGrid.innerHTML = badgeEvaluations.map(b => `
        <div class="passport-badge-card ${b.res.unlocked ? 'unlocked' : 'locked'}" title="${b.res.unlocked ? 'Zdobyta!' : `Postęp: ${b.res.progress}`}">
          <div class="badge-card-icon">${b.icon}</div>
          <div class="badge-card-name">${escapeHtml(b.name)}</div>
          <div class="badge-card-desc">${escapeHtml(b.desc)}</div>
          <div class="badge-card-status">
            ${b.res.unlocked ? '✓ Odblokowana' : `🔒 ${b.res.progress}`}
          </div>
        </div>
      `).join("");
    }

    // Visited Venues List
    const venuesList = document.getElementById("passport-venues-list");
    if (venuesList) {
      if (count === 0) {
        venuesList.innerHTML = `
          <div style="text-align:center;color:var(--text-muted);padding:18px;font-size:0.8rem;">
            Nie masz jeszcze zapisanych barów. Kliknij na mapie dowolny lokal i wciśnij „Byłem tu!”.
          </div>
        `;
      } else {
        const visitedObjs = visitedVenues
          .map(id => vMap[id])
          .filter(Boolean);

        venuesList.innerHTML = visitedObjs.map(v => `
          <div class="passport-venue-row">
            <div>
              <span class="passport-venue-title" onclick="window.__zoomToVenue('${v.id}')" title="Pokaż na mapie">
                ${escapeHtml(v.name)}
              </span>
              <span style="font-size:0.72rem;color:var(--text-muted);margin-left:6px;">
                (${escapeHtml(v.district)} · ${v.beer_price_pln ? v.beer_price_pln.toFixed(2) + ' zł' : ''})
              </span>
            </div>
            <button type="button" class="btn-remove-visited" onclick="window.__toggleVisited('${v.id}')" title="Usuń z odwiedzonych">
              ✕
            </button>
          </div>
        `).join("");
      }
    }

    updatePassportCounters();
  }

  function toggleVisitedVenue(venueId) {
    const idx = visitedVenues.indexOf(venueId);
    let isNowVisited = false;
    if (idx >= 0) {
      visitedVenues.splice(idx, 1);
      isNowVisited = false;
    } else {
      visitedVenues.push(venueId);
      isNowVisited = true;
    }
    saveVisitedVenues(visitedVenues);

    // Check newly unlocked badges
    const vMap = {};
    allVenues.forEach(v => { vMap[v.id] = v; });
    const previouslyUnlocked = loadUnlockedBadges();
    const currentlyUnlocked = [];

    PASSPORT_BADGES.forEach(badge => {
      const evaluation = badge.check(visitedVenues, vMap);
      if (evaluation.unlocked) {
        currentlyUnlocked.push(badge.id);
        if (!previouslyUnlocked.includes(badge.id)) {
          // Newly unlocked badge! Trigger celebration toast
          showPassportToast(badge);
        }
      }
    });

    saveUnlockedBadges(currentlyUnlocked);
    updatePassportCounters();
    return isNowVisited;
  }

  window.__toggleVisited = function (venueId) {
    const venue = allVenues.find(v => v.id === venueId);
    if (!venue) return;
    const isNowVisited = toggleVisitedVenue(venueId);

    // Update marker icon directly without losing popup state
    const targetMarker = activeMarkers.find(m => {
      const ll = m.getLatLng();
      return Math.abs(ll.lat - venue.latitude) < 0.0001 && Math.abs(ll.lng - venue.longitude) < 0.0001;
    });
    if (targetMarker) {
      targetMarker.setIcon(createMarkerIcon(venue));
    }

    // Update button in popup if currently open
    const popupBtn = document.querySelector(`.leaflet-popup .btn-toggle-visited`);
    if (popupBtn) {
      if (isNowVisited) {
        popupBtn.classList.add("visited");
        popupBtn.innerHTML = "✓ Byłem tu! (Zaznaczone w Paszporcie)";
      } else {
        popupBtn.classList.remove("visited");
        popupBtn.innerHTML = "🎖️ Zaznacz: Byłem tu!";
      }
    }

    // Refresh ranking list if visited tab active
    if (rankingMode === "visited") {
      renderRankingList(getFilteredVenues());
    }

    // Refresh passport modal if open
    const passportModal = document.getElementById("passport-modal");
    if (passportModal && passportModal.classList.contains("active")) {
      renderPassportModal();
    }

    // Cloud Check-in & Sync if authenticated
    if (currentUser) {
      if (isNowVisited) {
        // Send 100% anonymous price confirmation to the community pulse without tying to user identity
        fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "record-checkin",
            payload: {
              venueId: venue.id,
              venueName: venue.name,
              district: venue.district,
              beerName: venue.beer_name,
              beerPrice: venue.beer_price_pln
            }
          })
        }).catch(err => console.warn("Price pulse note:", err));
      }
      syncUserDataToCloud();
    }
  };

  // Toggle Favorite Venue (stored in localStorage)
  window.__toggleFavorite = function (venueId) {
    const venue = allVenues.find(v => v.id === venueId);
    const idx = favoriteVenues.indexOf(venueId);
    let isNowFav = false;
    if (idx > -1) {
      favoriteVenues.splice(idx, 1);
      isNowFav = false;
    } else {
      favoriteVenues.push(venueId);
      isNowFav = true;
    }
    saveFavoriteVenues(favoriteVenues);
    updateFavoriteCounters();

    // Cloud Favorites Sync if authenticated
    if (currentUser) {
      syncUserDataToCloud();
    }

    // Update button in popup if currently open
    const btn = document.querySelector(`.btn-fav-toggle[data-id="${venueId}"]`);
    if (btn) {
      if (isNowFav) {
        btn.classList.add("active");
        btn.innerHTML = `<span>❤️ W ulubionych</span>`;
        btn.title = "Usuń z ulubionych";
      } else {
        btn.classList.remove("active");
        btn.innerHTML = `<span>🤍 Do ulubionych</span>`;
        btn.title = "Dodaj do ulubionych";
      }
    }

    const vName = venue ? venue.name : "Lokal";
    if (isNowFav) {
      showAppToast("Dodano do ulubionych!", vName, "❤️");
    } else {
      showAppToast("Usunięto z ulubionych", vName, "🤍");
    }

    if (currentFilter === "favorites") {
      renderMarkers();
    }
    if (rankingMode === "favorites") {
      renderRankingList(getFilteredVenues());
    }
  };

  // Share Venue Handler (Native Web Share API with Clipboard Fallback)
  window.__shareVenue = function (venueId) {
    const venue = allVenues.find(v => v.id === venueId);
    if (!venue) return;

    const hashPart = venue.slug || venue.id;
    const shareUrl = `${window.location.origin}${window.location.pathname}#${hashPart}`;
    const priceTxt = venue.beer_price_pln ? `${venue.beer_price_pln.toFixed(2)} zł` : "tanie piwo";
    const shareTitle = `${venue.name} (${priceTxt}) · Po ile piwko?`;
    const shareText = `Zobacz cenę piwa w ${venue.name} (${venue.address}) na poilepiwko.pl:`;

    if (navigator.share) {
      navigator.share({
        title: shareTitle,
        text: shareText,
        url: shareUrl
      }).catch(err => {
        if (err.name !== "AbortError") {
          copyShareLink(shareUrl, venue.name);
        }
      });
    } else {
      copyShareLink(shareUrl, venue.name);
    }
  };

  function copyShareLink(url, venueName) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        showAppToast("Skopiowano link do lokalu!", venueName || "Możesz wkleić znajomym", "📤");
      }).catch(() => {
        fallbackCopyText(url, venueName);
      });
    } else {
      fallbackCopyText(url, venueName);
    }
  }

  function fallbackCopyText(text, venueName) {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showAppToast("Skopiowano link do lokalu!", venueName || "Możesz wkleić znajomym", "📤");
    } catch (e) {
      prompt("Skopiuj link do lokalu:", text);
    }
  }

  function checkUrlHash() {
    const raw = decodeURIComponent(window.location.hash.replace(/^#/, "").trim());
    if (!raw) return;
    const lower = raw.toLowerCase();

    // Secret Admin / Moderator hash access
    if (lower === "admin" || lower === "moderator" || lower === "panel") {
      try {
        history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch (e) {}
      window.location.href = "/admin.html";
      return;
    }

    // Direct hash to open Regulamin & Terms
    if (lower === "regulamin" || lower === "terms" || lower === "zasady") {
      if (typeof window.__openLegalModal === "function") {
        window.__openLegalModal();
      }
      return;
    }

    // Direct hash to open Virtual Club Pass
    if (lower === "pass" || lower === "karta" || lower === "klub") {
      if (typeof window.__openClubCard === "function") {
        window.__openClubCard();
      }
      return;
    }

    if (raw.startsWith("@")) {
      const username = raw.slice(1).trim();
      if (username && window.__openUserProfile) {
        window.__openUserProfile(username);
      }
      return;
    }
    const target = allVenues.find(v => 
      (v.slug && v.slug.toLowerCase() === lower) || 
      (v.id && v.id.toLowerCase() === lower)
    );
    if (target) {
      window.__zoomToVenue(target.id);
    }
  }

  function initPassport() {
    const passportModal = document.getElementById("passport-modal");
    const btnOpenHeader = document.getElementById("btn-open-passport");
    const btnClose = document.getElementById("btn-close-passport");
    const btnShare = document.getElementById("btn-share-passport");
    const btnReset = document.getElementById("btn-reset-passport");

    function openModal() {
      if (!passportModal) return;
      const drawer = document.getElementById("ranking-drawer");
      if (drawer) drawer.classList.remove("open");
      const baroModal = document.getElementById("barometer-modal");
      if (baroModal) baroModal.classList.remove("active");
      const crawlModal = document.getElementById("pubcrawl-modal");
      if (crawlModal) crawlModal.classList.remove("active");
      const hhModal = document.getElementById("happyhour-modal");
      if (hhModal) hhModal.classList.remove("active");

      renderPassportModal();
      passportModal.classList.add("active");
    }

    function closeModal() {
      if (passportModal) passportModal.classList.remove("active");
    }

    window.__openPassport = openModal;
    window.__closePassport = closeModal;

    if (btnOpenHeader) btnOpenHeader.addEventListener("click", openModal);
    if (btnClose) btnClose.addEventListener("click", closeModal);
    if (passportModal) {
      passportModal.addEventListener("click", (e) => {
        if (e.target === passportModal) closeModal();
      });
    }

    // Share Passport Profile
    if (btnShare) {
      btnShare.addEventListener("click", () => {
        const count = visitedVenues.length;
        const total = (allVenues && allVenues.length) || 349;
        const rank = getPassportRank(count);
        const vMap = {};
        allVenues.forEach(v => { vMap[v.id] = v; });
        const unlockedBadges = PASSPORT_BADGES.filter(b => b.check(visitedVenues, vMap).unlocked);
        const badgesIcons = unlockedBadges.map(b => b.icon).join(" ") || "Brak odznak";

        const text = `🎖️ Mój Piwny Paszport Warszawy (poilepiwko):\n👑 Ranga: ${rank.icon} ${rank.title}\n📍 Odwiedzone bary: ${count} / ${total}\n🏆 Odznaki (${unlockedBadges.length}/10): ${badgesIcons}\nSprawdź ceny piwa w Warszawie na https://poilepiwko.pl !`;

        if (navigator.share) {
          navigator.share({ title: "Piwny Paszport Warszawy - poilepiwko", text: text }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => {
            alert("📋 Podsumowanie Paszportu skopiowane do schowka! Możesz wysłać je znajomym.");
          });
        } else {
          prompt("Skopiuj tekst swojego profilu:", text);
        }
      });
    }

    // Reset Passport
    if (btnReset) {
      btnReset.addEventListener("click", () => {
        if (confirm("Czy na pewno chcesz zresetować swój Piwny Paszport? Usunie to wszystkie zaznaczone bary i odznaki.")) {
          visitedVenues = [];
          saveVisitedVenues([]);
          saveUnlockedBadges([]);
          renderPassportModal();
          renderMarkers();
          if (rankingMode === "visited") renderRankingList(getFilteredVenues());
          alert("Paszport został zresetowany.");
        }
      });
    }

    updatePassportCounters();
  }

  // Azimuth / Bearing Calculator (in degrees from North: 0° = N, 90° = E, 180° = S, 270° = W)
  function calculateBearing(lat1, lon1, lat2, lon2) {
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
    const theta = Math.atan2(y, x);
    return ((theta * 180) / Math.PI + 360) % 360;
  }

  // ==========================================================================
  // PIWNY KOMPAS / BEER RADAR (1-Click Live Bearing & Distance)
  // ==========================================================================
  function initBeerCompass() {
    const compassModal = document.getElementById("beer-compass-modal");
    const btnClose = document.getElementById("btn-close-compass");
    const statusText = document.getElementById("compass-status-text");
    const needleWrap = document.getElementById("compass-needle");
    const distVal = document.getElementById("compass-dist-val");
    const timeVal = document.getElementById("compass-time-val");
    const priceVal = document.getElementById("compass-price-val");
    const targetName = document.getElementById("compass-target-name");
    const targetDistrict = document.getElementById("compass-target-district");
    const targetBeer = document.getElementById("compass-target-beer");
    const targetAddress = document.getElementById("compass-target-address");
    const targetIndexLabel = document.getElementById("compass-target-index");
    const btnPrev = document.getElementById("btn-compass-prev");
    const btnNext = document.getElementById("btn-compass-next");
    const btnNavigate = document.getElementById("btn-compass-navigate");
    const btnZoom = document.getElementById("btn-compass-zoom");
    const btnStamp = document.getElementById("btn-compass-stamp");
    const tipBar = document.getElementById("compass-tip-bar");
    const filterPills = document.querySelectorAll("#compass-vibe-pills .compass-pill");

    const btnCompassHeader = document.getElementById("btn-compass-header");
    const chipOpenCompass = document.getElementById("chip-open-compass");
    const btnCompassFloat = document.getElementById("btn-compass-float");
    const navBtnCompass = document.getElementById("nav-btn-compass");
    const navBtnHeroCompass = document.getElementById("nav-btn-hero-compass");

    let currentCompassFilter = "cheapest"; // "cheapest" | "nearest" | "craft" | "open"
    let currentCompassTargets = [];
    let currentCompassIndex = 0;
    let compassWatchId = null;
    let deviceHeading = null;
    let orientationHandlerAttached = false;

    function getOriginCoords() {
      if (userLocation && Array.isArray(userLocation) && userLocation.length === 2) {
        return userLocation;
      }
      return WARSAW_CENTER;
    }

    function updateTargets() {
      if (!allVenues || allVenues.length === 0) {
        currentCompassTargets = [];
        return;
      }

      const origin = getOriginCoords();
      const candidates = allVenues.map(v => {
        const distKm = calculateDistanceKm(origin[0], origin[1], v.latitude, v.longitude);
        const distMeters = Math.round(distKm * 1000);
        const bearing = calculateBearing(origin[0], origin[1], v.latitude, v.longitude);
        return {
          venue: v,
          distKm,
          distMeters,
          bearing
        };
      });

      if (currentCompassFilter === "cheapest") {
        let cheapList = candidates.filter(item => item.venue.beer_price_pln <= 12.0);
        if (cheapList.length === 0) {
          cheapList = candidates.filter(item => item.venue.beer_price_pln <= 14.0);
        }
        if (cheapList.length === 0) {
          cheapList = candidates.slice().sort((a, b) => a.venue.beer_price_pln - b.venue.beer_price_pln).slice(0, 10);
        }
        // Sort by lowest price first, then nearest distance
        cheapList.sort((a, b) => (a.venue.beer_price_pln - b.venue.beer_price_pln) || (a.distMeters - b.distMeters));
        currentCompassTargets = cheapList.slice(0, 5);
      } else if (currentCompassFilter === "nearest") {
        candidates.sort((a, b) => (a.distMeters - b.distMeters) || (a.venue.beer_price_pln - b.venue.beer_price_pln));
        currentCompassTargets = candidates.slice(0, 5);
      } else if (currentCompassFilter === "craft") {
        let craftList = candidates.filter(item => item.venue.is_craft === true);
        if (craftList.length === 0) craftList = candidates;
        craftList.sort((a, b) => (a.distMeters - b.distMeters) || (a.venue.beer_price_pln - b.venue.beer_price_pln));
        currentCompassTargets = craftList.slice(0, 5);
      } else if (currentCompassFilter === "open") {
        let openList = candidates.filter(item => isVenueOpen(item.venue));
        if (openList.length === 0) openList = candidates;
        openList.sort((a, b) => (a.distMeters - b.distMeters) || (a.venue.beer_price_pln - b.venue.beer_price_pln));
        currentCompassTargets = openList.slice(0, 5);
      }

      if (currentCompassIndex >= currentCompassTargets.length) {
        currentCompassIndex = 0;
      }
    }

    function updateNeedle() {
      if (!needleWrap) return;
      if (!currentCompassTargets || currentCompassTargets.length === 0) {
        needleWrap.style.transform = "rotate(0deg)";
        return;
      }
      const target = currentCompassTargets[currentCompassIndex];
      if (!target) return;

      let rotation = target.bearing;
      if (deviceHeading !== null && !isNaN(deviceHeading)) {
        // Point arrow towards venue relative to current phone orientation
        rotation = (target.bearing - deviceHeading + 360) % 360;
      }
      needleWrap.style.transform = `rotate(${rotation.toFixed(1)}deg)`;
    }

    function renderCurrentTarget() {
      if (!currentCompassTargets || currentCompassTargets.length === 0) {
        if (distVal) distVal.textContent = "--";
        if (timeVal) timeVal.textContent = "--";
        if (priceVal) priceVal.textContent = "--";
        if (targetName) targetName.textContent = "Brak lokali";
        if (targetDistrict) targetDistrict.textContent = "Warszawa";
        if (targetBeer) targetBeer.textContent = "Brak pasujących piw";
        if (targetAddress) targetAddress.textContent = "Spróbuj zmienić filtr radaru";
        if (targetIndexLabel) targetIndexLabel.textContent = "0 z 0";
        if (btnNavigate) btnNavigate.removeAttribute("href");
        return;
      }

      const item = currentCompassTargets[currentCompassIndex];
      const v = item.venue;

      // Distance
      if (distVal) {
        if (item.distMeters < 1000) {
          distVal.textContent = `${item.distMeters} m`;
        } else {
          distVal.textContent = `${(item.distMeters / 1000).toFixed(1)} km`;
        }
      }

      // Walking time (80 m/min average speed)
      if (timeVal) {
        const minutes = Math.max(1, Math.round(item.distMeters / 80));
        timeVal.textContent = `${minutes} min`;
      }

      // Price
      if (priceVal) {
        priceVal.textContent = `${v.beer_price_pln.toFixed(2)} zł`;
      }

      // Text Info
      if (targetName) targetName.textContent = v.name;
      if (targetDistrict) targetDistrict.textContent = v.district || "Warszawa";
      if (targetBeer) {
        const beerName = v.beer_name || (v.is_craft ? "Piwo rzemieślnicze" : "Piwo z kranu");
        targetBeer.textContent = beerName;
      }
      if (targetAddress) targetAddress.textContent = v.address || "Warszawa";
      if (targetIndexLabel) {
        targetIndexLabel.textContent = `Bar ${currentCompassIndex + 1} z ${currentCompassTargets.length}`;
      }

      // Navigation Link
      if (btnNavigate) {
        btnNavigate.href = buildGoogleMapsNavigationUrl(v);
      }

      // Visited / Stamp button state
      if (btnStamp) {
        const visited = isVenueVisited(v.id);
        btnStamp.innerHTML = visited ? "<span>✓ Odwiedzone</span>" : "<span>🎖️ Byłem tu!</span>";
        btnStamp.classList.toggle("visited", visited);
      }

      // Update Needle
      updateNeedle();
    }

    function handleDeviceOrientation(event) {
      let heading = null;
      if (typeof event.webkitCompassHeading !== "undefined" && event.webkitCompassHeading !== null) {
        heading = event.webkitCompassHeading;
      } else if (typeof event.alpha !== "undefined" && event.alpha !== null) {
        heading = (360 - event.alpha) % 360;
      }

      if (heading !== null && !isNaN(heading)) {
        deviceHeading = heading;
        updateNeedle();

        if (statusText) {
          statusText.textContent = "Kompas skalibrowany • Radar aktywny";
        }
        if (tipBar) {
          tipBar.innerHTML = "🧭 <span>Obracaj telefonem – strzałka wskazuje kierunek marszu do lokalu.</span>";
        }
      }
    }

    function setupOrientationSensor() {
      if (orientationHandlerAttached) return;

      if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission()
          .then(res => {
            if (res === "granted") {
              window.addEventListener("deviceorientation", handleDeviceOrientation, true);
              orientationHandlerAttached = true;
            }
          })
          .catch(e => {
            console.warn("DeviceOrientation permission note:", e);
          });
      } else if ("ondeviceorientationabsolute" in window) {
        window.addEventListener("deviceorientationabsolute", handleDeviceOrientation, true);
        window.addEventListener("deviceorientation", handleDeviceOrientation, true);
        orientationHandlerAttached = true;
      } else if ("ondeviceorientation" in window) {
        window.addEventListener("deviceorientation", handleDeviceOrientation, true);
        orientationHandlerAttached = true;
      }
    }

    function startGpsTracking() {
      if (!navigator.geolocation) {
        if (!userLocation) setUserLocation(WARSAW_CENTER, true, true);
        if (statusText) statusText.textContent = "Pozycja domyślna: Centrum Warszawy";
        if (tipBar) tipBar.innerHTML = "💡 <span>Włącz GPS w telefonie, aby namierzać bary z dokładną odległością.</span>";
        updateTargets();
        renderCurrentTarget();
        return;
      }

      // Immediate location request
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation([pos.coords.latitude, pos.coords.longitude], false, false);
          if (statusText) {
            statusText.textContent = deviceHeading !== null ? "Kompas skalibrowany • Radar aktywny" : "GPS aktywny • Wskaźnik celu";
          }
          updateTargets();
          renderCurrentTarget();
        },
        (err) => {
          console.warn("Compass getCurrentPosition note:", err);
          if (!userLocation) setUserLocation(WARSAW_CENTER, true, true);
          if (statusText) statusText.textContent = "Pozycja domyślna: Centrum Warszawy";
          if (tipBar) tipBar.innerHTML = "💡 <span>Włącz lokalizację w przeglądarce, aby kompas wskazywał bary od Ciebie.</span>";
          updateTargets();
          renderCurrentTarget();
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 4000 }
      );

      // Continuous watch while compass modal is open
      if (!compassWatchId) {
        compassWatchId = navigator.geolocation.watchPosition(
          (pos) => {
            setUserLocation([pos.coords.latitude, pos.coords.longitude], false, false);
            updateTargets();
            renderCurrentTarget();
          },
          (err) => {
            console.warn("Compass watchPosition note:", err);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        );
      }
    }

    function stopGpsTracking() {
      if (compassWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(compassWatchId);
        compassWatchId = null;
      }
    }

    function openCompass() {
      if (!compassModal) return;

      const drawer = document.getElementById("ranking-drawer");
      if (drawer) drawer.classList.remove("open");
      const baroModal = document.getElementById("barometer-modal");
      if (baroModal) baroModal.classList.remove("active");
      const crawlModal = document.getElementById("pubcrawl-modal");
      if (crawlModal) crawlModal.classList.remove("active");
      const hhModal = document.getElementById("happyhour-modal");
      if (hhModal) hhModal.classList.remove("active");
      const passModal = document.getElementById("passport-modal");
      if (passModal) passModal.classList.remove("active");
      closeModal();
      if (window.__closeAuth) window.__closeAuth();

      compassModal.classList.add("active");
      compassModal.style.display = "flex";

      if (statusText) statusText.textContent = "Kalibrowanie radaru GPS...";
      if (tipBar) {
        tipBar.innerHTML = deviceHeading !== null
          ? "🧭 <span>Obracaj telefonem – strzałka wskazuje kierunek marszu do lokalu.</span>"
          : "💡 <span>Strzałka wskazuje azymut lokalu względem Północy (N na tarczy).</span>";
      }

      setupOrientationSensor();
      startGpsTracking();
      updateTargets();
      renderCurrentTarget();
    }

    function closeCompass() {
      if (!compassModal) return;
      compassModal.classList.remove("active");
      compassModal.style.display = "none";
      stopGpsTracking();
      if (window.__clearBottomNavActive) window.__clearBottomNavActive();
    }

    window.__openCompass = openCompass;
    window.__closeCompass = closeCompass;
    window.__refreshCompassTargets = function() {
      if (compassModal && compassModal.style.display === "flex") {
        updateTargets();
        renderCurrentTarget();
      }
    };

    if (btnClose) btnClose.addEventListener("click", closeCompass);
    if (compassModal) {
      compassModal.addEventListener("click", (e) => {
        if (e.target === compassModal) closeCompass();
      });
    }

    // Header, Chip & Float button listeners
    if (btnCompassHeader) {
      btnCompassHeader.addEventListener("click", openCompass);
    }
    if (chipOpenCompass) {
      chipOpenCompass.addEventListener("click", openCompass);
    }
    if (btnCompassFloat) {
      btnCompassFloat.addEventListener("click", openCompass);
    }
    if (navBtnCompass) {
      navBtnCompass.addEventListener("click", openCompass);
    }
    if (navBtnHeroCompass && navBtnHeroCompass !== navBtnCompass) {
      navBtnHeroCompass.addEventListener("click", openCompass);
    }

    // Filter Pills
    filterPills.forEach(pill => {
      pill.addEventListener("click", () => {
        filterPills.forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        currentCompassFilter = pill.getAttribute("data-compass-filter") || "cheapest";
        currentCompassIndex = 0;
        updateTargets();
        renderCurrentTarget();
      });
    });

    // Carousel Navigation
    if (btnPrev) {
      btnPrev.addEventListener("click", () => {
        if (currentCompassTargets.length > 0) {
          currentCompassIndex = (currentCompassIndex - 1 + currentCompassTargets.length) % currentCompassTargets.length;
          renderCurrentTarget();
        }
      });
    }
    if (btnNext) {
      btnNext.addEventListener("click", () => {
        if (currentCompassTargets.length > 0) {
          currentCompassIndex = (currentCompassIndex + 1) % currentCompassTargets.length;
          renderCurrentTarget();
        }
      });
    }

    // Zoom to Venue on Map
    if (btnZoom) {
      btnZoom.addEventListener("click", () => {
        if (currentCompassTargets.length > 0 && currentCompassTargets[currentCompassIndex]) {
          const v = currentCompassTargets[currentCompassIndex].venue;
          closeCompass();
          window.__zoomToVenue(v.id);
        }
      });
    }

    // Stamp / Visited action
    if (btnStamp) {
      btnStamp.addEventListener("click", () => {
        if (currentCompassTargets.length > 0 && currentCompassTargets[currentCompassIndex]) {
          const v = currentCompassTargets[currentCompassIndex].venue;
          if (window.__toggleVisited) {
            window.__toggleVisited(v.id);
            renderCurrentTarget();
          }
        }
      });
    }
  }

  // Setup UI Event Listeners
  function setupEventListeners() {
    setupThemeEventListeners();

    // Geolocation ("Blisko mnie")
    const btnLocate = document.getElementById("btn-locate-me");
    if (btnLocate) {
      btnLocate.addEventListener("click", () => {
        requestUserLocation({ flyTo: true, silent: false });
      });
    }

    // Search input
    const searchInput = document.getElementById("search-input");
    const clearBtn = document.getElementById("search-clear-btn");

    function onSearch(val) {
      searchQuery = val.trim();
      if (clearBtn) clearBtn.style.display = searchQuery ? "block" : "none";
      renderMarkers();
    }

    searchInput.addEventListener("input", (e) => onSearch(e.target.value));
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const filtered = getFilteredVenues();
        if (filtered.length > 0) {
          window.__zoomToVenue(filtered[0].id);
        }
      }
    });

    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        searchInput.value = "";
        onSearch("");
        searchInput.focus();
      });
    }

    // District Select Dropdown (flyTo and filter)
    const districtSelect = document.getElementById("district-select");
    if (districtSelect) {
      districtSelect.addEventListener("change", (e) => {
        currentDistrict = e.target.value;
        const target = DISTRICT_CENTERS[currentDistrict] || DISTRICT_CENTERS["all"];
        if (map && target) {
          map.flyTo(target.coords, target.zoom, { duration: 1.2 });
        }
        renderMarkers();
      });
    }

    // Filter Modal Setup
    const btnOpenFilterModal = document.getElementById("btn-open-filter-modal");
    const btnCloseFilterModal = document.getElementById("btn-close-filter");
    const filterModal = document.getElementById("filter-modal");
    const btnFilterReset = document.getElementById("btn-filter-reset");
    const btnFilterApply = document.getElementById("btn-filter-apply");

    if (btnOpenFilterModal) {
      btnOpenFilterModal.addEventListener("click", (e) => {
        e.preventDefault();
        openFilterModal();
      });
    }
    if (btnCloseFilterModal) {
      btnCloseFilterModal.addEventListener("click", closeFilterModal);
    }
    if (filterModal) {
      filterModal.addEventListener("click", (e) => {
        if (e.target === filterModal) closeFilterModal();
      });
    }
    if (btnFilterReset) {
      btnFilterReset.addEventListener("click", () => {
        resetAllFilters();
        if (typeof showAppToast === "function") {
          showAppToast("Zresetowano filtry", "Wyświetlam wszystkie lokale w Warszawie", "🎛️");
        }
      });
    }
    if (btnFilterApply) {
      btnFilterApply.addEventListener("click", () => {
        closeFilterModal();
        syncQuickChipsWithFilterState();
        renderMarkers();
        const count = getFilteredVenues().length;
        if (typeof showAppToast === "function") {
          showAppToast("Zastosowano filtry", `Znaleziono ${count} pasujących lokali`, "🍻");
        }
      });
    }

    // Modal: Price preset cards
    document.querySelectorAll(".filter-price-card").forEach(card => {
      card.addEventListener("click", () => {
        const tier = card.getAttribute("data-price");
        filterState.priceTier = tier;
        filterState.maxPrice = null;
        currentFilter = tier === "all" ? "all" : tier;
        syncFilterModalUI();
      });
    });

    // Modal: Price slider
    const priceSlider = document.getElementById("filter-price-slider");
    if (priceSlider) {
      priceSlider.addEventListener("input", (e) => {
        const val = parseInt(e.target.value, 10);
        if (val >= 35) {
          filterState.maxPrice = null;
        } else {
          filterState.maxPrice = val;
          filterState.priceTier = "custom";
        }
        syncFilterModalUI();
      });
    }

    // Modal: Toggle criteria
    document.querySelectorAll(".filter-toggle-btn").forEach(tBtn => {
      tBtn.addEventListener("click", () => {
        const prop = tBtn.getAttribute("data-toggle");
        if (prop && filterState.hasOwnProperty(prop)) {
          filterState[prop] = !filterState[prop];
          syncFilterModalUI();
        }
      });
    });

    // Modal: District chips
    document.querySelectorAll(".filter-dist-chip").forEach(dChip => {
      dChip.addEventListener("click", () => {
        currentDistrict = dChip.getAttribute("data-dist");
        if (districtSelect) districtSelect.value = currentDistrict;
        const target = DISTRICT_CENTERS[currentDistrict] || DISTRICT_CENTERS["all"];
        if (map && target) {
          map.flyTo(target.coords, target.zoom, { duration: 1.0 });
        }
        syncFilterModalUI();
      });
    });

    // Top Filter Bar Chips
    const quickFilterChips = document.querySelectorAll(".filter-chip[data-filter]");
    quickFilterChips.forEach(chip => {
      chip.addEventListener("click", () => {
        const filterVal = chip.getAttribute("data-filter");
        if (filterVal === "all") {
          resetAllFilters();
          return;
        }

        // Reset other toggles so single tap on chip is focused
        filterState.priceTier = "all";
        filterState.maxPrice = null;
        filterState.openNow = false;
        filterState.craftOnly = false;
        filterState.happyHourOnly = false;
        filterState.favoritesOnly = false;
        filterState.nonAlcoholicOnly = false;

        if (filterVal === "tier-low" || filterVal === "tier-mid" || filterVal === "tier-high") {
          filterState.priceTier = filterVal;
        } else if (filterVal === "open-now") {
          filterState.openNow = true;
        } else if (filterVal === "craft") {
          filterState.craftOnly = true;
        } else if (filterVal === "happy-hour") {
          filterState.happyHourOnly = true;
        } else if (filterVal === "favorites") {
          filterState.favoritesOnly = true;
        } else if (filterVal === "non-alcoholic") {
          filterState.nonAlcoholicOnly = true;
        }
        currentFilter = filterVal;
        syncQuickChipsWithFilterState();
        renderMarkers();
      });
    });

    // Ranking Drawer Toggle
    const btnRanking = document.getElementById("btn-ranking-toggle");
    const drawer = document.getElementById("ranking-drawer");
    const btnCloseDrawer = document.getElementById("btn-close-drawer");

    function openRankingDrawer() {
      if (!drawer) return;
      drawer.classList.add("open");
      document.body.classList.add("drawer-open");
    }

    function closeRankingDrawer() {
      if (!drawer) return;
      drawer.classList.remove("open");
      document.body.classList.remove("drawer-open");
      if (window.__clearBottomNavActive) window.__clearBottomNavActive();
    }

    window.__openRankingDrawer = openRankingDrawer;
    window.__closeRankingDrawer = closeRankingDrawer;

    if (btnRanking) {
      btnRanking.addEventListener("click", () => {
        if (drawer.classList.contains("open")) closeRankingDrawer();
        else openRankingDrawer();
      });
    }
    if (btnCloseDrawer) {
      btnCloseDrawer.addEventListener("click", closeRankingDrawer);
    }

    // Feature A: Ranking Tabs (Najtańsze vs Najbliżej vs Byłem vs Ulubione)
    const tabCheapest = document.getElementById("tab-rank-cheapest");
    const tabNearest = document.getElementById("tab-rank-nearest");
    const tabVisited = document.getElementById("tab-rank-visited");
    const tabFavorites = document.getElementById("tab-rank-favorites");
    if (tabCheapest && tabNearest) {
      tabCheapest.addEventListener("click", () => {
        rankingMode = "cheapest";
        tabCheapest.classList.add("active");
        tabNearest.classList.remove("active");
        if (tabVisited) tabVisited.classList.remove("active");
        if (tabFavorites) tabFavorites.classList.remove("active");
        renderRankingList(getFilteredVenues());
      });
      tabNearest.addEventListener("click", () => {
        rankingMode = "nearest";
        tabNearest.classList.add("active");
        tabCheapest.classList.remove("active");
        if (tabVisited) tabVisited.classList.remove("active");
        if (tabFavorites) tabFavorites.classList.remove("active");
        if (!userLocation) {
          const btnLocate = document.getElementById("btn-locate-me");
          if (btnLocate) btnLocate.click();
        }
        renderRankingList(getFilteredVenues());
      });
      if (tabVisited) {
        tabVisited.addEventListener("click", () => {
          rankingMode = "visited";
          tabVisited.classList.add("active");
          tabCheapest.classList.remove("active");
          tabNearest.classList.remove("active");
          if (tabFavorites) tabFavorites.classList.remove("active");
          renderRankingList(getFilteredVenues());
        });
      }
      if (tabFavorites) {
        tabFavorites.addEventListener("click", () => {
          rankingMode = "favorites";
          tabFavorites.classList.add("active");
          tabCheapest.classList.remove("active");
          tabNearest.classList.remove("active");
          if (tabVisited) tabVisited.classList.remove("active");
          renderRankingList(getFilteredVenues());
        });
      }
    }

    // Feature B: Barometer Modal Events
    const btnBarometer = document.getElementById("btn-barometer-toggle");
    const baroModal = document.getElementById("barometer-modal");
    const btnCloseBaro = document.getElementById("btn-close-barometer");

    if (btnBarometer && baroModal) {
      btnBarometer.addEventListener("click", () => {
        updateBarometerStats();
        baroModal.classList.add("active");
      });
    }
    if (btnCloseBaro && baroModal) {
      btnCloseBaro.addEventListener("click", () => {
        baroModal.classList.remove("active");
        if (window.__clearBottomNavActive) window.__clearBottomNavActive();
      });
    }
    if (baroModal) {
      baroModal.addEventListener("click", (e) => {
        if (e.target === baroModal) {
          baroModal.classList.remove("active");
          if (window.__clearBottomNavActive) window.__clearBottomNavActive();
        }
      });
    }

    // Feature C: Lightbox Modal Events
    const btnCloseLightbox = document.getElementById("btn-close-lightbox");
    const lightboxModal = document.getElementById("lightbox-modal");
    if (btnCloseLightbox) {
      btnCloseLightbox.addEventListener("click", window.__closeLightbox);
    }
    if (lightboxModal) {
      lightboxModal.addEventListener("click", (e) => {
        if (e.target === lightboxModal) window.__closeLightbox();
      });
    }

    // Close Modals on ESC Key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        window.__closeLightbox();
        if (baroModal) baroModal.classList.remove("active");
        if (window.__closePubCrawl) window.__closePubCrawl();
        if (window.__closeIosInstall) window.__closeIosInstall();
        if (window.__closeHappyHours) window.__closeHappyHours();
        if (window.__closePassport) window.__closePassport();
        if (window.__closeCompass) window.__closeCompass();
        if (window.__closeAuth) window.__closeAuth();
        if (window.__closeMyProfile) window.__closeMyProfile();
        if (window.__closeCommunity) window.__closeCommunity();
        if (window.__closePublicProfile) window.__closePublicProfile();
        const authModal = document.getElementById("auth-modal");
        if (authModal) { authModal.classList.remove("active"); authModal.style.display = "none"; }
        const profModal = document.getElementById("profile-modal");
        if (profModal) { profModal.classList.remove("active"); profModal.style.display = "none"; }
        const commModal = document.getElementById("community-modal");
        if (commModal) { commModal.classList.remove("active"); commModal.style.display = "none"; }
        const pubProfModal = document.getElementById("public-profile-modal");
        if (pubProfModal) { pubProfModal.classList.remove("active"); pubProfModal.style.display = "none"; }
      }
    });

    // Feature C: Photo Upload & Compression Handlers
    const photoInput = document.getElementById("report-photo-input");
    const photoPreviewBox = document.getElementById("photo-preview-box");
    const photoPreviewImg = document.getElementById("photo-preview-img");
    const photoUploadText = document.getElementById("photo-upload-text");
    const btnRemovePhoto = document.getElementById("btn-remove-photo");

    function resetPhotoUpload() {
      currentPhotoBase64 = null;
      if (photoInput) photoInput.value = "";
      if (photoPreviewImg) photoPreviewImg.src = "";
      if (photoPreviewBox) photoPreviewBox.style.display = "none";
      if (photoUploadText) photoUploadText.textContent = "Wybierz zdjęcie karty, tablicy lub paragonu";
    }

    if (photoInput) {
      photoInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        try {
          if (photoUploadText) photoUploadText.textContent = "Kompresowanie zdjęcia...";
          const compressed = await compressImage(file, 1200, 0.82);
          currentPhotoBase64 = compressed;
          currentPhotoContentType = file.type || "image/jpeg";

          if (photoPreviewImg) photoPreviewImg.src = compressed;
          if (photoPreviewBox) photoPreviewBox.style.display = "inline-block";
          if (photoUploadText) photoUploadText.textContent = file.name || "Zdjęcie wybrane ✓";
        } catch (err) {
          console.error("Błąd przetwarzania zdjęcia:", err);
          alert("Nie udało się skompresować wybranego pliku.");
          resetPhotoUpload();
        }
      });
    }

    if (btnRemovePhoto) {
      btnRemovePhoto.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        resetPhotoUpload();
      });
    }

    // Modal State ("add" for new bars, "rename" for replacing old bar, "edit" for changing existing bar's price/name)
    let currentModalMode = "add";
    let currentEditVenue = null;
    let currentRenameTarget = null;

    const btnOpenReport = document.getElementById("btn-open-report");
    const modal = document.getElementById("report-modal");
    const btnCloseModal = document.getElementById("btn-close-modal");
    const btnCancelModal = document.getElementById("btn-cancel-modal");
    const reportForm = document.getElementById("report-form");

    const reportModeToggle = document.getElementById("report-mode-toggle");
    const tabModeAdd = document.getElementById("tab-mode-add");
    const tabModeRename = document.getElementById("tab-mode-rename");
    const renameSelectorBox = document.getElementById("rename-selector-box");
    const renameSearchInput = document.getElementById("rename-search-input");
    const renameSuggestions = document.getElementById("rename-suggestions");
    const renameTargetId = document.getElementById("rename-target-id");
    const renameSelectedBadge = document.getElementById("rename-selected-badge");
    const renameSelectedName = document.getElementById("rename-selected-name");
    const renameSelectedAddr = document.getElementById("rename-selected-addr");
    const btnClearRenameSelection = document.getElementById("btn-clear-rename-selection");
    const renameEditToggleRow = document.getElementById("rename-edit-toggle-row");
    const checkUnlockRename = document.getElementById("check-unlock-rename");
    const renameEditTip = document.getElementById("rename-edit-tip");
    const reportNameLabel = document.getElementById("report-name-label");
    const addressMatchBox = document.getElementById("address-match-box");

    function setModalMode(mode, targetVenue = null) {
      currentModalMode = mode;
      const modalHeadTitle = document.getElementById("report-modal-title");
      const modalHeadDesc = document.getElementById("report-modal-desc");
      const nameInput = document.getElementById("report-name");
      const submitBtn = document.getElementById("report-submit-btn");

      if (mode === "add") {
        if (modalHeadTitle) modalHeadTitle.textContent = "➕ Dodaj Nowy Bar";
        if (modalHeadDesc) modalHeadDesc.textContent = "Znasz fajny bar, którego brakuje na mapie? Dodaj go, a natychmiast pojawi się w aplikacji:";
        if (reportNameLabel) reportNameLabel.textContent = "Nazwa lokalu / baru";
        if (submitBtn) submitBtn.innerHTML = "<span>➕</span><span>Dodaj bar na mapę</span>";

        if (tabModeAdd) tabModeAdd.classList.add("active");
        if (tabModeRename) tabModeRename.classList.remove("active");
        if (reportModeToggle) reportModeToggle.style.display = "flex";
        if (renameSelectorBox) renameSelectorBox.style.display = "none";
        if (renameEditToggleRow) renameEditToggleRow.style.display = "none";

        clearRenameTarget();

        if (nameInput) {
          nameInput.readOnly = false;
          nameInput.style.opacity = "1";
          nameInput.style.cursor = "text";
          nameInput.placeholder = "np. Bar Pacyfik, Browar Warszawski...";
        }
      } else if (mode === "rename") {
        if (modalHeadTitle) modalHeadTitle.textContent = "🔄 Zmień Nazwę Baru z Mapy";
        if (modalHeadDesc) modalHeadDesc.textContent = "Bar w bazie OSM ma nieaktualną nazwę lub działa pod nowym szyldem? Wybierz stary lokal i wprowadź nową nazwę:";
        if (reportNameLabel) reportNameLabel.textContent = "Nowa nazwa lokalu (aktualny szyld)";
        if (submitBtn) submitBtn.innerHTML = "<span>🔄</span><span>Zmień nazwę i zapisz bar</span>";

        if (tabModeAdd) tabModeAdd.classList.remove("active");
        if (tabModeRename) tabModeRename.classList.add("active");
        if (reportModeToggle) reportModeToggle.style.display = "flex";
        if (renameSelectorBox) renameSelectorBox.style.display = "block";
        if (renameEditToggleRow) renameEditToggleRow.style.display = "none";

        if (nameInput) {
          nameInput.readOnly = false;
          nameInput.style.opacity = "1";
          nameInput.style.cursor = "text";
          nameInput.placeholder = "Wpisz nową nazwę lokalu (np. Česká, Nowy Bar)...";
        }

        if (targetVenue) {
          selectRenameTarget(targetVenue);
        } else if (renameSearchInput) {
          setTimeout(() => renameSearchInput.focus(), 150);
        }
      } else if (mode === "edit") {
        if (reportModeToggle) reportModeToggle.style.display = "none";
        if (renameSelectorBox) renameSelectorBox.style.display = "none";
        if (renameEditToggleRow) renameEditToggleRow.style.display = "block";

        if (checkUnlockRename) {
          checkUnlockRename.checked = false;
        }
        if (renameEditTip) renameEditTip.style.display = "none";

        if (reportNameLabel) reportNameLabel.textContent = "Nazwa lokalu";
        if (submitBtn) submitBtn.innerHTML = "<span>💾</span><span>Zapisz nową cenę / dane</span>";

        if (nameInput) {
          nameInput.readOnly = true;
          nameInput.style.opacity = "0.75";
          nameInput.style.cursor = "not-allowed";
        }
      }
    }

    function selectRenameTarget(venue) {
      currentRenameTarget = venue;
      if (renameTargetId) renameTargetId.value = venue.id;
      if (renameSelectedName) renameSelectedName.textContent = venue.name;
      if (renameSelectedAddr) renameSelectedAddr.textContent = `(${venue.address || venue.district})`;
      if (renameSelectedBadge) renameSelectedBadge.style.display = "flex";
      if (renameSuggestions) renameSuggestions.style.display = "none";

      const distSelect = document.getElementById("report-district");
      if (distSelect && venue.district) distSelect.value = venue.district;

      const addrInput = document.getElementById("report-address");
      if (addrInput) addrInput.value = venue.address || "";

      const beerInput = document.getElementById("report-beer-name");
      if (beerInput) beerInput.value = venue.beer_name || "";

      const priceInput = document.getElementById("report-price");
      if (priceInput) priceInput.value = venue.beer_price_pln || "";

      const shotInput = document.getElementById("report-shot");
      if (shotInput) shotInput.value = venue.shot_price_pln || "";

      const craftSelect = document.getElementById("report-craft");
      if (craftSelect) craftSelect.value = venue.is_craft ? "true" : "false";

      const hhInput = document.getElementById("report-happy-hour");
      if (hhInput) hhInput.value = venue.happy_hour || "";

      const nameInput = document.getElementById("report-name");
      if (nameInput) {
        nameInput.value = "";
        nameInput.focus();
      }
    }

    function clearRenameTarget() {
      currentRenameTarget = null;
      if (renameTargetId) renameTargetId.value = "";
      if (renameSelectedBadge) renameSelectedBadge.style.display = "none";
      if (renameSuggestions) renameSuggestions.style.display = "none";
      if (renameSearchInput) renameSearchInput.value = "";
    }

    if (btnClearRenameSelection) {
      btnClearRenameSelection.addEventListener("click", () => {
        clearRenameTarget();
        if (renameSearchInput) renameSearchInput.focus();
      });
    }

    // Live search for old venue to rename
    if (renameSearchInput) {
      renameSearchInput.addEventListener("input", (e) => {
        const q = e.target.value.trim().toLowerCase();
        if (!q || q.length < 2) {
          if (renameSuggestions) renameSuggestions.style.display = "none";
          return;
        }

        const matches = allVenues.filter(v => 
          v.name.toLowerCase().includes(q) ||
          (v.address && v.address.toLowerCase().includes(q)) ||
          (v.old_name && v.old_name.toLowerCase().includes(q))
        ).slice(0, 7);

        if (matches.length === 0) {
          if (renameSuggestions) {
            renameSuggestions.innerHTML = `<div style="padding:10px;font-size:0.78rem;color:var(--text-muted);text-align:center;">Nie znaleziono lokalu o tej nazwie lub adresie.</div>`;
            renameSuggestions.style.display = "block";
          }
          return;
        }

        if (renameSuggestions) {
          renameSuggestions.innerHTML = matches.map(v => `
            <div class="rename-suggestion-item" data-id="${v.id}">
              <div>
                <span class="rename-item-name">${escapeHtml(v.name)}</span>
                ${v.old_name ? `<span style="font-size:0.72rem;color:var(--text-muted);">(d. ${escapeHtml(v.old_name)})</span>` : ''}
              </div>
              <span class="rename-item-sub">${escapeHtml(v.address || v.district)} · ${escapeHtml(v.district)}</span>
            </div>
          `).join("");
          renameSuggestions.style.display = "block";

          renameSuggestions.querySelectorAll(".rename-suggestion-item").forEach(item => {
            item.addEventListener("click", () => {
              const vid = item.getAttribute("data-id");
              const target = allVenues.find(v => v.id === vid);
              if (target) selectRenameTarget(target);
            });
          });
        }
      });
    }

    // Checkbox in edit mode to unlock name
    if (checkUnlockRename) {
      checkUnlockRename.addEventListener("change", (e) => {
        const nameInput = document.getElementById("report-name");
        const submitBtn = document.getElementById("report-submit-btn");
        if (e.target.checked) {
          if (nameInput) {
            nameInput.readOnly = false;
            nameInput.style.opacity = "1";
            nameInput.style.cursor = "text";
            nameInput.focus();
          }
          if (renameEditTip) renameEditTip.style.display = "block";
          if (submitBtn) submitBtn.innerHTML = "<span>💾</span><span>Zapisz nową nazwę i cenę</span>";
        } else {
          if (nameInput) {
            nameInput.readOnly = true;
            nameInput.style.opacity = "0.75";
            nameInput.style.cursor = "not-allowed";
            if (currentEditVenue) nameInput.value = currentEditVenue.name;
          }
          if (renameEditTip) renameEditTip.style.display = "none";
          if (submitBtn) submitBtn.innerHTML = "<span>💾</span><span>Zapisz nową cenę</span>";
        }
      });
    }

    // Tab buttons
    if (tabModeAdd) {
      tabModeAdd.addEventListener("click", () => setModalMode("add"));
    }
    if (tabModeRename) {
      tabModeRename.addEventListener("click", () => setModalMode("rename"));
    }

    // Address matcher in add mode to prevent duplicate bars
    const reportAddressInput = document.getElementById("report-address");
    if (reportAddressInput) {
      reportAddressInput.addEventListener("input", (e) => {
        if (currentModalMode !== "add") {
          if (addressMatchBox) addressMatchBox.innerHTML = "";
          return;
        }
        const val = e.target.value.trim().toLowerCase();
        if (val.length < 5) {
          if (addressMatchBox) addressMatchBox.innerHTML = "";
          return;
        }

        const match = allVenues.find(v => v.address && v.address.toLowerCase().includes(val));
        if (match && addressMatchBox) {
          addressMatchBox.innerHTML = `
            <div class="address-match-alert">
              <div>💡 Pod tym adresem na mapie znajduje się już lokal: <strong>${escapeHtml(match.name)}</strong></div>
              <button type="button" class="btn-match-rename" onclick="window.__switchToRename('${match.id}')">
                Zastąp ten bar
              </button>
            </div>
          `;
        } else if (addressMatchBox) {
          addressMatchBox.innerHTML = "";
        }
      });
    }

    window.__switchToRename = function(venueId) {
      const target = allVenues.find(v => v.id === venueId);
      if (target) {
        setModalMode("rename", target);
        if (addressMatchBox) addressMatchBox.innerHTML = "";
      }
    };

    function openAddModal() {
      currentEditVenue = null;
      if (reportForm) reportForm.reset();
      resetPhotoUpload();
      if (addressMatchBox) addressMatchBox.innerHTML = "";
      setModalMode("add");

      if (drawer) drawer.classList.remove("open");
      if (baroModal) baroModal.classList.remove("active");
      if (window.__closePubCrawl) window.__closePubCrawl();
      if (window.__closeHappyHours) window.__closeHappyHours();
      if (window.__closePassport) window.__closePassport();
      if (window.__closeIosInstall) window.__closeIosInstall();

      if (modal) {
        modal.classList.add("active");
        modal.style.display = "flex";
      }
      const nameInput = document.getElementById("report-name");
      if (nameInput) setTimeout(() => nameInput.focus(), 150);
    }

    function openEditModal(venueId) {
      const venue = allVenues.find(v => v.id === venueId);
      if (!venue) return;

      currentEditVenue = venue;
      if (reportForm) reportForm.reset();
      resetPhotoUpload();
      if (addressMatchBox) addressMatchBox.innerHTML = "";

      const modalHeadTitle = document.getElementById("report-modal-title");
      const modalHeadDesc = document.getElementById("report-modal-desc");
      const nameInput = document.getElementById("report-name");

      if (modalHeadTitle) modalHeadTitle.textContent = `✏️ Edycja lokalu: ${venue.name}`;
      if (modalHeadDesc) modalHeadDesc.textContent = `Zaktualizuj cenę, ofertę lub zgłoś nową nazwę baru w tym miejscu:`;

      setModalMode("edit");

      if (nameInput) {
        nameInput.value = venue.name;
      }

      const distSelect = document.getElementById("report-district");
      if (distSelect && venue.district) distSelect.value = venue.district;

      const addrInput = document.getElementById("report-address");
      if (addrInput) addrInput.value = venue.address || "";

      const beerInput = document.getElementById("report-beer-name");
      if (beerInput) beerInput.value = venue.beer_name || "Piwo z kranu";

      const priceInput = document.getElementById("report-price");
      if (priceInput) priceInput.value = venue.beer_price_pln || "";

      const shotInput = document.getElementById("report-shot");
      if (shotInput) shotInput.value = venue.shot_price_pln || "";

      const craftSelect = document.getElementById("report-craft");
      if (craftSelect) craftSelect.value = venue.is_craft ? "true" : "false";

      const hhInput = document.getElementById("report-happy-hour");
      if (hhInput) hhInput.value = venue.happy_hour || "";

      if (drawer) drawer.classList.remove("open");
      if (baroModal) baroModal.classList.remove("active");
      if (window.__closePubCrawl) window.__closePubCrawl();
      if (window.__closeHappyHours) window.__closeHappyHours();
      if (window.__closePassport) window.__closePassport();
      if (window.__closeIosInstall) window.__closeIosInstall();

      if (modal) {
        modal.classList.add("active");
        modal.style.display = "flex";
      }
      if (priceInput) setTimeout(() => priceInput.focus(), 150);
    }

    window.__editVenuePrice = openEditModal;
    window.__openAddModal = openAddModal;

    function closeModal() {
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none";
      }
      resetPhotoUpload();
      clearRenameTarget();
      if (addressMatchBox) addressMatchBox.innerHTML = "";
      currentModalMode = "add";
      currentEditVenue = null;
    }

    window.__closeAddModal = closeModal;

    if (btnOpenReport) btnOpenReport.addEventListener("click", openAddModal);
    const btnFabAdd = document.getElementById("btn-fab-add");
    if (btnFabAdd) btnFabAdd.addEventListener("click", openAddModal);

    if (btnCloseModal) btnCloseModal.addEventListener("click", closeModal);
    if (btnCancelModal) btnCancelModal.addEventListener("click", closeModal);
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });
    }

    // Handle Report Form Submit
    reportForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const name = document.getElementById("report-name").value.trim();
      const district = document.getElementById("report-district").value;
      const address = document.getElementById("report-address").value.trim() || district;
      const beerName = document.getElementById("report-beer-name").value.trim();
      const price = parseFloat(document.getElementById("report-price").value);
      const shotPrice = parseFloat(document.getElementById("report-shot").value) || null;
      const isCraft = document.getElementById("report-craft").value === "true";
      const happyHour = document.getElementById("report-happy-hour").value.trim() || null;

      // Check if user attached a photo proof
      let uploadedPhotoUrl = null;
      if (currentPhotoBase64) {
        const submitBtn = reportForm.querySelector('button[type="submit"]');
        const originalBtnHtml = submitBtn ? submitBtn.innerHTML : "";
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = "Wysyłanie zdjęcia...";
        }

        try {
          const uploadResp = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageBase64: currentPhotoBase64,
              contentType: currentPhotoContentType,
              fileName: name.toLowerCase().replace(/[^a-z0-9]/g, "-")
            })
          });

          if (uploadResp.ok) {
            const uploadResJson = await uploadResp.json();
            if (uploadResJson && uploadResJson.url) {
              uploadedPhotoUrl = uploadResJson.url;
            }
          } else {
            console.warn("Upload API non-OK, using local base64 fallback:", uploadResp.status);
            uploadedPhotoUrl = currentPhotoBase64;
          }
        } catch (uploadErr) {
          console.warn("Upload network error, fallback to base64:", uploadErr);
          uploadedPhotoUrl = currentPhotoBase64;
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
          }
        }
      }

      let existing = null;
      let isNameChange = false;
      let prevName = "";

      if (currentModalMode === "rename") {
        if (!currentRenameTarget) {
          alert("Wybierz stary lokal z listy powyżej, który chcesz zastąpić nową nazwą.");
          if (renameSearchInput) renameSearchInput.focus();
          return;
        }
        existing = currentRenameTarget;
        prevName = existing.name;
        isNameChange = true;
        if (!existing.old_name) {
          existing.old_name = prevName;
        }
        existing.name = name;
        existing.slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
        existing.district = district;
        existing.address = address;
        existing.beer_name = beerName;
        existing.beer_price_pln = price;
        if (shotPrice !== null) existing.shot_price_pln = shotPrice;
        existing.is_craft = isCraft;
        if (happyHour) existing.happy_hour = happyHour;
        if (uploadedPhotoUrl) existing.photo_url = uploadedPhotoUrl;
        existing.last_updated = new Date().toISOString().split("T")[0];
        existing.votes_confirm = (existing.votes_confirm || 1) + 1;
        saveLocalVenue(existing);
      } else if (currentModalMode === "edit" && currentEditVenue) {
        existing = currentEditVenue;
        if (name !== existing.name) {
          prevName = existing.name;
          isNameChange = true;
          if (!existing.old_name) {
            existing.old_name = prevName;
          }
          existing.name = name;
          existing.slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
        }
        existing.district = district;
        existing.address = address;
        existing.beer_name = beerName;
        existing.beer_price_pln = price;
        if (shotPrice !== null) existing.shot_price_pln = shotPrice;
        existing.is_craft = isCraft;
        if (happyHour) existing.happy_hour = happyHour;
        if (uploadedPhotoUrl) existing.photo_url = uploadedPhotoUrl;
        existing.last_updated = new Date().toISOString().split("T")[0];
        existing.votes_confirm = (existing.votes_confirm || 1) + 1;
        saveLocalVenue(existing);
      } else {
        // Mode "add"
        existing = allVenues.find(v => v.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          existing.beer_name = beerName;
          existing.beer_price_pln = price;
          if (shotPrice !== null) existing.shot_price_pln = shotPrice;
          if (happyHour) existing.happy_hour = happyHour;
          if (uploadedPhotoUrl) existing.photo_url = uploadedPhotoUrl;
          existing.last_updated = new Date().toISOString().split("T")[0];
          existing.votes_confirm = (existing.votes_confirm || 1) + 1;
          saveLocalVenue(existing);
        } else {
          // Determine accurate coordinates based on district and address
          const dTarget = DISTRICT_CENTERS[district] || DISTRICT_CENTERS["all"] || { coords: WARSAW_CENTER };
          let venueLat = dTarget.coords[0] + (Math.random() - 0.5) * 0.005;
          let venueLng = dTarget.coords[1] + (Math.random() - 0.5) * 0.005;

          if (address && address.trim()) {
            try {
              const cleanAddr = address.trim().replace(/^ul\.\s*/i, "");
              const q = encodeURIComponent(`${cleanAddr}, Warszawa`);
              const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`, {
                headers: { "Accept": "application/json" }
              });
              if (geoRes.ok) {
                const geoData = await geoRes.json();
                if (geoData && geoData.length > 0 && geoData[0].lat && geoData[0].lon) {
                  venueLat = parseFloat(geoData[0].lat);
                  venueLng = parseFloat(geoData[0].lon);
                }
              }
            } catch (geoErr) {
              console.warn("Geocoding lookup note:", geoErr);
            }
          }

          const newVenue = {
            id: "user-" + Date.now(),
            name,
            slug: name.toLowerCase().replace(/[^a-z0-9]/g, "-"),
            district,
            address,
            latitude: venueLat,
            longitude: venueLng,
            beer_name: beerName,
            beer_price_pln: price,
            beer_size_ml: 500,
            shot_price_pln: shotPrice,
            is_craft: isCraft,
            happy_hour: happyHour,
            photo_url: uploadedPhotoUrl,
            hours: "16:00 - 02:00",
            is_verified: false,
            last_updated: new Date().toISOString().split("T")[0],
            votes_confirm: 1
          };
          allVenues.unshift(newVenue);
          saveLocalVenue(newVenue);
          existing = newVenue;
        }
      }

      const reportPayload = {
        reported_beer_name: beerName,
        reported_price_pln: price,
        reported_shot_pln: shotPrice,
        happy_hour_info: isNameChange ? `Zmiana nazwy z "${prevName}" na "${name}". ${happyHour || ''}` : happyHour
      };
      if (uploadedPhotoUrl) {
        reportPayload.proof_image_url = uploadedPhotoUrl;
      }

      const venuePayload = {
        osm_id: existing.id,
        name: existing.name,
        slug: existing.slug,
        district: existing.district,
        address: existing.address,
        latitude: existing.latitude,
        longitude: existing.longitude,
        beer_name: existing.beer_name,
        beer_price_pln: existing.beer_price_pln,
        shot_price_pln: existing.shot_price_pln,
        is_craft: existing.is_craft,
        happy_hour: existing.happy_hour,
        hours: existing.hours,
        is_verified: existing.is_verified,
        votes_confirm: existing.votes_confirm,
        last_updated: new Date().toISOString()
      };

      // 1. Cloud sync via Vercel Serverless Function (Admin Service Role - always succeeds across all users)
      fetch("/api/update-venue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venuePayload, reportPayload })
      }).then(res => {
        if (res.ok) console.log("✓ Cloud sync via /api/update-venue succeeded!");
      }).catch(e => console.warn("API update-venue note:", e));

      // 2. Direct client-side Supabase sync
      if (supabaseClient) {
        supabaseClient
          .from("venues")
          .upsert(venuePayload)
          .then(({ error }) => {
            if (error) console.warn("Supabase upsert note:", error);
            else console.log("Venue updated in Supabase cloud!");
          });

        supabaseClient
          .from("price_reports")
          .insert(reportPayload)
          .then(({ error }) => {
            if (error) console.warn("Supabase report log note:", error);
          });
      }

      const isEditMode = currentModalMode === "edit";
      resetPhotoUpload();
      closeModal();
      reportForm.reset();
      updateBarometerStats();
      renderMarkers();

      // Pan to updated or new venue
      window.__zoomToVenue(existing.id);
      if (isNameChange) {
        alert(`Dziękujemy! Lokal "${prevName}" został pomyślnie zaktualizowany na nową nazwę "${name}" (dokładna pinezka na mapie została zachowana).`);
      } else if (isEditMode) {
        alert(`Dziękujemy! Cena piwa w lokalu "${existing.name}" została pomyślnie zaktualizowana na ${price.toFixed(2)} zł.`);
        } else {
          alert(`Dziękujemy! Nowy bar "${name}" został pomyślnie dodany na mapę (${price.toFixed(2)} zł).`);
        }
      } catch (submitErr) {
        console.error("Błąd podczas zapisywania lokalu:", submitErr);
        alert("Wystąpił nieoczekiwany problem podczas zapisywania: " + (submitErr.message || submitErr));
      }
    });

    // Live Clock for Header & Mobile Top Pill (Vad Kostar Ölen Style)
    function updateLiveClock() {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");

      const clockEl = document.getElementById("live-clock-time");
      if (clockEl) clockEl.textContent = `${hh}:${mm}`;

      const topClockEl = document.getElementById("top-time-clock");
      if (topClockEl) topClockEl.textContent = `${hh}:${mm}`;

      // Refresh Happy Hours modal countdowns if active
      const hhModal = document.getElementById("happyhour-modal");
      if (hhModal && hhModal.classList.contains("active")) {
        renderHappyHourModal();
      }
    }
    updateLiveClock();
    setInterval(updateLiveClock, 30000);

    // Floating Locate Button (Moja pozycja)
    const btnLocateFloat = document.getElementById("btn-locate-float");
    if (btnLocateFloat) {
      btnLocateFloat.addEventListener("click", () => {
        if (userLocation && map) {
          map.flyTo(userLocation, Math.max(map.getZoom(), 16), { duration: 0.8 });
          if (userMarker) {
            userMarker.openPopup();
          }
          showMapToast("📍 Wycentrowano na Twojej pozycji!");
          requestUserLocation({ flyTo: false, silent: true });
        } else {
          requestUserLocation({ flyTo: true, silent: false });
        }
      });
    }

    // Header "Więcej" Dropdown Toggle
    const headerMoreWrap = document.getElementById("header-more-wrap");
    const btnHeaderMore = document.getElementById("btn-header-more");
    if (headerMoreWrap && btnHeaderMore) {
      btnHeaderMore.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = headerMoreWrap.classList.toggle("open");
        btnHeaderMore.setAttribute("aria-expanded", isOpen ? "true" : "false");
      });
      document.addEventListener("click", (e) => {
        if (!headerMoreWrap.contains(e.target)) {
          headerMoreWrap.classList.remove("open");
          btnHeaderMore.setAttribute("aria-expanded", "false");
        }
      });
      headerMoreWrap.querySelectorAll(".more-menu-item").forEach(item => {
        item.addEventListener("click", () => {
          headerMoreWrap.classList.remove("open");
          btnHeaderMore.setAttribute("aria-expanded", "false");
        });
      });
    }

    // Toggle Mobile Search Overlay (Minimize / Expand)
    const btnToggleSearch = document.getElementById("btn-toggle-search");
    const mapOverlay = document.querySelector(".map-overlay");
    if (btnToggleSearch && mapOverlay) {
      btnToggleSearch.addEventListener("click", () => {
        mapOverlay.classList.toggle("collapsed-mobile");
      });
    }

    // Mobile Top Floating Controls & Search Sheet (Ultra-Clean Full-Bleed Map Experience)
    function initMobileControls() {
      // 1. Top Filter Modal Button
      const btnTopFilter = document.getElementById("btn-top-filter");
      if (btnTopFilter) {
        btnTopFilter.addEventListener("click", (e) => {
          e.preventDefault();
          openFilterModal();
        });
      }

      // 2. Top Brand Logo Pill (Center on Warsaw & show all)
      const btnTopBrand = document.getElementById("btn-top-brand");
      if (btnTopBrand) {
        btnTopBrand.addEventListener("click", () => {
          if (map) {
            map.flyTo(WARSAW_CENTER, 12.5, { duration: 1.2 });
          }
          if (typeof showAppToast === "function") {
            showAppToast("poilepiwko.pl", "Wyświetlam całą Warszawę 🍺", "🍺");
          }
        });
      }

      // 3. Mobile Search Sheet & Live Search
      const btnTopSearch = document.getElementById("btn-top-search");
      const mobileSearchSheet = document.getElementById("mobile-search-sheet");
      const mobileSearchInput = document.getElementById("mobile-search-input");
      const btnCloseMobileSearch = document.getElementById("btn-close-mobile-search");
      const mobileSearchResults = document.getElementById("mobile-search-results");
      const mobileDistChips = document.querySelectorAll("#mobile-search-districts .m-dist-chip");

      let mobileSelectedDistrict = "all";

      function openMobileSearchSheet() {
        if (!mobileSearchSheet) return;
        mobileSearchSheet.style.display = "flex";
        renderMobileSearchResults();
        if (mobileSearchInput) {
          setTimeout(() => {
            mobileSearchInput.focus();
            mobileSearchInput.select();
          }, 120);
        }
      }

      function closeMobileSearchSheet() {
        if (!mobileSearchSheet) return;
        mobileSearchSheet.style.display = "none";
        if (window.__clearBottomNavActive) window.__clearBottomNavActive();
      }

      window.__openMobileSearch = openMobileSearchSheet;
      window.__closeMobileSearch = closeMobileSearchSheet;

      if (btnTopSearch) {
        btnTopSearch.addEventListener("click", () => {
          if (mobileSearchSheet && mobileSearchSheet.style.display === "flex") {
            closeMobileSearchSheet();
          } else {
            openMobileSearchSheet();
          }
        });
      }

      if (btnCloseMobileSearch) {
        btnCloseMobileSearch.addEventListener("click", closeMobileSearchSheet);
      }

      // District filter chips inside search sheet
      mobileDistChips.forEach(chip => {
        chip.addEventListener("click", () => {
          mobileDistChips.forEach(c => c.classList.remove("active"));
          chip.classList.add("active");
          mobileSelectedDistrict = chip.getAttribute("data-dist") || "all";
          renderMobileSearchResults();
        });
      });

      function renderMobileSearchResults() {
        if (!mobileSearchResults) return;
        const q = (mobileSearchInput ? mobileSearchInput.value : "").trim().toLowerCase();

        let matches = allVenues.filter(venue => {
          // District check
          if (mobileSelectedDistrict !== "all") {
            const vDist = (venue.district || "").toLowerCase();
            const targetDist = mobileSelectedDistrict.toLowerCase();
            if (mobileSelectedDistrict === "Pawilony") {
              if (vDist !== "pawilony") return false;
            } else if (mobileSelectedDistrict === "Bulwary") {
              if (!vDist.includes("bulwary")) return false;
            } else {
              if (vDist !== targetDist && !vDist.includes(targetDist)) return false;
            }
          }

          // Search query check
          if (q) {
            const nameMatch = venue.name && venue.name.toLowerCase().includes(q);
            const oldNameMatch = venue.old_name && venue.old_name.toLowerCase().includes(q);
            const distMatch = venue.district && venue.district.toLowerCase().includes(q);
            const addrMatch = venue.address && venue.address.toLowerCase().includes(q);
            const beerMatch = venue.beer_name && venue.beer_name.toLowerCase().includes(q);
            if (!nameMatch && !oldNameMatch && !distMatch && !addrMatch && !beerMatch) {
              return false;
            }
          }

          return true;
        });

        // Sort: lowest price first
        matches.sort((a, b) => {
          const pA = a.beer_price_pln != null ? a.beer_price_pln : 999;
          const pB = b.beer_price_pln != null ? b.beer_price_pln : 999;
          return pA - pB;
        });

        const topMatches = matches.slice(0, 30);

        if (topMatches.length === 0) {
          mobileSearchResults.innerHTML = `
            <div style="text-align:center; padding: 24px 12px; color: #94a3b8; font-size: 0.85rem;">
              Brak lokali dla wybranego filtra. Spróbuj innej nazwy lub dzielnicy.
            </div>`;
          return;
        }

        mobileSearchResults.innerHTML = topMatches.map(v => {
          const priceDisplay = v.beer_price_pln != null ? `${v.beer_price_pln.toFixed(2)} zł` : "–";
          const subText = `${escapeHtml(v.address || v.district || '')}${v.beer_name ? ' · ' + escapeHtml(v.beer_name) : ''}`;
          return `
            <div class="m-search-item" data-id="${escapeHtml(v.id)}">
              <div class="m-search-item-info">
                <div class="m-search-name">${escapeHtml(v.name)}</div>
                <div class="m-search-sub">${subText}</div>
              </div>
              <div class="m-search-price">${priceDisplay}</div>
            </div>`;
        }).join("");

        mobileSearchResults.querySelectorAll(".m-search-item").forEach(item => {
          item.addEventListener("click", () => {
            const id = item.getAttribute("data-id");
            if (id && window.__zoomToVenue) {
              closeMobileSearchSheet();
              window.__zoomToVenue(id);
            }
          });
        });
      }

      if (mobileSearchInput) {
        mobileSearchInput.addEventListener("input", renderMobileSearchResults);
        mobileSearchInput.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const firstItem = mobileSearchResults.querySelector(".m-search-item");
            if (firstItem) {
              firstItem.click();
            }
          }
        });
      }

      // 4. Floating Add Bar Pill
      const btnFloatingAdd = document.getElementById("btn-floating-add");
      if (btnFloatingAdd) {
        btnFloatingAdd.addEventListener("click", (e) => {
          e.preventDefault();
          if (typeof openAddModal === "function") openAddModal();
          else if (window.__openAddModal) window.__openAddModal();
        });
      }
    }
    initMobileControls();

    // Mobile Bottom Navigation Bar Actions (Native App Dock)
    const bottomNavItems = document.querySelectorAll(".mobile-bottom-nav .nav-item");
    function clearBottomNavActive() {
      bottomNavItems.forEach(btn => btn.classList.remove("active"));
    }
    window.__clearBottomNavActive = clearBottomNavActive;

    bottomNavItems.forEach(item => {
      item.addEventListener("click", () => {
        const target = item.getAttribute("data-target");
        clearBottomNavActive();
        item.classList.add("active");

        if (target === "explore") {
          if (window.__closeRankingDrawer) window.__closeRankingDrawer();
          if (baroModal) baroModal.classList.remove("active");
          closeModal();
          if (window.__closePubCrawl) window.__closePubCrawl();
          if (window.__closeCompass) window.__closeCompass();
          if (window.__closeMobileSearch) window.__closeMobileSearch();
          if (window.__closeHappyHours) window.__closeHappyHours();
          if (window.__closeCommunity) window.__closeCommunity();
          if (window.__closeVkoModals) window.__closeVkoModals();
          if (window.__showExploreView) window.__showExploreView(true);
        } else if (target === "map") {
          if (window.__closeRankingDrawer) window.__closeRankingDrawer();
          if (baroModal) baroModal.classList.remove("active");
          closeModal();
          if (window.__closePubCrawl) window.__closePubCrawl();
          if (window.__closeCompass) window.__closeCompass();
          if (window.__closeMobileSearch) window.__closeMobileSearch();
          if (window.__closeHappyHours) window.__closeHappyHours();
          if (window.__closeCommunity) window.__closeCommunity();
          if (window.__closeVkoModals) window.__closeVkoModals();
          if (window.__showExploreView) window.__showExploreView(false);
          if (map) {
            map.invalidateSize();
            if (userLocation) {
              map.setView(userLocation, 15);
            }
          }
        } else if (target === "community" || target === "friends" || target === "spolecznosc") {
          if (window.__showExploreView) window.__showExploreView(false);
          if (window.__closeRankingDrawer) window.__closeRankingDrawer();
          if (baroModal) baroModal.classList.remove("active");
          closeModal();
          if (window.__closePubCrawl) window.__closePubCrawl();
          if (window.__closeCompass) window.__closeCompass();
          if (window.__closeMobileSearch) window.__closeMobileSearch();
          if (window.__closeHappyHours) window.__closeHappyHours();
          if (window.__closeVkoModals) window.__closeVkoModals();
          const commModal = document.getElementById("community-modal");
          const isCommOpen = commModal && (commModal.classList.contains("active") || commModal.style.display === "flex");
          if (isCommOpen) {
            if (window.__closeCommunity) window.__closeCommunity();
          } else if (window.__openCommunity) {
            window.__openCommunity(unreadNotificationsCount > 0 ? "notifications" : "friends");
          }
        } else if (target === "games" || target === "spel") {
          if (window.__showExploreView) window.__showExploreView(false);
          if (window.__closeRankingDrawer) window.__closeRankingDrawer();
          if (baroModal) baroModal.classList.remove("active");
          closeModal();
          if (window.__closePubCrawl) window.__closePubCrawl();
          if (window.__closeCompass) window.__closeCompass();
          if (window.__closeMobileSearch) window.__closeMobileSearch();
          if (window.__closeHappyHours) window.__closeHappyHours();
          if (window.__closeCommunity) window.__closeCommunity();
          if (window.__openVkoGames) window.__openVkoGames();
        } else if (target === "profile") {
          if (window.__showExploreView) window.__showExploreView(false);
          if (window.__closeRankingDrawer) window.__closeRankingDrawer();
          if (baroModal) baroModal.classList.remove("active");
          if (window.__closeHappyHours) window.__closeHappyHours();
          closeModal();
          if (window.__closePubCrawl) window.__closePubCrawl();
          if (window.__closeCompass) window.__closeCompass();
          if (window.__closeMobileSearch) window.__closeMobileSearch();
          if (window.__closeCommunity) window.__closeCommunity();
          if (window.__openVkoProfile) {
            window.__openVkoProfile();
          } else if (currentUser && currentProfile) {
            if (window.__openMyProfile) window.__openMyProfile();
          } else {
            const profModal = document.getElementById("profile-modal");
            if (profModal) {
              profModal.classList.add("active");
              profModal.style.display = "flex";
            }
          }
        } else if (target === "ranking") {
          if (window.__showExploreView) window.__showExploreView(false);
          if (baroModal) baroModal.classList.remove("active");
          if (window.__closeHappyHours) window.__closeHappyHours();
          closeModal();
          if (window.__closePubCrawl) window.__closePubCrawl();
          if (window.__closeCompass) window.__closeCompass();
          if (window.__closeMobileSearch) window.__closeMobileSearch();
          if (drawer) {
            if (drawer.classList.contains("open")) {
              if (window.__closeRankingDrawer) window.__closeRankingDrawer();
              item.classList.remove("active");
            } else {
              if (tabCheapest) tabCheapest.click();
              if (window.__openRankingDrawer) window.__openRankingDrawer();
            }
          }
        }
      });
    });

    // Age Gate Verification (18+ Polish Law Requirement)
    function initAgeGate() {
      const isVerified = localStorage.getItem("age_verified_18") === "true";
      const ageModal = document.getElementById("age-gate-modal");
      const btnAgeYes = document.getElementById("btn-age-yes");
      const btnAgeNo = document.getElementById("btn-age-no");
      const ageDeniedMsg = document.getElementById("age-denied-message");
      const ageActions = document.querySelector(".age-gate-actions");

      if (!isVerified && ageModal) {
        ageModal.classList.add("active");
      }

      if (btnAgeYes && ageModal) {
        btnAgeYes.addEventListener("click", () => {
          try {
            localStorage.setItem("age_verified_18", "true");
            localStorage.setItem("poilepiwko_terms_accepted", "true");
          } catch (e) {}
          ageModal.classList.remove("active");
        });
      }

      if (btnAgeNo && ageDeniedMsg && ageActions) {
        btnAgeNo.addEventListener("click", () => {
          ageActions.style.display = "none";
          ageDeniedMsg.style.display = "block";
        });
      }
    }
    initAgeGate();

    // Legal, Privacy & Responsible Drinking Modal
    function initLegalModal() {
      const legalModal = document.getElementById("legal-modal");
      const btnCloseLegal = document.getElementById("btn-close-legal");
      const btnAckLegal = document.getElementById("btn-ack-legal");

      function openLegal() {
        if (typeof window.__closeMyProfile === "function") {
          window.__closeMyProfile();
        }
        if (typeof window.__closeEditProfileModal === "function") {
          window.__closeEditProfileModal();
        }
        if (legalModal) {
          legalModal.classList.add("active");
          legalModal.style.display = "flex";
        }
      }
      function closeLegal() {
        if (legalModal) {
          legalModal.classList.remove("active");
          legalModal.style.display = "none";
        }
      }

      window.__openLegalModal = openLegal;
      window.__closeLegalModal = closeLegal;

      // Listen for clicks on any legal link/button across modals and views
      document.addEventListener("click", (e) => {
        const trigger = e.target.closest(".btn-open-legal-terms, #btn-open-legal, #btn-ranking-legal, #btn-profile-legal, [data-open-legal]");
        if (trigger) {
          e.preventDefault();
          if (typeof window.__closeMyProfile === "function") {
            window.__closeMyProfile();
          }
          openLegal();
        }
      });

      if (btnCloseLegal) btnCloseLegal.addEventListener("click", closeLegal);
      if (btnAckLegal) {
        btnAckLegal.addEventListener("click", () => {
          try {
            localStorage.setItem("poilepiwko_terms_accepted", "true");
          } catch (e) {}
          closeLegal();
          if (typeof showAppToast === "function") {
            showAppToast("Zasady zatwierdzone", "Dobrego piwkowania w Warszawie! 🍻", "📜");
          }
        });
      }
      if (legalModal) {
        legalModal.addEventListener("click", (e) => {
          if (e.target === legalModal) closeLegal();
        });
      }
    }
    initLegalModal();

    // Secret Creator & Moderator Panel Access Sequence (Easter Egg)
    function initSecretModeratorAccess() {
      let secretTapCount = 0;
      let secretTapTimer = null;

      function triggerModeratorAccess() {
        if (typeof showAppToast === "function") {
          showAppToast("Panel Moderatora 🛡️", "Wykryto tajną sekwencję! Otwieranie panelu...", "🔐", 1800);
        }
        setTimeout(() => {
          window.location.href = "/admin.html";
        }, 400);
      }

      function onSecretTap(e) {
        secretTapCount++;
        clearTimeout(secretTapTimer);
        secretTapTimer = setTimeout(() => {
          secretTapCount = 0;
        }, 2200);

        if (secretTapCount >= 5) {
          secretTapCount = 0;
          if (e && e.preventDefault) e.preventDefault();
          triggerModeratorAccess();
        }
      }

      // 1. Rapid 5-tap on Desktop Brand Logo (.logo-wrap)
      const logoDesktop = document.querySelector(".logo-wrap");
      if (logoDesktop) {
        logoDesktop.addEventListener("click", onSecretTap);
      }

      // 2. Rapid 5-tap on Mobile Floating Brand Pill (#btn-top-brand)
      const logoMobile = document.getElementById("btn-top-brand");
      if (logoMobile) {
        logoMobile.addEventListener("click", onSecretTap);
      }

      // 3. Rapid 5-tap on User Number in Profile (#prof-user-number)
      const profUserNum = document.getElementById("prof-user-number");
      if (profUserNum) {
        profUserNum.addEventListener("click", onSecretTap);
      }

      // 4. Secret Desktop Keyboard Shortcut: Ctrl+Shift+A or Cmd+Shift+A
      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "A" || e.key === "a")) {
          e.preventDefault();
          triggerModeratorAccess();
        }
      });
    }
    initSecretModeratorAccess();

    // PWA Installation (Android / Chrome & iOS Safari Guide)
    function initPwaInstall() {
      const banner = document.getElementById("pwa-install-banner");
      const bannerDesc = document.getElementById("pwa-banner-desc");
      const btnInstall = document.getElementById("btn-pwa-install");
      const btnDismiss = document.getElementById("btn-pwa-dismiss");
      const iosModal = document.getElementById("pwa-ios-modal");
      const btnCloseIos = document.getElementById("btn-close-pwa-ios");
      const btnAckIos = document.getElementById("btn-ack-pwa-ios");
      const btnDrawerPwa = document.getElementById("btn-drawer-pwa-install");
      const drawerPwaWrap = document.getElementById("drawer-pwa-wrap");

      let deferredInstallPrompt = null;
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

      // If running inside standalone installed app, hide install options
      if (isStandalone) {
        if (banner) banner.style.display = "none";
        if (drawerPwaWrap) drawerPwaWrap.style.display = "none";
        return;
      }

      function openIosModal() {
        if (iosModal) {
          const drawer = document.getElementById("ranking-drawer");
          if (drawer) drawer.classList.remove("open");

          const isAndroid = /android/i.test(navigator.userAgent);
          const modalTitle = document.querySelector("#pwa-ios-modal .modal-head h3");
          const stepsContainer = document.querySelector(".pwa-ios-steps");

          const pointerHint = document.querySelector(".pwa-ios-pointer-hint");

          if (isAndroid && stepsContainer) {
            if (modalTitle) modalTitle.textContent = "📲 Jak zainstalować na Androidzie";
            if (pointerHint) {
              pointerHint.innerHTML = `
                <div class="pwa-ios-arrow">↗</div>
                <span>Ikona menu <strong>trzech kropek (⋮)</strong> znajduje się w prawym górnym rogu Twojej przeglądarki</span>
              `;
            }
            stepsContainer.innerHTML = `
              <div class="pwa-step-item">
                <div class="pwa-step-badge">1</div>
                <div class="pwa-step-desc">
                  Stuknij ikonę menu <strong>trzech pionowych kropek (⋮)</strong> w prawym górnym rogu przeglądarki Chrome, Firefox lub Edge.
                </div>
              </div>
              <div class="pwa-step-item">
                <div class="pwa-step-badge">2</div>
                <div class="pwa-step-desc">
                  Wybierz z listy opcję:
                  <div class="pwa-safari-add-pill" style="margin-top:6px;">
                    <span class="pwa-plus-icon">📲</span>
                    <strong>Zainstaluj aplikację</strong> lub <strong>Dodaj do ekranu głównego</strong>
                  </div>
                </div>
              </div>
              <div class="pwa-step-item">
                <div class="pwa-step-badge">3</div>
                <div class="pwa-step-desc">
                  Kliknij <strong>Zainstaluj</strong>. Ikona <strong>poilepiwko</strong> pojawi się na Twoim pulpicie i uruchomi się na pełnym ekranie bez pasków przeglądarki!
                </div>
              </div>
            `;
          } else if (stepsContainer && !isAndroid) {
            if (modalTitle) modalTitle.textContent = "📲 Jak zainstalować na iPhone";
            if (pointerHint) {
              pointerHint.innerHTML = `
                <div class="pwa-ios-arrow">↓</div>
                <span>Przycisk <strong>Udostępnij</strong> (kwadrat ze strzałką) znajduje się na dolnym pasku Twojego iPhone'a</span>
              `;
            }
            stepsContainer.innerHTML = `
              <div class="pwa-step-item">
                <div class="pwa-step-badge">1</div>
                <div class="pwa-step-desc">
                  Na dolnym pasku przeglądarki <strong>Safari</strong> stuknij ikonę <strong>Udostępnij</strong>:
                  <div class="pwa-safari-share-pill">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                      <polyline points="16 6 12 2 8 6"></polyline>
                      <line x1="12" y1="2" x2="12" y2="15"></line>
                    </svg>
                    <span>Udostępnij (Kwadrat ze strzałką w górę)</span>
                  </div>
                </div>
              </div>
              <div class="pwa-step-item">
                <div class="pwa-step-badge">2</div>
                <div class="pwa-step-desc">
                  Przewiń menu w dół i wybierz opcję:
                  <div class="pwa-safari-add-pill">
                    <span class="pwa-plus-icon">➕</span>
                    <strong>Do ekranu początkowego (Add to Home Screen)</strong>
                  </div>
                </div>
              </div>
              <div class="pwa-step-item">
                <div class="pwa-step-badge">3</div>
                <div class="pwa-step-desc">
                  Stuknij <strong>Dodaj</strong> w prawym górnym rogu. Aplikacja <strong>poilepiwko</strong> pojawi się na pulpicie i uruchamia się na pełnym ekranie bez pasków Safari!
                </div>
              </div>
            `;
          }

          iosModal.style.display = "flex";
          iosModal.classList.add("active");
        }
      }

      function closeIosModal() {
        if (iosModal) {
          iosModal.classList.remove("active");
          iosModal.style.display = "none";
        }
      }

      window.__openIosInstall = openIosModal;
      window.__closeIosInstall = closeIosModal;

      if (btnCloseIos) btnCloseIos.addEventListener("click", closeIosModal);
      if (btnAckIos) btnAckIos.addEventListener("click", closeIosModal);
      if (iosModal) {
        iosModal.addEventListener("click", (e) => {
          if (e.target === iosModal) closeIosModal();
        });
      }

      // Check if dismissed recently (within 5 days)
      function isDismissedRecently() {
        try {
          const dismissedTime = localStorage.getItem("pwa_install_dismissed_time");
          if (!dismissedTime) return false;
          const diffDays = (Date.now() - parseInt(dismissedTime, 10)) / (1000 * 60 * 60 * 24);
          return diffDays < 5;
        } catch (e) {
          return false;
        }
      }

      function dismissBanner() {
        if (banner) banner.style.display = "none";
        try {
          localStorage.setItem("pwa_install_dismissed_time", Date.now().toString());
        } catch (e) {}
      }

      if (btnDismiss) btnDismiss.addEventListener("click", dismissBanner);

      function showInstallBanner() {
        if (isStandalone || isDismissedRecently() || !banner) return;

        // Never show install prompt on desktop computers / laptops
        const isMobile = window.innerWidth <= 640 || /iphone|ipad|ipod|android/i.test(navigator.userAgent);
        if (!isMobile) return;

        // Check if Age Gate is currently blocking the screen
        const isAgeVerified = localStorage.getItem("age_verified_18") === "true";
        if (!isAgeVerified) {
          const ageYes = document.getElementById("btn-age-yes");
          if (ageYes) {
            ageYes.addEventListener("click", () => {
              setTimeout(showInstallBanner, 2500);
            }, { once: true });
          }
          return;
        }

        if (isIOS) {
          if (bannerDesc) bannerDesc.textContent = "Dodaj do ekranu początkowego Safari!";
        } else {
          if (bannerDesc) bannerDesc.textContent = "Szybki dostęp z pulpitu, bez pasków!";
        }

        banner.style.display = "flex";
      }

      // Listen for Chrome / Android beforeinstallprompt on mobile
      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        const isMobile = window.innerWidth <= 640 || /iphone|ipad|ipod|android/i.test(navigator.userAgent);
        if (isMobile) {
          setTimeout(showInstallBanner, 1500);
        }
      });

      // For mobile devices (e.g. iOS Safari & Android): trigger after short delay if not standalone
      const isMobileDevice = window.innerWidth <= 640 || /iphone|ipad|ipod|android/i.test(navigator.userAgent);
      if (isMobileDevice && !isStandalone) {
        setTimeout(showInstallBanner, 3000);
      }

      // Action on floating banner install button
      if (btnInstall) {
        btnInstall.addEventListener("click", () => {
          if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            deferredInstallPrompt.userChoice.then((choice) => {
              if (choice.outcome === "accepted") {
                if (banner) banner.style.display = "none";
                if (drawerPwaWrap) drawerPwaWrap.style.display = "none";
              }
              deferredInstallPrompt = null;
            });
          } else {
            openIosModal();
            dismissBanner();
          }
        });
      }

      const bannerMain = document.querySelector(".pwa-banner-main");
      if (bannerMain && btnInstall) {
        bannerMain.style.cursor = "pointer";
        bannerMain.addEventListener("click", () => {
          btnInstall.click();
        });
      }

      // Action on persistent drawer install button
      if (btnDrawerPwa) {
        btnDrawerPwa.addEventListener("click", () => {
          if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            deferredInstallPrompt.userChoice.then((choice) => {
              if (choice.outcome === "accepted") {
                if (banner) banner.style.display = "none";
                if (drawerPwaWrap) drawerPwaWrap.style.display = "none";
              }
              deferredInstallPrompt = null;
            });
          } else {
            openIosModal();
          }
        });
      }
    }
    initPwaInstall();

    // Pub Crawl Feature Initialization (poilepiwko)
    function initPubCrawl() {
      const crawlModal = document.getElementById("pubcrawl-modal");
      const btnHeader = document.getElementById("btn-pubcrawl-header");
      const btnClose = document.getElementById("btn-close-pubcrawl");
      const btnGenerate = document.getElementById("btn-generate-crawl");
      const startSelect = document.getElementById("crawl-start-select");
      const stopsPills = document.querySelectorAll("#crawl-stops-pills .crawl-pill-btn");
      const vibePills = document.querySelectorAll("#crawl-vibe-pills .crawl-pill-btn");
      const btnShowOnMap = document.getElementById("btn-show-crawl-on-map");
      const btnShare = document.getElementById("btn-share-crawl");
      const btnReroll = document.getElementById("btn-reroll-crawl");

      // Active crawl floating bar elements
      const activeBar = document.getElementById("active-crawl-bar");
      const btnActiveDetails = document.getElementById("btn-crawl-active-details");
      const btnActiveClear = document.getElementById("btn-crawl-clear");

      function openModal() {
        if (!crawlModal) return;
        const drawer = document.getElementById("ranking-drawer");
        if (drawer) drawer.classList.remove("open");
        const baroModal = document.getElementById("barometer-modal");
        if (baroModal) baroModal.classList.remove("active");
        closeModal();
        crawlModal.classList.add("active");
      }

      function closeModalWindow() {
        if (crawlModal) crawlModal.classList.remove("active");
        if (window.__clearBottomNavActive) window.__clearBottomNavActive();
      }

      window.__openPubCrawl = openModal;
      window.__closePubCrawl = closeModalWindow;

      if (btnHeader) btnHeader.addEventListener("click", openModal);
      if (btnClose) btnClose.addEventListener("click", closeModalWindow);
      if (crawlModal) {
        crawlModal.addEventListener("click", (e) => {
          if (e.target === crawlModal) closeModalWindow();
        });
      }

      // Stops Count selection
      stopsPills.forEach(pill => {
        pill.addEventListener("click", () => {
          stopsPills.forEach(p => p.classList.remove("active"));
          pill.classList.add("active");
          currentCrawlStopsCount = parseInt(pill.getAttribute("data-stops"), 10) || 3;
        });
      });

      // Vibe selection
      vibePills.forEach(pill => {
        pill.addEventListener("click", () => {
          vibePills.forEach(p => p.classList.remove("active"));
          pill.classList.add("active");
          currentCrawlVibe = pill.getAttribute("data-vibe") || "cheap";
        });
      });

      // Generate Route
      function triggerGenerate() {
        const startVal = startSelect ? startSelect.value : "pawilony";
        const route = generatePubCrawlRoute(startVal, currentCrawlStopsCount, currentCrawlVibe);
        if (!route || !route.stops || route.stops.length === 0) {
          alert("Nie udało się znaleźć odpowiednich barów dla wybranego rejonu. Wybierz inną lokalizację lub klimat.");
          return;
        }
        renderPubCrawlResult(route);
      }

      if (btnGenerate) {
        btnGenerate.addEventListener("click", triggerGenerate);
      }

      // Reroll variant
      if (btnReroll) {
        btnReroll.addEventListener("click", () => {
          triggerGenerate();
          if (activeBar && activeBar.style.display !== "none" && activeCrawlRoute) {
            showCrawlOnMap(activeCrawlRoute);
          }
        });
      }

      // Show on map
      if (btnShowOnMap) {
        btnShowOnMap.addEventListener("click", () => {
          if (activeCrawlRoute) {
            showCrawlOnMap(activeCrawlRoute);
          }
        });
      }

      // Share
      if (btnShare) {
        btnShare.addEventListener("click", () => {
          if (activeCrawlRoute) {
            shareCrawlRoute(activeCrawlRoute);
          }
        });
      }

      // Active Floating Bar controls
      if (btnActiveDetails) {
        btnActiveDetails.addEventListener("click", openModal);
      }

      if (btnActiveClear) {
        btnActiveClear.addEventListener("click", clearCrawlFromMap);
      }

      // Active Next Stop Checkin Button
      const btnCheckinNext = document.getElementById("btn-crawl-checkin-next");
      if (btnCheckinNext) {
        btnCheckinNext.addEventListener("click", () => {
          advancePubCrawlStep();
        });
      }

      // Crawl Completion Modal Controls
      const completeModal = document.getElementById("crawl-complete-modal");
      const btnCloseComplete = document.getElementById("btn-close-crawl-complete");
      const btnFinishShare = document.getElementById("btn-crawl-finish-share");
      const btnFinishStory = document.getElementById("btn-crawl-finish-story");

      if (btnCloseComplete && completeModal) {
        btnCloseComplete.addEventListener("click", () => {
          completeModal.style.display = "none";
        });
      }
      if (completeModal) {
        completeModal.addEventListener("click", (e) => {
          if (e.target === completeModal) completeModal.style.display = "none";
        });
      }
      if (btnFinishShare) {
        btnFinishShare.addEventListener("click", () => {
          if (lastCompletedCrawlRoute) shareCompletedCrawl(lastCompletedCrawlRoute);
        });
      }
      if (btnFinishStory) {
        btnFinishStory.addEventListener("click", () => {
          if (completeModal) completeModal.style.display = "none";
          if (window.__openStoryCardModal) window.__openStoryCardModal();
        });
      }
    }
    initPubCrawl();
    initHappyHours();
    initPassport();
    initBeerCompass();

    // User Auth Button (Header badge)
    const btnUserAuth = document.getElementById("btn-user-auth");
    if (btnUserAuth) {
      btnUserAuth.addEventListener("click", () => {
        if (currentUser && currentProfile) {
          if (window.__openMyProfile) window.__openMyProfile();
        } else {
          if (window.__openAuth) {
            window.__openAuth();
          } else {
            const authModal = document.getElementById("auth-modal");
            if (authModal) {
              authModal.classList.add("active");
              authModal.style.display = "flex";
            }
          }
        }
      });
    }

    // Community Toggle Button (Header actions)
    const btnCommunityToggle = document.getElementById("btn-community-toggle");
    if (btnCommunityToggle) {
      btnCommunityToggle.addEventListener("click", () => {
        if (window.__openCommunity) window.__openCommunity();
      });
    }

    // Mobile Top Community Button (👥 in floating top bar)
    const btnTopCommunity = document.getElementById("btn-top-community");
    if (btnTopCommunity) {
      btnTopCommunity.addEventListener("click", () => {
        if (window.__openCommunity) window.__openCommunity("search");
      });
    }

    // "Szukaj znajomych" chip in mobile search sheet
    const chipSearchFriends = document.getElementById("chip-search-friends");
    if (chipSearchFriends) {
      chipSearchFriends.addEventListener("click", () => {
        if (window.__closeMobileSearch) window.__closeMobileSearch();
        if (window.__openCommunity) window.__openCommunity("search");
      });
    }

    // "Happy Hours" chip in mobile search sheet
    const chipSearchHappyhour = document.getElementById("chip-search-happyhour");
    if (chipSearchHappyhour) {
      chipSearchHappyhour.addEventListener("click", () => {
        if (window.__closeMobileSearch) window.__closeMobileSearch();
        if (window.__openHappyHours) window.__openHappyHours();
      });
    }

    // "Pub Quiz" chip in mobile search sheet
    const chipSearchQuiz = document.getElementById("chip-search-quiz");
    if (chipSearchQuiz) {
      chipSearchQuiz.addEventListener("click", () => {
        if (window.__closeMobileSearch) window.__closeMobileSearch();
        if (window.__openPubQuiz) window.__openPubQuiz();
      });
    }

    // Initialize Auth & Social Modals
    initAuthModal();
    initOnboardingUsernameModal();
    initProfileModal();
    initCommunityModal();
    initPublicProfileModal();
    initPubQuizModal();
    initRouletteModal();
    initStoryCardModal();
    initClubCardModal();
    initSosFeature();

    // Deep linking: listen to URL hash changes
    window.addEventListener("hashchange", checkUrlHash);

    // Notifications & Activity Polling (every 45s or when tab regains focus)
    setInterval(() => {
      if (currentUser && document.visibilityState === "visible") {
        loadUserNotifications(true);
      }
    }, 45000);

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && currentUser) {
        loadUserNotifications(true);
      }
    });
  }

  // Populate Datalist for autocomplete in form
  function populateDatalist() {
    const datalist = document.getElementById("venues-datalist");
    if (!datalist) return;
    datalist.innerHTML = allVenues.map(v => `<option value="${escapeHtml(v.name)}">`).join("");
  }

  // Utility escape HTML
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  // ==========================================================================
  // AUTHENTICATION, USER PROFILES & SOCIAL COMMUNITY ("Untappd + Strava dla Warszawy")
  // ==========================================================================

  function calculateUserRank(visitedCount) {
    if (visitedCount >= 50) return { title: "Warszawska Legenda 👑", level: 5 };
    if (visitedCount >= 25) return { title: "Piwny Koneser 🍺", level: 4 };
    if (visitedCount >= 10) return { title: "Bywalec Pawilonów 🍻", level: 3 };
    if (visitedCount >= 5) return { title: "Miejski Eksplorator 🦁", level: 2 };
    return { title: "Początkujący Piwosz 🦊", level: 1 };
  }

  function calculateRankProgress(visitedCount) {
    const ranks = [
      { min: 0, title: "Początkujący Piwosz 🦊", nextMin: 5, nextTitle: "Miejski Eksplorator 🦁" },
      { min: 5, title: "Miejski Eksplorator 🦁", nextMin: 10, nextTitle: "Bywalec Pawilonów 🍻" },
      { min: 10, title: "Bywalec Pawilonów 🍻", nextMin: 25, nextTitle: "Piwny Koneser 🍺" },
      { min: 25, title: "Piwny Koneser 🍺", nextMin: 50, nextTitle: "Warszawska Legenda 👑" },
      { min: 50, title: "Warszawska Legenda 👑", nextMin: 100, nextTitle: "Mistrz Piwnych Szlaków ⚡" }
    ];

    let current = ranks[0];
    for (const r of ranks) {
      if (visitedCount >= r.min) current = r;
    }

    if (visitedCount >= 100) {
      return {
        percent: 100,
        currentTitle: "Mistrz Piwnych Szlaków ⚡",
        nextTitle: "Maksymalna ranga osiągnięta! 👑",
        remaining: 0
      };
    }

    const range = current.nextMin - current.min;
    const progressInTier = Math.max(0, visitedCount - current.min);
    const percent = Math.min(100, Math.max(5, Math.round((progressInTier / range) * 100)));
    const remaining = current.nextMin - visitedCount;

    return {
      percent,
      currentTitle: current.title,
      nextTitle: `Następny cel: ${current.nextTitle} (jeszcze ${remaining} ${remaining === 1 ? 'bar' : (remaining < 5 ? 'bary' : 'barów')})`,
      remaining
    };
  }

  function formatTimeAgo(isoString) {
    if (!isoString) return "niedawno";
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);
    if (diffSec < 60) return "przed chwilą";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min temu`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} godz. temu`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "wczoraj";
    if (diffDays < 7) return `${diffDays} dni temu`;
    return date.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  }

  function setupSupabaseAuth() {
    if (!supabaseClient || !supabaseClient.auth) return;

    // Check URL params for OAuth return errors or cancellations
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const errDesc = urlParams.get("error_description");
      if (errDesc) {
        const cleanErr = decodeURIComponent(errDesc).replace(/\+/g, " ");
        setTimeout(() => {
          if (typeof showAppToast === "function") {
            showAppToast("Błąd logowania", cleanErr, "⚠️");
          }
        }, 600);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {}

    supabaseClient.auth.getSession().then(({ data }) => {
      if (data && data.session && data.session.user) {
        currentUser = data.session.user;
        fetchAndSyncUserProfile();
      } else {
        currentUser = null;
        currentProfile = null;
        myFollowingIds = [];
        myNotifications = [];
        unreadNotificationsCount = 0;
        knownNotificationIds.clear();
        updateAuthUI();
      }
    }).catch(err => {
      console.warn("Supabase getSession error:", err);
    });

    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      console.log("Auth state change:", event, session?.user?.email);
      if (session && session.user) {
        currentUser = session.user;
        if (window.__closeAuth) window.__closeAuth();
        await fetchAndSyncUserProfile();
      } else {
        currentUser = null;
        currentProfile = null;
        myFollowingIds = [];
        myNotifications = [];
        unreadNotificationsCount = 0;
        knownNotificationIds.clear();
        updateAuthUI();
      }
    });
  }

  async function fetchAndSyncUserProfile() {
    if (!currentUser) return;

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get-profile",
          payload: { userId: currentUser.id }
        })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          currentProfile = data.profile;
          if (data.userNumber) {
            currentProfile.user_number = data.userNumber;
            const userNumEl = document.getElementById("prof-user-number");
            if (userNumEl) userNumEl.textContent = data.userNumber;
            const pubUserNum = document.getElementById("pubprof-user-number");
            if (pubUserNum) pubUserNum.textContent = data.userNumber;
          }
          if (Array.isArray(data.followingIds)) {
            myFollowingIds = data.followingIds;
          }

          // Robust photo hydration: DB -> user_metadata -> localStorage
          const metaPhoto = currentUser.user_metadata?.avatar_photo;
          const savedLocalPhoto = currentUser ? localStorage.getItem("poilepiwko_user_avatar_photo_" + currentUser.id) : null;

          if (!currentProfile.avatar_photo) {
            if (metaPhoto) {
              currentProfile.avatar_photo = metaPhoto;
              if (currentUser) localStorage.setItem("poilepiwko_user_avatar_photo_" + currentUser.id, metaPhoto);
            } else if (savedLocalPhoto) {
              currentProfile.avatar_photo = savedLocalPhoto;
              // Push local device photo to cloud so other devices (desktop/tablet) get it!
              syncUserDataToCloud({ avatarPhoto: savedLocalPhoto });
              if (supabaseClient && supabaseClient.auth) {
                supabaseClient.auth.updateUser({ data: { avatar_photo: savedLocalPhoto } }).catch(() => {});
              }
            }
          } else if (currentUser) {
            // Cloud has photo -> keep device localStorage in sync
            localStorage.setItem("poilepiwko_user_avatar_photo_" + currentUser.id, currentProfile.avatar_photo);
          }

          // Lossless merge with localStorage
          const cloudVisited = Array.isArray(currentProfile.visited_venues) ? currentProfile.visited_venues : [];
          const mergedVisited = Array.from(new Set([...visitedVenues, ...cloudVisited]));
          if (mergedVisited.length > visitedVenues.length || mergedVisited.length > cloudVisited.length) {
            visitedVenues = mergedVisited;
            saveVisitedVenues(visitedVenues);
          }

          const cloudFavs = Array.isArray(currentProfile.favorite_venues) ? currentProfile.favorite_venues : [];
          const mergedFavs = Array.from(new Set([...favoriteVenues, ...cloudFavs]));
          if (mergedFavs.length > favoriteVenues.length || mergedFavs.length > cloudFavs.length) {
            favoriteVenues = mergedFavs;
            saveFavoriteVenues(favoriteVenues);
          }

          // If local had items missing in cloud, sync up
          if (mergedVisited.length > cloudVisited.length || mergedFavs.length > cloudFavs.length) {
            syncUserDataToCloud();
          }
        }
      }
    } catch (err) {
      console.warn("Error fetching user profile:", err);
    }

    if (!currentProfile) {
      // Fallback profile if record not fetched
      const meta = currentUser.user_metadata || {};
      const fallbackUsername = meta.username || (currentUser.email ? currentUser.email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "") : "piwosz");
      const savedPhoto = (currentUser ? localStorage.getItem("poilepiwko_user_avatar_photo_" + currentUser.id) : null) || meta.avatar_photo || null;
      currentProfile = {
        id: currentUser.id,
        username: fallbackUsername,
        display_name: meta.display_name || meta.full_name || meta.name || fallbackUsername,
        avatar_icon: meta.avatar_icon || "🍺",
        avatar_photo: savedPhoto,
        user_number: "#000001",
        bio: "Koneser lanego z kija i dobrych ogródków.",
        vibe_tags: "Kraft, Ogródki, Pub Quiz",
        visited_venues: visitedVenues,
        favorite_venues: favoriteVenues
      };
      syncUserDataToCloud();
    }

    // Check if user needs to choose a custom username (e.g. after first Google OAuth login)
    const userMeta = currentUser.user_metadata || {};
    const hasCustomUsername = userMeta.username_custom === true ||
      (currentProfile && currentProfile.username_custom === true) ||
      localStorage.getItem("poilepiwko_username_custom_" + currentUser.id) === "true";

    if (!hasCustomUsername && typeof window.__openOnboardingUsername === "function") {
      setTimeout(() => {
        window.__openOnboardingUsername(currentUser);
      }, 400);
    }

    updateAuthUI();
    updatePassportCounters();
    updateFavoriteCounters();
    renderMarkers();
    loadUserNotifications(false);
  }

  function syncUserDataToCloud(extra = {}) {
    if (!currentUser) return;
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "sync-profile",
        payload: {
          userId: currentUser.id,
          visitedVenues: visitedVenues,
          favoriteVenues: favoriteVenues,
          ...extra
        }
      })
    }).then(r => r.json()).then(data => {
      if (data.success && currentProfile) {
        if (extra.displayName) currentProfile.display_name = extra.displayName;
        if (extra.avatarIcon) currentProfile.avatar_icon = extra.avatarIcon;
        if (extra.avatarPhoto !== undefined) {
          currentProfile.avatar_photo = extra.avatarPhoto || null;
          if (currentUser) {
            localStorage.setItem("poilepiwko_user_avatar_photo_" + currentUser.id, extra.avatarPhoto || "");
          }
        }
        if (extra.bio !== undefined) currentProfile.bio = extra.bio;
        if (extra.favoriteBeer !== undefined) currentProfile.favorite_beer = extra.favoriteBeer;
        if (extra.favoriteDistrict !== undefined) currentProfile.favorite_district = extra.favoriteDistrict;
        if (extra.vibeTags !== undefined) currentProfile.vibe_tags = extra.vibeTags;
        updateAuthUI();
      }
    }).catch(err => console.warn("Sync to cloud error:", err));
  }

  function updateAuthUI() {
    const btnAuth = document.getElementById("btn-user-auth");
    const navIconWrap = document.getElementById("nav-profile-icon-wrap");
    const navLabel = document.getElementById("nav-profile-label");

    if (currentUser && currentProfile) {
      if (btnAuth) {
        btnAuth.classList.remove("badge-guest");
        btnAuth.classList.add("badge-logged-in");
        const icon = currentProfile.avatar_icon || "🍺";
        const name = currentProfile.username ? `@${currentProfile.username}` : (currentProfile.display_name || "Mój profil");
        const avatarHtml = currentProfile.avatar_photo
          ? `<span class="auth-avatar"><img src="${escapeHtml(currentProfile.avatar_photo)}" class="auth-avatar-photo" alt="Avatar" /></span>`
          : `<span class="auth-avatar">${escapeHtml(icon)}</span>`;
        btnAuth.innerHTML = `${avatarHtml}<span class="badge-text">${escapeHtml(name)}</span>`;
        btnAuth.title = `Zalogowano jako @${currentProfile.username}`;
      }

      if (navIconWrap) {
        if (currentProfile.avatar_photo) {
          navIconWrap.innerHTML = `<img src="${escapeHtml(currentProfile.avatar_photo)}" class="nav-avatar-photo" alt="Profil" />`;
        } else {
          navIconWrap.innerHTML = `<span class="nav-avatar-emoji">${escapeHtml(currentProfile.avatar_icon || "🍺")}</span>`;
        }
      }
      if (navLabel) {
        navLabel.textContent = currentProfile.username ? `@${currentProfile.username}` : "Profil";
      }
    } else {
      if (btnAuth) {
        btnAuth.classList.remove("badge-logged-in");
        btnAuth.classList.add("badge-guest");
        btnAuth.innerHTML = `<span>👤</span><span class="badge-text">Zaloguj się</span>`;
        btnAuth.title = "Zaloguj się lub załóż konto piwosza";
      }

      if (navIconWrap) {
        navIconWrap.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;
      }
      if (navLabel) {
        navLabel.textContent = "Profil";
      }
    }

    const commFollowingBadge = document.getElementById("comm-following-badge");
    if (commFollowingBadge) {
      commFollowingBadge.textContent = myFollowingIds.length;
    }
    updateNotificationBadges();
  }

  // Activity & Notifications Handlers
  function updateNotificationBadges() {
    const headerDot = document.getElementById("header-community-dot");
    const navDot = document.getElementById("nav-community-dot");
    const commPill = document.getElementById("comm-notif-pill");

    const hasUnread = Boolean(currentUser && unreadNotificationsCount > 0);

    if (headerDot) {
      headerDot.style.display = hasUnread ? "block" : "none";
    }
    if (navDot) {
      navDot.style.display = hasUnread ? "block" : "none";
    }
    if (commPill) {
      if (hasUnread) {
        commPill.textContent = unreadNotificationsCount > 99 ? "99+" : unreadNotificationsCount;
        commPill.style.display = "inline-flex";
      } else {
        commPill.style.display = "none";
      }
    }
  }

  function requestBrowserNotificationPermission() {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }

  async function loadUserNotifications(notifyIfNew = false) {
    if (!currentUser || isFetchingNotifications) return;
    isFetchingNotifications = true;
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get-notifications",
          payload: { userId: currentUser.id }
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.notifications)) {
          const prevKnown = new Set(knownNotificationIds);
          myNotifications = data.notifications;
          unreadNotificationsCount = typeof data.unreadCount === "number" ? data.unreadCount : 0;

          if (notifyIfNew && prevKnown.size > 0) {
            const newlyArrived = myNotifications.filter(n => !n.read && !prevKnown.has(n.id));
            if (newlyArrived.length > 0) {
              const latest = newlyArrived[0];
              const isSos = latest.type === "sos_alert";
              const toastIcon = isSos ? "🚨" : (latest.type === "cheers_toast" ? "🍻" : "👥");
              const toastTitle = isSos ? "🚨 PILNY ALERT SOS OD ZNAJOMEGO!" : "Nowa aktywność od znajomego!";
              showAppToast(toastTitle, latest.message, toastIcon, isSos ? 8000 : 4500);

              if (isSos && typeof navigator !== "undefined" && navigator.vibrate) {
                try { navigator.vibrate([300, 150, 300, 150, 400]); } catch (e) {}
              }

              if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                try {
                  new Notification(isSos ? "🚨 ALERT SOS: ZNAJOMY POTRZEBUJE POMOCY!" : "Po ile piwko? 🍻", {
                    body: latest.message,
                    icon: "/icons/icon-192.png",
                    badge: "/icons/icon-192.png"
                  });
                } catch (e) {}
              }
            }
          }

          myNotifications.forEach(n => {
            if (n.id) knownNotificationIds.add(n.id);
          });

          updateNotificationBadges();

          const paneNotifications = document.getElementById("pane-comm-notifications");
          if (paneNotifications && paneNotifications.style.display !== "none") {
            if (typeof window.__renderNotificationsList === "function") {
              window.__renderNotificationsList();
            }
          }
        }
      }
    } catch (e) {
      console.warn("loadUserNotifications error:", e);
    } finally {
      isFetchingNotifications = false;
    }
  }

  async function markNotificationsAsRead() {
    if (!currentUser || unreadNotificationsCount === 0) return;
    unreadNotificationsCount = 0;
    myNotifications.forEach(n => { n.read = true; });
    updateNotificationBadges();

    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark-notifications-read",
          payload: { userId: currentUser.id }
        })
      });
    } catch (e) {
      console.warn("markNotificationsAsRead error:", e);
    }
  }

  function initAuthModal() {
    const modal = document.getElementById("auth-modal");
    const btnClose = document.getElementById("btn-close-auth");
    const tabLogin = document.getElementById("tab-auth-login");
    const tabRegister = document.getElementById("tab-auth-register");
    const formLogin = document.getElementById("form-auth-login");
    const formRegister = document.getElementById("form-auth-register");
    const formForgot = document.getElementById("form-auth-forgot");
    const linkForgot = document.getElementById("link-forgot-pass");
    const btnBackToLogin = document.getElementById("btn-back-to-login");
    const regAvatarPicker = document.getElementById("reg-avatar-picker");
    const regUsernameInput = document.getElementById("reg-username");
    const regUsernameHint = document.getElementById("reg-username-hint");
    const loginErrorMsg = document.getElementById("login-error-msg");
    const regErrorMsg = document.getElementById("reg-error-msg");
    const forgotErrorMsg = document.getElementById("forgot-error-msg");
    const forgotSuccessMsg = document.getElementById("forgot-success-msg");
    const authSocialWrap = document.getElementById("auth-social-wrap");
    const btnOauthGoogle = document.getElementById("btn-oauth-google");
    const btnOauthApple = document.getElementById("btn-oauth-apple");

    let selectedAvatar = "🍺";

    function showTab(tab) {
      if (loginErrorMsg) loginErrorMsg.style.display = "none";
      if (regErrorMsg) regErrorMsg.style.display = "none";
      if (forgotErrorMsg) forgotErrorMsg.style.display = "none";
      if (forgotSuccessMsg) forgotSuccessMsg.style.display = "none";

      if (authSocialWrap) {
        authSocialWrap.style.display = (tab === "forgot") ? "none" : "flex";
      }

      if (tab === "login") {
        if (tabLogin) tabLogin.classList.add("active");
        if (tabRegister) tabRegister.classList.remove("active");
        if (formLogin) formLogin.style.display = "block";
        if (formRegister) formRegister.style.display = "none";
        if (formForgot) formForgot.style.display = "none";
      } else if (tab === "register") {
        if (tabRegister) tabRegister.classList.add("active");
        if (tabLogin) tabLogin.classList.remove("active");
        if (formRegister) formRegister.style.display = "block";
        if (formLogin) formLogin.style.display = "none";
        if (formForgot) formForgot.style.display = "none";
      } else if (tab === "forgot") {
        if (formLogin) formLogin.style.display = "none";
        if (formRegister) formRegister.style.display = "none";
        if (formForgot) formForgot.style.display = "block";
      }
    }

    if (tabLogin) tabLogin.addEventListener("click", () => showTab("login"));
    if (tabRegister) tabRegister.addEventListener("click", () => showTab("register"));
    if (linkForgot) {
      linkForgot.addEventListener("click", (e) => {
        e.preventDefault();
        showTab("forgot");
      });
    }
    if (btnBackToLogin) {
      btnBackToLogin.addEventListener("click", () => showTab("login"));
    }

    async function handleOAuthSignIn(provider) {
      if (!supabaseClient || !supabaseClient.auth) {
        if (typeof showAppToast === "function") {
          showAppToast("Błąd logowania", "Klient Supabase nie jest gotowy.", "⚠️");
        }
        return;
      }

      const provName = provider === "google" ? "Google" : "Apple";
      const targetBtn = provider === "google" ? btnOauthGoogle : btnOauthApple;

      if (targetBtn) {
        targetBtn.disabled = true;
        targetBtn.style.opacity = "0.7";
      }

      try {
        const { data, error } = await supabaseClient.auth.signInWithOAuth({
          provider: provider,
          options: {
            redirectTo: window.location.origin + window.location.pathname
          }
        });

        if (error) {
          throw error;
        }
      } catch (err) {
        console.warn(`OAuth sign in error (${provider}):`, err);
        let msg = err.message || `Błąd logowania przez ${provName}.`;
        if (msg.includes("provider is not enabled") || msg.includes("Unsupported provider")) {
          msg = `Logowanie przez ${provName} wymaga włączenia providera w panelu Supabase (Authentication → Providers).`;
        }
        if (typeof showAppToast === "function") {
          showAppToast(`Logowanie ${provName}`, msg, "⚠️");
        }
        if (loginErrorMsg) {
          loginErrorMsg.textContent = msg;
          loginErrorMsg.style.display = "block";
        }
      } finally {
        if (targetBtn) {
          targetBtn.disabled = false;
          targetBtn.style.opacity = "1";
        }
      }
    }

    if (btnOauthGoogle) {
      btnOauthGoogle.addEventListener("click", () => handleOAuthSignIn("google"));
    }
    if (btnOauthApple) {
      btnOauthApple.addEventListener("click", () => handleOAuthSignIn("apple"));
    }

    function openModalWindow(defaultTab = "login") {
      if (!modal) return;
      showTab(defaultTab);
      modal.classList.add("active");
      modal.style.display = "flex";
    }

    function closeModalWindow() {
      if (!modal) return;
      modal.classList.remove("active");
      modal.style.display = "none";
    }

    window.__openAuth = openModalWindow;
    window.__closeAuth = closeModalWindow;

    if (btnClose && modal) {
      btnClose.addEventListener("click", closeModalWindow);
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModalWindow();
      });
    }

    // Avatar selector
    if (regAvatarPicker) {
      const btns = regAvatarPicker.querySelectorAll(".avatar-option");
      btns.forEach(btn => {
        btn.addEventListener("click", () => {
          btns.forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
          selectedAvatar = btn.getAttribute("data-avatar") || "🍺";
        });
      });
    }

    // Debounced username availability check
    let debounceTimer = null;
    if (regUsernameInput) {
      regUsernameInput.addEventListener("input", () => {
        const val = regUsernameInput.value.trim().toLowerCase().replace(/^@/, "");
        regUsernameInput.value = val;
        clearTimeout(debounceTimer);
        if (!val) {
          if (regUsernameHint) {
            regUsernameHint.textContent = "3-20 liter, cyfr lub podkreślenie (_)";
            regUsernameHint.style.color = "var(--text-muted)";
          }
          return;
        }
        if (!/^[a-z0-9_]{3,20}$/.test(val)) {
          if (regUsernameHint) {
            regUsernameHint.textContent = "Nick musi mieć 3-20 znaków (małe litery, cyfry, _)";
            regUsernameHint.style.color = "#f87171";
          }
          return;
        }

        if (window.ProfanityFilter && window.ProfanityFilter.isOffensive(val)) {
          if (regUsernameHint) {
            regUsernameHint.textContent = "✕ Nick zawiera niedozwolone lub obraźliwe słowa";
            regUsernameHint.style.color = "#f87171";
          }
          return;
        }

        if (regUsernameHint) {
          regUsernameHint.textContent = "Sprawdzanie dostępności...";
          regUsernameHint.style.color = "var(--text-muted)";
        }

        debounceTimer = setTimeout(async () => {
          try {
            const res = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "check-username",
                payload: { username: val }
              })
            });
            const data = await res.json();
            if (regUsernameHint) {
              if (data.available) {
                regUsernameHint.textContent = `✓ ${data.message || "Nick jest wolny!"}`;
                regUsernameHint.style.color = "#4ade80";
              } else {
                regUsernameHint.textContent = `✕ ${data.message || "Nick jest już zajęty."}`;
                regUsernameHint.style.color = "#f87171";
              }
            }
          } catch (e) {
            if (regUsernameHint) {
              regUsernameHint.textContent = "Nie udało się sprawdzić nicku.";
              regUsernameHint.style.color = "var(--text-muted)";
            }
          }
        }, 350);
      });
    }

    // Login Form Submit
    if (formLogin) {
      formLogin.addEventListener("submit", async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("login-email");
        const passInput = document.getElementById("login-password");
        const submitBtn = document.getElementById("btn-submit-login");

        const rawLogin = emailInput ? emailInput.value.trim() : "";
        const password = passInput ? passInput.value : "";

        if (loginErrorMsg) loginErrorMsg.style.display = "none";
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = "<span>⏳ Logowanie...</span>";
        }

        try {
          if (!supabaseClient || !supabaseClient.auth) {
            throw new Error("Klient Supabase nie jest gotowy.");
          }

          if (!rawLogin.includes("@")) {
            throw new Error("Wpisz adres e-mail przypisany do Twojego konta (np. jan@gmail.com).");
          }

          const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: rawLogin,
            password: password
          });

          if (error) {
            let msg = error.message;
            if (msg.includes("Invalid login credentials")) {
              msg = "Nieprawidłowy adres e-mail lub hasło.";
            } else if (msg.includes("Email not confirmed")) {
              msg = "Adres e-mail nie został jeszcze potwierdzony.";
            }
            throw new Error(msg);
          }

          closeModalWindow();
          showAppToast("Siema! 🍻", "Zalogowano pomyślnie.", "🍻");
        } catch (err) {
          if (loginErrorMsg) {
            loginErrorMsg.textContent = err.message || "Błąd logowania.";
            loginErrorMsg.style.display = "block";
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>🚀 Zaloguj się</span>";
          }
        }
      });
    }

    // Register Form Submit
    if (formRegister) {
      formRegister.addEventListener("submit", async (e) => {
        e.preventDefault();
        const usernameInput = document.getElementById("reg-username");
        const displayNameInput = document.getElementById("reg-display-name");
        const emailInput = document.getElementById("reg-email");
        const passInput = document.getElementById("reg-password");
        const submitBtn = document.getElementById("btn-submit-register");

        const username = usernameInput ? usernameInput.value.trim().toLowerCase().replace(/^@/, "") : "";
        const displayName = displayNameInput ? displayNameInput.value.trim() : "";
        const email = emailInput ? emailInput.value.trim() : "";
        const password = passInput ? passInput.value : "";
        const termsAgree = document.getElementById("reg-terms-agree");

        if (termsAgree && !termsAgree.checked) {
          if (regErrorMsg) {
            regErrorMsg.textContent = "Musisz zaakceptować Regulamin serwisu i zasady crowdsourcingu.";
            regErrorMsg.style.display = "block";
          }
          return;
        }

        if (window.ProfanityFilter) {
          const uVal = window.ProfanityFilter.validateUsername(username);
          if (!uVal.valid) {
            if (regErrorMsg) {
              regErrorMsg.textContent = uVal.error;
              regErrorMsg.style.display = "block";
            }
            if (usernameInput) usernameInput.focus();
            return;
          }
          if (displayName) {
            const dVal = window.ProfanityFilter.validateDisplayName(displayName);
            if (!dVal.valid) {
              if (regErrorMsg) {
                regErrorMsg.textContent = dVal.error;
                regErrorMsg.style.display = "block";
              }
              if (displayNameInput) displayNameInput.focus();
              return;
            }
          }
        }

        if (regErrorMsg) regErrorMsg.style.display = "none";
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = "<span>⏳ Tworzenie profilu...</span>";
        }

        try {
          const res = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "register",
              payload: {
                username,
                displayName: displayName || username,
                email,
                password,
                avatarIcon: selectedAvatar,
                visitedVenues,
                favoriteVenues
              }
            })
          });

          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || "Błąd podczas rejestracji.");
          }

          // Auto sign-in now that user is auto-confirmed
          if (supabaseClient && supabaseClient.auth) {
            const { error: signInErr } = await supabaseClient.auth.signInWithPassword({
              email,
              password
            });
            if (signInErr) {
              console.warn("Auto sign-in note:", signInErr);
            }
          }

          closeModalWindow();
          showAppToast(`Siemanko @${username}! 🍻`, "Konto gotowe, możesz ruszać w miasto.", selectedAvatar);
        } catch (err) {
          if (regErrorMsg) {
            regErrorMsg.textContent = err.message || "Błąd rejestracji.";
            regErrorMsg.style.display = "block";
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>✨ Utwórz konto</span>";
          }
        }
      });
    }

    // Forgot Password Form Submit
    if (formForgot) {
      formForgot.addEventListener("submit", async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("forgot-email");
        const submitBtn = document.getElementById("btn-submit-forgot");
        const email = emailInput ? emailInput.value.trim() : "";

        if (forgotErrorMsg) forgotErrorMsg.style.display = "none";
        if (forgotSuccessMsg) forgotSuccessMsg.style.display = "none";
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = "<span>⏳ Wysyłanie...</span>";
        }

        try {
          if (!supabaseClient || !supabaseClient.auth) {
            throw new Error("Klient Supabase niedostępny.");
          }
          const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin
          });
          if (error) throw error;
          if (forgotSuccessMsg) {
            forgotSuccessMsg.textContent = "Link do zresetowania hasła został wysłany na Twój e-mail!";
            forgotSuccessMsg.style.display = "block";
          }
        } catch (err) {
          if (forgotErrorMsg) {
            forgotErrorMsg.textContent = err.message || "Błąd wysyłania linku resetującego.";
            forgotErrorMsg.style.display = "block";
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>📩 Wyślij link resetujący</span>";
          }
        }
      });
    }
  }

  function initOnboardingUsernameModal() {
    const modal = document.getElementById("onboarding-username-modal");
    const form = document.getElementById("form-onboarding-username");
    const usernameInput = document.getElementById("onboarding-username");
    const usernameHint = document.getElementById("onboarding-username-hint");
    const displayNameInput = document.getElementById("onboarding-display-name");
    const avatarPicker = document.getElementById("onboarding-avatar-picker");
    const errorMsg = document.getElementById("onboarding-error-msg");
    const submitBtn = document.getElementById("btn-submit-onboarding");

    let selectedAvatar = "🍺";

    if (avatarPicker) {
      const btns = avatarPicker.querySelectorAll(".avatar-option");
      btns.forEach(btn => {
        btn.addEventListener("click", () => {
          btns.forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
          selectedAvatar = btn.getAttribute("data-avatar") || "🍺";
        });
      });
    }

    // Debounced username check
    let debounceTimer = null;
    if (usernameInput) {
      usernameInput.addEventListener("input", () => {
        const val = usernameInput.value.trim().toLowerCase().replace(/^@/, "");
        usernameInput.value = val;
        clearTimeout(debounceTimer);
        if (!val) {
          if (usernameHint) {
            usernameHint.textContent = "3-20 liter, cyfr lub podkreślenie (_)";
            usernameHint.style.color = "var(--text-muted)";
          }
          return;
        }
        if (!/^[a-z0-9_]{3,20}$/.test(val)) {
          if (usernameHint) {
            usernameHint.textContent = "Nick musi mieć 3-20 znaków (małe litery, cyfry, _)";
            usernameHint.style.color = "#f87171";
          }
          return;
        }

        if (window.ProfanityFilter && window.ProfanityFilter.isOffensive(val)) {
          if (usernameHint) {
            usernameHint.textContent = "✕ Nick zawiera niedozwolone lub obraźliwe słowa";
            usernameHint.style.color = "#f87171";
          }
          return;
        }

        if (usernameHint) {
          usernameHint.textContent = "Sprawdzanie dostępności...";
          usernameHint.style.color = "var(--text-muted)";
        }

        debounceTimer = setTimeout(async () => {
          try {
            const res = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "check-username",
                payload: { username: val }
              })
            });
            const data = await res.json();
            if (usernameHint) {
              if (data.available) {
                usernameHint.textContent = `✓ ${data.message || "Nick jest wolny!"}`;
                usernameHint.style.color = "#4ade80";
              } else {
                usernameHint.textContent = `✕ ${data.message || "Nick jest już zajęty."}`;
                usernameHint.style.color = "#f87171";
              }
            }
          } catch (e) {
            if (usernameHint) {
              usernameHint.textContent = "Nie udało się sprawdzić nicku.";
              usernameHint.style.color = "var(--text-muted)";
            }
          }
        }, 350);
      });
    }

    function openOnboarding(user) {
      if (!modal || !user) return;
      const meta = user.user_metadata || {};
      const fallbackName = meta.full_name || meta.name || meta.display_name || "";
      const suggestedUser = (meta.username || (user.email ? user.email.split("@")[0] : "piwosz")).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);

      if (usernameInput) usernameInput.value = suggestedUser;
      if (displayNameInput) displayNameInput.value = fallbackName || suggestedUser;
      if (errorMsg) errorMsg.style.display = "none";

      modal.style.display = "flex";
      modal.classList.add("active");
    }

    window.__openOnboardingUsername = openOnboarding;

    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser) return;

        const valUser = usernameInput ? usernameInput.value.trim().toLowerCase().replace(/^@/, "") : "";
        const valName = displayNameInput ? displayNameInput.value.trim() : valUser;

        if (!valUser || !/^[a-z0-9_]{3,20}$/.test(valUser)) {
          if (errorMsg) {
            errorMsg.textContent = "Wpisz poprawny nick (3-20 znaków: małe litery, cyfry lub _).";
            errorMsg.style.display = "block";
          }
          return;
        }

        if (window.ProfanityFilter) {
          const uVal = window.ProfanityFilter.validateUsername(valUser);
          if (!uVal.valid) {
            if (errorMsg) {
              errorMsg.textContent = uVal.error;
              errorMsg.style.display = "block";
            }
            if (usernameInput) usernameInput.focus();
            return;
          }
          if (valName) {
            const dVal = window.ProfanityFilter.validateDisplayName(valName);
            if (!dVal.valid) {
              if (errorMsg) {
                errorMsg.textContent = dVal.error;
                errorMsg.style.display = "block";
              }
              if (displayNameInput) displayNameInput.focus();
              return;
            }
          }
        }

        const termsAgree = document.getElementById("onboarding-terms-agree");
        if (termsAgree && !termsAgree.checked) {
          if (errorMsg) {
            errorMsg.textContent = "Musisz zaakceptować Regulamin serwisu i zasady crowdsourcingu.";
            errorMsg.style.display = "block";
          }
          return;
        }

        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = "<span>⏳ Zapisywanie...</span>";
        }
        if (errorMsg) errorMsg.style.display = "none";

        try {
          // 1. Call API to set username
          const res = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "set-username",
              payload: {
                userId: currentUser.id,
                username: valUser,
                displayName: valName,
                avatarIcon: selectedAvatar
              }
            })
          });

          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || "Nie udało się zapisać nicku.");
          }

          // 2. Update local profile
          if (currentProfile) {
            currentProfile.username = valUser;
            currentProfile.display_name = valName;
            currentProfile.avatar_icon = selectedAvatar;
            currentProfile.username_custom = true;
          }

          // 3. Mark as custom in Supabase auth user
          if (supabaseClient && supabaseClient.auth) {
            await supabaseClient.auth.updateUser({
              data: {
                username: valUser,
                username_custom: true,
                display_name: valName,
                avatar_icon: selectedAvatar
              }
            }).catch(e => console.warn("updateUser note:", e));
          }

          try {
            localStorage.setItem("poilepiwko_username_custom_" + currentUser.id, "true");
          } catch (e) {}

          modal.classList.remove("active");
          modal.style.display = "none";

          updateAuthUI();
          if (typeof showAppToast === "function") {
            showAppToast(`Siemanko, @${valUser}! 🍻`, "Profil gotowy, ruszaj w miasto.", "🍻");
          }
        } catch (err) {
          if (errorMsg) {
            errorMsg.textContent = err.message || "Błąd zapisu.";
            errorMsg.style.display = "block";
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = "<span>🎉 Zapisz i dołącz do mapy</span>";
          }
        }
      });
    }
  }

  function initProfileModal() {
    const modal = document.getElementById("profile-modal");
    const btnClose = document.getElementById("btn-close-profile");
    const btnLogout = document.getElementById("btn-logout");
    const btnShareMyProfile = document.getElementById("btn-share-my-profile");
    const btnOpenCommFromProf = document.getElementById("btn-open-community-from-profile");
    const btnToggleEdit = document.getElementById("btn-toggle-edit-profile");
    const btnCancelEdit = document.getElementById("btn-cancel-edit-profile");
    const formEdit = document.getElementById("form-edit-profile");
    const editModal = document.getElementById("edit-profile-modal");
    const btnCloseEdit = document.getElementById("btn-close-edit-modal");
    const editAvatarPicker = document.getElementById("edit-avatar-picker");

    let editSelectedAvatar = "🍺";
    let editSelectedPhoto = null;

    function updateEditModalAvatarPreview() {
      const previewImg = document.getElementById("edit-photo-preview-img");
      const previewEmoji = document.getElementById("edit-photo-preview-emoji");
      const btnRemovePhoto = document.getElementById("btn-remove-profile-photo");
      const btns = editAvatarPicker ? editAvatarPicker.querySelectorAll(".avatar-option") : [];

      if (editSelectedPhoto) {
        if (previewImg) {
          previewImg.src = editSelectedPhoto;
          previewImg.style.display = "block";
        }
        if (previewEmoji) previewEmoji.style.display = "none";
        if (btnRemovePhoto) btnRemovePhoto.style.display = "inline-block";
        btns.forEach(b => b.classList.remove("selected"));
      } else {
        if (previewImg) {
          previewImg.src = "";
          previewImg.style.display = "none";
        }
        if (previewEmoji) {
          previewEmoji.textContent = editSelectedAvatar || "🍺";
          previewEmoji.style.display = "flex";
        }
        if (btnRemovePhoto) btnRemovePhoto.style.display = "none";
        btns.forEach(b => {
          if (b.getAttribute("data-avatar") === editSelectedAvatar) {
            b.classList.add("selected");
          } else {
            b.classList.remove("selected");
          }
        });
      }
    }

    function renderMyProfile() {
      if (!currentProfile) return;
      const rank = calculateUserRank(visitedVenues.length);

      const heroAvatar = document.getElementById("prof-hero-avatar");
      const heroName = document.getElementById("prof-hero-name");
      const heroHandle = document.getElementById("prof-hero-handle");
      const userNumEl = document.getElementById("prof-user-number");
      const rankTitle = document.getElementById("prof-rank-title");
      const statVisited = document.getElementById("prof-stat-visited");
      const statBadges = document.getElementById("prof-stat-badges");
      const statFavorites = document.getElementById("prof-stat-favorites");
      const statFriends = document.getElementById("prof-stat-friends");
      const bioDisplay = document.getElementById("prof-bio-display");
      const valBeer = document.getElementById("prof-val-beer");
      const valDistrict = document.getElementById("prof-val-district");
      const valVibe = document.getElementById("prof-val-vibe");

      if (heroAvatar) {
        if (currentProfile.avatar_photo) {
          heroAvatar.innerHTML = `<img src="${escapeHtml(currentProfile.avatar_photo)}" class="profile-hero-photo" alt="Zdjęcie profilowe" />`;
        } else {
          heroAvatar.textContent = currentProfile.avatar_icon || "🍺";
        }
      }
      if (heroName) heroName.textContent = currentProfile.display_name || currentProfile.username;
      if (heroHandle) heroHandle.textContent = `@${currentProfile.username}`;
      if (userNumEl) userNumEl.textContent = currentProfile.user_number || "#000001";
      if (rankTitle) rankTitle.textContent = rank.title;
      if (statVisited) statVisited.textContent = visitedVenues.length;
      if (statBadges) statBadges.textContent = loadUnlockedBadges().length;
      if (statFavorites) statFavorites.textContent = favoriteVenues.length;
      if (statFriends) statFriends.textContent = myFollowingIds.length;
      if (bioDisplay) bioDisplay.textContent = currentProfile.bio || "Warszawski poszukiwacz dobrego i taniego piwa 🍻";
      if (valBeer) valBeer.textContent = currentProfile.favorite_beer || "Wszystkie dobre!";
      if (valDistrict) valDistrict.textContent = currentProfile.favorite_district || "Cała Warszawa";
      if (valVibe) valVibe.textContent = currentProfile.vibe_tags || "Kraft, Ogródki, Pub Quiz";

      // Progress bar (Goin' style: "Get the most out of poilepiwko")
      const rankProg = calculateRankProgress(visitedVenues.length);
      const progressFill = document.getElementById("prof-progress-fill");
      const progressPercent = document.getElementById("prof-progress-percent");
      const progressTarget = document.getElementById("prof-progress-target");

      if (progressFill) progressFill.style.width = `${rankProg.percent}%`;
      if (progressPercent) progressPercent.textContent = `${rankProg.percent}%`;
      if (progressTarget) progressTarget.textContent = rankProg.nextTitle;

      // Achievements list (Goin' style)
      const achievementsList = document.getElementById("prof-achievements-list");
      if (achievementsList) {
        const vMap = {};
        if (Array.isArray(allVenues)) {
          allVenues.forEach(v => { vMap[v.id] = v; });
        }
        let unlockedCount = 0;
        achievementsList.innerHTML = PASSPORT_BADGES.map(badge => {
          let evaluation = { unlocked: false, progress: "0/1" };
          try {
            if (typeof badge.check === "function") {
              evaluation = badge.check(visitedVenues, vMap);
            }
          } catch (e) {}
          const isUnlocked = evaluation.unlocked;
          if (isUnlocked) unlockedCount++;

          return `
            <div class="achievement-card ${isUnlocked ? 'unlocked' : ''}">
              <div class="achievement-icon-bubble">
                <span>${isUnlocked ? (badge.icon || '🎖️') : '🔒'}</span>
              </div>
              <div class="achievement-info">
                <div class="achievement-title">${escapeHtml(badge.name)} ${isUnlocked ? '✅' : `<span style="font-size:0.72rem;opacity:0.75;font-weight:normal;">(${evaluation.progress})</span>`}</div>
                <div class="achievement-sub">${escapeHtml(badge.desc)}</div>
              </div>
            </div>
          `;
        }).join("");

        const countBadge = document.getElementById("prof-achievements-count");
        if (countBadge) {
          countBadge.textContent = `${unlockedCount}/${PASSPORT_BADGES.length}`;
        }
      }

      // Populate edit form
      const editUser = document.getElementById("edit-username");
      const editName = document.getElementById("edit-display-name");
      const editBio = document.getElementById("edit-bio");
      const editBeer = document.getElementById("edit-fav-beer");
      const editDist = document.getElementById("edit-fav-district");
      const editVibe = document.getElementById("edit-vibe-tags");

      if (editUser) editUser.value = currentProfile.username || "";
      if (editName) editName.value = currentProfile.display_name || "";
      if (editBio) editBio.value = currentProfile.bio || "";
      if (editBeer) editBeer.value = currentProfile.favorite_beer || "";
      if (editDist) editDist.value = currentProfile.favorite_district || "";
      if (editVibe) editVibe.value = currentProfile.vibe_tags || "";

      editSelectedPhoto = currentProfile.avatar_photo || null;
      editSelectedAvatar = currentProfile.avatar_icon || "🍺";
      updateEditModalAvatarPreview();
    }

    window.__openMyProfile = function () {
      if (!currentUser) {
        if (window.__openAuth) window.__openAuth();
        return;
      }
      renderMyProfile();
      if (modal) {
        modal.classList.add("active");
        modal.style.display = "flex";
      }
    };

    window.__closeMyProfile = function () {
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none";
      }
    };

    if (btnClose && modal) {
      btnClose.addEventListener("click", () => { window.__closeMyProfile(); });
      modal.addEventListener("click", (e) => {
        if (e.target === modal) window.__closeMyProfile();
      });
    }

    const btnCloseBottom = document.getElementById("btn-close-profile-bottom");
    if (btnCloseBottom) {
      btnCloseBottom.addEventListener("click", () => { window.__closeMyProfile(); });
    }

    const tagVibeWrap = document.getElementById("prof-tag-vibe-wrap");
    if (tagVibeWrap) {
      tagVibeWrap.style.cursor = "pointer";
      tagVibeWrap.title = "Kliknij, aby zagrać w Warszawski Pub Quiz!";
      tagVibeWrap.addEventListener("click", () => {
        window.__closeMyProfile();
        if (window.__openPubQuiz) window.__openPubQuiz();
      });
    }

    if (btnOpenCommFromProf) {
      btnOpenCommFromProf.addEventListener("click", () => {
        if (modal) { modal.classList.remove("active"); modal.style.display = "none"; }
        if (window.__openCommunity) window.__openCommunity();
      });
    }

    // Share profile helper function (reused by multiple buttons)
    function shareMyProfileLink() {
      if (!currentProfile) return;
      const url = `${window.location.origin}/#@${currentProfile.username}`;
      if (navigator.share) {
        navigator.share({ title: `${currentProfile.display_name || currentProfile.username} na poilepiwko`, url: url }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          showAppToast("Skopiowano link do profilu!", url, "📤");
        }).catch(() => {
          prompt("Skopiuj link do Twojego profilu:", url);
        });
      } else {
        prompt("Skopiuj link do Twojego profilu:", url);
      }
    }

    // Hero share button (prominent in profile)
    if (btnShareMyProfile) {
      btnShareMyProfile.addEventListener("click", shareMyProfileLink);
    }

    // Header share button (circle icon in goin-modal-header)
    const btnShareHeader = document.getElementById("btn-share-profile-header");
    if (btnShareHeader) {
      btnShareHeader.addEventListener("click", shareMyProfileLink);
    }

    // Bottom share button (in footer)
    const btnShareBottom = document.getElementById("btn-share-my-profile-bottom");
    if (btnShareBottom) {
      btnShareBottom.addEventListener("click", shareMyProfileLink);
    }

    // Search Friends button (in hero bar) — opens Community modal on "search" tab
    const btnSearchFriendsHero = document.getElementById("btn-search-friends-hero");
    if (btnSearchFriendsHero) {
      btnSearchFriendsHero.addEventListener("click", () => {
        if (modal) { modal.classList.remove("active"); modal.style.display = "none"; }
        if (window.__openCommunity) window.__openCommunity("search");
      });
    }

    // Story Card Button (in hero bar) — opens Instagram Story card modal
    const btnOpenStoryCard = document.getElementById("btn-open-story-card");
    if (btnOpenStoryCard) {
      btnOpenStoryCard.addEventListener("click", () => {
        if (window.__openStoryCardModal) {
          window.__openStoryCardModal();
        }
      });
    }

    // Collapsible Achievements Toggle
    const btnToggleAch = document.getElementById("btn-toggle-achievements");
    const achWrapper = document.getElementById("prof-achievements-wrapper");
    const achHint = document.getElementById("achievements-toggle-hint");

    if (btnToggleAch && achWrapper) {
      btnToggleAch.addEventListener("click", () => {
        const isExpanded = achWrapper.classList.toggle("expanded");
        btnToggleAch.classList.toggle("active", isExpanded);
        btnToggleAch.setAttribute("aria-expanded", String(isExpanded));
        if (achHint) achHint.textContent = isExpanded ? "Zwiń" : "Rozwiń";
      });
    }

    // Interactive Stats Grid Handlers
    const btnStatFriends = document.getElementById("prof-stat-btn-friends");
    if (btnStatFriends) {
      btnStatFriends.addEventListener("click", () => {
        window.__closeMyProfile();
        if (window.__openCommunity) window.__openCommunity();
      });
    }

    const btnStatBadges = document.getElementById("prof-stat-btn-badges");
    if (btnStatBadges) {
      btnStatBadges.addEventListener("click", () => {
        const achCard = document.getElementById("profile-achievements-card");
        if (achWrapper && !achWrapper.classList.contains("expanded")) {
          achWrapper.classList.add("expanded");
          if (btnToggleAch) {
            btnToggleAch.classList.add("active");
            btnToggleAch.setAttribute("aria-expanded", "true");
          }
          if (achHint) achHint.textContent = "Zwiń";
        }
        if (achCard) {
          achCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    }

    const btnStatFavs = document.getElementById("prof-stat-btn-favorites");
    if (btnStatFavs) {
      btnStatFavs.addEventListener("click", () => {
        window.__closeMyProfile();
        const favFilterBtn = document.querySelector('[data-filter="favorites"]');
        if (favFilterBtn) {
          favFilterBtn.click();
        } else if (typeof showAppToast === "function") {
          showAppToast("Twoje Ulubione ❤️", `Masz ${favoriteVenues.length} ulubionych lokali`, "⭐");
        }
      });
    }

    const btnStatVisited = document.getElementById("prof-stat-btn-visited");
    if (btnStatVisited) {
      btnStatVisited.addEventListener("click", () => {
        window.__closeMyProfile();
        const visitedFilterBtn = document.querySelector('[data-filter="visited"]');
        if (visitedFilterBtn) {
          visitedFilterBtn.click();
        } else if (typeof showAppToast === "function") {
          showAppToast("Odwiedzone bary 🍺", `Odwiedziłeś już ${visitedVenues.length} barów w Warszawie!`, "🍻");
        }
      });
    }

    // Edit Profile Modal functions
    window.__openEditProfileModal = function () {
      if (!currentProfile) return;
      const editUser = document.getElementById("edit-username");
      const editName = document.getElementById("edit-display-name");
      const editBio = document.getElementById("edit-bio");
      const editBeer = document.getElementById("edit-fav-beer");
      const editDist = document.getElementById("edit-fav-district");
      const editVibe = document.getElementById("edit-vibe-tags");

      if (editUser) editUser.value = currentProfile.username || "";
      if (editName) editName.value = currentProfile.display_name || "";
      if (editBio) editBio.value = currentProfile.bio || "";
      if (editBeer) editBeer.value = currentProfile.favorite_beer || "";
      if (editDist) editDist.value = currentProfile.favorite_district || "";
      if (editVibe) editVibe.value = currentProfile.vibe_tags || "";

      editSelectedPhoto = currentProfile.avatar_photo || null;
      editSelectedAvatar = currentProfile.avatar_icon || "🍺";
      updateEditModalAvatarPreview();

      if (editModal) {
        editModal.classList.add("active");
        editModal.style.display = "flex";
      }
    };

    window.__closeEditProfileModal = function () {
      if (editModal) {
        editModal.classList.remove("active");
        editModal.style.display = "none";
      }
    };

    if (btnToggleEdit) {
      btnToggleEdit.addEventListener("click", () => {
        window.__openEditProfileModal();
      });
    }
    if (btnCloseEdit) {
      btnCloseEdit.addEventListener("click", () => {
        window.__closeEditProfileModal();
      });
    }
    if (btnCancelEdit) {
      btnCancelEdit.addEventListener("click", () => {
        window.__closeEditProfileModal();
      });
    }
    if (editModal) {
      editModal.addEventListener("click", (e) => {
        if (e.target === editModal) window.__closeEditProfileModal();
      });
    }

    // Edit Profile Photo Uploader Handlers
    const editFileInput = document.getElementById("edit-avatar-file-input");
    const btnChoosePhoto = document.getElementById("btn-choose-photo");
    const btnTriggerBadge = document.getElementById("btn-trigger-photo-badge");
    const btnRemovePhoto = document.getElementById("btn-remove-profile-photo");

    if (btnChoosePhoto && editFileInput) {
      btnChoosePhoto.addEventListener("click", () => editFileInput.click());
    }
    if (btnTriggerBadge && editFileInput) {
      btnTriggerBadge.addEventListener("click", () => editFileInput.click());
    }
    if (editFileInput) {
      editFileInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) {
          showAppToast("Błąd", "Wybierz plik graficzny (JPG, PNG itp.).", "⚠️");
          return;
        }
        if (file.size > 15 * 1024 * 1024) {
          showAppToast("Za duży plik", "Maksymalny rozmiar zdjęcia to 15MB.", "⚠️");
          return;
        }
        try {
          const croppedDataUrl = await cropAndCompressAvatarPhoto(file, 240, 0.84);
          if (croppedDataUrl) {
            editSelectedPhoto = croppedDataUrl;
            updateEditModalAvatarPreview();
            showAppToast("Zdjęcie wczytane!", "Kliknij 'Zapisz zmiany', aby zastosować.", "📷");
          }
        } catch (cropErr) {
          console.warn("Avatar crop error:", cropErr);
          showAppToast("Błąd", "Nie udało się przetworzyć zdjęcia.", "⚠️");
        }
        editFileInput.value = "";
      });
    }

    if (btnRemovePhoto) {
      btnRemovePhoto.addEventListener("click", () => {
        editSelectedPhoto = null;
        updateEditModalAvatarPreview();
        showAppToast("Zdjęcie usunięte", "Twój profil będzie używać piwnego awatara.", "🍺");
      });
    }

    // Edit Avatar Picker (Emoji fallback/alternative)
    if (editAvatarPicker) {
      const btns = editAvatarPicker.querySelectorAll(".avatar-option");
      btns.forEach(btn => {
        btn.addEventListener("click", () => {
          editSelectedAvatar = btn.getAttribute("data-avatar") || "🍺";
          editSelectedPhoto = null;
          updateEditModalAvatarPreview();
        });
      });
    }

    // Form Edit Submit
    if (formEdit) {
      formEdit.addEventListener("submit", async (e) => {
        e.preventDefault();
        const editUserInput = document.getElementById("edit-username");
        const editUsername = editUserInput ? editUserInput.value.trim().toLowerCase().replace(/^@/, "") : "";
        const editName = document.getElementById("edit-display-name").value.trim();
        const editBio = document.getElementById("edit-bio").value.trim();
        const editBeer = document.getElementById("edit-fav-beer").value.trim();
        const editDist = document.getElementById("edit-fav-district").value.trim();
        const editVibeInput = document.getElementById("edit-vibe-tags");
        const editVibeTags = editVibeInput ? editVibeInput.value.trim() : "";

        if (window.ProfanityFilter) {
          if (editUsername && (!currentProfile || editUsername !== currentProfile.username)) {
            const uVal = window.ProfanityFilter.validateUsername(editUsername);
            if (!uVal.valid) {
              showAppToast("Niedozwolony nick", uVal.error, "⚠️");
              if (editUserInput) editUserInput.focus();
              return;
            }
          }
          if (editName) {
            const dVal = window.ProfanityFilter.validateDisplayName(editName);
            if (!dVal.valid) {
              showAppToast("Niedozwolona nazwa", dVal.error, "⚠️");
              const nameEl = document.getElementById("edit-display-name");
              if (nameEl) nameEl.focus();
              return;
            }
          }
          if (editBio) {
            const bVal = window.ProfanityFilter.validateBio(editBio);
            if (!bVal.valid) {
              showAppToast("Niedozwolony opis", bVal.error, "⚠️");
              const bioEl = document.getElementById("edit-bio");
              if (bioEl) bioEl.focus();
              return;
            }
          }
        }

        if (editUsername && currentProfile && editUsername !== currentProfile.username) {
          try {
            const uRes = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "set-username",
                payload: {
                  userId: currentUser.id,
                  username: editUsername,
                  displayName: editName,
                  avatarIcon: editSelectedAvatar,
                  avatarPhoto: editSelectedPhoto || "",
                  bio: editBio,
                  favoriteBeer: editBeer,
                  favoriteDistrict: editDist,
                  vibeTags: editVibeTags
                }
              })
            });
            const uData = await uRes.json();
            if (uRes.ok && uData.success) {
              currentProfile.username = editUsername;
            } else {
              showAppToast("Uwaga", uData.error || "Nie udało się zmienić nicku.", "⚠️");
              return;
            }
          } catch (err) {
            console.warn("Change username error:", err);
            return;
          }
        }

        syncUserDataToCloud({
          displayName: editName,
          avatarIcon: editSelectedAvatar,
          avatarPhoto: editSelectedPhoto || "",
          bio: editBio,
          favoriteBeer: editBeer,
          favoriteDistrict: editDist,
          vibeTags: editVibeTags
        });

        if (currentProfile) {
          currentProfile.display_name = editName;
          currentProfile.avatar_icon = editSelectedAvatar;
          currentProfile.avatar_photo = editSelectedPhoto || null;
          currentProfile.bio = editBio;
          currentProfile.favorite_beer = editBeer;
          currentProfile.favorite_district = editDist;
          currentProfile.vibe_tags = editVibeTags;
          if (currentUser) {
            localStorage.setItem("poilepiwko_user_avatar_photo_" + currentUser.id, editSelectedPhoto || "");
            if (supabaseClient && supabaseClient.auth) {
              supabaseClient.auth.updateUser({
                data: {
                  avatar_photo: editSelectedPhoto || "",
                  avatar_icon: editSelectedAvatar,
                  display_name: editName
                }
              }).catch(() => {});
            }
          }
        }

        renderMyProfile();
        updateAuthUI();
        window.__closeEditProfileModal();
        showAppToast("Profil zaktualizowany!", "Nowe dane są już widoczne dla znajomych.", "✨");
      });
    }

    // Logout
    if (btnLogout) {
      btnLogout.addEventListener("click", async () => {
        if (!confirm("Czy na pewno chcesz się wylogować?")) return;
        try {
          if (supabaseClient && supabaseClient.auth) {
            await supabaseClient.auth.signOut();
          }
        } catch (e) {}
        currentUser = null;
        currentProfile = null;
        myFollowingIds = [];
        myNotifications = [];
        unreadNotificationsCount = 0;
        knownNotificationIds.clear();
        updateAuthUI();
        if (modal) modal.style.display = "none";
        showAppToast("Wylogowano.", "Do zobaczenia na mieście!", "👋");
      });
    }

    // Account Deletion (Apple Guideline 5.1.1(v) Compliance)
    const btnDeleteTrigger = document.getElementById("btn-delete-account-trigger");
    const deleteModal = document.getElementById("delete-account-modal");
    const btnCloseDelete = document.getElementById("btn-close-delete-account-modal");
    const btnCancelDelete = document.getElementById("btn-cancel-delete-account");
    const btnConfirmDelete = document.getElementById("btn-confirm-delete-account");
    const inputConfirmDelete = document.getElementById("input-confirm-delete-account");

    function openDeleteAccountModal() {
      if (!deleteModal) return;
      if (inputConfirmDelete) inputConfirmDelete.value = "";
      if (btnConfirmDelete) {
        btnConfirmDelete.disabled = true;
        btnConfirmDelete.innerHTML = "<span>🗑️ Trwale usuń moje konto</span>";
      }
      deleteModal.style.display = "flex";
    }

    function closeDeleteAccountModal() {
      if (!deleteModal) return;
      deleteModal.style.display = "none";
      if (inputConfirmDelete) inputConfirmDelete.value = "";
    }

    if (btnDeleteTrigger) {
      btnDeleteTrigger.addEventListener("click", () => {
        if (!currentUser) {
          showAppToast("Zaloguj się", "Musisz być zalogowany, aby zarządzać kontem.", "👤");
          return;
        }
        openDeleteAccountModal();
      });
    }

    if (btnCloseDelete) btnCloseDelete.addEventListener("click", closeDeleteAccountModal);
    if (btnCancelDelete) btnCancelDelete.addEventListener("click", closeDeleteAccountModal);
    if (deleteModal) {
      deleteModal.addEventListener("click", (e) => {
        if (e.target === deleteModal) closeDeleteAccountModal();
      });
    }

    if (inputConfirmDelete && btnConfirmDelete) {
      inputConfirmDelete.addEventListener("input", () => {
        const val = inputConfirmDelete.value.trim().toUpperCase();
        btnConfirmDelete.disabled = (val !== "USUŃ" && val !== "USUN");
      });
    }

    if (btnConfirmDelete) {
      btnConfirmDelete.addEventListener("click", async () => {
        if (!currentUser) return;
        const targetUserId = currentUser.id;
        btnConfirmDelete.disabled = true;
        btnConfirmDelete.innerHTML = "<span>⏳ Usuwanie konta z bazy...</span>";

        try {
          // 1. Send delete-account request to backend API (Supabase Admin)
          await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "delete-account",
              payload: { userId: targetUserId }
            })
          }).catch(e => console.warn("Backend delete note:", e));

          // 2. Sign out from Supabase Auth
          if (supabaseClient && supabaseClient.auth) {
            await supabaseClient.auth.signOut().catch(() => {});
          }

          // 3. Clear all local storage belonging to this user
          try {
            localStorage.removeItem("poilepiwko_user_avatar_photo_" + targetUserId);
            localStorage.removeItem("poilepiwko_user_badges");
            localStorage.removeItem("poilepiwko_my_reviews");
            localStorage.removeItem("warsaw_user_venues");
            localStorage.removeItem("warsaw_visited_venues");
            localStorage.removeItem("warsaw_favorite_venues");
            localStorage.removeItem("poilepiwko_ice_contact");
          } catch (e) {}

          currentUser = null;
          currentProfile = null;
          visitedVenues = [];
          favoriteVenues = [];
          myFollowingIds = [];
          myNotifications = [];
          unreadNotificationsCount = 0;
          knownNotificationIds.clear();

          updateAuthUI();
          updatePassportCounters();
          updateFavoriteCounters();

          closeDeleteAccountModal();
          if (modal) modal.style.display = "none";

          showAppToast("Konto zostało usunięte", "Wszystkie Twoje dane zostały bezpowrotnie wykasowane.", "🗑️", 5000);
        } catch (err) {
          console.error("Account deletion failed:", err);
          showAppToast("Wystąpił błąd", "Spróbuj ponownie lub skontaktuj się z administratorem.", "⚠️");
          btnConfirmDelete.disabled = false;
          btnConfirmDelete.innerHTML = "<span>🗑️ Trwale usuń moje konto</span>";
        }
      });
    }
  }

  function initCommunityModal() {
    const modal = document.getElementById("community-modal");
    const btnClose = document.getElementById("btn-close-community");

    // 4 Modern Tabs
    const tabFriends = document.getElementById("tab-comm-friends") || document.getElementById("tab-comm-search");
    const tabMap = document.getElementById("tab-comm-map");
    const tabFeed = document.getElementById("tab-comm-feed");
    const tabNotifications = document.getElementById("tab-comm-notifications");

    // 4 Modern Panes
    const paneFriends = document.getElementById("pane-comm-friends") || document.getElementById("pane-comm-search");
    const paneMap = document.getElementById("pane-comm-map");
    const paneFeed = document.getElementById("pane-comm-feed");
    const paneNotifications = document.getElementById("pane-comm-notifications");

    // Controls
    const searchInput = document.getElementById("input-search-friends");
    const btnRunSearch = document.getElementById("btn-run-search-friends");
    const searchResults = document.getElementById("comm-search-results");
    const followingList = document.getElementById("comm-following-list");
    const recommendedList = document.getElementById("comm-recommended-list");
    const notifList = document.getElementById("comm-notifications-list");
    const feedGrid = document.getElementById("comm-feed-grid");
    const feedFileInput = document.getElementById("feed-photo-file-input");
    const btnAddPhoto = document.getElementById("btn-add-feed-photo");
    const btnCheckinDirect = document.getElementById("btn-open-checkin-direct");

    // QR Share & Referral Elements
    const qrModal = document.getElementById("qr-share-modal");
    const qrCloseBtn = document.getElementById("btn-close-qr-modal");
    const qrImage = document.getElementById("qr-code-image");
    const qrHandle = document.getElementById("qr-code-handle");
    const btnCopyQrLink = document.getElementById("btn-copy-qr-link");
    const btnShowQr = document.getElementById("btn-show-qr-code");
    const btnHeaderQr = document.getElementById("btn-header-qr-code");
    const btnCopyInviteLink = document.getElementById("btn-copy-invite-link");
    const btnCopyRefLink = document.getElementById("btn-copy-ref-link");
    const inputRefLink = document.getElementById("input-referral-link");

    // State
    let currentCommunityTab = "friends";
    let friendsMapInstance = null;
    let friendsMarkersLayer = null;

    function getInviteUrl() {
      const myHandle = (currentUser && currentUser.user_metadata && currentUser.user_metadata.username)
        || (currentUser ? currentUser.id.slice(0, 8) : "ekipa");
      return `https://poilepiwko.pl/?ref=${encodeURIComponent(myHandle)}`;
    }

    function switchTab(tab) {
      currentCommunityTab = tab;
      const allTabs = [tabFriends, tabMap, tabFeed, tabNotifications];
      const allPanes = [paneFriends, paneMap, paneFeed, paneNotifications];

      allTabs.forEach(t => t && t.classList.remove("active"));
      allPanes.forEach(p => p && (p.style.display = "none"));

      if (tab === "map") {
        if (tabMap) tabMap.classList.add("active");
        if (paneMap) paneMap.style.display = "block";
        setTimeout(() => { initFriendsMap(); }, 80);
      } else if (tab === "feed") {
        if (tabFeed) tabFeed.classList.add("active");
        if (paneFeed) paneFeed.style.display = "block";
        loadLiveBarFeed();
      } else if (tab === "notifications") {
        if (tabNotifications) tabNotifications.classList.add("active");
        if (paneNotifications) paneNotifications.style.display = "block";
        renderNotificationsList();
        markNotificationsAsRead();
        requestBrowserNotificationPermission();
        if (inputRefLink) inputRefLink.value = getInviteUrl();
      } else {
        // default "friends"
        if (tabFriends) tabFriends.classList.add("active");
        if (paneFriends) paneFriends.style.display = "block";
        loadFollowingList();
        loadRecommendedFriends();
      }
    }

    if (tabFriends) tabFriends.addEventListener("click", () => switchTab("friends"));
    if (tabMap) tabMap.addEventListener("click", () => switchTab("map"));
    if (tabFeed) tabFeed.addEventListener("click", () => switchTab("feed"));
    if (tabNotifications) tabNotifications.addEventListener("click", () => switchTab("notifications"));

    // Legacy aliases
    const tabSearchLegacy = document.getElementById("tab-comm-search");
    if (tabSearchLegacy && tabSearchLegacy !== tabFriends) {
      tabSearchLegacy.addEventListener("click", () => switchTab("friends"));
    }
    const tabFollowingLegacy = document.getElementById("tab-comm-following");
    if (tabFollowingLegacy) {
      tabFollowingLegacy.addEventListener("click", () => switchTab("friends"));
    }

    window.__openCommunity = function (initialTab) {
      if (modal) {
        modal.classList.add("active");
        modal.style.display = "flex";
      }
      const navCommBtn = document.getElementById("nav-btn-community");
      if (navCommBtn) {
        if (window.__clearBottomNavActive) window.__clearBottomNavActive();
        navCommBtn.classList.add("active");
      }
      const commFollowingBadge = document.getElementById("comm-following-badge");
      if (commFollowingBadge) commFollowingBadge.textContent = myFollowingIds.length;
      updateNotificationBadges();

      const defaultTab = (typeof unreadNotificationsCount === "number" && unreadNotificationsCount > 0)
        ? "notifications"
        : (initialTab || "friends");
      switchTab(defaultTab);
    };

    window.__closeCommunity = function () {
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none";
      }
      if (window.__clearBottomNavActive) window.__clearBottomNavActive();
    };

    if (btnClose) {
      btnClose.addEventListener("click", () => { window.__closeCommunity(); });
    }

    // -------------------------------------------------------------------------
    // QR Code & Referral Link Sharing
    // -------------------------------------------------------------------------
    function copyTextToClipboard(text, successMsg) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          showAppToast("Skopiowano link!", successMsg || "Wklej link znajomym na Messengerze lub WhatsAppie 🍻", "🔗");
        }).catch(() => {
          prompt("Skopiuj link poniżej:", text);
        });
      } else {
        prompt("Skopiuj link poniżej:", text);
      }
    }

    if (btnCopyInviteLink) {
      btnCopyInviteLink.addEventListener("click", () => {
        copyTextToClipboard(getInviteUrl(), "Zaproś znajomych do ekipy na piwo!");
      });
    }

    if (btnCopyRefLink) {
      btnCopyRefLink.addEventListener("click", () => {
        copyTextToClipboard(getInviteUrl(), "Link skopiowany! Wyślij go ekipie 🍻");
      });
    }

    function openQrModal() {
      const url = getInviteUrl();
      const myHandle = (currentUser && currentUser.user_metadata && currentUser.user_metadata.username) || "piwosz";
      if (qrImage) {
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
      }
      if (qrHandle) qrHandle.textContent = `@${myHandle}`;
      if (qrModal) qrModal.style.display = "flex";
    }

    if (btnShowQr) btnShowQr.addEventListener("click", openQrModal);
    if (btnHeaderQr) btnHeaderQr.addEventListener("click", openQrModal);

    if (qrCloseBtn && qrModal) {
      qrCloseBtn.addEventListener("click", () => { qrModal.style.display = "none"; });
      qrModal.addEventListener("click", (e) => {
        if (e.target === qrModal) qrModal.style.display = "none";
      });
    }

    if (btnCopyQrLink) {
      btnCopyQrLink.addEventListener("click", () => {
        copyTextToClipboard(getInviteUrl(), "Link z kodem QR skopiowany!");
      });
    }

    // -------------------------------------------------------------------------
    // Tab 1: Search Friends strictly by Nick / Username
    // -------------------------------------------------------------------------
    async function searchFriends() {
      const rawQ = searchInput ? searchInput.value.trim() : "";
      const q = rawQ.replace(/^@/, "").trim();
      if (!q) {
        if (searchResults) searchResults.style.display = "none";
        return;
      }
      if (searchResults) {
        searchResults.style.display = "flex";
        searchResults.innerHTML = `<div class="loading-state-hint">Szukanie nicku @${escapeHtml(q)}... 🔍</div>`;
      }

      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "search-users",
            payload: { query: q }
          })
        });

        const data = await res.json();
        if (!res.ok || !data.users || data.users.length === 0) {
          if (searchResults) {
            searchResults.innerHTML = `<div class="empty-state-hint">Nie znaleziono piwosza o nicku "@${escapeHtml(q)}".<br><small style="opacity:0.75;margin-top:4px;display:inline-block;">Upewnij się, że wpisujesz unikalny nick profilu (np. @piwosz).</small></div>`;
          }
          return;
        }

        if (searchResults) {
          searchResults.innerHTML = data.users.map(u => {
            const isMe = currentUser && currentUser.id === u.id;
            const isFollowing = myFollowingIds.includes(u.id);
            const visitedCount = Array.isArray(u.visited_venues) ? u.visited_venues.length : 0;
            const avatarHtml = u.avatar_photo
              ? `<img src="${escapeHtml(u.avatar_photo)}" class="user-card-photo" alt="Avatar" />`
              : escapeHtml(u.avatar_icon || "🍺");

            return `
              <div class="user-search-card">
                <div class="user-card-avatar" onclick="window.__openUserProfile('${escapeHtml(u.username)}')">${avatarHtml}</div>
                <div class="user-card-info" onclick="window.__openUserProfile('${escapeHtml(u.username)}')">
                  <div class="user-card-name">${escapeHtml(u.display_name || u.username)}</div>
                  <div class="user-card-handle">@${escapeHtml(u.username)} • <span>🎖️ ${visitedCount} lokali</span></div>
                  ${u.bio ? `<div class="user-card-bio">${escapeHtml(u.bio)}</div>` : ""}
                </div>
                <div class="user-card-action">
                  ${isMe ? `<span class="badge-me">To Ty</span>` : `
                    <button type="button" class="btn-follow-toggle ${isFollowing ? "following" : ""}" data-user-id="${u.id}" onclick="window.__toggleFollowUser('${u.id}', this)">
                      ${isFollowing ? "✓ Obserwujesz" : "➕ Obserwuj"}
                    </button>
                  `}
                </div>
              </div>
            `;
          }).join("");
        }
      } catch (err) {
        if (searchResults) searchResults.innerHTML = `<div class="error-state-hint">Błąd podczas wyszukiwania.</div>`;
      }
    }

    if (btnRunSearch) btnRunSearch.addEventListener("click", searchFriends);
    if (searchInput) {
      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          searchFriends();
        }
      });
      searchInput.addEventListener("input", () => {
        if (!searchInput.value.trim() && searchResults) {
          searchResults.style.display = "none";
        }
      });
    }

    // Load Following List
    async function loadFollowingList() {
      if (!followingList) return;
      if (!currentUser) {
        followingList.innerHTML = `
          <div class="empty-state-card">
            <div class="empty-icon">🔒</div>
            <div class="empty-title">Zaloguj się</div>
            <p class="empty-sub">Zaloguj się na swoje konto, aby widzieć listę obserwowanych piwoszy!</p>
          </div>
        `;
        return;
      }

      if (myFollowingIds.length === 0) {
        followingList.innerHTML = `
          <div class="empty-state-card">
            <div class="empty-icon">👥</div>
            <div class="empty-title">Nie obserwujesz jeszcze nikogo</div>
            <p class="empty-sub">Wyszukaj znajomego powyżej, zaobserwuj polecanych poniżej lub zaproś ekipę!</p>
          </div>
        `;
        return;
      }

      followingList.innerHTML = `<div class="loading-state-hint">Ładowanie listy znajomych... 🍻</div>`;

      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get-following",
            payload: { userId: currentUser.id, userIds: myFollowingIds }
          })
        });
        const data = await res.json();
        if (Array.isArray(data.followingIds)) {
          myFollowingIds = data.followingIds;
          const commFollowingBadge = document.getElementById("comm-following-badge");
          if (commFollowingBadge) commFollowingBadge.textContent = myFollowingIds.length;
        }

        const users = data.users || [];
        if (users.length === 0) {
          followingList.innerHTML = `
            <div class="empty-state-card">
              <div class="empty-icon">👥</div>
              <div class="empty-title">Brak obserwowanych</div>
              <p class="empty-sub">Dodaj piwoszy z listy poniżej!</p>
            </div>
          `;
          return;
        }

        followingList.innerHTML = users.map(u => {
          const visitedCount = Array.isArray(u.visited_venues) ? u.visited_venues.length : 0;
          const avatarHtml = u.avatar_photo
            ? `<img src="${escapeHtml(u.avatar_photo)}" class="user-card-photo" alt="Avatar" />`
            : escapeHtml(u.avatar_icon || "🍺");

          return `
            <div class="user-search-card">
              <div class="user-card-avatar" onclick="window.__openUserProfile('${escapeHtml(u.username)}')">${avatarHtml}</div>
              <div class="user-card-info" onclick="window.__openUserProfile('${escapeHtml(u.username)}')">
                <div class="user-card-name">${escapeHtml(u.display_name || u.username)}</div>
                <div class="user-card-handle">@${escapeHtml(u.username)} • <span>🎖️ ${visitedCount} lokali</span></div>
                ${u.bio ? `<div class="user-card-bio">${escapeHtml(u.bio)}</div>` : ""}
              </div>
              <div class="user-card-action">
                <button type="button" class="btn-follow-toggle following" data-user-id="${u.id}" onclick="window.__toggleFollowUser('${u.id}', this)">
                  ✓ Obserwujesz
                </button>
              </div>
            </div>
          `;
        }).join("");
      } catch (err) {
        followingList.innerHTML = `<div class="error-state-hint">Nie udało się załadować listy obserwowanych.</div>`;
      }
    }

    // Load Recommended Friends (Popularni teraz w Warszawie)
    async function loadRecommendedFriends() {
      if (!recommendedList) return;
      recommendedList.innerHTML = `<div class="loading-state-hint" style="padding:10px;">Szukanie aktywnych piwoszy... 🍻</div>`;

      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get-recommended-users",
            payload: { userId: currentUser ? currentUser.id : null }
          })
        });
        const data = await res.json();
        const users = data.users || [];

        if (users.length === 0) {
          recommendedList.innerHTML = `<div class="empty-state-hint" style="padding:12px;">Wszyscy aktywni piwosze są już w Twojej ekipie! 👑</div>`;
          return;
        }

        recommendedList.innerHTML = users.slice(0, 6).map(u => {
          const avatarHtml = u.avatar_photo
            ? `<img src="${escapeHtml(u.avatar_photo)}" alt="Avatar" />`
            : escapeHtml(u.avatar_icon || "🍺");
          const isFollowing = myFollowingIds.includes(u.id);

          return `
            <div class="recommended-user-card">
              <div class="rec-user-left" onclick="window.__openUserProfile('${escapeHtml(u.username)}')">
                <div class="rec-user-avatar">${avatarHtml}</div>
                <div class="rec-user-info">
                  <div class="rec-user-name">${escapeHtml(u.display_name || u.username)}</div>
                  <div class="rec-user-meta">
                    <span>@${escapeHtml(u.username)}</span>
                    <span class="rec-user-badge">${escapeHtml(u.popular_badge || "🔥 Aktywny")}</span>
                  </div>
                </div>
              </div>
              <div>
                <button type="button" class="btn-follow-toggle ${isFollowing ? "following" : ""}" data-user-id="${u.id}" onclick="window.__toggleFollowUser('${u.id}', this)" style="padding: 6px 12px; font-size: 0.76rem;">
                  ${isFollowing ? "✓ W ekipie" : "➕ Obserwuj"}
                </button>
              </div>
            </div>
          `;
        }).join("");
      } catch (e) {
        recommendedList.innerHTML = `<div class="empty-state-hint">Nie udało się załadować polecanych.</div>`;
      }
    }

    // -------------------------------------------------------------------------
    // Tab 2: 24h Live Friends Map ("Puls Warszawy")
    // -------------------------------------------------------------------------
    let friendsMapTileLayer = null;

    window.__updateFriendsMapTheme = function(isLight) {
      if (friendsMapTileLayer) {
        const cartoKey = (typeof MAP_CONFIG !== "undefined" && MAP_CONFIG.cartoApiKey) ? `?key=${MAP_CONFIG.cartoApiKey}` : "";
        const variant = isLight ? "rastertiles/voyager" : "dark_all";
        friendsMapTileLayer.setUrl(`https://{s}.basemaps.cartocdn.com/${variant}/{z}/{x}/{y}{r}.png${cartoKey}`);
      }
    };

    async function initFriendsMap() {
      const container = document.getElementById("friends-map-container");
      if (!container || typeof L === "undefined") return;

      const cartoKey = (typeof MAP_CONFIG !== "undefined" && MAP_CONFIG.cartoApiKey) ? `?key=${MAP_CONFIG.cartoApiKey}` : "";
      const isLight = document.body.classList.contains("theme-light");
      const mapVariant = isLight ? "rastertiles/voyager" : "dark_all";

      if (!friendsMapInstance) {
        friendsMapInstance = L.map("friends-map-container", {
          zoomControl: false,
          attributionControl: false,
          dragging: false,
          touchZoom: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false
        }).setView([52.232, 21.018], 13);

        friendsMapTileLayer = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${mapVariant}/{z}/{x}/{y}{r}.png${cartoKey}`, {
          maxZoom: 19
        }).addTo(friendsMapInstance);

        friendsMarkersLayer = L.layerGroup().addTo(friendsMapInstance);
      } else {
        if (friendsMapTileLayer) {
          friendsMapTileLayer.setUrl(`https://{s}.basemaps.cartocdn.com/${mapVariant}/{z}/{x}/{y}{r}.png${cartoKey}`);
        }
        if (friendsMapInstance.dragging) friendsMapInstance.dragging.disable();
        if (friendsMapInstance.touchZoom) friendsMapInstance.touchZoom.disable();
      }

      friendsMapInstance.invalidateSize();

      const statusSummary = document.getElementById("friends-map-summary");
      const hotspotsList = document.getElementById("hotspots-quick-list");

      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get-friends-map-checkins",
            payload: { userId: currentUser ? currentUser.id : null }
          })
        });

        const data = await res.json();
        if (friendsMarkersLayer) friendsMarkersLayer.clearLayers();

        const activeFriends = data.activeFriends || [];
        const hotspots = data.hotspots || [];

        // 1. Add active friends markers
        activeFriends.forEach(f => {
          if (!f.latitude || !f.longitude) return;
          const friendIcon = L.divIcon({
            className: "friend-live-pin",
            html: `
              <div style="width:38px;height:38px;border-radius:50%;background:#ff5722;border:2.5px solid #ffffff;box-shadow:0 0 12px rgba(255,87,34,0.8);display:flex;align-items:center;justify-content:center;font-size:18px;overflow:hidden;cursor:pointer;">
                ${f.avatar_photo ? `<img src="${escapeHtml(f.avatar_photo)}" style="width:100%;height:100%;object-fit:cover;" />` : (f.avatar_icon || "🍺")}
              </div>
            `,
            iconSize: [38, 38],
            iconAnchor: [19, 19]
          });

          const timeAgo = formatTimeAgo(f.timestamp);
          const popupContent = `
            <div class="fmap-popup-card">
              <strong class="fmap-popup-friend-name">${escapeHtml(f.display_name)}</strong>
              <div class="fmap-popup-sub">@${escapeHtml(f.username)} • ${timeAgo}</div>
              <div class="fmap-popup-venue">📍 ${escapeHtml(f.venue_name || "Lokal")}</div>
              ${f.beer_name ? `<div class="fmap-popup-beer">🍺 ${escapeHtml(f.beer_name)} (${f.beer_price || 12} zł)</div>` : ""}
            </div>
          `;

          const m = L.marker([f.latitude, f.longitude], { icon: friendIcon }).bindPopup(popupContent);
          friendsMarkersLayer.addLayer(m);
        });

        // 2. Add Warsaw party hotspots
        hotspots.forEach(h => {
          const hotspotIcon = L.divIcon({
            className: "hotspot-live-pin",
            html: `
              <div style="background:linear-gradient(135deg, #ef4444, #ea580c);color:#ffffff;font-size:11px;font-weight:900;padding:4px 9px;border-radius:999px;border:2px solid #ffffff;box-shadow:0 3px 12px rgba(239,68,68,0.7);display:inline-flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;">
                🔥 ${h.count}
              </div>
            `,
            iconSize: [44, 24],
            iconAnchor: [22, 12]
          });

          const popupContent = `
            <div class="fmap-popup-card">
              <div class="fmap-popup-badge">🔥 GORĄCY REJON</div>
              <strong class="fmap-popup-name">${escapeHtml(h.name)}</strong>
              <div class="fmap-popup-vibe">${escapeHtml(h.vibe)}</div>
              <div class="fmap-popup-count">~${h.count} piwoszy w ciągu 24h</div>
            </div>
          `;

          const hm = L.marker(h.coords, { icon: hotspotIcon }).bindPopup(popupContent);
          friendsMarkersLayer.addLayer(hm);
        });

        // Update status summary text
        if (statusSummary) {
          if (activeFriends.length > 0) {
            statusSummary.innerHTML = `<strong>${activeFriends.length} znajomych</strong> z Twojej ekipy pije w Warszawie • ${hotspots.length} gorących stref`;
          } else {
            statusSummary.innerHTML = `Twoi znajomi jeszcze nie zrobili check-inu w 24h • <strong>${hotspots.length} stref</strong> tętni życiem w Warszawie!`;
          }
        }

        // Render Hotspots Cards
        if (hotspotsList) {
          hotspotsList.innerHTML = hotspots.map(h => `
            <div class="hotspot-chip-card" onclick="window.__flyToHotspot(${h.coords[0]}, ${h.coords[1]})">
              <div class="hotspot-card-top">
                <span class="hotspot-name">${escapeHtml(h.name)}</span>
                <span class="hotspot-count-pill">🔥 ${h.count}</span>
              </div>
              <div class="hotspot-vibe">${escapeHtml(h.vibe)}</div>
            </div>
          `).join("");
        }
      } catch (err) {
        console.warn("Friends map load error:", err);
      }
    }

    window.__flyToHotspot = function (lat, lng) {
      if (friendsMapInstance) {
        friendsMapInstance.flyTo([lat, lng], 15, { duration: 1.2 });
      }
    };

    // Direct check-in button
    if (btnCheckinDirect) {
      btnCheckinDirect.addEventListener("click", () => {
        if (!currentUser) {
          showAppToast("Zaloguj się!", "Zaloguj się, aby zameldować się w lokalu 🍻", "🔒");
          const authModal = document.getElementById("auth-modal");
          if (authModal) authModal.style.display = "flex";
          return;
        }

        // Find nearest venue or open report/checkin prompt
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = pos.coords.latitude;
              const lng = pos.coords.longitude;
              let nearest = null;
              let minDist = Infinity;
              (allVenues || []).forEach(v => {
                if (!v.latitude || !v.longitude) return;
                const d = Math.hypot(v.latitude - lat, v.longitude - lng);
                if (d < minDist) {
                  minDist = d;
                  nearest = v;
                }
              });

              if (nearest && minDist < 0.03) { // ~3km
                fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "record-checkin",
                    payload: {
                      userId: currentUser.id,
                      venueId: nearest.id,
                      venueName: nearest.name,
                      district: nearest.district,
                      beerName: nearest.beer_name,
                      beerPrice: nearest.beer_price_pln,
                      latitude: nearest.latitude,
                      longitude: nearest.longitude
                    }
                  })
                }).then(() => {
                  showAppToast("Zameldowano!", `Jesteś w: ${nearest.name}! 🍻`, "📍");
                  initFriendsMap();
                });
              } else {
                showAppToast("Wybierz lokal na mapie", "Kliknij dowolny lokal na mapie i wciśnij „Odwiedź”, aby się zameldować.", "📍");
                window.__closeCommunity();
              }
            },
            () => {
              showAppToast("Wybierz lokal na mapie", "Kliknij dowolny lokal na mapie i wciśnij „Odwiedź”, aby się zameldować.", "📍");
              window.__closeCommunity();
            },
            { timeout: 6000 }
          );
        } else {
          showAppToast("Wybierz lokal na mapie", "Kliknij dowolny lokal na mapie i wciśnij „Odwiedź”, aby się zameldować.", "📍");
          window.__closeCommunity();
        }
      });
    }

    // -------------------------------------------------------------------------
    // Tab 3: BeReal-Style Live Bar Feed (Dual photo grid & cheers 🍻)
    // -------------------------------------------------------------------------
    async function loadLiveBarFeed() {
      if (!feedGrid) return;
      feedGrid.innerHTML = `<div class="loading-state-hint" style="grid-column: 1 / -1; padding: 24px;">Ładowanie najświeższych fotek z warszawskich barów... 📸</div>`;

      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get-live-feed" })
        });
        const data = await res.json();
        const feed = data.feed || [];

        let blockedUsers = [];
        try {
          blockedUsers = JSON.parse(localStorage.getItem("poilepiwko_blocked_users") || "[]");
          if (!Array.isArray(blockedUsers)) blockedUsers = [];
        } catch (e) {
          blockedUsers = [];
        }

        const visibleFeed = feed.filter(item => {
          if (!item) return false;
          if (item.author_id && blockedUsers.includes(item.author_id)) return false;
          if (item.author_name && blockedUsers.includes(item.author_name)) return false;
          return true;
        });

        if (visibleFeed.length === 0) {
          feedGrid.innerHTML = `
            <div class="empty-state-card" style="grid-column: 1 / -1;">
              <div class="empty-icon">📸</div>
              <div class="empty-title">Pusto z ostatnich 24h</div>
              <p class="empty-sub">Pijesz coś na mieście? Cyknij fotę kufla i dodaj do Live Feedu!</p>
            </div>
          `;
          return;
        }

        feedGrid.innerHTML = visibleFeed.map(item => {
          const timeAgo = formatTimeAgo(item.created_at);
          const authorName = item.author_name || item.user_name || "piwosz";
          const authorAvatarContent = (item.avatar_photo || item.user_photo)
            ? `<img src="${escapeHtml(item.avatar_photo || item.user_photo)}" alt="Avatar" />`
            : escapeHtml(item.avatar_icon || item.user_avatar || "🍺");
          const venueId = item.venue_id || "";
          const venueName = item.venue_name || "Warszawa";
          const authorId = item.author_id || item.user_id || "";

          return `
            <div class="beer-bereal-card" data-post-id="${escapeHtml(item.id)}">
              <!-- 1. Post Header: Author info (Avatar, Handle, Location link & Time) + Report Flag -->
              <div class="bereal-post-header">
                <div class="bereal-author-box">
                  <div class="bereal-author-avatar" onclick="window.__openUserProfile('${escapeHtml(authorName)}')">
                    ${authorAvatarContent}
                  </div>
                  <div class="bereal-author-meta">
                    <div class="bereal-author-name-row">
                      <span class="bereal-author-name" onclick="window.__openUserProfile('${escapeHtml(authorName)}')">
                        @${escapeHtml(authorName)}
                      </span>
                    </div>
                    <div class="bereal-sub-meta">
                      <span class="bereal-venue-link" onclick="window.__openVenueById('${escapeHtml(venueId)}')" title="Pokaż lokal na mapie">
                        📍 ${escapeHtml(venueName)}
                      </span>
                      <span class="bereal-meta-dot">•</span>
                      <span class="bereal-post-time">${timeAgo}</span>
                    </div>
                  </div>
                </div>
                <button type="button" class="bereal-btn-report" onclick="window.__openUgcReportModal('${escapeHtml(item.id)}', '${escapeHtml(authorId)}', '${escapeHtml(authorName)}', '${escapeHtml(venueName)}')" title="Zgłoś to zdjęcie lub zablokuj użytkownika">🚩</button>
              </div>

              <!-- 2. Dual BeReal / VSCO Viewport: Clean, unblocked, unobstructed photo -->
              <div class="bereal-viewport">
                <img class="bereal-main-img" src="${escapeHtml(item.photo_url)}" alt="Piwo w ${escapeHtml(item.venue_name)}" loading="lazy" />
                
                <!-- Picture-in-Picture selfie or avatar with tap-to-swap -->
                ${item.selfie_url ? `
                  <div class="bereal-pip-box" onclick="window.__swapBeRealCardImages(this)" title="Dotknij, aby zamienić widok aparatów">
                    <img class="bereal-pip-img" src="${escapeHtml(item.selfie_url)}" alt="Selfie" />
                    <span class="bereal-pip-flip-hint">🔄</span>
                  </div>
                ` : (item.avatar_photo ? `
                  <div class="bereal-pip-box" style="cursor: default;" title="${escapeHtml(item.author_name || '')}">
                    <img class="bereal-pip-img" src="${escapeHtml(item.avatar_photo)}" alt="Avatar" />
                  </div>
                ` : `
                  <div class="bereal-pip-box" style="cursor: default; font-size: 1.8rem;" title="${escapeHtml(item.author_name || '')}">
                    ${escapeHtml(item.avatar_icon || "🍺")}
                  </div>
                `)}
              </div>

              <!-- 3. Post Footer: Clean caption (Beer Name + Price Badge) & Cheers Toast button -->
              <div class="bereal-post-footer">
                <div class="bereal-caption-box">
                  <span class="bereal-beer-name">🍺 ${escapeHtml(item.beer_name || "Świeże Piwko")}</span>
                  ${item.beer_price ? `<span class="bereal-price-pill">${escapeHtml(String(item.beer_price))} zł</span>` : ""}
                </div>
                <button type="button" class="bereal-cheers-btn" onclick="window.__cheersFeedItem('${escapeHtml(item.id)}', this)" title="Wznieś toast z piwoszem!">
                  🍻 <span>${item.cheers_count || 1}</span>
                </button>
              </div>
            </div>
          `;
        }).join("");
      } catch (err) {
        feedGrid.innerHTML = `<div class="error-state-hint" style="grid-column: 1 / -1;">Nie udało się pobrać Live Feedu.</div>`;
      }
    }

    // Swap helpers for BeReal Cards & Review Screen
    window.__swapBeRealCardImages = function(pipEl) {
      if (!pipEl) return;
      const viewport = pipEl.closest('.bereal-viewport') || pipEl.closest('.bereal-img-box');
      if (!viewport) return;
      const mainImg = viewport.querySelector('.bereal-main-img');
      const pipImg = pipEl.querySelector('.bereal-pip-img');
      if (!mainImg || !pipImg || !pipImg.src) return;

      pipEl.style.transform = 'scale(0.85)';
      const tempSrc = mainImg.src;
      mainImg.src = pipImg.src;
      pipImg.src = tempSrc;
      setTimeout(() => {
        pipEl.style.transform = '';
      }, 180);
    };

    window.__swapBerealReviewImages = function() {
      const mainImg = document.getElementById("bereal-review-main");
      const pipImg = document.getElementById("bereal-review-pip");
      if (!mainImg || !pipImg || !pipImg.src) return;
      const tempSrc = mainImg.src;
      mainImg.src = pipImg.src;
      pipImg.src = tempSrc;
    };

    // Cheers Reaction
    window.__cheersFeedItem = async function (reportId, btn) {
      if (!btn) return;
      if (btn.classList.contains("cheered")) return;

      const countSpan = btn.querySelector("span");
      const curCount = parseInt(countSpan ? countSpan.textContent : "1", 10) || 1;
      if (countSpan) countSpan.textContent = curCount + 1;
      btn.classList.add("cheered");

      try {
        await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "react-cheers",
            payload: { reportId }
          })
        });
        showAppToast("Na zdrówko! 🍻", "Stuknięto się kuflem z piwoszem!", "🍻");
      } catch (e) {
        console.warn("Cheers reaction err:", e);
      }
    };

    // -------------------------------------------------------------------------
    // UGC Content Reporting & User Blocking (Apple Guideline 1.2 Compliance)
    // -------------------------------------------------------------------------
    let activeUgcReport = null;
    const ugcModal = document.getElementById("ugc-report-modal");
    const ugcCloseBtn = document.getElementById("btn-close-ugc-report");
    const ugcTargetInfo = document.getElementById("ugc-report-target-info");
    const ugcDetails = document.getElementById("ugc-report-details");
    const ugcSubmitBtn = document.getElementById("btn-submit-ugc-report");
    const ugcBlockBtn = document.getElementById("btn-block-ugc-author");
    const ugcBlockText = document.getElementById("btn-block-ugc-text");

    window.__openUgcReportModal = function(contentId, authorId, authorName, venueName) {
      activeUgcReport = { contentId, authorId, authorName, venueName };
      if (ugcTargetInfo) {
        ugcTargetInfo.innerHTML = `Treść dodana przez: <strong>@${escapeHtml(authorName || "anonim")}</strong> w lokalu <strong>${escapeHtml(venueName || "Warszawa")}</strong>`;
      }
      if (ugcBlockText) {
        ugcBlockText.textContent = authorName ? `🚫 Zablokuj użytkownika @${authorName}` : "🚫 Zablokuj tego użytkownika";
      }
      if (ugcDetails) ugcDetails.value = "";
      if (ugcModal) {
        ugcModal.style.display = "flex";
      }
    };

    window.__closeUgcReportModal = function() {
      activeUgcReport = null;
      if (ugcModal) ugcModal.style.display = "none";
      if (ugcDetails) ugcDetails.value = "";
    };

    if (ugcCloseBtn) ugcCloseBtn.addEventListener("click", window.__closeUgcReportModal);
    if (ugcModal) {
      ugcModal.addEventListener("click", (e) => {
        if (e.target === ugcModal) window.__closeUgcReportModal();
      });
    }

    if (ugcSubmitBtn) {
      ugcSubmitBtn.addEventListener("click", async () => {
        if (!activeUgcReport) return;
        const selectedRadio = document.querySelector('input[name="ugc-report-reason"]:checked');
        const reasonVal = selectedRadio ? selectedRadio.value : "other";
        const reasonLabels = {
          offensive: "Wulgaryzmy lub mowa nienawiści",
          photo: "Nieodpowiednie / obsceniczne zdjęcie",
          fake_price: "Fałszywe ceny, trolling lub spam",
          other: "Inne naruszenie regulaminu"
        };
        const detailsText = ugcDetails ? ugcDetails.value.trim() : "";

        ugcSubmitBtn.disabled = true;
        ugcSubmitBtn.innerHTML = "<span>⏳ Wysyłanie zgłoszenia...</span>";

        try {
          await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "report-content",
              payload: {
                contentId: activeUgcReport.contentId,
                contentType: "photo",
                reportedUserId: activeUgcReport.authorId,
                reportedUsername: activeUgcReport.authorName,
                reason: reasonLabels[reasonVal] || reasonVal,
                details: detailsText,
                reporterUserId: currentUser ? currentUser.id : null
              }
            })
          });
        } catch (e) {
          console.warn("UGC report API call note:", e);
        }

        ugcSubmitBtn.disabled = false;
        ugcSubmitBtn.innerHTML = "<span>🚩 Wyślij zgłoszenie do moderacji</span>";
        window.__closeUgcReportModal();
        showAppToast("Zgłoszenie przyjęte", "Dziękujemy. Treść została przekazana do natychmiastowej weryfikacji.", "🛡️", 4500);
      });
    }

    if (ugcBlockBtn) {
      ugcBlockBtn.addEventListener("click", () => {
        if (!activeUgcReport) return;
        const targetName = activeUgcReport.authorName || "użytkownika";
        if (!confirm(`Czy na pewno chcesz zablokować @${targetName}? Jego zdjęcia i meldunki przestaną być dla Ciebie widoczne.`)) {
          return;
        }

        try {
          let blocked = JSON.parse(localStorage.getItem("poilepiwko_blocked_users") || "[]");
          if (!Array.isArray(blocked)) blocked = [];
          if (activeUgcReport.authorId) blocked.push(activeUgcReport.authorId);
          if (activeUgcReport.authorName) blocked.push(activeUgcReport.authorName);
          localStorage.setItem("poilepiwko_blocked_users", JSON.stringify(Array.from(new Set(blocked))));
        } catch (e) {}

        window.__closeUgcReportModal();
        showAppToast("Zablokowano użytkownika", `Treści od @${targetName} zostały ukryte w Twoim telefonie.`, "🚫", 4500);
        loadLiveBarFeed();
      });
    }

    // -------------------------------------------------------------------------
    // In-App Dual BeReal Camera System & Review Controller
    // -------------------------------------------------------------------------
    const btnOpenBereal = document.getElementById("btn-open-bereal-camera");
    const berealModal = document.getElementById("bereal-camera-modal");
    const btnCloseBereal = document.getElementById("btn-close-bereal-camera");
    const berealVideo = document.getElementById("bereal-video");
    const berealCanvas = document.getElementById("bereal-canvas");
    const berealStageBadge = document.getElementById("bereal-stage-badge");
    const berealStepDesc = document.getElementById("bereal-step-desc");
    const berealCameraPip = document.getElementById("bereal-camera-pip");
    const berealPipPreviewImg = document.getElementById("bereal-pip-preview-img");
    const btnBerealFlip = document.getElementById("btn-bereal-flip");
    const btnBerealShutter = document.getElementById("btn-bereal-shutter");
    const btnBerealGallery = document.getElementById("btn-bereal-gallery");
    const btnBerealSkipSelfie = document.getElementById("btn-bereal-skip-selfie");
    const berealViewfinderStage = document.getElementById("bereal-viewfinder-stage");
    const berealReviewStage = document.getElementById("bereal-review-stage");
    const berealReviewMain = document.getElementById("bereal-review-main");
    const berealReviewPip = document.getElementById("bereal-review-pip");
    const berealSelectVenue = document.getElementById("bereal-select-venue");
    const berealInputBeer = document.getElementById("bereal-input-beer");
    const berealInputPrice = document.getElementById("bereal-input-price");
    const btnBerealRetake = document.getElementById("btn-bereal-retake");
    const btnBerealPublish = document.getElementById("btn-bereal-publish");

    let berealMediaStream = null;
    let berealFacingMode = "environment"; // Step 1: back camera
    let berealCurrentStep = 1; // 1 = beer/bar, 2 = selfie
    let berealShot1 = null; // main photo base64
    let berealShot2 = null; // selfie photo base64

    async function startBerealCameraStream() {
      stopBerealCameraStream();
      if (!berealVideo) return;

      try {
        const constraints = {
          video: {
            facingMode: { ideal: berealFacingMode },
            width: { ideal: 1280 },
            height: { ideal: 1600 }
          },
          audio: false
        };

        let stream = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (initialErr) {
          console.warn("Retrying getUserMedia with basic video constraint:", initialErr);
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }

        berealMediaStream = stream;
        berealVideo.srcObject = stream;
        berealVideo.setAttribute("playsinline", "true");
        await berealVideo.play();

        if (berealFacingMode === "user") {
          berealVideo.classList.add("mirror");
        } else {
          berealVideo.classList.remove("mirror");
        }
      } catch (err) {
        console.warn("Camera stream access failed:", err);
        showAppToast("Kamera niedostępna", "Nie udało się uruchomić aparatu. Możesz wybrać zdjęcie z galerii.", "📷", 4000);
      }
    }

    function stopBerealCameraStream() {
      if (berealMediaStream) {
        try {
          berealMediaStream.getTracks().forEach(t => t.stop());
        } catch (e) {}
        berealMediaStream = null;
      }
      if (berealVideo) {
        berealVideo.srcObject = null;
      }
    }

    function openBerealCameraModal() {
      if (!currentUser) {
        showAppToast("Zaloguj się!", "Musisz być zalogowany, aby dodać fotkę w stylu BeReal 📸", "🔒");
        const authModal = document.getElementById("auth-modal");
        if (authModal) authModal.style.display = "flex";
        return;
      }

      berealCurrentStep = 1;
      berealShot1 = null;
      berealShot2 = null;
      berealFacingMode = "environment";

      if (berealViewfinderStage) berealViewfinderStage.style.display = "block";
      if (berealReviewStage) berealReviewStage.style.display = "none";
      if (berealStageBadge) berealStageBadge.textContent = "🍺 Zdjęcie Piwa (1/2)";
      if (berealStepDesc) berealStepDesc.textContent = "KROK 1/2: Zrób zdjęcie piwka lub baru";
      if (berealCameraPip) berealCameraPip.style.display = "none";
      if (btnBerealSkipSelfie) btnBerealSkipSelfie.style.display = "none";

      if (berealModal) berealModal.style.display = "flex";
      startBerealCameraStream();
    }

    function closeBerealCameraModal() {
      stopBerealCameraStream();
      if (berealModal) berealModal.style.display = "none";
    }

    function captureFrameFromVideo() {
      if (!berealVideo || !berealCanvas) return null;
      const vW = berealVideo.videoWidth || 960;
      const vH = berealVideo.videoHeight || 1280;

      // 4:5 aspect ratio crop
      let cropW = vW;
      let cropH = Math.round(vW * 1.25);
      let cropX = 0;
      let cropY = Math.round((vH - cropH) / 2);
      if (cropH > vH) {
        cropH = vH;
        cropW = Math.round(vH * 0.8);
        cropX = Math.round((vW - cropW) / 2);
        cropY = 0;
      }

      const outW = 800;
      const outH = 1000;
      berealCanvas.width = outW;
      berealCanvas.height = outH;
      const ctx = berealCanvas.getContext("2d");

      ctx.save();
      if (berealFacingMode === "user") {
        ctx.translate(outW, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(berealVideo, cropX, cropY, cropW, cropH, 0, 0, outW, outH);
      ctx.restore();

      return berealCanvas.toDataURL("image/webp", 0.84);
    }

    function populateBerealVenueDropdown() {
      if (!berealSelectVenue) return;
      berealSelectVenue.innerHTML = "";

      let venuesList = Array.isArray(allVenues) && allVenues.length > 0 ? [...allVenues] : [];

      if (venuesList.length === 0) {
        const opt = document.createElement("option");
        opt.value = "warszawa-live";
        opt.textContent = "Bar w Warszawie";
        berealSelectVenue.appendChild(opt);
        return;
      }

      // Proximity sorting if user coordinates are available
      if (userLocation && Array.isArray(userLocation) && userLocation.length === 2) {
        venuesList.sort((a, b) => {
          const distA = calculateDistanceKm(userLocation[0], userLocation[1], a.latitude, a.longitude);
          const distB = calculateDistanceKm(userLocation[0], userLocation[1], b.latitude, b.longitude);
          return distA - distB;
        });
      } else {
        venuesList.sort((a, b) => (a.name || "").localeCompare(b.name || "", "pl"));
      }

      venuesList.forEach((v, idx) => {
        const opt = document.createElement("option");
        opt.value = v.id;
        let distLabel = "";
        if (userLocation && Array.isArray(userLocation) && userLocation.length === 2 && v.latitude && v.longitude) {
          const d = calculateDistanceKm(userLocation[0], userLocation[1], v.latitude, v.longitude);
          distLabel = d < 1 ? ` (${Math.round(d * 1000)} m)` : ` (${d.toFixed(1)} km)`;
        }
        opt.textContent = `${v.name}${v.district ? ` [${v.district}]` : ""}${distLabel}`;
        if (idx === 0) {
          opt.selected = true;
          if (v.beer_price_pln && berealInputPrice && !berealInputPrice.value) {
            berealInputPrice.value = v.beer_price_pln.toFixed(2);
          }
        }
        berealSelectVenue.appendChild(opt);
      });

      berealSelectVenue.onchange = function() {
        const chosenId = berealSelectVenue.value;
        const found = (allVenues || []).find(v => v.id === chosenId);
        if (found && found.beer_price_pln && berealInputPrice) {
          berealInputPrice.value = found.beer_price_pln.toFixed(2);
        }
      };
    }

    function goToBerealReviewStage() {
      stopBerealCameraStream();
      if (berealViewfinderStage) berealViewfinderStage.style.display = "none";
      if (berealReviewStage) berealReviewStage.style.display = "block";
      if (berealStepDesc) berealStepDesc.textContent = "Sprawdź fotkę i wybierz lokal przed wrzuceniem";

      if (berealReviewMain) berealReviewMain.src = berealShot1 || "";

      if (berealShot2) {
        if (berealReviewPip) berealReviewPip.src = berealShot2;
        if (berealReviewPip && berealReviewPip.parentElement) berealReviewPip.parentElement.style.display = "block";
      } else if (currentUser && (currentUser.avatar_photo || (currentUser.user_metadata && currentUser.user_metadata.avatar_photo))) {
        const av = currentUser.avatar_photo || currentUser.user_metadata.avatar_photo;
        if (berealReviewPip) berealReviewPip.src = av;
        if (berealReviewPip && berealReviewPip.parentElement) berealReviewPip.parentElement.style.display = "block";
      } else {
        if (berealReviewPip && berealReviewPip.parentElement) berealReviewPip.parentElement.style.display = "none";
      }

      populateBerealVenueDropdown();
      const card = document.querySelector(".bereal-camera-modal-card");
      if (card) card.scrollTop = 0;
    }

    // Helper: Upload base64 image
    async function uploadBase64Image(dataUrl, prefix) {
      if (!dataUrl || !dataUrl.startsWith("data:")) return dataUrl;
      try {
        const upRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: dataUrl,
            contentType: "image/webp",
            fileName: `${prefix}-${Date.now()}`
          })
        });
        if (upRes.ok) {
          const upData = await upRes.json();
          if (upData.url) return upData.url;
        }
      } catch (err) {
        console.warn("Upload fallback error:", err);
      }
      return dataUrl;
    }

    // Wiring up BeReal Camera Event Listeners
    if (btnOpenBereal) {
      btnOpenBereal.addEventListener("click", openBerealCameraModal);
    }

    if (btnCloseBereal) {
      btnCloseBereal.addEventListener("click", closeBerealCameraModal);
    }

    if (berealModal) {
      berealModal.addEventListener("click", (e) => {
        if (e.target === berealModal) closeBerealCameraModal();
      });
    }

    if (btnBerealFlip) {
      btnBerealFlip.addEventListener("click", () => {
        berealFacingMode = (berealFacingMode === "environment" ? "user" : "environment");
        startBerealCameraStream();
      });
    }

    if (btnBerealShutter) {
      btnBerealShutter.addEventListener("click", () => {
        const snap = captureFrameFromVideo();
        if (!snap) return;

        if (berealCurrentStep === 1) {
          berealShot1 = snap;
          berealCurrentStep = 2;

          if (berealCameraPip) {
            berealCameraPip.style.display = "block";
            if (berealPipPreviewImg) berealPipPreviewImg.src = berealShot1;
          }
          if (berealStageBadge) berealStageBadge.textContent = "🤳 Selfie Piwosza (2/2)";
          if (berealStepDesc) berealStepDesc.textContent = "KROK 2/2: Pora na Twoje selfie z piwkiem!";
          if (btnBerealSkipSelfie) btnBerealSkipSelfie.style.display = "inline-flex";

          berealFacingMode = "user";
          startBerealCameraStream();
        } else if (berealCurrentStep === 2) {
          berealShot2 = snap;
          goToBerealReviewStage();
        }
      });
    }

    if (btnBerealSkipSelfie) {
      btnBerealSkipSelfie.addEventListener("click", () => {
        berealShot2 = null;
        goToBerealReviewStage();
      });
    }

    if (btnBerealRetake) {
      btnBerealRetake.addEventListener("click", () => {
        berealCurrentStep = 1;
        berealShot1 = null;
        berealShot2 = null;
        berealFacingMode = "environment";

        if (berealViewfinderStage) berealViewfinderStage.style.display = "block";
        if (berealReviewStage) berealReviewStage.style.display = "none";
        if (berealStageBadge) berealStageBadge.textContent = "🍺 Zdjęcie Piwa (1/2)";
        if (berealStepDesc) berealStepDesc.textContent = "KROK 1/2: Zrób zdjęcie piwka lub baru";
        if (berealCameraPip) berealCameraPip.style.display = "none";
        if (btnBerealSkipSelfie) btnBerealSkipSelfie.style.display = "none";

        startBerealCameraStream();
      });
    }

    // Publish BeReal Check-in
    if (btnBerealPublish) {
      btnBerealPublish.addEventListener("click", async () => {
        if (!currentUser) {
          showAppToast("Zaloguj się!", "Musisz być zalogowany, aby dodać post.", "🔒");
          return;
        }
        if (!berealShot1) {
          showAppToast("Brak zdjęcia", "Zrób zdjęcie piwa przed publikacją.", "⚠️");
          return;
        }

        btnBerealPublish.disabled = true;
        btnBerealPublish.innerHTML = `<span>⏳ Opublikuj w Feedzie...</span>`;

        try {
          // 1. Upload shots
          const mainUrl = await uploadBase64Image(berealShot1, "bereal-beer");
          let selfieUrl = null;
          if (berealShot2) {
            selfieUrl = await uploadBase64Image(berealShot2, "bereal-selfie");
          }

          // 2. Determine venue details
          const venueId = (berealSelectVenue && berealSelectVenue.value) || "warszawa-live";
          const venueObj = (allVenues || []).find(v => v.id === venueId);
          const venueName = venueObj ? venueObj.name : (venueId === "warszawa-live" ? "Bar w Warszawie" : "Lokal");
          const district = venueObj ? (venueObj.district || "Warszawa") : "Warszawa";
          const beerName = (berealInputBeer && berealInputBeer.value.trim()) || "Świeże Piwko";
          const beerPrice = (berealInputPrice && berealInputPrice.value)
            ? parseFloat(berealInputPrice.value)
            : (venueObj && typeof venueObj.beer_price_pln === "number" ? venueObj.beer_price_pln : 14.0);

          // 3. Post to backend
          await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "record-checkin",
              payload: {
                userId: currentUser.id,
                venueId: venueId,
                venueName: venueName,
                district: district,
                beerName: beerName,
                beerPrice: beerPrice,
                photoUrl: mainUrl,
                selfieUrl: selfieUrl
              }
            })
          });

          showAppToast("BeReal opublikowany! 🎉", "Twoje piwko wylądowało w Live Feedzie!", "🍻", 4000);
          closeBerealCameraModal();
          loadLiveBarFeed();
        } catch (err) {
          console.error("Publish error:", err);
          showAppToast("Błąd publikacji", "Spróbuj ponownie za chwilę.", "⚠️");
        } finally {
          btnBerealPublish.disabled = false;
          btnBerealPublish.innerHTML = `<span>🚀 Opublikuj w Feedzie</span>`;
        }
      });
    }

    if (berealInputBeer) {
      berealInputBeer.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (btnBerealPublish) btnBerealPublish.click();
        }
      });
    }
    if (berealInputPrice) {
      berealInputPrice.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (btnBerealPublish) btnBerealPublish.click();
        }
      });
    }

    // -------------------------------------------------------------------------
    // Tab 4: Render Notifications & Activity
    // -------------------------------------------------------------------------
    function renderNotificationsList() {
      if (!notifList) return;
      if (!currentUser) {
        notifList.innerHTML = `
          <div class="empty-state-card">
            <div class="empty-icon">🔒</div>
            <div class="empty-title">Zaloguj się</div>
            <p class="empty-sub">Zaloguj się na swoje konto, aby widzieć aktywność znajomych!</p>
          </div>
        `;
        return;
      }

      if (!myNotifications || myNotifications.length === 0) {
        notifList.innerHTML = `
          <div class="empty-state-card">
            <div class="empty-icon">🔔</div>
            <div class="empty-title">Brak powiadomień</div>
            <p class="empty-sub">Gdy ktoś Cię zaobserwuje lub wzniesie z Tobą toast 🍻, powiadomienie pojawi się tutaj!</p>
          </div>
        `;
        return;
      }

      notifList.innerHTML = myNotifications.map(n => {
        const isUnread = !n.read;
        const isSos = n.type === "sos_alert";
        const avatarHtml = isSos 
          ? `<span style="font-size:22px;display:inline-block;animation:sos-pulse-glow 2s infinite;">🚨</span>` 
          : (n.fromAvatarPhoto
            ? `<img src="${escapeHtml(n.fromAvatarPhoto)}" class="notif-photo" alt="Avatar" />`
            : escapeHtml(n.fromAvatarIcon || "🍺"));
        const timeAgo = formatTimeAgo(n.createdAt);
        const isFollowing = n.fromUserId ? myFollowingIds.includes(n.fromUserId) : false;
        const isMe = currentUser && currentUser.id === n.fromUserId;

        return `
          <div class="notif-card ${isUnread ? "unread" : ""} ${isSos ? "notif-card-sos" : ""}" style="${isSos ? "border-color: rgba(239, 68, 68, 0.55); background: rgba(239, 68, 68, 0.08);" : ""}">
            <div class="notif-avatar" ${n.fromUsername ? `onclick="window.__openUserProfile('${escapeHtml(n.fromUsername)}')"` : ""}>
              ${avatarHtml}
            </div>
            <div class="notif-info" ${n.fromUsername ? `onclick="window.__openUserProfile('${escapeHtml(n.fromUsername)}')"` : ""}>
              <div class="notif-msg" style="${isSos ? "color: #fca5a5; font-weight: 800;" : ""}">${escapeHtml(n.message || "Nowa aktywność")}</div>
              <div class="notif-meta">
                <span>🕒 ${timeAgo}</span>
                ${n.fromUsername ? `<span>• @${escapeHtml(n.fromUsername)}</span>` : ""}
              </div>
            </div>
            <div class="notif-action">
              ${isSos && typeof n.latitude === "number" && typeof n.longitude === "number" ? `
                <button type="button" class="btn-notif-action" style="background: #ef4444; border-color: #fca5a5; color: #fff; font-weight: 800;" onclick="window.__flyToSosLocation(${n.latitude}, ${n.longitude}, '${escapeHtml(n.fromDisplayName || "Znajomy")}', '${escapeHtml(n.venueName || "")}')">
                  📍 Na mapie
                </button>
              ` : ((!isMe && n.fromUserId) ? `
                <button type="button" class="btn-notif-action ${isFollowing ? "following" : ""}" data-user-id="${escapeHtml(n.fromUserId)}" onclick="window.__toggleFollowFromNotif('${escapeHtml(n.fromUserId)}', this)">
                  ${isFollowing ? "✓ Obserwujesz" : "➕ Obserwuj zwrotnie"}
                </button>
              ` : "")}
            </div>
          </div>
        `;
      }).join("");
    }
    window.__renderNotificationsList = renderNotificationsList;

    window.__flyToSosLocation = function(lat, lng, name, venue) {
      const commModal = document.getElementById("community-modal");
      if (commModal) commModal.style.display = "none";
      document.body.classList.remove("modal-open");
      if (map) {
        map.flyTo([lat, lng], 17, { duration: 1.2 });
        L.popup()
          .setLatLng([lat, lng])
          .setContent(`
            <div style="text-align:center;padding:6px;max-width:220px;">
              <div style="font-size:22px;margin-bottom:4px;">🚨</div>
              <strong style="color:#ef4444;font-size:14px;display:block;">Alert SOS: ${escapeHtml(name)}</strong>
              ${venue ? `<div style="font-weight:700;color:#f8fafc;font-size:12px;margin-top:2px;">📍 ${escapeHtml(venue)}</div>` : ""}
              <div style="font-size:11px;color:#94a3b8;margin-top:4px;">Znajomy potrzebuje pomocy lub odbioru!</div>
            </div>
          `)
          .openOn(map);
      }
    };
  }

  // Global Follow / Unfollow Toggle
  window.__toggleFollowUser = async function (targetUserId, btnEl) {
    if (!currentUser) {
      showAppToast("Zaloguj się!", "Musisz mieć konto, aby obserwować znajomych.", "🔒");
      const authModal = document.getElementById("auth-modal");
      if (authModal) authModal.style.display = "flex";
      return;
    }

    if (btnEl) btnEl.disabled = true;

    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle-follow",
          payload: {
            followerId: currentUser.id,
            followingId: targetUserId
          }
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.isFollowing) {
          if (!myFollowingIds.includes(targetUserId)) myFollowingIds.push(targetUserId);
          showAppToast("Obserwujesz użytkownika!", "Dodano do Twojej listy znajomych 👥", "❤️");
        } else {
          myFollowingIds = myFollowingIds.filter(id => id !== targetUserId);
          showAppToast("Przestałeś obserwować użytkownika.", "Usunięto z listy znajomych", "🤍");
        }

        if (Array.isArray(data.followingIds)) {
          myFollowingIds = data.followingIds;
        }

        // Update all buttons for this target user on the page
        document.querySelectorAll(`.btn-follow-toggle[data-user-id="${targetUserId}"]`).forEach(btn => {
          if (data.isFollowing) {
            btn.classList.add("following");
            btn.textContent = "✓ Obserwujesz";
          } else {
            btn.classList.remove("following");
            btn.textContent = "➕ Obserwuj";
          }
        });

        document.querySelectorAll(`.btn-notif-action[data-user-id="${targetUserId}"]`).forEach(btn => {
          if (data.isFollowing) {
            btn.classList.add("following");
            btn.textContent = "✓ Obserwujesz";
          } else {
            btn.classList.remove("following");
            btn.textContent = "➕ Obserwuj zwrotnie";
          }
        });

        // Update public profile modal follow button if currently open for this user
        const pubprofFollowBtn = document.getElementById("btn-pubprof-follow-toggle");
        if (pubprofFollowBtn) {
          pubprofFollowBtn.className = data.isFollowing ? "btn-pubprof-follow following" : "btn-pubprof-follow";
          pubprofFollowBtn.innerHTML = data.isFollowing ? "<span>✓ Obserwujesz</span>" : "<span>➕ Obserwuj znajomego</span>";
          const statFollowers = document.getElementById("pubprof-stat-followers");
          if (typeof data.followersCount === "number" && statFollowers) {
            statFollowers.textContent = data.followersCount;
          }
        }

        const commFollowingBadge = document.getElementById("comm-following-badge");
        if (commFollowingBadge) commFollowingBadge.textContent = myFollowingIds.length;
        const profStatFriends = document.getElementById("prof-stat-friends");
        if (profStatFriends) profStatFriends.textContent = myFollowingIds.length;
      } else {
        showAppToast("Uwaga", data.error || "Nie udało się zaktualizować obserwowania.", "⚠️");
      }
    } catch (err) {
      console.warn("Toggle follow error:", err);
      showAppToast("Błąd", "Problem z połączeniem z serwerem.", "⚠️");
    } finally {
      if (btnEl) btnEl.disabled = false;
    }
  };

  window.__toggleFollowFromNotif = async function (targetUserId, btnEl) {
    await window.__toggleFollowUser(targetUserId, btnEl);
    if (btnEl) {
      const isFollowing = myFollowingIds.includes(targetUserId);
      btnEl.className = `btn-notif-action ${isFollowing ? "following" : ""}`;
      btnEl.textContent = isFollowing ? "✓ Obserwujesz" : "➕ Obserwuj zwrotnie";
    }
  };

  function initPublicProfileModal() {
    const modal = document.getElementById("public-profile-modal");
    const btnClose = document.getElementById("btn-close-public-profile");
    const btnFollow = document.getElementById("btn-pubprof-follow-toggle");
    const btnShare = document.getElementById("btn-pubprof-share");

    let currentViewedProfile = null;

    window.__openUserProfile = async function (username) {
      if (!username) return;
      const cleanUser = username.trim().toLowerCase().replace(/^@/, "");

      // If viewing self, open own profile modal
      if (currentProfile && currentProfile.username && currentProfile.username.toLowerCase() === cleanUser) {
        if (window.__openMyProfile) window.__openMyProfile();
        return;
      }

      if (modal) {
        modal.classList.add("active");
        modal.style.display = "flex";
      }

      const avatarEl = document.getElementById("pubprof-avatar");
      const nameEl = document.getElementById("pubprof-name");
      const handleEl = document.getElementById("pubprof-handle");
      const rankEl = document.getElementById("pubprof-rank");
      const statVisited = document.getElementById("pubprof-stat-visited");
      const statFavorites = document.getElementById("pubprof-stat-favorites");
      const statFollowers = document.getElementById("pubprof-stat-followers");
      const bioEl = document.getElementById("pubprof-bio");
      const beerEl = document.getElementById("pubprof-val-beer");
      const distEl = document.getElementById("pubprof-val-district");
      const badgesList = document.getElementById("pubprof-badges-list");

      if (nameEl) nameEl.textContent = "Ładowanie...";
      if (handleEl) handleEl.textContent = `@${cleanUser}`;
      if (badgesList) badgesList.innerHTML = `<div class="loading-state-hint">Pobieranie profilu... 🍺</div>`;

      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get-profile",
            payload: { username: cleanUser }
          })
        });

        const data = await res.json();
        if (!res.ok || !data.profile) {
          if (nameEl) nameEl.textContent = "Nie znaleziono profilu";
          if (badgesList) badgesList.innerHTML = `<div class="empty-state-hint">Użytkownik @${cleanUser} nie istnieje w bazie.</div>`;
          return;
        }

        const p = data.profile;
        currentViewedProfile = p;
        const rank = calculateUserRank((p.visited_venues || []).length);

        if (avatarEl) {
          if (p.avatar_photo) {
            avatarEl.innerHTML = `<img src="${escapeHtml(p.avatar_photo)}" class="public-profile-photo" alt="Zdjęcie profilowe" />`;
          } else {
            avatarEl.textContent = p.avatar_icon || "🍺";
          }
        }
        if (nameEl) nameEl.textContent = p.display_name || p.username;
        if (handleEl) handleEl.textContent = `@${p.username}`;

        const pubUserNum = document.getElementById("pubprof-user-number");
        if (pubUserNum) {
          const uNum = data.userNumber || p.user_number;
          if (uNum) {
            pubUserNum.textContent = uNum;
            pubUserNum.style.display = "inline-flex";
          } else {
            pubUserNum.style.display = "none";
          }
        }

        if (rankEl) rankEl.textContent = rank.title;
        if (statVisited) statVisited.textContent = (p.visited_venues || []).length;
        if (statFavorites) statFavorites.textContent = (p.favorite_venues || []).length;
        if (statFollowers) statFollowers.textContent = data.stats?.followersCount || 0;
        if (bioEl) bioEl.textContent = p.bio || "Brak opisu.";
        if (beerEl) beerEl.textContent = p.favorite_beer || "Wszystkie dobre!";
        if (distEl) distEl.textContent = p.favorite_district || "Warszawa";

        const vibePill = document.getElementById("pubprof-pill-vibe");
        const vibeVal = document.getElementById("pubprof-val-vibe");
        if (vibePill && vibeVal) {
          if (p.vibe_tags) {
            vibeVal.textContent = p.vibe_tags;
            vibePill.style.display = "inline-flex";
          } else {
            vibePill.style.display = "none";
          }
        }

        // Follow button state
        if (btnFollow) {
          const isFollowing = myFollowingIds.includes(p.id);
          btnFollow.className = isFollowing ? "btn-pubprof-follow following" : "btn-pubprof-follow";
          btnFollow.innerHTML = isFollowing ? "<span>✓ Obserwujesz</span>" : "<span>➕ Obserwuj znajomego</span>";
        }

        // Render unlocked badges safely without any location or timeline stalking
        if (badgesList) {
          const userVisited = Array.isArray(p.visited_venues) ? p.visited_venues : [];
          const vMap = {};
          allVenues.forEach(v => { vMap[v.id] = v; });
          const unlocked = PASSPORT_BADGES.filter(b => {
            try {
              return b.check(userVisited, vMap).unlocked;
            } catch (e) {
              return false;
            }
          });

          if (unlocked.length === 0) {
            badgesList.innerHTML = `<div class="empty-state-hint">Użytkownik nie zdobył jeszcze żadnej odznaki.</div>`;
          } else {
            badgesList.innerHTML = unlocked.map(b => `
              <div class="pubprof-badge-chip">
                <span class="badge-chip-icon">${escapeHtml(b.icon)}</span>
                <div class="badge-chip-text">
                  <div class="badge-chip-name">${escapeHtml(b.name)}</div>
                  <div class="badge-chip-desc">${escapeHtml(b.desc)}</div>
                </div>
              </div>
            `).join("");
          }
        }
      } catch (err) {
        if (nameEl) nameEl.textContent = "Błąd pobierania";
        if (badgesList) badgesList.innerHTML = `<div class="error-state-hint">Nie udało się pobrać danych profilu.</div>`;
      }
    };

    window.__closePublicProfile = function () {
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none";
      }
    };

    if (btnClose && modal) {
      btnClose.addEventListener("click", () => { window.__closePublicProfile(); });
      modal.addEventListener("click", (e) => {
        if (e.target === modal) window.__closePublicProfile();
      });
    }

    if (btnFollow) {
      btnFollow.addEventListener("click", async () => {
        if (!currentViewedProfile) return;
        await window.__toggleFollowUser(currentViewedProfile.id, null);
        const isFollowing = myFollowingIds.includes(currentViewedProfile.id);
        btnFollow.className = isFollowing ? "btn-pubprof-follow following" : "btn-pubprof-follow";
        btnFollow.innerHTML = isFollowing ? "<span>✓ Obserwujesz</span>" : "<span>➕ Obserwuj znajomego</span>";
        const statFollowers = document.getElementById("pubprof-stat-followers");
        if (statFollowers) {
          const cur = parseInt(statFollowers.textContent, 10) || 0;
          statFollowers.textContent = isFollowing ? cur + 1 : Math.max(0, cur - 1);
        }
      });
    }

    const btnToast = document.getElementById("btn-pubprof-toast");
    if (btnToast) {
      btnToast.addEventListener("click", () => {
        if (!currentViewedProfile) return;
        const targetNick = `@${currentViewedProfile.username}`;
        triggerCheersAnimation(`Wzniesiono toast z ${targetNick}! Na zdrowie! 🍻`);
        showAppToast("Wirtualny Toast!", `Stuknąłeś się kuflem z ${targetNick} 🍻`, "🍻");

        if (currentUser && currentViewedProfile.id && currentUser.id !== currentViewedProfile.id) {
          fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "send-toast",
              payload: {
                fromUserId: currentUser.id,
                toUserId: currentViewedProfile.id
              }
            })
          }).catch(err => console.warn("Failed to send toast notification:", err));
        }
      });
    }

    if (btnShare) {
      btnShare.addEventListener("click", () => {
        if (!currentViewedProfile) return;
        const url = `${window.location.origin}/#@${currentViewedProfile.username}`;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => {
            showAppToast("Skopiowano link do profilu!", url, "📤");
          }).catch(() => {
            prompt("Skopiuj link do profilu:", url);
          });
        } else {
          prompt("Skopiuj link do profilu:", url);
        }
      });
    }
  }

  // Audio & Animation Helper for Virtual Cheers ("Stuknij się kuflem")
  function playClinkSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(1480, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1050, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.28, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.33);
    } catch (e) {}
  }

  function triggerCheersAnimation(message = "Na zdrowie! 🍻") {
    const overlay = document.getElementById("cheers-animation-overlay");
    const banner = document.getElementById("cheers-toast-banner");
    if (!overlay) return;

    if (banner) banner.textContent = message;
    overlay.style.display = "flex";

    // Trigger audio clink + subtle vibration
    playClinkSound();
    if (navigator.vibrate) {
      try { navigator.vibrate([40, 50, 60]); } catch (e) {}
    }

    // Reset animations
    const left = overlay.querySelector(".cheers-left");
    const right = overlay.querySelector(".cheers-right");
    const spark = overlay.querySelector(".cheers-spark");
    if (left) { left.style.animation = "none"; void left.offsetWidth; left.style.animation = ""; }
    if (right) { right.style.animation = "none"; void right.offsetWidth; right.style.animation = ""; }
    if (spark) { spark.style.animation = "none"; void spark.offsetWidth; spark.style.animation = ""; }
    if (banner) { banner.style.animation = "none"; void banner.offsetWidth; banner.style.animation = ""; }

    clearTimeout(window.__cheersTimer);
    window.__cheersTimer = setTimeout(() => {
      overlay.style.display = "none";
    }, 1850);
  }
  window.__triggerCheers = triggerCheersAnimation;

  // Web Audio Synthesizer: Tick click for spinning roulette
  function playRouletteTick() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(650, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(920, ctx.currentTime + 0.025);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.03);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.035);
    } catch (e) {}
  }

  // Web Audio Synthesizer: Fanfare chime for winning roulette & Pub Crawl victory
  function playFanfareChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        const start = ctx.currentTime + idx * 0.09;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.24, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.38);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
    } catch (e) {}
  }

  // Lightweight Canvas Confetti Engine (Zero dependencies)
  function launchConfetti(canvasId, durationMs = 3500) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth || 440;
    canvas.height = canvas.offsetHeight || 500;

    const particles = [];
    const colors = ["#f59e0b", "#f43f5e", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#fbbf24", "#38bdf8"];
    for (let i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * -canvas.height * 0.6,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 3.5,
        vy: Math.random() * 4 + 2.5,
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 8
      });
    }

    const startTime = performance.now();
    function render(now) {
      if (now - startTime > durationMs) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
        ctx.restore();
      });
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  }

  // 🎲 Piwna Ruletka Controller ("Wylosuj bar na dziś")
  function initRouletteModal() {
    const modal = document.getElementById("roulette-modal");
    const btnFloat = document.getElementById("btn-roulette-float");
    const btnClose = document.getElementById("btn-close-roulette");
    const btnSpin = document.getElementById("btn-spin-roulette");
    const spinText = document.getElementById("spin-roulette-text");
    const reel = document.getElementById("roulette-drum-reel");
    const resultCard = document.getElementById("roulette-result-card");
    const resName = document.getElementById("roulette-result-name");
    const resPrice = document.getElementById("roulette-result-price");
    const resBeer = document.getElementById("roulette-result-beer");
    const resAddress = document.getElementById("roulette-result-address");
    const resDist = document.getElementById("roulette-result-dist");
    const resTags = document.getElementById("roulette-result-tags");
    const btnGotoMap = document.getElementById("btn-roulette-goto-map");
    const btnShare = document.getElementById("btn-roulette-share");

    let currentDistrictFilter = "all";
    let currentVibeFilter = "all";
    let isSpinning = false;
    let currentWinner = null;

    function openModal() {
      if (!modal) return;
      if (typeof requestMotionPermissionIfNeeded === "function") {
        requestMotionPermissionIfNeeded();
      }
      modal.classList.add("active");
      modal.style.display = "flex";
      updateVibeChipsAvailability();
      if (window.__clearBottomNavActive) window.__clearBottomNavActive();
    }

    function closeModal() {
      if (!modal) return;
      modal.classList.remove("active");
      modal.style.display = "none";
    }

    window.__openRoulette = openModal;
    window.__closeRoulette = closeModal;

    if (btnFloat) btnFloat.addEventListener("click", openModal);
    const btnTopRoulette = document.getElementById("btn-top-roulette");
    if (btnTopRoulette) btnTopRoulette.addEventListener("click", openModal);
    const btnHeaderRoulette = document.getElementById("btn-roulette-header");
    if (btnHeaderRoulette) btnHeaderRoulette.addEventListener("click", openModal);
    const chipSearchRoulette = document.getElementById("chip-search-roulette");
    if (chipSearchRoulette) {
      chipSearchRoulette.addEventListener("click", () => {
        const sheet = document.getElementById("mobile-search-sheet");
        if (sheet) sheet.style.display = "none";
        openModal();
      });
    }
    if (btnClose) btnClose.addEventListener("click", closeModal);
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
      });
    }

    function getDistrictPool(district) {
      if (!district || district === "all") return allVenues;
      const target = district.toLowerCase().trim();
      const targetNorm = target.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

      const pool = allVenues.filter(v => {
        const vDist = (v.district || "").toLowerCase();
        const vDistNorm = vDist.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const vName = (v.name || "").toLowerCase();
        const vAddr = (v.address || "").toLowerCase();

        if (target === "pawilony") {
          return vDist === "pawilony" || vName.includes("pawilony");
        }
        if (target === "bulwary") {
          return vDist === "bulwary" || vAddr.includes("bulwar") || vAddr.includes("wioślarsk") || vAddr.includes("zaruskiego");
        }
        if (target === "praga") {
          return vDist.includes("praga");
        }

        return vDistNorm.includes(targetNorm) || vDist.includes(target);
      });

      return pool.length > 0 ? pool : allVenues;
    }

    function updateVibeChipsAvailability() {
      const pool = getDistrictPool(currentDistrictFilter);
      const prices = pool.map(v => v.beer_price_pln).filter(p => typeof p === "number" && p > 0);
      const minPrice = prices.length ? Math.min(...prices) : 12;

      const cheapChip = document.querySelector('#roulette-vibe-chips [data-vibe="cheap"]');
      if (cheapChip) {
        if (minPrice <= 12) {
          cheapChip.innerHTML = "Tanie (≤ 12 zł) 💸";
        } else {
          cheapChip.innerHTML = `Tanie (od ${minPrice.toFixed(0)} zł) 💸`;
        }
      }
    }

    // Filter Chips: District
    const distChips = document.querySelectorAll("#roulette-district-chips .roulette-chip");
    distChips.forEach(chip => {
      chip.addEventListener("click", () => {
        distChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        currentDistrictFilter = chip.getAttribute("data-district") || "all";
        updateVibeChipsAvailability();
      });
    });

    // Filter Chips: Vibe
    const vibeChips = document.querySelectorAll("#roulette-vibe-chips .roulette-chip");
    vibeChips.forEach(chip => {
      chip.addEventListener("click", () => {
        vibeChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        currentVibeFilter = chip.getAttribute("data-vibe") || "all";
      });
    });

    let lastSpinRelaxed = false;

    function getCandidates() {
      lastSpinRelaxed = false;
      const districtPool = getDistrictPool(currentDistrictFilter);

      // 2. If vibe is "all", return the district pool directly
      if (currentVibeFilter === "all") {
        return districtPool;
      }

      // 3. Filter districtPool by vibe
      const vibeFiltered = districtPool.filter(v => {
        if (currentVibeFilter === "cheap") {
          return typeof v.beer_price_pln === "number" && v.beer_price_pln <= 12.0;
        }
        if (currentVibeFilter === "craft") {
          return v.is_craft === true;
        }
        if (currentVibeFilter === "garden") {
          return isGardenVenue(v);
        }
        if (currentVibeFilter === "happy") {
          return !!(v.happy_hour || v.happy_hour_rule);
        }
        if (currentVibeFilter === "nonalco") {
          return isNonAlcoholicVenue(v);
        }
        return true;
      });

      // 4. If matching venues found, return them
      if (vibeFiltered.length > 0) {
        return vibeFiltered;
      }

      // 5. Fallback: If no venues matched the vibe within this district,
      // ALWAYS STAY IN THE DISTRICT! Never return venues from another district!
      lastSpinRelaxed = true;

      if (currentVibeFilter === "cheap") {
        // Sort by lowest price in this district so user gets the cheapest available in their chosen area
        const sorted = [...districtPool].sort((a, b) => (a.beer_price_pln || 99) - (b.beer_price_pln || 99));
        return sorted.slice(0, Math.min(6, sorted.length));
      }

      return districtPool;
    }

    // Spin function
    function spinRoulette() {
      if (isSpinning || !reel) return;
      isSpinning = true;
      if (btnSpin) btnSpin.disabled = true;
      if (spinText) spinText.textContent = "LOSOWANIE...";
      if (resultCard) resultCard.style.display = "none";

      const candidates = getCandidates();
      const winner = candidates[Math.floor(Math.random() * candidates.length)];
      currentWinner = winner;

      // Build sequence of 22 items ending on winner
      const sequence = [];
      for (let i = 0; i < 21; i++) {
        sequence.push(candidates[Math.floor(Math.random() * candidates.length)]);
      }
      sequence.push(winner);

      reel.innerHTML = sequence.map((v) => `
        <div class="roulette-reel-card">
          <div class="roulette-item-title">${escapeHtml(v.name)}</div>
          <div class="roulette-item-meta">
            <span>📍 ${escapeHtml(v.district || 'Warszawa')}</span>
            <span>•</span>
            <span class="roulette-item-price">🍺 ${v.beer_price_pln.toFixed(2)} zł</span>
          </div>
        </div>
      `).join("");

      // Reset reel offset immediately
      reel.style.transition = "none";
      reel.style.transform = "translateY(0)";
      void reel.offsetHeight; // force reflow

      const cardHeight = 94;
      const targetOffset = (sequence.length - 1) * cardHeight;

      // Start scrolling animation
      reel.style.transition = "transform 2.4s cubic-bezier(0.12, 0.88, 0.22, 1)";
      reel.style.transform = `translateY(-${targetOffset}px)`;

      // Audio ticks schedule (accelerates then decelerates)
      const tickDelays = [40, 90, 150, 220, 300, 390, 490, 600, 730, 880, 1050, 1250, 1480, 1750, 2050, 2300];
      tickDelays.forEach(d => {
        setTimeout(() => {
          if (isSpinning) {
            playRouletteTick();
            if (navigator.vibrate) {
              try { navigator.vibrate(20); } catch (e) {}
            }
          }
        }, d);
      });

      // End of spin
      setTimeout(() => {
        isSpinning = false;
        if (btnSpin) btnSpin.disabled = false;
        if (spinText) spinText.textContent = "🔄 ZAKRĘĆ PONOWNIE!";

        playFanfareChime();
        if (navigator.vibrate) {
          try { navigator.vibrate([60, 40, 80]); } catch (e) {}
        }

        // Display Winner Card
        if (resName) resName.textContent = winner.name;
        if (resPrice) resPrice.textContent = `🍺 ${winner.beer_price_pln.toFixed(2)} zł`;
        if (resBeer) resBeer.textContent = winner.beer_name || "Piwo z kranu";
        if (resAddress) {
          if (winner.address && winner.address !== "Warszawa") {
            resAddress.textContent = `${winner.address}${winner.district ? ` (${winner.district})` : ""}`;
          } else {
            resAddress.textContent = winner.district || "Warszawa";
          }
        }

        const resAlert = document.getElementById("roulette-result-alert");
        if (resAlert) {
          if (currentVibeFilter === "cheap" && winner.beer_price_pln > 12.0) {
            resAlert.textContent = `💡 W dzielnicy ${winner.district || currentDistrictFilter} najtańsze piwo zaczyna się od ${winner.beer_price_pln.toFixed(2)} zł – wylosowano najlepszą opcję!`;
            resAlert.style.display = "block";
          } else if (lastSpinRelaxed) {
            resAlert.textContent = `💡 Wylosowano najpopularniejszy lokal w dzielnicy ${winner.district || currentDistrictFilter}!`;
            resAlert.style.display = "block";
          } else {
            resAlert.style.display = "none";
          }
        }

        if (resDist) {
          if (userLocation) {
            const d = calculateDistanceKm(userLocation[0], userLocation[1], winner.latitude, winner.longitude);
            resDist.textContent = d >= 1 ? `${d.toFixed(1)} km stąd` : `${Math.round(d * 1000)} m stąd`;
            resDist.style.display = "inline";
          } else {
            resDist.style.display = "none";
          }
        }

        if (resTags) {
          const tags = [];
          if (winner.is_craft) tags.push("⭐ Kraft");
          if (isGardenVenue(winner)) tags.push("🌿 Ogródek");
          if (winner.happy_hour || winner.happy_hour_rule) tags.push("⚡ Happy Hour");
          if (isNonAlcoholicVenue(winner)) tags.push("🌱 0.0%");
          if (winner.beer_price_pln <= 12.0) {
            tags.push("💸 Tanie piwko (≤ 12 zł)");
          } else if (currentVibeFilter === "cheap") {
            tags.push(`💰 Najtańsze w dzielnicy (${winner.beer_price_pln.toFixed(0)} zł)`);
          }
          if (winner.district) {
            tags.push(`📍 ${escapeHtml(winner.district)}`);
          }
          resTags.innerHTML = tags.map(t => `<span class="roulette-tag-chip">${t}</span>`).join("");
        }

        if (lastSpinRelaxed && currentDistrictFilter !== "all") {
          if (typeof showAppToast === "function") {
            showAppToast("Piwna Ruletka", `Wylosowano lokal w wybranej dzielnicy: ${currentDistrictFilter}! 🍺`, "📍");
          }
        }

        if (resultCard) {
          resultCard.style.display = "block";
          resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }, 2450);
    }

    if (btnSpin) {
      btnSpin.addEventListener("click", () => {
        if (typeof requestMotionPermissionIfNeeded === "function") {
          requestMotionPermissionIfNeeded();
        }
        spinRoulette();
      });
    }

    // Go to map
    if (btnGotoMap) {
      btnGotoMap.addEventListener("click", () => {
        if (!currentWinner) return;
        closeModal();
        if (window.__zoomToVenue) {
          window.__zoomToVenue(currentWinner.id);
        }
      });
    }

    // Share Winner
    if (btnShare) {
      btnShare.addEventListener("click", () => {
        if (!currentWinner) return;
        const gmapsUrl = buildGoogleMapsNavigationUrl(currentWinner);
        const text = `🎲 Piwna Ruletka poilepiwko wylosowała bar na dziś:\n` +
          `📍 ${currentWinner.name} (${currentWinner.district || 'Warszawa'})\n` +
          `🍺 ${currentWinner.beer_name || 'Piwo'}: ${currentWinner.beer_price_pln.toFixed(2)} zł\n` +
          (currentWinner.address && currentWinner.address !== "Warszawa" ? `Adres: ${currentWinner.address}\n` : "") +
          `🗺️ Nawigacja Google Maps: ${gmapsUrl}\n` +
          `Idziemy na piwko? Sprawdź na https://poilepiwko.pl 🍻`;

        if (navigator.share) {
          navigator.share({
            title: "Piwna Ruletka - poilepiwko",
            text: text
          }).catch(() => {});
        } else if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => {
            alert("📋 Wylosowany bar skopiowany do schowka! Możesz wysłać ekipie.");
          }).catch(() => {
            prompt("Skopiuj wiadomość dla ekipy:", text);
          });
        } else {
          prompt("Skopiuj wiadomość dla ekipy:", text);
        }
      });
    }

    // =========================================================================
    // 📱 Shake to Spin (Shakeomat à la Biedronka) Controller
    // =========================================================================
    let motionPermissionRequested = false;
    let motionListenerAttached = false;
    let lastX = null, lastY = null, lastZ = null;
    let lastSampleTime = 0;
    let shakeMoveCount = 0;
    let lastShakeTriggerTime = 0;

    function requestMotionPermissionIfNeeded() {
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        if (!motionPermissionRequested) {
          motionPermissionRequested = true;
          DeviceMotionEvent.requestPermission()
            .then((permissionState) => {
              if (permissionState === "granted") {
                setupMotionListener();
                console.log("[Shake] iOS DeviceMotion permission granted");
              }
            })
            .catch((err) => {
              console.log("[Shake] iOS DeviceMotion request notice:", err);
            });
        }
      } else {
        setupMotionListener();
      }
    }

    function setupMotionListener() {
      if (motionListenerAttached) return;
      motionListenerAttached = true;

      window.addEventListener("devicemotion", (e) => {
        const acc = e.accelerationIncludingGravity || e.acceleration;
        if (!acc || acc.x === null) return;
        const now = Date.now();
        if (now - lastSampleTime < 75) return;

        if (lastX !== null) {
          const deltaX = Math.abs((acc.x || 0) - lastX);
          const deltaY = Math.abs((acc.y || 0) - lastY);
          const deltaZ = Math.abs((acc.z || 0) - lastZ);

          // Strong acceleration change indicating intentional shaking
          const isShake = (deltaX > 13 && deltaY > 13) || deltaX > 18 || deltaY > 18 || deltaZ > 20;

          if (isShake) {
            shakeMoveCount++;
            if (shakeMoveCount >= 2 && (now - lastShakeTriggerTime > 2600)) {
              shakeMoveCount = 0;
              lastShakeTriggerTime = now;
              triggerShakeRoulette();
            }
          } else {
            if (now - lastSampleTime > 450) {
              shakeMoveCount = 0;
            }
          }
        }

        lastX = acc.x || 0;
        lastY = acc.y || 0;
        lastZ = acc.z || 0;
        lastSampleTime = now;
      }, { passive: true });
    }

    function triggerShakeRoulette() {
      if (isSpinning) return;

      if (navigator.vibrate) {
        try { navigator.vibrate([40, 60, 40]); } catch (e) {}
      }

      const isModalOpen = modal && modal.classList.contains("active") && modal.style.display !== "none";
      if (!isModalOpen) {
        openModal();
        if (typeof showAppToast === "function") {
          showAppToast("Shakeomat!", "📱 Wykryto potrząśnięcie! Losujemy bar...", "🍺");
        }
        setTimeout(() => {
          spinRoulette();
        }, 350);
      } else {
        const modalCard = modal.querySelector(".modal-card-roulette");
        if (modalCard) {
          modalCard.classList.add("shake-triggered");
          setTimeout(() => modalCard.classList.remove("shake-triggered"), 600);
        }
        if (typeof showAppToast === "function") {
          showAppToast("Shakeomat!", "📱 Potrząśnięto telefonem! Losujemy bar...", "🎰");
        }
        spinRoulette();
      }
    }

    // Auto-setup for browsers that don't need user permission (Android Chrome, etc.)
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission !== "function") {
      setupMotionListener();
    }

    const shakeHint = document.getElementById("roulette-shake-hint");
    if (shakeHint) {
      shakeHint.addEventListener("click", () => {
        requestMotionPermissionIfNeeded();
        triggerShakeRoulette();
      });
    }
  }

  function initPubQuizModal() {
    const modal = document.getElementById("pubquiz-modal");
    const btnOpenHeader = document.getElementById("btn-pubquiz-header");
    const btnOpenTop = document.getElementById("btn-top-pubquiz");
    const btnOpenFloat = document.getElementById("btn-pubquiz-float");
    const btnClose = document.getElementById("btn-close-pubquiz");
    const btnCloseBottom = document.getElementById("btn-close-pubquiz-bottom");

    const tabBtnGame = document.getElementById("tab-btn-quiz-game");
    const tabBtnVenues = document.getElementById("tab-btn-quiz-venues");
    const paneGame = document.getElementById("pubquiz-pane-game");
    const paneVenues = document.getElementById("pubquiz-pane-venues");

    // Screens
    const screenStart = document.getElementById("quiz-screen-start");
    const screenPlay = document.getElementById("quiz-screen-play");
    const screenResults = document.getElementById("quiz-screen-results");

    // Start Screen Elements
    const catBtns = document.querySelectorAll(".quiz-cat-btn");
    const highscoreVal = document.getElementById("quiz-highscore-val");
    const btnStartGame = document.getElementById("btn-quiz-start-game");
    const valQCount = document.getElementById("quiz-val-qcount");
    const valTime = document.getElementById("quiz-val-time");
    const btnCountLabel = document.getElementById("quiz-btn-count-label");
    const metaTimeVal = document.getElementById("quiz-meta-time-val");
    const qcountPills = document.querySelectorAll("#quiz-qcount-pills .quiz-pill-btn");
    const timePills = document.querySelectorAll("#quiz-time-pills .quiz-pill-btn");

    // Play Screen Elements
    const stepTag = document.getElementById("quiz-step-tag");
    const timerPill = document.getElementById("quiz-timer-pill");
    const progressFill = document.getElementById("quiz-progress-fill");
    const qCategory = document.getElementById("quiz-q-category");
    const qTitle = document.getElementById("quiz-q-title");
    const optionsList = document.getElementById("quiz-options-list");
    const feedbackBanner = document.getElementById("quiz-feedback-banner");
    const feedbackIco = document.getElementById("quiz-feedback-ico");
    const feedbackMsg = document.getElementById("quiz-feedback-msg");
    const btnNext = document.getElementById("btn-quiz-next-btn");

    // Results Screen Elements
    const resIco = document.getElementById("quiz-res-ico");
    const resTitle = document.getElementById("quiz-res-title");
    const resNum = document.getElementById("quiz-res-num");
    const resSub = document.getElementById("quiz-res-sub");
    const unlockedNotice = document.getElementById("quiz-unlocked-notice");
    const btnRestart = document.getElementById("btn-quiz-restart");
    const btnShare = document.getElementById("btn-quiz-share-res");

    // Venues Screen
    const venuesContainer = document.getElementById("pubquiz-venues-cards");

    // Questions Database
    const PUB_QUIZ_QUESTIONS = [
      {
        id: 1,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Co dokładnie oznacza wskaźnik IBU na etykiecie piwa kraftowego?",
        options: [
          "International Bitterness Units (poziom goryczki)",
          "Index of Beer Unpasteurized (stopień pasteryzacji)",
          "Imperial Brewing Union (certyfikat jakości)",
          "Intensity of Barley Usage (ilość słodu)"
        ],
        correct: 0,
        fact: "IBU mierzy zawartość izo-alfa-kwasów z chmielu. Czyste lagery mają zwykle 10-20 IBU, a mocne AIPA nawet 70-100 IBU!"
      },
      {
        id: 2,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Z jakiego słodu tradycyjnie warzy się polskie Piwo Grodziskie?",
        options: [
          "Pszenicznego wędzonego dymem dębowym",
          "Jęczmiennego palonego",
          "Żytniego karmelowego",
          "Owsianego prażonego"
        ],
        correct: 0,
        fact: "Piwo Grodziskie to jedyny w 100% rdzenny polski styl piwa, zwany ze względu na musowanie i szlachetność 'polskim szampanem'!"
      },
      {
        id: 3,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Który styl piwa jest historycznie nazywany 'Polskim Czarnym Złotem'?",
        options: [
          "Porter Bałtycki",
          "Milk Stout",
          "Koźlak Dubeltowy",
          "Czarny Bez Ale"
        ],
        correct: 0,
        fact: "Porter Bałtycki to piwo dolnej fermentacji o potężnym, czekoladowo-śliwkowym aromacie. Polska jest uznawana za światową stolicę tego stylu!"
      },
      {
        id: 4,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Jaki amerykański chmiel zapoczątkował światową rewolucję kraftową aromatem cytrusów i grejpfruta?",
        options: [
          "Cascade",
          "Lubelski",
          "Saaz (Żatecki)",
          "Hallertau"
        ],
        correct: 0,
        fact: "Chmiel Cascade, wprowadzony w USA w latach 70., dał początek kultowemu stylowi American Pale Ale (APA)!"
      },
      {
        id: 5,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "W jakiej temperaturze najlepiej serwować mocne piwa ciemne (np. Imperial Stout / Porter)?",
        options: [
          "12°C - 16°C (nieco chłodniejsze niż temperatura pokojowa)",
          "0°C - 2°C (prosto z zamrażalnika)",
          "6°C - 8°C (lodówkowa)",
          "Powyżej 25°C (na ciepło)"
        ],
        correct: 0,
        fact: "Zbyt mocne zmrożenie ciemnego kraftu 'zamyka' aromaty palonej kawy, czekolady i suszonych owoców!"
      },
      {
        id: 6,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Co oznacza termin 'chmielenie na zimno' (Dry Hopping)?",
        options: [
          "Dodanie chmielu do leżakującego piwa w celu podbicia aromatu",
          "Zamrażanie szyszek chmielu przed wrzuceniem do kotła",
          "Używanie wyłącznie chmielu z mroźnych rejonów świata",
          "Podawanie piwa w zmrożonym kuflu"
        ],
        correct: 0,
        fact: "Chmielenie na zimno nie zwiększa goryczki, lecz uwalnia wspaniałe, świeże olejki eteryczne z chmielu."
      },
      {
        id: 7,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Czym charakteryzuje się styl New England IPA (NEIPA / Hazy IPA)?",
        options: [
          "Soczystym smakiem tropików, mętną barwą i gładką, niską goryczką",
          "Smakiem wędzonej śliwki i wysoką kwasowością",
          "Absolutną klarownością i smakiem palonego karmelu",
          "Brakem gazu i drożdży"
        ],
        correct: 0,
        fact: "NEIPA to hit ostatnich lat – dzięki płatkom owsianym i chmieleniu późnymi dawkami smakuje jak świeży sok z owoców tropikalnych!"
      },
      {
        id: 8,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Który składnik NIE występował w bawarskim prawie czystości Reinheitsgebot z 1516 roku?",
        options: [
          "Drożdże (nie znano jeszcze ich mikrobiologicznej natury)",
          "Woda",
          "Chmiel",
          "Słód jęczmienny"
        ],
        correct: 0,
        fact: "W 1516 roku drożdży jeszcze nie wymieniono, bo myślano, że fermentacja zachodzi samoistnie. Drożdże dodano dopiero po badaniach Ludwika Pasteura!"
      },
      {
        id: 9,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Gdzie w Warszawie znajduje się słynne zagłębie barowe zwane 'Pawilonami'?",
        options: [
          "Na tyłach Nowego Światu i ulicy Foksal",
          "Przy Placu Zbawiciela",
          "Na Bulwarach Wiślanych",
          "Przy Dworcu Wileńskim"
        ],
        correct: 0,
        fact: "Pawilony powstały w latach 70. jako rzemieślnicze warsztaty szewców i krawców, a z czasem stały się kultowym zagłębiem pubów studenckich!"
      },
      {
        id: 10,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Który warszawski most słynie z letnich spotkań przy piwku na betonowych schodkach nad Wisłą?",
        options: [
          "Most Poniatowskiego",
          "Most Świętokrzyski",
          "Most Śląsko-Dąbrowski",
          "Most Gdański"
        ],
        correct: 0,
        fact: "Schodki pod Mostem Poniatowskiego i Bulwary Flotylli Wiślanej to latem jedno z najpopularniejszych miejsc spotkań w stolicy!"
      },
      {
        id: 11,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "W której dzielnicy Warszawy znajdują się historyczne dawne Browary Haberbusch i Schiele?",
        options: [
          "Wola",
          "Mokotów",
          "Żoliborz",
          "Targówek"
        ],
        correct: 0,
        fact: "Zakłady Haberbusch i Schiele na Woli były w XIX i XX wieku największym producentem piwa w całym Królestwie Polskim!"
      },
      {
        id: 12,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Która ulica w Śródmieściu Południowym jest uznawana za nieoficjalną 'stolicę warszawskiego kraftu'?",
        options: [
          "Nowogrodzka",
          "Marszałkowska",
          "Krucza",
          "Miodowa"
        ],
        correct: 0,
        fact: "Przy ul. Nowogrodzkiej działa zagłębie pionierskich multitapów, m.in. Kufle i Kapsle, Jabeerwocky czy Drugie Dno!"
      },
      {
        id: 13,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Jaki kultowy praski lokal przy ul. Ząbkowskiej słynie z wystroju vintage, starych maszyn do szycia i klimatu retro?",
        options: [
          "W Oparach Absurdu",
          "Łysy Pingwin",
          "Sens Nonsensu",
          "Skład Butelek"
        ],
        correct: 0,
        fact: "W Oparach Absurdu przy Ząbkowskiej to wizytówka klimatu praskiej bohemy z dywanami, antykami i świetnym piwem!"
      },
      {
        id: 14,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Jak w gwarze warszawskiej nazywano tradycyjny zestaw biesiadny: dwa kieliszki i zimne nóżki?",
        options: [
          "Lorneta z meduzą",
          "Szabla z ogórkiem",
          "Karafka z karpiem",
          "Kielich z pyzą"
        ],
        correct: 0,
        fact: "'Lorneta z meduzą' to absolutna klasyka warszawskiej gastronomii okresu PRL i knajp z tradycjami!"
      },
      {
        id: 15,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "W którym roku otwarto zrewitalizowaną Halę Koszyki z restauracjami i barami?",
        options: [
          "2016",
          "2010",
          "2020",
          "2005"
        ],
        correct: 0,
        fact: "Otwarta jesienią 2016 roku Hala Koszyki zapoczątkowała modę na food halle w Warszawie!"
      },
      {
        id: 16,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Jak nazywa się plac w Warszawie, zwany pieszczotliwie 'Placem Hipstera' z licznymi ogródkami barowymi?",
        options: [
          "Plac Zbawiciela",
          "Plac Trzech Krzyży",
          "Plac Bankowy",
          "Plac Konstytucji"
        ],
        correct: 0,
        fact: "Plac Zbawiciela z 'Planem B', 'Karmą' i 'Charlotte' to jedno z najżywszych miejsc spotkań towarzyskich w Warszawie!"
      },
      {
        id: 17,
        cat: "culture",
        catName: "Kultura Barowa & Ciekawostki 💡",
        q: "Co oznacza zamówienie 'kolejki' przy barze?",
        options: [
          "Postawienie rundy trunków dla wszystkich przyjaciół przy stoliku",
          "Ustawienie się w kolejce po piwo",
          "Zamówienie najtańszego piwa z nalewaka",
          "Rezerwację stolika na następny dzień"
        ],
        correct: 0,
        fact: "Stawianie kolejki to międzynarodowy i polski rytuał gościnności – w dobrym tonie jest, by w trakcie wieczoru kolejkę postawił każdy!"
      },
      {
        id: 18,
        cat: "culture",
        catName: "Kultura Barowa & Ciekawostki 💡",
        q: "Dlaczego według starego barowego przesądu należy patrzeć w oczy podczas wznoszenia toastu?",
        options: [
          "Aby okazać szczerość i uniknąć '7 lat nieszczęścia'",
          "Żeby nie rozlać piwa na stół",
          "Bo nakazywały to dawne przepisy policyjne",
          "Żeby sprawdzić czy nikt nie pije wody"
        ],
        correct: 0,
        fact: "Tradycja wywodzi się ze średniowiecza, gdy patrzenie w oczy i mocne uderzanie pucharami miało gwarantować, że napój nie jest zatruty!"
      },
      {
        id: 19,
        cat: "culture",
        catName: "Kultura Barowa & Ciekawostki 💡",
        q: "Jaki polski dodatek do jasnego piwa podawanego z rurką dziwi turystów z zagranicy?",
        options: [
          "Słodki sok malinowy lub imbirowy",
          "Sól morska i limonka",
          "Czosnek i chrzan",
          "Mleko skondensowane"
        ],
        correct: 0,
        fact: "'Piwo z sokiem' to unikalny polski fenomen barowy, obecny w menu pubów od dziesięcioleci!"
      },
      {
        id: 20,
        cat: "culture",
        catName: "Kultura Barowa & Ciekawostki 💡",
        q: "Co w slangu oznacza termin 'Pub Crawl'?",
        options: [
          "Trasa barowa polegająca na odwiedzeniu kilku lokali jednego wieczoru",
          "Czyszczenie instalacji nalewaka piwnego",
          "Zamawianie wyłącznie ciemnych piw",
          "Zawody w najszybszym wypiciu pół litra"
        ],
        correct: 0,
        fact: "Pub Crawl to świetny sposób na poznanie nocnego życia miasta i odkrycie ukrytych barowych perełek!"
      },
      {
        id: 21,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Czym jest 'ekstrakt początkowy' (stopnie Blg / Plato) podawany na butelce piwa?",
        options: [
          "Zawartością cukrów ze słodu w brzeczce przed fermentacją",
          "Końcową zawartością czystego alkoholu",
          "Wskaźnikiem kwasowości i goryczki",
          "Ilością użytych gatunków chmielu"
        ],
        correct: 0,
        fact: "Stopnie Ballinga (°Blg) lub Plato określają gęstość brzeczki – im wyższy ekstrakt, tym piwo jest treściwsze i ma potencjał na więcej alkoholu!"
      },
      {
        id: 22,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Co charakteryzuje tradycyjne niemieckie piwo w stylu 'Gose'?",
        options: [
          "Lekka kwasowość oraz dodatek soli i kolendry",
          "Potężna goryczka i czarny jak smoła kolor",
          "Słodki smak miodu pitnego i brak bąbelków",
          "Użycie wyłącznie słodu palonego"
        ],
        correct: 0,
        fact: "Gose to historyczny styl z Lipska i Goslar – orzeźwiające, lekko słone i kwaskowate, doskonałe na upalne letnie dni!"
      },
      {
        id: 23,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Co oznacza skrót 'DDH' na puszkach nowoczesnych piw kraftowych?",
        options: [
          "Double Dry Hopped (podwójnie chmielone na zimno)",
          "Direct Delivery Hop (chmiel prosto z plantacji)",
          "Dark Draft Honey (ciemne miodowe z kranu)",
          "Double Density Hazy (podwójna mętność)"
        ],
        correct: 0,
        fact: "DDH to technika dodawania podwójnej porcji aromatycznego chmielu na etapie leżakowania, dająca potężną bombę cytrusów i owoców tropikalnych!"
      },
      {
        id: 24,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Który styl piwa fermentowany jest spontanicznie dzikimi drożdżami w otwartych kadziach?",
        options: [
          "Lambic / Wild Ale",
          "Klasyczny Pilsner",
          "Koźlak Majowy (Maibock)",
          "Dry Stout"
        ],
        correct: 0,
        fact: "Lambiki powstają w dolinie rzeki Zenne w Belgii, gdzie brzeczka stygnie na otwartym poddaszu i łapie dzikie drożdże z powietrza!"
      },
      {
        id: 25,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Co to jest 'laktoza' dodawana do piw typu Milk Stout lub Pastry Sour?",
        options: [
          "Cukier mleczny niefermentowany przez drożdże piwne, dający słodycz i gładkość",
          "Zsiadłe mleko dodawane do gotującej się brzeczki",
          "Pianotwórczy ekstrakt z białka serwatkowego",
          "Naturalny barwnik rozjaśniający ciemne piwo"
        ],
        correct: 0,
        fact: "Drożdże piwne nie potrafią strawić laktozy, dzięki czemu piwo zyskuje deserowy, aksamitny profil i kremową teksturę!"
      },
      {
        id: 26,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "W którym mieście w 1842 roku uwarzono pierwszego na świecie jasnego, klarownego Pilsnera?",
        options: [
          "Pilzno (Czechy)",
          "Monachium (Niemcy)",
          "Bruksela (Belgia)",
          "Żywiec (Polska)"
        ],
        correct: 0,
        fact: "Josef Groll uwarzył pierwszego Pilsnera w browarze Měšťanský pivovar w Pilźnie. Do dziś Pilsner Urquell wyznacza kanon tego stylu!"
      },
      {
        id: 27,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Czym jest 'Session IPA'?",
        options: [
          "Lżejszą, bardzo pijalną wersją IPA o zawartości alkoholu ok. 3.5% - 4.5%",
          "Mocarnym Imperial IPA o zawartości alkoholu powyżej 10%",
          "Piwem leżakowanym w beczkach po szkockiej whisky",
          "Piwem warzonym wyłącznie podczas festiwali piwnych"
        ],
        correct: 0,
        fact: "'Session' w piwowarstwie oznacza piwa stworzone do wielogodzinnych spotkań towarzyskich – lekkie w alkoholu, ale pełne aromatu chmielu!"
      },
      {
        id: 28,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Jaki gatunek drożdży odpowiada za fermentację tradycyjnych piw typu Ale (górna fermentacja)?",
        options: [
          "Saccharomyces cerevisiae",
          "Saccharomyces pastorianus",
          "Lactobacillus brevis",
          "Candida utilis"
        ],
        correct: 0,
        fact: "Saccharomyces cerevisiae pracują w wyższych temperaturach (16-24°C), tworząc owocowe estry i przyprawowe fenole!"
      },
      {
        id: 29,
        cat: "beer",
        catName: "Style & Kraft 🍺",
        q: "Co charakteryzuje piwo leżakowane w technologii 'Nitro' (z azotem, jak Guinness)?",
        options: [
          "Aksamitna, gęsta piana i hipnotyzujący efekt kaskadowy bąbelków opadających w dół",
          "Silne nagazowanie szczypiące w język jak woda sodowa",
          "Brak jakiejkolwiek piany",
          "Metaliczny posmak żelaza"
        ],
        correct: 0,
        fact: "Pęcherzyki azotu są znacznie mniejsze niż dwutlenku węgla, co daje kremową pianę przypominającą ubitą śmietankę!"
      },
      {
        id: 30,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Który kultowy klubo-pub w Parku Pole Mokotowskie słynie z ogromnego grilla i ogródka?",
        options: [
          "Lolek Grill & Bar",
          "Zielona Gęś",
          "Bolek",
          "Plan B"
        ],
        correct: 0,
        fact: "Pub Lolek na Polu Mokotowskim od dziesięcioleci gromadzi warszawiaków na wielkie biesiady z karkówką i piwem pod chmurką!"
      },
      {
        id: 31,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "W którym gmachu w Warszawie mieścił się słynny multitap 'Cuda na Kiju'?",
        options: [
          "Dawny Dom Partii (KC PZPR) przy Rondzie de Gaulle'a",
          "Pałac Kultury i Nauki",
          "Hala Mirowska",
          "Zamek Królewski"
        ],
        correct: 0,
        fact: "'Cuda na Kiju' powstały w przeszklonym pawilonie dawnej siedziby KC PZPR, tworząc niezwykły kontrast popkulturowy!"
      },
      {
        id: 32,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Gdzie w Warszawie w dawnej wytwórni wódek powstało centrum kulturalno-gastronomiczne z barami?",
        options: [
          "Centrum Praskie Koneser",
          "Fabryka Norblina",
          "Elektrownia Powiśle",
          "Stacja Muzeum"
        ],
        correct: 0,
        fact: "Koneser na Pradze-Północ to odrestaurowana neogotycka fabryka z XIX wieku, gdzie dziś tętni życie towarzyskie i piwne!"
      },
      {
        id: 33,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Który warszawski festiwal piwny odbywa się na stadionie Legii Warszawa przy ul. Łazienkowskiej?",
        options: [
          "Warszawski Festiwal Piwa (WFP)",
          "Beer Geek Madness",
          "Chmielaki Krasnostawskie",
          "Silesia Beer Fest"
        ],
        correct: 0,
        fact: "WFP to jeden z najważniejszych i najbardziej prestiżowych festiwali piw rzemieślniczych w całej Europie Środkowej!"
      },
      {
        id: 34,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "W której dzielnicy Warszawy znajduje się historyczny Fort Bema z popularnymi lokalami i ogródkami?",
        options: [
          "Bemowo",
          "Bielany",
          "Wola",
          "Żoliborz"
        ],
        correct: 0,
        fact: "Fort Bema otoczony fosą to ulubione miejsce spacerów i spotkań mieszkańców zachodniej Warszawy!"
      },
      {
        id: 35,
        cat: "warsaw",
        catName: "Warszawska Noc 🏙️",
        q: "Co warszawiacy mają na myśli, mówiąc w letni piątkowy wieczór 'idziemy na Schodki'?",
        options: [
          "Spotkanie towarzyskie na betonowych schodkach Bulwarów Wiślanych",
          "Wejście schodami na taras widokowy Pałacu Kultury",
          "Zejście do stacji Metra Centrum ('Patelnia')",
          "Pojście do piwnicy na Starym Mieście"
        ],
        correct: 0,
        fact: "Schodki nad Wisłą to letnia stolica warszawskiego chilloutu, gdzie spotykają się tysiące studentów i młodych ludzi!"
      },
      {
        id: 36,
        cat: "culture",
        catName: "Kultura Barowa & Ciekawostki 💡",
        q: "Co to jest 'Multitap' w nowoczesnej kulturze barowej?",
        options: [
          "Pub posiadający wiele kranów (nalewaków) z rotacyjną ofertą piw rzemieślniczych",
          "Kran podający jednocześnie piwo i wino",
          "Bar samoobsługowy bez personelu",
          "Specjalny kran do mycia kufli barowych"
        ],
        correct: 0,
        fact: "W warszawskich multitapach (np. Jabeerwocky, Kufle i Kapsle) można znaleźć od 12 do nawet 30 kranów z piwami z całego świata!"
      },
      {
        id: 37,
        cat: "culture",
        catName: "Kultura Barowa & Ciekawostki 💡",
        q: "Które szkło jest tradycyjnie polecane do degustacji belgijskich piw klasztornych (Trapistów)?",
        options: [
          "Kielich (Chalice lub Goblet) o szerokiej czaszy",
          "Wysoka, wąska szklanka do pszenicy",
          "Gruby kufel z uchem (Mass)",
          "Plastikowy kubek jednorazowy"
        ],
        correct: 0,
        fact: "Szeroka czasza kielicha pozwala uwolnić bogate aromaty przypraw, suszonych śliwek i ciemnych owoców charakterystyczne dla belgijskich piw!"
      },
      {
        id: 38,
        cat: "culture",
        catName: "Kultura Barowa & Ciekawostki 💡",
        q: "Dlaczego tradycyjny kufel do piwa ma grube ucho?",
        options: [
          "Aby dłoń nie ogrzewała schłodzonego piwa przez ścianki naczynia",
          "Żeby kufel był cięższy podczas wznoszenia toastów",
          "Dla ułatwienia wieszania na haku pod barem",
          "Bo dawniej szkło było zbyt kruche"
        ],
        correct: 0,
        fact: "Trzymając kufel za ucho, izolujemy piwo od ciepła naszej dłoni, co pozwala cieszyć się optymalną temperaturą trunku znacznie dłużej!"
      },
      {
        id: 39,
        cat: "culture",
        catName: "Kultura Barowa & Ciekawostki 💡",
        q: "Co w sensoryce piwnej oznacza pojęcie 'Gushing'?",
        options: [
          "Gwałtowne, samoistne wystrzelenie piany z butelki tuż po jej otwarciu",
          "Opadanie piany w szklance poniżej minuty",
          "Mętność piwa wywołana niską temperaturą",
          "Pojawienie się osadu drożdżowego na dnie"
        ],
        correct: 0,
        fact: "Gushing to piwny gejzer – spowodowany zbyt wysokim nagazowaniem, zakażeniem mikrobiologicznym lub poruszeniem butelki!"
      },
      {
        id: 40,
        cat: "culture",
        catName: "Kultura Barowa & Ciekawostki 💡",
        q: "Co oznacza popularne barowe hasło 'piwny brzuszek' i skąd wzięło się to pojęcie?",
        options: [
          "Z faktu, że piwo pobudza apetyt na kaloryczne przekąski, a alkohol spowalnia metabolizm",
          "Z bezpośredniej zawartości tłuszczu w piwie",
          "Z ilości drożdży pęczniejących w żołądku",
          "Z połykania bąbelków dwutlenku węgla"
        ],
        correct: 0,
        fact: "Samo piwo nie zawiera tłuszczu, ale chmiel pobudza wydzielanie kwasów żołądkowych, wywołując wilczy apetyt na pizzę, orzeszki czy frytki!"
      }
    ];

    const LIVE_QUIZ_VENUES = [
      {
        name: "Drugie Dno Craft Beer Camp",
        day: "Poniedziałki & Środy 19:30",
        days: [1, 3],
        address: "Nowogrodzka 4, Śródmieście",
        desc: "Jeden z najpopularniejszych Pub Quizów w Warszawie! Dziesiątki kranów kraftowych, energiczna rywalizacja drużynowa i nagrody.",
        venueId: "srodmiescie-drugie-dno",
        lat: 52.2294,
        lng: 21.0182
      },
      {
        name: "Shamrock Irish Pub",
        day: "Wtorki 20:00",
        days: [2],
        address: "Zgoda 5, Śródmieście",
        desc: "Prawdziwy wyspiarski pub z tradycyjnym Pub Quizem, świeżym Guinnessem i biesiadną atmosferą.",
        venueId: "srodmiescie-shamrock",
        lat: 52.2341,
        lng: 21.0129
      },
      {
        name: "Hoppiness Beer & Food",
        day: "Środy 19:00",
        days: [3],
        address: "Chmielna 24, Śródmieście",
        desc: "Świetna lokalizacja w centrum, wyśmienite burgery, autorskie krafty i zacięta walka o puchar wiedzy.",
        venueId: "srodmiescie-hoppiness",
        lat: 52.2326,
        lng: 21.0152
      },
      {
        name: "Beer Station Centrum",
        day: "Czwartki 20:00",
        days: [4],
        address: "Lwowska 17, Śródmieście Południowe",
        desc: "Quizy tematyczne: filmowe, muzyczne i wiedzy ogólnej. Doskonała selekcja piw i przyjazny, pubowy klimat.",
        venueId: "srodmiescie-beer-station",
        lat: 52.2223,
        lng: 21.0125
      },
      {
        name: "Jabeerwocky Craft Beer Pub",
        day: "Piątki 20:00 (cykliczny pub quiz)",
        days: [5],
        address: "Nowogrodzka 12, Śródmieście",
        desc: "Klimatyczny craft bar z 17 kranami, piwne pojedynki drużynowe i doskonała selekcja polskich browarów.",
        venueId: "srodmiescie-jabeerwocky",
        lat: 52.2291,
        lng: 21.0165
      },
      {
        name: "Same Krafty (Stare Miasto)",
        day: "Soboty 18:00 (edycje tematyczne)",
        days: [6],
        address: "Nowomiejska 10, Stare Miasto",
        desc: "Turnieje wiedzy o piwie, historii Warszawy i popkulturze tuż przy Rynku Starego Miasta.",
        venueId: "srodmiescie-same-krafty",
        lat: 52.2505,
        lng: 21.0099
      },
      {
        name: "Kufle i Kapsle",
        day: "Niedziele 18:30",
        days: [0],
        address: "Nowogrodzka 25, Śródmieście Południowe",
        desc: "Pionierzy polskiego kraftu. Cykliczne pub quizy dla koneserów piwa, sensoryki i ciekawostek o stylach.",
        venueId: "srodmiescie-kufle-i-kapsle",
        lat: 52.2289,
        lng: 21.0135
      }
    ];

    // State
    let selectedCategory = "all";
    let selectedQuestionsCount = 5;
    let selectedTimeLimit = 20; // in seconds, 0 = unlimited
    let selectedQuizDay = "all";
    let activeQuestions = [];
    let currentQuestionIdx = 0;
    let currentScore = 0;
    let timerInterval = null;
    let timerSeconds = 20;
    let hasAnswered = false;

    function formatQuestionCount(n) {
      if (n === 1) return "1 pytanie";
      if (n >= 2 && n <= 4) return `${n} pytania`;
      return `${n} pytań`;
    }

    function getHighscore(count = selectedQuestionsCount) {
      const stored = localStorage.getItem(`poilepiwko_pubquiz_highscore_${count}`);
      if (stored !== null) return parseInt(stored, 10);
      if (count === 5) {
        return parseInt(localStorage.getItem("poilepiwko_pubquiz_highscore") || "0", 10);
      }
      return 0;
    }

    function updateHighscoreDisplay() {
      if (highscoreVal) {
        const hs = getHighscore(selectedQuestionsCount);
        highscoreVal.textContent = `${hs}/${selectedQuestionsCount}`;
      }
    }

    function updateSettingsDisplay() {
      if (valQCount) valQCount.textContent = formatQuestionCount(selectedQuestionsCount);
      if (btnCountLabel) btnCountLabel.textContent = formatQuestionCount(selectedQuestionsCount);
      if (valTime) valTime.textContent = selectedTimeLimit === 0 ? "Bez limitu" : `${selectedTimeLimit}s`;
      if (metaTimeVal) metaTimeVal.textContent = selectedTimeLimit === 0 ? "Bez limitu" : `${selectedTimeLimit}s / pytanie`;
      updateHighscoreDisplay();
    }

    // Pill selectors
    qcountPills.forEach(pill => {
      pill.addEventListener("click", () => {
        qcountPills.forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        selectedQuestionsCount = parseInt(pill.getAttribute("data-count"), 10) || 5;
        updateSettingsDisplay();
      });
    });

    timePills.forEach(pill => {
      pill.addEventListener("click", () => {
        timePills.forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        selectedTimeLimit = parseInt(pill.getAttribute("data-time"), 10);
        updateSettingsDisplay();
      });
    });

    function switchQuizTab(tab) {
      if (tab === "game") {
        if (tabBtnGame) tabBtnGame.classList.add("active");
        if (tabBtnVenues) tabBtnVenues.classList.remove("active");
        if (paneGame) paneGame.style.display = "block";
        if (paneVenues) paneVenues.style.display = "none";
      } else {
        if (tabBtnGame) tabBtnGame.classList.remove("active");
        if (tabBtnVenues) tabBtnVenues.classList.add("active");
        if (paneGame) paneGame.style.display = "none";
        if (paneVenues) paneVenues.style.display = "block";
        renderLiveVenues();
      }
    }

    if (tabBtnGame) tabBtnGame.addEventListener("click", () => switchQuizTab("game"));
    if (tabBtnVenues) tabBtnVenues.addEventListener("click", () => switchQuizTab("venues"));

    // Day filter chips setup
    const quizDayChips = document.querySelectorAll(".quiz-day-chip");
    quizDayChips.forEach(chip => {
      chip.addEventListener("click", () => {
        quizDayChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        selectedQuizDay = chip.getAttribute("data-day") || "all";
        renderLiveVenues();
      });
    });

    function renderLiveVenues() {
      if (!venuesContainer) return;
      const todayDay = new Date().getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

      let filtered = LIVE_QUIZ_VENUES;
      if (selectedQuizDay === "today") {
        filtered = LIVE_QUIZ_VENUES.filter(v => v.days && v.days.includes(todayDay));
      } else if (selectedQuizDay !== "all") {
        const targetDay = parseInt(selectedQuizDay, 10);
        filtered = LIVE_QUIZ_VENUES.filter(v => v.days && v.days.includes(targetDay));
      }

      if (filtered.length === 0) {
        venuesContainer.innerHTML = `
          <div class="empty-state-hint" style="padding: 28px 14px; text-align: center;">
            <div style="font-size: 2.2rem; margin-bottom: 8px;">🍻📅</div>
            <strong>Brak zaplanowanych quizów w ten dzień tygodnia</strong>
            <p style="color: #94a3b8; font-size: 0.78rem; margin-top: 4px;">
              Sprawdź inny dzień lub kliknij „Wszystkie”, aby zobaczyć pełen harmonogram Warszawy!
            </p>
          </div>
        `;
        return;
      }

      venuesContainer.innerHTML = filtered.map(v => {
        const isToday = v.days && v.days.includes(todayDay);
        return `
          <div class="pubquiz-venue-card">
            <div class="venue-card-head">
              <span class="venue-card-title">${escapeHtml(v.name)}</span>
              <span class="venue-day-badge">${isToday ? "🔥 Dziś! " : ""}${escapeHtml(v.day)}</span>
            </div>
            <div class="venue-card-details">
              <span>📍 ${escapeHtml(v.address)}</span>
              <span>🍺 ${escapeHtml(v.desc)}</span>
            </div>
            <button type="button" class="btn-venue-show-map" data-lat="${v.lat}" data-lng="${v.lng}" data-name="${escapeHtml(v.name)}">
              📍 Pokaż na mapie
            </button>
          </div>
        `;
      }).join("");

      venuesContainer.querySelectorAll(".btn-venue-show-map").forEach(btn => {
        btn.addEventListener("click", () => {
          const lat = parseFloat(btn.getAttribute("data-lat"));
          const lng = parseFloat(btn.getAttribute("data-lng"));
          window.__closePubQuiz();
          if (map && !isNaN(lat) && !isNaN(lng)) {
            map.flyTo([lat, lng], 16, { animate: true, duration: 1 });
            showAppToast("Lokalizacja Pub Quizu", btn.getAttribute("data-name"), "📍");
          }
        });
      });
    }

    catBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        catBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedCategory = btn.getAttribute("data-cat") || "all";
      });
    });

    function startRound() {
      let pool = PUB_QUIZ_QUESTIONS;
      if (selectedCategory !== "all") {
        pool = PUB_QUIZ_QUESTIONS.filter(q => q.cat === selectedCategory);
        if (pool.length < selectedQuestionsCount) {
          const others = PUB_QUIZ_QUESTIONS.filter(q => q.cat !== selectedCategory);
          pool = [...pool, ...others];
        }
      }

      // Shuffle question pool and take selected count
      const shuffled = [...pool].sort(() => 0.5 - Math.random());
      const chosen = shuffled.slice(0, selectedQuestionsCount);

      // SHUFFLE OPTIONS WITH FISHER-YATES:
      // Guarantees that the correct answer is NOT always 'A', but evenly distributed among A, B, C, D!
      activeQuestions = chosen.map(q => {
        const correctText = q.options[q.correct];
        const shuffledOptions = [...q.options];
        for (let i = shuffledOptions.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffledOptions[i], shuffledOptions[j]] = [shuffledOptions[j], shuffledOptions[i]];
        }
        const newCorrectIdx = shuffledOptions.indexOf(correctText);
        return {
          ...q,
          options: shuffledOptions,
          correct: newCorrectIdx
        };
      });

      currentQuestionIdx = 0;
      currentScore = 0;

      if (screenStart) screenStart.style.display = "none";
      if (screenResults) screenResults.style.display = "none";
      if (screenPlay) screenPlay.style.display = "block";

      renderQuestion();
    }

    function renderQuestion() {
      if (timerInterval) clearInterval(timerInterval);
      hasAnswered = false;

      const q = activeQuestions[currentQuestionIdx];
      if (!q) {
        showResults();
        return;
      }

      const totalCount = activeQuestions.length;
      const qNum = currentQuestionIdx + 1;
      if (stepTag) stepTag.textContent = `Pytanie ${qNum} z ${totalCount}`;
      if (progressFill) progressFill.style.width = `${(qNum / totalCount) * 100}%`;
      if (qCategory) qCategory.textContent = q.catName;
      if (qTitle) qTitle.textContent = q.q;

      if (feedbackBanner) feedbackBanner.style.display = "none";
      if (btnNext) btnNext.style.display = "none";

      const letters = ["A", "B", "C", "D"];
      if (optionsList) {
        optionsList.innerHTML = q.options.map((opt, i) => `
          <button type="button" class="quiz-option-btn" data-idx="${i}">
            <span class="quiz-option-letter">${letters[i]}</span>
            <span>${escapeHtml(opt)}</span>
          </button>
        `).join("");

        optionsList.querySelectorAll(".quiz-option-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            if (hasAnswered) return;
            const chosenIdx = parseInt(btn.getAttribute("data-idx"), 10);
            handleAnswer(chosenIdx);
          });
        });
      }

      if (selectedTimeLimit === 0) {
        if (timerPill) timerPill.textContent = "⏱️ Bez limitu";
      } else {
        timerSeconds = selectedTimeLimit;
        if (timerPill) timerPill.textContent = `⏱️ ${timerSeconds}s`;
        timerInterval = setInterval(() => {
          timerSeconds--;
          if (timerPill) timerPill.textContent = `⏱️ ${timerSeconds}s`;
          if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            if (!hasAnswered) {
              handleAnswer(-1);
            }
          }
        }, 1000);
      }
    }

    function handleAnswer(chosenIdx) {
      hasAnswered = true;
      if (timerInterval) clearInterval(timerInterval);

      const q = activeQuestions[currentQuestionIdx];
      const isCorrect = chosenIdx === q.correct;
      if (isCorrect) currentScore++;

      const allBtns = optionsList ? optionsList.querySelectorAll(".quiz-option-btn") : [];
      allBtns.forEach((b, idx) => {
        b.disabled = true;
        if (idx === q.correct) {
          b.classList.add("correct");
        } else if (idx === chosenIdx) {
          b.classList.add("wrong");
        }
      });

      if (feedbackBanner && feedbackMsg && feedbackIco) {
        feedbackBanner.style.display = "flex";
        if (chosenIdx === -1) {
          feedbackIco.textContent = "⏱️";
          feedbackMsg.innerHTML = `<strong>Czas minął!</strong> Poprawna odpowiedź: <em>${escapeHtml(q.options[q.correct])}</em>. ${escapeHtml(q.fact)}`;
        } else if (isCorrect) {
          feedbackIco.textContent = "🎉";
          feedbackMsg.innerHTML = `<strong>Brawo! Trafiona odpowiedź!</strong> ${escapeHtml(q.fact)}`;
        } else {
          feedbackIco.textContent = "💡";
          feedbackMsg.innerHTML = `<strong>Niestety pomyłka!</strong> Poprawna odpowiedź: <em>${escapeHtml(q.options[q.correct])}</em>. ${escapeHtml(q.fact)}`;
        }
      }

      if (btnNext) {
        btnNext.style.display = "block";
        const totalCount = activeQuestions.length;
        btnNext.querySelector("span").textContent = currentQuestionIdx === totalCount - 1 ? "Zobacz wyniki końcowe 🏆" : "Następne pytanie →";
      }
    }

    if (btnNext) {
      btnNext.addEventListener("click", () => {
        const totalCount = activeQuestions.length;
        if (currentQuestionIdx < totalCount - 1) {
          currentQuestionIdx++;
          renderQuestion();
        } else {
          showResults();
        }
      });
    }

    function showResults() {
      if (timerInterval) clearInterval(timerInterval);
      if (screenPlay) screenPlay.style.display = "none";
      if (screenResults) screenResults.style.display = "block";

      const totalCount = activeQuestions.length;
      if (resNum) resNum.textContent = currentScore;
      const resTotal = document.querySelector(".quiz-res-total");
      if (resTotal) resTotal.textContent = `/${totalCount}`;

      const prevHigh = getHighscore(totalCount);
      if (currentScore > prevHigh) {
        localStorage.setItem(`poilepiwko_pubquiz_highscore_${totalCount}`, currentScore);
        if (totalCount === 5) {
          localStorage.setItem("poilepiwko_pubquiz_highscore", currentScore);
        }
        updateHighscoreDisplay();
      }

      const ratio = currentScore / totalCount;
      if (ratio === 1) {
        if (resIco) resIco.textContent = "👑";
        if (resTitle) resTitle.textContent = "Mistrz Warszawskiego Pub Quizu!";
        if (resSub) resSub.textContent = `Fenomenalnie! Komplet ${currentScore}/${totalCount} punktów! Warszawa i krafty nie mają przed Tobą żadnych tajemnic.`;

        if (totalCount >= 5) {
          const alreadyWon = localStorage.getItem("poilepiwko_pubquiz_won") === "true";
          localStorage.setItem("poilepiwko_pubquiz_won", "true");
          if (unlockedNotice) unlockedNotice.style.display = "block";

          const unlockedBadges = loadUnlockedBadges();
          if (!unlockedBadges.includes("pubquiz_master")) {
            unlockedBadges.push("pubquiz_master");
            saveUnlockedBadges(unlockedBadges);
            showAppToast("Odblokowano Odznakę Paszportu!", `Mistrz Pub Quizu 🧠 (${currentScore}/${totalCount} pkt)`, "👑", 5000);
          }
          updatePassportCounters();
        } else {
          if (unlockedNotice) unlockedNotice.style.display = "none";
        }
      } else if (ratio >= 0.7) {
        if (resIco) resIco.textContent = "🥇";
        if (resTitle) resTitle.textContent = "Znakomity Piwoznawca!";
        if (resSub) resSub.textContent = `Świetny wynik (${currentScore}/${totalCount})! Niewiele zabrakło do perfekcji.`;
        if (unlockedNotice) unlockedNotice.style.display = "none";
      } else if (ratio >= 0.4) {
        if (resIco) resIco.textContent = "🍻";
        if (resTitle) resTitle.textContent = "Doświadczony Piwosz!";
        if (resSub) resSub.textContent = `Dobra runda (${currentScore}/${totalCount})! Kilka pytań było podchwytliwych, ale znasz warszawskie klimaty.`;
        if (unlockedNotice) unlockedNotice.style.display = "none";
      } else {
        if (resIco) resIco.textContent = "🎓";
        if (resTitle) resTitle.textContent = "Praktykant na Pawilonach";
        if (resSub) resSub.textContent = `Wynik: ${currentScore}/${totalCount}. Każda barowa wiedza wymaga praktyki – zagraj jeszcze raz!`;
        if (unlockedNotice) unlockedNotice.style.display = "none";
      }
    }

    if (btnStartGame) btnStartGame.addEventListener("click", startRound);
    if (btnRestart) {
      btnRestart.addEventListener("click", () => {
        if (screenResults) screenResults.style.display = "none";
        if (screenStart) screenStart.style.display = "block";
        updateSettingsDisplay();
      });
    }

    if (btnShare) {
      btnShare.addEventListener("click", () => {
        const text = `🧠 Mój wynik w Warszawskim Pub Quizie na poilepiwko.pl: ${currentScore}/${activeQuestions.length}! Sprawdź czy znasz warszawskie bary lepiej: ${window.location.origin}`;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(() => {
            showAppToast("Skopiowano wynik!", "Możesz wkleić go znajomym na Messengerze lub WhatsAppie!", "📤");
          }).catch(() => {
            prompt("Skopiuj tekst z wynikiem:", text);
          });
        } else {
          prompt("Skopiuj tekst z wynikiem:", text);
        }
      });
    }

    updateSettingsDisplay();

    window.__openPubQuiz = function () {
      if (modal) {
        modal.classList.add("active");
        modal.style.display = "flex";
      }
      switchQuizTab("game");
      if (screenResults) screenResults.style.display = "none";
      if (screenPlay) screenPlay.style.display = "none";
      if (screenStart) screenStart.style.display = "block";
      updateHighscoreDisplay();
    };

    window.__closePubQuiz = function () {
      if (timerInterval) clearInterval(timerInterval);
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none";
      }
    };

    if (btnOpenHeader) btnOpenHeader.addEventListener("click", window.__openPubQuiz);
    if (btnOpenTop) btnOpenTop.addEventListener("click", window.__openPubQuiz);
    if (btnOpenFloat) btnOpenFloat.addEventListener("click", window.__openPubQuiz);
    if (btnClose) btnClose.addEventListener("click", window.__closePubQuiz);
    if (btnCloseBottom) btnCloseBottom.addEventListener("click", window.__closePubQuiz);

    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) window.__closePubQuiz();
      });
    }

    updateHighscoreDisplay();
  }

  // ==========================================================================
  // Instagram Story Card Generator (Canvas 1080x1920 / 9:16)
  // ==========================================================================
  function initStoryCardModal() {
    const modal = document.getElementById("story-card-modal");
    const btnClose = document.getElementById("btn-close-story-modal");
    const canvas = document.getElementById("story-canvas");
    const previewImg = document.getElementById("story-preview-img");
    const spinner = document.getElementById("story-loading-spinner");
    const btnDownload = document.getElementById("btn-story-download");
    const btnShare = document.getElementById("btn-story-share");

    let currentBlob = null;
    let currentDataUrl = null;

    function drawRoundedRect(ctx, x, y, width, height, radius) {
      if (ctx.roundRect) {
        ctx.roundRect(x, y, width, height, radius);
      } else {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
      }
    }

    function generateStoryCard(avatarImg = null) {
      if (!canvas || !currentProfile) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = 1080;
      const H = 1920;
      canvas.width = W;
      canvas.height = H;

      // 1. Dark Beer Pub Gradient Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, "#141522");
      bgGrad.addColorStop(0.35, "#0a0b10");
      bgGrad.addColorStop(0.7, "#1c1106");
      bgGrad.addColorStop(1, "#07080c");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Radial Golden Ambient Glow in upper area
      const radialGlow = ctx.createRadialGradient(W / 2, 490, 40, W / 2, 490, 500);
      radialGlow.addColorStop(0, "rgba(245, 158, 11, 0.28)");
      radialGlow.addColorStop(0.5, "rgba(217, 119, 6, 0.1)");
      radialGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = radialGlow;
      ctx.fillRect(0, 0, W, H);

      // Subtle golden floating bubbles / sparkles
      const bubbles = [
        { x: 130, y: 310, r: 16, a: 0.16 },
        { x: 930, y: 270, r: 22, a: 0.13 },
        { x: 210, y: 820, r: 12, a: 0.18 },
        { x: 870, y: 770, r: 15, a: 0.15 },
        { x: 160, y: 1370, r: 18, a: 0.12 },
        { x: 920, y: 1410, r: 20, a: 0.14 },
        { x: 540, y: 210, r: 7, a: 0.22 }
      ];
      bubbles.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245, 158, 11, ${b.a})`;
        ctx.fill();
      });

      // Outer Decorative Border Frame
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, 45, 45, W - 90, H - 90, 44);
      ctx.stroke();

      // Golden Corner accents
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 4;
      // Top left
      ctx.beginPath();
      ctx.moveTo(45, 95); ctx.lineTo(45, 65); ctx.arcTo(45, 45, 65, 45, 20); ctx.lineTo(95, 45);
      ctx.stroke();
      // Top right
      ctx.beginPath();
      ctx.moveTo(W - 95, 45); ctx.lineTo(W - 65, 45); ctx.arcTo(W - 45, 45, W - 45, 65, 20); ctx.lineTo(W - 45, 95);
      ctx.stroke();
      // Bottom left
      ctx.beginPath();
      ctx.moveTo(45, H - 95); ctx.lineTo(45, H - 65); ctx.arcTo(45, H - 45, 65, H - 45, 20); ctx.lineTo(95, H - 45);
      ctx.stroke();
      // Bottom right
      ctx.beginPath();
      ctx.moveTo(W - 95, H - 45); ctx.lineTo(W - 65, H - 45); ctx.arcTo(W - 45, H - 45, W - 45, H - 65, 20); ctx.lineTo(W - 45, H - 95);
      ctx.stroke();
      ctx.restore();

      // 2. Header Brand & Subtitle
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // POILEPIWKO.PL logo
      ctx.font = "900 48px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#fbbf24";
      ctx.shadowColor = "rgba(245, 158, 11, 0.6)";
      ctx.shadowBlur = 18;
      ctx.fillText("🍻 POILEPIWKO.PL", W / 2, 130);
      ctx.shadowBlur = 0;

      // Subtitle
      ctx.font = "700 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("WARSZAWSKI PASZPORT PIWNY", W / 2, 185);

      // User Number Pill (e.g. #000042)
      const userNum = currentProfile.user_number || "#000001";
      const pillW = 200;
      const pillH = 46;
      ctx.fillStyle = "rgba(245, 158, 11, 0.16)";
      ctx.strokeStyle = "rgba(245, 158, 11, 0.4)";
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, W / 2 - pillW / 2, 225, pillW, pillH, 999);
      ctx.fill();
      ctx.stroke();

      ctx.font = "700 24px monospace";
      ctx.fillStyle = "#fef08a";
      ctx.fillText(userNum, W / 2, 248);

      // 3. Avatar Badge Circle
      const avatarY = 460;
      const avatarR = 115;

      // Outer glow circle
      ctx.save();
      ctx.shadowColor = "rgba(245, 158, 11, 0.5)";
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.arc(W / 2, avatarY, avatarR + 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(245, 158, 11, 0.25)";
      ctx.fill();
      ctx.restore();

      // Avatar background
      ctx.beginPath();
      ctx.arc(W / 2, avatarY, avatarR, 0, Math.PI * 2);
      ctx.fillStyle = "#1e2233";
      ctx.fill();

      // Render photo or emoji
      if (avatarImg) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(W / 2, avatarY, avatarR, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(avatarImg, W / 2 - avatarR, avatarY - avatarR, avatarR * 2, avatarR * 2);
        ctx.restore();
      } else {
        // Avatar Emoji
        ctx.font = "120px apple color emoji, segoe ui emoji, sans-serif";
        ctx.fillText(currentProfile.avatar_icon || "🍺", W / 2, avatarY + 12);
      }

      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(W / 2, avatarY, avatarR, 0, Math.PI * 2);
      ctx.stroke();

      // 4. Display Name & Username
      const displayName = currentProfile.display_name || currentProfile.username;
      ctx.font = "900 56px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(displayName, W / 2, 640);

      ctx.font = "700 34px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#60a5fa";
      ctx.fillText(`@${currentProfile.username}`, W / 2, 705);

      // 5. Rank Title Pill (e.g. 🏆 Koneser Kraftu)
      const rank = calculateUserRank(visitedVenues.length);
      const rankText = `🏆 ${rank.title}`;
      ctx.font = "800 32px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      const rankW = ctx.measureText(rankText).width + 60;
      const rankH = 54;
      ctx.fillStyle = "rgba(245, 158, 11, 0.22)";
      ctx.strokeStyle = "rgba(245, 158, 11, 0.55)";
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, W / 2 - rankW / 2, 755, rankW, rankH, 999);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#fde68a";
      ctx.fillText(rankText, W / 2, 782);

      // 6. Stats Glass Card (3 Columns: Odwiedzone, Odznaki, Ulubione)
      const statsX = 85;
      const statsY = 850;
      const statsW = W - 170;
      const statsH = 210;

      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, statsX, statsY, statsW, statsH, 26);
      ctx.fill();
      ctx.stroke();

      const colW = statsW / 3;
      const statItems = [
        { icon: "🍺", num: visitedVenues.length, label: "ODWIEDZONE" },
        { icon: "🎖️", num: loadUnlockedBadges().length, label: "ODZNAKI" },
        { icon: "❤️", num: favoriteVenues.length, label: "ULUBIONE" }
      ];

      statItems.forEach((st, idx) => {
        const cx = statsX + colW * idx + colW / 2;
        // Icon
        ctx.font = "38px apple color emoji, segoe ui emoji, sans-serif";
        ctx.fillText(st.icon, cx, statsY + 55);

        // Number
        ctx.font = "900 52px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(st.num), cx, statsY + 115);

        // Label
        ctx.font = "700 20px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(st.label, cx, statsY + 165);

        // Divider
        if (idx < 2) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
          ctx.beginPath();
          ctx.moveTo(statsX + colW * (idx + 1), statsY + 35);
          ctx.lineTo(statsX + colW * (idx + 1), statsY + statsH - 35);
          ctx.stroke();
        }
      });

      // 7. Bio & Favorites Glass Card
      const bioX = 85;
      const bioY = 1100;
      const bioW = W - 170;
      const bioH = 260;

      ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 1.5;
      drawRoundedRect(ctx, bioX, bioY, bioW, bioH, 26);
      ctx.fill();
      ctx.stroke();

      // Bio text
      const userBio = currentProfile.bio || "Warszawski poszukiwacz dobrego i taniego piwa 🍻";
      ctx.font = "italic 30px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#cbd5e1";
      const displayBio = userBio.length > 55 ? userBio.slice(0, 52) + "..." : userBio;
      ctx.fillText(`“${displayBio}”`, W / 2, bioY + 65);

      // Meta Pills: Rewir & Ulubione piwo
      const rewir = `📍 Rewir: ${currentProfile.favorite_district || "Cała Warszawa"}`;
      const piwo = `🍺 Piwo: ${currentProfile.favorite_beer || "Wszystkie dobre!"}`;

      const pill1W = bioW - 60;
      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      drawRoundedRect(ctx, bioX + 30, bioY + 115, pill1W, 52, 14);
      ctx.fill();
      ctx.font = "700 26px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(rewir, W / 2, bioY + 141);

      ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
      drawRoundedRect(ctx, bioX + 30, bioY + 180, pill1W, 52, 14);
      ctx.fill();
      ctx.fillStyle = "#fbbf24";
      ctx.fillText(piwo, W / 2, bioY + 206);

      // 8. Achievements Row
      const achY = 1400;
      const achW = W - 170;
      const achH = 180;
      ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      drawRoundedRect(ctx, 85, achY, achW, achH, 26);
      ctx.fill();
      ctx.stroke();

      ctx.font = "700 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("ZDOBYTE ODZNAKI PASZPORTU", W / 2, achY + 45);

      const unlockedBadges = loadUnlockedBadges();
      const badgeList = PASSPORT_BADGES.filter(b => unlockedBadges.includes(b.id));
      const iconsToShow = badgeList.length > 0 ? badgeList.map(b => b.icon) : ["🍺", "🗺️", "👑", "🦉", "🧠"];
      const displayIcons = iconsToShow.slice(0, 5);

      const iconSpacing = achW / (displayIcons.length + 1);
      displayIcons.forEach((ico, idx) => {
        const ix = 85 + iconSpacing * (idx + 1);
        ctx.font = "46px apple color emoji, segoe ui emoji, sans-serif";
        ctx.fillText(ico, ix, achY + 115);
      });

      // 9. Footer Call-to-action & Profile Link
      const footY = 1630;
      ctx.font = "700 24px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText("SPRAWDŹ MÓJ PROFIL & ZNAJDŹ NAJTAŃSZE PIWO:", W / 2, footY);

      // Golden link pill
      const linkText = `poilepiwko.pl/#@${currentProfile.username}`;
      ctx.font = "800 32px monospace";
      const linkW = ctx.measureText(linkText).width + 60;
      const linkH = 64;
      ctx.fillStyle = "rgba(245, 158, 11, 0.2)";
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, W / 2 - linkW / 2, footY + 28, linkW, linkH, 999);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#fbbf24";
      ctx.fillText(linkText, W / 2, footY + 60);

      // Bottom tagline
      ctx.font = "600 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.fillStyle = "#64748b";
      ctx.fillText("Puls cen piwa • Warszawski Pub Crawl • Pub Quizy", W / 2, 1780);

      // Convert to blob and dataURL for preview
      currentDataUrl = canvas.toDataURL("image/png");
      if (previewImg) previewImg.src = currentDataUrl;
      if (spinner) spinner.style.display = "none";

      canvas.toBlob(blob => {
        currentBlob = blob;
      }, "image/png");
    }

    window.__openStoryCardModal = function () {
      if (!currentProfile) {
        showAppToast("Profil", "Zaloguj się, aby wygenerować kartę Story!", "⚠️");
        return;
      }
      if (modal) {
        modal.classList.add("active");
        modal.style.display = "flex";
      }
      if (spinner) spinner.style.display = "flex";

      if (currentProfile.avatar_photo) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          generateStoryCard(img);
        };
        img.onerror = () => {
          generateStoryCard(null);
        };
        img.src = currentProfile.avatar_photo;
      } else {
        setTimeout(() => generateStoryCard(null), 60);
      }
    };

    window.__closeStoryCardModal = function () {
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none";
      }
    };

    if (btnClose) btnClose.addEventListener("click", window.__closeStoryCardModal);
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) window.__closeStoryCardModal();
      });
    }

    if (btnDownload) {
      btnDownload.addEventListener("click", () => {
        if (!currentDataUrl) return;
        const a = document.createElement("a");
        a.href = currentDataUrl;
        a.download = `poilepiwko-story-${currentProfile?.username || "profil"}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showAppToast("Pobrano!", "Karta na Story zapisana w pobranych plikach 📸", "📥");
      });
    }

    if (btnShare) {
      btnShare.addEventListener("click", async () => {
        if (!currentBlob && !currentDataUrl) return;
        try {
          if (navigator.canShare && currentBlob) {
            const file = new File([currentBlob], `poilepiwko-story-${currentProfile?.username || "profil"}.png`, { type: "image/png" });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                title: `${currentProfile?.display_name || currentProfile?.username} na poilepiwko`,
                text: `Mój paszport piwny w Warszawie! 🍻 Sprawdź na poilepiwko.pl/#@${currentProfile?.username}`,
                files: [file]
              });
              return;
            }
          }
        } catch (e) {}

        // Fallback: download
        if (btnDownload) btnDownload.click();
      });
    }
  }

  // ==========================================================================
  // Wirtualna Karta Klubowa (PoIlePiwko Pass 3D)
  // ==========================================================================
  function initClubCardModal() {
    const modal = document.getElementById("club-card-modal");
    const btnClose = document.getElementById("btn-close-club-modal");
    const btnOpenFromProf = document.getElementById("btn-open-club-card");
    const stage = document.getElementById("club-card-stage");
    const flipper = document.getElementById("club-card-flipper");
    const glare = document.getElementById("club-card-glare");
    const btnFlip = document.getElementById("btn-action-flip-card");
    const btnFlipBack = document.getElementById("btn-flip-back");
    const btnShow = document.getElementById("btn-action-show-barman");
    const btnDownload = document.getElementById("btn-action-save-pass");

    const elName = document.getElementById("club-card-name");
    const elNum = document.getElementById("club-card-number");
    const elValidity = document.getElementById("club-card-validity");
    const elBackId = document.getElementById("club-card-back-id");

    function renderClubCardData() {
      const name = (currentProfile && (currentProfile.display_name || currentProfile.username)) ? (currentProfile.display_name || currentProfile.username) : "PIWOSZ";
      const num = (currentProfile && currentProfile.user_number) ? currentProfile.user_number : "#000001";
      if (elName) elName.textContent = name.toUpperCase();
      if (elNum) elNum.textContent = num;
      if (elValidity) elValidity.textContent = "12/2027";
      if (elBackId) elBackId.textContent = `ID: ${num} • Warszawa`;
    }

    function toggleFlip() {
      if (flipper) {
        flipper.style.transform = "";
        flipper.classList.toggle("flipped");
      }
    }

    window.__openClubCard = function () {
      if (!currentProfile) {
        showAppToast("Karta Pass 💳", "Zaloguj się, aby wyświetlić swoją Kartę Klubu!", "⚠️");
        if (window.__openAuth) window.__openAuth();
        return;
      }
      renderClubCardData();
      if (flipper) {
        flipper.style.transform = "";
        flipper.classList.remove("flipped");
      }
      if (stage) stage.classList.remove("barman-mode");
      if (modal) {
        modal.classList.add("active");
        modal.style.display = "flex";
      }
    };

    window.__closeClubCard = function () {
      if (modal) {
        modal.classList.remove("active");
        modal.style.display = "none";
      }
      if (stage) stage.classList.remove("barman-mode");
    };

    if (btnOpenFromProf) {
      btnOpenFromProf.addEventListener("click", () => {
        window.__openClubCard();
      });
    }

    if (btnClose) btnClose.addEventListener("click", window.__closeClubCard);
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) window.__closeClubCard();
      });
    }

    if (stage) {
      stage.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        toggleFlip();
      });

      // 3D Tilt effect on mousemove
      stage.addEventListener("mousemove", (e) => {
        if (stage.classList.contains("barman-mode")) return;
        const rect = stage.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -12;
        const rotateY = ((x - centerX) / centerX) * 12;

        const isFlipped = flipper && flipper.classList.contains("flipped");
        if (flipper) {
          flipper.style.transform = `rotateY(${isFlipped ? 180 + rotateY : rotateY}deg) rotateX(${rotateX}deg)`;
        }
        if (glare) {
          glare.style.background = `radial-gradient(circle at ${(x / rect.width) * 100}% ${(y / rect.height) * 100}%, rgba(255, 255, 255, 0.25) 0%, transparent 60%)`;
        }
      });

      stage.addEventListener("mouseleave", () => {
        if (flipper) {
          const isFlipped = flipper.classList.contains("flipped");
          flipper.style.transform = isFlipped ? "rotateY(180deg)" : "rotateY(0deg)";
        }
        if (glare) {
          glare.style.background = "";
        }
      });
    }

    if (btnFlip) btnFlip.addEventListener("click", toggleFlip);
    if (btnFlipBack) btnFlipBack.addEventListener("click", toggleFlip);

    if (btnShow) {
      btnShow.addEventListener("click", () => {
        if (!stage) return;
        const isBarman = stage.classList.toggle("barman-mode");
        btnShow.classList.toggle("active", isBarman);
        if (isBarman) {
          showAppToast("Tryb przy barze 🍺", "Karta powiększona i rozjaśniona do pokazania barmanowi!", "📱", 2500);
        }
      });
    }

    if (btnDownload) {
      btnDownload.addEventListener("click", async () => {
        const passUrl = `${window.location.origin}/#pass`;
        if (navigator.share) {
          try {
            await navigator.share({
              title: "PoIlePiwko Pass - Karta Klubowa (-10%)",
              text: `Moja wirtualna karta członkowska PoIlePiwko Pass: ${currentProfile?.user_number || "#000001"}! Sprawdź na poilepiwko.pl`,
              url: passUrl
            });
            return;
          } catch (e) {}
        }
        showAppToast("Karta Pass 💳", `Twój numer klubowicza to ${currentProfile?.user_number || "#000001"}. Karta jest aktywna w Twoim profilu!`, "✅", 2800);
      });
    }
  }

  // ==========================================================================
  // Piwny Anioł Stróż / SOS Ekipa & Safe Night Out
  // ==========================================================================
  function initSosFeature() {
    const btnSosFloat = document.getElementById("btn-sos-float");
    const sosModal = document.getElementById("sos-modal");
    const btnCloseSosModal = document.getElementById("btn-close-sos-modal");
    const sosVenueName = document.getElementById("sos-venue-name");
    const sosVenueDetails = document.getElementById("sos-venue-details");
    const btnSendSosFriends = document.getElementById("btn-send-sos-friends");
    const sosAlertStatus = document.getElementById("sos-alert-status");
    const btnSosSms = document.getElementById("btn-sos-sms");
    const btnSosWhatsapp = document.getElementById("btn-sos-whatsapp");
    const btnSosCopy = document.getElementById("btn-sos-copy");
    const btnSosCopyText = document.getElementById("btn-sos-copy-text");
    const btnSosBolt = document.getElementById("btn-sos-bolt");
    const btnSosUber = document.getElementById("btn-sos-uber");
    const btnSosGmapsHome = document.getElementById("btn-sos-gmaps-home");
    const sosIceBox = document.getElementById("sos-ice-box");

    if (!btnSosFloat || !sosModal) return;

    let detectedVenue = null;
    let detectedCoords = null;

    function renderIceContact() {
      if (!sosIceBox) return;
      let ice = null;
      try {
        const stored = localStorage.getItem("poilepiwko_ice_contact");
        if (stored) ice = JSON.parse(stored);
      } catch (e) {}

      if (ice && ice.phone) {
        sosIceBox.innerHTML = `
          <div class="ice-saved-card">
            <div class="ice-details">
              <span class="ice-name">👤 ${escapeHtml(ice.name || "Zaufany kontakt")}</span>
              <span class="ice-phone">📞 ${escapeHtml(ice.phone)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <a href="tel:${escapeHtml(ice.phone)}" class="ice-call-btn" title="Zadzwoń teraz">
                <span>📞 Zadzwoń</span>
              </a>
              <button type="button" class="ice-edit-btn" id="btn-ice-edit" title="Zmień numer">✎</button>
            </div>
          </div>
        `;
        const btnEdit = document.getElementById("btn-ice-edit");
        if (btnEdit) {
          btnEdit.addEventListener("click", () => {
            renderIceInput(ice.name, ice.phone);
          });
        }
      } else {
        renderIceInput("", "");
      }
    }

    function renderIceInput(defaultName, defaultPhone) {
      if (!sosIceBox) return;
      sosIceBox.innerHTML = `
        <div class="ice-form-box">
          <div class="ice-inputs-row">
            <input type="text" id="ice-input-name" class="ice-input" placeholder="Imię (np. Mama)" value="${escapeHtml(defaultName || "")}" maxlength="25" />
            <input type="tel" id="ice-input-phone" class="ice-input" placeholder="Nr tel. (np. 500123456)" value="${escapeHtml(defaultPhone || "")}" maxlength="15" />
          </div>
          <button type="button" class="ice-save-btn" id="btn-save-ice">💾 Zapisz kontakt ICE</button>
        </div>
      `;
      const btnSave = document.getElementById("btn-save-ice");
      if (btnSave) {
        btnSave.addEventListener("click", () => {
          const nameInput = document.getElementById("ice-input-name");
          const phoneInput = document.getElementById("ice-input-phone");
          const name = nameInput ? nameInput.value.trim() : "";
          const phone = phoneInput ? phoneInput.value.trim().replace(/\s+/g, "") : "";
          if (!phone) {
            showAppToast("Podaj numer telefonu!", "Wpisz numer do zaufanej osoby.", "⚠️");
            return;
          }
          try {
            localStorage.setItem("poilepiwko_ice_contact", JSON.stringify({ name: name || "Zaufany kontakt", phone }));
            showAppToast("Zapisano kontakt ICE!", `Ustawiono: ${name || "Kontakt"} (${phone})`, "🛡️");
            renderIceContact();
          } catch (e) {}
        });
      }
    }

    function updateDetectedLocation() {
      // Find coordinates: userLocation or map center or Warsaw Center
      let coords = (userLocation && Array.isArray(userLocation) && userLocation.length === 2) 
        ? userLocation 
        : (map ? [map.getCenter().lat, map.getCenter().lng] : WARSAW_CENTER);
      
      detectedCoords = coords;

      // Find nearest venue from allVenues
      let nearest = null;
      let minDistance = Infinity;

      if (Array.isArray(allVenues) && allVenues.length > 0) {
        for (const v of allVenues) {
          if (typeof v.latitude === "number" && typeof v.longitude === "number") {
            const d = calculateDistanceKm(coords[0], coords[1], v.latitude, v.longitude);
            if (d < minDistance) {
              minDistance = d;
              nearest = v;
            }
          }
        }
      }

      detectedVenue = nearest;

      if (nearest) {
        const distM = Math.round(minDistance * 1000);
        let distStr = "";
        if (minDistance > 50) {
          distStr = minDistance > 500 ? "> 500 km" : `${Math.round(minDistance)} km`;
        } else if (distM < 1000) {
          distStr = `${distM} m`;
        } else {
          distStr = `${minDistance.toFixed(1)} km`;
        }

        if (sosVenueName) {
          sosVenueName.innerHTML = `🍺 ${escapeHtml(nearest.name)} <span style="font-size:0.75rem;font-weight:600;color:#94a3b8;">(${distStr})</span>`;
        }
        if (sosVenueDetails) {
          const addr = nearest.address && nearest.address !== "Warszawa" ? nearest.address : (nearest.district || "Warszawa");
          sosVenueDetails.textContent = `📍 ${addr} · ${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
        }
      } else {
        if (sosVenueName) sosVenueName.textContent = "📍 Centrum Warszawy";
        if (sosVenueDetails) sosVenueDetails.textContent = `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
      }

      // Update Share Text & Links
      const vTitle = nearest ? nearest.name : "Warszawa";
      const vAddr = nearest ? (nearest.address && nearest.address !== "Warszawa" ? nearest.address : (nearest.district || "")) : "";
      const mapsLink = `https://www.google.com/maps?q=${coords[0]},${coords[1]}`;

      const shareMsg = `🚨 SOS PoIlePiwko: Potrzebuję pomocy/odebrania! Jestem w/przy: ${vTitle}${vAddr ? " (" + vAddr + ")" : ""}. Moje położenie: ${mapsLink}`;

      if (btnSosSms) {
        btnSosSms.href = `sms:?body=${encodeURIComponent(shareMsg)}`;
      }
      if (btnSosWhatsapp) {
        btnSosWhatsapp.href = `https://wa.me/?text=${encodeURIComponent(shareMsg)}`;
      }

      // Taxi links
      if (btnSosBolt) {
        btnSosBolt.href = `https://bolt.eu/`;
      }
      if (btnSosUber) {
        btnSosUber.href = `https://m.uber.com/ul/?action=setPickup&pickup[latitude]=${coords[0]}&pickup[longitude]=${coords[1]}`;
      }
      if (btnSosGmapsHome) {
        btnSosGmapsHome.href = `https://www.google.com/maps/dir/?api=1&destination=Dom`;
      }

      // Copy handler
      if (btnSosCopy) {
        btnSosCopy.onclick = async () => {
          try {
            await navigator.clipboard.writeText(shareMsg);
            if (btnSosCopyText) btnSosCopyText.textContent = "✓ Skopiowano!";
            showAppToast("Skopiowano informację SOS!", "Możesz wkleić treść w dowolnej aplikacji.", "📋");
            setTimeout(() => {
              if (btnSosCopyText) btnSosCopyText.textContent = "Kopiuj info";
            }, 2500);
          } catch (e) {
            showAppToast("Informacja SOS:", shareMsg, "📋", 6000);
          }
        };
      }
    }

    function openSosModal() {
      // Trigger fresh location check
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setUserLocation([pos.coords.latitude, pos.coords.longitude], false, true);
            updateDetectedLocation();
          },
          () => {
            updateDetectedLocation();
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
        );
      }
      updateDetectedLocation();
      renderIceContact();
      if (sosAlertStatus) sosAlertStatus.style.display = "none";
      if (btnSendSosFriends) {
        btnSendSosFriends.disabled = false;
        btnSendSosFriends.style.opacity = "1";
      }

      sosModal.classList.add("active");
      sosModal.style.display = "flex";
      document.body.classList.add("modal-open");
    }

    function closeSosModal() {
      sosModal.classList.remove("active");
      sosModal.style.display = "none";
      document.body.classList.remove("modal-open");
    }

    btnSosFloat.addEventListener("click", openSosModal);
    if (btnCloseSosModal) btnCloseSosModal.addEventListener("click", closeSosModal);

    sosModal.addEventListener("click", (e) => {
      if (e.target === sosModal) closeSosModal();
    });

    // Send SOS alert to friends via backend
    if (btnSendSosFriends) {
      btnSendSosFriends.addEventListener("click", async () => {
        if (!currentUser) {
          showAppToast("Zaloguj się!", "Aby wysłać alert bezpośrednio do ekipy w aplikacji, musisz być zalogowany. Użyj przycisków SMS lub WhatsApp poniżej!", "🔒", 5000);
          return;
        }

        btnSendSosFriends.disabled = true;
        btnSendSosFriends.style.opacity = "0.7";

        try {
          const res = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "trigger-sos-alert",
              payload: {
                userId: currentUser.id,
                venueName: detectedVenue ? detectedVenue.name : "Warszawa",
                address: detectedVenue ? detectedVenue.address : "",
                latitude: detectedCoords ? detectedCoords[0] : null,
                longitude: detectedCoords ? detectedCoords[1] : null
              }
            })
          });

          const data = await res.json();
          if (res.ok && data.success) {
            if (sosAlertStatus) {
              sosAlertStatus.style.display = "block";
              sosAlertStatus.innerHTML = `✅ ${escapeHtml(data.message || "Alert SOS został wysłany do znajomych!")}`;
            }
            showAppToast("Alert SOS wysłany!", data.message, "🚨", 5000);
          } else {
            showAppToast("Błąd alertu", data.error || "Nie udało się rozesłać alertu.", "⚠️");
            btnSendSosFriends.disabled = false;
            btnSendSosFriends.style.opacity = "1";
          }
        } catch (err) {
          console.error("SOS trigger error:", err);
          showAppToast("Błąd połączenia", "Użyj bezpośrednich przycisków SMS / WhatsApp poniżej!", "⚠️");
          btnSendSosFriends.disabled = false;
          btnSendSosFriends.style.opacity = "1";
        }
      });
    }

    // Expose globally
    window.__openSosModal = openSosModal;
  }

  const FALLBACK_VENUES = [
  {
    "id": "osm-node-11033970870",
    "name": "Perła (Pijalnia Piwa)",
    "slug": "perla-pijalnia-piwa",
    "district": "Praga Południe",
    "address": "Władysława Umińskiego 16C",
    "latitude": 52.22692,
    "longitude": 21.09806,
    "beer_name": "Warka / Namysłów z kija",
    "beer_price_pln": 10.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 6.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "banialuka",
    "name": "BaniaLuka",
    "slug": "banialuka",
    "district": "Śródmieście",
    "address": "Krakowskie Przedmieście 63",
    "latitude": 52.24584,
    "longitude": 21.01429,
    "beer_name": "Piwo lane jasne (0.5L)",
    "beer_price_pln": 11.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 6.5,
    "happy_hour": "Pn-Czw 12:00-16:00: Piwo 9.50 zł",
    "hours": "12:00 - 04:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "pijalnia-mazowiecka",
    "name": "Pijalnia Wódki i Piwa - Mazowiecka",
    "slug": "pijalnia-wodki-i-piwa-mazowiecka",
    "district": "Śródmieście",
    "address": "Mazowiecka 11",
    "latitude": 52.23685,
    "longitude": 21.01358,
    "beer_name": "Warka / Namysłów z kranu",
    "beer_price_pln": 11.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.0,
    "happy_hour": null,
    "hours": "14:00 - 04:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "kultowa-nowy-swiat",
    "name": "Kultowa Klubokawiarnia",
    "slug": "kultowa-klubokawiarnia",
    "district": "Śródmieście",
    "address": "Nowy Świat 43",
    "latitude": 52.23455,
    "longitude": 21.01892,
    "beer_name": "Kasztelan z kija",
    "beer_price_pln": 12.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 6.5,
    "happy_hour": "Śr 17:00-21:00: Drugie piwo 50%",
    "hours": "14:00 - 02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "chmielnik",
    "name": "Chmielnik Pub",
    "slug": "chmielnik-pub",
    "district": "Śródmieście",
    "address": "Wspólna 35",
    "latitude": 52.22814,
    "longitude": 21.01185,
    "beer_name": "Kasztelan Niepasteryzowany",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": "Pn-Pt 15:00-18:00: Piwo 12 zł",
    "hours": "14:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "bazar-klub",
    "name": "Bazar Klub",
    "slug": "bazar-klub",
    "district": "Praga Północ",
    "address": "Jagiellońska 13",
    "latitude": 52.25148,
    "longitude": 21.03152,
    "beer_name": "Lane Jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "17:00 - 02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-280333661",
    "name": "Bez Słowa",
    "slug": "bez-slowa",
    "district": "Ursynów",
    "address": "Fosa",
    "latitude": 52.17376,
    "longitude": 21.04501,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-312011094",
    "name": "Tato",
    "slug": "tato",
    "district": "Bielany",
    "address": "Władysława Broniewskiego 74",
    "latitude": 52.2752,
    "longitude": 20.93911,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-315119739",
    "name": "CafeFajka",
    "slug": "cafefajka",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28",
    "latitude": 52.23321,
    "longitude": 21.02016,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-396294339",
    "name": "Żaczek",
    "slug": "zaczek",
    "district": "Mokotów",
    "address": "Wołoska 141A",
    "latitude": 52.20126,
    "longitude": 20.9982,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Fr 12:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-398459182",
    "name": "Warszawski Flip",
    "slug": "warszawski-flip",
    "district": "Mokotów",
    "address": "Aleja Niepodległości 147",
    "latitude": 52.20443,
    "longitude": 21.00921,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-735237605",
    "name": "Magiczna",
    "slug": "magiczna",
    "district": "Bemowo",
    "address": "Powstańców Śląskich 106",
    "latitude": 52.25509,
    "longitude": 20.91926,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Sa 16:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1325674909",
    "name": "U Loka",
    "slug": "u-loka",
    "district": "Praga Południe",
    "address": "Aleja Stanów Zjednoczonych 65",
    "latitude": 52.24281,
    "longitude": 21.08324,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-315119742",
    "name": "Fajka Bar",
    "slug": "fajka-bar",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28",
    "latitude": 52.23317,
    "longitude": 21.02027,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-899125182",
    "name": "In Side",
    "slug": "in-side",
    "district": "Pawilony",
    "address": "Nowy Świat 23/25",
    "latitude": 52.23264,
    "longitude": 21.01872,
    "beer_name": "Tyskie / Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-1115233646",
    "name": "Cafe Foksal",
    "slug": "cafe-foksal",
    "district": "Pawilony",
    "address": "Foksal 21",
    "latitude": 52.23347,
    "longitude": 21.0202,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-2532756230",
    "name": "Dr. Piwo",
    "slug": "dr-piwo",
    "district": "Ursynów",
    "address": "Romualda Mielczarskiego 10",
    "latitude": 52.1296,
    "longitude": 21.06084,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo 13:30-22:00; Tu-Fr 10:00-22:00; Sa 14:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2546190772",
    "name": "Kill Bill",
    "slug": "kill-bill",
    "district": "Ursynów",
    "address": "Aleja Komisji Edukacji Narodowej 95",
    "latitude": 52.1561,
    "longitude": 21.03267,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Th 13:00-23:00; Fr-Sa 13:00-24:00; Su 12:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2548029779",
    "name": "Yo Bar & Pub",
    "slug": "yo-bar-pub",
    "district": "Ursynów",
    "address": "Aleja Komisji Edukacji Narodowej 47",
    "latitude": 52.14276,
    "longitude": 21.05353,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Su 15:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2597555926",
    "name": "Bar Janusz",
    "slug": "bar-janusz",
    "district": "Ursynów",
    "address": "Pasaż Stokłosy 11",
    "latitude": 52.16164,
    "longitude": 21.02973,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Tu-Th 16:00-24:00; Fr-Sa 16:00-02:00; Su 16:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3572606695",
    "name": "Pub Blue",
    "slug": "pub-blue",
    "district": "Bielany",
    "address": "Josepha Conrada 15",
    "latitude": 52.27596,
    "longitude": 20.92132,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3696194021",
    "name": "Spin City",
    "slug": "spin-city",
    "district": "Bemowo",
    "address": "Powstańców Śląskich 126A",
    "latitude": 52.266,
    "longitude": 20.93282,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3886060258",
    "name": "Wieczorny",
    "slug": "wieczorny",
    "district": "Mokotów",
    "address": "Wiśniowa 46",
    "latitude": 52.20778,
    "longitude": 21.01479,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Th 18:00-24:00; Fr-Sa 18:00-06:00; Su 16:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3974278627",
    "name": "The Beer Store Wilanów",
    "slug": "the-beer-store-wilanow",
    "district": "Wilanów",
    "address": "Aleja Rzeczypospolitej 14",
    "latitude": 52.16436,
    "longitude": 21.07114,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3996017040",
    "name": "New Vegas",
    "slug": "new-vegas",
    "district": "Ursynów",
    "address": "Stanisława Kulczyńskiego 14",
    "latitude": 52.14858,
    "longitude": 21.05534,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Fr 15:00-02:00; Sa-Su 13:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4223827127",
    "name": "Piwna Sprawa",
    "slug": "piwna-sprawa",
    "district": "Bielany",
    "address": "Wólczyńska 3",
    "latitude": 52.27792,
    "longitude": 20.93834,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4339407690",
    "name": "Cafe Atlantis",
    "slug": "cafe-atlantis",
    "district": "Mokotów",
    "address": "Jana III Sobieskiego 37",
    "latitude": 52.18563,
    "longitude": 21.05117,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4387127794",
    "name": "Forteczna Grill Bar",
    "slug": "forteczna-grill-bar",
    "district": "Bemowo",
    "address": "Jerzego Waldorffa",
    "latitude": 52.25525,
    "longitude": 20.94065,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Tu-Th 17:00-22:00; Sa 14:00-22:00; Su 12:00-22:00; Fr 17:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4396887189",
    "name": "Land Club, Bilard Dart Pub",
    "slug": "land-club-bilard-dart-pub",
    "district": "Mokotów",
    "address": "Wałbrzyska 11",
    "latitude": 52.17177,
    "longitude": 21.0248,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3983135018",
    "name": "Chicas & Gorillas",
    "slug": "chicas-gorillas",
    "district": "Pawilony",
    "address": "Nowy Świat 19",
    "latitude": 52.23216,
    "longitude": 21.01995,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "Mo-Tu 17:00-03:00; We-Th 15:00-03:00; Fr-Sa 15:00-05:00; Su 16:00-03:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-4591418211",
    "name": "Paradox Cafe",
    "slug": "paradox-cafe",
    "district": "Śródmieście",
    "address": "Mordechaja Anielewicza 2",
    "latitude": 52.24947,
    "longitude": 20.99767,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo 13:00-24:00; Tu-Fr 11:00-24:00; Sa-Su 10:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4935336421",
    "name": "Letnisko Żoliborz",
    "slug": "letnisko-zoliborz",
    "district": "Żoliborz",
    "address": "Bulwar Zbigniewa Religi",
    "latitude": 52.26896,
    "longitude": 21.0024,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4835481023",
    "name": "Piw Paw",
    "slug": "piw-paw",
    "district": "Pawilony",
    "address": "Foksal 16",
    "latitude": 52.2339,
    "longitude": 21.02121,
    "beer_name": "Tyskie / Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "Tu-Th 16:00-24:00; Fr-Sa 13:00-02:00; Su 13:00-23:00; Mo 16:00-23:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-5108599558",
    "name": "Cynamon",
    "slug": "cynamon",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilony)",
    "latitude": 52.23313,
    "longitude": 21.02063,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-5108599559",
    "name": "Rozbiegówka",
    "slug": "rozbiegowka",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilony)",
    "latitude": 52.23322,
    "longitude": 21.02104,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-5637695421",
    "name": "Żyrafa",
    "slug": "zyrafa",
    "district": "Pawilony",
    "address": "Nowy Świat 22C",
    "latitude": 52.23296,
    "longitude": 21.02075,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "Mo-Su 18:00-03:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-6593922336",
    "name": "Dom Whisky",
    "slug": "dom-whisky",
    "district": "Pawilony",
    "address": "Nowy Świat 32",
    "latitude": 52.23355,
    "longitude": 21.01954,
    "beer_name": "Tyskie / Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "Mo-Th 16:00-04:00; Fr-Su 14:00-04:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-6652921701",
    "name": "Mezza",
    "slug": "mezza",
    "district": "Pawilony",
    "address": "Nowy Świat 19",
    "latitude": 52.23232,
    "longitude": 21.01985,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "od 15:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-7707985587",
    "name": "Lenistwo",
    "slug": "lenistwo",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilony)",
    "latitude": 52.23305,
    "longitude": 21.02026,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-7707985590",
    "name": "Klepsydra",
    "slug": "klepsydra",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28",
    "latitude": 52.23299,
    "longitude": 21.02038,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-7707985592",
    "name": "Babajaga",
    "slug": "babajaga",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28",
    "latitude": 52.23312,
    "longitude": 21.0203,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-7707985593",
    "name": "Precedens",
    "slug": "precedens",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28",
    "latitude": 52.23282,
    "longitude": 21.02032,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-7707985596",
    "name": "Szprycer",
    "slug": "szprycer",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28",
    "latitude": 52.23298,
    "longitude": 21.02022,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-6515177393",
    "name": "Ministerstwo Śledzia i Wódki",
    "slug": "ministerstwo-sledzia-i-wodki",
    "district": "Pawilony",
    "address": "Foksal 18",
    "latitude": 52.23359,
    "longitude": 21.01985,
    "beer_name": "Tyskie / Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-7956420256",
    "name": "Mielżyński",
    "slug": "mielzynski",
    "district": "Wola",
    "address": "Powązkowska",
    "latitude": 52.25396,
    "longitude": 20.97855,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7761484320",
    "name": "Le Melange",
    "slug": "le-melange",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilony)",
    "latitude": 52.23323,
    "longitude": 21.02112,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-7761484321",
    "name": "Pawilon 31",
    "slug": "pawilon-31",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilony)",
    "latitude": 52.23325,
    "longitude": 21.02119,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-7761484324",
    "name": "Klubowa No.24",
    "slug": "klubowa-no-24",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilony)",
    "latitude": 52.23315,
    "longitude": 21.02071,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-7799467785",
    "name": "Biały Nalew",
    "slug": "bialy-nalew",
    "district": "Pawilony",
    "address": "Nowy Świat 37",
    "latitude": 52.234,
    "longitude": 21.01882,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "Mo-Th,Su 12:00-23:45; Fr-Sa 12:00-02:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-8929307025",
    "name": "Newonce Bar",
    "slug": "newonce-bar",
    "district": "Pawilony",
    "address": "Nowy Świat 6/12",
    "latitude": 52.23071,
    "longitude": 21.02238,
    "beer_name": "Tyskie / Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-9708342960",
    "name": "Do Dna",
    "slug": "do-dna",
    "district": "Pawilony",
    "address": "Nowy Świat 27",
    "latitude": 52.23285,
    "longitude": 21.01938,
    "beer_name": "Tyskie / Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-9904534982",
    "name": "Och! & Ach!",
    "slug": "och-ach",
    "district": "Pawilony",
    "address": "Chmielna 5",
    "latitude": 52.23272,
    "longitude": 21.01868,
    "beer_name": "Tyskie / Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-10555453052",
    "name": "M13",
    "slug": "m13",
    "district": "Mokotów",
    "address": "Marynarska 13",
    "latitude": 52.17792,
    "longitude": 21.0006,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Th 15:00-24:00; Fr-Sa 15:00-02:00; Su 15:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10761295246",
    "name": "The Beer Store",
    "slug": "the-beer-store",
    "district": "Mokotów",
    "address": "Konstruktorska 12A",
    "latitude": 52.187,
    "longitude": 20.98811,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Fr 14:00-01:00; Sa-Su 12:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10768135061",
    "name": "Piwna Beczka",
    "slug": "piwna-beczka",
    "district": "Mokotów",
    "address": "Aleja Niepodległości 19",
    "latitude": 52.18234,
    "longitude": 21.0195,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Tu,Th 18:00-23:00; We,Fr 18:00-02:00; Sa 20:00-01:00; Su 19:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10963230633",
    "name": "Singers",
    "slug": "singers",
    "district": "Mokotów",
    "address": "Cieszyńska 6",
    "latitude": 52.1833,
    "longitude": 21.02704,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Tu-Su 12:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11018644077",
    "name": "Stork",
    "slug": "stork",
    "district": "Śródmieście",
    "address": "Bonifraterska 10A",
    "latitude": 52.25295,
    "longitude": 21.00105,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo 12:00-21:00; Tu-Sa 12:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11022418064",
    "name": "Montenegro Bar Kafana",
    "slug": "montenegro-bar-kafana",
    "district": "Praga Południe",
    "address": "Aleja Stanów Zjednoczonych 65",
    "latitude": 52.24275,
    "longitude": 21.08325,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11029954964",
    "name": "Shisha House",
    "slug": "shisha-house",
    "district": "Mokotów",
    "address": "Postępu",
    "latitude": 52.17409,
    "longitude": 20.99368,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11032188575",
    "name": "Czuczu",
    "slug": "czuczu",
    "district": "Bielany",
    "address": "Esej 45",
    "latitude": 52.27904,
    "longitude": 20.91271,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11035383268",
    "name": "Czarna Koszula",
    "slug": "czarna-koszula",
    "district": "Śródmieście",
    "address": "Konwiktorska 6",
    "latitude": 52.25533,
    "longitude": 21.00008,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11037101311",
    "name": "Ten Bar",
    "slug": "ten-bar",
    "district": "Wilanów",
    "address": "Franciszka Klimczaka 1",
    "latitude": 52.16335,
    "longitude": 21.08176,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11043802515",
    "name": "Joy Factory",
    "slug": "joy-factory",
    "district": "Żoliborz",
    "address": "Księdza Jerzego Popiełuszki 19",
    "latitude": 52.27014,
    "longitude": 20.97412,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11056488621",
    "name": "Golbar",
    "slug": "golbar",
    "district": "Bemowo",
    "address": "Księcia Bolesława 1/3",
    "latitude": 52.25192,
    "longitude": 20.93803,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11062935171",
    "name": "Kontrast food & drink",
    "slug": "kontrast-food-drink",
    "district": "Żoliborz",
    "address": "Zygmunta Krasińskiego 24",
    "latitude": 52.26601,
    "longitude": 20.97459,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11064591224",
    "name": "Wesoła Porzeczka",
    "slug": "wesola-porzeczka",
    "district": "Żoliborz",
    "address": "Księdza Jerzego Popiełuszki 21",
    "latitude": 52.27031,
    "longitude": 20.9738,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "od 13:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11066691067",
    "name": "Sm Baraban",
    "slug": "sm-baraban",
    "district": "Wilanów",
    "address": "Franciszka Klimczaka 1",
    "latitude": 52.16388,
    "longitude": 21.08246,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11077331348",
    "name": "Pub No 22",
    "slug": "pub-no-22",
    "district": "Ursynów",
    "address": "Wojciecha Bogumiła Jastrzębowskiego 22",
    "latitude": 52.16126,
    "longitude": 21.03659,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11169103779",
    "name": "Pub z Kręgielnią",
    "slug": "pub-z-kregielnia",
    "district": "Mokotów",
    "address": "Dominika Merliniego 4",
    "latitude": 52.19503,
    "longitude": 21.02596,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11197533938",
    "name": "Winna Żona",
    "slug": "winna-zona",
    "district": "Praga Południe",
    "address": "Mińska 40",
    "latitude": 52.24916,
    "longitude": 21.06326,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Su-Th 11:00-23:00; Fr-Sa 11:00-00:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11243011269",
    "name": "Fair Play",
    "slug": "fair-play",
    "district": "Mokotów",
    "address": "Taśmowa",
    "latitude": 52.17869,
    "longitude": 20.98917,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12629973075",
    "name": "Stołeczna",
    "slug": "stoleczna",
    "district": "Żoliborz",
    "address": "Księdza Jerzego Popiełuszki 21",
    "latitude": 52.27034,
    "longitude": 20.97376,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Th 17:00-24:00; Fr-Sa 17:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13308362998",
    "name": "Na Kranie",
    "slug": "na-kranie",
    "district": "Wilanów",
    "address": "Aleja Rzeczypospolitej 12",
    "latitude": 52.16348,
    "longitude": 21.07078,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-We 16:00-23:00; Th-Fr 10:00-24:00; Sa 00:00-24:00; Su 13:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13357596426",
    "name": "Anders",
    "slug": "anders",
    "district": "Praga Południe",
    "address": "Grochowska 144A",
    "latitude": 52.24319,
    "longitude": 21.09979,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13566732438",
    "name": "Kumru",
    "slug": "kumru",
    "district": "Mokotów",
    "address": "Jana III Sobieskiego 100A",
    "latitude": 52.1975,
    "longitude": 21.03983,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-28176109",
    "name": "JK Cafe Bistro",
    "slug": "jk-cafe-bistro",
    "district": "Praga Południe",
    "address": "Generała Augusta Emila Fieldorfa „Nila” 39",
    "latitude": 52.23084,
    "longitude": 21.09427,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-243925642",
    "name": "Bar Kępa Potocka",
    "slug": "bar-kepa-potocka",
    "district": "Żoliborz",
    "address": "Gwiaździsta 8",
    "latitude": 52.27708,
    "longitude": 20.99125,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Mo-Su,PH 10:00-18:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-244662258",
    "name": "Bolek",
    "slug": "bolek",
    "district": "Ochota",
    "address": "Aleja Niepodległości 211",
    "latitude": 52.21231,
    "longitude": 21.00487,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Tu-Th 14:00-21:00; Fr-Sa 14:00-00:00; Su 13:00-18:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-523375031",
    "name": "LG Grill Bar Arkuszowa",
    "slug": "lg-grill-bar-arkuszowa",
    "district": "Bielany",
    "address": "Arkuszowa 2",
    "latitude": 52.28348,
    "longitude": 20.91363,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-1060042804",
    "name": "Bar Pod Kazurką",
    "slug": "bar-pod-kazurka",
    "district": "Ursynów",
    "address": "Ziemska 21C",
    "latitude": 52.13575,
    "longitude": 21.04278,
    "beer_name": "Piwo lane jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "Th,Fr 16:00-21:00; Sa 14:00-20:00; Su 14:00-20:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3711021687",
    "name": "Mosir Poranki i Wieczory",
    "slug": "mosir-poranki-i-wieczory",
    "district": "Praga Południe",
    "address": "Wybrzeże Szczecińskie 1",
    "latitude": 52.23802,
    "longitude": 21.04268,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-FR - 12:00-22:00, Sa - SU 10:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11037101306",
    "name": "Piana Bar",
    "slug": "piana-bar",
    "district": "Ochota",
    "address": "Grójecka 120",
    "latitude": 52.20715,
    "longitude": 20.97202,
    "beer_name": "Holba",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-13T19:24:01.444+00:00",
    "votes_confirm": 6
  },
  {
    "id": "osm-node-5941277348",
    "name": "Zamieszanie",
    "slug": "zamieszanie",
    "district": "Pawilony",
    "address": "Nowy Świat 6/12",
    "latitude": 52.23133,
    "longitude": 21.02208,
    "beer_name": "Tyskie / Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "Mo-Th,Su 16:00-24:00+; Fr-Sa 16:00-02:00+",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-11090163316",
    "name": "Burley",
    "slug": "burley",
    "district": "Pawilony",
    "address": "Smolna 38",
    "latitude": 52.23269,
    "longitude": 21.02202,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-12443836702",
    "name": "Jolly Joker",
    "slug": "jolly-joker",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilony)",
    "latitude": 52.23289,
    "longitude": 21.02025,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-940184474",
    "name": "Meta na Foksal",
    "slug": "meta-na-foksal",
    "district": "Pawilony",
    "address": "Foksal 21",
    "latitude": 52.23345,
    "longitude": 21.0201,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": null,
    "hours": "Su-Th 11:00-02:00, Fr,Sa 12:00-05:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "pawilony-klaps",
    "name": "Klaps (Pawilony)",
    "slug": "klaps-pawilony",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilon 18)",
    "latitude": 52.23242,
    "longitude": 21.02055,
    "beer_name": "Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": "Pn-Śr 16:00-19:00: Piwo 9 zł",
    "hours": "16:00 - 02:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "pawilony-shot-gun",
    "name": "Shot Gun",
    "slug": "shot-gun",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilon 11)",
    "latitude": 52.23225,
    "longitude": 21.02038,
    "beer_name": "Warka Jasne",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": "Codziennie do 18:00: Piwo 8.50 zł",
    "hours": "15:00 - 03:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "pawilony-pewex",
    "name": "Klub Pewex",
    "slug": "klub-pewex",
    "district": "Pawilony",
    "address": "Nowy Świat 22/28 (Pawilon 22)",
    "latitude": 52.23238,
    "longitude": 21.02082,
    "beer_name": "Tyskie / Namysłów z kija",
    "beer_price_pln": 14.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 7.5,
    "happy_hour": "Wt-Czw 17:00-20:00: Piwo 10 zł",
    "hours": "16:00 - 03:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 2
  },
  {
    "id": "osm-node-416569730",
    "name": "Pub & Bar Kijowska 2",
    "slug": "pub-bar-kijowska-2",
    "district": "Praga Północ",
    "address": "Kijowska 2",
    "latitude": 52.24988,
    "longitude": 21.04431,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-416569739",
    "name": "Bar pod Kufelkiem",
    "slug": "bar-pod-kufelkiem",
    "district": "Praga Południe",
    "address": "Targowa 1",
    "latitude": 52.24802,
    "longitude": 21.04556,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1656239912",
    "name": "Paragraf",
    "slug": "paragraf",
    "district": "Wola",
    "address": "Aleja „Solidarności” 84",
    "latitude": 52.24163,
    "longitude": 20.99174,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1691364506",
    "name": "Tawerna Korsarz",
    "slug": "tawerna-korsarz",
    "district": "Wola",
    "address": "Gostyńska",
    "latitude": 52.24396,
    "longitude": 20.96562,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Sa 14:00+; Su 13:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1710670259",
    "name": "Amarant",
    "slug": "amarant",
    "district": "Ochota",
    "address": "Grójecka 118",
    "latitude": 52.20717,
    "longitude": 20.97245,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Tu,Su 12:00-22:00; We-Sa 11:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1773814891",
    "name": "La playa",
    "slug": "la-playa",
    "district": "Praga Północ",
    "address": "Wybrzeże Helskie",
    "latitude": 52.25419,
    "longitude": 21.02071,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2354068039",
    "name": "Centrum Zarządzania Światem",
    "slug": "centrum-zarzadzania-swiatem",
    "district": "Praga Północ",
    "address": "Stefana Okrzei 26",
    "latitude": 52.25107,
    "longitude": 21.03528,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo 10:00-22:00; Tu-Th 10:00-23:00; Fr-Su 10:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2445802260",
    "name": "147 Break",
    "slug": "147-break",
    "district": "Ochota",
    "address": "Nowogrodzka 84/86",
    "latitude": 52.22445,
    "longitude": 20.99054,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3406234375",
    "name": "Kufelek",
    "slug": "kufelek",
    "district": "Wola",
    "address": "Górczewska",
    "latitude": 52.23893,
    "longitude": 20.95502,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4533745995",
    "name": "Mixx Pub",
    "slug": "mixx-pub",
    "district": "Praga Północ",
    "address": "Ząbkowska 38",
    "latitude": 52.25435,
    "longitude": 21.04479,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Sa 14:00-02:00; Su 13:00-00:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4547235849",
    "name": "Bar Weterana",
    "slug": "bar-weterana",
    "district": "Ochota",
    "address": "Tarczyńska 3A",
    "latitude": 52.22328,
    "longitude": 20.98921,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4934955870",
    "name": "Arena",
    "slug": "arena",
    "district": "Wola",
    "address": "Pańska 63",
    "latitude": 52.23163,
    "longitude": 20.9946,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4945646301",
    "name": "Billboard",
    "slug": "billboard",
    "district": "Wola",
    "address": "Marcina Kasprzaka 7",
    "latitude": 52.22868,
    "longitude": 20.97432,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Fr 11:00+; Sa-Su 16:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5406007155",
    "name": "Adres",
    "slug": "adres",
    "district": "Wola",
    "address": "Wolska 94",
    "latitude": 52.23051,
    "longitude": 20.95295,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Su 16:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-6400251685",
    "name": "3/4 Cocktail Bar",
    "slug": "3-4-cocktail-bar",
    "district": "Praga Północ",
    "address": "Plac Konesera 1",
    "latitude": 52.25548,
    "longitude": 21.04583,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "We-Th,Su 16:00-23:00; Fr-Sa 16:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7809195424",
    "name": "Estry",
    "slug": "estry",
    "district": "Wola",
    "address": "Żelazna 58/62",
    "latitude": 52.23554,
    "longitude": 20.99066,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7124302273",
    "name": "Eighty Nine",
    "slug": "eighty-nine",
    "district": "Wola",
    "address": "Marcina Kasprzaka 31",
    "latitude": 52.22742,
    "longitude": 20.95406,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-8366928847",
    "name": "Bar u Wojtka",
    "slug": "bar-u-wojtka",
    "district": "Ochota",
    "address": "Karola Dickensa 15A",
    "latitude": 52.20634,
    "longitude": 20.96974,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "10:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-8988384717",
    "name": "Frank",
    "slug": "frank",
    "district": "Wola",
    "address": "Grzybowska 43A",
    "latitude": 52.2345,
    "longitude": 20.9918,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Tu-Th 12:00-23:00; Fr-Sa 12:00-24:00; Su 14:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9327944756",
    "name": "Starlet",
    "slug": "starlet",
    "district": "Praga Północ",
    "address": "Plac Konesera 3",
    "latitude": 52.25521,
    "longitude": 21.04498,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Th 12:00-22:00; Fr-Sa 12:00-24:00; Su 12:00-21:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9408767898",
    "name": "Wiśniewski",
    "slug": "wisniewski",
    "district": "Wola",
    "address": "Żelazna 51/53",
    "latitude": 52.23225,
    "longitude": 20.99207,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Th,Su 12:00-24:00; Fr-Sa 12:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9790895194",
    "name": "Amare Mio!",
    "slug": "amare-mio",
    "district": "Wola",
    "address": "Żelazna 51/53",
    "latitude": 52.23195,
    "longitude": 20.99027,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9790895196",
    "name": "Torres Wine Bar",
    "slug": "torres-wine-bar",
    "district": "Wola",
    "address": "Żelazna 51/53",
    "latitude": 52.23206,
    "longitude": 20.99026,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9790895198",
    "name": "Gimlet",
    "slug": "gimlet",
    "district": "Wola",
    "address": "Żelazna 51/53",
    "latitude": 52.23225,
    "longitude": 20.99011,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9790895199",
    "name": "Old Shaker",
    "slug": "old-shaker",
    "district": "Wola",
    "address": "Żelazna 51/53",
    "latitude": 52.23217,
    "longitude": 20.99005,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9790899517",
    "name": "Pandan",
    "slug": "pandan",
    "district": "Wola",
    "address": "Żelazna 51/53",
    "latitude": 52.2321,
    "longitude": 20.99077,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9790936055",
    "name": "Piano Bar",
    "slug": "piano-bar",
    "district": "Wola",
    "address": "Żelazna 51/53",
    "latitude": 52.2321,
    "longitude": 20.99215,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9937530277",
    "name": "La Pepica",
    "slug": "la-pepica",
    "district": "Praga Północ",
    "address": "Ząbkowska 7",
    "latitude": 52.25295,
    "longitude": 21.03909,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-We,Su off; Th 18:00-23:00; Fr-Sa 18:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9972944146",
    "name": "Krutoy Lounge",
    "slug": "krutoy-lounge",
    "district": "Wola",
    "address": "Siedmiogrodzka 1",
    "latitude": 52.23133,
    "longitude": 20.9775,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Th 16:00-24:00, Fr,Sa 14:00-02:00, Su 14:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10540133837",
    "name": "Savore",
    "slug": "savore",
    "district": "Wola",
    "address": "Grzybowska 49",
    "latitude": 52.23369,
    "longitude": 20.98959,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "11:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10590006389",
    "name": "Bazzart",
    "slug": "bazzart",
    "district": "Praga Północ",
    "address": "Ząbkowska 12",
    "latitude": 52.25267,
    "longitude": 21.03982,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Fr-Sa 19:00-03:00; Su,We,Th 19:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10702462224",
    "name": "Nine's Sports Bar",
    "slug": "nine-s-sports-bar",
    "district": "Wola",
    "address": "Haberbuscha i Schielego 6",
    "latitude": 52.23527,
    "longitude": 20.98714,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Th 18:00-23:00; Fr 18:00-01:00; Sa 15:00-01:00; Su 15:00-21:00; Mo-We \"varies\"",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10775974948",
    "name": "Smok",
    "slug": "smok",
    "district": "Wola",
    "address": "Kolejowa 43",
    "latitude": 52.22634,
    "longitude": 20.97965,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Tu-Th,Su 16:00-23:00; Fr-Sa 16:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11018644090",
    "name": "Sound Garden",
    "slug": "sound-garden",
    "district": "Włochy",
    "address": "Żwirki i Wigury 18",
    "latitude": 52.19046,
    "longitude": 20.98188,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11029954968",
    "name": "Right Place",
    "slug": "right-place",
    "district": "Śródmieście",
    "address": "Nowolipki 12",
    "latitude": 52.24512,
    "longitude": 20.99131,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11029954978",
    "name": "Metal Cave",
    "slug": "metal-cave",
    "district": "Wola",
    "address": "Jana Olbrachta 46",
    "latitude": 52.23565,
    "longitude": 20.93728,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Th 19:00-24:00; Fr-Sa 20:00+; Su off",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11039353443",
    "name": "Drugie Dno",
    "slug": "drugie-dno",
    "district": "Ochota",
    "address": "Tarczyńska 5/9",
    "latitude": 52.22305,
    "longitude": 20.98896,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11054525915",
    "name": "Offside",
    "slug": "offside",
    "district": "Praga Północ",
    "address": "Wileńska 23",
    "latitude": 52.25736,
    "longitude": 21.03811,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11059061718",
    "name": "Pistaccio",
    "slug": "pistaccio",
    "district": "Wola",
    "address": "Grzybowska 63",
    "latitude": 52.23367,
    "longitude": 20.98639,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11152384626",
    "name": "Uniwersalny",
    "slug": "uniwersalny",
    "district": "Praga Północ",
    "address": "Ratuszowa 2D",
    "latitude": 52.25426,
    "longitude": 21.02449,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11169103782",
    "name": "Beer Bar",
    "slug": "beer-bar",
    "district": "Wola",
    "address": "Marcina Kasprzaka 29",
    "latitude": 52.22747,
    "longitude": 20.95613,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Sa 15:00-01:00, Su 15:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11648854188",
    "name": "The Backstage Bar",
    "slug": "the-backstage-bar",
    "district": "Wola",
    "address": "Aleja Jana Pawła II 45A",
    "latitude": 52.24434,
    "longitude": 20.99063,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11787396645",
    "name": "EWNS",
    "slug": "ewns",
    "district": "Wola",
    "address": "Grzybowska 43A",
    "latitude": 52.23351,
    "longitude": 20.99247,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Th 10:00-24:00; Fr-Sa 10:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12389863464",
    "name": "Partian",
    "slug": "partian",
    "district": "Wola",
    "address": "Wolska 165",
    "latitude": 52.22594,
    "longitude": 20.94372,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12662423340",
    "name": "White Stone",
    "slug": "white-stone",
    "district": "Mokotów",
    "address": "Biały Kamień 5",
    "latitude": 52.20638,
    "longitude": 20.99584,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13165556135",
    "name": "Jeleń na Rykowisku",
    "slug": "jelen-na-rykowisku",
    "district": "Ochota",
    "address": "Grójecka 118",
    "latitude": 52.20722,
    "longitude": 20.97229,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13410650072",
    "name": "Moxy Bar",
    "slug": "moxy-bar",
    "district": "Praga Północ",
    "address": "Ząbkowska 29",
    "latitude": 52.2549,
    "longitude": 21.04473,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "24/7",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13427611124",
    "name": "The Social Praga",
    "slug": "the-social-praga",
    "district": "Praga Północ",
    "address": "Brzeska 23",
    "latitude": 52.25264,
    "longitude": 21.04166,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13429378168",
    "name": "Port Winoland",
    "slug": "port-winoland",
    "district": "Praga Północ",
    "address": "Wrzesińska 4",
    "latitude": 52.24975,
    "longitude": 21.03527,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13646267728",
    "name": "Win",
    "slug": "win",
    "district": "Wola",
    "address": "Aleja „Solidarności” 153",
    "latitude": 52.23926,
    "longitude": 20.98647,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-Fr 12:00-23:00 \"bar od 17:00\"; Sa-Su 12:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-29995825",
    "name": "Honoratka",
    "slug": "honoratka",
    "district": "Ochota",
    "address": "Winnicka 8B",
    "latitude": 52.21328,
    "longitude": 20.98094,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-45758490",
    "name": "Osada",
    "slug": "osada",
    "district": "Ochota",
    "address": "Bitwy Warszawskiej 1920 roku",
    "latitude": 52.21495,
    "longitude": 20.96352,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-166979925",
    "name": "Amcia",
    "slug": "amcia",
    "district": "Wola",
    "address": "Aleja Prymasa Tysiąclecia 74",
    "latitude": 52.23968,
    "longitude": 20.95737,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-We 16:00-23:00, Th, Su 16:00-24:00, Fr-Sa 16:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-218722780",
    "name": "Fun Club",
    "slug": "fun-club",
    "district": "Wola",
    "address": "Jana Olbrachta 34A",
    "latitude": 52.23653,
    "longitude": 20.93997,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-230261783",
    "name": "Tola",
    "slug": "tola",
    "district": "Ochota",
    "address": "Rokitnicka 4",
    "latitude": 52.21213,
    "longitude": 20.99717,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-977350469",
    "name": "Dwa Koła",
    "slug": "dwa-kola",
    "district": "Wola",
    "address": "Tunelowa 2B",
    "latitude": 52.22185,
    "longitude": 20.96903,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10887737090",
    "name": "BRAĆ polskie wina",
    "slug": "brac-polskie-wina",
    "district": "Praga Północ",
    "address": "Józefa Sierakowskiego 4A",
    "latitude": 52.24957,
    "longitude": 21.03331,
    "beer_name": "Namysłów / Kasztelan",
    "beer_price_pln": 14.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.5,
    "happy_hour": null,
    "hours": "Mo-We 16:00-23:00; Th 18:00-00:00; Fr 16:00-23:00; Sa 11:00-00:00; Su 11:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "lysy-pingwin",
    "name": "Łysy Pingwin",
    "slug": "lysy-pingwin",
    "district": "Praga Północ",
    "address": "Ząbkowska 11",
    "latitude": 52.25381,
    "longitude": 21.03745,
    "beer_name": "Regionalny Pils z kija",
    "beer_price_pln": 15.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": "Czw 17:00-20:00: Shot gratis do piwa",
    "hours": "16:00 - 02:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-5075294073",
    "name": "Chmury",
    "slug": "chmury",
    "district": "Praga Północ",
    "address": "11 Listopada 22",
    "latitude": 52.25931,
    "longitude": 21.03687,
    "beer_name": "Namysłów / Piwo z nalewaka",
    "beer_price_pln": 15.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 9.0,
    "happy_hour": null,
    "hours": "Su-Th 16:00-23:00, Fr,Sa 16:00-03:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-2799346901",
    "name": "Pół Na Puł",
    "slug": "pol-na-pul",
    "district": "Mokotów",
    "address": "Puławska 20",
    "latitude": 52.20748,
    "longitude": 21.02163,
    "beer_name": "Namysłów / Kozel z kija",
    "beer_price_pln": 15.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 9.0,
    "happy_hour": null,
    "hours": "Mo 09:00-20:00; Tu-Th 08:00-22:00; Fr 08:00-23:00; Su 08:30-20:00; Sa 08:30-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "suburban-kinokawiarnia-bar-stacja-falenica",
    "name": "Kinokawiarnia & Bar Stacja Falenica",
    "slug": "kinokawiarnia-bar-stacja-falenica",
    "district": "Wawer",
    "address": "ul. Patriotów 44a",
    "latitude": 52.155,
    "longitude": 21.212,
    "beer_name": "Kraftowe piwo z nalewaka",
    "beer_price_pln": 15.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 9.0,
    "happy_hour": null,
    "hours": "14:00 - 23:00",
    "is_verified": true,
    "last_updated": "2026-09-06T21:00:56.848433+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5054386942",
    "name": "Pinta",
    "slug": "pinta",
    "district": "Śródmieście",
    "address": "Nowogrodzka 4",
    "latitude": 52.23017,
    "longitude": 21.01838,
    "beer_name": "Polski Lekki Pils z kranu",
    "beer_price_pln": 15.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 12.0,
    "happy_hour": null,
    "hours": "12:00-02:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "w-oparach-absurdu",
    "name": "W Oparach Absurdu",
    "slug": "w-oparach-absurdu",
    "district": "Praga Północ",
    "address": "Ząbkowska 6",
    "latitude": 52.25364,
    "longitude": 21.03612,
    "beer_name": "Svijany / Namysłów z kranu",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "14:00 - 03:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-302711831",
    "name": "Inspector Lounge",
    "slug": "inspector-lounge",
    "district": "Śródmieście",
    "address": "Zielna 37",
    "latitude": 52.23618,
    "longitude": 21.00649,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-306550336",
    "name": "Zakątek",
    "slug": "zakatek",
    "district": "Śródmieście",
    "address": "Chmielna 5",
    "latitude": 52.23288,
    "longitude": 21.01826,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-311852591",
    "name": "W Orbicie Słońca",
    "slug": "w-orbicie-slonca",
    "district": "Śródmieście",
    "address": "Marszałkowska 45/49",
    "latitude": 52.22091,
    "longitude": 21.01691,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Tu-Th 16:00-01:00; Fr 16:00-02:00; Sa 14:00-02:00; Su 14:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-311852670",
    "name": "Cafe Rock'n'Roll",
    "slug": "cafe-rock-n-roll",
    "district": "Śródmieście",
    "address": "Mokotowska 4/6",
    "latitude": 52.21789,
    "longitude": 21.01706,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-312054609",
    "name": "Sultan Club",
    "slug": "sultan-club",
    "district": "Śródmieście",
    "address": "Chmielna 35",
    "latitude": 52.23168,
    "longitude": 21.01212,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "24/7",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-316892296",
    "name": "Shamrock",
    "slug": "shamrock",
    "district": "Śródmieście",
    "address": "Zgoda 5",
    "latitude": 52.23271,
    "longitude": 21.01363,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-333136529",
    "name": "Machupisko",
    "slug": "machupisko",
    "district": "Śródmieście",
    "address": "Plac Konstytucji 6",
    "latitude": 52.22233,
    "longitude": 21.01751,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "11:30-22:30",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-334010752",
    "name": "Irish Pub",
    "slug": "irish-pub",
    "district": "Śródmieście",
    "address": "Miodowa 3",
    "latitude": 52.24603,
    "longitude": 21.01276,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "11:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-378233265",
    "name": "Myata Lounge",
    "slug": "myata-lounge",
    "district": "Śródmieście",
    "address": "Żurawia 6/12",
    "latitude": 52.22912,
    "longitude": 21.01818,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 12:00-01:00; Fr 12:00-04:00; Sa 14:00-04:00; Su 14:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-416591075",
    "name": "Klub Wieżyca",
    "slug": "klub-wiezyca",
    "district": "Śródmieście",
    "address": "Aleje Jerozolimskie 1",
    "latitude": 52.23266,
    "longitude": 21.02689,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 16:00-24:00; Fr-Sa 16:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-416622148",
    "name": "Emerald Irish Pub",
    "slug": "emerald-irish-pub",
    "district": "Śródmieście",
    "address": "Aleje Jerozolimskie 4",
    "latitude": 52.2328,
    "longitude": 21.02394,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-473159293",
    "name": "Zanzi Bar",
    "slug": "zanzi-bar",
    "district": "Praga Północ",
    "address": "Modlińska 3B",
    "latitude": 52.29101,
    "longitude": 21.00081,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Fr 05:00-22:00; Sa,Su 11:00-20:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-549651031",
    "name": "Azyl",
    "slug": "azyl",
    "district": "Śródmieście",
    "address": "Nowogrodzka 20",
    "latitude": 52.22941,
    "longitude": 21.0147,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th,Su 16:00-24:00; Fr-Sa 16:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-583392465",
    "name": "Mały Wojtek",
    "slug": "maly-wojtek",
    "district": "Śródmieście",
    "address": "Bracka 20",
    "latitude": 52.23222,
    "longitude": 21.01672,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-907512396",
    "name": "Rudy pies",
    "slug": "rudy-pies",
    "district": "Praga Południe",
    "address": "Łukowska 2A",
    "latitude": 52.23691,
    "longitude": 21.11209,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1111952597",
    "name": "Hoppiness",
    "slug": "hoppiness",
    "district": "Śródmieście",
    "address": "Chmielna 27/31",
    "latitude": 52.23195,
    "longitude": 21.01366,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1271246250",
    "name": "Meta",
    "slug": "meta",
    "district": "Wilanów",
    "address": "Łukasza Drewny",
    "latitude": 52.12822,
    "longitude": 21.09643,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1361402136",
    "name": "Broadway Club",
    "slug": "broadway-club",
    "district": "Targówek",
    "address": "Chodecka 17",
    "latitude": 52.29873,
    "longitude": 21.04207,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1437931262",
    "name": "City Wine",
    "slug": "city-wine",
    "district": "Śródmieście",
    "address": "Grzybowska 2",
    "latitude": 52.23754,
    "longitude": 21.00317,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 12:00-20:00; Fr-Sa 12:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1533131151",
    "name": "Beirut",
    "slug": "beirut",
    "district": "Śródmieście",
    "address": "Poznańska 12",
    "latitude": 52.22477,
    "longitude": 21.01225,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo,Tu 12:00-24:00; We-Fr 00:00-01:00,12:00-24:00; Sa,Su 00:00-02:00,12:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2119972546",
    "name": "Drink Bar",
    "slug": "drink-bar",
    "district": "Śródmieście",
    "address": "Wspólna 52/54",
    "latitude": 52.22692,
    "longitude": 21.01197,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2203276440",
    "name": "Frodo",
    "slug": "frodo",
    "district": "Wola",
    "address": "Chmielna 98",
    "latitude": 52.22947,
    "longitude": 20.99968,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Sa 11:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2302367450",
    "name": "Kraken",
    "slug": "kraken",
    "district": "Śródmieście",
    "address": "Poznańska 12",
    "latitude": 52.22468,
    "longitude": 21.0123,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2347499317",
    "name": "Źródełko",
    "slug": "zrodelko",
    "district": "Śródmieście",
    "address": "Aleja Tomasza Hopfera 11",
    "latitude": 52.22154,
    "longitude": 21.03293,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2752716695",
    "name": "Beer & Bones",
    "slug": "beer-bones",
    "district": "Śródmieście",
    "address": "Żurawia 32/34",
    "latitude": 52.22841,
    "longitude": 21.01396,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 14:00-02:00; Fr-Su 14:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3337131003",
    "name": "Ginnery",
    "slug": "ginnery",
    "district": "Śródmieście",
    "address": "Nowogrodzka 31",
    "latitude": 52.22894,
    "longitude": 21.01362,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-We,Su 16:00-24:00; Th 16:00-01:00; Fr-Sa 16:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3627931805",
    "name": "Warszawa Powiśle",
    "slug": "warszawa-powisle",
    "district": "Śródmieście",
    "address": "Leona Kruczkowskiego 3b",
    "latitude": 52.23408,
    "longitude": 21.02989,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3799423705",
    "name": "Bollywood Lounge",
    "slug": "bollywood-lounge",
    "district": "Śródmieście",
    "address": "Nowogrodzka 22",
    "latitude": 52.22966,
    "longitude": 21.01396,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3863718484",
    "name": "Małe Piwo",
    "slug": "male-piwo",
    "district": "Śródmieście",
    "address": "Oleandrów 3",
    "latitude": 52.21677,
    "longitude": 21.01888,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Sa 17:00-24:00; Su 16:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3985025972",
    "name": "Warmut",
    "slug": "warmut",
    "district": "Śródmieście",
    "address": "Marszałkowska 45/49",
    "latitude": 52.22076,
    "longitude": 21.017,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Tu-We,Su 17:00-24:00; Th 17:00-02:00; Fr-Sa 17:00-03:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4018492376",
    "name": "Miejsce",
    "slug": "miejsce",
    "district": "Śródmieście",
    "address": "Generała Mariusza Zaruskiego 1",
    "latitude": 52.21961,
    "longitude": 21.04731,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Tu off; We-Th 16:00-23:00; Fr 16:00-01:00; Sa 13:00-01:00; Su 13:00-19:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4244306639",
    "name": "Ramona",
    "slug": "ramona",
    "district": "Śródmieście",
    "address": "Widok 18",
    "latitude": 52.23122,
    "longitude": 21.01364,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo,Su 16:00-24:00; Tu-Th 16:00-01:00; Fr-Sa 16:00-04:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4338845889",
    "name": "Weles",
    "slug": "weles",
    "district": "Śródmieście",
    "address": "Nowogrodzka 11",
    "latitude": 52.2291,
    "longitude": 21.01777,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4375857798",
    "name": "Rausz",
    "slug": "rausz",
    "district": "Śródmieście",
    "address": "Wilcza 27",
    "latitude": 52.22498,
    "longitude": 21.01671,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 16:00-22:00; Fr-Sa 16:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4460884032",
    "name": "Bar Koszyki",
    "slug": "bar-koszyki",
    "district": "Śródmieście",
    "address": "Koszykowa 63",
    "latitude": 52.22225,
    "longitude": 21.01103,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4547274110",
    "name": "Piętro Niżej",
    "slug": "pietro-nizej",
    "district": "Śródmieście",
    "address": "Zielna 39",
    "latitude": 52.23629,
    "longitude": 21.00642,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "10:30-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4610359292",
    "name": "Lemon Bar",
    "slug": "lemon-bar",
    "district": "Śródmieście",
    "address": "Henryka Sienkiewicza",
    "latitude": 52.23443,
    "longitude": 21.01235,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "od 17:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4709081765",
    "name": "+One Bar",
    "slug": "one-bar",
    "district": "Śródmieście",
    "address": "Emilii Plater 49",
    "latitude": 52.2323,
    "longitude": 21.00269,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4871708185",
    "name": "OL3",
    "slug": "ol3",
    "district": "Śródmieście",
    "address": "Oleandrów 3",
    "latitude": 52.21679,
    "longitude": 21.01895,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "We-Fr 18:00-24:00; Sa 12:00-24:00; Su 12+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4871708186",
    "name": "Świetlica",
    "slug": "swietlica",
    "district": "Śródmieście",
    "address": "Marszałkowska 17",
    "latitude": 52.21652,
    "longitude": 21.01963,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Fr-Sa 15:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5038320569",
    "name": "Miami Wars",
    "slug": "miami-wars",
    "district": "Śródmieście",
    "address": "Solec 8",
    "latitude": 52.2278,
    "longitude": 21.04469,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5074631721",
    "name": "Kita Koguta",
    "slug": "kita-koguta",
    "district": "Śródmieście",
    "address": "Krucza 6/14",
    "latitude": 52.22543,
    "longitude": 21.01935,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "We-Th 18:00-24:00; Fr-Sa 18+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5076967399",
    "name": "Molly Malone's",
    "slug": "molly-malone-s",
    "district": "Śródmieście",
    "address": "Krakowskie Przedmieście 41",
    "latitude": 52.24448,
    "longitude": 21.01383,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 14:00-02:00; Fr 13:00-02:00; Sa,Su 12:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5140309518",
    "name": "Feliks Bar",
    "slug": "feliks-bar",
    "district": "Śródmieście",
    "address": "Nowogrodzka 15",
    "latitude": 52.22961,
    "longitude": 21.01669,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo off; Tu-We 16:00-24:00; Th 16:00-01:00; Fr-Sa 12:00-02:00; Su 12:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5140313264",
    "name": "Barbara",
    "slug": "barbara",
    "district": "Śródmieście",
    "address": "Nowogrodzka 10",
    "latitude": 52.2298,
    "longitude": 21.01661,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5262194021",
    "name": "Elephant",
    "slug": "elephant",
    "district": "Śródmieście",
    "address": "Freta 19",
    "latitude": 52.25183,
    "longitude": 21.00794,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5343148942",
    "name": "Aviator Bar & Lounge",
    "slug": "aviator-bar-lounge",
    "district": "Włochy",
    "address": "Komitetu Obrony Robotników 24",
    "latitude": 52.17819,
    "longitude": 20.98299,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Su 20:00-03:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5602510246",
    "name": "El Koktel",
    "slug": "el-koktel",
    "district": "Śródmieście",
    "address": "Wojciecha Górskiego 9",
    "latitude": 52.23345,
    "longitude": 21.01507,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Tu-Sa 18:00-00:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5615776721",
    "name": "Kamrat",
    "slug": "kamrat",
    "district": "Białołęka",
    "address": "Odkryta 1",
    "latitude": 52.32476,
    "longitude": 20.93635,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5726560422",
    "name": "Acapulco",
    "slug": "acapulco",
    "district": "Targówek",
    "address": "Chodecka 21",
    "latitude": 52.29927,
    "longitude": 21.04221,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5900410004",
    "name": "Worek Kości",
    "slug": "worek-kosci",
    "district": "Śródmieście",
    "address": "Bagatela 10",
    "latitude": 52.21378,
    "longitude": 21.02302,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Sa 12:00-21:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-6400749331",
    "name": "Zebra Shot Bar",
    "slug": "zebra-shot-bar",
    "district": "Śródmieście",
    "address": "Nowogrodzka 22",
    "latitude": 52.22975,
    "longitude": 21.01391,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th,Su 18:00+; Fr-Sa 17:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-6445628688",
    "name": "Pacyfik",
    "slug": "pacyfik",
    "district": "Śródmieście",
    "address": "Hoża 61",
    "latitude": 52.22467,
    "longitude": 21.00772,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Fr 16:00+; Sa-Su 12:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-6492811807",
    "name": "Knieja Gajowniczka",
    "slug": "knieja-gajowniczka",
    "district": "Rembertów",
    "address": "Rotmistrza Witolda Pileckiego",
    "latitude": 52.276,
    "longitude": 21.12415,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-6693592385",
    "name": "Pijana Wiśnia",
    "slug": "pijana-wisnia",
    "district": "Śródmieście",
    "address": "Nowy Świat 39",
    "latitude": 52.23424,
    "longitude": 21.01871,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-We,Su 12:00-24:00; Th 12:00-01:00; Fr-Sa 12:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7016923616",
    "name": "Czupito",
    "slug": "czupito",
    "district": "Śródmieście",
    "address": "Mazowiecka 9",
    "latitude": 52.23707,
    "longitude": 21.013,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7132977885",
    "name": "Łaskawość Tytusa",
    "slug": "laskawosc-tytusa",
    "district": "Śródmieście",
    "address": "Piękna 49",
    "latitude": 52.22279,
    "longitude": 21.01052,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 17:00-23:00; Fr-Sa 17:00-24:00; Su off",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7235319285",
    "name": "Winem Powiśle",
    "slug": "winem-powisle",
    "district": "Śródmieście",
    "address": "Tamka 37",
    "latitude": 52.23678,
    "longitude": 21.0243,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Tu-Th,Su 17:00-22:00; Fr-Sa 17:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7700156485",
    "name": "Wozownia",
    "slug": "wozownia",
    "district": "Śródmieście",
    "address": "Plac Trzech Krzyży 16",
    "latitude": 52.22996,
    "longitude": 21.02146,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-We 16:00-24:00; Th-Sa 16:00-01:00; Su 11:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7708204564",
    "name": "Hopster",
    "slug": "hopster",
    "district": "Śródmieście",
    "address": "Nowy Świat 53",
    "latitude": 52.23578,
    "longitude": 21.01808,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-We,Su 16:00-23:00; Th 16:00-24:00; Fr-Sa 16:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7782366091",
    "name": "Afera",
    "slug": "afera",
    "district": "Śródmieście",
    "address": "Szpitalna 3",
    "latitude": 52.23288,
    "longitude": 21.01476,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-7796863374",
    "name": "Klar",
    "slug": "klar",
    "district": "Śródmieście",
    "address": "Krakowskie Przedmieście 41",
    "latitude": 52.24445,
    "longitude": 21.01384,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-8567961291",
    "name": "Steam Bar",
    "slug": "steam-bar",
    "district": "Śródmieście",
    "address": "Nowogrodzka 23",
    "latitude": 52.22926,
    "longitude": 21.01502,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-8567986993",
    "name": "Panorama Sky Bar",
    "slug": "panorama-sky-bar",
    "district": "Śródmieście",
    "address": "Aleje Jerozolimskie 65/79",
    "latitude": 52.22775,
    "longitude": 21.00488,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Su 17:00-21:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-8568010071",
    "name": "Zagrywki",
    "slug": "zagrywki",
    "district": "Śródmieście",
    "address": "Nowy Świat 4A",
    "latitude": 52.23046,
    "longitude": 21.02234,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 16:00-01:00; Fr 16:00-03:00; Sa 12:00-03:00; Su 12:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-8761530991",
    "name": "Soul",
    "slug": "soul",
    "district": "Śródmieście",
    "address": "Żurawia 47",
    "latitude": 52.2275,
    "longitude": 21.01123,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th,Su 16:00-01:00; Fr-Sa 16:00-03:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-8884067349",
    "name": "Kulturalna",
    "slug": "kulturalna",
    "district": "Śródmieście",
    "address": "Plac Defilad 1",
    "latitude": 52.23126,
    "longitude": 21.00664,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-8931060017",
    "name": "Grono",
    "slug": "grono",
    "district": "Śródmieście",
    "address": "Mokotowska 54",
    "latitude": 52.2261,
    "longitude": 21.02232,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 12:00-22:00; Fr-Sa 12:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9028264713",
    "name": "BackRoom Bar",
    "slug": "backroom-bar",
    "district": "Śródmieście",
    "address": "Koszykowa 49A",
    "latitude": 52.22192,
    "longitude": 21.01425,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 19:00-00:00; Fr, Sa 19:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9045185565",
    "name": "Laco",
    "slug": "laco",
    "district": "Śródmieście",
    "address": "Krakowskie Przedmieście 11",
    "latitude": 52.24113,
    "longitude": 21.01572,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9241881654",
    "name": "Charlie",
    "slug": "charlie",
    "district": "Śródmieście",
    "address": "Mokotowska 39",
    "latitude": 52.22256,
    "longitude": 21.01947,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Tu-Th 19:00-01:00; Fr 17:00-02:00; Sa 19:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9283827962",
    "name": "Leonardo Daj Winko",
    "slug": "leonardo-daj-winko",
    "district": "Śródmieście",
    "address": "Plac Konstytucji 2",
    "latitude": 52.22172,
    "longitude": 21.01773,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9349808652",
    "name": "Cybermachina",
    "slug": "cybermachina",
    "district": "Śródmieście",
    "address": "Nowy Świat 54/56",
    "latitude": 52.23516,
    "longitude": 21.01889,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Su-Th 14:00-01:00; Fr-Sa 14:00-03:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9519232403",
    "name": "Przejście",
    "slug": "przejscie",
    "district": "Śródmieście",
    "address": "Aleja Jana Chrystiana Szucha 29",
    "latitude": 52.21875,
    "longitude": 21.02441,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "24/7",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9790933803",
    "name": "Instytut",
    "slug": "instytut",
    "district": "Wola",
    "address": "Prosta 2/14",
    "latitude": 52.23288,
    "longitude": 20.99528,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 20:00-03:00; Fr-Sa 20:00-04:30; Su 20:00-03:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9796966783",
    "name": "Cud nad Wisłą",
    "slug": "cud-nad-wisla",
    "district": "Bulwary",
    "address": "Bulwar Flotylli Wiślanej",
    "latitude": 52.22911,
    "longitude": 21.0435,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9822169418",
    "name": "Loreta Bar",
    "slug": "loreta-bar",
    "district": "Śródmieście",
    "address": "Widok 9",
    "latitude": 52.23117,
    "longitude": 21.01483,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "09:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9828683919",
    "name": "Piwnica Pod Michałem",
    "slug": "piwnica-pod-michalem",
    "district": "Śródmieście",
    "address": "Freta 4/6",
    "latitude": 52.251,
    "longitude": 21.00934,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Fr 16:00+; Sa-Su 13:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9836773218",
    "name": "Oblako",
    "slug": "oblako",
    "district": "Śródmieście",
    "address": "Henryka Sienkiewicza",
    "latitude": 52.23441,
    "longitude": 21.01225,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th,Su 16:00-01:00; Fr 16:00-03:00; Sa 16:00-04:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9858657819",
    "name": "Connect",
    "slug": "connect",
    "district": "Wola",
    "address": "Chmielna 98",
    "latitude": 52.22923,
    "longitude": 20.99982,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th,Su 10:00-22:00; Fr-Sa 10:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9862659410",
    "name": "nGin",
    "slug": "ngin",
    "district": "Włochy",
    "address": "Żwirki i Wigury 1H",
    "latitude": 52.17255,
    "longitude": 20.97335,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9904534971",
    "name": "Labirynt",
    "slug": "labirynt",
    "district": "Śródmieście",
    "address": "Chmielna 5",
    "latitude": 52.2327,
    "longitude": 21.01848,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9904534980",
    "name": "Margariteros",
    "slug": "margariteros",
    "district": "Śródmieście",
    "address": "Chmielna 7/9",
    "latitude": 52.2326,
    "longitude": 21.01785,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "We-Th 17:00-23:00; Fr-Sa 17:00-02:00; Su 15:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9904534988",
    "name": "Bless",
    "slug": "bless",
    "district": "Śródmieście",
    "address": "Chmielna 15",
    "latitude": 52.23251,
    "longitude": 21.01631,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9919628154",
    "name": "Disparo",
    "slug": "disparo",
    "district": "Śródmieście",
    "address": "Nowogrodzka 22",
    "latitude": 52.22949,
    "longitude": 21.01406,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9952896533",
    "name": "Pub51",
    "slug": "pub51",
    "district": "Włochy",
    "address": "Popularna 51",
    "latitude": 52.20351,
    "longitude": 20.92694,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th,Su 14:00-22:00; Fr-Sa 14:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9955564802",
    "name": "Alternatywa",
    "slug": "alternatywa",
    "district": "Śródmieście",
    "address": "Marszałkowska 2",
    "latitude": 52.21414,
    "longitude": 21.02169,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 15:00-24:00; Fr 15:00-02:00; Sa 18:00-02:00; Su 18:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10011990148",
    "name": "Longbar",
    "slug": "longbar",
    "district": "Śródmieście",
    "address": "Krakowskie Przedmieście 13",
    "latitude": 52.2416,
    "longitude": 21.01428,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10012092843",
    "name": "Ave Pegaz",
    "slug": "ave-pegaz",
    "district": "Śródmieście",
    "address": "Plac marszałka Józefa Piłsudskiego 9",
    "latitude": 52.24279,
    "longitude": 21.01106,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10075368441",
    "name": "VHS",
    "slug": "vhs",
    "district": "Śródmieście",
    "address": "Poznańska 7",
    "latitude": 52.22391,
    "longitude": 21.01234,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10103180403",
    "name": "Botanic Bar",
    "slug": "botanic-bar",
    "district": "Wola",
    "address": "Górczewska",
    "latitude": 52.24093,
    "longitude": 20.93317,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10311427306",
    "name": "Lobby Bar",
    "slug": "lobby-bar",
    "district": "Śródmieście",
    "address": "Aleje Jerozolimskie 67/69",
    "latitude": 52.22793,
    "longitude": 21.00496,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10704874615",
    "name": "Sakebar by Nobu",
    "slug": "sakebar-by-nobu",
    "district": "Śródmieście",
    "address": "Wilcza 73",
    "latitude": 52.22319,
    "longitude": 21.00823,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10704942665",
    "name": "Bar a Wino",
    "slug": "bar-a-wino",
    "district": "Śródmieście",
    "address": "Stanisława Noakowskiego 16",
    "latitude": 52.22156,
    "longitude": 21.01011,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 14:00-23:00; Fr-Sa 14:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10721807266",
    "name": "Upper Deck",
    "slug": "upper-deck",
    "district": "Śródmieście",
    "address": "Koszykowa 63",
    "latitude": 52.22218,
    "longitude": 21.01067,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10753856739",
    "name": "Back2Rock",
    "slug": "back2rock",
    "district": "Śródmieście",
    "address": "Śliska 3",
    "latitude": 52.23233,
    "longitude": 21.00195,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Th-Sa 17:00-02:00; Mo-We 17:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10816033026",
    "name": "Resort",
    "slug": "resort",
    "district": "Śródmieście",
    "address": "Bielańska 1",
    "latitude": 52.24395,
    "longitude": 21.0071,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 15:00-22:00; Fr 15:00-23:00; Sa 12:00-23:00; Su 12:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10830352301",
    "name": "Buns & Bottles",
    "slug": "buns-bottles",
    "district": "Śródmieście",
    "address": "Lwowska 9",
    "latitude": 52.22134,
    "longitude": 21.01224,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "18:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10979328071",
    "name": "Republika Wina",
    "slug": "republika-wina",
    "district": "Śródmieście",
    "address": "Księdza Ignacego Skorupki 5",
    "latitude": 52.22587,
    "longitude": 21.01563,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo 16:00-20:00; Tu-Th 16:00-22:00; Fr-Sa 16:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11018644094",
    "name": "Kociołek i Wino",
    "slug": "kociolek-i-wino",
    "district": "Wawer",
    "address": "Michała Kajki",
    "latitude": 52.21893,
    "longitude": 21.16431,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11032913566",
    "name": "Izba",
    "slug": "izba",
    "district": "Śródmieście",
    "address": "Żurawia 16",
    "latitude": 52.22881,
    "longitude": 21.01682,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11033970864",
    "name": "Strefa Kibica",
    "slug": "strefa-kibica",
    "district": "Praga Południe",
    "address": "Warszawa",
    "latitude": 52.23853,
    "longitude": 21.04682,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11035383256",
    "name": "Mono Kitchen",
    "slug": "mono-kitchen",
    "district": "Włochy",
    "address": "Słowicza 28",
    "latitude": 52.18913,
    "longitude": 20.96236,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11035383263",
    "name": "Amcia Grill&Pub",
    "slug": "amcia-grill-pub",
    "district": "Białołęka",
    "address": "Ostródzka",
    "latitude": 52.32465,
    "longitude": 21.04869,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11043802505",
    "name": "Ellada Souvlaki Bar",
    "slug": "ellada-souvlaki-bar",
    "district": "Białołęka",
    "address": "Skarbka z Gór 116",
    "latitude": 52.31706,
    "longitude": 21.05942,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11042029410",
    "name": "Falcon Klub Bilardowy",
    "slug": "falcon-klub-bilardowy",
    "district": "Białołęka",
    "address": "Myśliborska 114",
    "latitude": 52.3234,
    "longitude": 20.94978,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 16:00-24:00; Fr-Sa 14:00-24:00,00:00-02:00; Su 14:00-00:00;  PH closed",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11046179213",
    "name": "BarKa",
    "slug": "barka",
    "district": "Bulwary",
    "address": "Bulwar Bohdana Grzymały-Siedleckiego",
    "latitude": 52.23945,
    "longitude": 21.03417,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11052560526",
    "name": "To Co Lubię",
    "slug": "to-co-lubie",
    "district": "Targówek",
    "address": "Świętego Wincentego 99",
    "latitude": 52.29509,
    "longitude": 21.05329,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11055281467",
    "name": "Aura",
    "slug": "aura",
    "district": "Śródmieście",
    "address": "Hoża 27",
    "latitude": 52.22652,
    "longitude": 21.01596,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11055301000",
    "name": "Musa",
    "slug": "musa",
    "district": "Śródmieście",
    "address": "Wilcza 17",
    "latitude": 52.2254,
    "longitude": 21.01868,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11061363265",
    "name": "Legia Sports Bar",
    "slug": "legia-sports-bar",
    "district": "Śródmieście",
    "address": "Łazienkowska 3",
    "latitude": 52.22137,
    "longitude": 21.04046,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11061363268",
    "name": "Śliska The Lounge",
    "slug": "sliska-the-lounge",
    "district": "Śródmieście",
    "address": "Emilii Plater 49",
    "latitude": 52.23242,
    "longitude": 21.00273,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11068725461",
    "name": "Beach Bar",
    "slug": "beach-bar",
    "district": "Wesoła",
    "address": "Armii Krajowej 32",
    "latitude": 52.25,
    "longitude": 21.22193,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11068725463",
    "name": "Kalima",
    "slug": "kalima",
    "district": "Śródmieście",
    "address": "Bulwar Bohdana Grzymały-Siedleckiego",
    "latitude": 52.2404,
    "longitude": 21.03297,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11068725464",
    "name": "Klub Retro",
    "slug": "klub-retro",
    "district": "Wawer",
    "address": "Żwanowiecka",
    "latitude": 52.17123,
    "longitude": 21.20676,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11109606193",
    "name": "Etykieta Pizza & Beer",
    "slug": "etykieta-pizza-beer",
    "district": "Bemowo",
    "address": "Generała Tadeusza Pełczyńskiego",
    "latitude": 52.24211,
    "longitude": 20.90878,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Su 12:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11152384627",
    "name": "Verte Bar",
    "slug": "verte-bar",
    "district": "Śródmieście",
    "address": "Aleja „Solidarności”",
    "latitude": 52.2468,
    "longitude": 21.01176,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "11:00-1:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11307421470",
    "name": "H.4.0.S",
    "slug": "h-4-0-s",
    "district": "Śródmieście",
    "address": "Marszałkowska 64",
    "latitude": 52.22464,
    "longitude": 21.01534,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 16:00-24:00; Fr 16:00-02:00; Sa 12:00-02:00; Su 12:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11434349304",
    "name": "Lokal +48",
    "slug": "lokal-48",
    "district": "Włochy",
    "address": "Żwirki i Wigury 1",
    "latitude": 52.1739,
    "longitude": 20.96876,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11634402256",
    "name": "Gi Gi",
    "slug": "gi-gi",
    "district": "Śródmieście",
    "address": "Oboźna 9",
    "latitude": 52.23889,
    "longitude": 21.02013,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11648854186",
    "name": "Nguyen's",
    "slug": "nguyen-s",
    "district": "Praga Południe",
    "address": "Ostrobramska 73E",
    "latitude": 52.23118,
    "longitude": 21.11361,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11862417540",
    "name": "Przy3maj",
    "slug": "przy3maj",
    "district": "Śródmieście",
    "address": "Aleja 3 Maja 16/18A",
    "latitude": 52.23403,
    "longitude": 21.0312,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11866819830",
    "name": "Niewinność",
    "slug": "niewinnosc",
    "district": "Śródmieście",
    "address": "Zgoda 5",
    "latitude": 52.2328,
    "longitude": 21.01329,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo off; Tu-Th 16:00-22:00; Fr 16:00-02:00; Sa 09:00-02:00; Su 09:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11981452787",
    "name": "Cheers!",
    "slug": "cheers",
    "district": "Śródmieście",
    "address": "Browarna 4",
    "latitude": 52.24042,
    "longitude": 21.02292,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "12:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12026827517",
    "name": "Kegs",
    "slug": "kegs",
    "district": "Wola",
    "address": "Jana Kazimierza 68",
    "latitude": 52.22148,
    "longitude": 20.92955,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Su-Th 17:00-23:00, Fr,Sa 17:00-01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12037487570",
    "name": "Plac Zabaw nad Wisłą",
    "slug": "plac-zabaw-nad-wisla",
    "district": "Bulwary",
    "address": "Bulwar Bohdana Grzymały-Siedleckiego",
    "latitude": 52.23913,
    "longitude": 21.03394,
    "beer_name": "Żywiec z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-12093884729",
    "name": "La Birra",
    "slug": "la-birra",
    "district": "Ursus",
    "address": "Edwarda Habicha 23",
    "latitude": 52.20663,
    "longitude": 20.87834,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo off; Tu-Th 17:00-23:00; Fr 17:00-00:00; Sa 16:00-00:00; Su,PH 14:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12160542258",
    "name": "Wynurzenie",
    "slug": "wynurzenie",
    "district": "Śródmieście",
    "address": "Bulwar generała George'a Smitha Pattona",
    "latitude": 52.24241,
    "longitude": 21.02984,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12339094591",
    "name": "Pixels&Pints",
    "slug": "pixels-pints",
    "district": "Śródmieście",
    "address": "Aleja Niepodległości 208B",
    "latitude": 52.2174,
    "longitude": 21.00511,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12422530094",
    "name": "Warshishawa",
    "slug": "warshishawa",
    "district": "Śródmieście",
    "address": "Grzybowska 2",
    "latitude": 52.23791,
    "longitude": 21.00266,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12509885210",
    "name": "Warszawska",
    "slug": "warszawska",
    "district": "Śródmieście",
    "address": "Plac Powstańców Warszawy 9",
    "latitude": 52.2357,
    "longitude": 21.01192,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "24/7",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12647791019",
    "name": "Ivy Lounge",
    "slug": "ivy-lounge",
    "district": "Śródmieście",
    "address": "Wybrzeże Kościuszkowskie 43B",
    "latitude": 52.2407,
    "longitude": 21.02847,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12647791264",
    "name": "Champs",
    "slug": "champs",
    "district": "Śródmieście",
    "address": "Wybrzeże Kościuszkowskie 43A",
    "latitude": 52.2399,
    "longitude": 21.02917,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12858109300",
    "name": "Hood",
    "slug": "hood",
    "district": "Śródmieście",
    "address": "Poznańska 37",
    "latitude": 52.22883,
    "longitude": 21.00976,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th 09:00-22:00; Fr-Sa 09:00-23:00; Su 09:00-20:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12888500997",
    "name": "Messa",
    "slug": "messa",
    "district": "Śródmieście",
    "address": "Bulwar generała George'a Smitha Pattona",
    "latitude": 52.24372,
    "longitude": 21.0267,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Fr 11:00+; Sa-Su 10:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-12956154793",
    "name": "Przyjaźń",
    "slug": "przyjazn",
    "district": "Śródmieście",
    "address": "Wioślarska 6",
    "latitude": 52.23285,
    "longitude": 21.04021,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13096197701",
    "name": "Le Rendez Vous",
    "slug": "le-rendez-vous",
    "district": "Śródmieście",
    "address": "Mokotowska 8",
    "latitude": 52.21872,
    "longitude": 21.01734,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13097027901",
    "name": "Bar Rascal",
    "slug": "bar-rascal",
    "district": "Śródmieście",
    "address": "Moliera 6",
    "latitude": 52.24418,
    "longitude": 21.01171,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13135172938",
    "name": "HighGarden Rooftop Lounge",
    "slug": "highgarden-rooftop-lounge",
    "district": "Wola",
    "address": "Chmielna 69",
    "latitude": 52.2288,
    "longitude": 21.00018,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Su 10:00-00:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13811965801",
    "name": "Kakadu Karaoke",
    "slug": "kakadu-karaoke",
    "district": "Śródmieście",
    "address": "Zajęcza 2B",
    "latitude": 52.24043,
    "longitude": 21.02815,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-13931793948",
    "name": "Pod Gigantami",
    "slug": "pod-gigantami",
    "district": "Śródmieście",
    "address": "Bulwar Flotylli Wiślanej",
    "latitude": 52.2286,
    "longitude": 21.04367,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-14003260757",
    "name": "Lodi Dodi",
    "slug": "lodi-dodi",
    "district": "Śródmieście",
    "address": "Wilcza 23",
    "latitude": 52.22518,
    "longitude": 21.01762,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Th,Su 19:00-01:00; Fr-Sa 19:00-03:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-14048312362",
    "name": "Rob & Jerry",
    "slug": "rob-jerry",
    "district": "Włochy",
    "address": "Żwirki i Wigury 1",
    "latitude": 52.17093,
    "longitude": 20.97152,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-229170140",
    "name": "Kaskada",
    "slug": "kaskada",
    "district": "Bulwary",
    "address": "Bulwar Bohdana Grzymały-Siedleckiego",
    "latitude": 52.23873,
    "longitude": 21.03505,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-300979385",
    "name": "Butelki",
    "slug": "butelki",
    "district": "Targówek",
    "address": "Ludwika Kondratowicza 4E",
    "latitude": 52.2928,
    "longitude": 21.03275,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "Mo-Su 14:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-316613218",
    "name": "Va Bene",
    "slug": "va-bene",
    "district": "Śródmieście",
    "address": "Ludwika Waryńskiego 9C",
    "latitude": 52.22108,
    "longitude": 21.01524,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-865418148",
    "name": "Dworzec Wodny",
    "slug": "dworzec-wodny",
    "district": "Śródmieście",
    "address": "Bulwar Bohdana Grzymały-Siedleckiego",
    "latitude": 52.24015,
    "longitude": 21.0333,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-888765994",
    "name": "Szerokie Bary",
    "slug": "szerokie-bary",
    "district": "Śródmieście",
    "address": "Wioślarska",
    "latitude": 52.23186,
    "longitude": 21.04106,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-993221384",
    "name": "Kandela Bar",
    "slug": "kandela-bar",
    "district": "Śródmieście",
    "address": "Leszczyńska",
    "latitude": 52.24109,
    "longitude": 21.02772,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-993221390",
    "name": "Centrala Bar",
    "slug": "centrala-bar",
    "district": "Śródmieście",
    "address": "Wybrzeże Kościuszkowskie",
    "latitude": 52.24053,
    "longitude": 21.02842,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-5777672936",
    "name": "Na Cyplu",
    "slug": "na-cyplu",
    "district": "Śródmieście",
    "address": "Generała Mariusza Zaruskiego 12",
    "latitude": 52.22557,
    "longitude": 21.0456,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.848433+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-6466436948",
    "name": "Winestone",
    "slug": "winestone",
    "district": "Śródmieście",
    "address": "Zagórna 1A",
    "latitude": 52.22624,
    "longitude": 21.04191,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "12:00-22:30",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.848433+00:00",
    "votes_confirm": 0
  },
  {
    "id": "suburban-kuznia-kulturalna",
    "name": "Kuźnia Kulturalna",
    "slug": "kuznia-kulturalna",
    "district": "Wilanów",
    "address": "ul. Kostki Potockiego 24",
    "latitude": 52.164,
    "longitude": 21.086,
    "beer_name": "Pilsner Urquell z kija",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 11.0,
    "happy_hour": null,
    "hours": "12:00 - 23:00",
    "is_verified": true,
    "last_updated": "2026-09-06T21:00:56.848433+00:00",
    "votes_confirm": 0
  },
  {
    "id": "user-1789051442620",
    "name": "Pochwała Niekonsekwencji",
    "slug": "pochwa-a-niekonsekwencji",
    "district": "Ochota",
    "address": "Grójecka 118",
    "latitude": 52.20728,
    "longitude": 20.97221,
    "beer_name": "Holba / Namysłów z kranu",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 02:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-way-1192523292",
    "name": "Bar Pod Dębami",
    "slug": "bar-pod-debami",
    "district": "Białołęka",
    "address": "Hanki Ordonówny 28",
    "latitude": 52.33127,
    "longitude": 20.95276,
    "beer_name": "Kozel / Tyskie z nalewaka",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-248569875",
    "name": "Zielona Gęś",
    "slug": "zielona-ges",
    "district": "Mokotów",
    "address": "Aleja Niepodległości 177",
    "latitude": 52.2101,
    "longitude": 21.00648,
    "beer_name": "Piwo lane jasne (0.5L)",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "12:00+",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "plan-b",
    "name": "Plan B",
    "slug": "plan-b",
    "district": "Śródmieście",
    "address": "al. Wyzwolenia 18 (Plac Zbawiciela)",
    "latitude": 52.21981,
    "longitude": 21.01776,
    "beer_name": "Czeski Svijany / Namysłów",
    "beer_price_pln": 16.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 9.0,
    "happy_hour": null,
    "hours": "16:00 - 04:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "bar-studio",
    "name": "Bar Studio (PKiN)",
    "slug": "bar-studio-pkin",
    "district": "Śródmieście",
    "address": "Plac Defilad 1 (PKiN)",
    "latitude": 52.23162,
    "longitude": 21.00695,
    "beer_name": "Tyskie z tanka",
    "beer_price_pln": 16.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 11.0,
    "happy_hour": null,
    "hours": "10:00 - 02:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "pub-lolek",
    "name": "Pub Lolek (Pole Mokotowskie)",
    "slug": "pub-lolek-pole-mokotowskie",
    "district": "Ochota",
    "address": "Rokitnicka 20 (Pole Mokotowskie)",
    "latitude": 52.21142,
    "longitude": 20.99815,
    "beer_name": "Kozel Ležák",
    "beer_price_pln": 16.5,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 11.0,
    "happy_hour": "Pn-Czw 12:00-16:00: Zestaw lunchowy z piwem",
    "hours": "11:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "cafe-kulturalna",
    "name": "Kawiarnia Kulturalna",
    "slug": "kawiarnia-kulturalna",
    "district": "Śródmieście",
    "address": "Plac Defilad 1 (Teatr Dramatyczny)",
    "latitude": 52.23098,
    "longitude": 21.00845,
    "beer_name": "Kozel z kija",
    "beer_price_pln": 17.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 12.0,
    "happy_hour": null,
    "hours": "12:00 - 02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "grunt-i-woda",
    "name": "Grunt i Woda (Wisła)",
    "slug": "grunt-i-woda-wisla",
    "district": "Bulwary",
    "address": "Bulwar Flotylli Wiślanej",
    "latitude": 52.23315,
    "longitude": 21.03782,
    "beer_name": "Żywiec z nalewaka",
    "beer_price_pln": 17.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 10.0,
    "happy_hour": null,
    "hours": "12:00 - 02:00 (Sezon letni)",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-12161691669",
    "name": "COGITO Craft Beer & Pizza",
    "slug": "cogito-craft-beer-pizza",
    "district": "Ursynów",
    "address": "Migdałowa 97",
    "latitude": 52.14552,
    "longitude": 21.05796,
    "beer_name": "Kraft Lager z kranu",
    "beer_price_pln": 17.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 12.0,
    "happy_hour": null,
    "hours": "Mo-Th 14:00-23:00, Fr 14:00-24:00, Sa 12:00-24:00, Su 12:00-22:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "jabeerwocky",
    "name": "Jabeerwocky Craft Beer Pub",
    "slug": "jabeerwocky-craft-beer-pub",
    "district": "Śródmieście",
    "address": "Nowogrodzka 12",
    "latitude": 52.22941,
    "longitude": 21.01825,
    "beer_name": "Czech Style Lager / Pils",
    "beer_price_pln": 18.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 12.0,
    "happy_hour": "Pn do 19:00: -20% na lane rzemiosło",
    "hours": "14:00 - 02:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "same-krafty",
    "name": "Same Krafty",
    "slug": "same-krafty",
    "district": "Śródmieście",
    "address": "Nowomiejska 10 (Stare Miasto)",
    "latitude": 52.24982,
    "longitude": 21.01025,
    "beer_name": "Munich Helles / Grodziskie",
    "beer_price_pln": 18.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 12.0,
    "happy_hour": null,
    "hours": "14:00 - 23:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-248197975",
    "name": "The Taps",
    "slug": "the-taps",
    "district": "Śródmieście",
    "address": "Henryka Sienkiewicza 4",
    "latitude": 52.23448,
    "longitude": 21.01254,
    "beer_name": "Czeski Lager z kranu",
    "beer_price_pln": 18.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 12.0,
    "happy_hour": null,
    "hours": "Mo-We, Su 15:00-00:00; Th 15:00-01:00; Fr, Sa 15:00-03:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-4368290589",
    "name": "Czeska Piviarnia",
    "slug": "czeska-piviarnia",
    "district": "Żoliborz",
    "address": "Księdza Jerzego Popiełuszki 19",
    "latitude": 52.27032,
    "longitude": 20.97402,
    "beer_name": "Svetlý Ležák z tanka",
    "beer_price_pln": 18.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 12.0,
    "happy_hour": null,
    "hours": "Mo-Th,Su 16:00-24:00; Fr-Sa 16:00-02:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-4551437542",
    "name": "Beer Station",
    "slug": "beer-station",
    "district": "Praga Północ",
    "address": "Ząbkowska 5",
    "latitude": 52.25292,
    "longitude": 21.03901,
    "beer_name": "Czeski Svetlý Ležák z kranu",
    "beer_price_pln": 18.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 12.0,
    "happy_hour": null,
    "hours": "Mo-Su 15:00-01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-7206040390",
    "name": "Kufloteka",
    "slug": "kufloteka",
    "district": "Wola",
    "address": "Jana Kazimierza 32",
    "latitude": 52.22433,
    "longitude": 20.9429,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 18.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Mo-Th 15:30-22:00; Fr 15:30-24:00; Sa 14:00-24:00; Su 14:00-22:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11953693269",
    "name": "White Crow - Craft Beer&Kitchen",
    "slug": "white-crow-craft-beer-kitchen",
    "district": "Praga Północ",
    "address": "Wileńska 25",
    "latitude": 52.25751,
    "longitude": 21.03845,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 18.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-457296879",
    "name": "Bierhalle",
    "slug": "bierhalle",
    "district": "Śródmieście",
    "address": "Aleja Jana Pawła II 82",
    "latitude": 52.25595,
    "longitude": 20.98448,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 18.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "drugie-dno",
    "name": "Drugie Dno Craft Beer",
    "slug": "drugie-dno-craft-beer",
    "district": "Śródmieście",
    "address": "Nowogrodzka 4",
    "latitude": 52.22964,
    "longitude": 21.02011,
    "beer_name": "Craft Lager z nalewaka",
    "beer_price_pln": 18.5,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 14.0,
    "happy_hour": "Pn-Śr 16:00-18:00: Piwo 15 zł",
    "hours": "15:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "kufle-i-kapsle",
    "name": "Kufle i Kapsle",
    "slug": "kufle-i-kapsle",
    "district": "Śródmieście",
    "address": "Nowogrodzka 25",
    "latitude": 52.22895,
    "longitude": 21.01462,
    "beer_name": "Desitka Czeska / Kraft Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "14:00 - 01:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-261659066",
    "name": "Klubokawiarnia KEN 54",
    "slug": "klubokawiarnia-ken-54",
    "district": "Ursynów",
    "address": "Aleja Komisji Edukacji Narodowej 54",
    "latitude": 52.14518,
    "longitude": 21.05336,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:55.844969+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-764747553",
    "name": "Szyszka Chmielu",
    "slug": "szyszka-chmielu",
    "district": "Ursynów",
    "address": "Aleja Komisji Edukacji Narodowej 36",
    "latitude": 52.14,
    "longitude": 21.05921,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Su-Th 16:00-12:00, Fr-Sa 16:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1268253997",
    "name": "LAS - Lokalna Atrakcja Stolicy",
    "slug": "las-lokalna-atrakcja-stolicy",
    "district": "Śródmieście",
    "address": "Solec 44",
    "latitude": 52.23602,
    "longitude": 21.03205,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Tu-Fr 15+;Sa-Su 12+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-1740039326",
    "name": "Yellow Cab",
    "slug": "yellow-cab",
    "district": "Żoliborz",
    "address": "Księdza Jerzego Popiełuszki 19/21",
    "latitude": 52.27008,
    "longitude": 20.97415,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-2293362601",
    "name": "Beer & Burger Muranów",
    "slug": "beer-burger-muranow",
    "district": "Śródmieście",
    "address": "Generała Władysława Andersa 23",
    "latitude": 52.251,
    "longitude": 20.99795,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.021652+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3530319133",
    "name": "Potok pub i sala koncertowa.",
    "slug": "potok-pub-i-sala-koncertowa",
    "district": "Żoliborz",
    "address": "Potocka 14",
    "latitude": 52.27479,
    "longitude": 20.97943,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Th-Su 18:00+",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-3563939893",
    "name": "Stacja Grochów",
    "slug": "stacja-grochow",
    "district": "Praga Południe",
    "address": "Grochowska 178",
    "latitude": 52.24532,
    "longitude": 21.09034,
    "beer_name": "Bohemian Pils z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 12.0,
    "happy_hour": null,
    "hours": "Mo 14:00-22:00; Tu-Th,Su 12:00-22:00; Fr-Sa 12:00-24:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-4936250322",
    "name": "Podwale Bar and Books",
    "slug": "podwale-bar-and-books",
    "district": "Śródmieście",
    "address": "Wąski Dunaj 20",
    "latitude": 52.24921,
    "longitude": 21.00983,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Mo-Th,Su 17:00-02:00; Fr-Sa 17:00-03:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.124372+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-6085723350",
    "name": "Świetlica Wolności",
    "slug": "swietlica-wolnosci",
    "district": "Śródmieście",
    "address": "Nowy Świat 6/12",
    "latitude": 52.23075,
    "longitude": 21.02263,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Mo 14:00-01:00; Tu-Sa 12:00-01:00; Su 12:00-21:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.232082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-8848582896",
    "name": "Cześć",
    "slug": "czesc",
    "district": "Śródmieście",
    "address": "Grzybowska 2",
    "latitude": 52.23759,
    "longitude": 21.00274,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9761236273",
    "name": "Karma Crew Warsaw",
    "slug": "karma-crew-warsaw",
    "district": "Śródmieście",
    "address": "Aleja 3 Maja 15",
    "latitude": 52.23382,
    "longitude": 21.03132,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-9796966804",
    "name": "Wir",
    "slug": "wir",
    "district": "Bulwary",
    "address": "Bulwar Bohdana Grzymały-Siedleckiego",
    "latitude": 52.23689,
    "longitude": 21.03711,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Mo-Su 12:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.344614+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10103149471",
    "name": "Tap Bar",
    "slug": "tap-bar",
    "district": "Wola",
    "address": "Górczewska",
    "latitude": 52.24102,
    "longitude": 20.93313,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-10912104602",
    "name": "Angel's",
    "slug": "angel-s",
    "district": "Śródmieście",
    "address": "Żurawia 6/12",
    "latitude": 52.22908,
    "longitude": 21.01799,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11019858492",
    "name": "Taproom",
    "slug": "taproom",
    "district": "Wilanów",
    "address": "Aleja Rzeczypospolitej 4",
    "latitude": 52.15789,
    "longitude": 21.07596,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Mo,Tu 17:00-23:00; We-Fr 16:00-24:00; Su 15:00-23:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.449082+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11037101308",
    "name": "Raj Piwosza Craft Beer & Wine Garden",
    "slug": "raj-piwosza-craft-beer-wine-garden",
    "district": "Praga Południe",
    "address": "Generała Tadeusza Bora-Komorowskiego 56A",
    "latitude": 52.22808,
    "longitude": 21.07811,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11052560530",
    "name": "Pictures",
    "slug": "pictures",
    "district": "Białołęka",
    "address": "Obrazkowa",
    "latitude": 52.31456,
    "longitude": 20.9731,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Mo-Fr 18:00-00:00; Fr 18:00-02:00; Sa-Su 16:00-02:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.550498+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-11506908131",
    "name": "Kapsle",
    "slug": "kapsle",
    "district": "Ursus",
    "address": "Mariana Keniga 14",
    "latitude": 52.19625,
    "longitude": 20.86944,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Mo-Su 17:00-24:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.646181+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-way-160342684",
    "name": "Gniazdo Piratów",
    "slug": "gniazdo-piratow",
    "district": "Bielany",
    "address": "Ogólna 5",
    "latitude": 52.27113,
    "longitude": 20.96241,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 01:00",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-319430784",
    "name": "Pianka",
    "slug": "pianka",
    "district": "Śródmieście",
    "address": "Zgoda 12",
    "latitude": 52.23366,
    "longitude": 21.01135,
    "beer_name": "Craft Pils / Lager z kranu",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "24/7",
    "is_verified": false,
    "last_updated": "2026-09-06T21:00:56.747508+00:00",
    "votes_confirm": 0
  },
  {
    "id": "osm-node-4233519776",
    "name": "Same Krafty Vis-a-Vis",
    "slug": "same-krafty-vis-a-vis",
    "district": "Śródmieście",
    "address": "Nowomiejska 11/13",
    "latitude": 52.25021,
    "longitude": 21.01077,
    "beer_name": "Northern German Pilsner",
    "beer_price_pln": 19.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "Mo-Th 14:00-23:00; Fr 14:00-00:00; Sa 13:00-00:00; Su 13:00-22:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "goraczka-zlota",
    "name": "Gorączka Złota",
    "slug": "goraczka-zlota",
    "district": "Śródmieście",
    "address": "Wilcza 29",
    "latitude": 52.22615,
    "longitude": 21.01524,
    "beer_name": "Czeski Pils / Bernard z kranu",
    "beer_price_pln": 20.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "16:00 - 00:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-8981030460",
    "name": "Browar Warszawski",
    "slug": "browar-warszawski",
    "district": "Wola",
    "address": "Haberbuscha i Schielego 2",
    "latitude": 52.23493,
    "longitude": 20.98747,
    "beer_name": "Pszeniczne / Marcowe z tanka",
    "beer_price_pln": 20.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 14.0,
    "happy_hour": null,
    "hours": "Mo-Fr 16:00-24:00; Sa 14:00-24:00; Su 14:00-22:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "osm-node-9790929334",
    "name": "Uwaga Piwo",
    "slug": "uwaga-piwo",
    "district": "Wola",
    "address": "Żelazna 51/53",
    "latitude": 52.23224,
    "longitude": 20.99178,
    "beer_name": "Pils Rzemieślniczy z kranu",
    "beer_price_pln": 20.0,
    "beer_size_ml": 500,
    "is_craft": true,
    "shot_price_pln": 13.0,
    "happy_hour": null,
    "hours": "15:00 - 00:00",
    "is_verified": true,
    "last_updated": "2026-09-14T00:00:00+00:00",
    "votes_confirm": 3
  },
  {
    "id": "bar-markus-rembertow",
    "name": "Bar Markus",
    "slug": "bar-markus-rembertow",
    "district": "Rembertów",
    "address": "Al. gen. Antoniego Chruściela „Montera” 38",
    "latitude": 52.2592,
    "longitude": 21.1645,
    "beer_name": "Warka / Namysłów z kranu",
    "beer_price_pln": 13.0,
    "beer_size_ml": 500,
    "is_craft": false,
    "shot_price_pln": 8.0,
    "happy_hour": null,
    "hours": "12:00 - 23:00",
    "is_verified": true,
    "last_updated": "2026-09-15T23:50:00+00:00",
    "votes_confirm": 3
  }
];



  // Load Initial Venues
  async function loadVenues() {
    // Clean up any test venues that were removed (e.g. Bog on Dickensa 27)
    try {
      const stored = loadLocalUpdates();
      const filtered = stored.filter(v => v.id !== "user-1789053780065" && !(v.name && v.name.toLowerCase().includes("bog") && v.address && v.address.toLowerCase().includes("dicken")));
      if (filtered.length !== stored.length) {
        localStorage.setItem("warsaw_user_venues", JSON.stringify(filtered));
      }
    } catch (e) {}

    if (supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from("venues")
          .select("*")
          .order("beer_price_pln", { ascending: true });
        if (error) throw error;
        if (data && data.length > 0) {
          allVenues = data
            .filter(v => v.id !== "user-1789053780065" && v.osm_id !== "user-1789053780065" && !(v.name && v.name.toLowerCase() === "bog"))
            .map(v => ({
              ...v,
              beer_price_pln: parseFloat(v.beer_price_pln),
              shot_price_pln: v.shot_price_pln ? parseFloat(v.shot_price_pln) : null
            }));
          console.log(`Loaded ${allVenues.length} venues directly from Supabase!`);
          window.allVenues = allVenues;
          applyLocalVotes();
          updateDistrictCounts();
          updateBarometerStats();
          updatePassportCounters();
          updateFavoriteCounters();
          renderMarkers();
          setTimeout(checkUrlHash, 250);
          return;
        }
      } catch (err) {
        console.warn("Supabase fetch failed, falling back to local dataset:", err);
      }
    }

    try {
      const res = await fetch("data/venues.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      allVenues = await res.json();
    } catch (err) {
      console.warn("Could not load data/venues.json, using fallback", err);
      allVenues = JSON.parse(JSON.stringify(FALLBACK_VENUES));
    }

    // Merge any user-added local venues
    const localVenues = loadLocalUpdates();
    localVenues.forEach(local => {
      if (local.id === "user-1789053780065" || (local.name && local.name.toLowerCase().includes("bog") && local.address && local.address.toLowerCase().includes("dicken"))) {
        return;
      }
      if (local.name && local.name.toLowerCase().includes("pochwała niekonsekwencji")) {
        local.latitude = 52.20728;
        local.longitude = 20.97221;
        local.district = "Ochota";
        local.address = "Grójecka 118";
      }
      const idx = allVenues.findIndex(v => v.id === local.id || v.name.toLowerCase() === local.name.toLowerCase());
      if (idx !== -1) {
        allVenues[idx] = Object.assign({}, allVenues[idx], local);
      } else {
        allVenues.unshift(local);
      }
    });

    applyLocalVotes();
    updateDistrictCounts();
    updateBarometerStats();
    updatePassportCounters();
    updateFavoriteCounters();
    renderMarkers();
    if (window.__refreshCompassTargets) window.__refreshCompassTargets();
    setTimeout(checkUrlHash, 250);
  }

  /* ==========================================================================
     VAD KOSTAR ÖLEN (ÖLKARTAN) NATIVE iOS CONTROLLER FOR POILEPIWKO
     ========================================================================== */
  function initVkoSystem() {
    const exploreView = document.getElementById("explore-view");
    const venueSheet = document.getElementById("venue-detail-sheet");
    const eventSheet = document.getElementById("event-detail-sheet");
    const filterModal = document.getElementById("filter-modal");
    const profileModal = document.getElementById("profile-modal");
    const statsModal = document.getElementById("user-stats-modal");
    const accountModal = document.getElementById("account-settings-modal");
    const gamesModal = document.getElementById("games-modal");
    const peklekenModal = document.getElementById("pekleken-modal");

    let currentSelectedVenue = null;

    function closeVkoModals() {
      if (venueSheet) venueSheet.style.display = "none";
      if (eventSheet) eventSheet.style.display = "none";
      if (statsModal) statsModal.style.display = "none";
      if (accountModal) accountModal.style.display = "none";
      if (gamesModal) gamesModal.style.display = "none";
      if (peklekenModal) peklekenModal.style.display = "none";
      if (filterModal) {
        filterModal.classList.remove("active");
        filterModal.style.display = "none";
      }
      if (profileModal) {
        profileModal.classList.remove("active");
        profileModal.style.display = "none";
      }
    }
    window.__closeVkoModals = closeVkoModals;

    // Show or hide Explore View
    function showExploreView(show) {
      if (!exploreView) return;
      const mapTopBar = document.getElementById("vko-map-top-bar");
      const mapBottomControls = document.getElementById("vko-map-bottom-controls");
      const legendPill = document.querySelector(".legend-pill");
      if (show) {
        exploreView.style.display = "flex";
        if (mapTopBar) mapTopBar.style.display = "none";
        if (mapBottomControls) mapBottomControls.style.display = "none";
        if (legendPill) legendPill.style.display = "none";
        renderExploreBars();
        renderExploreEvents();
        const expBtn = document.getElementById("nav-btn-explore");
        if (expBtn && window.__clearBottomNavActive) {
          window.__clearBottomNavActive();
          expBtn.classList.add("active");
        }
      } else {
        exploreView.style.display = "none";
        if (mapTopBar) mapTopBar.style.display = "flex";
        if (mapBottomControls) mapBottomControls.style.display = "flex";
        if (legendPill) legendPill.style.display = "flex";
      }
    }
    window.__showExploreView = showExploreView;

    // Segmented control in Explore View
    const segBars = document.getElementById("seg-btn-bars");
    const segEvents = document.getElementById("seg-btn-events");
    const paneBars = document.getElementById("explore-pane-bars");
    const paneEvents = document.getElementById("explore-pane-events");

    if (segBars && segEvents && paneBars && paneEvents) {
      segBars.addEventListener("click", () => {
        segBars.classList.add("active");
        segEvents.classList.remove("active");
        paneBars.classList.add("active");
        paneEvents.classList.remove("active");
      });
      segEvents.addEventListener("click", () => {
        segEvents.classList.add("active");
        segBars.classList.remove("active");
        paneEvents.classList.add("active");
        paneBars.classList.remove("active");
      });
    }

    // Render Explore Bars (media_1790002342651.png)
    function renderExploreBars(venuesToRender = null) {
      const container = document.getElementById("explore-bars-list");
      if (!container) return;

      const list = (venuesToRender || allVenues).slice();
      if (userLocation) {
        list.forEach(v => {
          v._distKm = calculateDistanceKm(userLocation[0], userLocation[1], v.latitude, v.longitude);
        });
        list.sort((a, b) => (a._distKm || 999) - (b._distKm || 999));
      } else {
        list.sort((a, b) => (a.beer_price_pln || 99) - (b.beer_price_pln || 99));
      }

      const displayList = list.slice(0, 60);
      container.innerHTML = displayList.map(v => {
        const isOpen = isVenueOpen(v);
        let distText = "";
        if (userLocation && v._distKm !== undefined) {
          const dM = Math.round(v._distKm * 1000);
          distText = dM < 1000 ? `${dM} m` : `${v._distKm.toFixed(1)} km`;
        } else {
          distText = v.district || "Warszawa";
        }

        const hoursText = isOpen
          ? `<span class="vko-bar-hours open"><span class="vko-green-dot"></span> Otwarte teraz${v.hours ? ' · ' + escapeHtml(formatDisplayHours(v.hours)) : ''}</span>`
          : `<span class="vko-bar-hours closed">Zamknięte</span>`;

        return `
          <div class="vko-bar-card" data-venue-id="${v.id}">
            <div class="vko-bar-card-left">
              <div class="vko-bar-name">${escapeHtml(v.name)}</div>
              <div class="vko-bar-meta">
                <span>📍 ${distText}</span>
                <span>·</span>
                ${hoursText}
              </div>
            </div>
            <div class="vko-bar-card-right">
              <span class="vko-bar-beer-icon">🍺</span>
              <span class="vko-bar-price-tag">${v.beer_price_pln ? v.beer_price_pln.toFixed(0) : '14'}</span>
              <span class="vko-bar-price-curr">zł</span>
            </div>
          </div>
        `;
      }).join("");

      container.querySelectorAll(".vko-bar-card").forEach(card => {
        card.addEventListener("click", () => {
          const vId = card.getAttribute("data-venue-id");
          const v = allVenues.find(item => item.id === vId);
          if (v) openVkoVenueSheet(v, "explore");
        });
      });
    }
    window.__renderExploreBars = renderExploreBars;

    // Mock Warsaw Events (media_1790002334903.png)
    const mockEvents = [
      {
        id: "ev-1",
        title: "PUB QUIZ WARSZAWSKI",
        category: "QUIZ",
        time: "Dzisiaj · 19:00 - 21:00",
        venueName: "BANIALUKA",
        address: "Krakowskie Przedmieście 63",
        isFree: true,
        desc: "Wielki poniedziałkowy turniej wiedzy barowej! Zbierz drużynę do 6 osób. Do wygrania darmowe kolejki piwa i vouchery na bar.",
        imgEmoji: "🧠"
      },
      {
        id: "ev-2",
        title: "KARAOKE & SHOTS",
        category: "KARAOKE",
        time: "Dzisiaj · 21:00 - 02:00",
        venueName: "PIJALNIA WÓDKI I PIWA",
        address: "Nowy Świat 19",
        isFree: true,
        desc: "Śpiewaj swoje ulubione hity, złap piwko w super cenie i baw się ze znajomymi do rana.",
        imgEmoji: "🎤"
      },
      {
        id: "ev-3",
        title: "TRANSMISJA MECZU NA ŻYWO",
        category: "MECZ",
        time: "Jutro · 20:45 - 23:00",
        venueName: "CHMIELNA PUB",
        address: "Chmielna 10",
        isFree: true,
        desc: "Mecz na 8 wielkich telebimach z dźwiękiem na żywo! Dzban piwa 1.5L w promocyjnej cenie.",
        imgEmoji: "⚽"
      },
      {
        id: "ev-4",
        title: "WIECZÓR GIER PLANSZOWYCH",
        category: "GRY",
        time: "Jutro · 18:30 - 22:30",
        venueName: "PARADOX CAFE",
        address: "Anielewicza 2",
        isFree: true,
        desc: "Ponad 400 gier planszowych i bar z piwami rzemieślniczymi oraz cydrem. Wstęp wolny dla każdego!",
        imgEmoji: "🎲"
      }
    ];

    function renderExploreEvents() {
      const container = document.getElementById("explore-events-list");
      if (!container) return;

      const tonight = mockEvents.filter((_, idx) => idx < 2);
      const tomorrow = mockEvents.filter((_, idx) => idx >= 2);

      container.innerHTML = `
        <div class="vko-events-group">
          <div class="vko-event-section-title">DZISIAJ W MIEŚCIE</div>
          <div class="vko-event-featured-card" data-event-id="${tonight[0].id}">
            <div class="vko-event-img-banner">
              <span class="vko-event-category-badge">${tonight[0].category}</span>
              <span style="font-size:3.5rem;line-height:1;">${tonight[0].imgEmoji}</span>
            </div>
            <div class="vko-event-featured-content">
              <div class="vko-event-card-title">${tonight[0].title}</div>
              <div class="vko-event-meta-row">
                <span>🕒 ${tonight[0].time}</span>
                <span class="vko-badge-free">WSTĘP WOLNY</span>
              </div>
              <div style="font-size:0.8rem;color:#94a3b8;margin-top:2px;">📍 ${tonight[0].venueName} · ${tonight[0].address}</div>
            </div>
          </div>
        </div>

        <div class="vko-events-group" style="margin-top: 14px;">
          <div class="vko-event-section-title">JUTRO</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${tomorrow.map(ev => `
              <div class="vko-event-compact-card" data-event-id="${ev.id}">
                <div class="vko-event-thumb">${ev.imgEmoji}</div>
                <div class="vko-event-compact-info">
                  <div class="vko-event-compact-title">${ev.title}</div>
                  <div class="vko-event-compact-sub">🕒 ${ev.time}</div>
                  <div class="vko-event-compact-sub">📍 ${ev.venueName}</div>
                </div>
                <span class="vko-badge-free">FREE</span>
              </div>
            `).join("")}
          </div>
        </div>
      `;

      container.querySelectorAll("[data-event-id]").forEach(card => {
        card.addEventListener("click", () => {
          const evId = card.getAttribute("data-event-id");
          const ev = mockEvents.find(e => e.id === evId);
          if (ev) openVkoEventSheet(ev);
        });
      });
    }

    // Open Event Detail Sheet (media_1790002321268.png)
    function openVkoEventSheet(ev) {
      if (!eventSheet) return;
      const vName = document.getElementById("vko-event-venue-name");
      if (vName) vName.textContent = ev.venueName;
      const bTitle = document.getElementById("vko-event-banner-title");
      if (bTitle) bTitle.textContent = ev.title;
      const catPill = document.getElementById("vko-event-category-pill");
      if (catPill) catPill.textContent = ev.category;
      const timeStr = document.getElementById("vko-event-time-str");
      if (timeStr) timeStr.textContent = ev.time;
      const locStr = document.getElementById("vko-event-venue-loc");
      if (locStr) locStr.textContent = ev.address;
      const descEl = document.getElementById("vko-event-desc");
      if (descEl) descEl.textContent = ev.desc;
      eventSheet.style.display = "flex";
    }

    const btnCloseEvent = document.getElementById("vko-event-btn-close");
    if (btnCloseEvent) btnCloseEvent.addEventListener("click", () => {
      if (eventSheet) eventSheet.style.display = "none";
    });

    // Open Venue Detail Bottom Sheet (media_1790002379147.png & media_1790002353091.png)
    function openVkoVenueSheet(venue, source = "map") {
      if (!venueSheet || !venue) return;
      currentSelectedVenue = venue;

      const nameEl = document.getElementById("vko-sheet-name");
      if (nameEl) nameEl.textContent = venue.name || "LOKAL";

      const favBtn = document.getElementById("vko-sheet-btn-fav");
      if (favBtn) {
        favBtn.textContent = isVenueFavorite(venue.id) ? "❤️" : "🤍";
        favBtn.onclick = (e) => {
          e.stopPropagation();
          toggleVenueFavorite(venue.id);
          favBtn.textContent = isVenueFavorite(venue.id) ? "❤️" : "🤍";
        };
      }

      const siteLink = document.getElementById("vko-sheet-website");
      if (siteLink) {
        if (venue.website) {
          siteLink.href = venue.website;
          siteLink.textContent = "Strona lokalu ↗";
        } else {
          siteLink.href = `https://www.google.com/search?q=${encodeURIComponent(venue.name + ' Warszawa')}`;
          siteLink.textContent = "Szukaj w Google ↗";
        }
      }

      const distAddrEl = document.getElementById("vko-sheet-dist-addr");
      if (distAddrEl) {
        let distPart = "";
        if (userLocation) {
          const dKm = calculateDistanceKm(userLocation[0], userLocation[1], venue.latitude, venue.longitude);
          const dM = Math.round(dKm * 1000);
          distPart = (dM < 1000 ? `${dM} m` : `${dKm.toFixed(1)} km`) + " · ";
        }
        distAddrEl.textContent = `${distPart}${venue.address || venue.district || 'Warszawa'}`;
      }

      // DRINKS Card
      const drinksTitle = document.getElementById("vko-drinks-title");
      if (drinksTitle) drinksTitle.textContent = (venue.beer_name || "Piwo lane / z nalewaka").toUpperCase();

      const drinksSize = document.getElementById("vko-drinks-size");
      if (drinksSize) drinksSize.textContent = `${(venue.beer_size_ml || 500) / 1000} l`;

      const priceVal = document.getElementById("vko-drinks-price-val");
      if (priceVal) priceVal.textContent = venue.beer_price_pln ? venue.beer_price_pln.toFixed(0) : "14";

      // OPENING HOURS Weekly Schedule
      const hoursText = venue.hours ? formatDisplayHours(venue.hours) : "16:00 - 02:00";
      const days = ["Niedziela", "Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota"];
      const dayIdx = new Date().getDay();
      const currentDayName = days[dayIdx];

      const todayTag = document.getElementById("vko-hours-today-tag");
      if (todayTag) todayTag.textContent = `(Dzisiaj, ${currentDayName})`;

      const statusText = document.getElementById("vko-hours-status-text");
      if (statusText) statusText.textContent = isVenueOpen(venue) ? hoursText : "Zamknięte";

      const weekListEl = document.getElementById("vko-hours-week-list");
      if (weekListEl) {
        const weekDays = [
          { name: "Poniedziałek", idx: 1 },
          { name: "Wtorek", idx: 2 },
          { name: "Środa", idx: 3 },
          { name: "Czwartek", idx: 4 },
          { name: "Piątek", idx: 5 },
          { name: "Sobota", idx: 6 },
          { name: "Niedziela", idx: 0 }
        ];
        weekListEl.innerHTML = weekDays.map(d => {
          const isToday = d.idx === dayIdx;
          return `
            <div class="vko-hours-day-row ${isToday ? 'active-day' : ''}">
              <div class="vko-day-name-box">
                ${isToday ? '<span class="vko-green-dot"></span>' : ''}
                <span>${d.name}</span>
              </div>
              <span>${hoursText}</span>
            </div>
          `;
        }).join("");
      }

      // Configure Main CTA Button
      const mainBtn = document.getElementById("vko-sheet-btn-main");
      if (mainBtn) {
        if (source === "explore") {
          mainBtn.textContent = "POKAŻ NA MAPIE";
          mainBtn.onclick = () => {
            showExploreView(false);
            if (map) {
              map.setView([venue.latitude, venue.longitude], 17);
              setTimeout(() => openVkoVenueSheet(venue, "map"), 300);
            }
          };
        } else {
          mainBtn.textContent = "CHECK IN HERE";
          mainBtn.onclick = () => {
            venueSheet.style.display = "none";
            if (window.__openBerealCamera) {
              window.__openBerealCamera(venue);
            } else if (window.__openAddModal) {
              window.__openAddModal();
            }
          };
        }
      }

      // Feedback button
      const feedBtn = document.getElementById("vko-sheet-btn-feedback");
      if (feedBtn) {
        feedBtn.onclick = () => {
          venueSheet.style.display = "none";
          if (window.__openEditModal) window.__openEditModal(venue);
          else alert(`Zgłoś aktualną cenę dla ${venue.name}`);
        };
      }

      // Navigate button
      const navBtn = document.getElementById("vko-sheet-btn-navigate");
      if (navBtn) {
        navBtn.onclick = () => {
          const navUrl = buildGoogleMapsNavigationUrl(venue);
          window.open(navUrl, "_blank", "noopener");
        };
      }

      venueSheet.style.display = "flex";
    }
    window.__openVkoVenueSheet = openVkoVenueSheet;

    const closeVenueBtn = document.getElementById("vko-sheet-btn-close");
    if (closeVenueBtn) {
      closeVenueBtn.addEventListener("click", () => {
        if (venueSheet) venueSheet.style.display = "none";
      });
    }
    if (venueSheet) {
      venueSheet.addEventListener("click", (e) => {
        if (e.target === venueSheet) venueSheet.style.display = "none";
      });
    }

    // Toggle hours accordion in sheet
    const hoursAccordionBtn = document.getElementById("vko-hours-accordion-btn");
    const hoursCollapse = document.getElementById("vko-hours-collapse");
    const hoursChevron = document.getElementById("vko-hours-chevron");
    if (hoursAccordionBtn && hoursCollapse) {
      hoursAccordionBtn.addEventListener("click", () => {
        const isCollapsed = hoursCollapse.style.display === "none";
        hoursCollapse.style.display = isCollapsed ? "block" : "none";
        if (hoursChevron) hoursChevron.textContent = isCollapsed ? "⌃" : "⌄";
      });
    }

    // Floating Search & Filter buttons inside Explore View
    const floatSearch = document.getElementById("vko-float-search");
    if (floatSearch) {
      floatSearch.addEventListener("click", () => {
        const sInput = document.getElementById("search-input");
        if (sInput) {
          sInput.scrollIntoView({ behavior: "smooth" });
          sInput.focus();
        }
      });
    }
    const floatFilter = document.getElementById("vko-float-filter");
    if (floatFilter) {
      floatFilter.addEventListener("click", () => {
        if (filterModal) {
          filterModal.classList.add("active");
          filterModal.style.display = "flex";
        }
      });
    }

    // Map Top Bar Controls
    const topFilterBtn = document.getElementById("btn-vko-filters");
    if (topFilterBtn) {
      topFilterBtn.addEventListener("click", () => {
        if (filterModal) {
          filterModal.classList.add("active");
          filterModal.style.display = "flex";
        }
      });
    }
    const topTimeBtn = document.getElementById("btn-vko-time");
    if (topTimeBtn) {
      topTimeBtn.addEventListener("click", () => {
        const openNowSwitch = document.getElementById("vko-switch-open-now");
        if (openNowSwitch) {
          openNowSwitch.checked = !openNowSwitch.checked;
          topTimeBtn.style.color = openNowSwitch.checked ? "#34d399" : "#f1f5f9";
          currentFilters.openNow = openNowSwitch.checked;
          filterVenues();
        }
      });
    }
    function updateClock() {
      const clockEl = document.getElementById("vko-clock-text");
      if (clockEl) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        clockEl.textContent = `${hh}:${mm}`;
      }
    }
    updateClock();
    setInterval(updateClock, 30000);

    const topLayersBtn = document.getElementById("btn-vko-layers");
    if (topLayersBtn) {
      topLayersBtn.addEventListener("click", () => {
        const distSelect = document.getElementById("district-select");
        if (distSelect) distSelect.focus();
      });
    }

    // Bottom-left GPS locator pill
    const vkoMyLoc = document.getElementById("btn-vko-my-location");
    if (vkoMyLoc) {
      vkoMyLoc.addEventListener("click", () => {
        const oldLocBtn = document.getElementById("btn-locate-float");
        if (oldLocBtn) oldLocBtn.click();
        else if (userLocation && map) map.setView(userLocation, 16);
      });
    }

    // Daily reward button
    const dailyBtn = document.getElementById("btn-vko-daily-reward");
    if (dailyBtn) {
      dailyBtn.addEventListener("click", () => {
        alert("👑 DZIENNY BONUS: Otrzymałeś +50 Kapsli za dzisiejszą aktywność w Warszawie!");
        const capsEl = document.getElementById("prof-caps-count");
        if (capsEl) {
          const cur = parseInt(capsEl.textContent, 10) || 275;
          capsEl.textContent = String(cur + 50);
        }
      });
    }

    // Filter Modal: Category Tiles
    const catTiles = document.querySelectorAll(".vko-cat-tile");
    catTiles.forEach(tile => {
      tile.addEventListener("click", () => {
        catTiles.forEach(t => t.classList.remove("active"));
        tile.classList.add("active");
        const cat = tile.getAttribute("data-drink-cat");
        if (cat === "beer") currentFilters.craft = false;
        else if (cat === "bubbles" || cat === "wine" || cat === "cider") currentFilters.craft = true;
        filterVenues();
      });
    });

    // Filter Modal: Price Slider
    const vkoSlider = document.getElementById("filter-price-slider");
    const vkoSliderLabel = document.getElementById("vko-slider-price-label");
    if (vkoSlider && vkoSliderLabel) {
      vkoSlider.addEventListener("input", () => {
        const val = parseInt(vkoSlider.value, 10);
        if (val >= 30) {
          vkoSliderLabel.textContent = "Any price (Dowolna cena)";
          currentFilters.priceTier = "all";
        } else {
          vkoSliderLabel.textContent = `Do ${val} zł za piwo`;
          currentFilters.priceTier = val <= 12 ? "tier-low" : (val <= 18 ? "tier-mid" : "tier-high");
        }
        filterVenues();
      });
    }

    // Filter Modal: Toggles
    const openNowSw = document.getElementById("vko-switch-open-now");
    if (openNowSw) {
      openNowSw.addEventListener("change", () => {
        currentFilters.openNow = openNowSw.checked;
        filterVenues();
      });
    }
    const hhSw = document.getElementById("vko-switch-happy-hour");
    if (hhSw) {
      hhSw.addEventListener("change", () => {
        currentFilters.happyHour = hhSw.checked;
        filterVenues();
      });
    }

    // Filter Modal: Activities pills
    const actPills = document.querySelectorAll(".vko-activity-pill");
    actPills.forEach(pill => {
      pill.addEventListener("click", () => {
        pill.classList.toggle("active");
        const act = pill.getAttribute("data-act");
        const type = pill.getAttribute("data-type");
        if (act === "craft") currentFilters.craft = pill.classList.contains("active");
        if (type === "favorites") currentFilters.favorites = pill.classList.contains("active");
        filterVenues();
      });
    });

    // Reset All Filters
    const resetFiltersBtn = document.getElementById("btn-filter-reset");
    if (resetFiltersBtn) {
      resetFiltersBtn.addEventListener("click", () => {
        currentFilters.district = "all";
        currentFilters.priceTier = "all";
        currentFilters.openNow = false;
        currentFilters.craft = false;
        currentFilters.favorites = false;
        currentFilters.happyHour = false;
        if (openNowSw) openNowSw.checked = false;
        if (hhSw) hhSw.checked = false;
        if (vkoSlider) vkoSlider.value = 30;
        if (vkoSliderLabel) vkoSliderLabel.textContent = "Any price";
        actPills.forEach(p => p.classList.remove("active"));
        catTiles.forEach(t => t.classList.remove("active"));
        if (catTiles[0]) catTiles[0].classList.add("active");
        filterVenues();
      });
    }

    // Apply Filters button
    const applyFiltersBtn = document.getElementById("btn-filter-apply");
    if (applyFiltersBtn) {
      applyFiltersBtn.addEventListener("click", () => {
        if (filterModal) {
          filterModal.classList.remove("active");
          filterModal.style.display = "none";
        }
        renderExploreBars();
      });
    }

    // Profile View (media_1790002397641.png)
    function openVkoProfile() {
      if (!profileModal) return;
      const handleEl = document.getElementById("prof-hero-handle");
      if (handleEl) {
        if (currentProfile && currentProfile.username) {
          handleEl.textContent = `@${currentProfile.username.toUpperCase()}`;
        } else {
          handleEl.textContent = "@KRYSTIAN";
        }
      }
      const frEl = document.getElementById("prof-stat-friends");
      if (frEl) {
        let frCount = 0;
        try {
          const savedFr = localStorage.getItem("poilepiwko_friends");
          if (savedFr) frCount = JSON.parse(savedFr).length;
        } catch (e) {}
        frEl.textContent = String(frCount);
      }

      const chkEl = document.getElementById("prof-stat-checkins");
      if (chkEl) {
        const vCount = (typeof visitedVenues !== "undefined" && Array.isArray(visitedVenues)) ? visitedVenues.length : 0;
        chkEl.textContent = String(vCount);
      }

      const plEl = document.getElementById("prof-stat-visited");
      if (plEl) {
        const vCount = (typeof visitedVenues !== "undefined" && Array.isArray(visitedVenues)) ? visitedVenues.length : 0;
        plEl.textContent = String(vCount);
      }

      profileModal.classList.add("active");
      profileModal.style.display = "flex";
    }
    window.__openVkoProfile = openVkoProfile;

    const btnOpenStats = document.getElementById("btn-open-user-stats");
    if (btnOpenStats && statsModal) {
      btnOpenStats.addEventListener("click", () => {
        statsModal.style.display = "flex";
      });
    }
    const btnCloseStats = document.getElementById("btn-close-stats");
    if (btnCloseStats && statsModal) {
      btnCloseStats.addEventListener("click", () => {
        statsModal.style.display = "none";
      });
    }

    const btnProfileAcc = document.getElementById("btn-profile-account");
    if (btnProfileAcc && accountModal) {
      btnProfileAcc.addEventListener("click", () => {
        accountModal.style.display = "flex";
      });
    }
    const btnCloseAcc = document.getElementById("btn-close-account");
    if (btnCloseAcc && accountModal) {
      btnCloseAcc.addEventListener("click", () => {
        accountModal.style.display = "none";
      });
    }

    const btnProfTheme = document.getElementById("btn-profile-theme");
    if (btnProfTheme) {
      btnProfTheme.addEventListener("click", () => {
        const curTheme = document.body.classList.contains("theme-light") ? "light" : "dark";
        const nextTheme = curTheme === "light" ? "dark" : "light";
        applyTheme(nextTheme);
        localStorage.setItem("theme_preference", nextTheme);
      });
    }

    // Games Hub (vko_appstore_6.png)
    function openVkoGames() {
      if (gamesModal) gamesModal.style.display = "flex";
    }
    window.__openVkoGames = openVkoGames;

    const btnCloseGames = document.getElementById("btn-close-games");
    if (btnCloseGames && gamesModal) {
      btnCloseGames.addEventListener("click", () => {
        gamesModal.style.display = "none";
      });
    }

    // Pekleken Questions Deck
    const peklekenQuestions = [
      "Kto najszybciej wypije całe piwo na hejnał?",
      "Kto wyda dzisiaj najwięcej kasy na barze?",
      "Kto z nas zaśnie w nocnym autobusie?",
      "Kto pierwszy zgubi klucze albo telefon?",
      "Kto najczęściej zamawia shoty dla wszystkich?",
      "Kto po 3 piwach zaczyna mówić po angielsku?",
      "Kto jutro rano napisze 'nigdy więcej nie piję'?",
      "Kto ma najlepszą tolerancję na chmiel?",
      "Kto najdłużej wybiera piwo przy barze?",
      "Kto z nas wpadłby na pomysł nocnego kebaba o 4 rano?",
      "Kto zna najwięcej barmanów w Warszawie?",
      "Kto najszybciej zatańczy na stole?",
      "Kto zrobi najśmieszniejsze zdjęcie w BeReal dzisiejszej nocy?"
    ];
    let peklekenIdx = 0;

    const tilePekleken = document.getElementById("tile-game-pekleken");
    if (tilePekleken && peklekenModal) {
      tilePekleken.addEventListener("click", () => {
        if (gamesModal) gamesModal.style.display = "none";
        peklekenIdx = 0;
        const numEl = document.getElementById("pekleken-card-num");
        if (numEl) numEl.textContent = `KARTA #${peklekenIdx + 1}`;
        const txtEl = document.getElementById("pekleken-card-text");
        if (txtEl) txtEl.textContent = peklekenQuestions[peklekenIdx];
        peklekenModal.style.display = "flex";
      });
    }
    const btnNextPekleken = document.getElementById("btn-pekleken-next");
    if (btnNextPekleken) {
      btnNextPekleken.addEventListener("click", () => {
        peklekenIdx = (peklekenIdx + 1) % peklekenQuestions.length;
        const numEl = document.getElementById("pekleken-card-num");
        if (numEl) numEl.textContent = `KARTA #${peklekenIdx + 1}`;
        const txtEl = document.getElementById("pekleken-card-text");
        if (txtEl) txtEl.textContent = peklekenQuestions[peklekenIdx];
      });
    }
    const btnClosePekleken = document.getElementById("btn-close-pekleken");
    if (btnClosePekleken && peklekenModal) {
      btnClosePekleken.addEventListener("click", () => {
        peklekenModal.style.display = "none";
      });
    }

    const tileRoulette = document.getElementById("tile-game-roulette");
    if (tileRoulette) {
      tileRoulette.addEventListener("click", () => {
        if (gamesModal) gamesModal.style.display = "none";
        const oldRoulette = document.getElementById("btn-roulette-float");
        if (oldRoulette) oldRoulette.click();
      });
    }

    const tileQuiz = document.getElementById("tile-game-quiz");
    if (tileQuiz) {
      tileQuiz.addEventListener("click", () => {
        if (gamesModal) gamesModal.style.display = "none";
        const oldQuiz = document.getElementById("btn-pubquiz-float");
        if (oldQuiz) oldQuiz.click();
      });
    }

    const tileTruth = document.getElementById("tile-game-truth");
    if (tileTruth) {
      tileTruth.addEventListener("click", () => {
        if (gamesModal) gamesModal.style.display = "none";
        const dares = [
          "PRAWDA: Jaka jest najbardziej przypałowa rzecz jaką zrobiłeś/aś po piwie?",
          "WYZWANIE: Zamów następną kolejkę mówiąc z czeskim akcentem!",
          "PRAWDA: Jaki jest Twój ulubiony tani bar w Warszawie, o którym nikomu nie mówisz?",
          "WYZWANIE: Wypij toast za zdrowie losowej osoby siedzącej przy sąsiednim stoliku!"
        ];
        alert(dares[Math.floor(Math.random() * dares.length)]);
      });
    }
  }

  // Boot Application
  function boot() {
    applyTheme(getSavedThemePreference());
    initMap();
    initSupabase();
    setupEventListeners();
    loadVenues();
    initUserGeolocation();
    initVkoSystem();

    // Register Service Worker for PWA with automatic update detection
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        let refreshing = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (!refreshing) {
            refreshing = true;
            window.location.reload();
          }
        });

        navigator.serviceWorker
          .register("sw.js")
          .then((reg) => {
            console.log("[PWA] ServiceWorker registered with scope:", reg.scope);
            try { reg.update(); } catch (e) {}
            reg.addEventListener("updatefound", () => {
              const newWorker = reg.installing;
              if (newWorker) {
                newWorker.addEventListener("statechange", () => {
                  if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                    console.log("[PWA] New version ready! Refreshing...");
                    window.location.reload();
                  }
                });
              }
            });
          })
          .catch((err) => console.warn("[PWA] ServiceWorker registration failed:", err));
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();