-- =====================================================================
-- add_exams.sql : 미적분Ⅰ 수행평가 "회차" 기능
--  · 회차(calc_exams)마다 문항 페이지·제한 시간·응시 가능한 반을 따로 관리
--  · 결석생은 지난 회차를 개별 허용(calc_makeup)해서 다른 날 응시
--  · 기존 답안은 모두 1회차로 남음 (학생 키는 그대로, 2회차부터 "2회차_" 접두어)
-- 수파베이스 SQL Editor에 전체를 붙여넣고 한 번 실행하세요. 여러 번 실행해도 안전합니다.
-- =====================================================================
begin;

-- 1) 회차 표 ----------------------------------------------------------
create table if not exists public.calc_exams (
  id            integer primary key check (id between 1 and 99),
  title         text not null,
  page          text not null check (page ~ '^[A-Za-z0-9_-]+$'),   -- calculus/ 아래 폴더 이름 (예: r1)
  limit_minutes integer not null default 45 check (limit_minutes between 1 and 180),
  open_classes  integer[] not null default '{}',                    -- 지금 응시할 수 있는 반
  created_at    timestamptz not null default now()
);

-- 지금까지의 시험 = 1회차 (처음에는 모든 반에 열어 둠: 기존과 똑같이 동작)
insert into public.calc_exams (id, title, page, limit_minutes, open_classes)
values (1, '실세계 데이터 기반 다항함수 모델링', 'r1', public.calc_limit_minutes(), '{1,2,3,4,5,6}')
on conflict (id) do nothing;

-- 2) 결석생 개별 응시 허용 표 ------------------------------------------
create table if not exists public.calc_makeup (
  exam_id     integer not null references public.calc_exams(id) on delete cascade,
  student_key text not null,
  grade       integer not null,
  class_no    integer not null,
  num         integer not null,
  name        text not null,
  added_at    timestamptz not null default now(),
  added_by    text,
  primary key (exam_id, student_key)
);

-- 3) 답안 표에 회차 번호 ------------------------------------------------
alter table public.calculus_submissions add column if not exists exam_id integer not null default 1;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'calculus_submissions_exam_fk') then
    alter table public.calculus_submissions
      add constraint calculus_submissions_exam_fk foreign key (exam_id) references public.calc_exams(id) on update cascade;
  end if;
end $$;
create index if not exists calculus_submissions_exam_idx on public.calculus_submissions (exam_id, class_no);

-- 4) 권한: 두 표 모두 교사만 읽고 쓸 수 있음 (학생은 아래 함수로만 접근) ----
alter table public.calc_exams  enable row level security;
alter table public.calc_makeup enable row level security;
drop policy if exists calc_exams_teacher  on public.calc_exams;
drop policy if exists calc_makeup_teacher on public.calc_makeup;
create policy calc_exams_teacher  on public.calc_exams  for all to authenticated
  using (public.calc_is_teacher()) with check (public.calc_is_teacher());
create policy calc_makeup_teacher on public.calc_makeup for all to authenticated
  using (public.calc_is_teacher()) with check (public.calc_is_teacher());
grant select, insert, update, delete on public.calc_exams, public.calc_makeup to authenticated;

-- 5) 도움 함수 ----------------------------------------------------------
-- 회차별 학생 키: 1회차는 예전과 같은 키, 2회차부터 "N회차_" 접두어
create or replace function public.calc_exam_key(p_exam integer, p_grade integer, p_class integer, p_num integer, p_name text)
returns text language sql immutable as $$
  select case when coalesce(p_exam, 1) = 1 then public.calc_key(p_grade, p_class, p_num, p_name)
              else p_exam || '회차_' || public.calc_key(p_grade, p_class, p_num, p_name) end;
$$;

-- 회차별 제한 시간
create or replace function public.calc_exam_limit(p_exam integer)
returns integer language sql stable security definer set search_path to 'public' as $$
  select coalesce((select limit_minutes from public.calc_exams where id = p_exam), public.calc_limit_minutes());
$$;

-- 이 학생이 이 회차를 새로 시작할 수 있는지 (반이 열려 있거나, 개별 허용됨)
create or replace function public.calc_can_take(p_exam integer, p_grade integer, p_class integer, p_num integer, p_name text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.calc_exams e where e.id = p_exam and p_class = any(e.open_classes))
      or exists (select 1 from public.calc_makeup m
                  where m.exam_id = p_exam and m.grade = p_grade and m.class_no = p_class and m.num = p_num
                    and replace(trim(m.name), ' ', '') = replace(trim(p_name), ' ', ''));
$$;

-- 6) 응시 시작: 회차 번호(p_exam)를 받음. 빠뜨리면 1회차 -----------------
drop function if exists public.calc_start(integer, integer, integer, text, uuid);
create or replace function public.calc_start(p_grade integer, p_class integer, p_num integer, p_name text,
                                             p_token uuid, p_exam integer default 1)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  ex integer := coalesce(p_exam, 1);
  k  text    := public.calc_exam_key(ex, p_grade, p_class, p_num, p_name);
  e  public.calc_exams;
  r  public.calculus_submissions;
begin
  if not public.calc_in_roster(p_grade, p_class, p_num, p_name) then
    raise exception 'NOT_IN_ROSTER';
  end if;
  select * into e from public.calc_exams where id = ex;
  if not found then raise exception 'NO_EXAM'; end if;

  select * into r from public.calculus_submissions where student_key = k for update;

  if not found then
    -- 처음 시작할 때만 '열려 있는지' 확인 (이미 시작한 학생은 반을 닫아도 남은 시간 동안 계속)
    if not public.calc_can_take(ex, p_grade, p_class, p_num, p_name) then
      raise exception 'EXAM_CLOSED';
    end if;
    insert into public.calculus_submissions (student_key, grade, class_no, num, name, token, exam_id)
    values (k, p_grade, p_class, p_num, trim(p_name), gen_random_uuid(), ex)
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
    'limit_minutes', e.limit_minutes, 'exam_id', ex, 'exam_title', e.title
  );
end $function$;

-- 7) 저장: 회차별 제한 시간으로 마감 확인 -------------------------------
create or replace function public.calc_save(p_key text, p_token uuid, p_data jsonb, p_progress integer, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  r public.calculus_submissions;
begin
  select * into r from public.calculus_submissions where student_key = p_key for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if r.token is null or p_token is distinct from r.token then raise exception 'TOKEN_MISMATCH'; end if;
  if r.submitted then raise exception 'ALREADY_SUBMITTED'; end if;
  if now() > r.start_time + make_interval(mins => public.calc_exam_limit(r.exam_id), secs => public.calc_grace_seconds()) then
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
end $function$;

-- 8) 응시 재개: 회차별 제한 시간 기준으로 남은 시간 계산 -----------------
create or replace function public.calc_reopen(p_key text, p_minutes integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.calc_is_teacher() then raise exception 'NOT_TEACHER'; end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then raise exception 'BAD_MINUTES'; end if;

  update public.calculus_submissions
     set submitted    = false,
         submitted_at = null,
         start_time   = now() - make_interval(mins => public.calc_exam_limit(exam_id) - p_minutes),
         reopen_count = reopen_count + 1,
         reopened_at  = now(),
         updated_at   = now()
   where student_key = p_key;
  if not found then raise exception 'NOT_FOUND'; end if;

  return jsonb_build_object('ok', true, 'ends_at', now() + make_interval(mins => p_minutes));
end $function$;

-- 9) 학생 첫 화면: 지금 볼 수 있는 회차 목록 ------------------------------
create or replace function public.calc_available(p_grade integer, p_class integer, p_num integer, p_name text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.calc_in_roster(p_grade, p_class, p_num, p_name) then
    raise exception 'NOT_IN_ROSTER';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'page', t.page,
                                        'limit_minutes', t.limit_minutes, 'status', t.status) order by t.id)
      from (
        select e.id, e.title, e.page, e.limit_minutes,
               case when s.student_key is null then 'new'
                    when s.submitted then 'submitted'
                    when now() > s.start_time + make_interval(mins => e.limit_minutes, secs => public.calc_grace_seconds()) then 'timeover'
                    else 'writing' end as status,
               public.calc_can_take(e.id, p_grade, p_class, p_num, p_name) as can
          from public.calc_exams e
          left join public.calculus_submissions s
                 on s.student_key = public.calc_exam_key(e.id, p_grade, p_class, p_num, p_name)
      ) t
     where t.can or t.status = 'writing'
  ), '[]'::jsonb);
end $function$;

-- 10) 교사: 결석생 개별 응시 허용 (명렬표에 있는 학생인지 확인) ----------
create or replace function public.calc_makeup_add(p_exam integer, p_grade integer, p_class integer, p_num integer, p_name text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.calc_is_teacher() then raise exception 'NOT_TEACHER'; end if;
  if not exists (select 1 from public.calc_exams where id = p_exam) then raise exception 'NO_EXAM'; end if;
  if not public.calc_in_roster(p_grade, p_class, p_num, p_name) then raise exception 'NOT_IN_ROSTER'; end if;
  insert into public.calc_makeup (exam_id, student_key, grade, class_no, num, name, added_by)
  values (p_exam, public.calc_key(p_grade, p_class, p_num, p_name), p_grade, p_class, p_num, trim(p_name),
          coalesce(auth.jwt() ->> 'email', ''))
  on conflict (exam_id, student_key) do update set added_at = now(), added_by = excluded.added_by;
  return jsonb_build_object('ok', true);
end $function$;

notify pgrst, 'reload schema';
commit;
