-- Sterling Engineering: merge the BSP sub-sites into BSP (run once)
--
-- BSP is one site. This moves everything from its sub-sites (BSP General Worker, CD Supply, Painters)
-- into BSP: workers, attendance, salary runs, purchase requests, purchase orders, receipts and the
-- site logins that could mark them. Then it deletes the sub-sites.
--
-- Run it once in Supabase: SQL Editor, New query, paste this whole file, Run.
-- It is safe to run again: when there are no sub-sites left it changes nothing.
-- The result at the end shows what was moved.

drop table if exists pg_temp.merge_report;
create temp table merge_report (what text, moved int);

do $$
declare
  bsp uuid;
  subs uuid[];
  t record;
  n int;
begin
  select id into bsp from public.sites where lower(trim(name)) = 'bsp' and parent_id is null order by sort limit 1;
  if bsp is null then raise exception 'Could not find the BSP site'; end if;

  select coalesce(array_agg(id), '{}') into subs from public.sites where parent_id = bsp;
  insert into merge_report values ('Sub-sites found under BSP', coalesce(array_length(subs, 1), 0));
  if coalesce(array_length(subs, 1), 0) = 0 then return; end if;

  -- every table with a site_id column that points to sites
  for t in
    select c.table_name from information_schema.columns c
    where c.table_schema = 'public' and c.column_name = 'site_id' and c.table_name <> 'sites'
      and exists (select 1 from information_schema.tables x where x.table_schema = 'public' and x.table_name = c.table_name and x.table_type = 'BASE TABLE')
    order by c.table_name
  loop
    execute format('update public.%I set site_id = $1 where site_id = any ($2)', t.table_name) using bsp, subs;
    get diagnostics n = row_count;
    insert into merge_report values ('Moved in ' || t.table_name, n);
  end loop;

  -- site logins: a login that had a sub-site now has BSP instead
  update public.profiles
     set site_ids = (select array_agg(distinct case when s = any (subs) then bsp else s end) from unnest(site_ids) s)
   where site_ids && subs;
  get diagnostics n = row_count;
  insert into merge_report values ('Site logins updated', n);

  delete from public.sites where id = any (subs);
  get diagnostics n = row_count;
  insert into merge_report values ('Sub-sites deleted', n);
end $$;

-- the whole block above either finishes completely or changes nothing
select * from merge_report;
