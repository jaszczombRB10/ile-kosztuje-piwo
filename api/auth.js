// Vercel Serverless Function: Poilepiwko Social & Auth API
const SUPABASE_URL = process.env.SUPABASE_URL || "https://agsodpzkytdgicpmphxz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODcxODI3MywiZXhwIjoyMTA0Mjk0MjczfQ.nXVSigEdTUqxVcIOAic59j47lUNn_qI61NQRxs3Deho";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const headers = {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };

  try {
    const { action, payload } = req.body || {};

    // =========================================================================
    // 1. Check Username Availability
    // =========================================================================
    if (action === "check-username") {
      const rawUser = String(payload?.username || "").trim().toLowerCase();
      if (!rawUser || rawUser.length < 3 || rawUser.length > 20 || !/^[a-z0-9_]+$/.test(rawUser)) {
        return res.status(200).json({ 
          available: false, 
          message: "Nick musi mieć 3-20 znaków (litery, cyfry lub _)." 
        });
      }

      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(rawUser)}&select=id`, {
        headers
      });

      if (!response.ok) {
        // If table doesn't exist yet or other DB note, report available
        return res.status(200).json({ available: true, message: "Nick jest dostępny." });
      }

      const existing = await response.json();
      if (Array.isArray(existing) && existing.length > 0) {
        return res.status(200).json({ available: false, message: "Ten nick jest już zajęty." });
      }

      return res.status(200).json({ available: true, message: "Nick jest wolny! 🎉" });
    }

    // =========================================================================
    // 2. Register New User (Instant auto-confirm via Supabase Admin API)
    // =========================================================================
    if (action === "register") {
      const { email, password, username, displayName, avatarIcon } = payload || {};

      if (!email || !password || !username) {
        return res.status(400).json({ error: "Podaj adres e-mail, hasło oraz nick." });
      }

      const cleanUser = String(username).trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(cleanUser)) {
        return res.status(400).json({ error: "Nieprawidłowy format nicku (3-20 znaków, bez spacji i znaków specjalnych)." });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: "Hasło musi mieć co najmniej 6 znaków." });
      }

      // Check if username already exists in profiles
      const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(cleanUser)}&select=id`, {
        headers
      });
      if (checkRes.ok) {
        const existingUsers = await checkRes.json();
        if (Array.isArray(existingUsers) && existingUsers.length > 0) {
          return res.status(400).json({ error: "Użytkownik o tym nicku już istnieje. Wybierz inny nick." });
        }
      }

      // Create user via Admin API with email_confirm: true
      const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: String(email).trim().toLowerCase(),
          password: password,
          email_confirm: true,
          user_metadata: {
            username: cleanUser,
            display_name: displayName || cleanUser,
            avatar_icon: avatarIcon || "🍺"
          }
        })
      });

      const createData = await createRes.json();
      if (!createRes.ok) {
        const msg = createData.message || createData.msg || createData.error_description || "Błąd podczas rejestracji użytkownika.";
        return res.status(400).json({ error: msg });
      }

      const newUser = createData;

      // Ensure profile is inserted into public.profiles
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
          method: "POST",
          headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
          body: JSON.stringify({
            id: newUser.id,
            username: cleanUser,
            display_name: displayName || cleanUser,
            avatar_icon: avatarIcon || "🍺",
            bio: "Warszawski poszukiwacz dobrego i taniego piwa 🍻",
            visited_venues: payload.visitedVenues || [],
            favorite_venues: payload.favoriteVenues || []
          })
        });
      } catch (profileErr) {
        console.warn("Profile table upsert note:", profileErr);
      }

      return res.status(200).json({ 
        success: true, 
        message: "Konto zostało utworzone pomyślnie!",
        user: {
          id: newUser.id,
          email: newUser.email,
          username: cleanUser,
          displayName: displayName || cleanUser,
          avatarIcon: avatarIcon || "🍺"
        }
      });
    }

    // =========================================================================
    // 3. Search Users by Nick or Display Name
    // =========================================================================
    if (action === "search-users") {
      const q = String(payload?.query || "").trim();
      if (!q) {
        return res.status(200).json({ success: true, users: [] });
      }

      const cleanQ = encodeURIComponent(q.replace(/^@/, ""));
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/profiles?or=(username.ilike.*${cleanQ}*,display_name.ilike.*${cleanQ}*)&select=id,username,display_name,avatar_icon,bio,favorite_district,visited_venues&limit=15`,
        { headers }
      );

      if (!response.ok) {
        return res.status(200).json({ success: true, users: [] });
      }

      const users = await response.json();
      return res.status(200).json({ success: true, users: Array.isArray(users) ? users : [] });
    }

    // =========================================================================
    // 4. Get Public Profile & Stats
    // =========================================================================
    if (action === "get-profile") {
      const username = String(payload?.username || "").trim().toLowerCase().replace(/^@/, "");
      const userId = payload?.userId;
      if (!username && !userId) {
        return res.status(400).json({ error: "Brak parametru username lub userId." });
      }

      const queryUrl = userId
        ? `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*`
        : `${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=*`;

      const profRes = await fetch(queryUrl, { headers });

      if (!profRes.ok) {
        return res.status(404).json({ error: "Nie znaleziono profilu." });
      }

      const profiles = await profRes.json();
      if (!Array.isArray(profiles) || profiles.length === 0) {
        return res.status(404).json({ error: "Użytkownik nie istnieje." });
      }

      const profile = profiles[0];

      // Get follower and following count
      let followersCount = 0;
      let followingCount = 0;
      let followingIds = [];
      try {
        const followersRes = await fetch(`${SUPABASE_URL}/rest/v1/follows?following_id=eq.${profile.id}&select=follower_id`, { headers });
        if (followersRes.ok) {
          const fList = await followersRes.json();
          followersCount = Array.isArray(fList) ? fList.length : 0;
        }
        const followingRes = await fetch(`${SUPABASE_URL}/rest/v1/follows?follower_id=eq.${profile.id}&select=following_id`, { headers });
        if (followingRes.ok) {
          const fgList = await followingRes.json();
          if (Array.isArray(fgList)) {
            followingCount = fgList.length;
            followingIds = fgList.map(f => f.following_id);
          }
        }
      } catch (e) {}

      // Get recent check-ins
      let recentCheckins = [];
      try {
        const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/user_checkins?user_id=eq.${profile.id}&order=created_at.desc&limit=10`, { headers });
        if (checkRes.ok) {
          recentCheckins = await checkRes.json();
        }
      } catch (e) {}

      return res.status(200).json({
        success: true,
        profile,
        stats: {
          followersCount,
          followingCount,
          visitedCount: Array.isArray(profile.visited_venues) ? profile.visited_venues.length : 0,
          favoriteCount: Array.isArray(profile.favorite_venues) ? profile.favorite_venues.length : 0
        },
        followingIds,
        recentCheckins: Array.isArray(recentCheckins) ? recentCheckins : []
      });
    }

    // =========================================================================
    // 5. Activity Feed ("Untappd + Strava dla Warszawy")
    // =========================================================================
    if (action === "get-feed") {
      const userId = payload?.userId;
      let targetUserIds = [];

      if (userId) {
        try {
          const followingRes = await fetch(`${SUPABASE_URL}/rest/v1/follows?follower_id=eq.${encodeURIComponent(userId)}&select=following_id`, { headers });
          if (followingRes.ok) {
            const list = await followingRes.json();
            if (Array.isArray(list) && list.length > 0) {
              targetUserIds = list.map(item => item.following_id);
            }
          }
        } catch (e) {}
      }

      // If user follows people, get their check-ins; otherwise get recent community check-ins
      let queryUrl = `${SUPABASE_URL}/rest/v1/user_checkins?order=created_at.desc&limit=25`;
      if (targetUserIds.length > 0) {
        // Also include user's own check-ins
        const allIds = [userId, ...targetUserIds].filter(Boolean);
        queryUrl = `${SUPABASE_URL}/rest/v1/user_checkins?user_id=in.(${allIds.join(",")})&order=created_at.desc&limit=25`;
      }

      const checkRes = await fetch(queryUrl, { headers });
      if (!checkRes.ok) {
        return res.status(200).json({ success: true, feed: [] });
      }

      const checkins = await checkRes.json();
      if (!Array.isArray(checkins) || checkins.length === 0) {
        return res.status(200).json({ success: true, feed: [] });
      }

      // Fetch user profile previews for checkin authors
      const authorIds = [...new Set(checkins.map(c => c.user_id))];
      let authorsMap = {};
      if (authorIds.length > 0) {
        try {
          const authorsRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=in.(${authorIds.join(",")})&select=id,username,display_name,avatar_icon`, { headers });
          if (authorsRes.ok) {
            const authorsList = await authorsRes.json();
            if (Array.isArray(authorsList)) {
              authorsList.forEach(a => { authorsMap[a.id] = a; });
            }
          }
        } catch (e) {}
      }

      const feed = checkins.map(item => ({
        ...item,
        author: authorsMap[item.user_id] || {
          username: "piwosz",
          display_name: "Użytkownik",
          avatar_icon: "🍺"
        }
      }));

      return res.status(200).json({ success: true, feed });
    }

    // =========================================================================
    // 6. Record a Check-in (Visited Venue)
    // =========================================================================
    if (action === "record-checkin") {
      const { userId, venueId, venueName, district, beerName, beerPrice } = payload || {};
      if (!userId || !venueId) {
        return res.status(400).json({ error: "Brak wymaganych danych check-in." });
      }

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_checkins`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: userId,
          venue_id: venueId,
          venue_name: venueName || "Bar w Warszawie",
          district: district || "Warszawa",
          beer_name: beerName || "Piwo z kranu",
          beer_price: beerPrice ? parseFloat(beerPrice) : 12.0
        })
      });

      if (!insertRes.ok) {
        const errTxt = await insertRes.text();
        return res.status(500).json({ error: "Błąd zapisu check-in", details: errTxt });
      }

      return res.status(200).json({ success: true });
    }

    // =========================================================================
    // 7. Toggle Follow / Unfollow
    // =========================================================================
    if (action === "toggle-follow") {
      const { followerId, followingId } = payload || {};
      if (!followerId || !followingId || followerId === followingId) {
        return res.status(400).json({ error: "Nieprawidłowe identyfikatory użytkowników." });
      }

      // Check if already following
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/follows?follower_id=eq.${followerId}&following_id=eq.${followingId}`,
        { headers }
      );

      let isNowFollowing = false;
      if (checkRes.ok) {
        const existing = await checkRes.json();
        if (Array.isArray(existing) && existing.length > 0) {
          // Unfollow
          await fetch(
            `${SUPABASE_URL}/rest/v1/follows?follower_id=eq.${followerId}&following_id=eq.${followingId}`,
            { method: "DELETE", headers }
          );
          isNowFollowing = false;
        } else {
          // Follow
          await fetch(`${SUPABASE_URL}/rest/v1/follows`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              follower_id: followerId,
              following_id: followingId
            })
          });
          isNowFollowing = true;
        }
      }

      return res.status(200).json({ success: true, isFollowing: isNowFollowing });
    }

    // =========================================================================
    // 8. Sync Visited & Favorite Venues to Cloud Profile
    // =========================================================================
    if (action === "sync-profile") {
      const { userId, visitedVenues, favoriteVenues, bio, favoriteBeer, favoriteDistrict, displayName, avatarIcon } = payload || {};
      if (!userId) {
        return res.status(400).json({ error: "Brak userId." });
      }

      const updateData = { updated_at: new Date().toISOString() };
      if (Array.isArray(visitedVenues)) updateData.visited_venues = visitedVenues;
      if (Array.isArray(favoriteVenues)) updateData.favorite_venues = favoriteVenues;
      if (bio !== undefined) updateData.bio = bio;
      if (favoriteBeer !== undefined) updateData.favorite_beer = favoriteBeer;
      if (favoriteDistrict !== undefined) updateData.favorite_district = favoriteDistrict;
      if (displayName !== undefined) updateData.display_name = displayName;
      if (avatarIcon !== undefined) updateData.avatar_icon = avatarIcon;

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(updateData)
      });

      if (!patchRes.ok) {
        const err = await patchRes.text();
        return res.status(500).json({ error: "Błąd aktualizacji profilu", details: err });
      }

      return res.status(200).json({ success: true, message: "Profil zsynchronizowany pomyślnie." });
    }

    return res.status(400).json({ error: `Nieznana akcja API: ${action}` });

  } catch (err) {
    console.error("Auth API Handler Exception:", err);
    return res.status(500).json({ error: "Wystąpił wewnętrzny błąd serwera.", details: err.message });
  }
};
