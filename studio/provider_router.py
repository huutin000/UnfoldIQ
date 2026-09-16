"""
UnfoldIQ Provider Router & Cost Policy Engine — Phase 14
Principles:
- FREE_FIRST policy: Always prefer free / local providers.
- Never automatically trigger paid APIs.
- Provider abstraction: decouples business logic from specific vendors.
- Secrets masking: API keys are masked in logs and never exposed to the client.
"""

import os
import re
from typing import Dict, Any, Optional, List
from enum import Enum

class CostPolicy(str, Enum):
    FREE_FIRST = "FREE_FIRST"      # Default: Free tier & local first, paid requires explicit confirmation
    FREE_ONLY = "FREE_ONLY"        # Disallow paid requests strictly
    BALANCED = "BALANCED"          # Free tier first, balanced fallbacks
    BEST_QUALITY = "BEST_QUALITY"  # Best quality, requires confirmation if paid

class ProviderCapability(str, Enum):
    RESEARCH_SEARCH = "research_search"
    LLM_SYNTHESIS = "llm_synthesis"
    TTS = "tts"
    VISUAL = "visual"
    RENDER = "render"

class ProviderMode(str, Enum):
    FLOW_MANUAL = "flow_manual"    # Google Flow manual workflow (Phase 14 default)
    VEO_API = "veo_api"            # Disabled by default
    KOKORO_LOCAL = "kokoro_local"  # Kokoro local neural TTS
    FFMPEG_LOCAL = "ffmpeg_local"  # FFmpeg local video assembly
    LOCAL_RULE = "local_rule"      # Deterministic local logic

class ProviderRouter:
    def __init__(self):
        self.cost_policy: CostPolicy = CostPolicy.FREE_FIRST
        # P2 (§18 FINAL-GAPS): enforcement thật — mặc định cấm paid usage.
        # Chỉ code path gọi explicit allow_paid=True mới được bật provider trả phí.
        self.allowPaidUsage: bool = False
        self._provider_configs: Dict[str, Dict[str, Any]] = {
            "google_flow": {
                "name": "Google Flow",
                "mode": ProviderMode.FLOW_MANUAL,
                "is_free": True,
                "cost_note": "Người dùng quản lý credit qua tài khoản Google AI",
                "active": True
            },
            "kokoro": {
                "name": "Kokoro Neural TTS (Local)",
                "mode": ProviderMode.KOKORO_LOCAL,
                "is_free": True,
                "cost_note": "Hoàn toàn miễn phí, chạy GPU/CPU cục bộ",
                "active": True
            },
            "ffmpeg": {
                "name": "FFmpeg Engine (Local)",
                "mode": ProviderMode.FFMPEG_LOCAL,
                "is_free": True,
                "cost_note": "Hoàn toàn miễn phí, xử lý video cục bộ",
                "active": True
            },
            "gemini_free": {
                "name": "Gemini Free Tier",
                "mode": "free_api",
                "is_free": True,
                "cost_note": "Miễn phí theo hạn mức API Google AI Studio",
                "active": True
            },
            "veo_api": {
                "name": "Veo API",
                "mode": ProviderMode.VEO_API,
                "is_free": False,
                "cost_note": "API trả phí — mặc định tắt trong Phase 14",
                "active": False  # Disabled by default in Phase 14
            }
        }

    FREE_FALLBACK = {
        "veo_api": "google_flow",
    }

    def get_active_provider(self, capability: ProviderCapability) -> Dict[str, Any]:
        """Resolve current provider for a capability adhering to cost policy."""
        if capability == ProviderCapability.TTS:
            return self._provider_configs["kokoro"]
        elif capability == ProviderCapability.VISUAL:
            # Phase 14 default: Google Flow manual adapter
            return self._provider_configs["google_flow"]
        elif capability == ProviderCapability.RENDER:
            return self._provider_configs["ffmpeg"]
        elif capability in (ProviderCapability.LLM_SYNTHESIS, ProviderCapability.RESEARCH_SEARCH):
            return self._provider_configs["gemini_free"]
        return {"name": "Local Default", "is_free": True, "mode": "local"}

    def require_free(self, provider_key: str) -> Dict[str, Any]:
        """Enforce FREE_FIRST: paid provider tắt/mất quota → fallback free, hết thì STOP."""
        cfg = self._provider_configs.get(provider_key)
        if cfg is None:
            raise ValueError(f"Unknown provider: {provider_key}")
        if cfg.get("is_free") and cfg.get("active"):
            return cfg
        if not self.allowPaidUsage or not cfg.get("active"):
            fb_key = self.FREE_FALLBACK.get(provider_key)
            if fb_key and self._provider_configs.get(fb_key, {}).get("active"):
                return self._provider_configs[fb_key]
            raise RuntimeError(
                f"Provider '{provider_key}' không khả dụng miễn phí và paid usage bị cấm "
                f"(allowPaidUsage=false). Dừng thay vì tự tính phí."
            )
        return cfg

    def set_provider_active(self, provider_key: str, active: bool, allow_paid: bool = False) -> Dict[str, Any]:
        cfg = self._provider_configs.get(provider_key)
        if cfg is None:
            raise ValueError(f"Unknown provider: {provider_key}")
        if active and not cfg.get("is_free") and not (allow_paid and self.allowPaidUsage):
            raise ValueError(
                f"Không thể bật provider trả phí '{provider_key}' nếu chưa cho phép paid usage rõ ràng."
            )
        cfg["active"] = bool(active)
        return cfg

    def set_cost_policy(self, policy: CostPolicy, allow_paid: bool = False):
        # Rời FREE_FIRST/FREE_ONLY sang policy cho phép paid phải xác nhận rõ ràng.
        paid_capable = policy in (CostPolicy.BALANCED, CostPolicy.BEST_QUALITY)
        if paid_capable and not allow_paid:
            raise ValueError(
                f"Chuyển sang '{policy.value}' cần xác nhận paid usage rõ ràng (allow_paid=True)."
            )
        self.cost_policy = policy
        if policy == CostPolicy.FREE_ONLY:
            self.allowPaidUsage = False

    def mask_secret(self, secret: str) -> str:
        """Mask secret for safe logging and client display."""
        if not secret or len(secret) < 8:
            return "***"
        return f"{secret[:4]}...{secret[-4:]}"

    def get_status_overview(self) -> Dict[str, Any]:
        """Return provider status summary for settings and status bar."""
        return {
            "costPolicy": self.cost_policy.value,
            "allowPaidUsage": self.allowPaidUsage,
            "costPolicyLabel": "Ưu tiên miễn phí" if self.cost_policy == CostPolicy.FREE_FIRST else self.cost_policy.value,
            "providers": {
                k: {
                    "name": v["name"],
                    "isFree": v["is_free"],
                    "costNote": v["cost_note"],
                    "active": v["active"],
                    "mode": v["mode"]
                }
                for k, v in self._provider_configs.items()
            }
        }

provider_router = ProviderRouter()
