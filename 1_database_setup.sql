-- Sterling Engineering payroll: database setup for Supabase
-- Paste this whole file into Supabase > SQL Editor and press Run. Safe to run more than once:
-- running it again after an update adds what is new and keeps all your data.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'owner')),
  name text
);

create table if not exists public.sites (
  id uuid primary key,
  name text not null,
  parent_id uuid references public.sites (id),
  active boolean not null default true,
  sort int default 0
);

create table if not exists public.employees (
  id uuid primary key,
  emp_code text,
  name text not null,
  designation text,
  site_id uuid references public.sites (id),
  rate_type text default 'daily',
  rate numeric,
  ot_rate numeric,
  pay_method text,
  bank text,
  account_no text,
  account_title text,
  paid_through uuid references public.employees (id),
  active boolean not null default true,
  notes text,
  updated_at timestamptz default now()
);

create table if not exists public.runs (
  id uuid primary key,
  site_id uuid references public.sites (id),
  label text,
  date_from date,
  date_to date,
  status text not null default 'open',
  paid_on date,
  note text,
  created_at timestamptz default now()
);

create table if not exists public.run_lines (
  id uuid primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  employee_id uuid references public.employees (id),
  days numeric,
  rate numeric,
  days_amount numeric,
  ot_hours numeric,
  ot_rate numeric,
  ot_amount numeric,
  allowances numeric,
  advance numeric,
  deductions numeric,
  net_override numeric,
  note text
);

create table if not exists public.advances (
  id uuid primary key,
  employee_id uuid references public.employees (id),
  given_on date,
  amount numeric,
  note text
);

-- Part payment: each salary line has its own paid date.
alter table public.run_lines add column if not exists paid_on date;
update public.run_lines l set paid_on = coalesce(r.paid_on, current_date)
  from public.runs r where l.run_id = r.id and r.status = 'paid' and l.paid_on is null;

-- Change history: who changed what, and when. Rows can be added and read, never edited or deleted.
create table if not exists public.changes (
  id uuid primary key,
  at timestamptz not null default now(),
  who text default (auth.jwt() ->> 'email'),
  table_name text,
  row_id uuid,
  subject text,
  field text,
  old_value text,
  new_value text
);
create index if not exists changes_at_idx on public.changes (at desc);

create index if not exists run_lines_run_idx on public.run_lines (run_id);
create index if not exists employees_site_idx on public.employees (site_id);
create index if not exists run_lines_employee_idx on public.run_lines (employee_id);
create index if not exists runs_site_idx on public.runs (site_id, date_to);
create index if not exists advances_employee_idx on public.advances (employee_id);

-- One small row that changes whenever any data changes. Open screens check it instead of
-- downloading everything again, which keeps the system fast and data use low as it grows.
create table if not exists public.sync_state (id int primary key, stamp timestamptz not null default now());
insert into public.sync_state (id) values (1) on conflict (id) do nothing;
create or replace function public.touch_sync() returns trigger
language plpgsql security definer set search_path = public as
$$ begin update public.sync_state set stamp = clock_timestamp() where id = 1; return null; end $$;

-- Who is allowed to do what
create or replace function public.has_access() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid()) $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

alter table public.profiles enable row level security;
drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated using (id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['sites', 'employees', 'runs', 'run_lines', 'advances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_access())', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_admin())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_admin())', t || '_delete', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sites', 'employees', 'runs', 'run_lines', 'advances'] loop
    execute format('drop trigger if exists touch_sync on public.%I', t);
    execute format('create trigger touch_sync after insert or update or delete on public.%I for each statement execute function public.touch_sync()', t);
  end loop;
end $$;
alter table public.sync_state enable row level security;
drop policy if exists sync_state_read on public.sync_state;
create policy sync_state_read on public.sync_state for select to authenticated using (public.has_access());

alter table public.changes enable row level security;
drop policy if exists changes_read on public.changes;
drop policy if exists changes_insert on public.changes;
create policy changes_read on public.changes for select to authenticated using (public.has_access());
create policy changes_insert on public.changes for insert to authenticated with check (public.is_admin());

-- AFTER you create the users in Supabase > Authentication > Users, give them a role.
-- Change the emails, remove the two dashes at the start of each line, and run:
--
-- insert into public.profiles (id, role, name)
--   select id, 'admin', 'Accountant' from auth.users where email = 'YOUR-EMAIL-HERE'
--   on conflict (id) do update set role = excluded.role;
--
-- insert into public.profiles (id, role, name)
--   select id, 'owner', 'Owner' from auth.users where email = 'OWNER-EMAIL-HERE'
--   on conflict (id) do update set role = excluded.role;

-- =====================================================================================
-- HR, ATTENDANCE AND LETTERS (version 11). Added on top of payroll; payroll data is kept.
-- Roles: admin (accountant, everything), owner (view only), hr (people, attendance, letters),
--        site (attendance takers: mark today's attendance for their own sites, nothing else).
-- =====================================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'accountant', 'owner', 'hr', 'site', 'procurement'));
alter table public.profiles add column if not exists site_ids uuid[] not null default '{}';
alter table public.profiles add column if not exists active boolean not null default true;

-- Site logins and procurement never read the payroll tables. Admin, accountant, owner and HR do.
create or replace function public.has_access() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'accountant', 'owner', 'hr')) $$;

-- "is_admin" is the payroll permission: the admin and the accountant can change payroll, employees' pay and bank details.
-- Logins, HR letters, attendance changes and procurement are checked separately and exclude the accountant.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'accountant')) $$;

-- the whole system: logins and settings
create or replace function public.is_sysadmin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin') $$;

-- who may read HR letters
create or replace function public.hr_view() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'owner', 'hr')) $$;

create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'hr')) $$;

-- Employee record: HR details
alter table public.employees add column if not exists father_name text;
alter table public.employees add column if not exists gender text;
alter table public.employees add column if not exists cnic text;
alter table public.employees add column if not exists phone text;
alter table public.employees add column if not exists department text;
alter table public.employees add column if not exists employment_type text;
alter table public.employees add column if not exists joining_date date;
alter table public.employees add column if not exists leaving_date date;
alter table public.employees add column if not exists leaving_reason text;
alter table public.employees add column if not exists address text;
alter table public.employees add column if not exists emergency_contact text;

-- HR may add and edit employees, but pay and bank details stay with the accountant.
drop policy if exists employees_insert on public.employees;
drop policy if exists employees_update on public.employees;
create policy employees_insert on public.employees for insert to authenticated with check (public.is_hr() or public.is_admin());
create policy employees_update on public.employees for update to authenticated using (public.is_hr() or public.is_admin()) with check (public.is_hr() or public.is_admin());
create or replace function public.employees_guard() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.rate is not null or new.ot_rate is not null or new.account_no is not null or new.account_title is not null
       or new.bank is not null or new.paid_through is not null or coalesce(new.pay_method, '') <> '' then
      raise exception 'Only the accountant can set pay and bank details';
    end if;
  elsif (new.rate, new.ot_rate, new.rate_type, new.pay_method, new.bank, new.account_no, new.account_title, new.paid_through)
        is distinct from (old.rate, old.ot_rate, old.rate_type, old.pay_method, old.bank, old.account_no, old.account_title, old.paid_through) then
    raise exception 'Only the accountant can change pay and bank details';
  end if;
  return new;
end $$;
drop trigger if exists employees_guard on public.employees;
create trigger employees_guard before insert or update on public.employees for each row execute function public.employees_guard();

-- Settings HR can change: whether site logins may correct today's marks, and who signs letters.
create table if not exists public.app_settings (key text primary key, value jsonb);
insert into public.app_settings (key, value) values
  ('site_same_day_edit', 'true'::jsonb),
  ('signatory', '{"name": "Sidra Usman", "title": "HR Manager"}'::jsonb)
on conflict (key) do nothing;

-- Attendance: one mark per employee per day. P present, H half day, A absent, L leave, OT present with overtime hours.
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  site_id uuid references public.sites (id),
  day date not null,
  status text not null check (status in ('P', 'A', 'L', 'OT')),
  ot_hours numeric,
  note text,
  marked_by uuid default auth.uid(),
  marked_by_name text,
  marked_at timestamptz not null default now(),
  source text not null default 'site',
  unique (employee_id, day)
);
-- H = half day (counts as half a day in salary)
alter table public.attendance drop constraint if exists attendance_status_check;
alter table public.attendance add constraint attendance_status_check check (status in ('P', 'H', 'A', 'L', 'OT'));
create index if not exists attendance_day_idx on public.attendance (day);
create index if not exists attendance_site_day_idx on public.attendance (site_id, day);

-- Every mark and every correction is written here by the database itself. Nobody can edit or delete it.
create table if not exists public.attendance_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  who text,
  employee_id uuid,
  day date,
  action text,
  old_status text,
  new_status text,
  old_ot numeric,
  new_ot numeric,
  source text
);
create index if not exists attendance_log_at_idx on public.attendance_log (at desc);
create or replace function public.attendance_audit() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if tg_op = 'DELETE' then
    insert into public.attendance_log (who, employee_id, day, action, old_status, old_ot, source)
      values (coalesce(auth.jwt() ->> 'email', 'system'), old.employee_id, old.day, 'Cleared', old.status, old.ot_hours, 'hr');
    return old;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status and new.ot_hours is not distinct from old.ot_hours then return new; end if;
  insert into public.attendance_log (who, employee_id, day, action, old_status, new_status, old_ot, new_ot, source)
    values (coalesce(auth.jwt() ->> 'email', 'system'), new.employee_id, new.day,
            case when tg_op = 'INSERT' then 'Marked' else 'Changed' end,
            case when tg_op = 'UPDATE' then old.status end, new.status,
            case when tg_op = 'UPDATE' then old.ot_hours end, new.ot_hours, new.source);
  return new;
end $$;
drop trigger if exists attendance_audit on public.attendance;
create trigger attendance_audit after insert or update or delete on public.attendance for each row execute function public.attendance_audit();

-- Letters issued by HR (offer, warning, experience, termination). The data is kept so a letter can be downloaded again.
create table if not exists public.hr_letters (
  id uuid primary key,
  employee_id uuid references public.employees (id) on delete set null,
  kind text not null,
  ref_no text,
  issued_on date,
  person_name text,
  data jsonb,
  created_at timestamptz not null default now(),
  created_by text default (auth.jwt() ->> 'email')
);

do $$
declare t text;
begin
  foreach t in array array['attendance', 'hr_letters', 'app_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.has_access())', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_hr()) with check (public.is_hr())', t || '_write', t);
  end loop;
end $$;
-- HR letters: only admin, owner and HR read them (not the accountant)
drop policy if exists hr_letters_read on public.hr_letters;
create policy hr_letters_read on public.hr_letters for select to authenticated using (public.hr_view());
alter table public.attendance_log enable row level security;
drop policy if exists attendance_log_read on public.attendance_log;
create policy attendance_log_read on public.attendance_log for select to authenticated using (public.has_access());

-- Change markers: payroll screens watch marker 1, attendance screens watch marker 2.
insert into public.sync_state (id) values (2) on conflict (id) do nothing;
create or replace function public.touch_att() returns trigger
language plpgsql security definer set search_path = public as
$$ begin update public.sync_state set stamp = clock_timestamp() where id = 2; return null; end $$;
drop trigger if exists touch_att on public.attendance;
create trigger touch_att after insert or update or delete on public.attendance for each statement execute function public.touch_att();
do $$
declare t text;
begin
  foreach t in array array['hr_letters', 'app_settings'] loop
    execute format('drop trigger if exists touch_sync on public.%I', t);
    execute format('create trigger touch_sync after insert or update or delete on public.%I for each statement execute function public.touch_sync()', t);
  end loop;
end $$;

-- Live updates for the HR attendance board
do $$ begin
  alter publication supabase_realtime add table public.attendance;
exception when duplicate_object or undefined_object then null;
end $$;

-- ---------- Site attendance logins ----------
-- Pakistan date, taken from the server clock, so a phone with a wrong date cannot mark another day.
create or replace function public.pk_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Karachi')::date $$;

-- The sites a site login looks after, with the teams inside them.
create or replace function public.my_site_ids() returns uuid[]
language sql stable security definer set search_path = public as
$$ with recursive t as (
     select s.id from public.sites s, public.profiles p
       where p.id = auth.uid() and p.active and p.role = 'site' and s.id = any (p.site_ids)
     union
     select s.id from public.sites s join t on s.parent_id = t.id)
   select coalesce(array_agg(id), '{}') from t $$;

create or replace function public.att_today() returns jsonb
language plpgsql stable security definer set search_path = public as
$$ declare p record; d date := public.pk_today(); ids uuid[] := public.my_site_ids();
begin
  select * into p from public.profiles where id = auth.uid() and active and role = 'site';
  if p.id is null then raise exception 'This screen is only for site attendance logins'; end if;
  return jsonb_build_object(
    'day', d,
    'server_time', now(),
    'name', p.name,
    'same_day_edit', coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'site_same_day_edit'), true),
    'sites', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'parent_id', s.parent_id) order by s.sort, s.name), '[]') from public.sites s where s.id = any (ids)),
    'employees', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'emp_code', e.emp_code, 'name', e.name, 'designation', e.designation, 'site_id', e.site_id) order by e.emp_code, e.name), '[]')
                  from public.employees e where e.active and e.site_id = any (ids)),
    'marks', (select coalesce(jsonb_agg(jsonb_build_object('employee_id', a.employee_id, 'status', a.status, 'ot_hours', a.ot_hours, 'marked_at', a.marked_at, 'marked_by_name', a.marked_by_name, 'source', a.source)), '[]')
              from public.attendance a join public.employees e on e.id = a.employee_id where a.day = d and e.site_id = any (ids)));
end $$;

-- Mark today's attendance. p_marks is a list of {employee_id, status, ot_hours}.
-- Only today can be marked. A past day can never be changed from a site login.
-- If HR switches off "same day correction", a mark cannot be changed even on the same day.
create or replace function public.att_mark(p_marks jsonb) returns int
language plpgsql security definer set search_path = public as
$$ declare p record; d date := public.pk_today(); ids uuid[] := public.my_site_ids(); m jsonb; e record; cur record;
   st text; ot numeric; same boolean; n int := 0;
begin
  select * into p from public.profiles where id = auth.uid() and active and role = 'site';
  if p.id is null then raise exception 'Only site attendance logins can mark attendance here'; end if;
  same := coalesce((select (value #>> '{}')::boolean from public.app_settings where key = 'site_same_day_edit'), true);
  for m in select * from jsonb_array_elements(p_marks) loop
    st := upper(coalesce(m ->> 'status', ''));
    if st not in ('P', 'H', 'A', 'L', 'OT') then raise exception 'Unknown mark "%"', st; end if;
    ot := case when st = 'OT' then nullif(m ->> 'ot_hours', '')::numeric end;
    if st = 'OT' and (ot is null or ot <= 0 or ot > 16) then raise exception 'Enter overtime hours from 0.5 to 16'; end if;
    select id, site_id, name into e from public.employees where id = (m ->> 'employee_id')::uuid and active;
    if e.id is null or not (e.site_id = any (ids)) then raise exception 'This employee is not on your site'; end if;
    select * into cur from public.attendance where employee_id = e.id and day = d;
    if cur.id is not null then
      if cur.status = st and cur.ot_hours is not distinct from ot then continue; end if;
      if cur.source = 'hr' then raise exception 'HR has set today''s attendance for %. Ask HR to change it.', e.name; end if;
      if not same then raise exception 'Attendance for % is already marked and locked. Ask HR to change it.', e.name; end if;
      update public.attendance set status = st, ot_hours = ot, site_id = e.site_id, marked_by = auth.uid(), marked_by_name = p.name, marked_at = now(), source = 'site' where id = cur.id;
    else
      insert into public.attendance (employee_id, site_id, day, status, ot_hours, marked_by, marked_by_name, source)
        values (e.id, e.site_id, d, st, ot, auth.uid(), p.name, 'site');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- Logins and access (used by the Users and access screen) ----------
create or replace function public.staff_list() returns table (id uuid, email text, name text, role text, site_ids uuid[], active boolean, last_sign_in timestamptz)
language sql stable security definer set search_path = public, auth as
$$ select u.id, u.email::text, p.name, p.role, coalesce(p.site_ids, '{}'), coalesce(p.active, false), u.last_sign_in_at
     from auth.users u left join public.profiles p on p.id = u.id
    where public.is_hr()
    order by p.role nulls first, p.name, u.email $$;

create or replace function public.staff_set(p_user uuid, p_role text, p_name text, p_site_ids uuid[], p_active boolean) returns void
language plpgsql security definer set search_path = public, auth as
$$ declare me text; cur text;
begin
  select role into me from public.profiles where id = auth.uid() and active;
  if me is null or me not in ('admin', 'hr') then raise exception 'Not allowed'; end if;
  if p_role not in ('admin', 'accountant', 'owner', 'hr', 'site', 'procurement') then raise exception 'Unknown role'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'Login not found'; end if;
  select role into cur from public.profiles where id = p_user;
  if me = 'hr' and (p_role <> 'site' or coalesce(cur, 'site') <> 'site') then raise exception 'HR can only manage site attendance logins'; end if;
  if p_user = auth.uid() and (p_role <> me or not p_active) then raise exception 'You cannot change your own access'; end if;
  insert into public.profiles (id, role, name, site_ids, active)
    values (p_user, p_role, nullif(trim(p_name), ''), coalesce(p_site_ids, '{}'), coalesce(p_active, true))
  on conflict (id) do update set role = excluded.role, name = excluded.name, site_ids = excluded.site_ids, active = excluded.active;
end $$;

revoke execute on function public.att_today() from public, anon;
revoke execute on function public.att_mark(jsonb) from public, anon;
revoke execute on function public.staff_list() from public, anon;
revoke execute on function public.staff_set(uuid, text, text, uuid[], boolean) from public, anon;
grant execute on function public.att_today() to authenticated;
grant execute on function public.att_mark(jsonb) to authenticated;
grant execute on function public.staff_list() to authenticated;
grant execute on function public.staff_set(uuid, text, text, uuid[], boolean) to authenticated;


-- =====================================================================================
-- PROCUREMENT (version 12)
-- Material request -> RFQ to suppliers -> quotations -> comparative statement -> approval
-- -> purchase order -> follow-up -> delivery, inspection and documents.
-- Roles: procurement (does the work), owner and accountant (see everything and approve).
-- =====================================================================================

create or replace function public.proc_view() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'owner', 'procurement')) $$;

create or replace function public.is_proc() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'procurement')) $$;

create or replace function public.can_approve() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'owner')) $$;

-- the procurement team needs the list of sites, and the change marker, but nothing from payroll or HR
drop policy if exists sites_read_proc on public.sites;
create policy sites_read_proc on public.sites for select to authenticated using (public.proc_view());
drop policy if exists sync_state_read_proc on public.sync_state;
create policy sync_state_read_proc on public.sync_state for select to authenticated using (public.proc_view());

create table if not exists public.suppliers (
  id uuid primary key,
  name text not null,
  category text,
  contact_person text,
  phone text,
  email text,
  address text,
  ntn text,
  brands text,
  payment_terms text,
  rating int,
  approved boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- One material request (purchase requisition). Items are a list: description, specification, brand, quantity, unit.
create table if not exists public.proc_requests (
  id uuid primary key,
  mr_no text,
  site_id uuid references public.sites (id),
  project text,
  title text not null,
  required_by date,
  priority text default 'Normal',
  stage text not null default 'draft',
  items jsonb not null default '[]',
  rfq jsonb not null default '[]',
  submittal_status text,
  submittal_note text,
  recommended_quote uuid,
  recommendation text,
  approval_status text,
  approval_by text,
  approval_at timestamptz,
  approval_note text,
  notes text,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.proc_requests drop constraint if exists proc_requests_stage_check;
alter table public.proc_requests add constraint proc_requests_stage_check check (stage in ('draft', 'rfq', 'evaluation', 'approval', 'approved', 'ordered', 'closed', 'cancelled'));
alter table public.proc_requests drop constraint if exists proc_requests_approval_check;
alter table public.proc_requests add constraint proc_requests_approval_check check (approval_status is null or approval_status in ('pending', 'approved', 'rejected'));

create table if not exists public.proc_quotes (
  id uuid primary key,
  request_id uuid not null references public.proc_requests (id) on delete cascade,
  supplier_id uuid references public.suppliers (id),
  quote_ref text,
  received_on date,
  valid_until date,
  currency text default 'PKR',
  fx numeric default 1,
  lines jsonb not null default '[]',
  tax_pct numeric,
  transport numeric,
  other numeric,
  delivery_days int,
  delivery text,
  payment_terms text,
  warranty text,
  technical text,
  tech_notes text,
  certifications text,
  created_at timestamptz not null default now()
);

create table if not exists public.proc_orders (
  id uuid primary key,
  po_no text,
  request_id uuid references public.proc_requests (id),
  quote_id uuid references public.proc_quotes (id),
  supplier_id uuid references public.suppliers (id),
  site_id uuid references public.sites (id),
  issued_on date,
  delivery_date date,
  delivery_to text,
  payment_terms text,
  terms text,
  currency text default 'PKR',
  fx numeric default 1,
  lines jsonb not null default '[]',
  tax_pct numeric,
  transport numeric,
  other numeric,
  status text not null default 'issued',
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);
alter table public.proc_orders drop constraint if exists proc_orders_status_check;
alter table public.proc_orders add constraint proc_orders_status_check check (status in ('issued', 'partial', 'received', 'closed', 'cancelled'));

-- Deliveries received at site, with the inspection result and which documents came with them.
create table if not exists public.proc_receipts (
  id uuid primary key,
  order_id uuid not null references public.proc_orders (id) on delete cascade,
  received_on date,
  received_by text,
  lines jsonb not null default '[]',
  inspection text,
  docs jsonb not null default '{}',
  notes text,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

-- Follow-ups and activity. Rows can be added and read, never edited or deleted.
create table if not exists public.proc_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  who text default (auth.jwt() ->> 'email'),
  request_id uuid,
  order_id uuid,
  kind text,
  note text,
  expected_on date
);

-- Quotations, datasheets, test certificates and other documents. The files live in Supabase Storage.
create table if not exists public.proc_files (
  id uuid primary key,
  request_id uuid,
  quote_id uuid,
  order_id uuid,
  receipt_id uuid,
  kind text,
  name text,
  path text,
  size bigint,
  created_by text default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['suppliers', 'proc_requests', 'proc_quotes', 'proc_orders', 'proc_receipts', 'proc_files'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.proc_view())', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_proc()) with check (public.is_proc())', t || '_write', t);
    execute format('drop trigger if exists touch_sync on public.%I', t);
    execute format('create trigger touch_sync after insert or update or delete on public.%I for each statement execute function public.touch_sync()', t);
  end loop;
end $$;
alter table public.proc_events enable row level security;
drop policy if exists proc_events_read on public.proc_events;
drop policy if exists proc_events_insert on public.proc_events;
create policy proc_events_read on public.proc_events for select to authenticated using (public.proc_view());
create policy proc_events_insert on public.proc_events for insert to authenticated with check (public.is_proc());

-- Approval can only come from the owner or the admin, through proc_decide below.
-- The procurement team can send a request for approval, but cannot approve it themselves.
create or replace function public.proc_requests_guard() returns trigger
language plpgsql security definer set search_path = public as
$$ begin
  if auth.uid() is null then return new; end if;
  new.updated_at := now();
  if coalesce(current_setting('sec.deciding', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      if new.approval_status in ('approved', 'rejected') then raise exception 'Only the owner or the admin can approve'; end if;
    else
      if new.approval_status in ('approved', 'rejected') and new.approval_status is distinct from old.approval_status then
        raise exception 'Only the owner or the admin can approve';
      end if;
      if (new.approval_by, new.approval_at) is distinct from (old.approval_by, old.approval_at) and new.approval_status is not distinct from old.approval_status then
        new.approval_by := old.approval_by; new.approval_at := old.approval_at;
      end if;
      -- changing the chosen quotation after approval cancels the approval
      if old.approval_status = 'approved' and new.recommended_quote is distinct from old.recommended_quote then
        new.approval_status := null; new.approval_by := null; new.approval_at := null; new.approval_note := null;
        if new.stage in ('approved', 'approval') then new.stage := 'evaluation'; end if;
      end if;
    end if;
    if new.stage in ('approved', 'ordered') and coalesce(new.approval_status, '') <> 'approved' then
      raise exception 'This request has not been approved yet';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists proc_requests_guard on public.proc_requests;
create trigger proc_requests_guard before insert or update on public.proc_requests for each row execute function public.proc_requests_guard();

-- A purchase order can only be made from the approved quotation of an approved request.
create or replace function public.proc_orders_guard() returns trigger
language plpgsql security definer set search_path = public as
$$ declare r record; begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' or new.quote_id is distinct from old.quote_id or new.request_id is distinct from old.request_id then
    select * into r from public.proc_requests where id = new.request_id;
    if r.id is null or r.approval_status is distinct from 'approved' then raise exception 'The request must be approved before a purchase order is issued'; end if;
    if new.quote_id is distinct from r.recommended_quote then raise exception 'The purchase order must use the approved quotation'; end if;
  end if;
  return new;
end $$;
drop trigger if exists proc_orders_guard on public.proc_orders;
create trigger proc_orders_guard before insert or update on public.proc_orders for each row execute function public.proc_orders_guard();

create or replace function public.proc_decide(p_request uuid, p_decision text, p_note text) returns void
language plpgsql security definer set search_path = public as
$$ declare r record; me record;
begin
  select * into me from public.profiles where id = auth.uid() and active and role in ('admin', 'owner');
  if me.id is null then raise exception 'Only the owner or the admin can approve'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Choose approve or reject'; end if;
  select * into r from public.proc_requests where id = p_request;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.approval_status is distinct from 'pending' then raise exception 'This request is not waiting for approval'; end if;
  if r.recommended_quote is null then raise exception 'No quotation has been recommended'; end if;
  perform set_config('sec.deciding', 'on', true);
  update public.proc_requests set approval_status = p_decision, approval_by = coalesce(me.name, auth.jwt() ->> 'email'), approval_at = now(),
    approval_note = nullif(trim(p_note), ''), stage = case when p_decision = 'approved' then 'approved' else 'evaluation' end
   where id = p_request;
  perform set_config('sec.deciding', '', true);
  insert into public.proc_events (request_id, kind, note) values (p_request, case when p_decision = 'approved' then 'Approved' else 'Rejected' end, nullif(trim(p_note), ''));
end $$;
revoke execute on function public.proc_decide(uuid, text, text) from public, anon;
grant execute on function public.proc_decide(uuid, text, text) to authenticated;

-- File storage for procurement documents (a private bucket). If this part reports a notice instead of
-- running, create a private bucket named "procurement" in Supabase > Storage by hand.
do $$ begin
  insert into storage.buckets (id, name, public) values ('procurement', 'procurement', false) on conflict (id) do nothing;
  drop policy if exists proc_files_read on storage.objects;
  drop policy if exists proc_files_write on storage.objects;
  create policy proc_files_read on storage.objects for select to authenticated using (bucket_id = 'procurement' and public.proc_view());
  create policy proc_files_write on storage.objects for insert to authenticated with check (bucket_id = 'procurement' and public.is_proc());
exception when others then raise notice 'Storage setup skipped: %', sqlerrm;
end $$;

-- =====================================================================================
-- PROFILES AND STATUS (version 13)
-- Admin, accountant, HR and procurement set their own photo, gender and status
-- (Available, Busy, Away, Out of office). The owner and the admin see everyone's status.
-- =====================================================================================
alter table public.profiles add column if not exists avatar text;
alter table public.profiles add column if not exists gender text;
alter table public.profiles add column if not exists status text not null default 'available';
alter table public.profiles add column if not exists status_note text;
alter table public.profiles add column if not exists status_until date;
alter table public.profiles add column if not exists last_seen timestamptz;
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check check (status in ('available', 'busy', 'away', 'ooo'));

-- People change only these fields, and only on their own login. Role, sites and access stay with the admin.
create or replace function public.my_profile_save(p_avatar text, p_gender text, p_status text, p_note text, p_until date) returns void
language plpgsql security definer set search_path = public as
$$ begin
  if not exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'accountant', 'hr', 'procurement')) then
    raise exception 'Profiles are for admin, accountant, HR and procurement logins';
  end if;
  if p_status not in ('available', 'busy', 'away', 'ooo') then raise exception 'Unknown status'; end if;
  if coalesce(p_gender, '') not in ('', 'M', 'F') then raise exception 'Unknown gender'; end if;
  if p_avatar is not null and (length(p_avatar) > 300000 or p_avatar !~ '^data:image/(jpeg|png|webp);base64,') then raise exception 'The photo must be a small JPG or PNG image'; end if;
  update public.profiles set avatar = p_avatar, gender = nullif(p_gender, ''), status = p_status,
         status_note = nullif(left(trim(coalesce(p_note, '')), 120), ''), status_until = p_until, last_seen = now()
   where id = auth.uid();
end $$;

-- Called every few minutes while the system is open, so the owner can see who is online.
create or replace function public.touch_presence() returns void
language sql security definer set search_path = public as
$$ update public.profiles set last_seen = now() where id = auth.uid() and role in ('admin', 'accountant', 'hr', 'procurement', 'owner') $$;

-- Everyone's status, for the owner and the admin. An "until" date in the past means back to Available.
create or replace function public.team_status() returns table (id uuid, name text, email text, role text, avatar text, gender text, status text, status_note text, status_until date, last_seen timestamptz)
language sql stable security definer set search_path = public, auth as
$$ select p.id, p.name, u.email::text, p.role, p.avatar, p.gender,
          case when p.status_until is not null and p.status_until < public.pk_today() then 'available' else p.status end,
          case when p.status_until is not null and p.status_until < public.pk_today() then null else p.status_note end,
          case when p.status_until is not null and p.status_until < public.pk_today() then null else p.status_until end,
          p.last_seen
     from public.profiles p join auth.users u on u.id = p.id
    where p.active and p.role in ('admin', 'accountant', 'hr', 'procurement')
      and exists (select 1 from public.profiles me where me.id = auth.uid() and me.active and me.role in ('owner', 'admin'))
    order by array_position(array['admin', 'accountant', 'hr', 'procurement'], p.role), p.name $$;

revoke execute on function public.my_profile_save(text, text, text, text, date) from public, anon;
revoke execute on function public.touch_presence() from public, anon;
revoke execute on function public.team_status() from public, anon;
grant execute on function public.my_profile_save(text, text, text, text, date) to authenticated;
grant execute on function public.touch_presence() to authenticated;
grant execute on function public.team_status() to authenticated;
