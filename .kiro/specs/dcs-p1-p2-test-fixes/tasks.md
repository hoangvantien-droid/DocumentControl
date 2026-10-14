# Implementation Plan — DCS P1/P2 Test Fixes

> **Execution boundary:** This plan intentionally contains no implementation work before all decision gates D1–D6 have written approval from **Product, QA, and Security**. Do not infer a policy from current UI, role names, test reports, or schema behavior. Record the approved policy source, approvers, and date in the delivery ticket/spec before marking each gate complete.
>
> **Test boundary:** Tasks 7–8 establish the pre-fix baseline. A failure in Task 7 is expected only where the reported defect still reproduces; a passing result for an already-defended case (notably direct approval denial) must be documented as a refuted root-cause hypothesis, never weakened to force a failure.

## Decision gates — mandatory before any dependent test or implementation

- [x] 1. **Gate D1 — Confirm Department uniqueness policy**
  - Obtain Product/QA/Security sign-off for: global versus per-Site uniqueness; case/whitespace normalization; whether `dept_code`, `dept_name`, or both are unique; required collision wording; and historical-data remediation.
  - Record the approved rule and migration consequences: retain normalized global constraint or replace it with normalized Site-scoped composite constraint(s); no silent historical rename.
  - **Dependency:** blocks Tasks 7–8 and 9.2.
  - **Validation:** written approval names the exact rule and safe 4xx behavior for collisions; a rehearsal preflight query has an owner and remediation path.
  - _Requirements: 1.3, 2.3, 3.3_

- [~] 2. **Gate D2 — Confirm QA Site B role/capability matrix**
  - Product/QA/Security approve the exact Site B roles, document scopes, approval/rejection capability, and whether “Tài liệu của tôi” is mandatory for each role. Confirm denied-access audit policy.
  - Specify role assignments/configuration changes rather than special-casing a display name; distinguish navigation capability from server authorization.
  - **Dependency:** blocks Tasks 7–8 and 9.1.
  - **Validation:** a signed matrix maps each role to `approvalQueue`, `approve`, `reject`, and `myDocuments` visibility/capability, including no-approval cases.
  - _Requirements: 1.1, 1.2, 1.9, 2.1, 2.2, 2.9, 3.1, 3.2, 3.9_

- [~] 3. **Gate D3 — Confirm duplicate-user safety policy**
  - Obtain signed answers for normalized identity fields; treatment of inactive accounts; permitted resolution actions; authorized actor/dual control; treatment of credentials, sessions, roles, memberships and canonical account; audit/retention; and rollback.
  - Explicitly decide whether any merge is in scope. No automatic merge, hard delete, reactivation, credential change, or history rewrite is allowed without this approval.
  - **Dependency:** blocks Tasks 7–8 and 9.5.
  - **Validation:** approved decision table has every duplicate branch, required audit event/record, and non-destructive fallback.
  - _Requirements: 1.8, 2.8, 3.8_

- [~] 4. **Gate D4 — Confirm QR policy for expired and public access**
  - Product/QA/Security decide QR issuance/retention for expired versions; public versus authenticated access; minimal fields that may be exposed; unknown/revoked response; token expiry/revocation; and treatment of legacy tokens.
  - Confirm that QR verification must never return document content, labels, recipient lists, or a false current/effective status.
  - **Dependency:** blocks Tasks 7–8 and 9.6.
  - **Validation:** signed state matrix covers effective, expired, recalled, unknown and revoked tokens, with visible status/identity/version rules and access boundary.
  - _Requirements: 1.10, 1.11, 2.10, 2.11, 3.10_

- [~] 5. **Gate D5 — Confirm controlled-document action matrix**
  - Product/QA/Security approve role + document-state rules for print, PDF export, download, distribution management and share; direct-URL behavior; share recipient/expiry/one-time/revocation rules; and mandatory audit events.
  - Decide which absent workflows are actually approved to be added; do not create a download/export/share endpoint merely because one is requested.
  - **Dependency:** blocks Tasks 7–8 and 9.7.
  - **Validation:** signed matrix defines allow/deny for every action, state and scope plus required side effects and audit metadata.
  - _Requirements: 1.12, 2.12, 3.11_

- [~] 6. **Gate D6 — Confirm document-version intent and lineage policy**
  - Product/QA/Security approve the semantics of create-new, update, and replacement; `doc_id`/lineage requirements; eligible prior states; stale-reference behavior; and exact field labels/errors.
  - Confirm major-change reason terminology so form labels and field errors use the approved product wording consistently.
  - **Dependency:** blocks Tasks 7–8 and 9.3–9.4.
  - **Validation:** signed decision table maps every intent and prior-version state to allow/field error, including cross-document and stale references.
  - _Requirements: 1.5, 1.6, 2.5, 2.6, 3.5, 3.6_

## Pre-fix evidence — must complete after all gates and before implementation

- [~] 7. Write and run the bug-condition exploration suite on the unfixed baseline
  - **Property 1: Bug Condition** - Confirmed P1/P2 operations reach their required outcome
  - **IMPORTANT:** Create this property-based suite before implementation. It encodes `isBugCondition(input)` and the `expectedBehavior(input, result)` pseudocode in `design.md`; do not alter the production behavior or weaken assertions to make it pass.
  - Generate/parameterize actor, role scope, operation, resource, payload, state and approved D1–D6 policy fixtures. Cover `C1`–`C12`: unauthorized approval/menu; D1 department collision; owned Draft open/save; D6 invalid/stale/cross-lineage prior version; blank major reason; one selected membership removal; D3 duplicate candidate; D2 Site B nav; D4 effective/expired QR; and D5 controlled actions.
  - Use Fastify injection with a disposable PostgreSQL test DB rebuilt from migrations 001 through latest; use unit-level generators for normalization/policy mappers and Eta rendering for UI assertions. Record concrete counterexamples, HTTP result, persisted-state delta and rendered-field/nav output.
  - Run on the unfixed baseline. Expected reproduction includes safe-4xx failure for raw department constraint, unavailable Draft/membership paths, possible cross-document lineage acceptance, QR identity/version omission, and absent D5 workflows. If direct approval already returns denial, document it as an existing defense and keep the regression assertion.
  - **Dependencies:** Gates D1–D6; must finish before Task 9.
  - **Validation:** counterexample/refutation report covers all 12 conditions and identifies the exact test file/fixture for each; no test uses production `DATABASE_URL`.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

- [~] 8. Write and run observation-first preservation property suite on the unfixed baseline
  - **Property 2: Preservation** - Non-buggy DCS operations remain equivalent
  - **IMPORTANT:** Before implementation, observe and save baseline outputs for inputs where `NOT isBugCondition(input)`. Tests must assert actual allowed behavior, persisted semantic state, permitted controls and audit effects—not inferred behavior or merely hidden UI.
  - Capture fixtures/property generators for: valid scoped approval; permitted non-approval document access; valid D1 department creation; valid Draft/new registration; D6-valid lineage and nonblank major reason; unchanged multi-membership user; D3 non-duplicate user; D2-authorized nav; D4 effective/expired/recalled/unknown QR cases; and D5 allowed/denied direct requests.
  - Compare semantic observable results (HTTP status, field/nav rendering, rows/state, allowed file/token/matrix side effects and required audit relation), excluding generated UUIDs/timestamps. Tests must pass on unfixed behavior except where an explicit approved policy changes behavior and is recorded.
  - **Dependencies:** Gates D1–D6; must finish before Task 9.
  - **Validation:** preservation suite passes against the baseline and maps every observation to Requirements 3.1–3.11; baseline fixture/schema setup applies all migrations and enforces `DATABASE_URL_TEST` isolation.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

## Implementation — begin only when Tasks 1–8 are complete

- [ ] 9. Implement the approved P1/P2 fixes and their focused automated tests
  - **Dependency:** Tasks 1–8 completed with all six written approvals and baseline evidence attached. Coordinate migration order before deploying any code that reads new policy records/constraints.

  - [~] 9.1 Enforce approval capability and D2 navigation without conflating UI and authorization
    - **Backend/modules:** update `src/domain/permissions.ts` with narrow capability decisions by `{ userId, documentScope/versionId, action }`; retain/enforce `canRelease` in `src/domain/confirmation.ts`; align route checks in `src/routes/confirmation.ts`; update role configuration/seed only as D2 approves.
    - **UI:** update `src/middleware/nav.ts`, `src/views/layout.eta` and relevant document views to expose `canViewMyDocuments`/approval links from the approved D2 capability source. Hidden navigation must never be treated as authorization.
    - **Tests:** unit capability matrix; route-injection tests for Author/Reader/Site B direct queue/approve/reject attempts (denial with no status/checklist/admin/audit-success mutation); Eta nav tests; valid scoped approver regression.
    - **Dependency:** D2 and Property 1/2 baseline fixtures.
    - **Validation:** unauthorized requests deny server-side even when a route is called directly; correctly scoped release workflow and audit remain unchanged.
    - _Bug_Condition: `approvalMismatch OR menuMismatch` in `isBugCondition(input)`._
    - _Expected_Behavior: denial without transition plus D2-matching navigation from `expectedBehavior`._
    - _Preservation: valid approval and allowed non-approval functions remain equivalent._
    - _Requirements: 1.1, 1.2, 1.9, 2.1, 2.2, 2.9, 3.1, 3.2, 3.9_

  - [~] 9.2 Implement D1 department validation and forward-only uniqueness migration
    - **Backend/modules:** normalize/validate code, name and site in `src/domain/org.ts`; return field-addressable `BusinessError`; render retained form data and field error in `src/routes/admin.ts` and `src/views/admin/org.eta`; use `src/lib/errors.ts` conventions.
    - **Migration:** add the next forward-only migration under `src/db/migrations/` (number chosen only after inspecting current latest). Retain normalized global constraints or replace with D1-approved normalized Site composite constraint(s); preflight/report conflicting legacy data; never edit applied migrations or silently repair data.
    - **Tests:** pure normalizer/collision tests including whitespace/case; concurrent/DB constraint mapping test; route 4xx/no diagnostic-leak test; D1-permitted cross-Site regression; fresh-schema and upgrade-rehearsal constraints test.
    - **Dependency:** D1; coordinate with migration task 9.5/9.6/9.7 if their policy requires same migration release.
    - **Validation:** a conflict returns actionable 4xx and no 500; a valid candidate creates exactly one selected-Site department; migration runs cleanly from empty schema and rehearsal backup copy.
    - _Bug_Condition: `departmentCollision` in `isBugCondition(input)`._
    - _Expected_Behavior: D1 rule plus safe field validation._
    - _Preservation: valid D1-compliant creation succeeds unchanged._
    - _Requirements: 1.3, 2.3, 3.3_

  - [~] 9.3 Add owned Draft load/edit/save round trip
    - **Backend/modules:** add guarded `loadEditableDraft` and existing-version draft update in `src/domain/registration.ts`; add `GET/POST /register/draft/:versionId` handlers to `src/routes/documents.ts`; preserve incomplete-draft allowances, current `version_id`, optional data and existing file metadata; audit draft edit only under approved vocabulary.
    - **UI:** prefill/render field errors in `src/views/register.eta`; show “Sửa nháp” only for owned `cho_hoan_thien` rows in `src/views/my-documents.eta`; use a shared field-error component if established by the project.
    - **Tests:** domain ownership/status guards; route round-trip from incomplete draft through reload; foreign Author/non-Draft direct access denial; file-retention test; end-to-end Author draft regression.
    - **Dependency:** baseline properties; coordinate with 9.4 because registration form/validation changes share modules.
    - **Validation:** edit saves same `version_id`, remains Draft, retains untouched permitted values/file reference and persists after reload; no new Draft is created.
    - _Bug_Condition: `draftFailure` in `isBugCondition(input)`._
    - _Expected_Behavior: owned editable drafts load and persist permitted fields._
    - _Preservation: valid existing Draft and new registration retain permitted save/submit behavior._
    - _Requirements: 1.4, 2.4, 3.4_

  - [~] 9.4 Implement D6 version intent, lineage validation and field-specific major-reason error
    - **Backend/modules:** add server-validated D6 intent parser and eligible-prior validation in `src/domain/registration.ts`. Validate existence, approved lineage/`doc_id`, allowed status, authorization and stale state inside submit transaction; return structured `supersedes_version_id` and `change_summary` BusinessErrors before creating a version.
    - **UI:** replace free-text prior-version entry in `src/views/register.eta` with D6-approved intent control and eligible selector/search; render error adjacent to prior-version and approved major-reason label while retaining accessible summary. Update `src/routes/documents.ts` to preserve inputs/errors.
    - **Migration:** only add a forward migration if the signed D6 model needs a persisted intent/revision field; retain existing version constraints as defense in depth.
    - **Tests:** unit intent/lineage/status/stale cases; PBT generation of valid/cross-document/missing/stale prior graph and `lon` reason cases; injection tests prove invalid inputs create no version; full valid update/replacement regression.
    - **Dependency:** D6; 9.3 for shared registration form changes.
    - **Validation:** invalid/stale prior is a `supersedes_version_id` field error with no transition; blank normalized reason has `change_summary` field error; valid D6 workflow submits unchanged.
    - _Bug_Condition: `priorVersionFailure OR majorReasonFailure` in `isBugCondition(input)`._
    - _Expected_Behavior: explicit intent, eligible lineage and field-specific reason validation._
    - _Preservation: valid eligible update/replacement and valid reason continue to submit._
    - _Requirements: 1.5, 1.6, 2.5, 2.6, 3.5, 3.6_

  - [~] 9.5 Expose precise department-association removal and implement D3 duplicate policy safely
    - **Backend/modules:** expose admin-only targeted removal in `src/routes/admin.ts` using existing `removeFromDepartment` in `src/domain/users.ts`; verify active association and return safe stale/forged response. Add a D3 policy module (for example `src/domain/duplicate-user-policy.ts`) only for approved actions; preserve existing safe conflict stop until approved.
    - **UI/audit:** add one explicit `dept_id` removal control per membership in `src/views/admin/users.eta`; render persisted membership set after reload. Use `src/lib/audit.ts` only for approved association/duplicate events. Do not disclose duplicate candidate data to unauthorized users.
    - **Migration:** if D3 requires resolution records or audit enum/check expansion, add an immutable forward-only table/constraint in the coordinated next migration; never rewrite account/membership/audit history.
    - **Tests:** PBT removes one selected membership from N≥1 and asserts exact resulting active set; route tests for forged/missing target; non-duplicate create/edit regression; every D3-approved resolution branch proves no unapproved merge/delete/reactivation/credential/history loss.
    - **Dependency:** D3; migration coordination with 9.2/9.6/9.7.
    - **Validation:** selected row alone is deactivated and survives correct reload semantics; duplicate handling matches signed D3 branch and records only approved audit data.
    - _Bug_Condition: `associationFailure OR duplicateFailure` in `isBugCondition(input)`._
    - _Expected_Behavior: exact association removal and D3-approved, non-destructive duplicate workflow._
    - _Preservation: untouched memberships and ordinary non-duplicate user save remain equivalent._
    - _Requirements: 1.7, 1.8, 2.7, 2.8, 3.7, 3.8_

  - [~] 9.6 Render D4-compliant QR status without expanding content exposure
    - **Backend/modules:** use existing status mapping in `src/domain/printing.ts` and controlled `/verify/:token` handling in `src/routes/printing.ts`; add only D4-approved token/metadata schema changes through the coordinated forward migration.
    - **UI:** update `src/views/verify.eta` to render D4-approved document identity, version and truthful effective/expired/recalled status; maintain minimal status-only output and never serve PDF/content from QR.
    - **Tests:** pure status mapper tests; PBT across effective/expired/recalled/unknown/revoked lifecycle states; public/auth boundary integration tests for legacy and current tokens; output tests reject content/recipient leakage and false-effective wording.
    - **Dependency:** D4; migration coordination where token issue/retention changes are approved.
    - **Validation:** every recognized token returns only policy-approved identity/version/status; expired/recalled cannot be represented as current; unknown/revoked uses safe approved response.
    - _Bug_Condition: `qrMismatch` in `isBugCondition(input)`._
    - _Expected_Behavior: policy-approved truthful, minimal QR status._
    - _Preservation: existing effective/expired/unknown resolution remains consistent and content-free._
    - _Requirements: 1.10, 1.11, 2.10, 2.11, 3.10_

  - [~] 9.7 Centralize D5 controlled-document action authorization and implement only approved workflows
    - **Backend/modules:** create `src/domain/document-actions.ts` (or extend `src/domain/permissions.ts`) with one server-side `authorizeDocumentAction` decision for print, exportPdf, download, distributionManage and share. Update `src/routes/printing.ts`, `src/routes/catalog.ts`, `src/domain/catalog.ts`, `src/domain/distribution.ts`; add `src/routes/document-actions.ts` only for D5-approved endpoints.
    - **UI:** update `src/views/detail.eta` and any distribution views to show only actions allowed by the same decision; never expose filesystem paths or treat an action button as the authorization check.
    - **Migration/audit:** add D5-approved share token/event structures and event constraint expansion only when required, coordinated in the next forward-only migration; audit decision-relevant metadata/token ID, never document content or secrets.
    - **Tests:** unit policy matrix by role/scope/state/action; PBT ensures UI capability equals direct-route decision; direct URL injection tests confirm denied calls create no file, token, matrix or sharing mutation; integration journeys for each D5-approved action and audit side effect.
    - **Dependency:** D5; D4 if share/QR rules intersect; coordinate all schema changes.
    - **Validation:** every entry point makes identical server decision; permitted action has approved audit/side effect; denied/unapproved action has no bypass or mutation.
    - _Bug_Condition: `actionMismatch` in `isBugCondition(input)`._
    - _Expected_Behavior: D5-governed action workflow enforced server-side._
    - _Preservation: current permitted/denied direct and UI behavior remains equivalent unless D5 explicitly changes it._
    - _Requirements: 1.12, 2.12, 3.11_

- [ ] 10. Re-run the baseline properties and complete cross-domain regression validation
  - [~] 10.1 Verify the original bug-condition suite now passes
    - **Property 1: Expected Behavior** - Confirmed P1/P2 operations reach their required outcome
    - Re-run the **same** Task 7 suite; do not write a substitute test. Confirm every `C1`–`C12` path satisfies `expectedBehavior`, including no partial DB state/action side effect on denials and validation failures.
    - **Dependency:** all applicable Task 9 subtasks and migrations complete.
    - **Validation:** test output identifies every requirement 2.1–2.12 as passing under the signed D1–D6 fixtures; comparison includes route, persisted-state, rendered UI and audit checks.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

  - [~] 10.2 Verify the original preservation suite still passes
    - **Property 2: Preservation** - Non-buggy DCS operations remain equivalent
    - Re-run the **same** Task 8 tests; do not replace baseline observations. Compare authorized approval, valid organization/user operations, Draft/new/version transitions, D2 nav, D4 QR output and D5 direct requests against pre-fix semantics, excluding only generated IDs/timestamps.
    - **Dependency:** Task 10.1 passes.
    - **Validation:** all Requirements 3.1–3.11 pass and any policy-approved intentional delta is explicitly linked to the signed gate decision.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [~] 10.3 Run full integration, migration and regression suite on isolated infrastructure
    - Rebuild `DATABASE_URL_TEST` from migrations 001 through latest; extend fresh-schema setup so it never tests a production DB. Exercise cross-domain journeys: Author Draft → version workflow → scoped approval; each D2 Site B role; admin org/user + D3 path; all D4 QR states; and D5 direct/action matrix.
    - Run `npm run build`, `npm test`, and `npm run test:constraints` with an explicitly disposable `DATABASE_URL_TEST`. Run migration clean-install and upgrade rehearsal, plus rollback procedure verification that disables features rather than deleting audited history.
    - **Dependency:** Tasks 9–10.2.
    - **Validation:** build and all automated suites pass; constraints suite passes; migration rehearsal reports no unapproved data conflict; no test connects to production.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

- [~] 11. Checkpoint — release readiness
  - Confirm Tasks 1–10 are complete; attach Product/QA/Security approvals, baseline counterexample/refutation record, test/build output, migration rehearsal/preflight evidence, and any approved policy deltas.
  - Do not release if a gate lacks approval, a PBT/regression test is skipped, a raw constraint failure remains, a direct route bypass is possible, or a migration conflict lacks approved remediation.
  - _Requirements: 2.1–2.12, 3.1–3.11_
