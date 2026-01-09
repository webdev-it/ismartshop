-- PostgreSQL schema for iSmartShop
-- Run these statements once when DATABASE_URL is configured.

-- Ensure pgcrypto extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT,
  verified BOOLEAN DEFAULT FALSE,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Pending verifications (mirror of file-based pending_verifications.json)
CREATE TABLE IF NOT EXISTS pending_verifications (
  email TEXT PRIMARY KEY,
  name TEXT,
  password_hash TEXT,
  code TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Threads / Conversations (one thread per user-product or user support chat)
CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id TEXT,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Messages belonging to threads
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID REFERENCES threads(id) ON DELETE CASCADE,
  from_role TEXT NOT NULL, -- 'user' or 'admin'
  text TEXT NOT NULL,
  user_id UUID, -- optional redundancy for quick lookup
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Favorites (user saved product ids)
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, product_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_threads_user_id ON threads(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);

-- Products table (optional): used when backend runs in DB mode. id is TEXT to be compatible with existing file-based ids.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  title TEXT,
  price TEXT,
  image TEXT,
  category TEXT,
  description TEXT,
  colors JSONB,
  status TEXT DEFAULT 'approved',
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
