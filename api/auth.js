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
            username_custom: true,
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

      // Calculate user sequence number (e.g. #000001) based on registration order
      let userNumber = "#000001";
      try {
        if (profile.created_at) {
          const countRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?created_at=lte.${encodeURIComponent(profile.created_at)}&select=id`, {
            headers: { ...headers, "Prefer": "count=exact" }
          });
          const contentRange = countRes.headers.get("content-range");
          if (contentRange && contentRange.includes("/")) {
            const count = parseInt(contentRange.split("/")[1], 10);
            if (!isNaN(count) && count > 0) {
              userNumber = "#" + String(count).padStart(6, "0");
            }
          }
        }
      } catch (e) {
        console.warn("User number count error:", e);
      }

      return res.status(200).json({
        success: true,
        profile,
        userNumber,
        stats: {
          followersCount,
          followingCount,
          visitedCount: Array.isArray(profile.visited_venues) ? profile.visited_venues.length : 0,
          favoriteCount: Array.isArray(profile.favorite_venues) ? profile.favorite_venues.length : 0
        },
        followingIds
      });
    }

    // =========================================================================
    // 5. Activity Feed ("Anonimowy Puls Cen w Warszawie")
    // =========================================================================
    if (action === "get-feed") {
      const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_checkins?select=venue_id,venue_name,district,beer_name,beer_price,created_at&order=created_at.desc&limit=25`,
        { headers }
      );
      if (!checkRes.ok) {
        return res.status(200).json({ success: true, feed: [] });
      }

      const checkins = await checkRes.json();
      if (!Array.isArray(checkins) || checkins.length === 0) {
        return res.status(200).json({ success: true, feed: [] });
      }

      // Return 100% anonymized price confirmations without any user identity
      const feed = checkins.map(item => ({
        venue_id: item.venue_id,
        venue_name: item.venue_name,
        district: item.district,
        beer_name: item.beer_name,
        beer_price: item.beer_price,
        created_at: item.created_at
      }));

      return res.status(200).json({ success: true, feed });
    }

    // =========================================================================
    // 6. Record Anonymous Price Confirmation (Puls Miasta)
    // =========================================================================
    if (action === "record-checkin") {
      const { venueId, venueName, district, beerName, beerPrice } = payload || {};
      if (!venueId) {
        return res.status(400).json({ error: "Brak identyfikatora lokalu." });
      }

      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/user_checkins`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          venue_id: venueId,
          venue_name: venueName || "Bar w Warszawie",
          district: district || "Warszawa",
          beer_name: beerName || "Piwo z kranu",
          beer_price: beerPrice ? parseFloat(beerPrice) : 12.0
        })
      });

      if (!insertRes.ok) {
        const errTxt = await insertRes.text();
        return res.status(500).json({ error: "Błąd zapisu potwierdzenia", details: errTxt });
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
      const { userId, visitedVenues, favoriteVenues, bio, favoriteBeer, favoriteDistrict, displayName, avatarIcon, vibeTags } = payload || {};
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
      if (vibeTags !== undefined) updateData.vibe_tags = vibeTags;

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

    // =========================================================================
    // 9. Set / Change Username (e.g. after Google OAuth or in settings)
    // =========================================================================
    if (action === "set-username") {
      const { userId, username, displayName, avatarIcon, vibeTags } = payload || {};
      if (!userId || !username) {
        return res.status(400).json({ error: "Brak userId lub nicku." });
      }

      const cleanUser = String(username).trim().toLowerCase().replace(/^@/, "");
      if (!/^[a-z0-9_]{3,20}$/.test(cleanUser)) {
        return res.status(400).json({ error: "Nick musi mieć 3-20 znaków (małe litery, cyfry lub _)." });
      }

      // Check if username is already taken by someone else
      const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(cleanUser)}&id=neq.${encodeURIComponent(userId)}&select=id`, { headers });
      if (checkRes.ok) {
        const existing = await checkRes.json();
        if (Array.isArray(existing) && existing.length > 0) {
          return res.status(400).json({ error: "Ten nick jest już zajęty. Wybierz inny." });
        }
      }

      // Update in profiles table (upsert)
      try {
        const updateData = {
          id: userId,
          username: cleanUser,
          updated_at: new Date().toISOString()
        };
        if (displayName) updateData.display_name = displayName;
        if (avatarIcon) updateData.avatar_icon = avatarIcon;
        if (vibeTags !== undefined) updateData.vibe_tags = vibeTags;

        await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
          method: "POST",
          headers: { ...headers, "Prefer": "resolution=merge-duplicates" },
          body: JSON.stringify(updateData)
        });
      } catch (e) {
        console.warn("Profiles upsert note:", e);
      }

      // Update auth user metadata via Admin API
      try {
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            user_metadata: {
              username: cleanUser,
              username_custom: true,
              display_name: displayName || cleanUser,
              avatar_icon: avatarIcon || "🍺",
              vibe_tags: vibeTags || ""
            }
          })
        });
      } catch (e) {
        console.warn("Admin metadata update note:", e);
      }

      return res.status(200).json({
        success: true,
        username: cleanUser,
        message: "Twój nick został pomyślnie zapisany!"
      });
    }

    return res.status(400).json({ error: `Nieznana akcja API: ${action}` });

  } catch (err) {
    console.error("Auth API Handler Exception:", err);
    return res.status(500).json({ error: "Wystąpił wewnętrzny błąd serwera.", details: err.message });
  }
};
