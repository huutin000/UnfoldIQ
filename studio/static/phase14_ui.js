/**
 * UnfoldIQ Studio — Phase 14 Production Studio UI Controller
 * Handles:
 * - Overview Dashboard (Hero, Readiness Grid, Blockers)
 * - Reproducible Research & Claim Ledger (Sources, Locking, Claims)
 * - Global Canonical Library Viewer (Characters, Environments, Objects, Styles)
 * - Auto Timeline View & Recompilation
 * - Review & Targeted Fix (Review Issues, Resolution)
 * - Export & Deliverables Package (Draft Render 720p, Final Render 1080p, Package)
 * - Activity Log (Background Jobs)
 * - Google Flow Modal & Prompt 1-Click Copy
 * - Video Asset Intake Upload & QC
 * - Simple Mode vs Advanced Mode Scene Toggle
 */

(function () {
  let activeLibTab = "characters";
  let sceneMode = "simple"; // "simple" or "advanced"

  function getActiveProject() {
    // Current project directory from global or DOM; null khi chưa chọn (không fallback cứng).
    const el = document.getElementById("active-project-name");
    const name = el ? el.textContent.trim() : "";
    return (name && name !== "Chưa chọn dự án") ? name : null;
  }

  function showToast(message, type = "info") {
    if (window.showNotification) {
      window.showNotification(message, type);
    } else {
      alert(message);
    }
  }

  // Shared empty/error states — mọi loader dùng chung, không fail silent (§7).
  function noProjectHtml() {
    return `
      <div class="overview-empty" role="status">
        <h3>Chưa chọn dự án</h3>
        <p>Mở một dự án có sẵn hoặc tạo dự án mới để xem nội dung mục này.</p>
        <div class="empty-actions">
          <button class="btn btn-secondary btn-sm" onclick="window.switchWorkspace('projects')">Mở danh sách dự án</button>
          <button class="btn btn-primary btn-sm" onclick="window.switchWorkspace('script')">Nhập kịch bản</button>
        </div>
      </div>`;
  }
  // 404 với project hợp lệ = stage chưa có dữ liệu (EMPTY_STAGE), không phải lỗi.
  function isNotFound(err, res) {
    return (res && res.status === 404) || /mã 404/.test(String((err && err.message) || err || ""));
  }
  function loadErrorHtml(msg, retryFn) {
    return `
      <div class="overview-empty" role="alert">
        <h3>Không tải được dữ liệu</h3>
        <p>${escapeHtml(String(msg || "Lỗi không xác định"))}</p>
        <div class="empty-actions">
          <button class="btn btn-secondary btn-sm" onclick="${retryFn}">Thử lại</button>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // 1. OVERVIEW DASHBOARD
  // ---------------------------------------------------------------------------
  async function loadOverviewData(projectDir) {
    const p = projectDir || getActiveProject();
    const container = document.getElementById("overview-stages-grid");
    const blockersEl = document.getElementById("overview-blockers-container");
    const titleEl = document.getElementById("overview-project-title");
    const durEl = document.getElementById("overview-duration-text");
    if (!container) return;

    // Chưa chọn dự án: hướng dẫn bước tiếp theo, không fetch, không để trắng.
    if (!p) {
      if (titleEl) titleEl.textContent = "CHƯA CHỌN DỰ ÁN";
      if (durEl) durEl.textContent = "--:--";
      container.innerHTML = `
        <div class="overview-empty" role="status">
          <h3>Bắt đầu sản xuất video mới</h3>
          <p>Chưa có dự án nào đang mở. Mở một dự án có sẵn, hoặc nhập kịch bản ở mục
          <strong>Nội dung</strong> rồi bấm <strong>Tạo giọng đọc</strong> để tạo dự án đầu tiên.</p>
          <div class="empty-actions">
            <button class="btn btn-secondary btn-sm" onclick="window.switchWorkspace('projects')">Mở danh sách dự án</button>
            <button class="btn btn-primary btn-sm" onclick="window.switchWorkspace('script')">Nhập kịch bản</button>
          </div>
        </div>`;
      if (blockersEl) blockersEl.innerHTML = "";
      return false;
    }

    // Loading thật: skeleton + aria-busy.
    container.setAttribute("aria-busy", "true");
    container.innerHTML = `
      <div class="stage-card" aria-hidden="true"><div class="skeleton" style="height:18px;width:55%"></div><div class="skeleton" style="height:12px;width:85%"></div><div class="skeleton" style="height:12px;width:70%"></div></div>
      <div class="stage-card" aria-hidden="true"><div class="skeleton" style="height:18px;width:45%"></div><div class="skeleton" style="height:12px;width:80%"></div><div class="skeleton" style="height:12px;width:65%"></div></div>`;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p)}/overview`);
      if (!res.ok) throw new Error(`Không tải được tổng quan dự án (mã ${res.status}).`);
      const data = await res.json();

      if (titleEl) titleEl.textContent = p.replace(/^(\d{4}-\d{2}-\d{2}_\d{6}_)/, "").toUpperCase();
      if (durEl && data.totalDuration) {
        const mins = Math.floor(data.totalDuration / 60);
        const secs = Math.floor(data.totalDuration % 60);
        durEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      }

      const stages = [
        { id: "research", title: "1. Nghiên cứu & Bằng chứng", targetTab: "research", info: data.stages.research },
        { id: "script", title: "2. Kịch bản phóng sự", targetTab: "script", info: data.stages.script },
        { id: "voice", title: "3. Giọng đọc Kokoro", targetTab: "audio", info: data.stages.voice },
        { id: "scenes", title: "4. Cảnh quay & Visual", targetTab: "scenes", info: data.stages.scenes },
        { id: "review", title: "5. Kiểm tra chất lượng", targetTab: "review", info: data.stages.review },
        { id: "export", title: "6. Xuất bản video", targetTab: "export", info: data.stages.export }
      ];

      container.innerHTML = stages.map(s => `
        <div class="stage-card" style="cursor: pointer;" onclick="window.switchWorkspace('${s.targetTab}')">
          <div class="stage-card-header">
            <span class="stage-title">${s.title}</span>
            ${window.I18N ? window.I18N.renderBadge(s.info.status) : `<span class="ui-status-badge">${s.info.label}</span>`}
          </div>
          <p class="stage-desc">${s.info.details || ''}</p>
          <div style="font-size: 0.75rem; color: var(--accent); margin-top: auto; font-weight: 500;">Mở mục này &rarr;</div>
        </div>
      `).join("");

      // Blockers
      if (blockersEl) {
        if (data.blockers && data.blockers.length > 0) {
          blockersEl.innerHTML = `
            <div class="alert alert-warning" style="display: flex; align-items: center; justify-content: space-between;">
              <div>
                <strong>⚠️ Cần bổ sung hình ảnh:</strong> Có ${data.blockers.length} cảnh chưa có video clip.
              </div>
              <button class="btn btn-secondary btn-xs" onclick="window.switchWorkspace('scenes')">Xem cảnh thiếu &rarr;</button>
            </div>
          `;
        } else {
          blockersEl.innerHTML = `
            <div class="alert alert-success" style="display: flex; align-items: center; justify-content: space-between;">
              <div>
                <strong>✓ Quy trình sẵn sàng:</strong> Mọi thành phần kịch bản và dòng thời gian đã hoàn tất.
              </div>
              <button class="btn btn-primary btn-xs" onclick="window.switchWorkspace('export')">Xuất video ngay &rarr;</button>
            </div>
          `;
        }
      }
      return true;
    } catch (err) {
      container.removeAttribute("aria-busy");
      container.innerHTML = `
        <div class="overview-empty" role="alert">
          <h3>Không tải được dữ liệu tổng quan</h3>
          <p>${String((err && err.message) || err || "Lỗi không xác định")}</p>
          <div class="empty-actions">
            <button class="btn btn-secondary btn-sm" onclick="window.Phase14 && window.Phase14.loadOverviewData()">Thử lại</button>
            <button class="btn btn-secondary btn-sm" onclick="window.switchWorkspace('projects')">Chọn dự án khác</button>
          </div>
        </div>`;
      if (blockersEl) blockersEl.innerHTML = "";
      return false;
    } finally {
      container.removeAttribute("aria-busy");
    }
  }

  // ---------------------------------------------------------------------------
  // 2. RESEARCH & CLAIM LEDGER
  // ---------------------------------------------------------------------------
  async function loadResearchData(projectDir) {
    const p = projectDir || getActiveProject();
    const srcList = document.getElementById("research-sources-list");
    const claimList = document.getElementById("research-claims-list");
    const statsChip = document.getElementById("research-stats-chip");
    const lockBadge = document.getElementById("research-lock-badge");
    const lockBtnTxt = document.getElementById("txt-source-lock-btn");
    if (!srcList || !claimList) return;
    if (!p) {
      srcList.innerHTML = noProjectHtml();
      claimList.innerHTML = "";
      if (statsChip) statsChip.textContent = "Chưa chọn dự án";
      return;
    }

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p)}/research`);
      if (!res.ok) throw new Error(`Không tải được dữ liệu nghiên cứu (mã ${res.status}).`);
      const data = await res.json();

      if (statsChip) {
        statsChip.textContent = `${data.stats.approvedSources} nguồn đã duyệt • ${data.stats.totalClaims} nhận định (${data.stats.directEvidenceCount} trực tiếp)`;
      }

      const isLocked = data.stats.isLocked;
      if (lockBadge) {
        lockBadge.className = `ui-status-badge ${isLocked ? 'status-locked' : 'status-review'}`;
        lockBadge.textContent = isLocked ? 'Đã khóa nguồn' : 'Chưa khóa nguồn';
      }
      if (lockBtnTxt) {
        lockBtnTxt.textContent = isLocked ? 'Mở khóa bộ nguồn' : 'Khóa bộ nguồn';
      }

      // Render Sources
      srcList.innerHTML = (data.sources || []).map(s => {
        const isApproved = s.status === 'APPROVED';
        const isDiscovered = s.status === 'DISCOVERED';
        const badgeClass = isApproved ? 'status-ready' : (isDiscovered ? 'status-review' : 'status-empty');
        const badgeLabel = isApproved ? 'Đã duyệt' : (isDiscovered ? 'Chờ duyệt (AI)' : s.status);
        return `
        <div class="source-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div class="source-title">${escapeHtml(s.title)}</div>
            <span class="ui-status-badge ${badgeClass}">${badgeLabel}</span>
          </div>
          <div class="source-meta">
            ${s.author ? `<span>${escapeHtml(s.author)}</span> • ` : ''}
            <span>${escapeHtml(s.publisher || '')} (${s.published_at || ''})</span>
            ${s.url ? ` • <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" style="color: var(--accent);">Nguồn liên kết &nearr;</a>` : ''}
          </div>
          <div class="source-snippet">${escapeHtml(s.content_snapshot || 'Không có bản tóm tắt')}</div>
          ${isDiscovered ? `
            <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
              <button type="button" class="btn btn-primary btn-xs" onclick="window.approveSource('${escapeHtml(s.id)}')">✓ Phê duyệt</button>
              <button type="button" class="btn btn-secondary btn-xs" onclick="window.rejectSource('${escapeHtml(s.id)}')">✕ Từ chối</button>
            </div>
          ` : ''}
        </div>
      `;
      }).join("");

      // Render Claims — full text readable: collapsed 3 dòng + "Xem thêm", không cắt mất nội dung.
      claimList.innerHTML = (data.claims || []).map(c => `
        <div class="claim-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap;">
            <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--uq-violet); font-weight: 600; overflow-wrap: anywhere;" title="${c.id}">${c.id}</span>
            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap;">
              ${window.I18N ? window.I18N.renderEvidenceBadge(c.evidence_type) : `<span class="badge-evidence-direct">${c.evidence_type}</span>`}
              <span class="ui-status-badge status-ready">${c.confidence === 'HIGH' ? 'Tin cậy cao' : 'Tin cậy TB'}</span>
            </div>
          </div>
          <div class="claim-statement is-collapsed" title="${escapeHtml(c.statement)}">${escapeHtml(c.statement)}</div>
          <button type="button" class="btn btn-secondary btn-xs claim-toggle" aria-expanded="false">Xem thêm</button>
          <div style="font-size: 0.72rem; color: var(--text-muted); display: flex; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap;">
            <span style="min-width: 0; overflow-wrap: anywhere;">Nguồn: ${(c.source_ids || []).join(', ')}</span>
            <span>Áp dụng: ${(c.script_usage || []).length} đoạn kịch bản</span>
          </div>
        </div>
      `).join("");
      claimList.querySelectorAll(".claim-card").forEach(card => {
        const stmt = card.querySelector(".claim-statement");
        const btn = card.querySelector(".claim-toggle");
        if (!stmt || !btn) return;
        // Chỉ hiện nút khi text thực sự tràn (>3 dòng).
        requestAnimationFrame(() => {
          const overflowing = stmt.scrollHeight - stmt.clientHeight > 4;
          btn.style.display = overflowing ? "" : "none";
        });
        btn.addEventListener("click", () => {
          const open = stmt.classList.toggle("is-expanded");
          stmt.classList.toggle("is-collapsed", !open);
          btn.textContent = open ? "Thu gọn" : "Xem thêm";
          btn.setAttribute("aria-expanded", open ? "true" : "false");
        });
      });
    } catch (err) {
      if (isNotFound(err)) {
        srcList.innerHTML = `
          <div class="overview-empty" role="status">
            <h3>Chưa có dữ liệu nghiên cứu</h3>
            <p>Dự án này chưa có nguồn tài liệu. Dùng AI tìm nguồn hoặc thêm thủ công để bắt đầu.</p>
            <div class="empty-actions">
              <button class="btn btn-secondary btn-sm" onclick="document.getElementById('btn-trigger-ai-discovery')?.click()">AI tìm nguồn</button>
              <button class="btn btn-secondary btn-sm" onclick="document.getElementById('btn-open-add-source-modal')?.click()">Thêm nguồn thủ công</button>
            </div>
          </div>`;
        claimList.innerHTML = "";
      } else {
        srcList.innerHTML = loadErrorHtml((err && err.message) || err, "window.Phase14 && window.Phase14.loadResearchData()");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. CANONICAL LIBRARY
  // ---------------------------------------------------------------------------
  async function loadLibraryData() {
    const container = document.getElementById("library-cards-container");
    if (!container) return;

    try {
      const res = await fetch(`/api/library/assets`);
      if (!res.ok) throw new Error(`Không tải được thư viện (mã ${res.status}).`);
      const data = await res.json();

      const items = data[activeLibTab] || [];
      if (activeLibTab === "characters") {
        container.innerHTML = items.map(c => `
          <div class="stage-card">
            <div class="stage-card-header">
              <div>
                <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--uq-ink-1);">${escapeHtml(c.displayName.vi)}</h4>
                <span style="font-size: 0.72rem; font-family: var(--font-mono); color: var(--uq-violet);">${c.id}</span>
              </div>
              <span class="ui-status-badge status-locked">Google Flow @${escapeHtml(c.flowName)}</span>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4;">${escapeHtml(c.description)}</p>
            <div style="margin-top: 0.5rem;">
              <span style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em;">Góc máy chuẩn hóa:</span>
              <div style="display: flex; gap: 0.35rem; margin-top: 0.25rem; flex-wrap: wrap;">
                <span class="ui-status-badge status-ready">Chính diện</span>
                <span class="ui-status-badge status-ready">Góc 3/4</span>
                <span class="ui-status-badge status-ready">Góc nghiêng</span>
                <span class="ui-status-badge status-ready">Toàn thân</span>
              </div>
            </div>
          </div>
        `).join("");
      } else if (activeLibTab === "environments") {
        container.innerHTML = items.map(e => `
          <div class="stage-card">
            <div class="stage-card-header">
              <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--uq-ink-1);">${escapeHtml(e.displayName.vi)}</h4>
              <span class="ui-status-badge status-ready">${escapeHtml(e.flowName)}</span>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(e.description)}</p>
          </div>
        `).join("");
      } else if (activeLibTab === "objects") {
        container.innerHTML = items.map(o => `
          <div class="stage-card">
            <div class="stage-card-header">
              <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--uq-ink-1);">${escapeHtml(o.displayName.vi)}</h4>
              <span class="ui-status-badge status-ready">${escapeHtml(o.flowName)}</span>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(o.description)}</p>
          </div>
        `).join("");
      } else if (activeLibTab === "styles") {
        container.innerHTML = items.map(s => `
          <div class="stage-card">
            <div class="stage-card-header">
              <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--uq-ink-1);">${escapeHtml(s.displayName.vi)}</h4>
              <span class="ui-status-badge status-ready">8K Photorealism</span>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(s.description)}</p>
            <div style="font-size: 0.72rem; color: #f87171; background: rgba(239, 68, 68, 0.08); padding: 0.4rem; border-radius: var(--radius-xs); margin-top: 0.4rem;">
              <strong>Loại trừ:</strong> ${escapeHtml(s.negativePrompt)}
            </div>
          </div>
        `).join("");
      }
    } catch (err) {
      container.innerHTML = loadErrorHtml((err && err.message) || err, "window.Phase14 && window.Phase14.loadLibraryData()");
    }
  }

  // ---------------------------------------------------------------------------
  // 4. TIMELINE WORKSPACE
  // ---------------------------------------------------------------------------
  async function loadTimelineData(projectDir) {
    const p = projectDir || getActiveProject();
    const listEl = document.getElementById("timeline-clips-list");
    const countEl = document.getElementById("timeline-scenes-count");
    const alertEl = document.getElementById("timeline-missing-alert");
    const statusBadge = document.getElementById("timeline-status-badge");
    if (!listEl) return;
    if (!p) {
      listEl.innerHTML = noProjectHtml();
      if (countEl) countEl.textContent = "Chưa chọn dự án";
      return;
    }

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p)}/timeline/v2`);
      if (!res.ok) throw new Error(`Không tải được dòng thời gian (mã ${res.status}).`);
      const data = await res.json();

      const scenes = data.scenes || [];
      if (countEl) countEl.textContent = `${scenes.length} cảnh quay`;

      if (statusBadge && window.I18N) {
        statusBadge.innerHTML = window.I18N.renderBadge(data.stats.status);
      }

      if (alertEl) {
        // P1 (§6): stale input hiển thị tiếng Việt, không READY giả.
        const stale = data.staleInputs || [];
        if (stale.length > 0) {
          alertEl.style.display = "flex";
          document.getElementById("timeline-missing-text").textContent =
            `Dòng thời gian cần đồng bộ lại (dữ liệu đầu vào đã cũ: ${stale.join(", ")}). Bấm "Đồng bộ dòng thời gian".`;
        } else if (data.missingAssetScenes && data.missingAssetScenes.length > 0) {
          alertEl.style.display = "flex";
          document.getElementById("timeline-missing-text").textContent =
            `Có ${data.missingAssetScenes.length} cảnh chưa có video clip: ${data.missingAssetScenes.slice(0, 5).join(", ")}...`;
        } else {
          alertEl.style.display = "none";
        }
      }

      listEl.innerHTML = scenes.map((sc, idx) => `
        <div class="timeline-clip-row" data-tl-scene="${escapeHtml(sc.sceneId)}" data-tl-start="${sc.start}" data-tl-end="${sc.end}" title="${escapeHtml(sc.narrationText || 'Không có lời dẫn')}">
          <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); width: 32px; flex-shrink: 0;">#${sc.sceneIndex}</span>
          <span style="font-family: var(--font-mono); font-weight: 600; color: var(--uq-violet); width: 80px; flex-shrink: 0; overflow-wrap: anywhere;">${sc.sceneId}</span>
          <span class="clip-duration-badge" style="flex-shrink: 0;">${sc.start}s &rarr; ${sc.end}s (${sc.duration}s)</span>
          <div class="timeline-clip-text" style="flex: 1; min-width: 0; font-size: 0.8rem; color: var(--text-primary); overflow-wrap: break-word; white-space: normal;">
            ${escapeHtml(sc.narrationText || 'Không có lời dẫn')}
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0; flex-wrap: wrap;">
            ${sc.hasVisual 
              ? `<span class="ui-status-badge status-ready">✓ Đã có visual</span>`
              : `<button class="btn btn-secondary btn-xs" onclick="window.openFlowInstructions('${sc.sceneId}')">Tạo visual &rarr;</button>`}
          </div>
        </div>
      `).join("");
    } catch (err) {
      if (isNotFound(err)) {
        listEl.innerHTML = `
          <div class="overview-empty" role="status">
            <h3>Chưa có dòng thời gian</h3>
            <p>Hoàn thành giọng đọc và cảnh quay, sau đó đồng bộ để dựng dòng thời gian tự động.</p>
            <div class="empty-actions">
              <button class="btn btn-secondary btn-sm" onclick="document.getElementById('btn-recompile-timeline')?.click()">Đồng bộ dòng thời gian</button>
            </div>
          </div>`;
      } else {
        listEl.innerHTML = loadErrorHtml((err && err.message) || err, "window.Phase14 && window.Phase14.loadTimelineData()");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. REVIEW & QUALITY CONTROL
  // ---------------------------------------------------------------------------
  // Backend issueType enum → nhãn VI hiển thị (display only).
  function issueTypeVi(t) {
    const m = {
      CHARACTER_INCONSISTENCY: "Không nhất quán nhân vật",
      VISUAL_ARTIFACT: "Biến dạng hình ảnh",
      PACING_MISMATCH: "Lệch nhịp độ kịch bản",
      LIGHTING_DRIFT: "Lệch ánh sáng / tone màu",
      MODERN_OBJECT: "Đồ vật hiện đại lọt vào khung hình",
    };
    return m[t] || t;
  }

  async function loadReviewData(projectDir) {
    const p = projectDir || getActiveProject();
    const container = document.getElementById("review-issues-container");
    if (!container) return;
    if (!p) {
      container.innerHTML = noProjectHtml();
      return;
    }

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p)}/review/issues`);
      if (!res.ok) throw new Error(`Không tải được danh sách vấn đề (mã ${res.status}).`);
      const data = await res.json();
      const issues = data.issues || [];

      if (issues.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="padding: 2rem; text-align: center; color: var(--text-muted);">
            <svg class="ui-icon" style="width: 32px; height: 32px; color: #10b981; margin-bottom: 0.5rem;"><use href="#icon-check"/></svg>
            <p>Không phát hiện lỗi chất lượng hay mâu thuẫn nhân vật nào.<br>Tất cả cảnh quay đều đạt tiêu chuẩn kiểm tra.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = issues.map(iss => `
        <div class="stage-card" style="border-left: 4px solid ${iss.severity === 'BLOCKER' ? '#ef4444' : '#f59e0b'};">
          <div class="stage-card-header">
            <div>
              <strong style="color: var(--uq-ink-1);">${escapeHtml(iss.sceneId)}:</strong>
              <span style="font-size: 0.85rem; color: var(--text-secondary); margin-left: 0.35rem;">${escapeHtml(issueTypeVi(iss.issueType))}</span>
            </div>
            <div>
              <span class="ui-status-badge ${iss.status === 'RESOLVED' ? 'status-ready' : 'status-review'}">${iss.status === 'RESOLVED' ? (iss.verified ? 'Đã sửa (đã xác minh)' : 'Đã sửa (chưa xác minh)') : 'Cần xử lý'}</span>
              ${iss.status !== 'RESOLVED' ? `<button class="btn btn-secondary btn-xs" style="margin-left: 0.5rem;" onclick="window.resolveIssue('${iss.id}')">Đánh dấu đã sửa</button>` : ''}
            </div>
          </div>
          <p class="stage-desc" style="margin-top: 0.35rem;">${escapeHtml(iss.description)}</p>
        </div>
      `).join("");
    } catch (err) {
      if (isNotFound(err)) {
        container.innerHTML = `
          <div class="overview-empty" role="status">
            <h3>Chưa có dữ liệu kiểm tra</h3>
            <p>Chạy kiểm tra chất lượng sau khi hoàn thành giọng đọc và cảnh quay.</p>
            <div class="empty-actions">
              <button class="btn btn-secondary btn-sm" onclick="window.switchWorkspace('voice-qa')">Sang kiểm âm</button>
              <button class="btn btn-secondary btn-sm" onclick="window.switchWorkspace('scenes')">Xem cảnh quay</button>
            </div>
          </div>`;
      } else {
        container.innerHTML = loadErrorHtml((err && err.message) || err, "window.Phase14 && window.Phase14.loadReviewData()");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 6. EXPORT WORKSPACE
  // ---------------------------------------------------------------------------
  async function loadExportData(projectDir) {
    const p = projectDir || getActiveProject();
    const readinessBox = document.getElementById("export-readiness-box");
    const delivBox = document.getElementById("export-deliverables-box");
    if (!p) {
      if (readinessBox) readinessBox.innerHTML = noProjectHtml();
      if (delivBox) delivBox.style.display = "none";
      return;
    }
    const setNotReady = (title, msg) => {
      if (readinessBox) readinessBox.innerHTML = `
        <div class="overview-empty" role="status">
          <h3>${title}</h3>
          <p>${msg}</p>
          <div class="empty-actions">
            <button class="btn btn-secondary btn-sm" onclick="window.switchWorkspace('timeline')">Xem dòng thời gian</button>
            <button class="btn btn-secondary btn-sm" onclick="window.Phase14 && window.Phase14.loadExportData()">Tải lại trạng thái</button>
          </div>
        </div>`;
      if (delivBox) delivBox.style.display = "none";
    };
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p)}/render/status`);
      if (!res.ok) throw new Error(`Không tải được trạng thái render (mã ${res.status}).`);
      const data = await res.json();

      const draftBox = document.getElementById("draft-render-player-container");
      const draftVideo = document.getElementById("draft-video-player");
      if (data.hasDraft && draftBox && draftVideo) {
        draftBox.style.display = "block";
        draftVideo.src = `/api/projects/${encodeURIComponent(p)}/renders/draft/draft_preview.mp4?t=${Date.now()}`;
      }

      const finalBox = document.getElementById("final-render-player-container");
      const finalVideo = document.getElementById("final-video-player");
      if (data.hasFinal && finalBox && finalVideo) {
        finalBox.style.display = "block";
        finalVideo.src = `/api/projects/${encodeURIComponent(p)}/renders/final/final.mp4?t=${Date.now()}`;
      }

      // Gói bàn giao chỉ tồn tại khi đã xuất bản chính thức — không giả vờ có sẵn.
      if (delivBox) delivBox.style.display = data.hasFinal ? "" : "none";
      if (readinessBox) {
        if (data.hasFinal) {
          readinessBox.innerHTML = `
            <div class="alert alert-success" role="status">
              <span>✓ Đã có bản chính thức. Gói bàn giao bên dưới đã sẵn sàng.</span>
            </div>`;
        } else if (data.hasDraft) {
          readinessBox.innerHTML = `
            <div class="alert alert-warning" role="status">
              <span>Đã có bản nháp. Kết xuất bản chính thức để mở gói bàn giao đầy đủ.</span>
            </div>`;
        } else {
          setNotReady("Chưa thể xuất video", "Dự án chưa có bản dựng nào. Kết xuất bản nháp 720p trước, rồi kết xuất bản chính thức 1080p.");
          return;
        }
      }
    } catch (err) {
      if (isNotFound(err)) {
        setNotReady("Chưa thể xuất video", "Chưa có thông tin render cho dự án này. Kết xuất bản nháp trước để bắt đầu.");
      } else {
        if (readinessBox) readinessBox.innerHTML = loadErrorHtml((err && err.message) || err, "window.Phase14 && window.Phase14.loadExportData()");
        if (delivBox) delivBox.style.display = "none";
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 7. ACTIVITY LOG
  // ---------------------------------------------------------------------------
  async function loadActivityData() {
    const listEl = document.getElementById("activity-jobs-list");
    if (!listEl) return;

    try {
      const res = await fetch(`/api/activity/jobs`);
      if (!res.ok) throw new Error(`Không tải được nhật ký hoạt động (mã ${res.status}).`);
      const data = await res.json();
      const jobs = data.jobs || [];

      if (jobs.length === 0) {
        listEl.innerHTML = `<p class="empty-state">Chưa có hoạt động ngầm nào.</p>`;
        return;
      }

      listEl.innerHTML = jobs.map(j => `
        <div class="stage-card" style="padding: 0.75rem 1rem;">
          <div class="stage-card-header">
            <div>
              <strong style="color: var(--uq-ink-1);">${escapeHtml(j.type)}</strong>
              <span style="font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-muted); margin-left: 0.5rem;">${j.id}</span>
            </div>
            <span class="ui-status-badge ${j.status === 'SUCCESS' ? 'status-ready' : (j.status === 'RUNNING' ? 'status-running' : (j.status === 'FAILED' ? 'status-blocked' : 'status-queued'))}">${(window.I18N ? window.I18N.getStatusLabel(j.status) : j.status)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.35rem; font-size: 0.8rem; color: var(--text-secondary);">
            <span>${escapeHtml(j.message || '')}</span>
            <span>${Math.round((j.progress || 0) * 100)}%</span>
          </div>
          ${j.error ? `<div style="color: #ef4444; font-size: 0.75rem; margin-top: 0.25rem;">${escapeHtml(j.error)}</div>` : ''}
        </div>
      `).join("");
    } catch (err) {
      listEl.innerHTML = loadErrorHtml((err && err.message) || err, "window.Phase14 && window.Phase14.loadActivityData()");
    }
  }

  // ---------------------------------------------------------------------------
  // 8. GOOGLE FLOW MODAL & COPY ACTIONS
  // ---------------------------------------------------------------------------
  let currentFlowData = null;

  window.renderFlowModalTab = function (tab) {
    const btnImg = document.getElementById("btn-flow-tab-image");
    const btnMot = document.getElementById("btn-flow-tab-motion");
    const textarea = document.getElementById("flow-modal-prompt-text");
    const label = document.getElementById("flow-modal-prompt-label");
    if (!currentFlowData) return;

    if (tab === "image") {
      if (btnImg) btnImg.classList.add("active");
      if (btnMot) btnMot.classList.remove("active");
      if (label) label.textContent = "Prompt tạo ảnh chuẩn hóa (Visual Blueprint - Frame tĩnh & Tạo hình nhân vật):";
      if (textarea) textarea.value = currentFlowData.imagePrompt || currentFlowData.flowPrompt || "";
    } else {
      if (btnMot) btnMot.classList.add("active");
      if (btnImg) btnImg.classList.remove("active");
      if (label) label.textContent = "Prompt chuyển động video (Motion Blueprint - Camera & Động tác theo thời gian):";
      if (textarea) textarea.value = currentFlowData.motionPrompt || currentFlowData.flowPrompt || "";
    }
  };

  window.openFlowInstructions = async function (sceneId) {
    const p = getActiveProject();
    if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
    const modal = document.getElementById("modal-flow-instructions");
    const textarea = document.getElementById("flow-modal-prompt-text");
    const title = document.getElementById("flow-modal-title");
    if (!modal || !textarea) return;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p)}/scenes/${encodeURIComponent(sceneId)}/flow-instructions`);
      if (!res.ok) throw new Error("Không thể tải chỉ dẫn Flow.");
      const data = await res.json();
      currentFlowData = data;

      if (title) title.textContent = `Google Flow — Chỉ dẫn Cảnh ${sceneId}`;
      modal.dataset.sceneId = sceneId;
      if (window.UQModal) window.UQModal.open(modal, document.activeElement);
      else modal.style.display = "flex";
      window.renderFlowModalTab("image");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  window.approveSource = async function (sourceId) {
    const p = getActiveProject();
    if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p)}/research/sources/${encodeURIComponent(sourceId)}/approve`, {
        method: "POST"
      });
      if (!res.ok) throw new Error("Không thể phê duyệt nguồn.");
      showToast("✓ Đã phê duyệt nguồn tài liệu!", "success");
      loadResearchData(p);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  window.rejectSource = async function (sourceId) {
    const p = getActiveProject();
    if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p)}/research/sources/${encodeURIComponent(sourceId)}/reject`, {
        method: "POST"
      });
      if (!res.ok) throw new Error("Không thể từ chối nguồn.");
      showToast("Đã từ chối nguồn tài liệu", "info");
      loadResearchData(p);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  window.copyFlowPromptText = function () {
    const textarea = document.getElementById("flow-modal-prompt-text");
    if (!textarea) return;
    navigator.clipboard.writeText(textarea.value).then(() => {
      showToast("✓ Đã sao chép prompt Google Flow vào bộ nhớ tạm!", "success");
      const btn = document.getElementById("txt-copy-flow-prompt");
      if (btn) {
        const old = btn.textContent;
        btn.textContent = "✓ Đã sao chép!";
        setTimeout(() => { btn.textContent = old; }, 2000);
      }
    }).catch(err => {
      showToast("Lỗi khi sao chép: " + err, "error");
    });
  };

  window.openAssetIntakeModal = function (sceneId) {
    const modal = document.getElementById("modal-asset-intake");
    const sceneLbl = document.getElementById("intake-scene-label");
    const sceneVal = document.getElementById("intake-scene-id-val");
    if (!modal) return;
    if (sceneLbl) sceneLbl.textContent = sceneId;
    if (sceneVal) sceneVal.value = sceneId;
    if (window.UQModal) window.UQModal.open(modal, document.activeElement);
    else modal.style.display = "flex";
  };

  window.resolveIssue = async function (issueId) {
    const p = getActiveProject();
    if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(p)}/review/issues/${encodeURIComponent(issueId)}/resolve`, {
        method: "POST"
      });
      if (!res.ok) throw new Error("Không thể cập nhật lỗi.");
      showToast("✓ Đã đánh dấu giải quyết vấn đề!", "success");
      loadReviewData(p);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------------
  // 9. EVENT LISTENERS INITIALIZATION
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // Mode toggle in Scene Planner
    const btnSimple = document.getElementById("btn-scene-simple-mode");
    const btnAdv = document.getElementById("btn-scene-advanced-mode");
    const wsScenes = document.getElementById("ws-scenes");

    if (btnSimple && btnAdv) {
      btnSimple.addEventListener("click", () => {
        sceneMode = "simple";
        btnSimple.classList.add("active");
        btnAdv.classList.remove("active");
        if (wsScenes) {
          wsScenes.classList.remove("scene-advanced-mode");
          wsScenes.classList.add("scene-simple-mode");
        }
        showToast("Đã chuyển sang Chế độ đơn giản", "info");
      });

      btnAdv.addEventListener("click", () => {
        sceneMode = "advanced";
        btnAdv.classList.add("active");
        btnSimple.classList.remove("active");
        if (wsScenes) {
          wsScenes.classList.remove("scene-simple-mode");
          wsScenes.classList.add("scene-advanced-mode");
        }
        showToast("Đã chuyển sang Chế độ nâng cao", "info");
      });
    }

    // Google Flow Global Button
    const btnFlowGlobal = document.getElementById("btn-open-flow-modal-global");
    if (btnFlowGlobal) {
      btnFlowGlobal.addEventListener("click", () => {
        window.openFlowInstructions("scene_001");
      });
    }

    // Modal Copy Flow Prompt
    const btnCopyPrompt = document.getElementById("btn-copy-flow-prompt");
    if (btnCopyPrompt) {
      btnCopyPrompt.addEventListener("click", window.copyFlowPromptText);
    }

    // P1 (§8): modal helper dùng chung — trap + scroll lock + restore focus.
    function uqOpen(modal) {
      if (!modal) return;
      if (window.UQModal) window.UQModal.open(modal, document.activeElement);
      else modal.style.display = "flex";
    }
    function uqClose(modal) {
      if (!modal) return;
      if (window.UQModal) window.UQModal.close(modal);
      else modal.style.display = "none";
    }

    // Close Modals
    const closeFlowBtn = document.getElementById("flow-modal-close-btn");
    const doneFlowBtn = document.getElementById("flow-modal-done-btn");
    const flowModal = document.getElementById("modal-flow-instructions");
    [closeFlowBtn, doneFlowBtn].forEach(b => {
      if (b) b.addEventListener("click", () => { uqClose(flowModal); });
    });

    // Flow modal intake shortcut
    const flowIntakeShortcut = document.getElementById("btn-flow-modal-intake-shortcut");
    if (flowIntakeShortcut) {
      flowIntakeShortcut.addEventListener("click", () => {
        const scId = flowModal ? flowModal.dataset.sceneId : "scene_001";
        uqClose(flowModal);
        window.openAssetIntakeModal(scId);
      });
    }

    // Asset Intake submit
    const btnSubmitIntake = document.getElementById("btn-submit-asset-intake");
    const intakeModal = document.getElementById("modal-asset-intake");
    const intakeClose = document.getElementById("intake-modal-close-btn");
    const intakeCancel = document.getElementById("intake-modal-cancel-btn");
    [intakeClose, intakeCancel].forEach(b => {
      if (b) b.addEventListener("click", () => { uqClose(intakeModal); });
    });

    if (btnSubmitIntake) {
      btnSubmitIntake.addEventListener("click", async () => {
        const p = getActiveProject();
        if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
        const fileInput = document.getElementById("intake-file-input");
        const scVal = document.getElementById("intake-scene-id-val");
        if (!fileInput || !fileInput.files.length) {
          showToast("Vui lòng chọn tệp video MP4 trước!", "warning");
          return;
        }
        btnSubmitIntake.disabled = true;
        btnSubmitIntake.textContent = "Đang tải & QC...";

        const formData = new FormData();
        formData.append("file", fileInput.files[0]);
        formData.append("scene_id", scVal ? scVal.value : "scene_001");

        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(p)}/assets/intake`, {
            method: "POST",
            body: formData
          });
          if (!res.ok) {
            let msg = "Nhập video thất bại.";
            try {
              const d = await res.clone().json();
              msg = (d && d.detail) || msg;
            } catch (e) {}
            throw new Error(msg);
          }
          showToast("✓ Tiếp nhận video và kiểm tra QC thành công!", "success");
          uqClose(intakeModal);
          loadTimelineData(p);
          loadOverviewData(p);
        } catch (err) {
          showToast(err.message, "error");
        } finally {
          btnSubmitIntake.disabled = false;
          btnSubmitIntake.textContent = "Tiếp nhận & Kiểm tra QC";
        }
      });
    }

    // Source Lock toggle
    const btnLockSources = document.getElementById("btn-toggle-source-lock");
    if (btnLockSources) {
      btnLockSources.addEventListener("click", async () => {
        const p = getActiveProject();
        if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
        const badge = document.getElementById("research-lock-badge");
        const isLocked = badge && badge.textContent.includes("Đã khóa");
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(p)}/research/lock`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locked: !isLocked })
          });
          if (!res.ok) throw new Error("Không thể đổi trạng thái khóa.");
          showToast(!isLocked ? "✓ Đã khóa bộ nguồn nghiên cứu!" : "Đã mở khóa bộ nguồn", "info");
          loadResearchData(p);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }

    // Add Source Modal
    const btnAddSrcOpen = document.getElementById("btn-open-add-source-modal");
    const modalAddSrc = document.getElementById("modal-add-source");
    const closeSrcBtn = document.getElementById("source-modal-close-btn");
    const cancelSrcBtn = document.getElementById("source-modal-cancel-btn");
    const submitSrcBtn = document.getElementById("btn-submit-add-source");

    if (btnAddSrcOpen && modalAddSrc) {
      btnAddSrcOpen.addEventListener("click", () => { uqOpen(modalAddSrc); });
      [closeSrcBtn, cancelSrcBtn].forEach(b => {
        if (b) b.addEventListener("click", () => { uqClose(modalAddSrc); });
      });

      if (submitSrcBtn) {
        submitSrcBtn.addEventListener("click", async () => {
        const p = getActiveProject();
        if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
        const title = document.getElementById("src-title-input").value;
          const url = document.getElementById("src-url-input").value;
          const author = document.getElementById("src-author-input").value;
          const snippet = document.getElementById("src-snippet-input").value;

          if (!title || !url) {
            showToast("Vui lòng nhập tiêu đề và URL nguồn!", "warning");
            return;
          }

          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(p)}/research/sources`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title, url, author, content_snapshot: snippet })
            });
            if (!res.ok) throw new Error("Không thể thêm nguồn.");
            showToast("✓ Đã thêm nguồn tài liệu thành công!", "success");
            uqClose(modalAddSrc);
            loadResearchData(p);
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      }
    }

    // P0 (§2 FINAL-GAPS): hiển thị blocker preflight 422 bằng tiếng Việt.
    async function renderBlockerText(res, fallback) {
      try {
        const data = await res.clone().json();
        const d = data && data.detail;
        const msg = (d && d.message) || data.message || fallback;
        const blockers = (d && d.blockers) || data.blockers || [];
        if (blockers.length) return `${msg} Nguyên nhân: ${blockers.slice(0, 3).join(" · ")}`;
        return msg;
      } catch (e) {
        return fallback;
      }
    }

    // P1 (§12): poll job progress thật (jobs_manager), không setTimeout mù.
    // IDLE → LOADING (progress %) → SUCCESS (reload) / ERROR (toast).
    async function pollRenderJob(jobId, projectDir, btn, restoreText, kind) {
      const t0 = Date.now();
      async function tick() {
        let done = false, failed = false, msg = "";
        try {
          const r = await fetch(`/api/activity/jobs?projectId=${encodeURIComponent(projectDir)}`);
          if (r.ok) {
            const d = await r.json();
            const job = (d.jobs || []).find(j => j.id === jobId);
            if (job) {
              const pct = Math.round((job.progress || 0) * 100);
              if (btn) btn.textContent = `Đang kết xuất (${pct}%)…`;
              msg = job.message || "";
              if (job.status === "SUCCESS") done = true;
              else if (job.status === "FAILED" || job.status === "CANCELLED") { failed = true; msg = job.error || job.message || ""; }
            }
          }
        } catch (e) { /* giữ poll, job nền vẫn chạy */ }
        if (done) {
          showToast(kind === "final" ? "✓ Render bản chính 1080p hoàn tất!" : "✓ Render nháp 720p hoàn tất!", "success");
          if (btn) { btn.disabled = false; btn.textContent = restoreText; }
          loadExportData(projectDir);
          return;
        }
        if (failed) {
          showToast(`Kết xuất thất bại${msg ? ": " + msg : ". Kiểm tra tab Hoạt động."}`, "error");
          if (btn) { btn.disabled = false; btn.textContent = restoreText; }
          loadExportData(projectDir);
          return;
        }
        if (Date.now() - t0 > 15 * 60 * 1000) {
          showToast("Kết xuất quá lâu, hãy kiểm tra tại tab Hoạt động.", "warning");
          if (btn) { btn.disabled = false; btn.textContent = restoreText; }
          return;
        }
        setTimeout(tick, 2000);
      }
      tick();
    }

    // Render Draft Button
    const btnDraftRender = document.getElementById("btn-trigger-draft-render");
    if (btnDraftRender) {
      btnDraftRender.addEventListener("click", async () => {
        const p = getActiveProject();
        if (!p) { showToast("Hãy chọn một dự án trước khi kết xuất.", "warning"); return; }
        btnDraftRender.disabled = true;
        btnDraftRender.textContent = "Đang gửi yêu cầu...";
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(p)}/render/draft`, { method: "POST" });
          if (!res.ok) throw new Error(await renderBlockerText(res, "Yêu cầu render nháp thất bại."));
          const data = await res.json().catch(() => ({}));
          showToast("✓ Đã khởi chạy render nháp 720p!", "info");
          pollRenderJob(data.job && data.job.id, p, btnDraftRender, "Kết xuất bản nháp 720p", "draft");
        } catch (err) {
          showToast(err.message, "error");
          btnDraftRender.disabled = false;
          btnDraftRender.textContent = "Kết xuất bản nháp 720p";
        }
      });
    }

    // Render Final Button
    const btnFinalRender = document.getElementById("btn-trigger-final-render");
    if (btnFinalRender) {
      btnFinalRender.addEventListener("click", async () => {
        const p = getActiveProject();
        if (!p) { showToast("Hãy chọn một dự án trước khi kết xuất.", "warning"); return; }
        btnFinalRender.disabled = true;
        btnFinalRender.textContent = "Đang gửi yêu cầu...";
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(p)}/render/final`, { method: "POST" });
          if (!res.ok) throw new Error(await renderBlockerText(res, "Yêu cầu render chính thức thất bại."));
          const data = await res.json().catch(() => ({}));
          showToast("✓ Đã khởi chạy render video 1080p chính thức!", "info");
          pollRenderJob(data.job && data.job.id, p, btnFinalRender, "Kết xuất video chính thức", "final");
        } catch (err) {
          showToast(err.message, "error");
          btnFinalRender.disabled = false;
          btnFinalRender.textContent = "Kết xuất video chính thức";
        }
      });
    }

    // Library Tabs
    document.querySelectorAll("[data-lib-tab]").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-lib-tab]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeLibTab = btn.dataset.libTab;
        loadLibraryData();
      });
    });

    // Add Issue Modal — wire open/close/submit (§1 Zero Partial Feature: backend POST đã có).
    const btnAddIssueOpen = document.getElementById("btn-open-add-issue-modal");
    const modalAddIssue = document.getElementById("modal-add-issue");
    const issueCloseBtn = document.getElementById("issue-modal-close-btn");
    const issueCancelBtn = document.getElementById("issue-modal-cancel-btn");
    const btnSubmitIssue = document.getElementById("btn-submit-add-issue");

    if (btnAddIssueOpen && modalAddIssue) {
      btnAddIssueOpen.addEventListener("click", () => { uqOpen(modalAddIssue); });
      [issueCloseBtn, issueCancelBtn].forEach(b => {
        if (b) b.addEventListener("click", () => { uqClose(modalAddIssue); });
      });

      if (btnSubmitIssue) {
        btnSubmitIssue.addEventListener("click", async () => {
          const p = getActiveProject();
          if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
          const sceneId = (document.getElementById("issue-scene-id") || {}).value || "";
          const issueType = (document.getElementById("issue-type-select") || {}).value || "";
          const description = ((document.getElementById("issue-desc-input") || {}).value || "").trim();

          if (!sceneId || !description) {
            showToast("Vui lòng nhập mã cảnh và mô tả chi tiết!", "warning");
            return;
          }

          btnSubmitIssue.disabled = true;
          btnSubmitIssue.textContent = "Đang lưu...";
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(p)}/review/issues`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ scene_id: sceneId, issue_type: issueType, description })
            });
            if (!res.ok) throw new Error("Không thể lưu vấn đề.");
            showToast("✓ Đã ghi nhận vấn đề!", "success");
            uqClose(modalAddIssue);
            loadReviewData(p);
          } catch (err) {
            showToast(err.message, "error");
          } finally {
            btnSubmitIssue.disabled = false;
            btnSubmitIssue.textContent = "Lưu vấn đề";
          }
        });
      }
    }

    // Recompile Timeline
    const btnRecompile = document.getElementById("btn-recompile-timeline");
    if (btnRecompile) {
      btnRecompile.addEventListener("click", async () => {
        const p = getActiveProject();
        if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
        btnRecompile.disabled = true;
        try {
          await fetch(`/api/projects/${encodeURIComponent(p)}/timeline/compile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mute_generated_audio: true })
          });
          showToast("✓ Đã đồng bộ lại Timeline!", "success");
          loadTimelineData(p);
        } catch (err) {
          showToast(err.message, "error");
        } finally {
          btnRecompile.disabled = false;
        }
      });
    }

    // Continue production button
    const btnContinue = document.getElementById("btn-continue-production");
    if (btnContinue) {
      btnContinue.addEventListener("click", () => {
        window.switchWorkspace("scenes");
      });
    }

    // Refresh Overview — loading thật tới khi fetch settle, toast theo kết quả thật.
    const btnRefreshOverview = document.getElementById("btn-refresh-overview");
    if (btnRefreshOverview) {
      btnRefreshOverview.addEventListener("click", () => {
        const run = loadOverviewData().then(
          (ok) => showToast(ok ? "Đã làm mới dữ liệu tổng quan" : "Chưa có dữ liệu tổng quan để làm mới", ok ? "success" : "info"),
          (err) => showToast(String((err && err.message) || err), "error")
        );
        if (window.trackAsync) window.trackAsync(btnRefreshOverview, run);
        else return run;
      });
    }

    // Flow Modal Tab Switching
    const btnFlowTabImg = document.getElementById("btn-flow-tab-image");
    const btnFlowTabMot = document.getElementById("btn-flow-tab-motion");
    if (btnFlowTabImg) {
      btnFlowTabImg.addEventListener("click", () => window.renderFlowModalTab("image"));
    }
    if (btnFlowTabMot) {
      btnFlowTabMot.addEventListener("click", () => window.renderFlowModalTab("motion"));
    }

    // AI Discovery Trigger
    const btnAiDiscover = document.getElementById("btn-trigger-ai-discovery");
    if (btnAiDiscover) {
        btnAiDiscover.addEventListener("click", async () => {
        const p = getActiveProject();
        if (!p) { showToast("Hãy chọn một dự án trước.", "warning"); return; }
        btnAiDiscover.disabled = true;
        btnAiDiscover.innerHTML = `<span>Đang tìm...</span>`;
        try {
          const res = await fetch(`/api/projects/${encodeURIComponent(p)}/research/discover`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ topic: "Homo habilis caregiving and archaeological evidence" })
          });
          if (!res.ok) throw new Error("AI tìm kiếm thất bại.");
          const data = await res.json();
          const discovered = data.discovered || [];
          showToast(`✓ Đã tìm thấy ${discovered.length} nguồn tài liệu khoa học mới!`, "success");
          loadResearchData(p);
        } catch (err) {
          showToast(err.message, "error");
        } finally {
          btnAiDiscover.disabled = false;
          btnAiDiscover.innerHTML = `<svg class="ui-icon"><use href="#icon-search"/></svg> <span>AI Tìm nguồn</span>`;
        }
      });
    }

    // Refresh Activity button (§1: nút hiển thị phải hoạt động).
    const btnRefreshActivity = document.getElementById("btn-refresh-activity");
    if (btnRefreshActivity) {
      btnRefreshActivity.addEventListener("click", () => { loadActivityData(); });
    }

    // Hook window.switchWorkspace to load Phase 14 views
    const originalSwitch = window.switchWorkspace;
    window.switchWorkspace = function (targetId) {
      let actualTargetId = targetId;
      if (targetId === "content") actualTargetId = "research";
      if (targetId === "studio") actualTargetId = "timeline";

      if (typeof originalSwitch === "function") {
        originalSwitch(actualTargetId);
      } else {
        document.querySelectorAll(".pipeline-nav .nav-item").forEach(btn => {
          if (btn.dataset.workspace === actualTargetId) btn.classList.add("active");
          else btn.classList.remove("active");
        });
        document.querySelectorAll(".workspace-view").forEach(view => {
          view.classList.remove("active");
        });
        const targetView = document.getElementById(`ws-${actualTargetId}`);
        if (targetView) targetView.classList.add("active");
      }

      if (actualTargetId === "overview") loadOverviewData();
      else if (actualTargetId === "research") loadResearchData();
      else if (actualTargetId === "library") loadLibraryData();
      else if (actualTargetId === "timeline") loadTimelineData();
      else if (actualTargetId === "review") loadReviewData();
      else if (actualTargetId === "export") loadExportData();
      else if (actualTargetId === "activity") loadActivityData();
    };

    // Expose Phase14 globally
    window.Phase14 = {
      handleWorkspaceSwitch: function (targetId) {
        if (targetId === "overview") loadOverviewData();
        else if (targetId === "research") loadResearchData();
        else if (targetId === "library") loadLibraryData();
        else if (targetId === "timeline") loadTimelineData();
        else if (targetId === "review") loadReviewData();
        else if (targetId === "export") loadExportData();
        else if (targetId === "activity") loadActivityData();
      },
      loadOverviewData,
      loadResearchData,
      loadLibraryData,
      loadTimelineData,
      loadReviewData,
      loadExportData,
      loadActivityData
    };

    // Load initial data
    setTimeout(() => {
      loadOverviewData();
    }, 600);
  });
})();
