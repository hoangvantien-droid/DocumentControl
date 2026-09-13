# Eta SSR 500 (ASI) Bugfix Design

## Overview

Các trang DCS sập 500 khi SSR bằng Eta 3.5.0. Điều tra bằng cách kết xuất thật
các view với dữ liệu giả (không cần PostgreSQL) và dump mã hàm biên dịch của Eta
cho thấy lỗi gốc là **Automatic Semicolon Insertion (ASI)** trong mã JS mà Eta
sinh ra.

Eta biên dịch mỗi view thành một hàm, trong đó mỗi đoạn xuất được sinh dưới dạng
`__eta.res+=...` **không có dấu `;` cuối câu**, mỗi câu trên một dòng riêng. JS chỉ
tự chèn `;` theo quy tắc ASI; nếu dòng kế tiếp bắt đầu bằng `(` hoặc `[` thì ASI
**không** chèn, và hai dòng bị nối thành MỘT biểu thức sai:

Mã Eta sinh cho `admin/roles.eta` (trích, đã xác minh bằng dump thực tế):

```js
__eta.res+=__eta.e(u.email)
__eta.res+=')</small></td>\n      <td>\n        '
(it.rolesByUser[u.user_id] || []).forEach(function(r){
```

JS đọc là:

```js
__eta.res += ')</small></td>\n      <td>\n        '(it.rolesByUser[u.user_id] || []).forEach(function(r){...})
```

→ chuỗi `')</small></td>...'` bị **gọi như một hàm** → `"..." is not a function`.

Mã Eta sinh cho `register.eta` (trích):

```js
__eta.res+='...<select name="doc_type">\n        '
['SOP','WI','Form','Policy','External'].forEach(function(t){
```

JS đọc là `'...        '['SOP',...,'External'].forEach(...)`. Toán tử dấu phẩy trong
`[...]` trả về `'External'`, nên thành `'...        '['External']` = `undefined`,
rồi gọi `.forEach` trên `undefined` → `Cannot read properties of undefined (reading 'forEach')`.

Đây là cùng một lỗi gốc, hai biểu hiện khác nhau tùy ký tự mở đầu (`(` hay `[`) của
dòng scriptlet đứng ngay sau một câu xuất.

Chiến lược sửa (chọn hướng an toàn nhất — xem "Fix Implementation"): sửa từng chỗ ở
tầng template, chèn dấu chấm phẩy tường minh vào scriptlet để phá thế nối câu ASI,
đồng thời giữ nguyên HTML đầu ra. Không đổi cấu hình Eta toàn cục, không nâng cấp
thư viện.

## Glossary

- **Bug_Condition (C)**: Trong một view `.eta`, tồn tại một câu xuất Eta (`<%= expr %>` hoặc văn bản HTML literal) mà scriptlet Eta ngay sau đó (`<% ... %>` hoặc `<%= ... %>`) bắt đầu bằng ký tự `(` hoặc `[` ở đầu biểu thức. Khi biên dịch, hai câu bị ASI nối lại và ném lỗi lúc chạy.
- **Property (P)**: View phải kết xuất thành HTML hợp lệ mà không ném lỗi cho mọi dữ liệu hợp lệ (kể cả mảng rỗng).
- **Preservation**: HTML đầu ra của mọi view (kể cả các view không dính lỗi) và các view dính lỗi sau khi sửa phải giữ nguyên về mặt nội dung so với ý định ban đầu; lớp `applyBasePath` và cơ chế layout không đổi.
- **ASI (Automatic Semicolon Insertion)**: Quy tắc JS tự chèn dấu `;`. Không chèn khi dòng kế bắt đầu bằng `(` hoặc `[`, gây nối câu.
- **`eta.render(template, data)`**: Hàm Eta kết xuất một view theo đường dẫn file (dùng ở `src/views/render.ts`). Khác `renderString`: render file áp `autoTrim` mặc định nên tái hiện được lỗi (renderString mặc định không).
- **Output statement**: Câu Eta sinh `__eta.res += ...` (từ `<%= %>` hoặc văn bản literal).
- **Scriptlet**: Câu lệnh JS thuần trong `<% ... %>`.

## Bug Details

### Bug Condition

Bug xuất hiện khi trong một view `.eta`, một **câu xuất** đứng ngay trước một
**scriptlet** mà biểu thức mở đầu bằng `(` hoặc `[`. Cơ chế biên dịch của Eta sinh
mã không có `;` cuối câu, nên ASI nối câu xuất với dòng scriptlet kế tiếp.

**Formal Specification:**
```
FUNCTION isBugCondition(view)
  INPUT: view — một template .eta được Eta biên dịch thành thân hàm JS
  OUTPUT: boolean

  compiled := eta.compile(view)          // thân hàm dạng chuỗi
  lines := splitLines(compiled)
  FOR i FROM 0 TO length(lines) - 2 DO
    cur := trim(lines[i])
    nxt := trim(lines[i + 1])
    IF startsWith(cur, "__eta.res+=")
       AND (startsWith(nxt, "(") OR startsWith(nxt, "["))
    THEN
      RETURN true                        // câu xuất bị nối với dòng "(" hoặc "["
    END IF
  END FOR
  RETURN false
END FUNCTION
```

Đây là điều kiện **độc lập dữ liệu** (chỉ phụ thuộc cấu trúc template), nên có thể
liệt kê chính xác toàn bộ các chỗ dính lỗi mà không cần dữ liệu thật.

### Examples

Kết quả chạy detector cấu trúc trên toàn bộ `src/views/**/*.eta` (đã xác minh):

| View | Số vị trí | Dòng scriptlet gây lỗi | Biểu hiện |
|------|-----------|------------------------|-----------|
| `admin/roles.eta` | 1 | `(it.rolesByUser[u.user_id] \|\| []).forEach(...)` | `"..." is not a function` (GET /admin/roles) |
| `admin/users.eta` | 1 | `(it.deptsByUser[u.user_id] \|\| []).forEach(...)` | `"..." is not a function` |
| `functional-groups.eta` | 1 | `(it.membersByGroup[g.group_id] \|\| []).forEach(...)` | `"..." is not a function` (GET /functional-groups) |
| `packages.eta` | 1 | `(it.membersByPkg[p.package_id] \|\| []).forEach(...)` | `"..." is not a function` |
| `register.eta` | 2 | `['SOP','WI','Form','Policy','External'].forEach(...)` và `['group','bu','site','dept'].forEach(...)` | `Cannot read properties of undefined (reading 'forEach')` (GET /register) |

Tổng: **5 file, 6 vị trí**.

Ví dụ cụ thể (xác nhận qua render thật với dữ liệu giả):
- `eta.render('admin/roles.eta', {users:[{...}], rolesByUser:{...}, ...})` → ném `")</small></td>\n      <td>\n        " is not a function`.
- `eta.render('functional-groups.eta', {...})` → ném `"</td>\n      <td>\n        " is not a function`.
- `eta.render('register.eta', {bus, sites, depts, values:{}, ...})` → ném `Cannot read properties of undefined (reading 'forEach')`.

**Không dính lỗi (đối chứng, đã xác minh render OK):**
- `home.eta` — có `(<%= it.pending.length %>)` nhưng KHÔNG có câu xuất đứng trước scriptlet mở đầu `(`/`[` → render OK. Mẫu `(<%= %>)` là văn bản thường, vô hại.
- `reviews.eta` — tương tự (`(<%= it.active.length %>)`) → render OK.
- `detail.eta` — `<%= d.doc_type %> (<%= d.origin %>)` → render OK.
- `login.eta`, `compare.eta`, `qa.eta`, `matrix-options.eta` → render OK.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Mọi view không dính lỗi phải kết xuất ra cùng HTML như trước.
- Mẫu `(<%= expr %>)` tiếp tục cho ra dấu ngoặc như văn bản thường.
- Lớp `applyBasePath` (thêm tiền tố `/dcs` cho href/src/action/hx-*) không đổi.
- Cơ chế layout `<% layout('layout.eta', {...}) %>` + `<%~ it.body %>` không đổi.
- Các view dính lỗi, sau khi sửa, cho ra HTML **giống hệt về nội dung** với ý định
  gốc của template (chỉ khác ở chỗ trước đây ném lỗi, giờ kết xuất được).

**Scope:**
Mọi đầu vào KHÔNG thỏa Bug_Condition phải hoàn toàn không bị ảnh hưởng, gồm:
- Các view không có câu-xuất-trước-`(`/`[`.
- Dữ liệu mảng rỗng và mảng có phần tử cho các view đã sửa.
- Đường đi kết xuất qua `reply.view()` và hậu xử lý `applyBasePath`.

## Hypothesized Root Cause

Dựa trên dump mã biên dịch thực tế của Eta 3.5.0:

1. **Eta sinh mã không có dấu chấm phẩy (nguyên nhân gốc — ĐÃ XÁC NHẬN)**: Mỗi câu
   `__eta.res+=...` nằm trên một dòng, không kết thúc bằng `;`. Đúng/sai của chương
   trình phụ thuộc hoàn toàn vào ASI.

2. **ASI không chèn `;` trước `(` và `[` (ĐÃ XÁC NHẬN)**: Khi dòng kế tiếp bắt đầu
   bằng `(` → chuỗi bị gọi như hàm; bắt đầu bằng `[` → chuỗi bị truy cập chỉ mục
   qua toán tử dấu phẩy.

3. **Chỉ lộ khi render theo file, không lộ với `renderString` mặc định (ĐÃ XÁC
   NHẬN)**: `eta.render(file)` áp `autoTrim` mặc định khiến câu xuất và scriptlet
   nằm sát nhau đúng cách để ASI nối. Server dùng `eta.render` nên gặp lỗi trên
   production.

4. **Không phải lỗi dữ liệu, không phải mẫu `(<%= %>)` (ĐÃ BÁC BỎ giả thuyết ban
   đầu)**: các view có `(<%= %>)` render OK; lỗi độc lập với dữ liệu.

## Correctness Properties

Property 1: Bug Condition — View có câu-xuất-trước-`(`/`[` phải kết xuất được

_For any_ view `.eta` thỏa Bug_Condition (isBugCondition trả true) — tức có một câu
xuất Eta đứng ngay trước scriptlet mở đầu bằng `(` hoặc `[` — sau khi sửa, hàm kết
xuất `eta.render(view, data)` SHALL trả về một chuỗi HTML hợp lệ mà KHÔNG ném lỗi,
với mọi dữ liệu hợp lệ (kể cả mảng liên quan rỗng lẫn có phần tử).

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation — Mọi view kết xuất không ném lỗi và giữ nguyên nội dung

_For any_ view `.eta` KHÔNG thỏa Bug_Condition (isBugCondition trả false), hàm kết
xuất sau khi sửa SHALL cho ra kết quả giống hệt trước khi sửa; và cho toàn bộ tập
view, việc kết xuất với dữ liệu giả hợp lệ (mảng rỗng và mảng có phần tử) SHALL
không ném lỗi. Mẫu `(<%= expr %>)`, `applyBasePath`, và cơ chế layout được bảo toàn.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Lựa chọn hướng sửa

**Hướng (a) — Sửa từng chỗ ở tầng template (CHỌN).** Với mỗi vị trí dính lỗi, phá
thế nối câu ASI bằng cách chèn dấu `;` tường minh vào đầu scriptlet, hoặc tách biểu
thức mở đầu `(`/`[` ra một câu lệnh có tiền tố an toàn. Cách khuyến nghị: đưa mảng/
biểu thức vào một biến trước rồi mới `.forEach`, để dòng sinh ra không còn bắt đầu
bằng `(`/`[`. Ví dụ (đã xác minh sửa được lỗi):

```eta
<%# TRƯỚC (lỗi): dòng sinh bắt đầu bằng "(" %>
<% (it.rolesByUser[u.user_id] || []).forEach(function(r){ %> ... <% }) %>

<%# SAU (an toàn): gán vào biến trước, dòng sinh bắt đầu bằng "var" %>
<% var rs = (it.rolesByUser[u.user_id] || []); rs.forEach(function(r){ %> ... <% }) %>
```

Với `register.eta` (mảng literal):
```eta
<%# TRƯỚC (lỗi) %>
<% ['SOP','WI','Form','Policy','External'].forEach(function(t){ %> ... <% }) %>

<%# SAU (an toàn) %>
<% var opts = ['SOP','WI','Form','Policy','External']; opts.forEach(function(t){ %> ... <% }) %>
```

Ngoài ra, chèn `;` ở đầu scriptlet (`<% ;(it.x||[]).forEach(... %>`) cũng phá được
ASI; nhưng hướng "gán biến" dễ đọc hơn và ít gây hiểu nhầm.

**Hướng (b) — Cấu hình/plugin Eta toàn cục (KHÔNG CHỌN).** Có thể thêm một plugin
`processFnString` chèn `;` sau mọi dòng `__eta.res+=...`. Thử nghiệm cho thấy cách
này SỬA ĐƯỢC lỗi cho `register.eta` và `functional-groups.eta`, nhưng:
- Tác động toàn cục, khó suy luận, phụ thuộc nội bộ Eta (dễ vỡ khi nâng cấp).
- Trong thử nghiệm còn lộ một khác biệt phụ về resolve layout của view trong thư
  mục con (`admin/roles.eta` → `admin/layout.eta`), cho thấy đụng chạm rộng.
- Rủi ro cao hơn cho một hệ đang chạy production.

→ Chọn hướng (a): tối thiểu, cục bộ, dễ kiểm chứng bằng test render, không đụng cấu
hình chung. Chỉ sửa đúng 6 vị trí đã liệt kê.

### Changes Required

Giả định phân tích gốc đúng (đã xác nhận bằng render + dump mã biên dịch):

**File 1**: `src/views/admin/roles.eta`
- Vị trí: scriptlet `<% (it.rolesByUser[u.user_id] || []).forEach(function(r){ %>`
- Sửa: gán `var rs = (it.rolesByUser[u.user_id] || []);` rồi `rs.forEach(...)`.

**File 2**: `src/views/admin/users.eta`
- Vị trí: `<% (it.deptsByUser[u.user_id] || []).forEach(function(did){ ... %>`
- Sửa: gán `var ds = (it.deptsByUser[u.user_id] || []);` rồi `ds.forEach(...)`.

**File 3**: `src/views/functional-groups.eta`
- Vị trí: `<% (it.membersByGroup[g.group_id] || []).forEach(function(m){ %>`
- Sửa: gán `var ms = (it.membersByGroup[g.group_id] || []);` rồi `ms.forEach(...)`.

**File 4**: `src/views/packages.eta`
- Vị trí: `<% (it.membersByPkg[p.package_id] || []).forEach(function(m){ %>`
- Sửa: gán `var mm = (it.membersByPkg[p.package_id] || []);` rồi `mm.forEach(...)`.

**File 5**: `src/views/register.eta` (2 vị trí)
- Vị trí 1: `<% ['SOP','WI','Form','Policy','External'].forEach(function(t){ %>`
- Vị trí 2: `<% ['group','bu','site','dept'].forEach(function(s){ %>`
- Sửa: gán mỗi mảng literal vào một biến rồi `.forEach(...)`.

**Nguyên tắc chung khi sửa**: chỉ đổi phần scriptlet để dòng JS sinh ra không còn
bắt đầu bằng `(`/`[`; TUYỆT ĐỐI không đổi phần HTML/text để bảo toàn đầu ra.

## Testing Strategy

### Validation Approach

Hai pha: (1) surface counterexamples chứng minh lỗi tồn tại trên code CHƯA sửa; (2)
sau khi sửa, xác minh mọi view render được và không có view nào ném lỗi. Toàn bộ test
chạy ở tầng Eta render với dữ liệu giả, **không cần PostgreSQL**, dùng `node:test`
(đã có sẵn, không thêm thư viện).

Vị trí test đề xuất: `test/views/render.test.ts` (thư mục mới `test/views/`).

### Exploratory Bug Condition Checking

**Goal**: Chứng minh lỗi tồn tại TRƯỚC khi sửa, và xác nhận phân tích gốc.

**Test Plan**: Tạo một `new Eta({ views: <src/views>, cache: false })`, render từng
view dính lỗi với dữ liệu giả hợp lệ, và khẳng định nó NÉM lỗi. Chạy trên code CHƯA
sửa → phải FAIL đúng như mô tả.

**Test Cases** (chạy trên code CHƯA sửa):
1. **roles**: `eta.render('admin/roles.eta', data)` ném lỗi chứa `is not a function`.
2. **functional-groups**: `eta.render('functional-groups.eta', data)` ném `is not a function`.
3. **register**: `eta.render('register.eta', data)` ném `reading 'forEach'`.
4. **users**: `eta.render('admin/users.eta', data)` ném `is not a function`.
5. **packages**: `eta.render('packages.eta', data)` ném `is not a function`.

**Expected Counterexamples**:
- Câu xuất bị nối với dòng `(` → chuỗi bị gọi như hàm.
- Câu xuất bị nối với dòng `[` → truy cập chỉ mục qua toán tử dấu phẩy → `undefined.forEach`.

### Fix Checking

**Goal**: Sau khi sửa, mọi view thỏa Bug_Condition đều render ra HTML hợp lệ.

**Pseudocode:**
```
FOR ALL view WHERE isBugCondition(view) DO
  result := eta.render(view, validData)      // sau khi sửa
  ASSERT typeof result === "string" AND length(result) > 0 AND no_throw
END FOR
```

Đồng thời kiểm tra dữ liệu mảng rỗng cho các view đã sửa (Requirement 3.5).

### Preservation Checking

**Goal**: Với view KHÔNG thỏa Bug_Condition, đầu ra sau khi sửa giống hệt trước;
và không view nào ném lỗi.

**Pseudocode:**
```
FOR ALL view WHERE NOT isBugCondition(view) DO
  ASSERT render_original(view, data) == render_fixed(view, data)
END FOR
```

**Testing Approach**: Property-based testing phù hợp cho preservation vì bản chất là
tính chất phổ quát ("với mọi view/ mọi dữ liệu không-lỗi"). Với ngăn xếp `node:test`
(không có thư viện PBT), triển khai theo kiểu **PBT thu gọn/table-driven**: sinh một
bảng nhiều bộ dữ liệu (mảng rỗng, một phần tử, nhiều phần tử; giá trị có ký tự đặc
biệt cần escape) và lặp qua toàn bộ danh sách view, khẳng định không view nào ném lỗi.

**Test Plan**: Quan sát hành vi trên code CHƯA sửa cho các view không-lỗi (render OK,
HTML ổn định), rồi viết test khẳng định:
- Toàn bộ view render không ném lỗi (bắt được cả lỗi ASI lẫn `forEach undefined`
  trong tương lai).
- Snapshot nội dung cho một vài view đối chứng (`home.eta`, `detail.eta`) không đổi
  giữa các lần chạy.

**Test Cases**:
1. **Mẫu `(<%= %>)` bảo toàn**: render `home.eta` với `pending`/`rejected` có phần tử → HTML chứa `(<số>)` như văn bản.
2. **Layout bảo toàn**: view bất kỳ có `layout(...)` → HTML chứa khung `layout.eta` (thẻ `<html>`, sidebar).
3. **Escape bảo toàn**: giá trị chứa `<`, `&`, `"` được escape đúng qua `__eta.e`.
4. **Mảng rỗng cho view đã sửa**: `roles.eta`, `packages.eta` với mảng rỗng → render OK.

### Unit Tests

- Render từng view dính lỗi (5 view) với dữ liệu giả → khẳng định không ném lỗi sau khi sửa.
- Render với mảng rỗng và mảng có phần tử cho các view đã sửa.
- Kiểm tra một vài chuỗi HTML kỳ vọng xuất hiện (ví dụ email trong `<small>(...)</small>` ở roles).

### Property-Based Tests

- Bảng dữ liệu (table-driven, kiểu PBT thu gọn với `node:test`) quét TOÀN BỘ `src/views/**/*.eta`, mỗi view thử với nhiều biến thể dữ liệu (rỗng / một / nhiều phần tử) → khẳng định không view nào ném lỗi. Đây là test phòng ngừa chính, bắt cả lỗi ASI lẫn `forEach undefined` trong tương lai.
- (Tùy chọn) Detector cấu trúc: biên dịch mọi view và khẳng định KHÔNG còn cặp "câu-xuất → dòng bắt đầu `(`/`[`" (bám sát isBugCondition), làm hàng rào chống tái phát.

### Integration Tests

- (Tùy chọn, không bắt buộc cho spec này) Khởi Fastify + `registerViewLayer`, gọi `reply.view()` cho các route đã sập và khẳng định HTTP 200. Cần mock/tránh PostgreSQL nên để ở mức tùy chọn; test tầng Eta render đã đủ chứng minh fix.
