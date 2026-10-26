-- =====================================================================
-- [미적분Ⅰ] 다항함수 모델링 수행평가 — 수파베이스 설정 SQL
-- 수파베이스 대시보드 > SQL Editor 에 전체를 붙여넣고 [Run] 하세요.
-- 여러 번 실행해도 안전합니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ⚠️ 먼저 확인: 기존 학생 명렬표(students) 테이블의 열 이름
--   이 SQL은 students 테이블에 grade(학년), class(반), number(번호),
--   name(이름) 열이 있다고 가정합니다.
--   열 이름이 다르면 아래 calc_in_roster 함수의 4줄만 고치세요.
-- ---------------------------------------------------------------------


-- 1) 답안 저장 테이블 ---------------------------------------------------
create table if not exists public.calculus_submissions (
  student_key   text primary key,                 -- 예: 2학년_1반_01번_김나라
  grade         int  not null,
  class_no      int  not null,
  num           int  not null,
  name          text not null,
  token         uuid,                             -- 처음 시작한 기기 확인용
  start_time    timestamptz not null default now(),
  submitted     boolean not null default false,
  submitted_at  timestamptz,
  progress      int not null default 0,
  data          jsonb not null default '{}'::jsonb,  -- 데이터·추세선·정답·답안
  updated_at    timestamptz not null default now()
);

-- 2) 교사 계정 목록 (이 표에 있는 이메일만 교사 화면 사용 가능) ----------
create table if not exists public.calc_teachers (
  email text primary key
);
-- ✏️ 선생님 이메일로 바꿔서 실행하세요 (수파베이스 Authentication에서 만든 계정과 같은 이메일)
insert into public.calc_teachers (email) values ('teacher@example.com')
on conflict do nothing;

-- 3) 보안: 학생(anon)은 표에 직접 접근 불가, 아래 함수로만 저장 -----------
alter table public.calculus_submissions enable row level security;
alter table public.calc_teachers        enable row level security;

create or replace function public.calc_is_teacher()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.calc_teachers t
    where lower(t.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

drop policy if exists "teacher read"   on public.calculus_submissions;
drop policy if exists "teacher update" on public.calculus_submissions;
drop policy if exists "teacher delete" on public.calculus_submissions;
create policy "teacher read"   on public.calculus_submissions for select to authenticated using (public.calc_is_teacher());
create policy "teacher update" on public.calculus_submissions for update to authenticated using (public.calc_is_teacher()) with check (public.calc_is_teacher());
create policy "teacher delete" on public.calculus_submissions for delete to authenticated using (public.calc_is_teacher());

drop policy if exists "teacher self check" on public.calc_teachers;
create policy "teacher self check" on public.calc_teachers for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- 4) 시험 설정 ----------------------------------------------------------
create or replace function public.calc_limit_minutes() returns int language sql immutable as $$ select 45 $$;
create or replace function public.calc_grace_seconds() returns int language sql immutable as $$ select 90 $$;  -- 마감 직후 마지막 저장 허용

-- 5) 명렬표 확인 --------------------------------------------------------
create or replace function public.calc_in_roster(p_grade int, p_class int, p_num int, p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    where trim(s.grade::text)  = p_grade::text     -- ✏️ 학년 열 이름
      and trim(s.class::text)  = p_class::text     -- ✏️ 반 열 이름
      and trim(s.number::text) = p_num::text       -- ✏️ 번호 열 이름
      and trim(s.name)         = trim(p_name)      -- ✏️ 이름 열 이름
  );
$$;

create or replace function public.calc_key(p_grade int, p_class int, p_num int, p_name text)
returns text language sql immutable as $$
  select p_grade || '학년_' || p_class || '반_' || lpad(p_num::text, 2, '0') || '번_' || trim(p_name);
$$;

-- 6) 학생: 시험 시작 / 이어하기 -----------------------------------------
create or replace function public.calc_start(p_grade int, p_class int, p_num int, p_name text, p_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  k text := public.calc_key(p_grade, p_class, p_num, p_name);
  r public.calculus_submissions;
begin
  if not public.calc_in_roster(p_grade, p_class, p_num, p_name) then
    raise exception 'NOT_IN_ROSTER';
  end if;

  select * into r from public.calculus_submissions where student_key = k for update;

  if not found then
    insert into public.calculus_submissions (student_key, grade, class_no, num, name, token)
    values (k, p_grade, p_class, p_num, trim(p_name), gen_random_uuid())
    returning * into r;
  elsif r.token is null then
    -- 교사가 '기기 초기화'를 한 경우: 지금 기기를 새로 등록
    update public.calculus_submissions set token = gen_random_uuid() where student_key = k returning * into r;
  elsif p_token is distinct from r.token then
    raise exception 'TOKEN_MISMATCH';
  end if;

  return jsonb_build_object(
    'student_key', r.student_key, 'token', r.token, 'start_time', r.start_time,
    'submitted', r.submitted, 'data', r.data, 'server_now', now(),
    'limit_minutes', public.calc_limit_minutes()
  );
end $$;

-- 7) 학생: 저장 (시간 초과·제출 후에는 서버가 거부) -----------------------
create or replace function public.calc_save(p_key text, p_token uuid, p_data jsonb, p_progress int, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.calculus_submissions;
begin
  select * into r from public.calculus_submissions where student_key = p_key for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.token is null or p_token is distinct from r.token then raise exception 'TOKEN_MISMATCH'; end if;
  if r.submitted then raise exception 'ALREADY_SUBMITTED'; end if;
  if now() > r.start_time + make_interval(mins => public.calc_limit_minutes(), secs => public.calc_grace_seconds()) then
    raise exception 'TIME_OVER';
  end if;
  if octet_length(p_data::text) > 200000 then raise exception 'TOO_LARGE'; end if;

  update public.calculus_submissions
     set data = p_data,
         progress = greatest(0, least(100, coalesce(p_progress, 0))),
         submitted = p_submit,
         submitted_at = case when p_submit then now() else null end,
         updated_at = now()
   where student_key = p_key;

  return jsonb_build_object('ok', true, 'server_now', now(), 'submitted', p_submit);
end $$;

-- 8) 함수 실행 권한 -----------------------------------------------------
revoke all on function public.calc_start(int, int, int, text, uuid) from public;
revoke all on function public.calc_save(text, uuid, jsonb, int, boolean) from public;
revoke all on function public.calc_in_roster(int, int, int, text) from public;
grant execute on function public.calc_start(int, int, int, text, uuid) to anon, authenticated;
grant execute on function public.calc_save(text, uuid, jsonb, int, boolean) to anon, authenticated;
grant execute on function public.calc_is_teacher() to authenticated;
grant select, update, delete on public.calculus_submissions to authenticated;
grant select on public.calc_teachers to authenticated;
revoke all on public.calculus_submissions from anon;
revoke all on public.calc_teachers from anon;
