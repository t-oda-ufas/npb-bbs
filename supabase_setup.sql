-- =============================================
-- NPB掲示板 Supabase セットアップSQL
-- Supabase Dashboard > SQL Editor で実行
-- =============================================

-- 1. プロフィールテーブル
create table public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text not null,
  favorite_team text default '',
  created_at timestamptz default now()
);

-- 2. スレッドテーブル
create table public.threads (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  team text not null,
  title text not null,
  body text default '',
  created_at timestamptz default now()
);

-- 3. 投稿（スレッド返信）テーブル
create table public.posts (
  id uuid default gen_random_uuid() primary key,
  thread_id uuid references public.threads(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  content text not null,
  created_at timestamptz default now()
);

-- 4. コメント（試合・ニュース用）テーブル
create table public.comments (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  target_type text not null check (target_type in ('game','news','thread')),
  target_id text not null,
  content text not null,
  created_at timestamptz default now()
);

-- 5. いいねテーブル
create table public.likes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  comment_id uuid references public.comments(id) on delete cascade not null,
  unique(user_id, comment_id)
);

-- =============================================
-- RLS (Row Level Security) 設定
-- =============================================

alter table public.profiles enable row level security;
alter table public.threads  enable row level security;
alter table public.posts    enable row level security;
alter table public.comments enable row level security;
alter table public.likes    enable row level security;

-- profiles: 誰でも読める / 本人だけ書ける
create policy "profiles_select" on public.profiles for select using (true);
create policy "profiles_insert" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update using (auth.uid() = id);

-- threads: 誰でも読める / ログイン済みが作成 / 本人だけ削除
create policy "threads_select" on public.threads for select using (true);
create policy "threads_insert" on public.threads for insert with check (auth.uid() = user_id);
create policy "threads_delete" on public.threads for delete using (auth.uid() = user_id);

-- posts: 誰でも読める / ログイン済みが作成 / 本人だけ削除
create policy "posts_select" on public.posts for select using (true);
create policy "posts_insert" on public.posts for insert with check (auth.uid() = user_id);
create policy "posts_delete" on public.posts for delete using (auth.uid() = user_id);

-- comments: 誰でも読める / ログイン済みが作成 / 本人だけ削除
create policy "comments_select" on public.comments for select using (true);
create policy "comments_insert" on public.comments for insert with check (auth.uid() = user_id);
create policy "comments_delete" on public.comments for delete using (auth.uid() = user_id);

-- likes: 誰でも読める / ログイン済みが作成・削除
create policy "likes_select" on public.likes for select using (true);
create policy "likes_insert" on public.likes for insert with check (auth.uid() = user_id);
create policy "likes_delete" on public.likes for delete using (auth.uid() = user_id);

-- =============================================
-- ユーザー登録時にprofileを自動作成するトリガー
-- =============================================

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username, favorite_team)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'favorite_team', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

