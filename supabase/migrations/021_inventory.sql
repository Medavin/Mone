-- =====================================================================
-- MOne — Migration 021: inventory
-- Run after 020. Paste in THREE blocks.
-- =====================================================================
--
-- TWO KINDS OF THING, AND THEY DO NOT BEHAVE THE SAME
--
--   * A LAPTOP is one object with a serial number. It is either with
--     somebody or it is not, and the question asked about it is "who has
--     it" — which means its history matters.
--
--   * HEADSETS are a quantity. Nobody asks who has headset number seven;
--     they ask how many are left.
--
-- Most inventory systems force both into one shape and then either carry a
-- meaningless serial on every box of pens, or lose the ability to say who
-- is holding the good laptop. So `is_consumable` decides which questions
-- the row answers, and the UI asks accordingly.
--
-- ⚠ ASSIGNMENT IS A HISTORY, NOT A COLUMN. "assigned_to" on the item would
-- answer who has it now and destroy the answer to who had it in March —
-- which is the question actually asked when something goes missing.
-- =====================================================================


-- =====================================================================
-- BLOCK 1 of 3 — the things
-- =====================================================================

create table if not exists inventory_items (
  id           bigserial primary key,

  name         text not null,
  category     text not null default 'other'
               check (category in ('laptop','desktop','monitor','headset','phone',
                                   'network','furniture','licence','stationery','other')),
  brand        text,
  model        text,
  serial_no    text,

  -- What is written on the sticker. Unique where present, so two people
  -- cannot label two machines the same and then disagree about which broke.
  asset_tag    text,

  is_consumable boolean not null default false,
  quantity      integer not null default 1 check (quantity >= 0),
  reorder_at    integer,                 -- warn below this, for consumables

  status       text not null default 'in_stock'
               check (status in ('in_stock','assigned','repair','retired','lost')),
  condition    text check (condition in ('new','good','fair','poor')),

  location     text,                     -- office, region, or a room
  purchased_on date,
  cost         numeric(12,2),
  warranty_until date,
  supplier     text,
  note         text,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists inventory_asset_tag
  on inventory_items (asset_tag) where asset_tag is not null;

create index if not exists inventory_status on inventory_items (status, category);


-- =====================================================================
-- BLOCK 2 of 3 — who has it, and who had it
-- =====================================================================

create table if not exists inventory_assignments (
  id          bigserial primary key,
  item_id     bigint not null references inventory_items(id) on delete cascade,

  -- Either a login or an employee record. An employee exists before they
  -- have a login, and equipment is issued on the first day, not on the day
  -- IT gets round to the account.
  profile_id  uuid   references profiles(id) on delete set null,
  employee_id bigint references employees(id) on delete set null,
  holder_name text,                       -- for anyone who is neither

  quantity    integer not null default 1 check (quantity > 0),
  issued_on   date not null default current_date,
  returned_on date,
  issued_by   uuid references profiles(id),
  note        text,
  created_at  timestamptz not null default now(),

  check (returned_on is null or returned_on >= issued_on)
);

create index if not exists inv_assign_item on inventory_assignments (item_id, issued_on desc);
create index if not exists inv_assign_who  on inventory_assignments (profile_id);

-- One open assignment per NON-consumable item. A laptop cannot be with two
-- people at once, and the database should refuse it rather than the screen
-- showing it twice. Consumables are excluded because several people can
-- each hold three headsets at the same time.
create unique index if not exists inv_assign_one_open
  on inventory_assignments (item_id)
  where returned_on is null
    and exists (select 1 from inventory_items i
                 where i.id = item_id and not i.is_consumable);


-- =====================================================================
-- BLOCK 3 of 3 — row level security
-- =====================================================================
-- Everyone can see the inventory: knowing there are three spare monitors is
-- not sensitive, and hiding it just means somebody buys a fourth. Only
-- management changes it.

alter table inventory_items       enable row level security;
alter table inventory_assignments enable row level security;

drop policy if exists inv_items_read  on inventory_items;
drop policy if exists inv_items_write on inventory_items;
create policy inv_items_read  on inventory_items for select using (auth.uid() is not null);
create policy inv_items_write on inventory_items for all using (is_admin()) with check (is_admin());

drop policy if exists inv_assign_read  on inventory_assignments;
drop policy if exists inv_assign_write on inventory_assignments;
create policy inv_assign_read on inventory_assignments for select
  using (auth.uid() is not null);
create policy inv_assign_write on inventory_assignments for all
  using (is_admin()) with check (is_admin());


-- =====================================================================
-- VERIFY — run separately
-- =====================================================================
-- select tablename, policyname from pg_policies
--  where tablename like 'inventory%' order by tablename;      -- 4 rows
