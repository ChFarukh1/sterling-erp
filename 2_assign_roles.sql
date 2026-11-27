-- STERLING: give each login its role. Run in Supabase > SQL Editor AFTER 1_database_setup.sql.
-- Create each login first in Supabase > Authentication > Users > Add user (tick "Auto Confirm User").
-- Safe to run again. Emails are matched without caring about capital letters.

insert into public.profiles (id, role, name, active, site_ids)
select u.id, r.role, r.name, true, '{}'
from auth.users u
join (values
  ('haroon.iftikhar@sterlingengineering.pk', 'admin',       'Haroon Iftikhar'),
  ('salik@sterlingengineering.pk',            'owner',       'Salik'),
  ('yaseenwasif509@gmail.com',                'accountant',  'Muhammad Wasif'),
  ('farhan.ali@sterlingengineering.pk',       'procurement', 'Farhan Ali'),
  ('hr@sterlingengineering.pk',               'hr',          'HR')
) as r (email, role, name) on lower(u.email) = r.email
on conflict (id) do update set role = excluded.role, active = true,
  name = coalesce(nullif(trim(public.profiles.name), ''), excluded.name);

-- Shows every login above and whether it was found. "MISSING" means the login does not exist yet:
-- create it in Authentication > Users, then run this file again.
select r.email, r.role,
       case when u.id is null then 'MISSING: create this login first' else 'OK' end as status
from (values
  ('haroon.iftikhar@sterlingengineering.pk', 'admin'),
  ('salik@sterlingengineering.pk',            'owner'),
  ('yaseenwasif509@gmail.com',                'accountant'),
  ('farhan.ali@sterlingengineering.pk',       'procurement'),
  ('hr@sterlingengineering.pk',               'hr')
) as r (email, role)
left join auth.users u on lower(u.email) = r.email;
