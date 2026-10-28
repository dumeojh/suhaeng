-- =====================================================================
-- add_roster.sql : 교사 화면에서 '미접속 학생'을 보여 주기 위한 명렬표 조회 함수
--  · students 표의 grade2_num(학번)을 학년·반·번호로 풀어서 돌려줌
--      5자리 20315 → 2학년 3반 15번 / 4자리 2315 → 2학년 3반 15번
--  · 교사 계정(calc_teachers)만 호출할 수 있음
-- 수파베이스 SQL Editor에서 한 번 실행하세요. 여러 번 실행해도 안전합니다.
-- =====================================================================
create or replace function public.calc_roster()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if not public.calc_is_teacher() then raise exception 'NOT_TEACHER'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('grade', t.g, 'class', t.c, 'num', t.n, 'name', t.nm) order by t.g, t.c, t.n)
      from (
        select distinct
               substr(d, 1, 1)::int as g,
               case when length(d) = 5 then substr(d, 2, 2)::int else substr(d, 2, 1)::int end as c,
               substr(d, length(d) - 1, 2)::int as n,
               trim(s.name) as nm
          from public.students s
          cross join lateral (select regexp_replace(coalesce(s.grade2_num::text, ''), '\D', '', 'g') as d) x
         where length(d) in (4, 5) and coalesce(trim(s.name), '') <> ''
      ) t
  ), '[]'::jsonb);
end $function$;

notify pgrst, 'reload schema';
