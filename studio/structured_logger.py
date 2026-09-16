"""
UnfoldIQ Structured Logging & Rotation — Phase 15A
Structured JSON logs with rotation policy and automatic secret sanitization.
"""

import json
import logging
import os
import re
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Dict, Any, Optional

from studio.config import BASE_DIR

LOGS_DIR = BASE_DIR / "runtime" / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

def sanitize_text(text: str) -> str:
    """Mask secrets and sensitive tokens from log messages or strings."""
    if not isinstance(text, str):
        return text
    sanitized = text
    # 1. Key-value pairs
    sanitized = re.sub(r'(?i)(api[_-]?key|token|secret|password|passwd|auth|bearer|private[_-]?key)\s*[:=]\s*["\']?([^"\'\s,;]+)["\']?', r'\1: [REDACTED]', sanitized)
    # 2. Authorization Bearer
    sanitized = re.sub(r'(?i)(Authorization:\s*Bearer\s+)([^\s,;]+)', r'\1[REDACTED]', sanitized)
    # 3. Known key prefixes
    sanitized = re.sub(r'AIza[0-9A-Za-z-_]{20,}', '[REDACTED]', sanitized)
    sanitized = re.sub(r'sk-[A-Za-z0-9_\-]{8,}', '[REDACTED]', sanitized)
    return sanitized


class StructuredJsonFormatter(logging.Formatter):
    """Formats log records as structured JSON without secrets."""

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "module": record.name,
            "projectId": getattr(record, "projectId", None),
            "sceneId": getattr(record, "sceneId", None),
            "jobId": getattr(record, "jobId", None),
            "event": getattr(record, "event", record.funcName),
            "message": sanitize_text(record.getMessage()),
        }
        if record.exc_info:
            payload["exception"] = sanitize_text(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


def get_structured_logger(name: str = "unfoldiq") -> logging.Logger:
    """Get or configure structured logger with size rotation (max 10MB, 5 backups)."""
    logger = logging.getLogger(name)
    if not any(isinstance(h, RotatingFileHandler) for h in logger.handlers):
        log_file = LOGS_DIR / "unfoldiq.log"
        handler = RotatingFileHandler(
            str(log_file),
            maxBytes=10 * 1024 * 1024,  # 10 MB
            backupCount=5,
            encoding="utf-8"
        )
        handler.setFormatter(StructuredJsonFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    return logger

structured_logger = get_structured_logger()
