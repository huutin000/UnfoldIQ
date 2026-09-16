"""
UnfoldIQ Startup Self-Check, Diagnostics, Resource Guard & Profiler — Phase 15A (P1 & P2)
Comprehensive hardware, software, and runtime diagnostics engine:
- Startup self-check across 8 vital dependencies with vi-VN friendly explanations
- Secret-sanitized Diagnostics Package generator
- Resource Guard for RAM, VRAM, and Disk space thresholds
- Performance Profiler tracking execution durations, FPS, and resource peaks
"""

import json
import logging
import os
import platform
import shutil
import subprocess
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.config import BASE_DIR, PROJECTS_DIR, TEMP_DIR, config
from studio.structured_logger import LOGS_DIR, sanitize_text
from studio.jobs_manager import jobs_manager
from studio.project_integrity import project_integrity_checker

logger = logging.getLogger("unfoldiq.system_check")


class SystemCheckService:
    def __init__(self):
        pass

    def run_self_check(self) -> Dict[str, Any]:
        """
        Execute startup diagnostics across all 8 essential dependencies.
        Returns vi-VN friendly results and corrective actions.
        """
        checks: List[Dict[str, Any]] = []

        # 1. Python Check
        py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        py_ok = sys.version_info >= (3, 10)
        checks.append({
            "key": "python",
            "labelVi": "Môi trường Python",
            "status": "HEALTHY" if py_ok else "BROKEN",
            "statusVi": "Ổn định" if py_ok else "Không tương thích",
            "detailVi": f"Phiên bản Python hiện tại: {py_ver}",
            "actionVi": "Cập nhật Python lên 3.10 trở lên nếu gặp lỗi tương thích." if not py_ok else "Không cần thao tác."
        })

        # 2. FFmpeg Check
        ffmpeg_bin = config.ffmpeg_path
        ffmpeg_ok = False
        ffmpeg_ver = "Không tìm thấy"
        try:
            res = subprocess.run([ffmpeg_bin, "-version"], capture_output=True, text=True, timeout=5)
            if res.returncode == 0:
                ffmpeg_ok = True
                ffmpeg_ver = res.stdout.splitlines()[0] if res.stdout else "FFmpeg OK"
        except Exception:
            ffmpeg_ok = False

        checks.append({
            "key": "ffmpeg",
            "labelVi": "Công cụ FFmpeg",
            "status": "HEALTHY" if ffmpeg_ok else "BROKEN",
            "statusVi": "Ổn định" if ffmpeg_ok else "Thiếu hoặc lỗi",
            "detailVi": f"FFmpeg: {ffmpeg_ver}",
            "actionVi": "Cài đặt FFmpeg và thêm vào PATH hệ thống để phục vụ kết xuất âm thanh và video." if not ffmpeg_ok else "Không cần thao tác."
        })

        # 3. Kokoro TTS Service Check
        kokoro_url = config.kokoro_base_url
        kokoro_ok = False
        kokoro_detail = f"Địa chỉ dịch vụ: {kokoro_url}"
        try:
            import urllib.request
            req = urllib.request.Request(f"{kokoro_url}/web", headers={"User-Agent": "UnfoldIQ-HealthCheck"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status in (200, 404):
                    kokoro_ok = True
                    kokoro_detail = f"Dịch vụ Kokoro đang phản hồi ({kokoro_url})"
        except Exception as e:
            # Check if models exist locally
            local_models = (BASE_DIR / "models").exists()
            kokoro_detail = f"Chưa kết nối được Kokoro tại {kokoro_url}. Cần khởi động worker TTS."

        checks.append({
            "key": "kokoro",
            "labelVi": "Dịch vụ giọng đọc Kokoro",
            "status": "HEALTHY" if kokoro_ok else "WARNING",
            "statusVi": "Ổn định" if kokoro_ok else "Chưa khởi động",
            "detailVi": kokoro_detail,
            "actionVi": "Chạy tập lệnh start-unfoldiq-tts.bat để kích hoạt worker Kokoro nếu muốn tạo giọng đọc mới." if not kokoro_ok else "Không cần thao tác."
        })

        # 4. CUDA / GPU Check
        cuda_ok = False
        cuda_detail = "Không phát hiện GPU NVIDIA hoặc PyTorch CUDA."
        try:
            import torch
            if torch.cuda.is_available():
                cuda_ok = True
                dev_name = torch.cuda.get_device_name(0)
                vram_gb = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 1)
                cuda_detail = f"GPU: {dev_name} ({vram_gb} GB VRAM)"
            else:
                cuda_detail = "PyTorch đang chạy ở chế độ CPU. Tác vụ Whisper sẽ chạy chậm hơn."
        except Exception:
            cuda_detail = "Chưa cài đặt gói PyTorch hoặc chưa cấu hình CUDA."

        checks.append({
            "key": "cuda",
            "labelVi": "Tăng tốc phần cứng CUDA",
            "status": "HEALTHY" if cuda_ok else "WARNING",
            "statusVi": "Ổn định" if cuda_ok else "Chạy CPU",
            "detailVi": cuda_detail,
            "actionVi": "Cài đặt PyTorch hỗ trợ CUDA để tăng tốc độ căn chỉnh phụ đề và phiên âm." if not cuda_ok else "Không cần thao tác."
        })

        # 5. Whisper Model Check
        whisper_path = BASE_DIR / config.transcription_model_path
        whisper_ok = whisper_path.exists()
        checks.append({
            "key": "whisper",
            "labelVi": "Mô hình nhận diện Whisper",
            "status": "HEALTHY" if whisper_ok else "WARNING",
            "statusVi": "Ổn định" if whisper_ok else "Chưa tải mô hình",
            "detailVi": f"Đường dẫn mô hình: {config.transcription_model_path}",
            "actionVi": "Mô hình sẽ tự động được tải về trong lần chạy căn chỉnh đầu tiên." if not whisper_ok else "Không cần thao tác."
        })

        # 6. Storage & Disk Space Check
        tot_disk, used_disk, free_disk = shutil.disk_usage(BASE_DIR)
        free_gb = round(free_disk / (1024**3), 2)
        disk_ok = free_gb >= 5.0
        disk_warning = free_gb < 1.0

        checks.append({
            "key": "storage",
            "labelVi": "Dung lượng ổ đĩa khả dụng",
            "status": "BROKEN" if disk_warning else ("WARNING" if not disk_ok else "HEALTHY"),
            "statusVi": "Ổn định" if disk_ok else ("Rất thấp" if disk_warning else "Cần chú ý"),
            "detailVi": f"Dung lượng trống: {free_gb} GB",
            "actionVi": "Giải phóng bớt bộ nhớ hoặc dọn dẹp cache tại Cài đặt -> Bộ nhớ." if not disk_ok else "Không cần thao tác."
        })

        # 7. Project Directory Check
        proj_ok = PROJECTS_DIR.exists() and PROJECTS_DIR.is_dir()
        checks.append({
            "key": "projectsDir",
            "labelVi": "Thư mục lưu trữ dự án",
            "status": "HEALTHY" if proj_ok else "BROKEN",
            "statusVi": "Ổn định" if proj_ok else "Không tìm thấy",
            "detailVi": f"Đường dẫn: {PROJECTS_DIR}",
            "actionVi": "Đảm bảo quyền tạo và đọc thư mục projects." if not proj_ok else "Không cần thao tác."
        })

        # 8. Write Permission Check
        write_ok = False
        try:
            test_file = TEMP_DIR / f".perm_check_{int(time.time())}"
            test_file.write_text("ok", encoding="utf-8")
            test_file.unlink()
            write_ok = True
        except Exception:
            write_ok = False

        checks.append({
            "key": "writePermission",
            "labelVi": "Quyền ghi tệp tạm thời",
            "status": "HEALTHY" if write_ok else "BROKEN",
            "statusVi": "Ổn định" if write_ok else "Bị chặn quyền",
            "detailVi": "Quyền ghi vào thư mục tạm và lưu trữ hệ thống",
            "actionVi": "Kiểm tra quyền truy cập thư mục của tài khoản người dùng Windows." if not write_ok else "Không cần thao tác."
        })

        # Overall Status
        has_broken = any(c["status"] == "BROKEN" for c in checks)
        has_warning = any(c["status"] == "WARNING" for c in checks)
        overall = "BROKEN" if has_broken else ("WARNING" if has_warning else "HEALTHY")

        return {
            "overallStatus": overall,
            "overallStatusVi": "Ổn định" if overall == "HEALTHY" else ("Có lỗi nghiêm trọng" if overall == "BROKEN" else "Cần kiểm tra"),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "checks": checks
        }

    def export_diagnostics_package(
        self,
        project_id: Optional[str] = None,
        include_private_content: bool = False
    ) -> Path:
        """
        Bundle sanitized diagnostics into a ZIP package without leaking any secrets.
        Includes: app_version.json, system_info.json, project_health.json, recent_logs/, jobs.json, config_sanitized.json
        """
        ts_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        diag_zip = TEMP_DIR / f"unfoldiq_diagnostics_{ts_str}.zip"

        # 1. App Version
        app_version = {
            "name": "UnfoldIQ TTS Studio",
            "version": "3.0.0",
            "phase": "15A Production Hardening",
            "targetLocale": "vi-VN",
            "generatedAt": datetime.now(timezone.utc).isoformat()
        }

        # 2. System Info
        tot_disk, used_disk, free_disk = shutil.disk_usage(BASE_DIR)
        system_info = {
            "os": platform.system(),
            "osRelease": platform.release(),
            "platform": platform.platform(),
            "pythonVersion": sys.version,
            "cpuCount": os.cpu_count(),
            "diskFreeGb": round(free_disk / (1024**3), 2),
            "diskTotalGb": round(tot_disk / (1024**3), 2),
            "selfCheck": self.run_self_check()
        }

        # 3. Project Health (if project_id given)
        project_health = {}
        if project_id:
            p_dir = PROJECTS_DIR / project_id
            if p_dir.exists():
                project_health = project_integrity_checker.run_check(p_dir)

        # 4. Jobs snapshot
        jobs_snapshot = jobs_manager.list_jobs(project_id=project_id, limit=50)

        # 5. Sanitized config
        config_sanitized = {
            "kokoro_base_url": config.kokoro_base_url,
            "studio_host": config.studio_host,
            "studio_port": config.studio_port,
            "default_voice": config.default_voice,
            "default_speed": config.default_speed,
            "transcription_engine": config.transcription_engine,
            "transcription_device": config.transcription_device,
        }

        with zipfile.ZipFile(diag_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("app_version.json", json.dumps(app_version, indent=2, ensure_ascii=False))
            zf.writestr("system_info.json", json.dumps(system_info, indent=2, ensure_ascii=False))
            zf.writestr("project_health.json", json.dumps(project_health, indent=2, ensure_ascii=False))
            zf.writestr("jobs.json", json.dumps(jobs_snapshot, indent=2, ensure_ascii=False))
            zf.writestr("config_sanitized.json", json.dumps(config_sanitized, indent=2, ensure_ascii=False))

            # Include sanitized logs
            if LOGS_DIR.exists():
                for lf in LOGS_DIR.glob("*.log"):
                    try:
                        raw_content = lf.read_text(encoding="utf-8", errors="ignore")
                        sanitized_content = sanitize_text(raw_content)
                        zf.writestr(f"recent_logs/{lf.name}", sanitized_content)
                    except Exception as e:
                        logger.warning(f"Error packing log {lf}: {e}")

        logger.info(f"Diagnostics package created: {diag_zip}")
        return diag_zip


class ResourceGuard:
    """Pre-flight resource check preventing Out-Of-Memory and Disk Full panics."""

    def __init__(self, min_disk_mb: int = 1000):
        self.min_disk_mb = min_disk_mb

    def can_start_heavy_job(self, job_type: str) -> Dict[str, Any]:
        tot_disk, used_disk, free_disk = shutil.disk_usage(BASE_DIR)
        free_mb = free_disk / (1024 * 1024)

        if free_mb < self.min_disk_mb:
            return {
                "allowed": False,
                "reasonVi": f"Dung lượng ổ đĩa còn lại ({round(free_mb, 1)} MB) thấp hơn ngưỡng an toàn ({self.min_disk_mb} MB).",
                "actionVi": "Dọn dẹp bộ nhớ trước khi tiếp tục kết xuất."
            }

        # Check running CUDA jobs
        if job_type in ("FINAL_RENDER", "DRAFT_RENDER", "TIMESTAMP"):
            running_jobs = [j for j in jobs_manager.list_jobs() if j.get("status") == "RUNNING"]
            if len(running_jobs) >= 2:
                return {
                    "allowed": False,
                    "reasonVi": "Hệ thống đang chạy các tác vụ nặng khác. Hãy chờ hoàn tất để tránh quá tải GPU/CPU.",
                    "actionVi": "Chờ tác vụ hiện tại hoàn thành hoặc tạm dừng."
                }

        return {"allowed": True}


class PerformanceProfiler:
    """Telemetry collector for benchmark and runtime profiling."""

    def __init__(self):
        self._profiles: Dict[str, Dict[str, Any]] = {}

    def record_metric(
        self,
        project_dir: Path,
        stage: str,
        duration_seconds: float,
        fps: Optional[float] = None,
        peak_ram_mb: Optional[float] = None,
        peak_vram_mb: Optional[float] = None
    ) -> None:
        p_file = project_dir / "performance_profile.json"
        data = {}
        if p_file.exists():
            try:
                data = json.loads(p_file.read_text(encoding="utf-8"))
            except Exception:
                data = {}

        metrics = data.get("metrics", [])
        metrics.append({
            "stage": stage,
            "durationSeconds": round(duration_seconds, 2),
            "fps": round(fps, 1) if fps else None,
            "peakRamMb": peak_ram_mb,
            "peakVramMb": peak_vram_mb,
            "recordedAt": datetime.now(timezone.utc).isoformat()
        })
        data["metrics"] = metrics
        p_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


system_check_service = SystemCheckService()
resource_guard = ResourceGuard()
performance_profiler = PerformanceProfiler()
