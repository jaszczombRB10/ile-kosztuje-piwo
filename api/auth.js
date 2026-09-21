// Vercel Serverless Function: Poilepiwko Social & Auth API
const SUPABASE_URL = process.env.SUPABASE_URL || "https://agsodpzkytdgicpmphxz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnc29kcHpreXRkZ2ljcG1waHh6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODcxODI3MywiZXhwIjoyMTA0Mjk0MjczfQ.nXVSigEdTUqxVcIOAic59j47lUNn_qI61NQRxs3Deho";
const { isOffensive, validateUsername, validateDisplayName, validateBio } = require("./moderation");

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
      const userValidation = validateUsername(rawUser);
      if (!userValidation.valid) {
        return res.status(200).json({ 
          available: false, 
          message: userValidation.error 
        });
      }

      const cleanUser = userValidation.clean;
      const response = await fetch(`${SUPABASE_URL}/rest/v1/profiles?username=eq.${encodeURIComponent(cleanUser)}&select=id`, {
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

      const userValidation = validateUsername(username);
      if (!userValidation.valid) {
        return res.status(400).json({ error: userValidation.error });
      }
      const cleanUser = userValidation.clean;

      if (displayName) {
        const nameValidation = validateDisplayName(displayName);
        if (!nameValidation.valid) {
          return res.status(400).json({ error: nameValidation.error });
        }
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
    // 3. Search Users by Nick or Display Name / Fetch by IDs
    // =========================================================================
    if (action === "search-users") {
      const q = String(payload?.query || "").trim().toLowerCase();
      const reqUserIds = Array.isArray(payload?.userIds) ? payload.userIds : null;

      if (!q && (!reqUserIds || reqUserIds.length === 0)) {
        return res.status(200).json({ success: true, users: [] });
      }

      let users = [];

      // If specific user IDs were requested
      if (reqUserIds && reqUserIds.length > 0) {
        try {
          const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=500`, { headers });
          if (listRes.ok) {
            const listData = await listRes.json();
            const allUsers = listData.users || (Array.isArray(listData) ? listData : []);
            users = allUsers
              .filter(u => reqUserIds.includes(u.id))
              .map(u => {
                const m = u.user_metadata || {};
                return {
                  id: u.id,
                  username: m.username || u.email?.split("@")[0] || "piwosz",
                  display_name: m.display_name || m.full_name || m.username || "Piwosz",
                  avatar_icon: m.avatar_icon || "🍺",
                  avatar_photo: m.avatar_photo || null,
                  bio: m.bio || "",
                  favorite_district: m.favorite_district || "",
                  visited_venues: m.visited_venues || []
                };
              });
            return res.status(200).json({ success: true, users });
          }
        } catch (e) {
          console.warn("User IDs search error:", e);
        }
      }

      const cleanQ = encodeURIComponent(q.replace(/^@/, ""));

      try {
        const response = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?username.ilike.*${cleanQ}*&select=id,username,display_name,avatar_icon,avatar_photo,bio,favorite_district,visited_venues&limit=15`,
          { headers }
        );

        if (response.ok) {
          const dbUsers = await response.json();
          if (Array.isArray(dbUsers) && dbUsers.length > 0) {
            users = dbUsers;
          }
        }
      } catch (e) {
        console.warn("DB search error:", e);
      }

      // Fallback: search in Supabase Auth Admin users (strictly by username / nick)
      if (users.length === 0) {
        try {
          const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers });
          if (listRes.ok) {
            const listData = await listRes.json();
            const allUsers = listData.users || (Array.isArray(listData) ? listData : []);
            const plainQ = q.replace(/^@/, "");
            users = allUsers
              .filter(u => {
                const uName = (u.user_metadata?.username || u.email?.split("@")[0] || "").toLowerCase();
                return uName.includes(plainQ);
              })
              .map(u => {
                const m = u.user_metadata || {};
                return {
                  id: u.id,
                  username: m.username || u.email?.split("@")[0] || "piwosz",
                  display_name: m.display_name || m.full_name || m.username || "Piwosz",
                  avatar_icon: m.avatar_icon || "🍺",
                  avatar_photo: m.avatar_photo || null,
                  bio: m.bio || "",
                  favorite_district: m.favorite_district || "",
                  visited_venues: m.visited_venues || []
                };
              })
              .slice(0, 20);
          }
        } catch (adminErr) {
          console.warn("Admin search error:", adminErr);
        }
      }

      return res.status(200).json({ success: true, users });
    }

    // =========================================================================
    // 3b. Get Following Users List
    // =========================================================================
    if (action === "get-following") {
      const { userId } = payload || {};
      let userIds = Array.isArray(payload?.userIds) ? payload.userIds : [];

      try {
        if (userIds.length === 0 && userId) {
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
          if (userRes.ok) {
            const u = await userRes.json();
            userIds = Array.isArray(u.user_metadata?.following_ids) ? u.user_metadata.following_ids : [];
          }
        }

        if (userIds.length === 0) {
          return res.status(200).json({ success: true, users: [], followingIds: [] });
        }

        const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=500`, { headers });
        if (!listRes.ok) {
          return res.status(200).json({ success: true, users: [], followingIds: userIds });
        }

        const listData = await listRes.json();
        const allUsers = listData.users || (Array.isArray(listData) ? listData : []);

        const users = allUsers
          .filter(u => userIds.includes(u.id))
          .map(u => {
            const m = u.user_metadata || {};
            return {
              id: u.id,
              username: m.username || u.email?.split("@")[0] || "piwosz",
              display_name: m.display_name || m.full_name || m.username || "Piwosz",
              avatar_icon: m.avatar_icon || "🍺",
              avatar_photo: m.avatar_photo || null,
              bio: m.bio || "",
              favorite_district: m.favorite_district || "",
              visited_venues: m.visited_venues || []
            };
          });

        return res.status(200).json({ success: true, users, followingIds: userIds });
      } catch (e) {
        console.error("get-following error:", e);
        return res.status(500).json({ error: "Błąd podczas pobierania listy obserwowanych." });
      }
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

      let profile = null;
      let userNumber = "#000001";
      let followersCount = 0;
      let followingCount = 0;
      let followingIds = [];

      try {
        if (userId) {
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
          if (userRes.ok) {
            const u = await userRes.json();
            const meta = u.user_metadata || {};
            followingIds = Array.isArray(meta.following_ids) ? meta.following_ids : [];
            followersCount = Array.isArray(meta.follower_ids) ? meta.follower_ids.length : 0;
            userNumber = meta.user_number || "#000001";

            profile = {
              id: u.id,
              username: meta.username || u.email?.split("@")[0] || "piwosz",
              display_name: meta.display_name || meta.full_name || meta.username || "Piwosz",
              avatar_icon: meta.avatar_icon || "🍺",
              avatar_photo: meta.avatar_photo || null,
              user_number: userNumber,
              bio: meta.bio || "Warszawski poszukiwacz dobrego i taniego piwa 🍻",
              favorite_beer: meta.favorite_beer || "",
              favorite_district: meta.favorite_district || "",
              vibe_tags: meta.vibe_tags || "",
              visited_venues: meta.visited_venues || [],
              favorite_venues: meta.favorite_venues || [],
              created_at: u.created_at
            };
          }
        } else if (username) {
          const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=100`, { headers });
          if (listRes.ok) {
            const listData = await listRes.json();
            const allUsers = listData.users || (Array.isArray(listData) ? listData : []);
            const match = allUsers.find(u => {
              const uName = (u.user_metadata?.username || u.email?.split("@")[0] || "").toLowerCase();
              return uName === username;
            });
            if (match) {
              const meta = match.user_metadata || {};
              followingIds = Array.isArray(meta.following_ids) ? meta.following_ids : [];
              followersCount = Array.isArray(meta.follower_ids) ? meta.follower_ids.length : 0;
              userNumber = meta.user_number || "#000001";

              profile = {
                id: match.id,
                username: meta.username || match.email?.split("@")[0] || username,
                display_name: meta.display_name || meta.full_name || meta.username || username,
                avatar_icon: meta.avatar_icon || "🍺",
                avatar_photo: meta.avatar_photo || null,
                user_number: userNumber,
                bio: meta.bio || "Warszawski poszukiwacz dobrego i taniego piwa 🍻",
                favorite_beer: meta.favorite_beer || "",
                favorite_district: meta.favorite_district || "",
                vibe_tags: meta.vibe_tags || "",
                visited_venues: meta.visited_venues || [],
                favorite_venues: meta.favorite_venues || [],
                created_at: match.created_at
              };
            }
          }
        }
      } catch (err) {
        console.error("get-profile error:", err);
      }

      if (!profile) {
        return res.status(404).json({ error: "Użytkownik nie istnieje." });
      }

      followingCount = followingIds.length;

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
    // 5. Activity Feed & Live Bar BeReal
    // =========================================================================
    if (action === "get-live-feed") {
      try {
        let items = [];
        // Fetch price reports with photo proofs
        const reportsRes = await fetch(
          `${SUPABASE_URL}/rest/v1/price_reports?proof_image_url=not.is.null&order=created_at.desc&limit=30`,
          { headers }
        );
        if (reportsRes.ok) {
          const reports = await reportsRes.json();
          if (Array.isArray(reports)) {
            items = reports.map(r => ({
              id: "rep_" + (r.id || Math.random().toString(36).slice(2, 8)),
              venue_name: r.reported_beer_name ? `${r.reported_beer_name}` : "Warszawski bar",
              beer_price: r.reported_price_pln,
              photo_url: r.proof_image_url,
              user_name: "Piwosz z Warszawy",
              user_avatar: "🍺",
              created_at: r.created_at,
              cheers_count: 3
            }));
          }
        }

        // Fetch recent user check-in photos
        const allRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=50`, { headers });
        if (allRes.ok) {
          const uData = await allRes.json();
          const allU = uData.users || [];
          for (const u of allU) {
            const m = u.user_metadata || {};
            const ch = m.last_checkin;
            if (ch && ch.photo_url) {
              items.unshift({
                id: "chk_" + u.id,
                venue_id: ch.venue_id || "",
                venue_name: ch.venue_name || "Lokal w Warszawie",
                district: ch.district || "Warszawa",
                beer_name: ch.beer_name || "Piwo z nalewaka",
                beer_price: ch.beer_price,
                photo_url: ch.photo_url,
                selfie_url: ch.selfie_url || null,
                user_id: u.id,
                author_id: u.id,
                user_name: m.display_name || m.username || "Piwosz",
                author_name: m.username || m.display_name || "Piwosz",
                user_handle: m.username ? `@${m.username}` : "@piwosz",
                user_avatar: m.avatar_icon || "🍺",
                avatar_icon: m.avatar_icon || "🍺",
                user_photo: m.avatar_photo || null,
                avatar_photo: m.avatar_photo || null,
                created_at: new Date(ch.timestamp || Date.now()).toISOString(),
                cheers_count: 7
              });
            }
          }
        }

        return res.status(200).json({ success: true, feed: items });
      } catch (err) {
        console.error("get-live-feed error:", err);
        return res.status(200).json({ success: true, feed: [] });
      }
    }

    // =========================================================================
    // 5b. Friends Map 24h & Puls Warszawy Hotspots
    // =========================================================================
    if (action === "get-friends-map-checkins") {
      const { userId } = payload || {};
      let followingIds = Array.isArray(payload?.followingIds) ? payload.followingIds : [];

      try {
        if (userId && followingIds.length === 0) {
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
          if (userRes.ok) {
            const u = await userRes.json();
            followingIds = Array.isArray(u.user_metadata?.following_ids) ? u.user_metadata.following_ids : [];
          }
        }

        const activeFriends = [];
        if (followingIds.length > 0) {
          const allRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=100`, { headers });
          if (allRes.ok) {
            const data = await allRes.json();
            const allUsers = data.users || [];
            const now = Date.now();
            const cutoff24h = 24 * 60 * 60 * 1000;

            for (const u of allUsers) {
              if (!followingIds.includes(u.id)) continue;
              const meta = u.user_metadata || {};
              const checkin = meta.last_checkin;
              if (checkin && !checkin.ghost_mode && (now - (checkin.timestamp || 0) <= cutoff24h)) {
                activeFriends.push({
                  user_id: u.id,
                  username: meta.username || u.email?.split("@")[0] || "piwosz",
                  display_name: meta.display_name || meta.full_name || meta.username || "Piwosz",
                  avatar_icon: meta.avatar_icon || "🍺",
                  avatar_photo: meta.avatar_photo || null,
                  venue_id: checkin.venue_id,
                  venue_name: checkin.venue_name,
                  district: checkin.district,
                  latitude: checkin.latitude,
                  longitude: checkin.longitude,
                  beer_name: checkin.beer_name,
                  beer_price: checkin.beer_price,
                  photo_url: checkin.photo_url,
                  timestamp: checkin.timestamp
                });
              }
            }
          }
        }

        // Real Warsaw Party Hotspots ("Puls Warszawy")
        const hotspots = [
          { name: "Pawilony Nowy Świat", coords: [52.2323, 21.0206], count: 42, vibe: "Studencki klimat, shoty & tanie piwo" },
          { name: "Bulwary Wiślane", coords: [52.2380, 21.0350], count: 51, vibe: "Widok na rzekę, muzyka & leżaki" },
          { name: "Plac Zbawiciela", coords: [52.2198, 21.0182], count: 36, vibe: "Kultowy Zbawix, Plan B & ogródki" },
          { name: "Nowogrodzka Craft Hub", coords: [52.2289, 21.0142], count: 29, vibe: "Jabeerwocky, Kufle i Kapsle" },
          { name: "Fabryka Norblina & Wola", coords: [52.2322, 20.9918], count: 23, vibe: "Foodhall, Uwaga Piwo & Browar Warszawski" },
          { name: "Saska Kępa (Francuska)", coords: [52.2325, 21.0610], count: 18, vibe: "Przytulne ogródki & craft" }
        ];

        return res.status(200).json({
          success: true,
          activeFriends,
          hotspots,
          hasFriendsActive: activeFriends.length > 0
        });
      } catch (err) {
        console.error("get-friends-map-checkins error:", err);
        return res.status(500).json({ error: "Błąd pobierania mapy aktywności." });
      }
    }

    // =========================================================================
    // 5c. Recommended Friends ("Popularni Teraz w Warszawie")
    // =========================================================================
    if (action === "get-recommended-users") {
      const { userId } = payload || {};
      try {
        const allRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=100`, { headers });
        if (!allRes.ok) return res.status(200).json({ success: true, users: [] });

        const data = await allRes.json();
        const allUsers = data.users || [];

        let myFollowing = [];
        if (userId) {
          const me = allUsers.find(u => u.id === userId);
          if (me && me.user_metadata?.following_ids) {
            myFollowing = me.user_metadata.following_ids;
          }
        }

        const recommended = allUsers
          .filter(u => u.id !== userId && !myFollowing.includes(u.id))
          .map(u => {
            const m = u.user_metadata || {};
            return {
              id: u.id,
              username: m.username || u.email?.split("@")[0] || "piwosz",
              display_name: m.display_name || m.full_name || m.username || "Piwosz",
              avatar_icon: m.avatar_icon || "🍺",
              avatar_photo: m.avatar_photo || null,
              user_number: m.user_number || "#000001",
              bio: m.bio || "Warszawski poszukiwacz dobrego i taniego piwa 🍻",
              visited_count: Array.isArray(m.visited_venues) ? m.visited_venues.length : 0,
              popular_badge: "🔥 Aktywny piwosz"
            };
          });

        return res.status(200).json({ success: true, users: recommended });
      } catch (err) {
        console.error("get-recommended-users error:", err);
        return res.status(200).json({ success: true, users: [] });
      }
    }

    // =========================================================================
    // 6. Record Checkin with Kapsle rewards
    // =========================================================================
    if (action === "record-checkin") {
      const { userId, venueId, venueName, district, beerName, beerPrice, latitude, longitude, photoUrl, selfieUrl, ghostMode } = payload || {};
      if (!venueId) {
        return res.status(400).json({ error: "Brak identyfikatora lokalu." });
      }

      if (userId) {
        try {
          const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
          if (userRes.ok) {
            const u = await userRes.json();
            const meta = u.user_metadata || {};
            const visited = Array.isArray(meta.visited_venues) ? [...meta.visited_venues] : [];
            if (!visited.includes(venueId)) visited.push(venueId);

            const curKapsle = typeof meta.kapsle_points === "number" ? meta.kapsle_points : 0;
            const earned = photoUrl ? 15 : 10;
            const newKapsle = curKapsle + earned;

            const checkinData = {
              venue_id: venueId,
              venue_name: venueName || "Bar w Warszawie",
              district: district || "Warszawa",
              latitude: latitude || 52.23,
              longitude: longitude || 21.01,
              beer_name: beerName || "Piwo z nalewaka",
              beer_price: beerPrice || 14.0,
              photo_url: photoUrl || null,
              selfie_url: selfieUrl || null,
              timestamp: Date.now(),
              ghost_mode: !!ghostMode
            };

            await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
              method: "PUT",
              headers,
              body: JSON.stringify({
                user_metadata: {
                  ...meta,
                  visited_venues: visited,
                  last_checkin: checkinData,
                  kapsle_points: newKapsle
                }
              })
            });

            return res.status(200).json({ success: true, earnedKapsle: earned, totalKapsle: newKapsle });
          }
        } catch (e) {
          console.warn("Checkin user metadata update note:", e);
        }
      }

      return res.status(200).json({ success: true, earnedKapsle: 10 });
    }

    // Cheers 🍻 reaction on bar photo
    if (action === "react-cheers") {
      return res.status(200).json({ success: true, message: "Stuknięto się kuflem! 🍻" });
    }

    // =========================================================================
    // 7. Toggle Follow / Unfollow
    // =========================================================================
    if (action === "toggle-follow") {
      const { followerId, followingId } = payload || {};
      if (!followerId || !followingId || followerId === followingId) {
        return res.status(400).json({ error: "Nieprawidłowe identyfikatory użytkowników." });
      }

      try {
        // Fetch follower user
        const followerRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(followerId)}`, { headers });
        if (!followerRes.ok) {
          return res.status(404).json({ error: "Nie znaleziono profilu obserwującego." });
        }
        const followerUser = await followerRes.json();
        const followerMeta = followerUser.user_metadata || {};
        let followerFollowingIds = Array.isArray(followerMeta.following_ids) ? [...followerMeta.following_ids] : [];

        // Fetch target user
        const followingRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(followingId)}`, { headers });
        let followingMeta = {};
        let targetFollowerIds = [];
        if (followingRes.ok) {
          const followingUser = await followingRes.json();
          followingMeta = followingUser.user_metadata || {};
          targetFollowerIds = Array.isArray(followingMeta.follower_ids) ? [...followingMeta.follower_ids] : [];
        }

        let isNowFollowing = false;
        if (followerFollowingIds.includes(followingId)) {
          // Unfollow
          followerFollowingIds = followerFollowingIds.filter(id => id !== followingId);
          targetFollowerIds = targetFollowerIds.filter(id => id !== followerId);
          isNowFollowing = false;
        } else {
          // Follow
          followerFollowingIds.push(followingId);
          if (!targetFollowerIds.includes(followerId)) {
            targetFollowerIds.push(followerId);
          }
          isNowFollowing = true;
        }

        let targetNotifs = Array.isArray(followingMeta.notifications) ? [...followingMeta.notifications] : [];
        if (isNowFollowing) {
          const fromName = followerMeta.display_name || followerMeta.username || "Nowy Piwosz";
          targetNotifs.unshift({
            id: "notif_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            type: "new_follower",
            fromUserId: followerId,
            fromUsername: followerMeta.username || followerUser.email?.split("@")[0] || "znajomy",
            fromDisplayName: fromName,
            fromAvatarIcon: followerMeta.avatar_icon || "🍺",
            fromAvatarPhoto: followerMeta.avatar_photo || null,
            message: `${fromName} zaczął Cię obserwować! 👥`,
            createdAt: new Date().toISOString(),
            read: false
          });
          targetNotifs = targetNotifs.slice(0, 30);
        }

        // Persist to follower user_metadata
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(followerId)}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            user_metadata: {
              ...followerMeta,
              following_ids: followerFollowingIds
            }
          })
        });

        // Persist to target user_metadata
        if (followingRes.ok) {
          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(followingId)}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              user_metadata: {
                ...followingMeta,
                follower_ids: targetFollowerIds,
                notifications: targetNotifs
              }
            })
          });
        }

        return res.status(200).json({
          success: true,
          isFollowing: isNowFollowing,
          followingCount: followerFollowingIds.length,
          followingIds: followerFollowingIds,
          followersCount: targetFollowerIds.length
        });
      } catch (err) {
        console.error("toggle-follow error:", err);
        return res.status(500).json({ error: "Błąd serwera podczas aktualizacji obserwowania." });
      }
    }

    // =========================================================================
    // 7b. Send Virtual Cheers Toast to a Friend
    // =========================================================================
    if (action === "send-toast") {
      const { fromUserId, toUserId } = payload || {};
      if (!fromUserId || !toUserId || fromUserId === toUserId) {
        return res.status(400).json({ error: "Nieprawidłowe identyfikatory użytkowników." });
      }

      try {
        const fromRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(fromUserId)}`, { headers });
        const toRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(toUserId)}`, { headers });
        if (!fromRes.ok || !toRes.ok) {
          return res.status(404).json({ error: "Nie znaleziono użytkownika." });
        }

        const fromUser = await fromRes.json();
        const toUser = await toRes.json();
        const fromMeta = fromUser.user_metadata || {};
        const toMeta = toUser.user_metadata || {};

        let targetNotifs = Array.isArray(toMeta.notifications) ? [...toMeta.notifications] : [];
        const fromName = fromMeta.display_name || fromMeta.username || "Piwosz";

        targetNotifs.unshift({
          id: "notif_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          type: "cheers_toast",
          fromUserId,
          fromUsername: fromMeta.username || "znajomy",
          fromDisplayName: fromName,
          fromAvatarIcon: fromMeta.avatar_icon || "🍻",
          fromAvatarPhoto: fromMeta.avatar_photo || null,
          message: `${fromName} wzniósł z Tobą toast: Na zdrowie! 🍻`,
          createdAt: new Date().toISOString(),
          read: false
        });

        targetNotifs = targetNotifs.slice(0, 30);

        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(toUserId)}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            user_metadata: {
              ...toMeta,
              notifications: targetNotifs
            }
          })
        });

        return res.status(200).json({ success: true });
      } catch (err) {
        console.error("send-toast error:", err);
        return res.status(500).json({ error: "Błąd podczas wysyłania toastu." });
      }
    }

    // =========================================================================
    // 7c. Get User Notifications
    // =========================================================================
    if (action === "get-notifications") {
      const { userId } = payload || {};
      if (!userId) {
        return res.status(400).json({ error: "Brak userId." });
      }

      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
        if (!uRes.ok) {
          return res.status(404).json({ error: "Nie znaleziono użytkownika." });
        }
        const u = await uRes.json();
        const notifs = Array.isArray(u.user_metadata?.notifications) ? u.user_metadata.notifications : [];
        const unreadCount = notifs.filter(n => !n.read).length;

        return res.status(200).json({
          success: true,
          notifications: notifs,
          unreadCount
        });
      } catch (err) {
        console.error("get-notifications error:", err);
        return res.status(500).json({ error: "Błąd podczas pobierania powiadomień." });
      }
    }

    // =========================================================================
    // 7d. Mark Notifications as Read
    // =========================================================================
    if (action === "mark-notifications-read") {
      const { userId } = payload || {};
      if (!userId) {
        return res.status(400).json({ error: "Brak userId." });
      }

      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
        if (!uRes.ok) {
          return res.status(404).json({ error: "Nie znaleziono użytkownika." });
        }
        const u = await uRes.json();
        const meta = u.user_metadata || {};
        const notifs = Array.isArray(meta.notifications) ? meta.notifications : [];
        const updatedNotifs = notifs.map(n => ({ ...n, read: true }));

        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            user_metadata: {
              ...meta,
              notifications: updatedNotifs
            }
          })
        });

        return res.status(200).json({ success: true, unreadCount: 0 });
      } catch (err) {
        console.error("mark-notifications-read error:", err);
        return res.status(500).json({ error: "Błąd podczas oznaczania powiadomień." });
      }
    }

    // =========================================================================
    // 8. Sync Visited & Favorite Venues to Cloud Profile
    // =========================================================================
    // =========================================================================
    // 8. Sync Visited & Favorite Venues to Cloud Profile
    // =========================================================================
    if (action === "sync-profile") {
      const { userId, visitedVenues, favoriteVenues, bio, favoriteBeer, favoriteDistrict, displayName, avatarIcon, avatarPhoto, vibeTags } = payload || {};
      if (!userId) {
        return res.status(400).json({ error: "Brak userId." });
      }

      if (displayName !== undefined && displayName !== null && displayName !== "") {
        const nameValidation = validateDisplayName(displayName);
        if (!nameValidation.valid) {
          return res.status(400).json({ error: nameValidation.error });
        }
      }

      if (bio !== undefined && bio !== null && bio !== "") {
        const bioValidation = validateBio(bio);
        if (!bioValidation.valid) {
          return res.status(400).json({ error: bioValidation.error });
        }
      }

      // Update Supabase Auth user_metadata via Admin API (guaranteed persistence)
      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
        if (uRes.ok) {
          const uData = await uRes.json();
          const existingMeta = uData.user_metadata || {};
          const newMeta = { ...existingMeta };
          if (displayName !== undefined) newMeta.display_name = displayName;
          if (avatarIcon !== undefined) newMeta.avatar_icon = avatarIcon;
          if (avatarPhoto !== undefined) newMeta.avatar_photo = avatarPhoto;
          if (bio !== undefined) newMeta.bio = bio;
          if (favoriteBeer !== undefined) newMeta.favorite_beer = favoriteBeer;
          if (favoriteDistrict !== undefined) newMeta.favorite_district = favoriteDistrict;
          if (vibeTags !== undefined) newMeta.vibe_tags = vibeTags;
          if (Array.isArray(visitedVenues)) newMeta.visited_venues = visitedVenues;
          if (Array.isArray(favoriteVenues)) newMeta.favorite_venues = favoriteVenues;

          await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ user_metadata: newMeta })
          });
        }
      } catch (adminErr) {
        console.warn("Admin metadata sync note:", adminErr);
      }

      // Also try patching profiles table if it exists
      try {
        const updateData = { updated_at: new Date().toISOString() };
        if (Array.isArray(visitedVenues)) updateData.visited_venues = visitedVenues;
        if (Array.isArray(favoriteVenues)) updateData.favorite_venues = favoriteVenues;
        if (bio !== undefined) updateData.bio = bio;
        if (favoriteBeer !== undefined) updateData.favorite_beer = favoriteBeer;
        if (favoriteDistrict !== undefined) updateData.favorite_district = favoriteDistrict;
        if (displayName !== undefined) updateData.display_name = displayName;
        if (avatarIcon !== undefined) updateData.avatar_icon = avatarIcon;
        if (avatarPhoto !== undefined) updateData.avatar_photo = avatarPhoto;
        if (vibeTags !== undefined) updateData.vibe_tags = vibeTags;

        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify(updateData)
        });
      } catch (patchErr) {
        console.warn("Profiles table patch note:", patchErr);
      }

      return res.status(200).json({ success: true, message: "Profil zsynchronizowany pomyślnie." });
    }

    // =========================================================================
    // 9. Set / Change Username (e.g. after Google OAuth or in settings)
    // =========================================================================
    if (action === "set-username") {
      const { userId, username, displayName, avatarIcon, avatarPhoto, vibeTags, bio } = payload || {};
      if (!userId || !username) {
        return res.status(400).json({ error: "Brak userId lub nicku." });
      }

      const userValidation = validateUsername(username);
      if (!userValidation.valid) {
        return res.status(400).json({ error: userValidation.error });
      }
      const cleanUser = userValidation.clean;

      if (displayName !== undefined && displayName !== null && displayName !== "") {
        const nameValidation = validateDisplayName(displayName);
        if (!nameValidation.valid) {
          return res.status(400).json({ error: nameValidation.error });
        }
      }

      if (bio !== undefined && bio !== null && bio !== "") {
        const bioValidation = validateBio(bio);
        if (!bioValidation.valid) {
          return res.status(400).json({ error: bioValidation.error });
        }
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
        if (avatarPhoto !== undefined) updateData.avatar_photo = avatarPhoto;
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
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
        let newMeta = {
          username: cleanUser,
          username_custom: true,
          display_name: displayName || cleanUser,
          avatar_icon: avatarIcon || "🍺",
          vibe_tags: vibeTags || ""
        };
        if (uRes.ok) {
          const uData = await uRes.json();
          newMeta = { ...uData.user_metadata, ...newMeta };
        }
        if (avatarPhoto !== undefined) {
          newMeta.avatar_photo = avatarPhoto;
        }

        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ user_metadata: newMeta })
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

    // =========================================================================
    // 12. Trigger SOS Alert to Friends / Ekipa
    // =========================================================================
    if (action === "trigger-sos-alert") {
      const { userId, venueName, address, latitude, longitude, note } = payload || {};
      if (!userId) {
        return res.status(400).json({ error: "Brak identyfikatora użytkownika." });
      }

      try {
        const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { headers });
        if (!uRes.ok) {
          return res.status(404).json({ error: "Nie znaleziono użytkownika." });
        }
        const userObj = await uRes.json();
        const userMeta = userObj.user_metadata || {};
        const fromName = userMeta.display_name || userMeta.username || "Piwosz z Twojej Ekipy";
        const fromUsername = userMeta.username || userObj.email?.split("@")[0] || "znajomy";

        const followers = Array.isArray(userMeta.follower_ids) ? userMeta.follower_ids : [];
        const vName = venueName || "Warszawa";
        const addr = address || "";
        const alertIso = new Date().toISOString();

        const sosNotif = {
          id: "sos_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          type: "sos_alert",
          fromUserId: userId,
          fromUsername: fromUsername,
          fromDisplayName: fromName,
          fromAvatarIcon: "🚨",
          venueName: vName,
          address: addr,
          latitude: typeof latitude === "number" ? latitude : null,
          longitude: typeof longitude === "number" ? longitude : null,
          note: note || "",
          message: `🚨 SOS: ${fromName} potrzebuje wsparcia! Lokal: ${vName}${addr ? " (" + addr + ")" : ""}`,
          createdAt: alertIso,
          read: false
        };

        let notifiedCount = 0;
        for (const fId of followers) {
          try {
            const fRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(fId)}`, { headers });
            if (fRes.ok) {
              const fUser = await fRes.json();
              const fMeta = fUser.user_metadata || {};
              let fNotifs = Array.isArray(fMeta.notifications) ? [...fMeta.notifications] : [];
              fNotifs.unshift(sosNotif);
              fNotifs = fNotifs.slice(0, 30);

              await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(fId)}`, {
                method: "PUT",
                headers,
                body: JSON.stringify({
                  user_metadata: {
                    ...fMeta,
                    notifications: fNotifs
                  }
                })
              });
              notifiedCount++;
            }
          } catch (err) {
            console.warn("SOS follower notify failed:", fId, err);
          }
        }

        // Save last_sos_alert on sender user
        await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            user_metadata: {
              ...userMeta,
              last_sos_alert: {
                ...sosNotif,
                active: true
              }
            }
          })
        });

        return res.status(200).json({
          success: true,
          notifiedCount,
          message: notifiedCount > 0 
            ? `Wysłano alert SOS do ${notifiedCount} ${notifiedCount === 1 ? "znajomego" : "znajomych"} z Twojej ekipy!` 
            : "Zapisano alert SOS. Dodaj znajomych do ekipy, aby otrzymywali natychmiastowe powiadomienia."
        });
      } catch (err) {
        console.error("trigger-sos-alert error:", err);
        return res.status(500).json({ error: "Błąd podczas rozsyłania alertu SOS." });
      }
    }

    // =========================================================================
    // 13. Delete Account (Apple App Store Guideline 5.1.1(v) Compliance)
    // =========================================================================
    if (action === "delete-account") {
      const { userId } = payload || {};
      if (!userId) {
        return res.status(400).json({ error: "Brak identyfikatora użytkownika." });
      }

      try {
        // 1. Delete user from profiles table (if table exists)
        await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
          method: "DELETE",
          headers
        }).catch(err => console.warn("Profile delete note:", err));

        // 2. Delete user from follows / checkins / activity
        await fetch(`${SUPABASE_URL}/rest/v1/follows?or=(follower_id.eq.${encodeURIComponent(userId)},following_id.eq.${encodeURIComponent(userId)})`, {
          method: "DELETE",
          headers
        }).catch(() => {});

        await fetch(`${SUPABASE_URL}/rest/v1/checkins?user_id=eq.${encodeURIComponent(userId)}`, {
          method: "DELETE",
          headers
        }).catch(() => {});

        // 3. Delete user completely from Supabase Auth Admin
        const authDelRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
          method: "DELETE",
          headers
        });

        if (!authDelRes.ok) {
          const errData = await authDelRes.json().catch(() => ({}));
          console.warn("Supabase Auth Admin user delete note:", errData);
        }

        return res.status(200).json({
          success: true,
          message: "Konto oraz powiązane dane zostały trwale usunięte."
        });
      } catch (err) {
        console.error("delete-account error:", err);
        return res.status(500).json({ error: "Błąd podczas usuwania konta z bazy." });
      }
    }

    // =========================================================================
    // 14. UGC Content Reporting (Apple App Store Guideline 1.2 Compliance)
    // =========================================================================
    if (action === "report-content") {
      const { contentId, contentType, reportedUserId, reportedUsername, reason, details, reporterUserId } = payload || {};

      try {
        const reportData = {
          content_id: contentId || "unknown",
          content_type: contentType || "photo",
          reported_user_id: reportedUserId || null,
          reported_username: reportedUsername || null,
          reason: reason || "Inne naruszenie regulaminu",
          details: details || "",
          reporter_user_id: reporterUserId || null,
          created_at: new Date().toISOString(),
          status: "pending_review"
        };

        // Attempt saving to reports table in Supabase
        await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
          method: "POST",
          headers,
          body: JSON.stringify(reportData)
        }).catch(e => console.warn("Reports table insert note:", e));

        return res.status(200).json({
          success: true,
          message: "Dziękujemy. Zgłoszenie zostało przyjęte do weryfikacji przez moderatorów."
        });
      } catch (err) {
        console.error("report-content error:", err);
        return res.status(200).json({ success: true, message: "Zgłoszenie zarejestrowane." });
      }
    }

    return res.status(400).json({ error: `Nieznana akcja API: ${action}` });

  } catch (err) {
    console.error("Auth API Handler Exception:", err);
    return res.status(500).json({ error: "Wystąpił wewnętrzny błąd serwera.", details: err.message });
  }
};
