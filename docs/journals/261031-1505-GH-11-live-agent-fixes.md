---
title: "Issue #11 sửa lỗi agent và kiểm chứng E bằng LIVE API"
created: 2026-10-31
status: resolved-locally
---

# Sửa lỗi agent và kiểm chứng E bằng LIVE API

**Date**: 2026-10-31 15:05
**Severity**: Medium
**Component**: src/server/agent.ts, src/server/agent-tools.ts, luồng học quy tắc E
**Status**: Resolved locally; hosted chưa kiểm chứng

## What Happened

Chrome DevTools chạy Vinext thật với API key thật và gpt-6.1-terra đã lộ ra hai vấn đề. Phản hồi A/B hiển thị SIMULATED: SIMULATED: .... Luồng E đáng lẽ tạo gợi ý học quy tắc thì bị dừng vì model gọi escalate chỉ để lặp lại lý do policy đã có.

## The Brutal Truth

Chúng ta đã tin rằng nhãn mô phỏng trong output model sẽ luôn đúng định dạng mà không kiểm tra qua route thật. Điều này chỉ lộ ra khi dùng provider thật, sau khi các test unit đã xanh. Cảm giác rất khó chịu: lỗi hiển thị nhỏ kéo theo nghi ngờ về cả provenance của E. May là guard backend không bị vượt qua; dữ liệu chưa học sai quy tắc.

## Technical Details

Tool draft_reply trước đây luôn nối SIMULATED: vào input. Nếu model đã trả tiền tố, kết quả bị nhân đôi. Bản sửa chỉ loại các tiền tố ở đầu chuỗi, từ chối draft rỗng sau chuẩn hóa bằng INVALID_TOOL_CALL, và có regression tests cho tiền tố lặp và tiền tố-only.

Timeline LIVE của E trước sửa ghi check_policy → escalate → draft_reply, với lý do Policy requires owner review of the requested return and refund. Sau sửa, prompt và mô tả tool nói rõ NEEDS_OWNER_REVIEW đã là tuyến owner; escalate chỉ dành cho mối lo bổ sung. Guard case-api.ts vẫn loại AGENT_ESCALATION khỏi learning.

## What We Tried

Sửa formatter trước, rồi review phát hiện draft chỉ toàn tiền tố vẫn được chấp nhận. Đã bổ sung guard và test trước khi chạy lại E.

## Root Cause Analysis

Hợp đồng giữa model và tool không chuẩn hóa biên giới trách nhiệm: tool vừa gắn nhãn, vừa giả định model không gắn nhãn; prompt cũng cho phép escalate quá rộng. Test mock không tái hiện được lựa chọn tool của model thật.

## Lessons Learned

Chuẩn hóa output phải nằm ở tool và fail closed khi không còn nội dung. Policy reason và agent escalation là hai tín hiệu khác nhau; không được để model lặp policy thành escalation. E cần kiểm chứng bằng provider thật, không chỉ TEST.

## Next Steps

Kiểm chứng cuối: backend 29/29, typecheck, lint phần sửa và build PASS. Chrome MCP với provider thật chứng minh E pending → accept riêng → fresh evaluation với D provenance; A/B chạy lại cũng chỉ có một tiền tố. [Báo cáo chi tiết](../../plans/reports/fix-261031-1505-GH-11-live-agent-report.md).

- Giữ backend guard và regression test trong branch hiện tại.
- Khoa review revision mới; hosted Site/D1 vẫn cần quyền và fixture riêng.
- Khi có thay đổi prompt/model, chạy lại E LIVE và ghi operation/provider ID.

## Unresolved Questions

Hosted deployment và protected-edge identity vẫn chưa có bằng chứng.
