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

-- Seed service catalog exactly once for legacy businesses; owners may later remove all services.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS service_defaults_seeded BOOLEAN NOT NULL DEFAULT FALSE;
INSERT INTO catalog_items(business_id,name,kind,price,duration_minutes,price_is_estimate)
SELECT b.id,s.name,'service',s.price,s.duration,TRUE
FROM businesses b
CROSS JOIN LATERAL (
  SELECT * FROM (VALUES
    ('barber','Erkaklar soch turmagi',50000,45),('barber','Fade / skin fade',70000,60),('barber','Soqol tekislash',30000,25),('barber','Kompleks xizmat',90000,75),
    ('dentist','Stomatolog ko‘rigi',80000,30),('dentist','Professional tozalash',250000,60),('dentist','Tish plombalash',200000,60),
    ('clinic','Umumiy shifokor qabuli',100000,30),('clinic','UZI tekshiruvi',150000,30),('clinic','Laboratoriya tahlili',60000,20),
    ('education','Sinov darsi',0,45),('education','Individual dars',100000,60),('education','Guruh darsi',50000,90),
    ('restaurant','Stol bron qilish',0,60),('restaurant','Banket uchun konsultatsiya',0,30),
    ('retail','Mahsulot konsultatsiyasi',0,20),('retail','Buyurtmani olib ketish',0,15),
    ('auto_service','Kompyuter diagnostikasi',120000,30),('auto_service','Moy almashtirish',150000,45),('auto_service','Umumiy ko‘rik',100000,40),
    ('other','Konsultatsiya',50000,30),('other','Asosiy xizmat',100000,60)
  ) AS x(category,name,price,duration)
) s
WHERE b.category=s.category AND b.service_defaults_seeded=FALSE
AND NOT EXISTS(SELECT 1 FROM catalog_items ci WHERE ci.business_id=b.id AND ci.kind='service');
UPDATE businesses SET service_defaults_seeded=TRUE WHERE service_defaults_seeded=FALSE;


-- Employee profiles and reversible deactivation.
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS photo_url TEXT;
CREATE INDEX IF NOT EXISTS memberships_active_business_idx ON memberships(business_id,active);


-- Team invitations, staff schedules, assigned bookings and verified reviews.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS staff_member_id UUID REFERENCES memberships(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS appointments_staff_time_idx ON appointments(staff_member_id,starts_at) WHERE staff_member_id IS NOT NULL AND status NOT IN ('cancelled','rejected');
CREATE TABLE IF NOT EXISTS team_invites (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 invited_by UUID NOT NULL REFERENCES users(id),
 expires_at TIMESTAMPTZ NOT NULL,
 claimed_by UUID REFERENCES users(id),
 claimed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS team_invites_business_idx ON team_invites(business_id,created_at DESC);
CREATE TABLE IF NOT EXISTS staff_schedules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
 weekday SMALLINT NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 start_time TIME,
 end_time TIME,
 day_off BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(membership_id,weekday),
 CHECK(day_off OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time>start_time))
);
CREATE TABLE IF NOT EXISTS staff_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 appointment_id UUID NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
 business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
 membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
 customer_telegram_id BIGINT NOT NULL,
 rating SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT CHECK(comment IS NULL OR length(comment)<=1000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS staff_reviews_member_idx ON staff_reviews(membership_id,created_at DESC);

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS specialty TEXT;
