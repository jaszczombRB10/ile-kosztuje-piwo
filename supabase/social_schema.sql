-- ==========================================================================
-- ILE KOSZTUJE PIWO - SOCIAL SCHEMA (Profiles, Check-ins, Follows)
-- "Untappd + Strava dla Warszawy"
-- ==========================================================================

-- 1. Tabela publicznych profili użytkowników
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    avatar_icon TEXT DEFAULT '🍺' NOT NULL,
    bio TEXT DEFAULT '',
    favorite_beer TEXT DEFAULT '',
    favorite_district TEXT DEFAULT '',
    visited_venues JSONB DEFAULT '[]'::jsonb NOT NULL,
    favorite_venues JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Walidacja formatu username: 3-20 znaków alfanumerycznych oraz podkreślenie
ALTER TABLE public.profiles 
    DROP CONSTRAINT IF EXISTS username_format_check;

ALTER TABLE public.profiles 
    ADD CONSTRAINT username_format_check 
    CHECK (username ~* '^[a-z0-9_]{3,20}$');

-- 2. Tabela aktywności / check-inów (Anonimowy puls cen w mieście)
CREATE TABLE IF NOT EXISTS public.user_checkins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    venue_id TEXT NOT NULL,
    venue_name TEXT NOT NULL,
    district TEXT NOT NULL,
    beer_name TEXT DEFAULT 'Piwo z kranu',
    beer_price NUMERIC(5, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Upewnij się, że user_id może być NULL (pełna anonimizacja)
ALTER TABLE public.user_checkins ALTER COLUMN user_id DROP NOT NULL;

-- 3. Tabela znajomych / obserwowanych (Relacje społecznościowe)
CREATE TABLE IF NOT EXISTS public.follows (
    follower_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

-- 4. Indeksy dla maksymalnej wydajności wyszukiwania i feedu
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles(username);
CREATE INDEX IF NOT EXISTS idx_profiles_display_name ON public.profiles(display_name);
CREATE INDEX IF NOT EXISTS idx_checkins_user_id ON public.user_checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_checkins_created_at ON public.user_checkins(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON public.follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON public.follows(following_id);

-- 5. Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;

-- Reguły dla profiles
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Public profiles are viewable by everyone" 
ON public.profiles FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" 
ON public.profiles FOR INSERT 
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" 
ON public.profiles FOR UPDATE 
USING (auth.uid() = id);

-- Reguły dla user_checkins
DROP POLICY IF EXISTS "Checkins are viewable by everyone" ON public.user_checkins;
CREATE POLICY "Checkins are viewable by everyone" 
ON public.user_checkins FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Users can insert their own checkins" ON public.user_checkins;
DROP POLICY IF EXISTS "Checkins can be inserted anonymously or by users" ON public.user_checkins;
CREATE POLICY "Checkins can be inserted anonymously or by users" 
ON public.user_checkins FOR INSERT 
WITH CHECK (true);

DROP POLICY IF EXISTS "Users can delete their own checkins" ON public.user_checkins;
CREATE POLICY "Users can delete their own checkins" 
ON public.user_checkins FOR DELETE 
USING (auth.uid() = user_id);

-- Reguły dla follows
DROP POLICY IF EXISTS "Follows are viewable by everyone" ON public.follows;
CREATE POLICY "Follows are viewable by everyone" 
ON public.follows FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Users can follow others" ON public.follows;
CREATE POLICY "Users can follow others" 
ON public.follows FOR INSERT 
WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Users can unfollow" ON public.follows;
CREATE POLICY "Users can unfollow" 
ON public.follows FOR DELETE 
USING (auth.uid() = follower_id);

-- 6. Trigger do automatycznego tworzenia profilu przy rejestracji w auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  desired_username TEXT;
  clean_username TEXT;
  chosen_display_name TEXT;
  chosen_avatar TEXT;
  counter INT := 0;
  final_username TEXT;
BEGIN
  desired_username := COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1));
  -- Oczyść do dozwolonych znaków
  clean_username := lower(regexp_replace(desired_username, '[^a-zA-Z0-9_]', '', 'g'));
  IF length(clean_username) < 3 THEN
    clean_username := 'piwosz_' || substr(md5(random()::text), 1, 4);
  END IF;

  final_username := clean_username;
  -- Zapewnij unikalność
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = final_username) LOOP
    counter := counter + 1;
    final_username := clean_username || counter;
  END LOOP;

  chosen_display_name := COALESCE(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1));
  chosen_avatar := COALESCE(new.raw_user_meta_data->>'avatar_icon', '🍺');

  INSERT INTO public.profiles (id, username, display_name, avatar_icon, bio)
  VALUES (
    new.id,
    final_username,
    chosen_display_name,
    chosen_avatar,
    'Warszawski poszukiwacz dobrego i taniego piwa 🍻'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
