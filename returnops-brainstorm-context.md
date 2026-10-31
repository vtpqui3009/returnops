# ReturnOps — Context cho agent brainstorm ngày thi

> **Sự kiện:** Sea × OpenAI Regional Codex Hackathon Vietnam — 31/10/2026.  
> **Context được kiểm tra:** 30/10/2026. Đây là tài liệu chuẩn bị/brainstorm, **không phải code sản phẩm, đặc tả thay thế hay bằng chứng đã hoàn thành**.

## 1. Prompt cho agent

Bạn là đối tác brainstorm của team ReturnOps. Hãy giúp team chọn MVP khả thi, có demo thuyết phục và thể hiện rõ **Autonomous & Adaptive AI** trong thời gian hackathon. Đọc hết tài liệu và các nguồn liên quan trước khi đề xuất.

- Bám ý tưởng đã đăng ký, phân biệt đăng ký lịch sử với scope hiện hành.
- Chỉ brainstorm và đề xuất; **chưa viết code, đổi spec, chốt stack hay nhận thay quyết định của team**.
- Dán nhãn rõ: **đã có bằng chứng / giả thuyết / đề xuất / cần xác nhận**. Không gọi mock, replay hoặc receipt mô phỏng là tích hợp thật.
- Ưu tiên một demo chạy được, có quyền hạn rõ và bằng chứng kiểm thử, thay vì nhiều tính năng.
- Nếu nguồn mới khác tài liệu này, chỉ ra khác biệt, hỏi team xác nhận; không âm thầm mở rộng phạm vi.

## 2. Team đã đăng ký gì?

**Build direction: Autonomous & Adaptive AI.**

**Ý tưởng:** ReturnOps là agent giúp shop nhỏ Việt Nam xử lý yêu cầu trả hàng/hoàn tiền: đọc case và đơn hàng, kiểm quy tắc, xác định bằng chứng thiếu, đề xuất hướng xử lý, soạn phản hồi/hồ sơ và chuyển ngoại lệ cho chủ shop. Timeline cho thấy agent đọc gì, quyết định gì và vì sao.

**Vấn đề đăng ký:** Shop xử lý thủ công, phản hồi chậm hoặc thiếu chứng cứ; người bán ít thời gian đọc chính sách từng nền tảng. Thiệt hại, ảnh hưởng return rate/ranking là **giả thuyết cần seller validation**, không phải kết quả đã đo.

**Người dùng:** Shop nhỏ 1–3 người, khoảng 10–100 đơn/ngày, không có CS chuyên trách. Agency và đa kênh là hướng mở rộng.

**Bốn phương án nghiệp vụ:** `REFUND_NOW`, `RETURN_THEN_REFUND`, `PARTIAL_REFUND`, `DISPUTE`. Đây là phương án trong hệ thống mô phỏng, không cấp quyền chuyển tiền thật.

Bản đăng ký mô tả agent core, bộ quy tắc, dữ liệu đơn/case giả lập và dashboard; dự kiến ba demo: hợp lệ, thiếu chứng cứ, mâu thuẫn cần escalate. Codex được dùng để scaffold, xây agent/tools, viết test policy/guardrail, xử lý failing tests và lưu bằng chứng quá trình build.

**Mức chắc chắn:** Track và ý tưởng được ghi rõ trong bản lưu câu trả lời đăng ký của team và kế hoạch hiện hành. Chưa tìm thấy receipt gốc của form đăng ký hoặc email BTC xác nhận riêng track. Không suy luận track chỉ từ tên ReturnOps.

## 3. Scope hiện hành khác đăng ký ra sao?

Kế hoạch hiện hành là **một shop mô phỏng**, mở từ ba lên năm luồng. Không hứa tích hợp Shopee/TikTok/Facebook/Zalo thật. Hồ sơ là packet + receipt **SIMULATED**, không nộp sàn/gửi người mua/chuyển tiền. Policy là quy tắc DEMO của team, chưa được xác minh là mapping chính sách Shopee.

Quy tắc shop được sửa qua cấu hình có validate/reset; không mặc định có browser rule editor. Hard cap không tự thay đổi. Khi cần chi tiết contract, đọc `setup-kit/docs/` trong repo nguồn; bản đăng ký chỉ là tài liệu lịch sử, không ghi đè spec hiện hành.

### Năm luồng demo

| Luồng | Tình huống | Hành vi cần chứng minh |
|---|---|---|
| **A — Hợp lệ** | Áo 189.000đ giao sai size; packing video xác nhận shop đóng nhầm | Intake tự kích hoạt xử lý; chọn RETURN_THEN_REFUND; sinh reply/packet/receipt SIMULATED và đóng xử lý nội bộ. |
| **B — Thiếu chứng cứ** | Bình giữ nhiệt 245.000đ bị móp; thiếu packing video | Xin đúng SELLER packing proof; proof sai tracking vẫn chờ; proof đúng đã xác minh khiến workflow tự resume. Không dừng demo ở một dòng “thiếu bằng chứng”. |
| **C — Mâu thuẫn** | Tai nghe 1.250.000đ báo chưa nhận nhưng có ảnh giao hàng; 3 khiếu nại/90 ngày | Giữ đủ lý do escalate; owner review proof và duyệt hồ sơ DISPUTE nội bộ. Không học rule từ ngoại lệ này. |
| **D — Dạng mới** | Áo không vừa, chưa dùng/còn tem; ≤7 ngày; hàng trả ≤300.000đ; đủ proof, không cờ escalate, chưa có rule | Hỏi chủ shop; owner chọn RETURN_THEN_REFUND và ghi lý do; tạo gợi ý learning chưa có hiệu lực. |
| **E — Sau learning** | Đơn khác cùng điều kiện D | Trước duyệt vẫn hỏi; sau thao tác accept rule riêng thì đánh giá lại và hoàn tất nội bộ, dẫn nguồn D. Không tái dùng kết quả cũ. |

**Điểm nhấn:** Owner xử lý một case và owner duyệt một rule là **hai thao tác khác nhau**. Adaptive phải thể hiện bằng thay đổi hành vi có kiểm soát, không chỉ ghi thêm một dòng “đã học”.

## 4. Ranh giới bắt buộc

- Agent không tự hoàn tiền, gửi buyer, nộp sàn, chuyển tiền hoặc vượt guardrail.
- Không tự sửa/accept rule. Rule pending không ảnh hưởng E; chỉ explicit approval mới kích hoạt learning.
- Case thiếu proof, mâu thuẫn, vượt giới hạn phải chờ hoặc escalate; không bịa facts để đi tiếp.
- File tồn tại không đồng nghĩa chứng cứ đã verified. Cần đúng order/tracking, proof hiện hành và trạng thái xác minh.
- Auto/manual permissions tách biệt; owner xử lý C không xóa flags hoặc tạo learned rule.
- Năm tools hiện hành: `read_order`, `check_policy`, `list_missing_evidence`, `draft_reply`, `escalate`. Upload/review/owner approval không mặc nhiên trở thành quyền mới của LLM.
- Không claim AI hiểu toàn bộ video. Kế hoạch hiện hành để owner review MP4; image LIVE cần probe bằng bytes thật. TEST/scripted observations phải gắn nhãn.
- LIVE, REPLAY, TEST và hosting bền vững là các trạng thái riêng; chưa có evidence thì không gọi là đã đạt.

## 5. Luật thi và điều kiện giao bài

Theo briefing BTC và email nhắc ngày 30/10:

- Ý tưởng và build direction ngày thi phải phù hợp đăng ký ban đầu. Track hướng tới agent chạy đáng tin cậy không cần giám sát liên tục và tốt hơn khi hoạt động nhiều hơn.
- Làm bài **tại địa điểm thi**. BTC cho phép bắt đầu mới hoặc mở rộng dự án có sẵn nếu phần mới đáng kể; **chỉ phần làm trong hackathon được chấm**.
- Dùng **repo public mới**; khai báo/link dự án, OSS và tài nguyên có sẵn thực tế trong README/submission theo yêu cầu. Nêu rõ phần xây trong ngày thi.
- Team đã chọn phương án chặt hơn: dựng bài thi mới trong ngày; rehearsal chỉ kiểm prompt, **không chuyển implementation/tests/fixtures/recordings/history từ rehearsal sang bài nộp**. Tài liệu chuẩn bị cũng cần khai báo phù hợp; không khuyên che giấu nguồn.
- Check-in 08:30–09:15; đủ ít nhất 3 thành viên hiện diện trọn ngày. Mỗi người mang giấy tờ tùy thân, laptop, sạc. Hacking bắt đầu 10:00 theo agenda.
- **Final trước 17:00 ngày 31/10/2026**; email nhắc không được sửa/thay/update sau hạn. Nộp đủ: repo public mới, project write-up PDF, live demo/prototype link, declarations. Kiểm tra link truy cập được.
- Pitch/demo **6 phút + 2 phút Q&A**, áp dụng cả hai vòng. Chấm sản phẩm chạy thật, không chỉ pitch.
- Sáu tiêu chí: problem–solution fit; build quality; insight/originality; real-world value; alignment với build direction; mức sử dụng Codex.
- **Mốc nộp giữa giờ chưa thống nhất:** agenda ghi WIP lúc 14:30, trang submission ghi hạn 15:30. Xác nhận BTC trong ngày; không khẳng định một mốc là chắc chắn.

## 6. Câu hỏi cần brainstorm

1. MVP nhỏ nhất chứng minh **autonomy + adaptation an toàn** là gì? A/B/D/E cần phần nào chạy thật; C cần chứng minh ngoại lệ ra sao?
2. Demo trước/sau approval của E có đủ thuyết phục? Làm sao loại trừ khả năng hardcode kết quả hoặc dùng cached output?
3. Ranh giới deterministic policy/workflow và LLM nên đặt ở đâu? Đề xuất tối đa hai phương án kiến trúc; so với stack/spec hiện hành trước khi khuyên đổi. Không tự coi phương án mới là quyết định đã duyệt.
4. Proof lifecycle, resume, idempotency và rule versioning tối thiểu phải có gì? Race nào nguy hiểm nhất khi upload/approve đồng thời?
5. Test nào chứng minh “không được làm” thay vì chỉ happy path? Ưu tiên pending rule, proof sai tracking, vượt cap, duplicate event, stale proof và C không tạo learning.
6. Giá trị người dùng nào có thể đo trong demo mà không bịa ROI: số bước thủ công, thời gian xử lý trong simulation, tỉ lệ yêu cầu đúng proof, chất lượng explanation?
7. Nếu thiếu thời gian/model/hosting, cắt gì trước? Phương án fallback có nhãn trung thực nào vẫn giữ integrity của demo?
8. Thu thập prompt/diff/test evidence thế nào để chứng minh Codex đóng góp mà không lộ secrets?

## 7. Định dạng đầu ra mong muốn

Trả lời bằng tiếng Việt, ngắn và có quyết định rõ:

1. **Tóm tắt hướng đề xuất** trong 5–8 dòng; điều giữ nguyên và điều đề xuất thay đổi.
2. **Bảng MVP:** must-have / nice-to-have / bỏ; lý do gắn tiêu chí chấm.
3. **Autonomy/adaptation proof:** trigger → quyết định → guardrail → observable evidence cho A–E.
4. **Tối đa 2 kiến trúc đề xuất:** trade-off, công sức, rủi ro, tương thích spec; không viết code.
5. **Test và demo checklist:** happy path, negative tests, điều kiện pass, LIVE/TEST/REPLAY label.
6. **Timebox đề xuất 10:00–17:00:** build, integration, kiểm thử, deploy, PDF/declarations, buffer nộp. Đây là kế hoạch đề xuất, không phải mốc BTC ngoài các hạn đã xác minh; bố trí xác nhận WIP sớm.
7. **Kịch bản demo 6 phút** và 5 câu hỏi giám khảo khó nhất.
8. **Tối đa 5 câu hỏi team phải trả lời ngay**, cùng assumptions tạm thời; không tự đoán readiness, model, deployment hoặc phân công.

## 8. Nguồn để kiểm chứng

- [Bản lưu nguyên văn câu trả lời đăng ký, ghi nhận 25/10](https://github.com/vtpqui3009/returnops-playbook/blob/main/plan/reports/20261025-registration-answers.md)
- [Scope hiện hành và năm luồng A–E](https://github.com/vtpqui3009/returnops-playbook/blob/main/plan/01-tong-quan.md)
- [README: quy trình đọc repo, lựa chọn dựng mới, nguồn lịch sử](https://github.com/vtpqui3009/returnops-playbook/blob/main/README.md)
- [Specs hiện hành — cần đọc trước khi khuyên đổi contract](https://github.com/vtpqui3009/returnops-playbook/tree/main/setup-kit/docs)
- [Briefing chính thức BTC, đã kiểm tra bản cập nhật 30/10](https://docs.google.com/presentation/d/1ltdXPQMjyuGdeYinQcMWee_igKWhul0UmTaNDxtyOTM/edit)
- Email BTC “You’re in!”, 08/10 và “[Important] Event Details & Reminders”, 30/10: xác nhận đội, attendance, khai báo nguồn, hạn final. Không đưa email cá nhân, mã credits hay thông tin định danh vào tài liệu handoff này.
