-- An employee could approve their own purchase.
--
-- The original guard only blocked *setting* a status of 'pending_approval' or
-- 'rejected'. Moving a row the other way — 'pending_approval' -> 'ordered' —
-- is the approval decision itself, and nothing stopped the person who created
-- the order from making it. Non-managers now cannot move a purchase out of
-- 'pending_approval' at all, and cannot write the decision fields.

create or replace function public.pp_before_update_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.pp_manages_department(old.department_id) then
    if new.staff_id <> old.staff_id then
      raise exception 'Only an administrator can reassign a purchase';
    end if;
    if old.status = 'rejected' then
      raise exception 'This purchase was rejected - ask an administrator to reopen it';
    end if;

    -- Approving, rejecting, or reopening is a manager's decision, in either
    -- direction.
    if new.status is distinct from old.status
       and (old.status = 'pending_approval'
            or new.status in ('pending_approval', 'rejected')) then
      raise exception 'Only a manager or administrator can decide on a purchase';
    end if;

    -- The decision fields belong to whoever made the decision.
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.decision_note := old.decision_note;

    -- Raising the amount past the limit sends it back for approval.
    if new.total is distinct from old.total
       and old.status <> 'pending_approval'
       and new.total > public.pp_approval_limit(new.staff_id) then
      new.status := 'pending_approval';
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;

  return new;
end;
$$;
