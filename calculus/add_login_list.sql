-- =====================================================================
-- 교사 로그인 화면의 선생님 드롭다운 목록
-- 수파베이스 SQL Editor에서 한 번 실행하세요. (여러 번 실행해도 괜찮습니다)
--
-- · calc_teachers에 등록되어 있고, Authentication에 계정이 만들어진 선생님만 보입니다.
-- · 로그인 전 화면에서 쓰므로 누구나 이 목록(이메일·담당 반)을 볼 수 있습니다.
--   비밀번호는 보이지 않으며, 목록만으로는 로그인할 수 없습니다.
-- · 되돌리려면:  drop function if exists public.calc_login_list();
--   (함수가 없으면 로그인 화면은 예전처럼 이메일을 직접 입력하는 칸으로 바뀝니다)
-- =====================================================================

create or replace function public.calc_login_list()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
           jsonb_build_object('email', lower(t.email), 'role', t.role, 'classes', to_jsonb(coalesce(t.classes, '{}')))
           order by case t.role when 'admin' then 0 else 1 end, coalesce(t.classes, '{}'), lower(t.email)),
         '[]'::jsonb)
    from public.calc_teachers t
   where exists (select 1 from auth.users u where lower(u.email) = lower(t.email));
$$;

grant execute on function public.calc_login_list() to anon, authenticated;
