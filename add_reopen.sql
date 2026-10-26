-- =====================================================================
-- [추가 기능] 응시 재개 — 끝난 시험(제출 완료·시간 종료)을 교사가 다시 열어 줌
-- setup.sql을 이미 실행했다면 이 파일만 SQL Editor에서 한 번 실행하세요.
-- (여러 번 실행해도 안전합니다)
-- =====================================================================

alter table public.calculus_submissions add column if not exists reopen_count int not null default 0;
alter table public.calculus_submissions add column if not exists reopened_at  timestamptz;

-- 교사만 실행 가능: 답안은 그대로 두고, 지금부터 p_minutes 분 동안 다시 응시할 수 있게 함
create or replace function public.calc_reopen(p_key text, p_minutes int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.calc_is_teacher() then raise exception 'NOT_TEACHER'; end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 120 then raise exception 'BAD_MINUTES'; end if;

  update public.calculus_submissions
     set submitted    = false,
         submitted_at = null,
         -- 남은 시간이 정확히 p_minutes 분이 되도록 시작 시각을 다시 계산
         start_time   = now() - make_interval(mins => public.calc_limit_minutes() - p_minutes),
         reopen_count = reopen_count + 1,
         reopened_at  = now(),
         updated_at   = now()
   where student_key = p_key;
  if not found then raise exception 'NOT_FOUND'; end if;

  return jsonb_build_object('ok', true, 'ends_at', now() + make_interval(mins => p_minutes));
end $$;

revoke all on function public.calc_reopen(text, int) from public;
grant execute on function public.calc_reopen(text, int) to authenticated;
