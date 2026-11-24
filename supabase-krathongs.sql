-- Krathong Dreamy & Magical: public Gallery table
-- Run this ONCE in Supabase SQL Editor after preserving the existing setup.
-- This is additive: it does not alter or delete public.wishes or public.floating_krathongs.

create table if not exists public.krathongs_gallery (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'ไม่ระบุชื่อ'
    check (char_length(name) between 1 and 30),
  wish text not null
    check (char_length(wish) between 1 and 180),
  design text not null default 'gold'
    check (design in ('gold','lotus','jasmine','marigold','purple','nature','colorful','moon')),
  created_at timestamptz not null default now()
);

alter table public.krathongs_gallery enable row level security;

drop policy if exists "Public can read Krathong Gallery" on public.krathongs_gallery;
create policy "Public can read Krathong Gallery"
on public.krathongs_gallery
for select
to anon, authenticated
using (true);

drop policy if exists "Public can submit Krathong Gallery" on public.krathongs_gallery;
create policy "Public can submit Krathong Gallery"
on public.krathongs_gallery
for insert
to anon, authenticated
with check (
  char_length(name) between 1 and 30
  and char_length(wish) between 1 and 180
  and design in ('gold','lotus','jasmine','marigold','purple','nature','colorful','moon')
);

grant usage on schema public to anon, authenticated;
revoke all privileges on table public.krathongs_gallery from anon, authenticated;
grant select, insert on table public.krathongs_gallery to anon, authenticated;

-- Add Gallery to Realtime only when the publication exists and it is not yet included.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'krathongs_gallery'
     ) then
    alter publication supabase_realtime add table public.krathongs_gallery;
  end if;
end
$$;
