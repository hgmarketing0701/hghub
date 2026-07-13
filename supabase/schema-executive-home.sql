-- ============================================================================
-- HG HUB — EXECUTIVE HOME V1
-- Run after schema.sql, schema-project-pl.sql, and the operational tool schemas.
-- Additive and safe to re-run.
-- ============================================================================

-- ── 1. Durable Home assignment (temporary view switching stays client-side) ──
alter table public.allowed_users
  add column if not exists home_mode text not null default 'operations';

alter table public.allowed_users
  drop constraint if exists allowed_users_home_mode_check;
alter table public.allowed_users
  add constraint allowed_users_home_mode_check
  check (home_mode in ('operations', 'executive'));

update public.allowed_users
set home_mode = 'executive'
where lower(email) in ('lee@hggroup.com.my', 'marketing@hggroup.com.my');

-- Generic team-access screens can add the established allowlist fields, but
-- cannot assign or change a Home persona through the Data API.
revoke insert, update on table public.allowed_users from public, anon, authenticated;
grant insert (email, full_name, is_admin, added_by)
  on table public.allowed_users to authenticated;
grant update (full_name, is_admin, added_by)
  on table public.allowed_users to authenticated;

create or replace function public.hub_my_home_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select au.home_mode
  from public.allowed_users au
  where lower(au.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function public.hub_is_executive()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.allowed_users au
    where lower(au.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and au.home_mode = 'executive'
  );
$$;

revoke execute on function public.hub_my_home_mode() from public, anon, authenticated;
revoke execute on function public.hub_is_executive() from public, anon, authenticated;
grant execute on function public.hub_my_home_mode() to authenticated;

-- ── 2. Internal project financial parity view ──────────────────────────────
create or replace view public.hub_pl_project_financials_v1
with (security_invoker = true)
as
with scope_rows as (
  select
    s.project_id,
    case
      when coalesce(s.client_amount, 0) = 0
       and coalesce(s.qty, 0) = 0
       and coalesce(s.client_rate, 0) > 0 then coalesce(s.client_rate, 0)
      else coalesce(s.client_amount, 0)
    end as client_value,
    case
      when coalesce(nullif(s.performed_by, ''), 'Subcon') <> 'Subcon' then 0
      when coalesce(nullif(s.cost_confirmation, ''), 'Confirmed') in ('Absorbed', 'None') then 0
      when coalesce(s.subcon_amount, 0) = 0
       and coalesce(s.qty, 0) = 0
       and coalesce(s.subcon_rate, 0) > 0 then coalesce(s.subcon_rate, 0)
      else coalesce(s.subcon_amount, 0)
    end as subcon_value,
    case
      when coalesce(nullif(s.performed_by, ''), 'Subcon') = 'OtherDivision'
       and coalesce(nullif(s.cost_confirmation, ''), 'Confirmed') not in ('Absorbed', 'None')
        then coalesce(s.internal_cost, 0)
      else 0
    end as internal_value,
    case when coalesce(nullif(s.cost_confirmation, ''), 'Confirmed') = 'Estimated' then 1 else 0 end as estimated_count,
    case
      when coalesce(nullif(s.cost_confirmation, ''), 'Confirmed') <> 'Estimated' then 0
      when coalesce(nullif(s.performed_by, ''), 'Subcon') = 'OtherDivision' then coalesce(s.internal_cost, 0)
      when coalesce(nullif(s.performed_by, ''), 'Subcon') = 'Subcon' then
        case
          when coalesce(s.subcon_amount, 0) = 0
           and coalesce(s.qty, 0) = 0
           and coalesce(s.subcon_rate, 0) > 0 then coalesce(s.subcon_rate, 0)
          else coalesce(s.subcon_amount, 0)
        end
      else 0
    end as estimated_value
  from public.pl_job_scopes s
),
scope_totals as (
  select project_id,
    coalesce(sum(client_value), 0) as subtotal,
    coalesce(sum(subcon_value), 0) as scope_subcon,
    coalesce(sum(internal_value), 0) as internal_cost,
    coalesce(sum(estimated_count), 0)::int as estimated_scope_count,
    coalesce(sum(estimated_value), 0) as estimated_cost
  from scope_rows group by project_id
),
material_totals as (
  select project_id,
    coalesce(sum(total_cost) filter (where coalesce(material_source, 'Supplier') <> 'InHouseSubcon'), 0) as supplier_material_cost,
    coalesce(sum(total_cost) filter (where material_source = 'InHouseSubcon'), 0) as inhouse_deduction
  from public.pl_materials group by project_id
),
charge_totals as (
  select project_id, coalesce(sum(lump_amount), 0) as lump_subcon
  from public.pl_subcon_charges group by project_id
),
manpower_totals as (
  select project_id, coalesce(sum(total_cost), 0) as manpower_cost
  from public.pl_manpower group by project_id
),
client_paid as (
  select project_id, coalesce(sum(amount), 0) as received
  from public.pl_client_payments group by project_id
),
subcon_paid as (
  select project_id, coalesce(sum(amount), 0) as paid_subcon
  from public.pl_subcon_payments group by project_id
),
supplier_paid as (
  select project_id, coalesce(sum(amount), 0) as paid_supplier
  from public.pl_supplier_payments group by project_id
),
credit_totals as (
  select project_id,
    round(coalesce(sum(amount) filter (where type in ('credit', 'refund')), 0), 2) as credits_refunds
  from public.pl_credit_notes group by project_id
),
base as (
  select
    p.*,
    coalesce(st.subtotal, 0) as subtotal,
    coalesce(st.scope_subcon, 0) as scope_subcon,
    coalesce(st.internal_cost, 0) as internal_cost,
    coalesce(st.estimated_scope_count, 0) as estimated_scope_count,
    coalesce(st.estimated_cost, 0) as estimated_cost,
    coalesce(mt.supplier_material_cost, 0) as supplier_material_cost,
    coalesce(mt.inhouse_deduction, 0) as inhouse_deduction,
    coalesce(ct.lump_subcon, 0) as lump_subcon,
    coalesce(mpt.manpower_cost, 0) as manpower_cost,
    coalesce(cp.received, 0) as received,
    coalesce(sp.paid_subcon, 0) as paid_subcon,
    coalesce(spp.paid_supplier, 0) as paid_supplier,
    coalesce(cr.credits_refunds, 0) as credits_refunds
  from public.pl_projects p
  left join scope_totals st on st.project_id = p.id
  left join material_totals mt on mt.project_id = p.id
  left join charge_totals ct on ct.project_id = p.id
  left join manpower_totals mpt on mpt.project_id = p.id
  left join client_paid cp on cp.project_id = p.id
  left join subcon_paid sp on sp.project_id = p.id
  left join supplier_paid spp on spp.project_id = p.id
  left join credit_totals cr on cr.project_id = p.id
),
invoice_calc as (
  select b.*,
    b.subtotal - coalesce(b.discount, 0) + coalesce(b.adjustment, 0) as after_adjustment,
    case when coalesce(b.sst_applicable, false)
      then round((b.subtotal - coalesce(b.discount, 0) + coalesce(b.adjustment, 0))
        * coalesce(nullif(b.sst_rate, 0), 6) / 100, 2)
      else 0 end as sst_amount,
    round(b.scope_subcon + b.lump_subcon - b.inhouse_deduction, 2) as subcon_committed
  from base b
),
money as (
  select i.*,
    round(i.after_adjustment + i.sst_amount, 2) as computed_total,
    coalesce(nullif(i.invoice_amount, 0), nullif(round(i.after_adjustment + i.sst_amount, 2), 0), i.subtotal) as invoiced_gross,
    (i.invoice_date is not null or coalesce(trim(i.invoice_number), '') <> '' or coalesce(i.invoice_amount, 0) <> 0) as invoice_evidence,
    coalesce(i.invoice_amount, 0) = 0 as used_computed_invoice
  from invoice_calc i
),
final_values as (
  select m.*,
    round(m.invoiced_gross - m.credits_refunds, 2) as invoiced,
    round(m.invoiced_gross - m.credits_refunds - m.sst_amount, 2) as net_revenue,
    m.subcon_committed + m.supplier_material_cost + m.manpower_cost + m.internal_cost as total_cost
  from money m
)
select
  f.id, f.code, f.client_name, f.status, f.invoice_date, f.invoice_number,
  f.invoice_evidence, f.used_computed_invoice,
  round(f.subtotal, 2) as subtotal,
  f.sst_amount, f.invoiced, f.net_revenue, f.received,
  f.invoiced - f.received as client_outstanding,
  f.subcon_committed, f.supplier_material_cost,
  f.manpower_cost, f.internal_cost,
  f.total_cost, f.net_revenue - f.total_cost as profit,
  case when f.net_revenue > 0 then (f.net_revenue - f.total_cost) / f.net_revenue * 100 else 0 end as margin,
  f.estimated_cost, f.estimated_scope_count,
  f.subcon_committed - f.paid_subcon as subcontractor_outstanding,
  f.supplier_material_cost - f.paid_supplier as supplier_outstanding
from final_values f;

revoke select on public.hub_pl_project_financials_v1 from public, anon, authenticated;

-- ── 3. Protected Executive Home summary ────────────────────────────────────
create or replace function public.hub_executive_home_v1(
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
  v_month_start date;
  v_month_end date;
  v_limit int := greatest(1, least(coalesce(p_attention_limit, 20), 100));
  v_finance_role text;
  v_snapshot jsonb := '{}'::jsonb;
  v_execution jsonb := '{}'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_activity jsonb := '[]'::jsonb;
  v_quality jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_fin jsonb;
  v_domain jsonb;
  v_sorted_items jsonb := '[]'::jsonb;
  v_attention jsonb;
begin
  if not public.hub_is_executive() then
    raise exception 'Executive Home access required.' using errcode = '42501';
  end if;

  v_month_start := date_trunc('month', v_as_of)::date;
  v_month_end := (v_month_start + interval '1 month')::date;
  v_finance_role := public.pl_role();

  -- Quotations
  begin
    select jsonb_build_object(
      'value', coalesce(sum(q.total), 0), 'count', count(*), 'unit', 'MYR',
      'status', case when count(*) = 0 then 'clear' else 'watch' end,
      'basis', 'Draft and sent', 'source', 'quotes'
    ) into v_domain
    from public.quotes q where q.status in ('Draft', 'Sent');
    v_snapshot := v_snapshot || jsonb_build_object('open_quotations', v_domain);
  exception when others then
    v_snapshot := v_snapshot || jsonb_build_object('open_quotations', jsonb_build_object('value', null, 'status', 'unavailable'));
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'quotes', 'message', sqlerrm));
  end;

  -- Project financials
  if v_finance_role in ('Admin', 'Manager') then
    begin
      select jsonb_build_object(
        'active_projects', jsonb_build_object(
          'value', count(*) filter (where lower(status) = 'active'), 'unit', 'count',
          'status', 'clear', 'basis', 'Project P&L', 'source', 'hub_pl_project_financials_v1'),
        'net_revenue_mtd', jsonb_build_object(
          'value', coalesce(sum(net_revenue) filter (where invoice_date >= v_month_start and invoice_date < v_month_end), 0),
          'unit', 'MYR', 'status', 'clear', 'basis', 'Invoice-date cohort · ex-SST', 'source', 'hub_pl_project_financials_v1'),
        'client_outstanding', jsonb_build_object(
          'value', coalesce(sum(greatest(client_outstanding, 0)) filter (where invoice_evidence and lower(coalesce(status, '')) <> 'cancelled'), 0),
          'count', count(*) filter (where invoice_evidence and lower(coalesce(status, '')) <> 'cancelled' and client_outstanding > 0),
          'unit', 'MYR', 'status', case when count(*) filter (where invoice_evidence and lower(coalesce(status, '')) <> 'cancelled' and client_outstanding > 0) = 0 then 'clear' else 'watch' end,
          'basis', 'All invoiced tracked projects', 'source', 'hub_pl_project_financials_v1'),
        'profit_mtd', jsonb_build_object(
          'value', coalesce(sum(profit) filter (where invoice_date >= v_month_start and invoice_date < v_month_end), 0),
          'margin', case when coalesce(sum(net_revenue) filter (where invoice_date >= v_month_start and invoice_date < v_month_end), 0) > 0
            then round(coalesce(sum(profit) filter (where invoice_date >= v_month_start and invoice_date < v_month_end), 0)
              / sum(net_revenue) filter (where invoice_date >= v_month_start and invoice_date < v_month_end) * 100, 2)
            else 0 end,
          'unit', 'MYR', 'status', case when coalesce(sum(profit) filter (where invoice_date >= v_month_start and invoice_date < v_month_end), 0) < 0 then 'critical' else 'clear' end,
          'basis', 'Projects invoiced this month · full project-to-date cost', 'source', 'hub_pl_project_financials_v1')
      ) into v_fin
      from public.hub_pl_project_financials_v1;
      v_snapshot := v_snapshot || v_fin;

      select coalesce(jsonb_agg(jsonb_build_object(
        'code', code, 'message', message, 'project_id', id
      )), '[]'::jsonb) into v_domain
      from (
        select id, code, 'Computed invoice fallback used'::text as message
        from public.hub_pl_project_financials_v1 where invoice_evidence and used_computed_invoice
        union all
        select id, code, 'Invoice date missing'
        from public.hub_pl_project_financials_v1 where invoice_evidence and invoice_date is null
      ) q;
      v_quality := v_quality || v_domain;

      select coalesce(jsonb_agg(jsonb_build_object(
        'item_key', 'finance:loss:' || id::text,
        'domain', 'finance', 'severity', 'critical', 'type', 'negative_project_profit',
        'title', coalesce(nullif(code, ''), client_name, 'Project') || ' is below cost',
        'detail', 'Project profit ' || to_char(profit, 'FM999,999,990.00'),
        'owner', null, 'due_date', invoice_date, 'amount', abs(profit),
        'source', 'hub_pl_project_financials_v1', 'source_ref', id::text,
        'tool_id', 'Project Revenue vs Expenses (P&L)', 'tool_tab', null, 'action_label', 'Open Project P&L'
      )), '[]'::jsonb) into v_domain
      from public.hub_pl_project_financials_v1
      where lower(status) = 'active' and net_revenue > 0 and profit < 0;
      v_items := v_items || v_domain;
    exception when others then
      v_snapshot := v_snapshot || jsonb_build_object(
        'active_projects', jsonb_build_object('value', null, 'status', 'unavailable'),
        'net_revenue_mtd', jsonb_build_object('value', null, 'status', 'unavailable'),
        'client_outstanding', jsonb_build_object('value', null, 'status', 'unavailable'),
        'profit_mtd', jsonb_build_object('value', null, 'status', 'unavailable'));
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'project_pl', 'message', sqlerrm));
    end;
  else
    v_snapshot := v_snapshot || jsonb_build_object(
      'active_projects', jsonb_build_object('value', null, 'status', 'unavailable'),
      'net_revenue_mtd', jsonb_build_object('value', null, 'status', 'unavailable'),
      'client_outstanding', jsonb_build_object('value', null, 'status', 'unavailable'),
      'profit_mtd', jsonb_build_object('value', null, 'status', 'unavailable'));
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'project_pl', 'message', 'Project P&L Admin or Manager required'));
  end if;

  -- Dispatch execution and attention
  begin
    with alarms as (select * from public.dsp_alarms),
    active as (select * from public.dsp_jobs where job_status not in ('done', 'cancelled'))
    select jsonb_build_object(
      'active', (select count(*) from active),
      'permit_alarms', count(*) filter (where alarm_type = 'permit_alarm'),
      'at_risk', count(*) filter (where alarm_type = 'at_risk'),
      'blocked', count(*) filter (where alarm_type = 'blocked'),
      'ready', greatest((select count(*) from active) - count(distinct ref), 0)
    ) into v_domain from alarms;
    v_execution := v_execution || jsonb_build_object('dispatch', v_domain);

    select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', 'dispatch:' || lower(alarm_type) || ':' || coalesce(ref, '') || ':' || coalesce(due_date::text, ''),
      'domain', 'dispatch',
      'severity', case when alarm_type = 'permit_alarm' and due_date <= v_as_of then 'critical'
        when alarm_type = 'blocked' and due_date <= v_as_of then 'critical' else 'warning' end,
      'type', lower(alarm_type), 'title', coalesce(ref, 'Dispatch decision'), 'detail', detail,
      'owner', null, 'due_date', due_date, 'amount', null, 'source', 'dsp_alarms',
      'source_ref', ref, 'tool_id', 'Daily Readiness & Dispatch', 'tool_tab', null, 'action_label', 'Open dispatch'
    )), '[]'::jsonb) into v_domain from public.dsp_alarms;
    v_items := v_items || v_domain;
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'dispatch', 'message', sqlerrm));
  end;

  -- Workforce execution and attention
  begin
    select jsonb_build_object(
      'expired', count(*) filter (where due_date < v_as_of),
      'due_7_days', count(*) filter (where due_date >= v_as_of and due_date <= v_as_of + 7),
      'due_30_days', count(*) filter (where due_date > v_as_of + 7 and due_date <= v_as_of + 30)
    ) into v_domain from public.wkr_alarms;
    v_execution := v_execution || jsonb_build_object('workforce', v_domain);

    select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', 'workforce:' || lower(alarm_type) || ':' || coalesce(ref, '') || ':' || coalesce(due_date::text, ''),
      'domain', 'workforce', 'severity', case when due_date < v_as_of then 'critical' when due_date <= v_as_of + 7 then 'warning' else 'watch' end,
      'type', lower(alarm_type), 'title', coalesce(ref, 'Worker document'), 'detail', detail,
      'owner', null, 'due_date', due_date, 'amount', null, 'source', 'wkr_alarms',
      'source_ref', ref, 'tool_id', 'Workers Documentation & Permits', 'tool_tab', null, 'action_label', 'Open worker docs'
    )), '[]'::jsonb) into v_domain from public.wkr_alarms;
    v_items := v_items || v_domain;
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'workforce', 'message', sqlerrm));
  end;

  -- Scaffold and storage attention
  begin
    select jsonb_build_object(
      'scaffold_overdue', count(*) filter (where source = 'scaffold' and due_date < v_as_of),
      'scaffold_due', count(*) filter (where source = 'scaffold' and due_date >= v_as_of),
      'storage_overdue', count(*) filter (where source = 'storage' and (due_date < v_as_of or alarm_type ilike '%overdue%' or alarm_type ilike '%expired%')),
      'storage_due', count(*) filter (where source = 'storage' and due_date >= v_as_of)
    ) into v_domain
    from (
      select 'scaffold'::text source, alarm_type, due_date from public.scf_alarms
      union all select 'storage', alarm_type, due_date from public.str_alarms
    ) x;
    v_execution := v_execution || jsonb_build_object('scaffold_storage', v_domain);

    select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', source || ':' || lower(alarm_type) || ':' || coalesce(ref, '') || ':' || coalesce(due_date::text, ''),
      'domain', source, 'severity', case when due_date < v_as_of or alarm_type ilike '%overdue%' or alarm_type ilike '%expired%' then 'critical' when due_date <= v_as_of then 'warning' else 'watch' end,
      'type', lower(alarm_type), 'title', coalesce(ref, initcap(source) || ' decision'), 'detail', detail,
      'owner', null, 'due_date', due_date, 'amount', null, 'source', source || '_alarms',
      'source_ref', ref,
      'tool_id', case when source = 'scaffold' then 'Scaffold & Green Tag System' else 'Inventory, Tools & Purchasing' end,
      'tool_tab', null, 'action_label', case when source = 'scaffold' then 'Open scaffold' else 'Open inventory' end
    )), '[]'::jsonb) into v_domain
    from (
      select 'scaffold'::text source, alarm_type, ref, detail, due_date from public.scf_alarms
      union all select 'storage', alarm_type, ref, detail, due_date from public.str_alarms
    ) x;
    v_items := v_items || v_domain;
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'scaffold_storage', 'message', sqlerrm));
  end;

  -- Inventory on-hand matches the current Inventory tool.
  begin
    with purchased as (
      select material_id, coalesce(sum(qty), 0) qty from public.inv_purchase_lines
      where item_type = 'material' group by material_id
    ), delivered as (
      select material_id, coalesce(sum(qty), 0) qty from public.inv_stock_out_lines group by material_id
    ), stock as (
      select m.id, m.name, m.low_stock_threshold,
        coalesce(p.qty, 0) - coalesce(d.qty, 0) as on_hand
      from public.inv_materials m
      left join purchased p on p.material_id = m.id::text
      left join delivered d on d.material_id = m.id::text
    )
    select jsonb_build_object(
      'low_stock', count(*) filter (where on_hand <= low_stock_threshold),
      'critical', count(*) filter (where on_hand <= 0),
      'warning', count(*) filter (where on_hand > 0 and on_hand <= low_stock_threshold)
    ) into v_domain from stock;
    v_execution := v_execution || jsonb_build_object('inventory', v_domain);

    with purchased as (
      select material_id, coalesce(sum(qty), 0) qty from public.inv_purchase_lines where item_type = 'material' group by material_id
    ), delivered as (
      select material_id, coalesce(sum(qty), 0) qty from public.inv_stock_out_lines group by material_id
    ), stock as (
      select m.id, m.name, m.low_stock_threshold, coalesce(p.qty, 0) - coalesce(d.qty, 0) on_hand
      from public.inv_materials m left join purchased p on p.material_id = m.id::text left join delivered d on d.material_id = m.id::text
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', 'inventory:stock:' || id::text, 'domain', 'inventory',
      'severity', case when on_hand <= 0 then 'critical' else 'warning' end, 'type', 'low_stock',
      'title', name || ' needs stock review', 'detail', 'On hand ' || on_hand || ' · threshold ' || low_stock_threshold,
      'owner', null, 'due_date', null, 'amount', null, 'source', 'inv_materials', 'source_ref', id::text,
      'tool_id', 'Inventory, Tools & Purchasing', 'tool_tab', null, 'action_label', 'Open inventory'
    )), '[]'::jsonb) into v_domain from stock where on_hand <= low_stock_threshold;
    v_items := v_items || v_domain;
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'inventory', 'message', sqlerrm));
  end;

  -- Shared executive activity
  begin
    select coalesce(jsonb_agg(jsonb_build_object(
      'at', at, 'actor', user_email, 'action_code', action,
      'action_label', initcap(replace(replace(action, '_', ' '), '.', ' ')),
      'detail', details, 'domain', split_part(action, '.', 1),
      'tool_id', case
        when lower(action) like 'dsp.%' or lower(action) like '%dispatch%' then 'Daily Readiness & Dispatch'
        when lower(action) like 'wkr.%' or lower(action) like '%worker%' or lower(action) like '%permit%' then 'Workers Documentation & Permits'
        when lower(action) like 'scf.%' or lower(action) like '%scaffold%' or lower(action) like '%green%tag%' then 'Scaffold & Green Tag System'
        when lower(action) like 'inv.%' or lower(action) like '%inventory%' or lower(action) like '%stock%' then 'Inventory, Tools & Purchasing'
        when lower(action) like 'pl.%' or lower(action) like '%project%p&l%' then 'Project Revenue vs Expenses (P&L)'
        when lower(action) like '%quote%' then 'Smart Quotation'
        when lower(action) like '%site%' then 'Daily Site Tracking'
        when lower(action) like '%completion%' then 'Job Completion Report'
        else null end
    ) order by at desc), '[]'::jsonb) into v_activity
    from (select at, user_email, action, details from public.audit_log order by at desc limit 25) a;
  exception when others then
    v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('source', 'audit_log', 'message', sqlerrm));
  end;

  select coalesce(jsonb_agg(item order by
    case item->>'severity' when 'critical' then 1 when 'warning' then 2 else 3 end,
    nullif(item->>'due_date', '')::date nulls last,
    coalesce((item->>'amount')::numeric, 0) desc,
    item->>'item_key'
  ), '[]'::jsonb)
  into v_sorted_items
  from (
    select item from jsonb_array_elements(v_items) item
    order by case item->>'severity' when 'critical' then 1 when 'warning' then 2 else 3 end,
      nullif(item->>'due_date', '')::date nulls last,
      coalesce((item->>'amount')::numeric, 0) desc,
      item->>'item_key'
    limit v_limit
  ) ranked;

  v_attention := jsonb_build_object(
    'total', jsonb_array_length(v_items),
    'critical', (select count(*) from jsonb_array_elements(v_items) i where i->>'severity' = 'critical'),
    'warning', (select count(*) from jsonb_array_elements(v_items) i where i->>'severity' = 'warning'),
    'watch', (select count(*) from jsonb_array_elements(v_items) i where i->>'severity' = 'watch'),
    'items', v_sorted_items
  );

  v_snapshot := jsonb_build_object(
    'urgent_exceptions', jsonb_build_object(
      'value', (v_attention->>'critical')::int, 'unit', 'count',
      'status', case when (v_attention->>'critical')::int > 0 then 'critical' else 'clear' end,
      'basis', 'As of ' || v_as_of::text, 'source', 'executive_attention'
    )
  ) || v_snapshot;

  return jsonb_build_object(
    'version', 'executive-home-v1', 'as_of', v_as_of, 'timezone', 'Asia/Kuala_Lumpur',
    'generated_at', now(),
    'role', jsonb_build_object('home_mode', 'executive', 'finance_role', v_finance_role),
    'snapshot', v_snapshot, 'execution', v_execution, 'attention', v_attention,
    'activity', v_activity, 'data_quality', v_quality, 'unavailable', v_unavailable
  );
end;
$$;

revoke execute on function public.hub_executive_home_v1(date, int) from public, anon, authenticated;
grant execute on function public.hub_executive_home_v1(date, int) to authenticated;

comment on function public.hub_executive_home_v1(date, int) is
  'Protected read-only Executive Home V1 summary. Requires Executive Home and Project P&L money permission for finance output.';
