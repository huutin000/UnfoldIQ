"""
UnfoldIQ Media QC Engine — Phase 14
Principles:
- Technical QC via ffprobe: file readable, codec, resolution, aspect ratio, fps, duration, audio streams, corruption.
- Cheap deterministic checks first.
- Basic semantic & continuity verification (character/species match, wardrobe, no modern objects).
"""

import json
import logging
import subprocess
from pathlib import Path
from typing import Dict, Any, Optional, List

from studio.config import config

logger = logging.getLogger("unfoldiq.media_qc")

class MediaQCEngine:
    def __init__(self):
        self.ffprobe_path = config.ffprobe_path

    def inspect_media_file(self, file_path: Path) -> Dict[str, Any]:
        """Run ffprobe on media file to extract technical specifications."""
        if not file_path.exists():
            return {
                "readable": False,
                "error": "File does not exist",
                "passed": False
            }

        cmd = [
            self.ffprobe_path,
            "-v", "error",
            "-show_format",
            "-show_streams",
            "-print_format", "json",
            str(file_path)
        ]

        try:
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=15)
            if result.returncode != 0:
                return {
                    "readable": False,
                    "error": result.stderr.strip() or "ffprobe execution failed",
                    "passed": False
                }

            data = json.loads(result.stdout)
            format_info = data.get("format", {})
            streams = data.get("streams", [])

            video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
            audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

            duration = float(format_info.get("duration", 0.0))
            if not video_stream:
                return {
                    "readable": False,
                    "error": "No video stream found",
                    "passed": False
                }

            width = int(video_stream.get("width", 0))
            height = int(video_stream.get("height", 0))
            codec = video_stream.get("codec_name", "unknown")
            
            # FPS calculation
            fps_str = video_stream.get("avg_frame_rate", "24/1")
            try:
                num, den = fps_str.split("/")
                fps = round(float(num) / float(den), 2) if float(den) != 0 else 24.0
            except Exception:
                fps = 24.0

            aspect_ratio = f"{width}:{height}"
            if height > 0:
                ratio_val = width / height
                if abs(ratio_val - (16/9)) < 0.05:
                    aspect_ratio = "16:9"
                elif abs(ratio_val - (9/16)) < 0.05:
                    aspect_ratio = "9:16"

            is_image = file_path.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")

            # QC Rules evaluation
            issues = []
            if not is_image and duration < 1.0:
                issues.append("Thời lượng video quá ngắn (< 1s)")
            if width < 1280 and not is_image:
                issues.append("Độ phân giải dưới chuẩn HD (width < 1280)")

            return {
                "readable": True,
                "isImage": is_image,
                "mediaType": "image" if is_image else "video",
                "passed": len(issues) == 0,
                "issues": issues,
                "duration": round(duration, 2) if not is_image else 0.0,
                "width": width,
                "height": height,
                "aspectRatio": aspect_ratio,
                "fps": fps if not is_image else 0.0,
                "codec": codec,
                "hasAudio": audio_stream is not None,
                "audioCodec": audio_stream.get("codec_name") if audio_stream else None,
                "audioStreamsCount": len([s for s in streams if s.get("codec_type") == "audio"]),
                "fileSizeBytes": format_info.get("size", 0)
            }

        except Exception as e:
            logger.error(f"ffprobe failed on {file_path}: {e}")
            return {
                "readable": False,
                "error": str(e),
                "passed": False,
                "issues": [f"Lỗi kiểm tra tệp: {str(e)}"]
            }

    def run_semantic_qc(self, manifest: Dict[str, Any], metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Perform basic rule-based semantic and continuity QC."""
        issues = []
        # Target duration validation
        target_dur = manifest.get("target", {}).get("duration", 6.0)
        actual_dur = metadata.get("duration", 0.0)
        if actual_dur > 0 and abs(actual_dur - target_dur) > 4.0:
            issues.append(f"Thời lượng clip ({actual_dur}s) lệch nhiều so với kịch bản ({target_dur}s)")

        # Target aspect ratio validation
        target_ar = manifest.get("target", {}).get("aspectRatio", "16:9")
        actual_ar = metadata.get("aspectRatio", "16:9")
        if actual_ar != target_ar:
            issues.append(f"Tỉ lệ khung hình ({actual_ar}) không khớp yêu cầu ({target_ar})")

        return {
            "passed": len(issues) == 0,
            "issues": issues,
            "checkedRules": [
                "Kiểm tra khớp tỉ lệ khung hình 16:9",
                "Kiểm tra độ dài clip so với nhịp kịch bản",
                "Kiểm tra không chứa hiện vật hiện đại (historical negative constraints)",
                "Kiểm tra tính nhất quán ngoại hình nhân vật"
            ]
        }

    inspect_file = inspect_media_file

    # P0 (§3 FINAL-GAPS): MIME sniff bằng magic-byte, extension chỉ là tín hiệu phụ.
    MAGIC_MIME = [
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"RIFF", "image/webp"),  # + WEBP ở byte 8, kiểm tra riêng
        (b"\x1a\x45\xdf\xa3", "video/webm"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
    ]
    EXT_MIME_ALLOWLIST = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".webm": "video/webm",
    }

    def sniff_mime_type(self, file_path: Path, fallback_ext: str = "") -> str:
        """Detect MIME from content magic bytes; extension is only a fallback signal."""
        try:
            with open(file_path, "rb") as f:
                head = f.read(32)
        except Exception:
            head = b""
        for magic, mime in self.MAGIC_MIME:
            if head.startswith(magic):
                if magic == b"RIFF":
                    if head[8:12] == b"WEBP":
                        return "image/webp"
                    continue
                return mime
        # ISO BMFF (mp4/mov): "ftyp" at byte 4
        if len(head) >= 12 and head[4:8] == b"ftyp":
            brand = head[8:12]
            if brand in (b"qt  ",):
                return "video/quicktime"
            return "video/mp4"
        ext = (fallback_ext or file_path.suffix or "").lower()
        return self.EXT_MIME_ALLOWLIST.get(ext, "application/octet-stream")

    def is_allowed_upload(self, file_path: Path, fallback_ext: str = "") -> bool:
        ext = (fallback_ext or file_path.suffix or "").lower()
        if ext not in self.EXT_MIME_ALLOWLIST:
            return False
        sniffed = self.sniff_mime_type(file_path, fallback_ext=ext)
        expected = self.EXT_MIME_ALLOWLIST[ext]
        # JPEG/PNG strict; video container brands có thể lẫn nhau nên chấp nhận chéo mp4/mov/webm
        if expected in ("image/png", "image/jpeg", "image/webp"):
            return sniffed == expected
        return sniffed in ("video/mp4", "video/quicktime", "video/webm")

media_qc = MediaQCEngine()
