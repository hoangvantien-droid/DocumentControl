# DCS P1/P2 Test Fixes Bugfix Design

## Overview

Thiết kế này xử lý các lỗi P1/P2 trong `bugfix.md` theo phương pháp điều kiện lỗi: mọi thao tác thỏa `C(X)` phải đạt property `P(result)` sau khi sửa; mọi thao tác ngoài `C(X)` phải bảo toàn hành vi hợp lệ. Phạm vi gồm quyền phê duyệt/menu, tổ chức-người dùng, đăng ký và phiên bản tài liệu, QR, cùng các hành động trên tài liệu kiểm soát.

Khảo sát hiện trạng cho thấy một số kiểm soát đã nằm ở domain nhưng chưa có hồi quy tự động: `confirmation.ts` kiểm tra `canRelease` bên trong cả `confirmRegistration` và `rejectRegistration`, còn `middleware/nav.ts` dùng active role để dựng menu. Tuy vậy, không được coi UI là cơ chế phân quyền: các route/domain mới và hiện hữu phải tiếp tục kiểm tra quyền ở server. Các khoảng trống xác nhận được là: tạo phòng ban rơi xuống unique constraint toàn cục; không có luồng mở/cập nhật nháp; input `supersedes_version_id` tự do và không kiểm tra cùng `doc_id`; không có UI/route gỡ riêng một membership; không có endpoint tải/xuất/chia sẻ; và trang QR chưa hiển thị định danh/version dù domain đã trả chúng.

**Cổng quyết định trước triển khai.** Các quyết định sau chưa có bằng chứng nghiệp vụ và phải được Product/QA/Security xác nhận. Thiết kế chỉ định điểm cắm chính sách, không tự chọn đáp án:

| ID | Quyết định cần chốt | Các lựa chọn/tác động |
|---|---|---|
| D1 | Unique Department | Mã và tên unique toàn cục, hay unique không phân biệt hoa-thường trong từng Site; quyết định index/migration và thông báo trùng. |
| D2 | QA Site B role matrix | Quyền thật của role tại Site B, có quyền approval hay không, và có bắt buộc mục “Tài liệu của tôi” không. Không suy ra theo chức danh. |
| D3 | Duplicate user | Dấu hiệu trùng (email chuẩn hóa hay thêm ID L1), người được xử lý, hành động cho phép, xử lý user inactive, credentials, role/membership và audit history. Tuyệt đối không merge/xóa tự động. |
| D4 | QR expired | Có bắt buộc cấp/giữ QR cho bản hết hiệu lực không; public hay login-gated; thông tin tối thiểu được hiện; thời hạn/thu hồi token. |
| D5 | Action matrix | Ai được in, xuất PDF, tải, quản lý phân phối, tạo chia sẻ; các state được phép; chia sẻ có thời hạn/đối tượng/one-time hay không; các audit event bắt buộc. |
| D6 | Version intent | Nghĩa nghiệp vụ của “tạo mới”, “cập nhật” và “thay thế”, đặc biệt khi `doc_id` thay đổi, cùng trạng thái prior version đủ điều kiện. |

Không thay đổi mã ứng dụng trong phase này.

## Glossary

- **Bug_Condition (C)**: Tập các input/thao tác kích hoạt một trong 12 lỗi P1/P2. `C(X) = C1(X) ∪ ... ∪ C12(X)`.
- **Property (P)**: Kết quả đúng bắt buộc với input thuộc `C`, được định nghĩa bởi `expectedBehavior` và các Correctness Properties.
- **Preservation**: Với `¬C(X)`, phiên bản sửa `F'` duy trì kết quả nghiệp vụ, state và ranh giới quyền hợp lệ của `F` theo Requirements 3.1–3.11.
- **F / F'**: Hành vi trước sửa / sau sửa của route + domain + DB policy tương ứng.
- **Approval capability**: Quyền release được `canRelease(sql, userId, documentScope)` xác định từ active role và đúng phạm vi, không dựa vào menu.
- **Menu capability**: Cờ điều hướng dựng bởi `buildNav` cho người dùng đăng nhập; chỉ là UX, không phải authorization.
- **Draft**: `document_versions.status = 'cho_hoan_thien'`, có thể thiếu dữ liệu bắt buộc để submit.
- **Eligible prior version**: Phiên bản được chính sách D6 cho phép làm `supersedes_version_id`; tối thiểu phải tồn tại, thuộc đúng document theo policy, và có state hợp lệ.
- **Department association**: Một dòng active `user_departments(user_id, dept_id)`; một user có thể có nhiều association.
- **Controlled-document action**: `print`, export/PDF, download, distribution management, hoặc share; mỗi action phải có kiểm tra state + quyền server-side.
- **QR verification**: Route trạng thái tối thiểu cho QR của `printed_copies.verify_token`; không trả nội dung tài liệu, nhãn hay danh sách người nhận.

## Bug Details

### Bug Condition

Gọi `X` là một yêu cầu có actor, operation, resource và dữ liệu form. Bug xuất hiện khi một trong các điều kiện sau đúng:

- `C1–C2`: actor không có approval capability cho document scope nhưng menu/route/domain cho xem hoặc làm approval.
- `C3`: yêu cầu tạo Department đụng quy tắc unique đã xác nhận nhưng lỗi DB bị lộ thành HTTP 500.
- `C4`: chính Author mở/sửa Draft hợp lệ của mình nhưng không nạp được hoặc không lưu được dữ liệu permitted.
- `C5`: request chọn update/replacement thiếu intent rõ ràng hoặc prior version không tồn tại, sai document, state không đủ điều kiện, hay đã stale.
- `C6`: update/replacement có `change_significance = 'lon'` nhưng `change_summary` trống và UI không gắn lỗi với trường lý do.
- `C7`: yêu cầu bỏ một association hợp lệ của user nhiều department nhưng xóa sai/không xóa association đã chọn.
- `C8`: request tạo/sửa user khớp duplicate candidate nhưng hệ thống tự xử lý không an toàn hoặc không theo D3.
- `C9`: menu của QA Site B khác D2 (hiện approval khi không có quyền, hoặc thiếu “Tài liệu của tôi” khi D2 yêu cầu).
- `C10–C11`: QR token hợp lệ không trả định danh/version/status đúng chính sách D4 cho bản effective hoặc expired.
- `C12`: controlled-document action được cho phép khi actor/state không có capability D5, hoặc action được yêu cầu nhưng chưa có workflow permission-governed.

**Formal Specification:**

```text
FUNCTION isBugCondition(input)
  INPUT: input = { actor, operation, resource, payload, currentState, policy }
  OUTPUT: boolean

  approvalMismatch := input.operation IN ['approvalQueue', 'approve', 'reject']
    AND NOT canRelease(input.actor, input.resource.documentScope)
    AND approvalFunctionOrNavigationIsAllowed(input)

  departmentCollision := input.operation = 'createDepartment'
    AND conflictsWithDepartmentUniqueness(input.payload, input.policy.D1)
    AND returnsUnhandledConstraintFailure(input)

  draftFailure := input.operation IN ['openDraft', 'saveDraftEdit']
    AND isOwnEditableDraft(input.actor, input.resource)
    AND NOT draftLoadsAndPersistsPermittedFields(input)

  priorVersionFailure := input.operation IN ['submitUpdate', 'submitReplacement']
    AND (NOT hasExplicitVersionIntent(input.payload)
         OR NOT isEligiblePriorVersion(input.payload.priorVersion, input.resource, input.policy.D6))
    AND requestIsNotRejectedWithFieldError(input)

  majorReasonFailure := input.payload.changeSignificance = 'lon'
    AND isBlank(input.payload.changeSummary)
    AND NOT reasonFieldHasValidationError(input)

  associationFailure := input.operation = 'removeDepartmentAssociation'
    AND isActiveAssociation(input.actor.targetUser, input.payload.departmentId)
    AND NOT onlySelectedAssociationIsDeactivated(input)

  duplicateFailure := input.operation IN ['createUser', 'resolveDuplicateUser']
    AND isDuplicateCandidate(input.payload, input.policy.D3)
    AND NOT followsConfirmedDuplicatePolicy(input)

  menuMismatch := input.operation = 'renderNavigation'
    AND isQaSiteBUser(input.actor)
    AND navigationDiffersFromRoleMatrix(input.policy.D2)

  qrMismatch := input.operation = 'verifyQr'
    AND isRecognizedQr(input.resource.token)
    AND NOT presentsPolicyApprovedQrStatus(input, input.policy.D4)

  actionMismatch := input.operation IN ['print', 'exportPdf', 'download', 'manageDistribution', 'share']
    AND NOT isPermittedDocumentAction(input.actor, input.resource, input.operation, input.policy.D5)
    AND actionSucceedsOrHasNoControlledWorkflow(input)

  RETURN approvalMismatch OR departmentCollision OR draftFailure OR priorVersionFailure
    OR majorReasonFailure OR associationFailure OR duplicateFailure OR menuMismatch
    OR qrMismatch OR actionMismatch
END FUNCTION
```

In set notation, `C(X) = Cauth ∪ Cdept ∪ Cdraft ∪ Cversion ∪ Creason ∪ Cmembership ∪ Cduplicate ∪ Cmenu ∪ Cqr ∪ Caction`, with each term corresponding to the clauses above. A request may match more than one term; the implementation must satisfy every applicable policy without partial state change.

### Examples

1. **Unauthorized direct approval:** a `DC_AUTHOR` submits `POST /confirm/{versionId}/approve` for a site document without a matching release role. Expected: 403, no status/admin/checklist mutation, denied access handled according to confirmed audit policy. Defect: any path that approves solely because the hidden/showing UI is wrong.
2. **QA Site B menu:** a Site B QA user has no D2 approval capability. Expected: no approval queue link and all direct approval routes deny; “Tài liệu của tôi” follows D2. Defect: role label or UI alone gives a different experience.
3. **Department collision:** Site A has code `QA`; admin adds `QA` to Site B. If D1 is global unique, expected: actionable 4xx “mã đã tồn tại”; if site-scoped, expected: successful insert. Defect: PostgreSQL `UNIQUE` error surfaces as HTTP 500 either way.
4. **Draft edit:** Author saves a `cho_hoan_thien` draft with no owner department, opens it from My Documents, changes its title, and saves. Expected: same `version_id`, permitted values updated, still Draft. Defect: no edit link/load route or a second unwanted draft is created.
5. **Wrong prior version:** Author submits a replacement for `DOC-A` using an active version ID from `DOC-B`. Expected: `supersedes_version_id` field error before approval; no version is created. Defect: existing check accepts any active/registered prior version regardless of `doc_id`.
6. **Major-change reason:** Author selects `lon` and leaves `change_summary` blank. Expected: message adjacent to “Tóm tắt/lý do thay đổi lớn”; no submission. Defect: generic error banner without field association.
7. **One membership removal:** User belongs to QA and Production. Admin removes QA. Expected: QA association becomes inactive and Production remains active after reload. Defect: no route/UI or an over-broad change removes both.
8. **Duplicate candidate:** admin enters an email that matches an inactive account after normalized comparison. Expected: system stops at the D3 decision workflow; no automatic merge, deletion, reactivation, credential change, or loss of history. Defect: ambiguous unsafe resolution.
9. **QR:** a printed copy token resolves to an effective version. Expected: status page visibly identifies document and version and says effective, within D4 exposure policy. For an expired version, behavior follows D4 and never claims it is current.
10. **Controlled action:** a viewer calls a direct download/share URL for a non-effective or unauthorized document. Expected: server denial and no file/token/distribution mutation. Defect: URL bypasses UI visibility or action is absent without an approved workflow.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- A user with matching active release role and document scope continues to list, approve, reject, and audit eligible registrations (Requirements 3.1–3.2).
- Valid department creation under D1, valid user creation under D3, and retained valid user-department associations continue to persist (3.3, 3.7–3.8).
- A valid new registration, valid draft, and valid update/replacement with all required fields continue to save or submit without data loss (3.4–3.6).
- Other roles and QA Site B users continue to see only D2-authorized navigation and document capabilities (3.9).
- Effective, expired, recalled and unknown QR cases continue to resolve consistently under D4 and do not expose document content (3.10).
- Existing permitted or denied print/distribution behavior remains consistent for direct requests as well as UI navigation; direct URLs may never bypass D5 (3.11).

**Scope:**

All inputs that do **not** satisfy `isBugCondition` must be unchanged. This includes valid approval by the proper scope owner, valid cross-site department creation if D1 allows it, non-duplicate users, non-major version changes, all non-target memberships, unknown QR tokens, and document actions outside the changed permission/state conditions. Mouse/UI visibility is not sufficient evidence of preservation; server-side results and persisted state must remain equivalent.

## Hypothesized Root Cause

1. **Authorization and navigation policy are represented at different layers.**
   - `confirmation.ts` currently re-checks `canRelease` in-domain, which is the correct enforcement seam, while `layout.eta` only receives role-derived nav flags.
   - The reported approval defect may therefore be historical or role-matrix/configuration-specific rather than reproducible in the current code. Regression tests must prove denial at the route/domain seam and D2 must define the QA Site B role assignment; the fix must not weaken existing domain checks.

2. **Organization persistence depends on DB constraints without application validation.**
   - `org_department.dept_code` is globally `UNIQUE` in migration `001_schema.sql`; `createDepartment` inserts directly and `POST /admin/org/dept` has no BusinessError rendering path.
   - This explains a raw constraint failure/500 and prevents D1 from being expressed intentionally.

3. **Draft support is create-only.**
   - `saveDraft` always creates a UUID and `my-documents.eta` exposes no Draft edit action; no route loads a draft.
   - The existing draft migration deliberately relaxes only pre-submit validation, so update authorization/state rules are still absent.

4. **Version intent and prior-version validation are under-specified in the UI and incomplete in the domain.**
   - `register.eta` accepts a free-text `supersedes_version_id`; `validateForSubmit` checks only that the referenced version exists and has `hieu_luc`/`da_dang_ky`, not that it belongs to the submitted `doc_id`.
   - `change_summary` is already validated as a BusinessError and DB constraint, but route/template render only a generic banner, not a field-targeted error.

5. **A safe membership operation exists below an unreachable UI.**
   - `users.removeFromDepartment` deactivates exactly `(user_id, dept_id)`, preserving audit evidence and other rows, but admin routes/views do not call or expose it.

6. **Duplicate identity is detected but no remediation contract exists.**
   - `createUser` performs case-insensitive email lookup and returns `user.email_taken`; the database has `uq_user_email` on `lower(email)`.
   - Neither the data model nor UI defines identity linking, merge authority, or whether inactive accounts count, so an automatic resolution would risk credentials, authorization and audit history.

7. **QR is implemented for printed copies but presentation/policy are incomplete.**
   - `verifyToken` already returns `con_hieu_luc`, `het_hieu_luc`, recalled and unknown states with document/version values; `verify.eta` currently only renders status text.
   - `registerPrint` only creates a token for effective versions and `/verify/:token` is public. This does not decide D4 for legacy/expired QR or broader QR issuance.

8. **The action surface is incomplete and scattered.**
   - Controlled print is implemented in `routes/printing.ts` and is currently governed by `canViewVersion` plus effective state; distribution-matrix mutation is guarded by `canRelease` in `routes/catalog.ts`.
   - There are no download, export/PDF, or share routes. Implementing them independently would create inconsistent authorization unless D5 is centralized.

## Correctness Properties

Property 1: Bug Condition - P1/P2 Operations Reach the Confirmed Outcome

_For any_ input where the bug condition holds (`isBugCondition` returns true), the fixed route/domain/DB path SHALL deny unauthorized approval and controlled actions, return safe actionable validation for invalid organization or version input, preserve precisely targeted membership changes, make editable drafts reloadable, render the D2/D4 policy outcome, and perform duplicate resolution only through the confirmed D3 workflow.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12**

Property 2: Preservation - Non-Buggy DCS Operations Remain Equivalent

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns false), the fixed function SHALL produce the same result as the original function, preserving authorized approval, valid organization/user operations, valid document state transitions, role-scoped navigation, QR safety, and permission-governed action behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11**

Property 3: Approval and Menu Separation

_For any_ approval queue, approval, or rejection request by an actor without a matching active `canRelease` permission for the document scope, the server SHALL return denial without a document state, checklist, admin, or audit-success mutation; navigation SHALL independently match D2 and never grant capability.

**Validates: Requirements 2.1, 2.2, 2.9, 3.1, 3.2, 3.9**

Property 4: Safe Department Identity Validation

_For any_ department candidate conflicting with D1, the system SHALL resolve the collision before attempting an unsafe insert and return a field-addressable 4xx BusinessError; for every non-conflicting candidate, it SHALL retain the selected Site and create exactly one department.

**Validates: Requirements 2.3, 3.3**

Property 5: Owned Draft Round Trip

_For any_ editable Draft owned by its Author, loading then saving permitted edits SHALL retain its `version_id`, `cho_hoan_thien` state, previous optional data not changed by the form, and valid file reference; a different user or a non-Draft state SHALL not be editable through this flow.

**Validates: Requirements 2.4, 3.4**

Property 6: Explicit and Valid Version Lineage

_For any_ update/replacement submission, the system SHALL require D6-defined intent and a prior version that exists, is eligible, belongs to the intended document lineage, and remains eligible at validation time; any invalid/stale prior reference SHALL create no new version and identify the prior-version field.

**Validates: Requirements 2.5, 3.5**

Property 7: Major Change Reason Is Field-Specific

_For any_ version submission with `change_significance = 'lon'` and blank normalized `change_summary`, the system SHALL reject without a transition and associate the message with the major-change reason field; a nonblank permitted reason SHALL not receive that error.

**Validates: Requirements 2.6, 3.6**

Property 8: Targeted Department Association Removal

_For any_ active `(userId, departmentId)` association selected for removal, the system SHALL deactivate only that row, retain every other active association and audit history, and render the persisted membership set after reload.

**Validates: Requirements 2.7, 3.7**

Property 9: Duplicate User Resolution Is Explicit and Non-Destructive

_For any_ duplicate candidate under D3, the system SHALL stop creation or enter only a confirmed authorized resolution action, preserving required accounts, memberships, roles, credentials, and append-only audit history; a non-duplicate candidate SHALL follow ordinary creation/edit behavior.

**Validates: Requirements 2.8, 3.8**

Property 10: QR Status Is Truthful and Minimal

_For any_ recognized QR token, the verification result SHALL map the referenced version’s effective/expired/recalled state to the D4-approved visible status and include document identity/version where D4 permits; it SHALL never report an expired or recalled version as effective or return document contents. Unknown/revoked tokens SHALL receive the D4-approved safe response.

**Validates: Requirements 2.10, 2.11, 3.10**

Property 11: Controlled Actions Require Capability at Every Entry Point

_For any_ print, export/PDF, download, distribution-management, or share request, the system SHALL evaluate the same D5 role-and-state policy server-side before returning a file, token, mutation, or success response; the UI SHALL offer only the actions allowed by that decision.

**Validates: Requirements 2.12, 3.11**

## Fix Implementation

### Changes Required

Implementation begins only after D1–D6 are confirmed. The following is a file/module plan, not a code change.

### 1. Centralize documented capabilities and enforce server-side

**Files:** `src/domain/permissions.ts`, `src/middleware/nav.ts`, `src/routes/confirmation.ts`, `src/domain/confirmation.ts`, `src/views/layout.eta`, possibly a new `src/domain/document-actions.ts`.

1. Keep `confirmation.ts` as the authoritative in-domain `canRelease` enforcement for approve/reject; add route-level integration tests rather than moving authority into menu code.
2. Define a capability API with a narrow input such as `{ userId, versionId/documentScope, action }`, producing an allow/deny decision and reason code. `action` must cover approval, print, exportPdf, download, distributionManage and share; it must consume D5 rather than infer from `canViewVersion` alone.
3. Extend `NavFlags` with distinct flags for menu experiences (for example `canViewMyDocuments`) only after D2. Use the same capability source for menu visibility; direct route checks remain mandatory.
4. If D2 says QA Site B has no approval authority, seed/configure the role assignments rather than special-casing a display name. If the matrix says it has an approved different capability, model that explicitly.
5. Define denied-access audit behavior with Security. Existing audit event types do not include a generic denial event; if auditable denials are required, add the approved event/check constraint in migration and record no sensitive payload.

### 2. Department uniqueness and safe validation

**Files:** `src/domain/org.ts`, `src/routes/admin.ts`, `src/views/admin/org.eta`, `src/lib/errors.ts`, new migration `src/db/migrations/008_p1_p2_test_fixes.sql` (number to be confirmed against latest migration).

1. Normalize input (`trim`, case policy D1), validate mandatory code/name/site, and query D1 collisions before INSERT; return a named `BusinessError` with a safe 4xx status and field key.
2. Wrap the admin department POST in the same BusinessError rendering pattern used by user creation, retaining entered form values and showing a targeted message rather than leaking DB diagnostics.
3. Preserve DB as final defense: migrate from global `UNIQUE(dept_code)` only if D1 selects site scope. For site scope, drop/replace the global constraint/index with a case-normalized composite uniqueness strategy and add a matching name constraint only if D1 requires names unique. For global scope, keep an equivalent normalized global constraint and add only app validation.
4. Include data-preflight migration checks: report existing duplicates that would block the selected constraint, do not silently rename historical departments.

### 3. Draft open/edit/save and version-lineage validation

**Files:** `src/domain/registration.ts`, `src/routes/documents.ts`, `src/views/register.eta`, `src/views/my-documents.eta`, potentially `src/views/components/field-error.eta`; migration only if an explicit draft edit timestamp/revision or new intent column is approved.

1. Add `loadEditableDraft` that requires current user to be `registrant_user_id` and status `cho_hoan_thien`. `GET /register/draft/:versionId` pre-populates the registration form; My Documents shows “Sửa nháp” only for owned drafts.
2. Add a draft-update operation, e.g. `POST /register/draft/:versionId`, which locks/updates the existing version rather than calling create-only `saveDraft`. Keep incomplete-draft allowances from migration 007, normalize empty UUID/date fields, retain old file metadata if no replacement file was uploaded, and audit as a draft edit.
3. Add an explicit D6 intent control (`new`, `update`, `replacement` or confirmed equivalent). Server validation must not trust UI intent.
4. Replace free-text prior-version input with a server-populated eligible-version selector or searchable ID whose final value is revalidated in-domain. Validate existence, same document lineage as D6 requires, status, ownership/authorization rules and stale state within the submit transaction. Error data must identify `supersedes_version_id`.
5. Preserve current DB constraints (`uq_doc_version`, one-effective-version, change-significance constraints) as defense in depth. Add early `BusinessError` validation so user errors never rely on raw DB exceptions.
6. Return structured field errors from registration validation. `register.eta` must render error beside `change_summary`; maintain its generic summary for accessibility. Use the exact product label chosen for “reason”/“summary” consistently.

### 4. User associations and duplicate-account safety

**Files:** `src/domain/users.ts`, `src/routes/admin.ts`, `src/views/admin/users.eta`, `src/lib/audit.ts`, possibly a new `src/domain/duplicate-user-policy.ts` and migration 008.

1. Expose `POST /admin/users/remove-dept` guarded by `requireSystemAdmin`; require both IDs, verify the target active association, call `removeFromDepartment`, and redirect/re-render from persisted data. Do not delete the user or other rows. Add an association-removal audit entry if required policy/event vocabulary supports it.
2. Render one removal control per displayed department chip with an explicit target `dept_id`; protect against stale/forged IDs and return safe 404/422 rather than treating unrelated association absence as success.
3. Keep current duplicate detection as a safe stop until D3 is signed off. The initial UX may show an admin-safe conflict message and candidate-resolution entry point, but must never expose candidate details to non-admins.
4. The D3 design review must explicitly answer: (a) normalized email only or another immutable identity; (b) whether inactive accounts are duplicates; (c) allowed action: reject, reactivate, link to L1, or merge; (d) required authorizer/dual approval; (e) canonical account selection; (f) password/session reset, role and department disposition; (g) audit-history preservation and retention; (h) rollback. “Merge” must be a separately approved, transactional feature; no auto-merge or hard-delete is in this bugfix.
5. If D3 requires a resolution record, create a new immutable audit/resolution table through migration rather than rewriting existing `audit_log` or foreign keys.

### 5. QR status policy and document actions

**Files:** `src/domain/printing.ts`, `src/routes/printing.ts`, `src/views/verify.eta`, `src/routes/catalog.ts`, `src/domain/catalog.ts`, `src/domain/distribution.ts`, `src/views/detail.eta`, plus new `src/routes/document-actions.ts` / `src/domain/document-actions.ts` if action scope expands; migration 008 for event/token metadata only if D4/D5 requires it.

1. Preserve the public status-only boundary of `/verify/:token` unless D4 changes it. Render the existing document ID, version number, and status for an effective QR token subject to D4; render an explicit expired state and current version only when allowed. Never deliver PDF/content from QR verification.
2. Define D4 behavior for expired printed-copy token, unknown/revoked token, and any future QR generated directly for a document. Existing tokens must remain resolvable according to policy and must not be reclassified incorrectly after lifecycle transitions.
3. Introduce a single `authorizeDocumentAction`/policy table for D5. It must check authenticated actor, document visibility where relevant, document status, operation and scope before the route accesses `file_path`, creates a share link, mutates a distribution matrix or registers a print.
4. Retain controlled print’s effective-state requirement unless D5 explicitly changes it; switch its authorization from ad hoc visibility to the centralized D5 decision only after test parity proves no regressions.
5. Add explicit routes only for D5-approved actions: e.g. controlled PDF generation/export, attachment download with `Content-Disposition`, distribution management using existing matrix APIs, and share-token creation/revocation. No endpoint may return a filesystem path or trust a version ID without authorization.
6. Use the existing append-only audit pattern (`in`, `tai`, `sua_ma_tran`) and add only D5-approved event types for export/share. Audit action, actor, version, decision-relevant metadata and token ID—not document content or secrets.

### Migration Plan

- Create a forward-only, idempotence-conscious migration after D1/D3/D4/D5 decisions; do not edit migrations 001, 005 or 007 already applied in environments.
- Include only schema/index/check changes needed by selected policy: department uniqueness, optional duplicate-resolution records, optional action/share token records, and any audit-event CHECK expansion.
- Run preflight queries against a backup/rehearsal copy, publish conflicts, define approved remediation, then apply in transaction where PostgreSQL permits. Preserve UUIDs, memberships, document versions and append-only audit history.
- Verify application compatibility against all migrations from a clean database and upgrade rehearsal. Provide a rollback procedure that disables new routes/features rather than attempting to erase newly audited actions or merge history.

## Testing Strategy

### Validation Approach

Testing uses two phases. First, write exploratory tests that reproduce the conditions against the unfixed/feature-gated behavior where possible; record whether the reported fault is still present. Then implement fix checking for all `C(X)` and preservation checking for `¬C(X)`. Current source indicates the approval domain check and basic QR status mapping may already pass some exploratory cases; that outcome refutes that root-cause portion and shifts work to role configuration/menu presentation or missing test coverage rather than removing safeguards.

### Exploratory Bug Condition Checking

**Goal:** Surface counterexamples before implementation and confirm/refute each root-cause hypothesis.

**Test Plan:** Use Fastify route injection with a real PostgreSQL test database for transactional/constraint paths; unit-test pure normalizers/mappers; render Eta views for menu/form assertions. Rebuild the test database from all migrations (not only 001/002) for P1/P2 tests.

**Test Cases:**

1. **Approval direct-request test:** submit approval and rejection as an Author/Reader and as a Site B user without a matching release scope; assert denial and no state mutation. Repeat with a correctly scoped release role.
2. **QA Site B navigation test:** render layout for the exact D2 role fixtures and assert approval and My Documents links match the approved matrix; direct route remains denied when link is absent.
3. **Department collision test:** create D1 collision with code/name and assert 4xx field error/no 500; run a D1-permitted cross-site case.
4. **Draft round-trip test:** create incomplete Draft, GET edit, POST edit, then reload and compare version ID/state/permitted fields; verify another Author cannot edit it.
5. **Lineage and reason tests:** submit cross-document, nonexistent, expired/stale and valid prior IDs; submit major change without/with reason and assert field error or successful transition.
6. **Membership test:** remove one of two departments and reload exact membership set; test forged/absent association.
7. **Duplicate safety test:** exercise every D3 decision branch only after confirmation; before then assert duplicate blocks without destructive side effect.
8. **QR/action tests:** verify effective, expired, recalled and unknown tokens; call every action URL directly with allowed/disallowed users and states.

**Expected Counterexamples:**

- Department collision currently reaches raw DB uniqueness failure instead of a rendered BusinessError.
- Draft opening/updating and membership removal cannot currently be completed from routes/UI.
- A cross-document `supersedes_version_id` may pass current status-only prior-version validation.
- Layout can hide menu items while no test proves the D2 matrix; QR view omits returned identity/version; download/export/share routes do not exist.
- Approval direct requests may already be denied because `confirmRegistration` and `rejectRegistration` call `canRelease`; record this as confirmation of existing defense, not a reason to relax it.

### Fix Checking

**Goal:** Verify that all inputs satisfying `C(X)` satisfy `expectedBehavior` after the policy decisions are applied.

**Pseudocode:**

```text
FUNCTION expectedBehavior(input, result)
  INPUT: bug-condition input and observed result
  OUTPUT: boolean

  CASE input.operation OF
    'approvalQueue', 'approve', 'reject':
      RETURN deniesWithoutStateTransitionWhenUnauthorized(result)
             AND navigationMatchesRoleMatrix(input.policy.D2)
    'createDepartment':
      RETURN honorsDepartmentUniqueness(input.policy.D1, result)
             AND returnsSafeFieldValidation(result)
    'openDraft', 'saveDraftEdit':
      RETURN retainsOwnedDraftIdentityAndPermittedData(result)
    'submitUpdate', 'submitReplacement':
      RETURN hasExplicitIntentAndValidatedSameLineagePriorVersion(result)
             AND rendersMajorReasonErrorWhenRequired(result)
    'removeDepartmentAssociation':
      RETURN onlySelectedMembershipChanged(result)
    'createUser', 'resolveDuplicateUser':
      RETURN followsConfirmedDuplicatePolicy(input.policy.D3, result)
    'renderNavigation':
      RETURN navigationMatchesRoleMatrix(input.policy.D2)
    'verifyQr':
      RETURN presentsPolicyApprovedQrStatus(input, input.policy.D4)
    'print', 'exportPdf', 'download', 'manageDistribution', 'share':
      RETURN isServerSidePermissionGoverned(input, input.policy.D5, result)
  END CASE
END FUNCTION

FOR ALL input WHERE isBugCondition(input) DO
  result := F_prime(input)
  ASSERT expectedBehavior(input, result)
END FOR
```

### Preservation Checking

**Goal:** Verify the fixed behavior is equivalent to original valid behavior for `¬C(X)`.

**Pseudocode:**

```text
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT observableBusinessResult(F(input)) = observableBusinessResult(F_prime(input))
END FOR
```

`observableBusinessResult` includes HTTP outcome, rendered allowed controls, persisted row/state, file/token side effect where applicable, and audit event required by policy. It excludes generated UUID/timestamp values but compares their semantic relationships.

**Testing Approach:** Capture fixtures for valid scoped approvers, normal administrators, valid D1 department entries, valid drafts/new registrations, valid prior-version references, active multi-department users, effective/expired/unknown QR tokens, and D5-authorized actions. Execute them before and after changes (or against feature flag/reference fixture) and compare the observable result.

### Unit Tests

- `permissions`/document-action policy: capability matrix by role, scope, document state and action; denial must not become allow because a menu flag changes.
- `org` normalization/conflict detection: D1 code/name cases, whitespace/case, concurrent insert conflict mapping.
- `registration`: owned draft loader/update guards; intent parser; same-document/status/stale prior validation; structured `change_summary` field error.
- `users`: targeted membership deactivation, no-op/stale association semantics, D3 pure policy decision behavior.
- `printing`: QR status mapping preserves token identity and no-content response; D4 expired policy variants.

### Property-Based Tests

- Generate role assignments, document scopes and approval/action requests. For every actor/scope/action pair, assert server decision equals centralized capability policy and unauthorized operations do not change document state.
- Generate department codes/names/sites with normalization variants. Assert collision classification agrees with D1 and any rejected input maps to a BusinessError rather than a 5xx; valid inputs create exactly one matching row.
- Generate draft fields, prior-version graphs and change significance. Assert editable drafts preserve identity, invalid/cross-document/stale lineage never submits, and `lon` requires a nonblank reason.
- Generate a user with N memberships (N ≥ 1) and remove one selected membership. Assert the resulting active set is the original set minus exactly that element.
- Generate QR lifecycle states and capability requests. Assert status never overstates validity and every direct document action has the same allow/deny result as its UI capability.

### Integration Tests

- Full Author → Draft edit → submit update/replacement → scoped approver workflow, including audit and state transitions.
- Site B matrix login journeys for every D2-approved role, with direct forbidden approval/action requests.
- Admin organization/user journey: D1 duplicate response, valid department creation, multi-department assignment/removal, and each D3-approved duplicate resolution scenario.
- QR journeys for effective, expired, recalled and unknown printed copies, asserting minimal public output and D4 outcome.
- D5 action matrix journey: allowed print/export/download/distribution/share records expected audit; unauthorized and invalid-state direct URLs return denial without file, token, matrix or sharing mutation.

### Test Infrastructure and Validation

- Add P1/P2 integration fixtures without pointing tests at a production database. The existing `test/constraints.test.ts` safety guard requires `DATABASE_URL_TEST` to contain `test`; extend the fresh-schema setup to apply migrations 003–latest for users/roles/current behavior.
- Keep pure tests under `test/domain/`; add route tests (e.g. `test/routes/`) using Fastify injection and view assertions under `test/views/` where appropriate.
- Run `npm run build`, `npm test`, and `npm run test:constraints` with an explicit disposable `DATABASE_URL_TEST`. The constraints suite is required for uniqueness/index/audit migration changes; do not run it without the isolated test database.
