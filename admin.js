// poilepiwko.pl — Admin Panel Client Logic
(function () {
  "use strict";

  let adminPassword = sessionStorage.getItem("admin_auth_pass") || "";
  let allVenues = [];
  let allReports = [];
  let currentTab = "unverified";

  // Elements
  const loginSection = document.getElementById("login-section");
  const dashboardSection = document.getElementById("dashboard-section");
  const loginForm = document.getElementById("login-form");
  const adminPassInput = document.getElementById("admin-pass");
  const loginErr = document.getElementById("login-err");
  const btnLogout = document.getElementById("btn-logout");
  const btnRefresh = document.getElementById("btn-refresh");

  // Stats
  const statTotal = document.getElementById("stat-total-venues");
  const statUnverified = document.getElementById("stat-unverified-count");
  const statReports = document.getElementById("stat-reports-count");
  const statAvg = document.getElementById("stat-avg-price");
  const badgeUnverified = document.getElementById("badge-unverified-count");

  // Filters & Search
  const searchInput = document.getElementById("admin-search-input");
  const districtFilter = document.getElementById("admin-district-filter");

  // Tab Buttons
  const tabBtns = document.querySelectorAll(".tab-btn");
  const tabContents = {
    unverified: document.getElementById("tab-content-unverified"),
    all: document.getElementById("tab-content-all"),
    reports: document.getElementById("tab-content-reports")
  };

  // Edit Modal
  const editModal = document.getElementById("edit-modal");
  const editForm = document.getElementById("edit-form");
  const btnCancelEdit = document.getElementById("btn-cancel-edit");

  // Helper API Caller
  async function callAdminApi(action, payload = {}) {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: adminPassword,
        action,
        payload
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Wystąpił błąd serwera");
    }
    return data;
  }

  // Check login on startup
  async function init() {
    if (adminPassword) {
      try {
        await callAdminApi("auth");
        showDashboard();
      } catch (err) {
        sessionStorage.removeItem("admin_auth_pass");
        adminPassword = "";
        showLogin();
      }
    } else {
      showLogin();
    }
  }

  function showLogin() {
    loginSection.style.display = "block";
    dashboardSection.style.display = "none";
    btnLogout.style.display = "none";
    if (adminPassInput) adminPassInput.focus();
  }

  function showDashboard() {
    loginSection.style.display = "none";
    dashboardSection.style.display = "block";
    btnLogout.style.display = "inline-flex";
    loadDashboardData();
  }

  // Handle Login Form
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = adminPassInput.value.trim();
    loginErr.style.display = "none";

    const submitBtn = document.getElementById("btn-login-submit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Weryfikacja...";

    try {
      adminPassword = pass;
      await callAdminApi("auth");
      sessionStorage.setItem("admin_auth_pass", pass);
      showDashboard();
    } catch (err) {
      loginErr.textContent = err.message || "Błędne hasło administratora.";
      loginErr.style.display = "block";
      adminPassword = "";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "🔓 Zaloguj do panelu";
    }
  });

  // Handle Logout
  btnLogout.addEventListener("click", () => {
    sessionStorage.removeItem("admin_auth_pass");
    adminPassword = "";
    showLogin();
  });

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentTab = btn.getAttribute("data-tab");

      Object.keys(tabContents).forEach(key => {
        if (tabContents[key]) {
          tabContents[key].style.display = (key === currentTab) ? "block" : "none";
        }
      });

      renderCurrentTab();
    });
  });

  // Search & Filter listeners
  searchInput.addEventListener("input", () => renderCurrentTab());
  districtFilter.addEventListener("change", () => renderCurrentTab());
  btnRefresh.addEventListener("click", () => loadDashboardData());

  // Load All Data from API
  async function loadDashboardData() {
    btnRefresh.textContent = "⏳ Pobieranie...";
    try {
      const [venuesRes, reportsRes] = await Promise.all([
        callAdminApi("list-venues"),
        callAdminApi("list-reports")
      ]);

      allVenues = venuesRes.venues || [];
      allReports = reportsRes.reports || [];

      updateStats();
      renderCurrentTab();
    } catch (err) {
      console.error("Błąd pobierania danych admina:", err);
      alert("Nie udało się pobrać danych: " + err.message);
    } finally {
      btnRefresh.textContent = "🔄 Odśwież";
    }
  }

  function updateStats() {
    statTotal.textContent = allVenues.length;
    const unverifiedList = getUnverifiedVenues();
    statUnverified.textContent = unverifiedList.length;
    badgeUnverified.textContent = unverifiedList.length;
    statReports.textContent = allReports.length;

    const validPrices = allVenues.map(v => parseFloat(v.beer_price_pln)).filter(p => !isNaN(p) && p > 0);
    if (validPrices.length > 0) {
      const avg = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;
      statAvg.textContent = `${avg.toFixed(2)} zł`;
    } else {
      statAvg.textContent = "-- zł";
    }
  }

  function getUnverifiedVenues() {
    return allVenues.filter(v => !v.is_verified || (v.id && String(v.id).startsWith("user-")) || (v.osm_id && String(v.osm_id).startsWith("user-")));
  }

  function filterVenues(venuesList) {
    const q = searchInput.value.trim().toLowerCase();
    const dist = districtFilter.value;

    return venuesList.filter(v => {
      const matchesQ = !q ||
        (v.name && v.name.toLowerCase().includes(q)) ||
        (v.address && v.address.toLowerCase().includes(q)) ||
        (v.district && v.district.toLowerCase().includes(q)) ||
        (v.beer_name && v.beer_name.toLowerCase().includes(q));

      const matchesDist = (dist === "all") || (v.district && v.district.toLowerCase() === dist.toLowerCase());

      return matchesQ && matchesDist;
    });
  }

  function renderCurrentTab() {
    if (currentTab === "unverified") {
      renderUnverifiedList();
    } else if (currentTab === "all") {
      renderAllVenuesList();
    } else if (currentTab === "reports") {
      renderReportsGrid();
    }
  }

  function renderUnverifiedList() {
    const listEl = document.getElementById("unverified-list");
    const unverified = filterVenues(getUnverifiedVenues());

    if (unverified.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:40px 16px;background:var(--card-bg);border:1px dashed var(--card-border);border-radius:14px;">
          <div style="font-size:36px;margin-bottom:8px;">🎉</div>
          <div style="font-weight:700;font-size:1.05rem;">Brak oczekujących lokali!</div>
          <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">
            Wszystkie nowo dodane bary zostały zweryfikowane lub usunięte.
          </div>
        </div>
      `;
      return;
    }

    listEl.innerHTML = unverified.map(v => renderVenueCardHtml(v, true)).join("");
    attachVenueActions(listEl);
  }

  function renderAllVenuesList() {
    const listEl = document.getElementById("all-venues-list");
    const filtered = filterVenues(allVenues);

    if (filtered.length === 0) {
      listEl.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text-muted);">Nie znaleziono lokali spełniających kryteria.</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(v => renderVenueCardHtml(v, false)).join("");
    attachVenueActions(listEl);
  }

  function renderVenueCardHtml(v, isUnverifiedTab) {
    const isUserAdded = (v.id && String(v.id).startsWith("user-")) || (v.osm_id && String(v.osm_id).startsWith("user-"));
    const isVerified = v.is_verified === true;

    return `
      <div class="venue-card ${!isVerified ? 'unverified' : ''}" data-id="${v.id}">
        <div class="venue-info">
          <div class="venue-top-line">
            <span class="venue-name">${escapeHtml(v.name)}</span>
            ${isVerified 
              ? `<span class="status-tag tag-verified">✓ Zweryfikowany</span>` 
              : `<span class="status-tag tag-unverified">⏳ Do weryfikacji</span>`}
            ${isUserAdded ? `<span class="status-tag tag-user">👤 Dodany przez użytkownika</span>` : ''}
          </div>
          <div class="venue-sub">
            <span>📍 ${escapeHtml(v.district || 'Warszawa')} · ${escapeHtml(v.address || 'Brak dokładnego adresu')}</span>
            <span>🕒 Zgłoszono/aktualizacja: ${v.last_updated ? v.last_updated.split('T')[0] : 'Niedawno'}</span>
          </div>
          <div class="venue-pricing">
            <span>🍺 ${escapeHtml(v.beer_name || 'Piwo lane')}: <strong class="price-badge">${Number(v.beer_price_pln).toFixed(2)} zł</strong></span>
            ${v.shot_price_pln ? `<span>🥃 Szot: <strong>${Number(v.shot_price_pln).toFixed(2)} zł</strong></span>` : ''}
            ${v.happy_hour ? `<span>⚡ Happy Hour: <em>${escapeHtml(v.happy_hour)}</em></span>` : ''}
          </div>
        </div>
        <div class="venue-actions">
          <a href="/#${escapeHtml(v.slug || v.id)}" target="_blank" class="btn btn-secondary" title="Podgląd na mapie">
            🗺️ Mapa
          </a>
          ${!isVerified ? `
            <button type="button" class="btn btn-green btn-act-verify" data-id="${v.id}">
              ✓ Zatwierdź
            </button>
          ` : ''}
          <button type="button" class="btn btn-secondary btn-act-edit" data-id="${v.id}">
            ✏️ Edytuj
          </button>
          <button type="button" class="btn btn-red btn-act-delete" data-id="${v.id}" data-name="${escapeHtml(v.name)}">
            🗑️ Usuń
          </button>
        </div>
      </div>
    `;
  }

  function attachVenueActions(container) {
    // Verify
    container.querySelectorAll(".btn-act-verify").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        btn.disabled = true;
        btn.textContent = "Zapisywanie...";
        try {
          await callAdminApi("verify-venue", { venueId: id, isVerified: true });
          const venue = allVenues.find(v => v.id === id);
          if (venue) venue.is_verified = true;
          updateStats();
          renderCurrentTab();
        } catch (err) {
          alert("Błąd weryfikacji: " + err.message);
          btn.disabled = false;
          btn.textContent = "✓ Zatwierdź";
        }
      });
    });

    // Edit
    container.querySelectorAll(".btn-act-edit").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        const venue = allVenues.find(v => v.id === id);
        if (venue) openEditModal(venue);
      });
    });

    // Delete
    container.querySelectorAll(".btn-act-delete").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const name = btn.getAttribute("data-name");

        const ok = confirm(`Czy na pewno chcesz BEZPOWROTNIE usunąć lokal "${name}" z bazy danych?`);
        if (!ok) return;

        btn.disabled = true;
        btn.textContent = "Usuwanie...";
        try {
          await callAdminApi("delete-venue", { venueId: id });
          allVenues = allVenues.filter(v => v.id !== id);
          updateStats();
          renderCurrentTab();
        } catch (err) {
          alert("Błąd usuwania: " + err.message);
          btn.disabled = false;
          btn.textContent = "🗑️ Usuń";
        }
      });
    });
  }

  // Edit Modal Handling
  function openEditModal(venue) {
    document.getElementById("edit-venue-id").value = venue.id;
    document.getElementById("edit-name").value = venue.name || "";
    document.getElementById("edit-district").value = venue.district || "";
    document.getElementById("edit-price").value = venue.beer_price_pln || "";
    document.getElementById("edit-address").value = venue.address || "";
    document.getElementById("edit-beer-name").value = venue.beer_name || "";
    document.getElementById("edit-shot").value = venue.shot_price_pln || "";
    document.getElementById("edit-happy-hour").value = venue.happy_hour || "";
    document.getElementById("edit-is-verified").checked = venue.is_verified === true;

    editModal.classList.add("active");
  }

  function closeEditModal() {
    editModal.classList.remove("active");
  }

  btnCancelEdit.addEventListener("click", closeEditModal);
  editModal.addEventListener("click", (e) => {
    if (e.target === editModal) closeEditModal();
  });

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("edit-venue-id").value;
    const submitBtn = editForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Zapisywanie...";

    const updates = {
      name: document.getElementById("edit-name").value.trim(),
      district: document.getElementById("edit-district").value.trim(),
      beer_price_pln: parseFloat(document.getElementById("edit-price").value),
      address: document.getElementById("edit-address").value.trim(),
      beer_name: document.getElementById("edit-beer-name").value.trim() || null,
      shot_price_pln: parseFloat(document.getElementById("edit-shot").value) || null,
      happy_hour: document.getElementById("edit-happy-hour").value.trim() || null,
      is_verified: document.getElementById("edit-is-verified").checked
    };

    try {
      await callAdminApi("update-venue", { venueId: id, updates });
      const idx = allVenues.findIndex(v => v.id === id);
      if (idx !== -1) {
        allVenues[idx] = Object.assign({}, allVenues[idx], updates);
      }
      closeEditModal();
      updateStats();
      renderCurrentTab();
    } catch (err) {
      alert("Błąd podczas zapisywania zmian: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "💾 Zapisz zmiany";
    }
  });

  // Render Reports & Photos
  function renderReportsGrid() {
    const grid = document.getElementById("reports-grid");
    if (allReports.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">Brak zgłoszonych raportów lub zdjęć paragonów.</div>`;
      return;
    }

    grid.innerHTML = allReports.map(r => `
      <div class="photo-card" data-id="${r.id}">
        ${r.proof_image_url ? `
          <img src="${escapeHtml(r.proof_image_url)}" alt="Zdjęcie dowodu" onclick="window.open('${escapeHtml(r.proof_image_url)}', '_blank')" />
        ` : `
          <div style="height: 120px; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.4); font-size: 28px;">
            📝
          </div>
        `}
        <div class="photo-card-info">
          <div><strong>${escapeHtml(r.reported_beer_name || 'Piwo')}</strong>: <span style="color:#facc15;font-weight:700;">${r.reported_price_pln ? Number(r.reported_price_pln).toFixed(2) + ' zł' : '--'}</span></div>
          ${r.reported_shot_pln ? `<div>Szot: <strong>${Number(r.reported_shot_pln).toFixed(2)} zł</strong></div>` : ''}
          ${r.happy_hour_info ? `<div style="font-size:0.75rem;color:var(--text-muted);">Info: ${escapeHtml(r.happy_hour_info)}</div>` : ''}
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">📅 ${r.created_at ? r.created_at.split('T')[0] : ''}</div>
          <button type="button" class="btn btn-red btn-del-report" data-id="${r.id}" style="margin-top:6px;width:100%;justify-content:center;padding:6px;">
            Usuń raport
          </button>
        </div>
      </div>
    `).join("");

    grid.querySelectorAll(".btn-del-report").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        btn.disabled = true;
        try {
          await callAdminApi("delete-report", { reportId: id });
          allReports = allReports.filter(r => r.id !== id);
          updateStats();
          renderReportsGrid();
        } catch (err) {
          alert("Błąd: " + err.message);
          btn.disabled = false;
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  // Start app
  init();
})();
