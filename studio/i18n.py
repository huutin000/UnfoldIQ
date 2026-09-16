"""
UnfoldIQ Localization & Internationalization (i18n) Engine — Phase 14
Default UI Locale: vi-VN
Default Content Language: en-US
Technical Prompt Language: en

Preserves system IDs, scientific taxonomy (e.g. Homo habilis), and technical tool names.
Provides dictionary-based lookup for UI components without hardcoded text.
"""

from typing import Dict, Any, Optional

DEFAULT_UI_LOCALE = "vi-VN"
DEFAULT_CONTENT_LANGUAGE = "en-US"
DEFAULT_PROMPT_LANGUAGE = "en"

# Status Enums mapped to Vietnamese UI labels
STATUS_MAP_VI: Dict[str, str] = {
    # Project / Scene readiness
    "NOT_STARTED": "Chưa bắt đầu",
    "IN_PROGRESS": "Đang thực hiện",
    "READY": "Sẵn sàng",
    "REVIEW": "Cần xem xét",
    "BLOCKED": "Bị chặn",
    "PARTIAL": "Chưa đầy đủ",
    "MISSING": "Thiếu",
    "OUTDATED": "Cần cập nhật",
    "LOCKED": "Đã khóa",
    "UNLOCKED": "Chưa khóa",
    "STALE": "Cần đồng bộ",
    
    # Asset lifecycle
    "GENERATED": "Đã tạo",
    "SELECTED": "Đã chọn",
    "APPROVED": "Đã duyệt",
    "REJECTED": "Đã từ chối",
    "ARCHIVED": "Đã lưu trữ",
    "DISCOVERED": "Đã tìm thấy",
    
    # Job lifecycle
    "QUEUED": "Đang chờ",
    "RUNNING": "Đang chạy",
    "PAUSED": "Tạm dừng",
    "INTERRUPTED": "Bị gián đoạn",
    "RESUMABLE": "Có thể tiếp tục",
    "COMPLETED": "Hoàn tất",
    "SUCCESS": "Thành công",
    "FAILED": "Thất bại",
    "CANCELLED": "Đã hủy",

    # Project Integrity lifecycle
    "HEALTHY": "Ổn định",
    "WARNING": "Cần kiểm tra",
    "BROKEN": "Có lỗi",

    # Asset Integrity
    "VALID": "Hợp lệ",
    "MODIFIED": "Đã thay đổi",
    
    # Evidence Types (Human Origins scientific policy)
    "DIRECT_EVIDENCE": "Bằng chứng trực tiếp",
    "SUPPORTED_INFERENCE": "Suy luận có cơ sở",
    "PLAUSIBLE_RECONSTRUCTION": "Tái hiện hợp lý",
    "SPECULATIVE": "Suy đoán",
    "UNSUPPORTED": "Chưa có cơ sở",
    
    # Confidence levels
    "HIGH": "Độ tin cậy cao",
    "MEDIUM": "Độ tin cậy trung bình",
    "LOW": "Độ tin cậy thấp",
    
    # Cost policies
    "FREE_FIRST": "Ưu tiên miễn phí",
    "FREE_ONLY": "Chỉ dùng miễn phí",
    "BALANCED": "Cân bằng",
    "BEST_QUALITY": "Chất lượng cao nhất",
    
    # Canonical Reference Angles
    "FRONT": "Chính diện",
    "THREE_QUARTER": "Góc 3/4",
    "PROFILE": "Góc nghiêng",
    "FULL_BODY": "Toàn thân",
}

# UI Dictionary for vi-VN
UI_DICTIONARY_VI: Dict[str, str] = {
    # Navigation
    "nav.home": "Trang chủ",
    "nav.projects": "Dự án",
    "nav.library": "Thư viện",
    "nav.activity": "Hoạt động",
    "nav.settings": "Cài đặt",
    
    # Project Navigation Tabs
    "project.tab.overview": "Tổng quan",
    "project.tab.content": "Nội dung",
    "project.tab.scenes": "Cảnh",
    "project.tab.studio": "Studio",
    "project.tab.review": "Kiểm tra",
    "project.tab.export": "Xuất video",
    
    # Sub-tabs
    "content.research": "Nghiên cứu",
    "content.script": "Kịch bản",
    "studio.storyboard": "Storyboard",
    "studio.timeline": "Dòng thời gian (Timeline)",
    
    # Common actions
    "action.create": "Tạo mới",
    "action.save": "Lưu thay đổi",
    "action.cancel": "Hủy bỏ",
    "action.delete": "Xóa",
    "action.edit": "Chỉnh sửa",
    "action.generate": "Tạo",
    "action.regenerate": "Tạo lại",
    "action.retry": "Thử lại",
    "action.approve": "Phê duyệt",
    "action.reject": "Từ chối",
    "action.lock": "Khóa",
    "action.unlock": "Mở khóa",
    "action.import": "Nhập dữ liệu",
    "action.export": "Xuất dữ liệu",
    "action.copy_prompt": "Sao chép prompt",
    "action.copy_success": "Đã sao chép prompt vào bộ nhớ tạm!",
    "action.open": "Mở",
    "action.close": "Đóng",
    "action.refresh": "Làm mới",
    "action.view_details": "Xem chi tiết",
    "action.continue_production": "Tiếp tục sản xuất",
    
    # Research workspace
    "research.title": "Nghiên cứu & Nguồn tài liệu",
    "research.mode.assisted": "AI tìm nguồn (Có người duyệt)",
    "research.mode.manual": "Nguồn tự cung cấp",
    "research.mode.auto": "Tự động hoàn toàn",
    "research.sources_count": "Nguồn tài liệu",
    "research.claims_count": "Nhận định khoa học",
    "research.lock_source_set": "Khóa bộ nguồn",
    "research.locked_notice": "Bộ nguồn đã khóa. Mọi nghiên cứu tiếp theo sẽ dựa trên các nguồn này.",
    "research.add_source": "Thêm nguồn URL / Tài liệu",
    "research.run_synthesis": "Tổng hợp nghiên cứu & Claim Ledger",
    
    # Script workspace
    "script.title": "Kịch bản phóng sự",
    "script.outline": "Dàn ý câu chuyện",
    "script.version": "Phiên bản kịch bản",
    "script.approve_version": "Phê duyệt kịch bản này",
    "script.claims_linked": "Nhận định khoa học liên kết",
    "script.vi_explanation": "Bản diễn giải tiếng Việt",
    "script.outdated_warning": "Kịch bản đã sửa đổi: Giọng đọc, timing và cảnh quay cần được đồng bộ lại.",
    
    # Scene workspace
    "scene.title": "Danh sách cảnh quay",
    "scene.simple_mode": "Chế độ đơn giản",
    "scene.advanced_mode": "Chế độ nâng cao",
    "scene.duration": "Thời lượng",
    "scene.narration": "Lời dẫn",
    "scene.visual_prompt": "Prompt tạo hình",
    "scene.characters": "Nhân vật xuất hiện",
    "scene.environment": "Bối cảnh / Môi trường",
    "scene.import_visual": "Nhập video từ Google Flow",
    "scene.needs_visual": "Cần tạo visual",
    "scene.status": "Trạng thái",
    
    # Library
    "library.title": "Thư viện tài sản chuẩn hóa",
    "library.characters": "Nhân vật",
    "library.environments": "Môi trường",
    "library.objects": "Vật thể / Công cụ",
    "library.styles": "Phong cách hình ảnh",
    "library.media": "Media đã duyệt",
    
    # Review & QC
    "review.title": "Kiểm tra chất lượng & Xử lý lỗi",
    "review.issues_count": "Vấn đề cần xử lý",
    "review.technical_qc": "Kiểm tra kỹ thuật (FFprobe)",
    "review.continuity_qc": "Kiểm tra tính nhất quán hình ảnh",
    "review.targeted_fix": "Sửa đúng cảnh lỗi",
    
    # Export & Deliverables
    "export.title": "Xuất bản video cuối cùng",
    "export.draft_render": "Xuất bản dựng nháp (720p siêu tốc)",
    "export.final_render": "Xuất bản video chính thức (1080p Master)",
    "export.package": "Tải gói bàn giao đầy đủ (MP4 + SRT + Nguồn)",
    "export.free_first_badge": "100% Xử lý nội bộ / Miễn phí",

    # Phase 15A Production Hardening
    "storage.title": "Quản lý bộ nhớ",
    "storage.tab": "Bộ nhớ",
    "storage.projects": "Dự án",
    "storage.render_cache": "Render cache",
    "storage.test_cache": "Cache kiểm thử",
    "storage.logs": "Nhật ký",
    "storage.models": "Models",
    "storage.python_env": "Môi trường Python",
    "storage.exports": "Exports",
    "storage.temp_files": "Temporary files",
    "storage.free_disk": "Dung lượng trống",
    "storage.cleanup_preview": "Xem trước dọn dẹp",
    "storage.cleanup_confirm": "Xác nhận dọn dẹp",
    "storage.cleanup_done": "Đã dọn dẹp thành công",

    "backup.title": "Sao lưu dự án",
    "backup.restore_title": "Khôi phục dự án",
    "backup.light": "Sao lưu nhẹ",
    "backup.full": "Sao lưu đầy đủ",
    "backup.verify": "Kiểm tra bản sao lưu",
    "backup.archive": "Lưu trữ dự án",

    "integrity.check_action": "Kiểm tra dự án",
    "integrity.dashboard_title": "Sức khỏe dự án",
    "integrity.healthy": "Ổn định",
    "integrity.warning": "Cần kiểm tra",
    "integrity.broken": "Có lỗi",

    "diagnostics.export_action": "Xuất gói chẩn đoán",

    "shutdown.warning": "Có tác vụ đang chạy.",
    "shutdown.wait": "Chờ hoàn tất",
    "shutdown.safe_stop": "Dừng an toàn",
    "shutdown.cancel": "Hủy",
}

# English dictionary fallback / optional
UI_DICTIONARY_EN: Dict[str, str] = {
    "nav.home": "Home",
    "nav.projects": "Projects",
    "nav.library": "Library",
    "nav.activity": "Activity",
    "nav.settings": "Settings",
    
    "project.tab.overview": "Overview",
    "project.tab.content": "Content",
    "project.tab.scenes": "Scenes",
    "project.tab.studio": "Studio",
    "project.tab.review": "Review",
    "project.tab.export": "Export",
}

def get_status_label(status_code: str, locale: str = DEFAULT_UI_LOCALE) -> str:
    """Return localized label for a status enum code."""
    if not status_code:
        return ""
    code_clean = str(status_code).upper().strip()
    if locale.startswith("vi"):
        return STATUS_MAP_VI.get(code_clean, status_code)
    return status_code

def t(key: str, locale: str = DEFAULT_UI_LOCALE, default: Optional[str] = None) -> str:
    """Translate a dictionary key into the specified locale."""
    dict_map = UI_DICTIONARY_VI if locale.startswith("vi") else UI_DICTIONARY_EN
    if key in dict_map:
        return dict_map[key]
    if key in UI_DICTIONARY_EN:
        return UI_DICTIONARY_EN[key]
    return default if default is not None else key

def get_full_dictionary(locale: str = DEFAULT_UI_LOCALE) -> Dict[str, Any]:
    """Return complete frontend localization package."""
    strings = UI_DICTIONARY_VI if locale.startswith("vi") else UI_DICTIONARY_EN
    return {
        "locale": locale,
        "defaultUiLocale": DEFAULT_UI_LOCALE,
        "defaultContentLanguage": DEFAULT_CONTENT_LANGUAGE,
        "strings": strings,
        "statuses": STATUS_MAP_VI,
    }
