/**
 * UnfoldIQ Studio Client-Side i18n & Badge Engine — Phase 14
 * Default UI Locale: vi-VN
 * Default Content Language: en-US
 */

const I18N = {
  currentLocale: "vi-VN",
  
  statuses: {
    "READY": { label: "Sẵn sàng", class: "status-ready" },
    "REVIEW": { label: "Cần xem xét", class: "status-review" },
    "BLOCKED": { label: "Bị chặn", class: "status-blocked" },
    "PARTIAL": { label: "Chưa đầy đủ", class: "status-partial" },
    "MISSING": { label: "Thiếu visual", class: "status-missing" },
    "NOT_STARTED": { label: "Chưa bắt đầu", class: "status-empty" },
    "IN_PROGRESS": { label: "Đang thực hiện", class: "status-running" },
    "OUTDATED": { label: "Cần cập nhật", class: "status-outdated" },
    "LOCKED": { label: "Đã khóa", class: "status-locked" },
    "UNLOCKED": { label: "Chưa khóa", class: "status-unlocked" },
    "STALE": { label: "Cần đồng bộ", class: "status-stale" },
    "GENERATED": { label: "Đã tạo", class: "status-generated" },
    "SELECTED": { label: "Đã chọn", class: "status-selected" },
    "APPROVED": { label: "Đã duyệt", class: "status-approved" },
    "REJECTED": { label: "Đã từ chối", class: "status-rejected" },
    "QUEUED": { label: "Đang chờ", class: "status-queued" },
    "READY_FOR_EXTERNAL_VALIDATION": { label: "Sẵn sàng kiểm định", class: "status-ready" },
    "NOT_READY": { label: "Chưa sẵn sàng", class: "status-empty" },
    "RUNNING": { label: "Đang chạy", class: "status-running" },
    "SUCCESS": { label: "Thành công", class: "status-success" },
    "FAILED": { label: "Thất bại", class: "status-failed" },
    "CANCELLED": { label: "Đã hủy", class: "status-cancelled" },
    "DIRECT_EVIDENCE": { label: "Bằng chứng trực tiếp", class: "badge-evidence-direct" },
    "SUPPORTED_INFERENCE": { label: "Suy luận có cơ sở", class: "badge-evidence-inference" },
    "PLAUSIBLE_RECONSTRUCTION": { label: "Tái hiện hợp lý", class: "badge-evidence-reconstruction" },
    "SPECULATIVE": { label: "Suy đoán", class: "badge-evidence-speculative" },
    "HIGH": { label: "Độ tin cậy cao", class: "badge-conf-high" },
    "MEDIUM": { label: "Độ tin cậy TB", class: "badge-conf-med" },
    "LOW": { label: "Độ tin cậy thấp", class: "badge-conf-low" }
  },

  getStatusLabel(code) {
    if (!code) return "";
    const key = String(code).toUpperCase();
    return this.statuses[key] ? this.statuses[key].label : code;
  },

  renderBadge(code, extraClass = "") {
    if (!code) return "";
    const key = String(code).toUpperCase();
    const info = this.statuses[key] || { label: code, class: "status-default" };
    return `<span class="ui-status-badge ${info.class} ${extraClass}">${info.label}</span>`;
  },

  renderEvidenceBadge(evidenceType) {
    return this.renderBadge(evidenceType, "evidence-badge");
  }
};

window.I18N = I18N;
