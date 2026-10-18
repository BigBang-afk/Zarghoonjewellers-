-- Zarghoon AI — approval integrity (Phase 1, Step 12 security audit).
--
-- Approvals are enforced by the application, but the backend connects with a
-- privileged role, so the database now guards them as well:
--  * a decision is final: only pending → approved / rejected / cancelled,
--  * what was approved (type, reason, payload, requester) can never be edited,
--  * an approval is consumed at most once (consumed_at), atomically, and only
--    when approved — a replayed or concurrent second use is refused.
-- Foreign keys may still be cleared by ON DELETE SET NULL.

alter table approvals
  add column consumed_at        timestamptz,
  add column consumed_by_action text check (consumed_by_action is null or length(btrim(consumed_by_action)) > 0),
  add constraint approvals_consumption_consistency check (
    (consumed_at is null and consumed_by_action is null)
    or (consumed_at is not null and consumed_by_action is not null and status = 'approved')
  );

create or replace function zj_approvals_guard() returns trigger
language plpgsql as $$
begin
  if new.action_type is distinct from old.action_type
     or new.reason is distinct from old.reason
     or new.payload is distinct from old.payload
     or new.requested_by_type is distinct from old.requested_by_type
     or new.created_at is distinct from old.created_at
     or (new.requested_by_staff_id is distinct from old.requested_by_staff_id and new.requested_by_staff_id is not null) then
    raise exception 'approval request details cannot be changed' using errcode = 'P0001', hint = 'ZJ_APPROVAL_IMMUTABLE';
  end if;

  if old.status <> 'pending' then
    if new.status is distinct from old.status
       or new.decided_at is distinct from old.decided_at
       or new.decision_note is distinct from old.decision_note
       or (new.decided_by_staff_id is distinct from old.decided_by_staff_id and new.decided_by_staff_id is not null) then
      raise exception 'approval decision is final' using errcode = 'P0001', hint = 'ZJ_APPROVAL_IMMUTABLE';
    end if;
  end if;

  if old.consumed_at is not null
     and (new.consumed_at is distinct from old.consumed_at or new.consumed_by_action is distinct from old.consumed_by_action) then
    raise exception 'approval has already been used' using errcode = 'P0001', hint = 'ZJ_APPROVAL_CONSUMED';
  end if;
  return new;
end;
$$;

create trigger approvals_guard before update on approvals
  for each row execute function zj_approvals_guard();

-- Decided approvals are evidence; they are never deleted.
create or replace function zj_approvals_no_delete() returns trigger
language plpgsql as $$
begin
  if old.status <> 'pending' then
    raise exception 'decided approvals cannot be deleted' using errcode = 'P0001', hint = 'ZJ_APPROVAL_IMMUTABLE';
  end if;
  return old;
end;
$$;

create trigger approvals_no_delete before delete on approvals
  for each row execute function zj_approvals_no_delete();
