-- =====================================================================
-- RIVO — Phase 1 Database Schema (PostgreSQL)
--
-- Conventions:
--   - Surrogate PKs: uuid, generated with gen_random_uuid() (pgcrypto).
--   - created_at / updated_at on every table.
--   - deleted_at (soft delete) on user-facing / record-of-truth tables.
--   - Money stored as numeric(12,2) in the row's currency_code.
--   - Coordinates stored as plain double precision lat/lng for portability;
--     add PostGIS + a `geography(Point,4326)` generated column and GIST
--     index in production for radius queries (see comment at bottom).
--   - Status fields are Postgres ENUMs for integrity; add new values with
--     ALTER TYPE ... ADD VALUE rather than widening to free text.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
CREATE TYPE user_role            AS ENUM ('passenger', 'driver', 'admin');
CREATE TYPE user_status          AS ENUM ('active', 'suspended', 'banned', 'pending_verification');
CREATE TYPE city_status          AS ENUM ('planned', 'launching', 'live', 'paused');
CREATE TYPE verification_status  AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE doc_type             AS ENUM ('national_id', 'driving_license', 'vehicle_registration', 'insurance', 'route_permit', 'profile_photo', 'vehicle_photo_front', 'vehicle_photo_back', 'vehicle_photo_side', 'vehicle_photo_interior');
CREATE TYPE vehicle_status       AS ENUM ('pending', 'active', 'inactive', 'rejected');
CREATE TYPE availability_status  AS ENUM ('offline', 'online', 'on_trip');
CREATE TYPE booking_mode         AS ENUM ('quick_match', 'competitive_offer');
CREATE TYPE ride_request_status  AS ENUM ('searching', 'offers_open', 'booked', 'expired', 'cancelled');
CREATE TYPE ride_offer_status    AS ENUM ('pending', 'accepted', 'declined', 'expired', 'withdrawn');
CREATE TYPE counter_offer_status AS ENUM ('pending', 'accepted', 'expired', 'withdrawn');
CREATE TYPE ride_status          AS ENUM ('accepted', 'driver_en_route', 'arrived', 'in_progress', 'completed', 'cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_system');
CREATE TYPE payment_method       AS ENUM ('cash', 'card', 'wallet', 'local_provider');
CREATE TYPE payment_status       AS ENUM ('pending', 'authorized', 'captured', 'failed', 'refunded');
CREATE TYPE transaction_type     AS ENUM ('ride_charge', 'ride_payout', 'commission', 'wallet_topup', 'withdrawal', 'promo_credit', 'adjustment', 'refund');
CREATE TYPE notification_type    AS ENUM ('ride_update', 'offer_update', 'promo', 'system', 'safety');
CREATE TYPE discount_type        AS ENUM ('percentage', 'flat');
CREATE TYPE ticket_status        AS ENUM ('open', 'in_progress', 'resolved', 'closed');
CREATE TYPE ticket_priority      AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE dispute_status       AS ENUM ('open', 'under_review', 'resolved', 'rejected');
CREATE TYPE safety_event_type    AS ENUM ('sos', 'trip_shared', 'report_filed', 'suspicious_activity', 'ride_deviation');
CREATE TYPE safety_severity      AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE admin_role           AS ENUM ('super_admin', 'ops_manager', 'support_agent', 'finance', 'safety_officer', 'read_only');

-- ---------------------------------------------------------------------
-- Geography: countries -> cities -> service zones
-- ---------------------------------------------------------------------
CREATE TABLE countries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    iso_code        char(2) NOT NULL UNIQUE,
    default_currency_code char(3) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cities (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    country_id      uuid NOT NULL REFERENCES countries(id),
    name            text NOT NULL,
    status          city_status NOT NULL DEFAULT 'planned',
    currency_code   char(3) NOT NULL,
    timezone        text NOT NULL,
    center_lat      double precision,
    center_lng      double precision,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (country_id, name)
);
CREATE INDEX idx_cities_country ON cities(country_id);
CREATE INDEX idx_cities_status  ON cities(status) WHERE deleted_at IS NULL;

CREATE TABLE service_zones (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id         uuid NOT NULL REFERENCES cities(id),
    name            text NOT NULL,
    -- boundary as an ordered ring of lat/lng vertices; swap for
    -- geometry(Polygon,4326) if PostGIS is enabled.
    boundary_geojson jsonb NOT NULL,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (city_id, name)
);
CREATE INDEX idx_service_zones_city ON service_zones(city_id) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------
-- Vehicle types (data-driven, per product brief)
-- ---------------------------------------------------------------------
CREATE TABLE vehicle_types (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL UNIQUE,          -- 'bike' | 'rickshaw' | 'economy' | 'standard' | 'premium'
    name            text NOT NULL,
    capacity        smallint NOT NULL DEFAULT 4,
    sort_order      smallint NOT NULL DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- which vehicle types are enabled in which city
CREATE TABLE city_vehicle_types (
    city_id         uuid NOT NULL REFERENCES cities(id),
    vehicle_type_id uuid NOT NULL REFERENCES vehicle_types(id),
    is_active       boolean NOT NULL DEFAULT true,
    PRIMARY KEY (city_id, vehicle_type_id)
);

-- ---------------------------------------------------------------------
-- Users & profiles
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone           text NOT NULL UNIQUE,
    email           text UNIQUE,
    password_hash   text,                          -- null for OTP-only accounts
    full_name       text NOT NULL,
    photo_url       text,
    role            user_role NOT NULL,
    status          user_status NOT NULL DEFAULT 'pending_verification',
    primary_city_id uuid REFERENCES cities(id),
    locale          text NOT NULL DEFAULT 'en',
    phone_verified_at timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
CREATE INDEX idx_users_role_status ON users(role, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_city ON users(primary_city_id) WHERE deleted_at IS NULL;

CREATE TABLE passenger_profiles (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL UNIQUE REFERENCES users(id),
    completed_rides     integer NOT NULL DEFAULT 0,
    cancelled_rides     integer NOT NULL DEFAULT 0,
    rating_avg          numeric(3,2) NOT NULL DEFAULT 5.00,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_profiles (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL UNIQUE REFERENCES users(id),
    city_id             uuid NOT NULL REFERENCES cities(id),
    verification_status verification_status NOT NULL DEFAULT 'pending',
    availability_status availability_status NOT NULL DEFAULT 'offline',
    license_number      text,
    license_expiry      date,
    completed_rides     integer NOT NULL DEFAULT 0,
    cancelled_rides     integer NOT NULL DEFAULT 0,
    rating_avg          numeric(3,2) NOT NULL DEFAULT 5.00,
    acceptance_rate     numeric(5,2) NOT NULL DEFAULT 100.00,
    cancellation_rate   numeric(5,2) NOT NULL DEFAULT 0.00,
    last_lat            double precision,
    last_lng            double precision,
    last_location_at    timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    deleted_at          timestamptz
);
CREATE INDEX idx_driver_profiles_city_status ON driver_profiles(city_id, availability_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_driver_profiles_verification ON driver_profiles(verification_status) WHERE deleted_at IS NULL;

CREATE TABLE driver_documents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id       uuid NOT NULL REFERENCES driver_profiles(id),
    doc_type        doc_type NOT NULL,
    file_url        text NOT NULL,
    status          verification_status NOT NULL DEFAULT 'pending',
    reviewed_by     uuid REFERENCES users(id),      -- admin user
    reviewed_at     timestamptz,
    rejection_reason text,
    expires_at      date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_driver_documents_driver ON driver_documents(driver_id);
CREATE INDEX idx_driver_documents_status ON driver_documents(status);

-- ---------------------------------------------------------------------
-- Vehicles
-- ---------------------------------------------------------------------
CREATE TABLE vehicles (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id       uuid NOT NULL REFERENCES driver_profiles(id),
    vehicle_type_id uuid NOT NULL REFERENCES vehicle_types(id),
    make            text NOT NULL,
    model           text NOT NULL,
    year            smallint,
    color           text,
    plate_number    text NOT NULL,
    status          vehicle_status NOT NULL DEFAULT 'pending',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,
    UNIQUE (plate_number)
);
CREATE INDEX idx_vehicles_driver ON vehicles(driver_id) WHERE deleted_at IS NULL;

CREATE TABLE vehicle_documents (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
    doc_type        doc_type NOT NULL,
    file_url        text NOT NULL,
    status          verification_status NOT NULL DEFAULT 'pending',
    reviewed_by     uuid REFERENCES users(id),
    reviewed_at     timestamptz,
    expires_at      date,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vehicle_documents_vehicle ON vehicle_documents(vehicle_id);

-- ---------------------------------------------------------------------
-- Saved / normalized locations
-- ---------------------------------------------------------------------
CREATE TABLE locations (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid REFERENCES users(id),      -- null for ad-hoc pickup/destination points
    label           text,                            -- 'Home' | 'Work' | null
    address         text NOT NULL,
    lat             double precision NOT NULL,
    lng             double precision NOT NULL,
    is_saved        boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);
CREATE INDEX idx_locations_user ON locations(user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_locations_lat_lng ON locations(lat, lng);

-- ---------------------------------------------------------------------
-- Fare engine configuration (admin-configurable, per city/zone/vehicle)
-- ---------------------------------------------------------------------
CREATE TABLE fare_rules (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    city_id             uuid NOT NULL REFERENCES cities(id),
    zone_id             uuid REFERENCES service_zones(id),  -- null = city-wide default
    vehicle_type_id     uuid NOT NULL REFERENCES vehicle_types(id),
    base_fare           numeric(10,2) NOT NULL,
    per_km_rate         numeric(10,2) NOT NULL,
    per_min_rate        numeric(10,2) NOT NULL,
    minimum_fare        numeric(10,2) NOT NULL,
    maximum_fare        numeric(10,2),
    commission_rate     numeric(5,4) NOT NULL,        -- e.g. 0.1500 = 15%
    surge_min_multiplier numeric(4,2) NOT NULL DEFAULT 1.00,
    surge_max_multiplier numeric(4,2) NOT NULL DEFAULT 2.50,
    is_active           boolean NOT NULL DEFAULT true,
    effective_from      timestamptz NOT NULL DEFAULT now(),
    effective_to        timestamptz,
    created_by          uuid REFERENCES users(id),     -- admin user
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fare_rules_lookup ON fare_rules(city_id, vehicle_type_id, zone_id) WHERE is_active = true;

-- ---------------------------------------------------------------------
-- Ride requests, offers, counter-offers (the marketplace core)
-- ---------------------------------------------------------------------
CREATE TABLE ride_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    passenger_id        uuid NOT NULL REFERENCES passenger_profiles(id),
    city_id             uuid NOT NULL REFERENCES cities(id),
    zone_id             uuid REFERENCES service_zones(id),
    vehicle_type_id     uuid NOT NULL REFERENCES vehicle_types(id),
    pickup_location_id  uuid NOT NULL REFERENCES locations(id),
    destination_location_id uuid NOT NULL REFERENCES locations(id),
    booking_mode        booking_mode NOT NULL,
    suggested_fare      numeric(10,2) NOT NULL,        -- Fare Engine output at request time
    proposed_fare       numeric(10,2) NOT NULL,        -- = suggested_fare for quick_match
    distance_km         numeric(7,2),
    est_duration_min    integer,
    payment_method      payment_method NOT NULL DEFAULT 'cash',
    status               ride_request_status NOT NULL DEFAULT 'searching',
    expires_at           timestamptz NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ride_requests_passenger ON ride_requests(passenger_id);
CREATE INDEX idx_ride_requests_status_city ON ride_requests(city_id, status);
CREATE INDEX idx_ride_requests_expires ON ride_requests(expires_at) WHERE status IN ('searching','offers_open');

CREATE TABLE ride_offers (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_request_id     uuid NOT NULL REFERENCES ride_requests(id),
    driver_id           uuid NOT NULL REFERENCES driver_profiles(id),
    vehicle_id          uuid NOT NULL REFERENCES vehicles(id),
    offer_price         numeric(10,2) NOT NULL,        -- = proposed_fare if a straight accept
    eta_min             integer NOT NULL,
    distance_km         numeric(7,2) NOT NULL,
    status              ride_offer_status NOT NULL DEFAULT 'pending',
    expires_at          timestamptz NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ride_request_id, driver_id)
);
CREATE INDEX idx_ride_offers_request ON ride_offers(ride_request_id, status);
CREATE INDEX idx_ride_offers_driver ON ride_offers(driver_id, status);

CREATE TABLE counter_offers (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_offer_id       uuid NOT NULL REFERENCES ride_offers(id),
    counter_price       numeric(10,2) NOT NULL,
    status              counter_offer_status NOT NULL DEFAULT 'pending',
    expires_at          timestamptz NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_counter_offers_offer ON counter_offers(ride_offer_id, status);
CREATE INDEX idx_counter_offers_expires ON counter_offers(expires_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- Rides (booked, in-progress, completed)
-- ---------------------------------------------------------------------
CREATE TABLE rides (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_request_id     uuid NOT NULL UNIQUE REFERENCES ride_requests(id),
    ride_offer_id       uuid REFERENCES ride_offers(id),
    passenger_id        uuid NOT NULL REFERENCES passenger_profiles(id),
    driver_id           uuid NOT NULL REFERENCES driver_profiles(id),
    vehicle_id          uuid NOT NULL REFERENCES vehicles(id),
    pickup_location_id  uuid NOT NULL REFERENCES locations(id),
    destination_location_id uuid NOT NULL REFERENCES locations(id),
    final_fare          numeric(10,2),
    distance_km         numeric(7,2),
    duration_min         integer,
    status               ride_status NOT NULL DEFAULT 'accepted',
    share_token          text UNIQUE,                 -- for trip-sharing links
    accepted_at          timestamptz NOT NULL DEFAULT now(),
    arrived_at           timestamptz,
    started_at           timestamptz,
    completed_at         timestamptz,
    cancelled_at         timestamptz,
    cancellation_reason  text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rides_passenger ON rides(passenger_id, status);
CREATE INDEX idx_rides_driver ON rides(driver_id, status);
CREATE INDEX idx_rides_status ON rides(status);

CREATE TABLE ride_locations (
    id              bigserial PRIMARY KEY,
    ride_id         uuid NOT NULL REFERENCES rides(id),
    lat             double precision NOT NULL,
    lng             double precision NOT NULL,
    heading         real,
    speed_kmh       real,
    recorded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ride_locations_ride_time ON ride_locations(ride_id, recorded_at);

CREATE TABLE ride_status_history (
    id              bigserial PRIMARY KEY,
    ride_id         uuid NOT NULL REFERENCES rides(id),
    status          ride_status NOT NULL,
    changed_by      uuid REFERENCES users(id),
    note            text,
    changed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ride_status_history_ride ON ride_status_history(ride_id, changed_at);

-- ---------------------------------------------------------------------
-- Payments, wallets, transactions, commissions
-- ---------------------------------------------------------------------
CREATE TABLE promotions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL UNIQUE,
    description     text,
    discount_type   discount_type NOT NULL,
    discount_value  numeric(10,2) NOT NULL,
    max_discount    numeric(10,2),
    city_id         uuid REFERENCES cities(id),        -- null = all cities
    usage_limit     integer,
    usage_count     integer NOT NULL DEFAULT 0,
    starts_at       timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz,
    is_active       boolean NOT NULL DEFAULT true,
    created_by      uuid REFERENCES users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_promotions_active ON promotions(is_active, expires_at);

CREATE TABLE payments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id             uuid NOT NULL UNIQUE REFERENCES rides(id),
    promotion_id        uuid REFERENCES promotions(id),
    method              payment_method NOT NULL,
    status              payment_status NOT NULL DEFAULT 'pending',
    amount              numeric(10,2) NOT NULL,
    discount_amount     numeric(10,2) NOT NULL DEFAULT 0,
    currency_code       char(3) NOT NULL,
    provider_reference  text,                          -- opaque id from the PaymentProvider adapter
    captured_at         timestamptz,
    refunded_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_status ON payments(status);

CREATE TABLE commissions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id      uuid NOT NULL UNIQUE REFERENCES payments(id),
    rate            numeric(5,4) NOT NULL,
    amount          numeric(10,2) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL UNIQUE REFERENCES users(id),
    balance         numeric(12,2) NOT NULL DEFAULT 0,
    currency_code   char(3) NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (balance >= 0)
);

CREATE TABLE transactions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id       uuid NOT NULL REFERENCES wallets(id),
    payment_id      uuid REFERENCES payments(id),
    type            transaction_type NOT NULL,
    amount          numeric(12,2) NOT NULL,           -- signed: positive credit, negative debit
    balance_after   numeric(12,2) NOT NULL,
    description     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_transactions_wallet ON transactions(wallet_id, created_at);

-- ---------------------------------------------------------------------
-- Ratings, reviews, messaging, notifications
-- ---------------------------------------------------------------------
CREATE TABLE ratings (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         uuid NOT NULL REFERENCES rides(id),
    rater_id        uuid NOT NULL REFERENCES users(id),
    ratee_id        uuid NOT NULL REFERENCES users(id),
    score           smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
    tags            text[],
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ride_id, rater_id)
);
CREATE INDEX idx_ratings_ratee ON ratings(ratee_id);

CREATE TABLE reviews (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rating_id       uuid NOT NULL UNIQUE REFERENCES ratings(id),
    comment         text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         uuid NOT NULL REFERENCES rides(id),
    sender_id       uuid NOT NULL REFERENCES users(id),
    body            text NOT NULL,
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_ride ON messages(ride_id, created_at);

CREATE TABLE notifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    type            notification_type NOT NULL,
    title           text NOT NULL,
    body            text,
    data            jsonb,
    read            boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read, created_at DESC);

-- ---------------------------------------------------------------------
-- Support, disputes, safety
-- ---------------------------------------------------------------------
CREATE TABLE support_tickets (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES users(id),
    ride_id             uuid REFERENCES rides(id),
    subject             text NOT NULL,
    description         text,
    status              ticket_status NOT NULL DEFAULT 'open',
    priority            ticket_priority NOT NULL DEFAULT 'medium',
    assigned_admin_id   uuid REFERENCES users(id),
    resolved_at         timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_tickets_status ON support_tickets(status, priority);
CREATE INDEX idx_support_tickets_user ON support_tickets(user_id);

CREATE TABLE disputes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         uuid NOT NULL REFERENCES rides(id),
    raised_by       uuid NOT NULL REFERENCES users(id),
    against_user_id uuid REFERENCES users(id),
    reason          text NOT NULL,
    status          dispute_status NOT NULL DEFAULT 'open',
    resolution      text,
    resolved_by     uuid REFERENCES users(id),
    resolved_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_ride ON disputes(ride_id);

CREATE TABLE safety_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         uuid REFERENCES rides(id),
    user_id         uuid NOT NULL REFERENCES users(id),
    type            safety_event_type NOT NULL,
    severity        safety_severity NOT NULL DEFAULT 'medium',
    details         jsonb,
    lat             double precision,
    lng             double precision,
    resolved_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_safety_events_severity ON safety_events(severity, resolved_at);
CREATE INDEX idx_safety_events_ride ON safety_events(ride_id);

-- ---------------------------------------------------------------------
-- Admin, audit
-- ---------------------------------------------------------------------
CREATE TABLE admin_users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL UNIQUE REFERENCES users(id),
    role            admin_role NOT NULL,
    city_scope      uuid REFERENCES cities(id),        -- null = all cities
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

CREATE TABLE audit_logs (
    id              bigserial PRIMARY KEY,
    admin_id        uuid NOT NULL REFERENCES admin_users(id),
    action          text NOT NULL,                     -- e.g. 'driver.verify.approve'
    target_table    text NOT NULL,
    target_id       uuid,
    before_state     jsonb,
    after_state      jsonb,
    ip_address      inet,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_admin ON audit_logs(admin_id, created_at DESC);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_table, target_id);

-- =====================================================================
-- Production geo note: enable PostGIS and add generated geography
-- columns + GIST indexes for radius/nearest-driver queries, e.g.:
--
--   CREATE EXTENSION IF NOT EXISTS postgis;
--   ALTER TABLE driver_profiles
--     ADD COLUMN last_geog geography(Point,4326)
--     GENERATED ALWAYS AS (ST_MakePoint(last_lng, last_lat)::geography) STORED;
--   CREATE INDEX idx_driver_profiles_geog ON driver_profiles USING GIST (last_geog);
--
-- The Matching Engine's "drivers within radius" query is the primary
-- consumer; until PostGIS is enabled, the same query can run against a
-- Redis Geo index maintained from `driver.location.updated` events
-- (see 06-technical-architecture.md § Real-time system).
-- =====================================================================
