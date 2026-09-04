-- Tighten what the `anon` and `authenticated` roles may call directly.
--
-- Every function in `public` is exposed by PostgREST at /rest/v1/rpc/<name>,
-- and this project has anonymous sign-in enabled (the dorm chat app relies on
-- it), so `authenticated` is not by itself a trust boundary here — a staff row
-- is. Trigger functions and internal helpers have no business being callable
-- over HTTP by anyone.
--
-- `pp_role`, `pp_is_staff`, `pp_is_admin` and `pp_manages_department` keep
-- EXECUTE for `authenticated`: RLS policy expressions run with the invoking
-- user's privileges, and every policy on the purchasing tables calls them.

alter function public.pp_touch_updated_at() set search_path = public;

revoke all on function public.pp_touch_updated_at() from anon, authenticated;
revoke all on function public.pp_before_insert_purchase() from anon, authenticated;
revoke all on function public.pp_before_update_purchase() from anon, authenticated;
revoke all on function public.pp_log_purchase_event() from anon, authenticated;
revoke all on function public.pp_accept_staff_invite() from anon, authenticated;

-- Reveals another staff member's spending limit; only the triggers need it,
-- and they run with definer rights.
revoke all on function public.pp_approval_limit(uuid) from anon, authenticated;

revoke all on function public.pp_role() from anon;
revoke all on function public.pp_is_staff() from anon;
revoke all on function public.pp_is_admin() from anon;
revoke all on function public.pp_manages_department(uuid) from anon;
revoke all on function public.pp_budget_status() from anon;
revoke all on function public.pp_decide_purchase(uuid, boolean, text) from anon;
revoke all on function public.pp_update_my_name(text) from anon;
