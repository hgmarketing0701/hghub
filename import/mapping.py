# Mapping registry: xlsx file -> target tables.
# Default rule: table = prefix + snake_case(tab name); explicit overrides below win.
# Tabs in SKIP are not imported (computed pivots / empty / superseded per AI-HANDOFF).
# AUDIT_* describe the shared audit-log column variants (handoff §3).

FILES = {
    "01-inventory-v5-LIVE.xlsx": {
        "prefix": "inv_",
        "overrides": {"AuditLog": "audit_log6"},
    },
    "02-smart-quotation.xlsx": {
        "prefix": "",
        "overrides": {
            "Malls": "malls", "Services": "services", "PriceBook": "price_book",
            "Settings": "app_settings", "Quotes": "quotes", "QuoteLines": "quote_lines",
            "AuditLog": "audit_log4",
        },
    },
    "03-hoarding-pricing.xlsx": {
        "prefix": "hrd_",
        "overrides": {"AuditLog": "audit_log6", "Config": "hrd_config",
                      "PriceHistory": "hrd_price_history", "SupplierPrices": "hrd_supplier_prices"},
    },
    "04-expenses.xlsx": {"prefix": "exp_", "overrides": {"AuditLog": "audit_log5"}},
    "05-payable.xlsx": {
        "prefix": "ap_",
        "overrides": {"PaymentRequests": "ap_payment_requests", "AuditLog": "ap_audit_log"},
    },
    "06-receivable.xlsx": {
        "prefix": "ar_",
        "overrides": {"PaymentsReceived": "ar_payments_received", "AuditLog": "ar_audit_log"},
    },
    "07-workers.xlsx": {
        "prefix": "wkr_",
        "overrides": {"AuditLog": "audit_log6", "Config": "app_settings",
                      "WorkPermitWorkers": "wkr_permit_workers",
                      "WorkPermitAttachments": "wkr_permit_attachments",
                      "WorkPermits": "wkr_work_permits",
                      "SwmsPPE": "wkr_swms_ppe",
                      "InsurancePolicyAttachments": "wkr_insurance_attachments",
                      "InsurancePolicyQuotes": "wkr_insurance_quotes",
                      "InsurancePolicyPayments": "wkr_insurance_payments"},
    },
    "08-job-report.xlsx": {
        "prefix": "jcr_",
        "overrides": {"JCR Summary": "jcr_reports"},
    },
    "09-project-pl.xlsx": {
        "prefix": "pl_",
        "overrides": {"Clients": "clients", "AuditLog": "pl_audit_log",
                      "MaterialItems": "pl_material_items", "UserRoles": "pl_user_roles",
                      "JobScopes": "pl_job_scopes", "ClientPayments": "pl_client_payments",
                      "SubconPayments": "pl_subcon_payments", "SupplierPayments": "pl_supplier_payments",
                      "SubconCharges": "pl_subcon_charges", "DailyReports": "pl_daily_reports",
                      "ProjectPhotos": "pl_project_photos", "CreditNotes": "pl_credit_notes"},
    },
    "10-storage-rental.xlsx": {
        "prefix": "str_",
        "overrides": {"AuditLog": "audit_log6", "Config": "str_config"},
        "skip": ["Reminders"],  # superseded by str_alarms view
    },
    "11-scaffold-greentag.xlsx": {
        "prefix": "scf_",
        "overrides": {"AuditLog": "audit_log6", "Config": "scf_settings"},
    },
    "12-transport.xlsx": {
        "prefix": "trn_",
        "overrides": {"AuditLog": "audit_log6", "Config": "trn_settings"},
    },
    "13-job-arrangement.xlsx": {
        "prefix": "ja_",
        "overrides": {
            "AuditLog": "ja_audit_log",
            # single-column list tabs consolidate into ja_lookups(type, value)
            "Malls": "ja_lookups:mall", "Clients": "ja_lookups:client",
            "ScopeFactory": "ja_lookups:scope_factory", "ScopeOnsite": "ja_lookups:scope_onsite",
            "MallStates": "ja_mall_states", "AttendanceLog": "ja_attendance_log",
            "VehicleLog": "ja_vehicle_log", "WageAdjustments": "ja_wage_adjustments",
            "ShiftConflictReviews": "ja_shift_conflict_reviews",
        },
        "skip": ["Monthly Summary"],
    },
    "13-dispatch-db.xlsx": {
        "prefix": "dsp_",
        "overrides": {"AuditLog": "dsp_audit_log", "Config": "dsp_config"},
    },
    "14-attendance.xlsx": {"prefix": "att_", "overrides": {"Records": "att_records"}},
    "15-fleet-command-center.xlsx": {
        "prefix": "flt_",
        "overrides": {"ImportLog": "flt_import_log"},
    },
    "16-hoarding-library.xlsx": {
        "prefix": "hlib_",
        "overrides": {"Records": "hlib_records", "Rates": "hlib_rates", "MailBotLog": "hlib_mailbot_log"},
    },
    "17-mall-platform.xlsx": {
        "prefix": "mp_",
        "overrides": {"AuditLog": "audit_log4",
                      "RequirementTypes": "mp_requirement_types", "JobCategories": "mp_job_categories",
                      "PanelRates": "mp_panel_rates", "ShopTypes": "mp_shop_types",
                      "RateBasis": "mp_rate_basis", "SwmsServices": "mp_swms_services",
                      "SwmsSteps": "mp_swms_steps", "SwmsEquipment": "mp_swms_equipment",
                      "SwmsPPE": "mp_swms_ppe", "TeamMembers": "mp_team_members",
                      "MeasureTypes": "mp_measure_types", "MeasureRequests": "mp_measure_requests",
                      "HoardingLines": "mp_hoarding_lines"},
    },
    "18-team-command.xlsx": {
        "prefix": "tc_",
        "overrides": {"scaffoldMaterials": "tc_scaffold_materials", "greenTagLogs": "tc_green_tag_logs",
                      "rorobinEvents": "tc_rorobin_events", "storageReminders": "tc_storage_reminders",
                      "hoardingQuotes": "tc_hoarding_quotes", "_SyncLog": "tc_sync_log",
                      "settings": "tc_settings"},
        "dynamic_json": True,  # unmatched headers fold into the _json column, not errors
    },
    "19-claims.xlsx": {
        "prefix": "clm_",
        "overrides": {"AuditLog": "audit_log6", "ClaimLines": "clm_claim_lines"},
    },
    "20-visual-works.xlsx": {
        "prefix": "vis_",
        "overrides": {"AuditLog": "audit_log6", "JobPanels": "vis_job_panels",
                      "InvoiceJobs": "vis_invoice_jobs"},
    },
    "21-subcon-invoice.xlsx": {
        "prefix": "sci_",
        "overrides": {"AuditLog": "audit_log6", "InvoiceLines": "sci_invoice_lines"},
    },
    "24-lorry.xlsx": {
        "prefix": "lry_",
        "overrides": {"Lorries": "lry_vehicles", "AuditLog": "audit_log6",
                      "ComplianceLogs": "lry_compliance_logs", "FuelLogs": "lry_fuel_logs",
                      "TollParkLogs": "lry_toll_park_logs", "MaintLogs": "lry_maint_logs",
                      "IncidentLogs": "lry_incident_logs", "SummonLogs": "lry_summon_logs",
                      "InvoiceLineItems": "lry_invoice_line_items",
                      "CartrackTrips": "lry_cartrack_trips",
                      "ShellSubsidySummary": "lry_shell_subsidy_summary",
                      "ImportLog": "lry_import_log"},
    },
    "25-4d-tracker.xlsx": {
        "prefix": "fd_",
        "overrides": {"Results": "fd_results"},
        "skip": ["Sheet1"],
    },
    # skipped entirely per AI-HANDOFF §9:
    "01-inventory-v1-old.xlsx": {"skip_file": True},
    "01-inventory-v2-old.xlsx": {"skip_file": True},
    "22-blog-linkedin.xlsx": {"skip_file": True},        # headers only
    "22-blog-linkedin-duplicate-sheet.xlsx": {"skip_file": True},
}

# Shared audit-log variants (handoff §3) → foundation audit_log(at, user_email, action,
# record_type, record_id, details). Missing columns become NULL.
AUDIT_VARIANTS = {
    "audit_log6": ["at", "user_email", "action", "record_type", "record_id", "details"],
    "audit_log5": ["at", "user_email", "action", "record_id", "details"],
    "audit_log4": ["at", "user_email", "action", "details"],
}

# Per-table header→column fixes where normalization can't guess the rename the
# schema modules chose. Filled iteratively from report.md until it is empty.
# Value "-" = header intentionally dropped (no target column).
COLUMN_OVERRIDES = {
    "price_book":        {"Updated On": "updated_at"},
    "quotes":            {"Date": "quote_date", "Client": "client_name", "Created On": "created_at"},
    "hrd_quotes":        {"date": "quote_date", "dataJson": "data"},
    "hrd_supplier_prices": {"recordedAt": "created_at", "recordedBy": "created_by"},
    "hrd_price_history": {"user": "user_email"},
    "exp_expenses":      {"submittedBy": "created_by"},
    "app_settings":      {"notes": "-"},  # key/value store has no notes column
    "pl_audit_log":      {"timestamp": "at"},
    "trn_trips":         {"crewJson": "crew"},
    "trn_jobs":          {"stopsJson": "stops"},
    "ja_audit_log":      {"timestamp": "ts", "actor": "user_email", "detail": "details"},
    "hlib_records":      {"Files (JSON)": "files"},
    "mp_malls":          {"Added On": "created_at"},
    "mp_hoarding_lines": {"Created On": "created_at"},
    "mp_measure_requests": {"Date": "req_date", "Updated On": "updated_at"},
    "mp_requirements":   {"Updated On": "updated_at"},
    "mp_panels":         {"Updated On": "updated_at"},
    "mp_panel_rates":    {"Updated On": "updated_at"},
    "mp_sketches":       {"Timestamp": "created_at"},
    # 24-lorry: xlsx stores Google-Drive file-ID JSON arrays; nearest columns are the
    # *_path(s) fields the tools read. Legacy Drive IDs preserved (files not migrating).
    "lry_vehicles":      {"vehicleCardPhotoId": "vehicle_card_path", "Type": "vehicle_type", "Lorry Code": "vehicle_code"},
    "lry_drivers":       {"photoId": "photo_path", "licenseDocIds": "license_doc_paths",
                          "icDocIds": "ic_doc_paths", "licenseNo": "license_number"},
    "lry_summon_logs":   {"paymentProofIds": "payment_proof_paths", "summonCopyIds": "summon_copy_paths"},
    "lry_incident_logs": {"incidentPhotoIds": "incident_photo_paths", "policeReportIds": "police_report_paths",
                          "quotationIds": "quotation_paths", "compensationPaidIds": "compensation_paid_paths",
                          "compensationReceivedIds": "compensation_received_paths"},
    "lry_compliance_logs": {"mainDocIds": "main_doc_paths", "receiptIds": "receipt_paths",
                            "agentInvoiceIds": "agent_invoice_paths", "paymentSlipIds": "payment_slip_paths"},
    "lry_fuel_logs":     {"pumpPhotoId": "pump_photo_path", "receiptPhotoId": "receipt_photo_path"},
    "lry_toll_park_logs": {"receiptPhotoId": "receipt_photo_path"},
    "lry_maint_logs":    {"receiptPhotoIds": "receipt_photo_paths", "beforePhotoIds": "before_photo_paths",
                          "afterPhotoIds": "after_photo_paths", "paymentSlipIds": "payment_slip_paths"},
    # workers: Drive URLs land in the tools' file_url columns
    "wkr_permit_attachments": {"driveUrl": "file_url"},
    "wkr_insurance_attachments": {"driveUrl": "file_url"},
    "wkr_insurance_policies": {"driveUrl": "file_url"},
    "wkr_workers":       {"photoDriveUrl": "photo_url"},
    "wkr_documents":     {"driveUrl": "file_url"},
    "wkr_permit_forms":  {"driveUrl": "file_url"},
    "wkr_work_permits":  {"driveUrl": "file_url", "insuranceDriveUrl": "insurance_file_url"},
}
