"use strict";
/* UNFOLDIQ Flow Companion — centralized Vietnamese strings (POST-v1D §32).
 * No Vietnamese copy hard-coded in event handlers; import from here.
 * Technical enums stay English for debugging consistency.
 */
(function () {
  const vi = {
    appName: "UNFOLDIQ",
    // Connection status (compact, human language — never raw enums).
    statusReady: "Sẵn sàng",
    statusConnecting: "Đang kết nối",
    statusNeedFlow: "Cần mở Google Flow",
    statusNeedConfig: "Cần cấu hình",
    statusError: "Có lỗi",
    statusPreparing: "Đang chuẩn bị",
    statusAttention: "Cần xử lý",
    statusAwaiting: "Chờ duyệt",
    statusGenerating: "Đang tạo",
    statusProcessing: "Đang xử lý",
    statusDone: "Hoàn tất",
    // Primary actions — exactly one visible per state (§37).
    ctaFindJob: "Tìm công việc",
    ctaConnecting: "Đang kết nối…",
    ctaPreparing: "Đang chuẩn bị…",
    ctaOpenSettings: "Mở cài đặt",
    ctaRetry: "Thử lại",
    ctaApproveCreate: "Duyệt & Tạo",
    ctaCreating: "Đang tạo…",
    ctaProcessing: "Đang xử lý…",
    ctaViewResult: "Xem kết quả",
    ctaViewIssue: "Xem vấn đề",
    ctaFindNewJob: "Tìm công việc mới",
    secondaryReject: "Từ chối",
    // Job card.
    createImage: "Tạo ảnh",
    createVideo: "Tạo video",
    viewDetails: "Xem chi tiết",
    hideDetails: "Ẩn chi tiết",
    viewFull: "Xem đầy đủ",
    showLess: "Thu gọn",
    costLabel: "credit",
    // Stepper.
    stepPrepare: "Chuẩn bị",
    stepAwait: "Chờ duyệt",
    stepCreate: "Tạo",
    stepDone: "Hoàn tất",
    // Errors (human first, code under Chi tiết kỹ thuật).
    errFlowTitle: "Không kết nối được với Google Flow.",
    errFlowBody: "Hãy mở hoặc tải lại tab Google Flow rồi thử lại.",
    errBridgeTitle: "Không kết nối được Bridge.",
    errBridgeBody: "Hãy kiểm tra Bridge đang chạy ở máy cục bộ rồi thử lại.",
    errGenericTitle: "Có lỗi xảy ra.",
    errGenericBody: "Hãy thử lại. Nếu lỗi tiếp diễn, mở Cài đặt để xem chi tiết.",
    errPreparationTitle: "Không thể hoàn tất chuẩn bị.",
    errPreparationBody: "Flow chưa đạt điều kiện tạo nội dung theo công việc. Hãy thử lại; nếu lỗi tiếp diễn, xem mã lỗi ở Chi tiết kỹ thuật.",
    techDetails: "Chi tiết kỹ thuật",
    // Reference (conditional, compact).
    refTitle: "Ảnh tham chiếu",
    refKeep: "Giữ",
    refAllowed: "Cho phép thay đổi",
    refChange: "Thay đổi",
    // Settings.
    settings: "Cài đặt",
    back: "Quay lại",
    sectionConnection: "Kết nối",
    sectionProject: "Dự án",
    sectionAppearance: "Giao diện",
    sectionAbout: "Giới thiệu",
    fieldBridgeUrl: "URL Bridge (chỉ máy cục bộ)",
    fieldBridgeToken: "Mã truy cập Bridge",
    fieldProject: "Mã dự án",
    fieldJob: "Mã công việc",
    fieldDevMode: "Chế độ nhà phát triển",
    devTools: "Công cụ nhà phát triển",
    devDiag: "Chẩn đoán",
    devSelectors: "Trạng thái điều khiển",
    devProbe: "Kiểm tra giao diện Flow",
    devRawJob: "Công việc gốc",
    devLogs: "Nhật ký",
    // Toasts (simplified copy).
    toastConnected: "Đã kết nối Google Flow",
    toastJobLoaded: "Đã tải công việc",
    toastPreparing: "Đang chuẩn bị…",
    toastReady: "Đã sẵn sàng",
    prepDone: "Đã chuẩn bị xong",
    prepFailed: "Không thể hoàn tất chuẩn bị",
    toastCreating: "Đang tạo nội dung…",
    toastResult: "Đã tải kết quả",
    toastDone: "Đã hoàn tất",
    toastRejected: "Đã từ chối công việc",
    toastImported: "Đã nhập asset vào UNFOLDIQ",
    toastSaved: "Đã lưu cấu hình",
    emptyJob: "Chưa có công việc nào. Nhấn “Tìm công việc” để bắt đầu.",
  };

  if (typeof window !== "undefined") window.FlowUIStrings = vi;
  if (typeof module !== "undefined" && module.exports) module.exports = vi;
})();
