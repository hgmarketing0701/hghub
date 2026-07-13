-- ============================================================================
-- HG HUB — FINANCE HOME V1
-- Run after schema-executive-home.sql and the Finance/operational billing schemas.
-- Additive and safe to re-run.
-- ============================================================================

-- Black and Marketing are the Finance administrators who can assign P&L roles
-- through Project P&L → Setup / Master Lists → User Roles.
insert into public.pl_user_roles (email, role, notes) values
  ('lee@hggroup.com.my',       'Admin', 'bootstrap admin'),
  ('marketing@hggroup.com.my', 'Admin', 'bootstrap admin · Finance UI/UX administration')
on conflict (email) do update
set role = 'Admin',
    notes = excluded.notes,
    updated_at = now(),
    updated_by = 'schema-finance-home';

create or replace function public.hub_finance_home_v1(
  p_as_of date default null,
  p_attention_limit int default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_as_of date := coalesce(p_as_of, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_month_start date := date_trunc('month', coalesce(p_as_of, (now() at time zone 'Asia/Kuala_Lumpur')::date))::date;
  v_month_end date := (date_trunc('month', coalesce(p_as_of, (now() at time zone 'Asia/Kuala_Lumpur')::date)) + interval '1 month')::date;
  v_limit int := greatest(1, least(coalesce(p_attention_limit, 20), 100));
  v_role text := public.pl_role();
  v_snapshot jsonb := '{}'::jsonb;
  v_queues jsonb := '{}'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_activity jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_domain jsonb;
  v_attention jsonb;
begin
  if v_role not in ('Admin', 'Manager') then
    raise exception 'Project P&L Admin or Manager access required.' using errcode = '42501';
  end if;

  -- Portfolio financial position. These are portfolio totals, not MTD metrics.
  begin
    select jsonb_build_object(
      'client_outstanding', jsonb_build_object(
        'value', coalesce(sum(greatest(client_outstanding, 0)) filter (
          where invoice_evidence and lower(coalesce(status, '')) <> 'cancelled'), 0),
        'count', count(*) filter (
          where invoice_evidence and lower(coalesce(status, '')) <> 'cancelled' and client_outstanding > 0),
        'unit', 'MYR', 'source', 'hub_pl_project_financials_v1'),
      'subcontractor_outstanding', jsonb_build_object(
        'value', coalesce(sum(greatest(subcontractor_outstanding, 0)) filter (
          where lower(coalesce(status, '')) <> 'cancelled'), 0),
        'count', count(*) filter (
          where lower(coalesce(status, '')) <> 'cancelled' and subcontractor_outstanding > 0),
        'unit', 'MYR', 'source', 'hub_pl_project_financials_v1'),
      'supplier_outstanding', jsonb_build_object(
        'value', coalesce(sum(greatest(supplier_outstanding, 0)) filter (
          where lower(coalesce(status, '')) <> 'cancelled'), 0),
        'count', count(*) filter (
          where lower(coalesce(status, '')) <> 'cancelled' and supplier_outstanding > 0),
        'unit', 'MYR', 'source', 'hub_pl_project_financials_v1'),
      'net_revenue', jsonb_build_object(
        'value', coalesce(sum(net_revenue) filter (where lower(coalesce(status, '')) <> 'cancelled'), 0),
        'unit', 'MYR', 'source', 'hub_pl_project_financials_v1'),
      'project_profit', jsonb_build_object(
        'value', coalesce(sum(profit) filter (where lower(coalesce(status, '')) <> 'cancelled'), 0),
        'unit', 'MYR', 'source', 'hub_pl_project_financials_v1'),
      'average_margin', jsonb_build_object(
        'value', case
          when coalesce(sum(net_revenue) filter (where lower(coalesce(status, '')) <> 'cancelled'), 0) > 0
          then round(
            coalesce(sum(profit) filter (where lower(coalesce(status, '')) <> 'cancelled'), 0)
            / sum(net_revenue) filter (where lower(coalesce(status, '')) <> 'cancelled') * 100,
            2
          )
          else 0
        end,
        'unit', 'percent', 'source', 'hub_pl_project_financials_v1')
    ) into v_snapshot
    from public.hub_pl_project_financials_v1;

    select coalesce(jsonb_agg(item order by severity_rank, due_date nulls last, amount desc), '[]'::jsonb)
    into v_domain
    from (
      select jsonb_build_object(
        'item_key', 'finance:loss:' || id::text,
        'domain', 'finance', 'severity', 'critical', 'type', 'negative_project_profit',
        'title', coalesce(nullif(code, ''), nullif(client_name, ''), 'Project') || ' is below cost',
        'detail', 'Current project profit is RM ' || to_char(round(profit, 2), 'FM999G999G990D00') || '.',
        'impact', 'RM ' || to_char(round(abs(profit), 0), 'FM999G999G990'),
        'due_date', invoice_date, 'amount', abs(profit),
        'tool_id', 'Project Revenue vs Expenses (P&L)', 'action_label', 'Review Project P&L'
      ) as item, 1 as severity_rank, invoice_date as due_date, abs(profit) as amount
      from public.hub_pl_project_financials_v1
      where lower(coalesce(status, '')) = 'active' and net_revenue > 0 and profit < 0

      union all

      select jsonb_build_object(
        'item_key', 'finance:estimated:' || id::text,
        'domain', 'finance', 'severity', 'warning', 'type', 'estimated_project_cost',
        'title', coalesce(nullif(code, ''), nullif(client_name, ''), 'Project') || ' has estimated costs to confirm',
        'detail', estimated_scope_count || ' project scope' || case when estimated_scope_count = 1 then '' else 's' end || ' still use estimated cost.',
        'impact', 'RM ' || to_char(round(estimated_cost, 0), 'FM999G999G990'),
        'due_date', null, 'amount', estimated_cost,
        'tool_id', 'Project Revenue vs Expenses (P&L)', 'action_label', 'Review Project P&L'
      ) as item, 2 as severity_rank, null::date as due_date, estimated_cost as amount
      from public.hub_pl_project_financials_v1
      where lower(coalesce(status, '')) <> 'cancelled' and estimated_scope_count > 0
    ) ranked;
    v_items := v_items || v_domain;
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'project_pl', 'message', sqlerrm));
  end;

  -- Real due-date exceptions from operational billing tools.
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', source || ':' || lower(alarm_type) || ':' || coalesce(ref, '') || ':' || due_date::text,
      'domain', 'finance',
      'severity', case when due_date < v_as_of then 'critical' else 'warning' end,
      'type', lower(alarm_type), 'title', ref, 'detail', detail,
      'impact', case when due_date < v_as_of then 'Overdue' else 'Due soon' end,
      'due_date', due_date, 'amount', null,
      'tool_id', tool_id, 'action_label', action_label
    ) order by due_date), '[]'::jsonb) into v_domain
    from (
      select 'scaffold'::text source, alarm_type, ref, detail, due_date,
        'Scaffold & Green Tag System'::text tool_id, 'Open scaffold invoices'::text action_label
      from public.scf_alarms where lower(alarm_type) = 'invoice'
      union all
      select 'storage', alarm_type, ref, detail, due_date,
        'Temporary Storage Rental', 'Open storage invoices'
      from public.str_alarms where upper(alarm_type) in ('INVOICE_OVERDUE', 'INVOICE_DUE')
      union all
      select 'transport', alarm_type, ref, detail, due_date,
        'Transport / Mover / Rorobin', 'Open transport invoices'
      from public.trn_alarms where upper(alarm_type) = 'INVOICE_OVERDUE'
    ) invoice_alarms;
    v_items := v_items || v_domain;
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'operational_billing', 'message', sqlerrm));
  end;

  -- Work queue summaries. Claims and expenses are records, not approval queues.
  begin
    with project_receivables as (
      select
        count(*) filter (where invoice_evidence and lower(coalesce(status, '')) <> 'cancelled' and client_outstanding > 0) as item_count,
        coalesce(sum(greatest(client_outstanding, 0)) filter (
          where invoice_evidence and lower(coalesce(status, '')) <> 'cancelled'), 0) as amount
      from public.hub_pl_project_financials_v1
    ), operational_overdue as (
      select count(*) as item_count, coalesce(sum(balance), 0) as amount
      from (
        select greatest(i.total - coalesce(p.paid, 0), 0) as balance
        from public.scf_invoices i
        left join (select invoice_id, sum(amount) paid from public.scf_payments group by invoice_id) p on p.invoice_id = i.id
        where coalesce(i.status, '') <> 'Void' and i.due_date < v_as_of and i.total - coalesce(p.paid, 0) > 0.005
        union all
        select greatest(i.total - coalesce(p.paid, 0), 0)
        from public.str_invoices i
        left join (select invoice_id, sum(amount) paid from public.str_payments group by invoice_id) p on p.invoice_id = i.id
        where coalesce(i.status, '') <> 'Void' and i.due_date < v_as_of and i.total - coalesce(p.paid, 0) > 0.005
        union all
        select greatest(i.total - coalesce(p.paid, 0), 0)
        from public.trn_invoices i
        left join (select invoice_id, sum(amount) paid from public.trn_payments group by invoice_id) p on p.invoice_id = i.id
        where coalesce(i.status, '') <> 'Void' and coalesce(i.due_date, '') <> ''
          and i.due_date::date < v_as_of and i.total - coalesce(p.paid, 0) > 0.005
      ) overdue_rows
    )
    select jsonb_build_object(
      'project_count', pr.item_count, 'project_amount', pr.amount,
      'overdue_count', oo.item_count, 'overdue_amount', oo.amount
    ) into v_domain from project_receivables pr cross join operational_overdue oo;
    v_queues := v_queues || jsonb_build_object('receivables', v_domain);
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'receivables', 'message', sqlerrm));
  end;

  begin
    select jsonb_build_object(
      'subcontractor_count', count(*) filter (where subcontractor_outstanding > 0),
      'subcontractor_amount', coalesce(sum(greatest(subcontractor_outstanding, 0)), 0),
      'supplier_count', count(*) filter (where supplier_outstanding > 0),
      'supplier_amount', coalesce(sum(greatest(supplier_outstanding, 0)), 0)
    ) into v_domain
    from public.hub_pl_project_financials_v1
    where lower(coalesce(status, '')) <> 'cancelled';
    v_queues := v_queues || jsonb_build_object('payables', v_domain);
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'payables', 'message', sqlerrm));
  end;

  begin
    select jsonb_build_object(
      'claims_count', (select count(*) from public.clm_claims where status = 'submitted'),
      'claims_amount', (select coalesce(sum(total), 0) from public.clm_claims where status = 'submitted'),
      'expense_count', (select count(*) from public.exp_expenses where type = 'business' and receipt_date >= v_month_start and receipt_date < v_month_end),
      'expense_amount', (select coalesce(sum(amount), 0) from public.exp_expenses where type = 'business' and receipt_date >= v_month_start and receipt_date < v_month_end)
    ) into v_domain;
    v_queues := v_queues || jsonb_build_object('claims_expenses', v_domain);
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'claims_expenses', 'message', sqlerrm));
  end;

  begin
    select jsonb_build_object(
      'subcon_invoice_count', (select count(*) from public.sci_invoices where inv_date >= v_month_start and inv_date < v_month_end),
      'subcon_invoice_amount', (select coalesce(sum(total), 0) from public.sci_invoices where inv_date >= v_month_start and inv_date < v_month_end),
      'open_quote_count', (select count(*) from public.quotes where status in ('Draft', 'Sent')),
      'open_quote_amount', (select coalesce(sum(total), 0) from public.quotes where status in ('Draft', 'Sent'))
    ) into v_domain;
    v_queues := v_queues || jsonb_build_object('invoice_production', v_domain);
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'invoice_production', 'message', sqlerrm));
  end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'at', at, 'actor', user_email, 'action_code', action, 'detail', details,
      'domain', 'finance',
      'tool_id', case
        when action ilike '[P&L]%' then 'Project Revenue vs Expenses (P&L)'
        when action ilike 'claim.%' or action ilike 'summary.%' then 'Receipt Claims'
        when action ilike 'EXP %' then 'Expenses Receipt System'
        when action ilike 'invoice.%' then 'Subcon Invoice Generator'
        when action ilike 'SCF %' then 'Scaffold & Green Tag System'
        else null end
    ) order by at desc), '[]'::jsonb) into v_activity
    from (
      select at, user_email, action, details
      from public.audit_log
      where action ilike '[P&L]%'
         or action ilike 'claim.%'
         or action ilike 'summary.%'
         or action ilike 'EXP %'
         or action ilike 'invoice.%'
         or action ilike 'SCF %'
         or action in ('CREATE Invoice', 'UPDATE Invoice', 'AUTO_INVOICE')
      order by at desc
      limit 20
    ) recent;
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'audit_log', 'message', sqlerrm));
  end;

  select jsonb_build_object(
    'total', jsonb_array_length(v_items),
    'critical', (select count(*) from jsonb_array_elements(v_items) i where i->>'severity' = 'critical'),
    'warning', (select count(*) from jsonb_array_elements(v_items) i where i->>'severity' = 'warning'),
    'items', coalesce((
      select jsonb_agg(item)
      from (
        select item
        from jsonb_array_elements(v_items) item
        order by case item->>'severity' when 'critical' then 1 when 'warning' then 2 else 3 end,
          nullif(item->>'due_date', '')::date nulls last,
          coalesce((item->>'amount')::numeric, 0) desc
        limit v_limit
      ) limited
    ), '[]'::jsonb)
  ) into v_attention;

  return jsonb_build_object(
    'version', 'finance-home-v1', 'as_of', v_as_of, 'timezone', 'Asia/Kuala_Lumpur',
    'generated_at', now(),
    'role', jsonb_build_object(
      'home_mode', 'finance', 'finance_role', v_role,
      'can_manage_users', v_role = 'Admin'),
    'snapshot', v_snapshot, 'attention', v_attention,
    'queues', v_queues, 'activity', v_activity, 'unavailable', v_unavailable
  );
end;
$$;

revoke execute on function public.hub_finance_home_v1(date, int) from public, anon, authenticated;
grant execute on function public.hub_finance_home_v1(date, int) to authenticated;

comment on function public.hub_finance_home_v1(date, int) is
  'Protected read-only Finance Home V1 summary. Requires Project P&L Admin or Manager access.';
