CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  full_name TEXT NOT NULL,
  selected_business_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  phone TEXT,
  currency TEXT NOT NULL DEFAULT 'UZS',
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id)
);

DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_selected_business_fk
  FOREIGN KEY (selected_business_id) REFERENCES businesses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS customers_business_idx ON customers(business_id);

CREATE TABLE IF NOT EXISTS catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'product' CHECK (kind IN ('product','service')),
  price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS catalog_business_idx ON catalog_items(business_id);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','completed','cancelled')),
  due_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS orders_business_date_idx ON orders(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  service_name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','done','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS appointments_business_time_idx ON appointments(business_id, starts_at);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'cash',
  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS payments_business_date_idx ON payments(business_id, paid_at DESC);

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS public_visible BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS businesses_directory_idx ON businesses(public_visible, region, city, category);

ALTER TABLE users ADD COLUMN IF NOT EXISTS account_role TEXT CHECK (account_role IN ('customer','business'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city TEXT;
CREATE INDEX IF NOT EXISTS users_phone_idx ON users(phone);


-- Live customer bookings and service scheduling
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 600);
ALTER TABLE catalog_items ADD COLUMN IF NOT EXISTS price_is_estimate BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES catalog_items(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS customer_telegram_id BIGINT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 5 AND 600);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS appointments_customer_status_idx ON appointments(customer_telegram_id, status);
CREATE INDEX IF NOT EXISTS appointments_business_active_time_idx ON appointments(business_id, starts_at) WHERE status NOT IN ('cancelled','rejected');

-- Booking lifecycle states
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
 CHECK (status IN ('booked','pending','confirmed','rejected','on_way','arrived','done','completed','cancelled'));
