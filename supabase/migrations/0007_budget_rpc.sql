-- Changing a department's budget is two writes — close the old row, open a new
-- one — and doing it from the client leaves a window where a department has no
-- budget, or trips the `ends_on > starts_on` check when a budget is changed
-- twice on the day it was created.

create or replace function public.pp_set_budget(
  p_department_id uuid,
  p_period text,
  p_amount numeric
)
returns public.department_budgets
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.department_budgets;
begin
  update public.department_budgets
  set ends_on = greatest(current_date, starts_on + 1)
  where department_id = p_department_id and ends_on is null;

  if p_amount is null then
    return null;
  end if;

  insert into public.department_budgets (department_id, period, amount)
  values (p_department_id, p_period, p_amount)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.pp_set_budget(uuid, text, numeric) from public, anon;
grant execute on function public.pp_set_budget(uuid, text, numeric) to authenticated;
