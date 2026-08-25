# Auto fill google form

Chrome Extension mã nguồn mở để quét, tạo mẫu câu trả lời và kiểm thử Google Forms mà người dùng kiểm soát.

## Tính năng hiện có

- Kiểm tra URL `docs.google.com/forms` và liên kết rút gọn `forms.gle`.
- Quét URL trong service worker mà không tự mở Google Form ra tab mới; tab form chỉ xuất hiện khi người dùng chủ động mở hoặc bắt đầu chạy.
- Đọc metadata toàn biểu mẫu từ `FB_PUBLIC_LOAD_DATA_`, sau đó đối chiếu từng trang bằng `data-params`; có ARIA fallback khi cấu trúc nội bộ không đọc được.
- Nhận diện trả lời ngắn, đoạn văn, trắc nghiệm, hộp kiểm, dropdown, phạm vi tuyến tính, xếp hạng, ngày, giờ và hai loại lưới.
- Nhận diện và hiển thị câu hỏi theo từng phần/trang của Google Form.
- Tự điền từng trang, bấm **Tiếp** và dừng ở trang cuối hoặc gửi phản hồi; nhánh rẽ được Google quyết định theo đáp án mẫu đã chọn.
- Dựng workspace nhập câu trả lời mẫu gần với bố cục Google Forms.
- Lưu mẫu cục bộ bằng `chrome.storage.local`.
- Điền form một lần để người dùng kiểm tra trước khi gửi.
- Gửi một phản hồi sau khi người dùng xác nhận.
- Gửi tối đa 10 phản hồi cho mỗi lần chạy, không yêu cầu URL quản trị `/edit`.

## Giới hạn hiện tại

- Không tự chọn tệp tải lên.
- Mục “Khác” nên được kiểm tra thủ công.
- Với form phân nhánh, workspace vẫn yêu cầu đáp án mẫu cho mọi câu bắt buộc được khai báo, kể cả câu ở nhánh có thể không đi qua.
- Không vượt CAPTCHA, yêu cầu đăng nhập, giới hạn một phản hồi hoặc quyền truy cập của Google.
- `FB_PUBLIC_LOAD_DATA_` và `data-params` là cấu trúc nội bộ có thể thay đổi; ARIA fallback được dùng để giảm rủi ro nhưng không đảm bảo tương thích tuyệt đối.

## Cài đặt dạng unpacked

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chọn **Load unpacked**.
4. Chọn thư mục dự án này.
5. Ghim **Auto fill google form** lên thanh công cụ.

Extension không yêu cầu OAuth. Nếu form cần đăng nhập, người dùng đăng nhập Google trực tiếp trong trình duyệt; extension chỉ hoạt động trên DOM của trang form.

## Sử dụng

1. Mở **Auto fill google form** và dán liên kết người trả lời hoặc liên kết xem trước.
2. Chọn **Phân tích biểu mẫu**.
3. Nhập câu trả lời mẫu trong workspace.
4. Chọn **Điền và mở form** để kiểm tra.
5. Nếu muốn gửi, xác nhận nội dung và chọn **Điền và gửi thử**.

## Kiểm thử mã nguồn

Yêu cầu Node.js 18 trở lên, không cần cài dependency:

```bash
npm test
npm run validate
```

## Quyền extension

- `tabs`: mở và chuyển tới tab form cần kiểm thử.
- `scripting`: nạp bộ quét vào tab đã mở trước khi extension được cài.
- `storage`: lưu mẫu câu trả lời trên thiết bị.
- Host permissions chỉ giới hạn ở `docs.google.com/forms/*` và `forms.gle/*`.

## Nguyên tắc sử dụng

Chỉ dùng chế độ gửi nhiều lượt để kiểm thử form thuộc quyền sở hữu hoặc quản lý của bạn. Không sử dụng để spam, tạo phản hồi giả hoặc làm sai lệch khảo sát của bên khác.

## License

MIT
