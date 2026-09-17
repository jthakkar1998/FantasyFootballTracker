-- Run this ONCE in Supabase SQL Editor for an existing Fantasy Punishment Board database.
alter table public.obligations
  add column if not exists recap_upload_token_hash text,
  add column if not exists video_path text,
  add column if not exists video_uploaded_at timestamptz,
  add column if not exists video_original_filename text,
  add column if not exists video_size_bytes bigint,
  add column if not exists video_content_type text;

create unique index if not exists obligations_recap_upload_token_hash_idx
  on public.obligations (recap_upload_token_hash)
  where recap_upload_token_hash is not null;
