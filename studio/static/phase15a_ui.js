/**
 * UnfoldIQ Phase 15A Production Hardening UI Controller
 * Provides interactive interfaces for:
 * - Project Health Dashboard (Sức khỏe dự án)
 * - Project Integrity Checker & Report Modal
 * - Storage Manager & Safe Cache Cleanup (Cài đặt -> Bộ nhớ)
 * - Project Backup, Restore & Archive
 * - Sanitized Diagnostics Package Export
 * - Graceful Shutdown Interceptor
 */

(function () {
  function getActiveProject() {
    const el = document.getElementById("active-project-name");
    const name = el ? el.textContent.trim() : "";
    return name && name !== "Chưa chọn dự án" ? name : null;
  }

  function showToast(message, type = "info") {
    if (window.showNotification) {
      window.showNotification(message, type);
    } else {
      alert(message);
    }
  }

  function openModal(id) {
    const m = document.getElementById(id);
    if (m) {
      m.style.display = "flex";
      m.setAttribute("aria-hidden", "false");
      const firstFocus = m.querySelector("button, input, select, textarea");
      if (firstFocus) firstFocus.focus();
    }
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (m) {
      m.style.display = "none";
      m.setAttribute("aria-hidden", "true");
    }
  }

  // Keyboard accessibility: ESC closes active modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const openModals = document.querySelectorAll('.modal-overlay[style*="display: flex"]');
      openModals.forEach((m) => {
        m.style.display = "none";
        m.setAttribute("aria-hidden", "true");
      });
    }
  });

  // -------------------------------------------------------------------------
  // 1. Project Health Dashboard
  // -------------------------------------------------------------------------
  async function refreshHealthDashboard() {
    const proj = getActiveProject();
    const summaryText = document.getElementById("health-dashboard-summary-text");
    const badge = document.getElementById("health-dashboard-badge");
    if (!proj) {
      if (summaryText) summaryText.textContent = "Chưa chọn dự án. Vui lòng mở hoặc tạo dự án.";
      if (badge) {
        badge.textContent = "Chưa chọn";
        badge.className = "ui-status-badge status-draft";
      }
      return;
    }

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(proj)}/health-summary`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (badge) {
        badge.textContent = data.statusVi || "Ổn định";
        badge.className = "ui-status-badge " + (
          data.status === "HEALTHY" ? "status-ready" :
          data.status === "WARNING" ? "status-warning" : "status-error"
        );
      }

      if (summaryText) {
        summaryText.textContent = data.issuesCountText || "0 lỗi, 0 cảnh báo";
      }

      // Update checklist
      if (Array.isArray(data.items)) {
        data.items.forEach((item) => {
          const el = document.getElementById(`health-item-${item.key}`);
          if (el) {
            el.innerHTML = `${item.ok ? "✓" : "⚠️"} ${item.labelVi}`;
            el.style.color = item.ok ? "var(--color-success, #10b981)" : "var(--color-warning, #f59e0b)";
          }
        });
      }
    } catch (e) {
      if (summaryText) summaryText.textContent = `Lỗi tải sức khỏe dự án: ${e.message}`;
    }
  }

  // -------------------------------------------------------------------------
  // 2. Project Integrity Checker
  // -------------------------------------------------------------------------
  async function runIntegrityCheckModal() {
    const proj = getActiveProject();
    if (!proj) {
      showToast("Vui lòng chọn một dự án trước khi kiểm tra.", "warning");
      return;
    }

    openModal("modal-integrity-checker");
    const body = document.getElementById("integrity-checker-results");
    if (body) body.innerHTML = '<div style="padding: 1.5rem; text-align: center;">⏳ Đang kiểm định toàn bộ dữ liệu dự án...</div>';

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(proj)}/integrity/check`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const report = await res.json();

      let issuesHtml = "";
      if (report.issues && report.issues.length > 0) {
        issuesHtml = '<div class="integrity-issues-list" style="display: flex; flex-direction: column; gap: 0.75rem; margin-top: 1rem;">';
        report.issues.forEach((iss) => {
          const isErr = iss.severity === "ERROR";
          issuesHtml += `
            <div style="padding: 0.75rem 1rem; border-radius: 6px; border-left: 4px solid ${isErr ? '#ef4444' : '#f59e0b'}; background: var(--color-bg-subtle, #1e293b);">
              <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 0.85rem; color: ${isErr ? '#ef4444' : '#f59e0b'};">
                <span>[${iss.code}] ${isErr ? 'LỖI' : 'CẢNH BÁO'}</span>
                ${iss.sceneId ? `<span>Cảnh: ${iss.sceneId}</span>` : ''}
              </div>
              <div style="margin-top: 0.25rem; font-size: 0.9rem;">${iss.messageVi}</div>
              <div style="margin-top: 0.25rem; font-size: 0.8rem; color: var(--color-text-muted, #94a3b8);">
                <strong>Gợi ý xử lý:</strong> ${iss.suggestedActionVi}
              </div>
            </div>
          `;
        });
        issuesHtml += '</div>';
      } else {
        issuesHtml = '<div style="padding: 1rem; color: var(--color-success, #10b981); font-weight: 500;">✓ Toàn bộ dữ liệu dự án đồng bộ và đạt chuẩn kiểm định.</div>';
      }

      if (body) {
        body.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 0.75rem; border-bottom: 1px solid var(--color-border, #334155);">
            <div>
              <span style="font-size: 1.1rem; font-weight: 600;">Trạng thái: </span>
              <span class="ui-status-badge ${report.status === 'HEALTHY' ? 'status-ready' : report.status === 'WARNING' ? 'status-warning' : 'status-error'}">${report.statusVi}</span>
            </div>
            <div style="font-size: 0.9rem;">
              <strong style="color: #ef4444;">${report.errorCount} lỗi</strong>, 
              <strong style="color: #f59e0b;">${report.warningCount} cảnh báo</strong>
            </div>
          </div>
          ${issuesHtml}
        `;
      }
      refreshHealthDashboard();
    } catch (e) {
      if (body) body.innerHTML = `<div style="padding: 1rem; color: #ef4444;">Lỗi kiểm tra: ${e.message}</div>`;
    }
  }

  // -------------------------------------------------------------------------
  // 3. Storage Manager
  // -------------------------------------------------------------------------
  async function openStorageManager() {
    openModal("modal-storage-manager");
    const container = document.getElementById("storage-overview-grid");
    if (container) container.innerHTML = '<div style="text-align: center; padding: 2rem;">⏳ Đang tính toán dung lượng bộ nhớ...</div>';

    try {
      const res = await fetch("/api/storage/overview");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      let html = '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">';
      for (const [key, cat] of Object.entries(data.categories)) {
        html += `
          <div style="padding: 1rem; border-radius: 8px; background: var(--color-bg-subtle, #1e293b); border: 1px solid var(--color-border, #334155);">
            <div style="font-size: 0.8rem; color: var(--color-text-muted, #94a3b8);">${cat.labelVi}</div>
            <div style="font-size: 1.25rem; font-weight: 700; margin-top: 0.25rem;">${cat.mb} MB</div>
          </div>
        `;
      }
      html += `
        <div style="padding: 1rem; border-radius: 8px; background: var(--color-bg-subtle, #1e293b); border: 1px solid var(--color-success, #10b981);">
          <div style="font-size: 0.8rem; color: var(--color-text-muted, #94a3b8);">${data.disk.labelVi}</div>
          <div style="font-size: 1.25rem; font-weight: 700; color: var(--color-success, #10b981); margin-top: 0.25rem;">${data.disk.freeGb} GB</div>
        </div>
      `;
      html += '</div>';

      if (container) container.innerHTML = html;
    } catch (e) {
      if (container) container.innerHTML = `<div style="color: #ef4444; padding: 1rem;">Lỗi: ${e.message}</div>`;
    }
  }

  async function previewStorageCleanup() {
    const previewContainer = document.getElementById("storage-cleanup-preview-results");
    if (previewContainer) previewContainer.innerHTML = '<div>⏳ Đang quét các tệp đệm có thể dọn dẹp...</div>';

    try {
      const res = await fetch("/api/storage/cleanup/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: ["renderCache", "tempFiles", "testCache"], confirmed: false })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const preview = await res.json();

      let sampleList = "";
      (preview.candidatesSample || []).slice(0, 10).forEach(c => {
        sampleList += `<li style="font-size: 0.8rem; font-family: monospace;">${c.path} (${Math.round(c.size / 1024)} KB)</li>`;
      });

      if (previewContainer) {
        previewContainer.innerHTML = `
          <div style="padding: 1rem; border-radius: 6px; background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; margin-bottom: 1rem;">
            <strong style="color: #ef4444;">BẢO VỆ DỮ LIỆU:</strong> ${preview.protectedWarningVi}
          </div>
          <div style="margin-bottom: 0.75rem;">
            Phát hiện <strong>${preview.candidateCount} tệp đệm</strong>, có thể giải phóng <strong>${preview.reclaimableMb} MB</strong>.
          </div>
          <ul style="max-height: 150px; overflow-y: auto; padding-left: 1.25rem;">
            ${sampleList}
          </ul>
        `;
      }
      document.getElementById("btn-execute-cleanup").disabled = (preview.candidateCount === 0);
    } catch (e) {
      if (previewContainer) previewContainer.innerHTML = `<div style="color: #ef4444;">Lỗi xem trước: ${e.message}</div>`;
    }
  }

  async function executeStorageCleanup() {
    if (!confirm("Bạn có chắc chắn muốn dọn dẹp các tệp đệm dùng một lần đã chọn không?")) return;
    try {
      const res = await fetch("/api/storage/cleanup/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: ["renderCache", "tempFiles", "testCache"], confirmed: true })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const report = await res.json();
      showToast(`Đã dọn dẹp ${report.deletedCount} tệp, giải phóng ${report.freedMb} MB.`, "success");
      openStorageManager();
      document.getElementById("storage-cleanup-preview-results").innerHTML = "";
    } catch (e) {
      showToast(`Lỗi dọn dẹp: ${e.message}`, "error");
    }
  }

  // -------------------------------------------------------------------------
  // 4. Backup, Restore & Archive
  // -------------------------------------------------------------------------
  async function triggerProjectBackup(type = "light") {
    const proj = getActiveProject();
    if (!proj) {
      showToast("Vui lòng chọn dự án cần sao lưu.", "warning");
      return;
    }
    const includeRender = document.getElementById("backup-include-final-render")?.checked || false;

    showToast("Đang tạo gói sao lưu...", "info");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(proj)}/backup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup_type: type, include_final_render: includeRender })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      showToast("Tạo bản sao lưu thành công!", "success");
      closeModal("modal-project-backup");
      // Trigger download
      window.location.href = data.downloadUrl;
    } catch (e) {
      showToast(`Lỗi sao lưu: ${e.message}`, "error");
    }
  }

  async function previewRestoreFile(input) {
    const file = input.files[0];
    if (!file) return;

    const previewBox = document.getElementById("restore-preview-box");
    if (previewBox) previewBox.innerHTML = "⏳ Đang phân tích tệp sao lưu và kiểm tra xung đột...";

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/backup/upload-preview", {
        method: "POST",
        body: fd
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const preview = await res.json();

      let collisionHtml = "";
      if (preview.hasCollision) {
        collisionHtml = `
          <div style="padding: 0.75rem; background: rgba(245, 158, 11, 0.1); border: 1px solid #f59e0b; border-radius: 6px; margin-top: 0.5rem; color: #f59e0b;">
            ⚠️ Phát hiện dự án <strong>${preview.projectId}</strong> đã tồn tại. Chọn ô ghi đè hoặc đổi tên để tiếp tục.
            <div style="margin-top: 0.5rem;">
              <label><input type="checkbox" id="restore-overwrite-checkbox"> Xác nhận ghi đè (hệ thống sẽ tự tạo bản snapshot rollback trước khi ghi)</label>
            </div>
          </div>
        `;
      }

      if (previewBox) {
        previewBox.innerHTML = `
          <div><strong>Mã dự án:</strong> ${preview.projectId}</div>
          <div><strong>Loại sao lưu:</strong> ${preview.backupTypeVi}</div>
          <div><strong>Số lượng tệp:</strong> ${preview.fileCount}</div>
          <div><strong>Dung lượng:</strong> ${Math.round(preview.uncompressedSizeBytes / 1024)} KB</div>
          ${collisionHtml}
        `;
      }
      window._activeRestoreFile = file.name;
      document.getElementById("btn-execute-restore").disabled = false;
    } catch (e) {
      if (previewBox) previewBox.innerHTML = `<div style="color: #ef4444;">Lỗi tệp sao lưu: ${e.message}</div>`;
    }
  }

  async function executeRestore() {
    if (!window._activeRestoreFile) return;
    const overwrite = document.getElementById("restore-overwrite-checkbox")?.checked || false;
    const targetId = document.getElementById("restore-target-project-id")?.value.trim() || null;

    showToast("Đang phục hồi dữ liệu dự án...", "info");
    try {
      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          backupFileName: window._activeRestoreFile,
          targetProjectId: targetId,
          overwrite: overwrite
        })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.status === "COLLISION_DETECTED") {
        showToast(data.messageVi, "warning");
        return;
      }
      showToast("Khôi phục dự án thành công!", "success");
      closeModal("modal-project-restore");
      if (window.switchWorkspace) window.switchWorkspace("overview");
      refreshHealthDashboard();
    } catch (e) {
      showToast(`Lỗi khôi phục: ${e.message}`, "error");
    }
  }

  async function previewArchive() {
    const proj = getActiveProject();
    if (!proj) {
      showToast("Vui lòng chọn dự án cần lưu trữ.", "warning");
      return;
    }
    openModal("modal-project-archive");
    const container = document.getElementById("archive-preview-content");
    if (container) container.innerHTML = "⏳ Đang tính toán dữ liệu lưu trữ...";

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(proj)}/archive/preview`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (container) {
        container.innerHTML = `
          <div style="margin-bottom: 0.75rem;">
            Dự án: <strong>${data.projectId}</strong>
          </div>
          <div style="padding: 0.75rem; border-radius: 6px; background: var(--color-bg-subtle, #1e293b); margin-bottom: 0.75rem;">
            <div>✓ Giữ lại: <strong>${data.keepCount} tệp cốt lõi</strong> (Kịch bản, Âm thanh, Dòng thời gian, Visual Bible, Bản dựng Master)</div>
            <div style="color: var(--color-warning, #f59e0b); margin-top: 0.25rem;">
              🗑️ Loại bỏ: <strong>${data.purgeCount} tệp đệm</strong> (Render cache, draft cũ)
            </div>
            <div style="margin-top: 0.25rem; font-weight: 600;">
              Tiết kiệm: ~${data.reclaimableMb} MB
            </div>
          </div>
        `;
      }
    } catch (e) {
      if (container) container.innerHTML = `<div style="color: #ef4444;">Lỗi: ${e.message}</div>`;
    }
  }

  async function executeArchive() {
    const proj = getActiveProject();
    if (!proj) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(proj)}/archive/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      showToast(`Đã lưu trữ thành công dự án! Giải phóng ${data.freedMb} MB.`, "success");
      closeModal("modal-project-archive");
      refreshHealthDashboard();
    } catch (e) {
      showToast(`Lỗi lưu trữ: ${e.message}`, "error");
    }
  }

  // -------------------------------------------------------------------------
  // 5. Diagnostics Export
  // -------------------------------------------------------------------------
  async function triggerDiagnosticsExport() {
    const proj = getActiveProject();
    showToast("Đang tổng hợp và khử nhạy cảm gói chẩn đoán...", "info");
    const url = proj ? `/api/diagnostics/export?projectId=${encodeURIComponent(proj)}` : "/api/diagnostics/export";
    window.location.href = url;
  }

  // -------------------------------------------------------------------------
  // Bind all event listeners on DOMContentLoaded
  // -------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // Health dashboard
    const btnIntegrity = document.getElementById("btn-run-integrity-check");
    if (btnIntegrity) btnIntegrity.addEventListener("click", runIntegrityCheckModal);

    const btnBackup = document.getElementById("btn-project-backup");
    if (btnBackup) btnBackup.addEventListener("click", () => openModal("modal-project-backup"));

    const btnArchive = document.getElementById("btn-project-archive");
    if (btnArchive) btnArchive.addEventListener("click", previewArchive);

    const btnCloseIntegrity = document.getElementById("integrity-modal-close-btn");
    if (btnCloseIntegrity) btnCloseIntegrity.addEventListener("click", () => closeModal("modal-integrity-checker"));

    // Storage
    const btnOpenStorage = document.getElementById("btn-open-storage");
    if (btnOpenStorage) btnOpenStorage.addEventListener("click", openStorageManager);

    const btnStorageNav = document.getElementById("nav-step-storage");
    if (btnStorageNav) btnStorageNav.addEventListener("click", openStorageManager);

    const btnCloseStorage = document.getElementById("storage-modal-close-btn");
    if (btnCloseStorage) btnCloseStorage.addEventListener("click", () => closeModal("modal-storage-manager"));

    const btnPreviewCleanup = document.getElementById("btn-preview-cleanup");
    if (btnPreviewCleanup) btnPreviewCleanup.addEventListener("click", previewStorageCleanup);

    const btnExecuteCleanup = document.getElementById("btn-execute-cleanup");
    if (btnExecuteCleanup) btnExecuteCleanup.addEventListener("click", executeStorageCleanup);

    // Diagnostics
    const btnExportDiag = document.getElementById("btn-export-diagnostics");
    if (btnExportDiag) btnExportDiag.addEventListener("click", triggerDiagnosticsExport);

    // Backup & Restore
    const btnDoBackupLight = document.getElementById("btn-do-backup-light");
    if (btnDoBackupLight) btnDoBackupLight.addEventListener("click", () => triggerProjectBackup("light"));

    const btnDoBackupFull = document.getElementById("btn-do-backup-full");
    if (btnDoBackupFull) btnDoBackupFull.addEventListener("click", () => triggerProjectBackup("full"));

    const btnCloseBackup = document.getElementById("backup-modal-close-btn");
    if (btnCloseBackup) btnCloseBackup.addEventListener("click", () => closeModal("modal-project-backup"));

    const btnOpenRestore = document.getElementById("btn-open-restore");
    if (btnOpenRestore) btnOpenRestore.addEventListener("click", () => openModal("modal-project-restore"));

    const btnCloseRestore = document.getElementById("restore-modal-close-btn");
    if (btnCloseRestore) btnCloseRestore.addEventListener("click", () => closeModal("modal-project-restore"));

    const restoreInput = document.getElementById("input-restore-file");
    if (restoreInput) restoreInput.addEventListener("change", () => previewRestoreFile(restoreInput));

    const btnExecRestore = document.getElementById("btn-execute-restore");
    if (btnExecRestore) btnExecRestore.addEventListener("click", executeRestore);

    const btnCloseArchive = document.getElementById("archive-modal-close-btn");
    if (btnCloseArchive) btnCloseArchive.addEventListener("click", () => closeModal("modal-project-archive"));

    const btnExecArchive = document.getElementById("btn-execute-archive");
    if (btnExecArchive) btnExecArchive.addEventListener("click", executeArchive);

    // Refresh health dashboard periodically or on workspace switch
    refreshHealthDashboard();
    const btnRefreshOverview = document.getElementById("btn-refresh-overview");
    if (btnRefreshOverview) {
      btnRefreshOverview.addEventListener("click", refreshHealthDashboard);
    }
  });

  // Export to window for global access
  window.phase15a = {
    refreshHealthDashboard,
    runIntegrityCheckModal,
    openStorageManager,
    triggerDiagnosticsExport
  };
})();
