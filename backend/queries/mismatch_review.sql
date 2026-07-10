-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Mismatch Review — customer edits (AAI/NLU value vs the customer's correction)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Source-of-truth SQL for the Mismatch Review pull (used by ap_invoice_mismatch_data.py and the
-- backend server.py /api/get_data endpoint).
--
-- MODEL:  sor.wk_result_edits — original_json = the value AAI/NLU produced;
--                               final_json    = the value the customer edited it to.
--
-- THREE REVIEW SCENARIOS — one predicate at the bottom, enabled one at a time
-- (the dashboard pulls one "sheet"/scenario at a time):
--     • Record Type : original_json.recordType  != final_json.recordType
--     • Vendor Name : original_json.vendorName   != final_json.vendorName
--     • Entity Name : original_json.aaiEntityId   != final_json.aaiEntityId
--
-- PLACEHOLDERS filled at runtime by the pull script / backend:
--     TENANT_PLACEHOLDER · DATE_FROM_PLACEHOLDER · DATE_TO_PLACEHOLDER
--
-- Column aliases match the .xlsx headers the dashboard parses (see src/types/docClassification.ts).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
SELECT
    swre.wk_result_id                                              AS 'Document ID',
    swre.message_id                                                AS 'Message ID',
    t.name                                                         AS 'Tenant Name',
    swre.tenant_id                                                 AS 'Tenant ID',
    swre.created_at                                                AS 'created_at',
    swre.updated_at                                                AS 'updated_at',

    -- ── AAI (original_json) vs Customer (final_json) ────────────────────────────────────────────
    swre.original_json->>'$.vendorName'                            AS 'OriginalVendorName',   -- AAI VendorName
    swre.final_json->>'$.vendorName'                               AS 'Customer vendorName',
    swre.original_json->>'$.recordType'                            AS 'AAI RecordType',
    swre.final_json->>'$.recordType'                               AS 'Customer RecordType',
    swre.original_json->>'$.aaiEntityId'                           AS 'AAI entityID',
    swre.final_json->>'$.aaiEntityId'                              AS 'Customer entityID',
    se.entity_name                                                 AS 'customer entity_name',

    -- ── Written record + attachments ───────────────────────────────────────────────────────────
    JSON_UNQUOTE(JSON_EXTRACT(a.record,  '$.recordType'))          AS 'Final Record Type',
    JSON_UNQUOTE(JSON_EXTRACT(a.session, '$.originalRecordType'))  AS 'Original Record Type',
    JSON_UNQUOTE(JSON_EXTRACT(a.record,  '$.invoiceNumber'))       AS 'Invoice #',
    JSON_UNQUOTE(JSON_EXTRACT(a.record,  '$.vendorName'))          AS vendorname,
    JSON_UNQUOTE(JSON_EXTRACT(a.session, '$.attachments[0].filename'))             AS attachmentFileName,
    JSON_UNQUOTE(JSON_EXTRACT(a.session, '$.attachments[0].key'))                  AS extractedFileS3Location,
    JSON_UNQUOTE(JSON_EXTRACT(a.session, '$.originalAttachment.filename'))         AS originalAttachmentFileName,
    JSON_UNQUOTE(JSON_EXTRACT(a.session, '$.originalAttachment.attchment[0].key')) AS S3Location

FROM sor.wk_result_edits swre
LEFT JOIN sor.wk_inst_result a  ON a.id        = swre.wk_result_id
LEFT JOIN tenant.tenant       t  ON t.id       = swre.tenant_id
LEFT JOIN sor.entity          se ON se.entity_id = swre.final_json->>'$.aaiEntityId'
WHERE swre.tenant_id = 'TENANT_PLACEHOLDER'
  AND a.write_status = 1
  AND swre.created_at >= 'DATE_FROM_PLACEHOLDER'
  AND swre.created_at <= 'DATE_TO_PLACEHOLDER'

  -- ── Scenario predicate — enable exactly ONE ─────────────────────────────────────────────────
  AND swre.original_json->>'$.recordType'  != swre.final_json->>'$.recordType'    -- Record Type
  -- AND swre.original_json->>'$.vendorName'  != swre.final_json->>'$.vendorName'   -- Vendor Name
  -- AND swre.original_json->>'$.aaiEntityId' != swre.final_json->>'$.aaiEntityId'  -- Entity Name

ORDER BY swre.updated_at DESC;
