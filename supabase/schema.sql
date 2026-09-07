-- ==========================================================================
-- ILE KOSZTUJE PIWO - SUPABASE DATABASE SCHEMA
-- PostgreSQL + PostGIS (Spatial indexing for Warsaw nightlife map)
-- ==========================================================================

-- 1. Enable PostGIS Extension for GPS radius queries
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Venues Table (Bars, Pubs, Multitaps)
CREATE TABLE IF NOT EXISTS public.venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    osm_id TEXT UNIQUE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    district TEXT NOT NULL, -- e.g. "Śródmieście", "Pawilony", "Praga Północ"
    address TEXT NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    geom GEOMETRY(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED,
    
    -- Pricing Metrics
    beer_name TEXT DEFAULT 'Piwo z kranu',
    beer_price_pln NUMERIC(5, 2) NOT NULL,
    beer_size_ml INT DEFAULT 500,
    shot_price_pln NUMERIC(5, 2), -- vodka/shot price in PLN
    
    -- Attributes & Nightlife Info
    is_craft BOOLEAN DEFAULT FALSE,
    happy_hour TEXT,
    hours TEXT DEFAULT '16:00 - 02:00',
    is_verified BOOLEAN DEFAULT FALSE,
    votes_confirm INT DEFAULT 1,
    photo_url TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Price Updates & Community Submissions Audit Log
CREATE TABLE IF NOT EXISTS public.price_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
    reported_beer_name TEXT NOT NULL,
    reported_price_pln NUMERIC(5, 2) NOT NULL,
    reported_shot_pln NUMERIC(5, 2),
    happy_hour_info TEXT,
    proof_image_url TEXT, -- receipt or chalkboard photo in Supabase Storage
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Fast Spatial & Text Indexes
CREATE INDEX IF NOT EXISTS idx_venues_geom ON public.venues USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_venues_district ON public.venues(district);
CREATE INDEX IF NOT EXISTS idx_venues_price ON public.venues(beer_price_pln);
CREATE INDEX IF NOT EXISTS idx_venues_name ON public.venues(name);

-- 5. RPC Function: Find bars within X meters of user GPS
CREATE OR REPLACE FUNCTION public.nearby_venues(
    user_lat DOUBLE PRECISION,
    user_lng DOUBLE PRECISION,
    radius_meters INT DEFAULT 1500
)
RETURNS SETOF public.venues
LANGUAGE sql STABLE
AS $$
    SELECT *
    FROM public.venues
    WHERE ST_DWithin(
        geom::geography,
        ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
        radius_meters
    )
    ORDER BY beer_price_pln ASC;
$$;

-- 6. Row Level Security (RLS)
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_reports ENABLE ROW LEVEL SECURITY;

-- Allow public read access to all venues
CREATE POLICY "Allow public read access to venues" 
ON public.venues FOR SELECT 
USING (true);

-- Allow anonymous users to submit price reports
CREATE POLICY "Allow public insert into price_reports" 
ON public.price_reports FOR INSERT 
WITH CHECK (true);

-- Allow public insert to venues (for adding new unverified bars)
CREATE POLICY "Allow public insert new unverified venues"
ON public.venues FOR INSERT
WITH CHECK (is_verified = false);
