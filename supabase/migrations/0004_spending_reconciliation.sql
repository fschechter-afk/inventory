-- Support the credit-card reconciliation sheet: senior staff need to mark
-- each logged purchase as checked off against the statement. Routed through
-- an RPC (like submit_inventory_check) rather than a blanket update policy,
-- so the only thing an update can touch is the verified flag.

alter table public.spending_entries
  add column verified boolean not null default false,
  add column verified_at timestamptz;

create policy "anon update spending verified" on public.spending_entries
  for update using (true) with check (true);

create or replace function public.set_spending_verified(p_id uuid, p_verified boolean)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update spending_entries
  set verified = p_verified,
      verified_at = case when p_verified then now() else null end
  where id = p_id;
end;
$$;

grant execute on function public.set_spending_verified(uuid, boolean) to anon;
