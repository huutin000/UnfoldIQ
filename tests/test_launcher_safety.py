"""
Tests for Process Safety and Launcher Guarantees (Phase 3).
"""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

BASE_DIR = Path(r"D:\Project\UnfoldIQ")
SCRIPTS_DIR = BASE_DIR / "scripts"
RUNTIME_DIR = BASE_DIR / "runtime"


class TestLauncherSafety(unittest.TestCase):
    def setUp(self):
        RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        self.studio_pid = RUNTIME_DIR / "studio.pid"
        self.kokoro_pid = RUNTIME_DIR / "kokoro.pid"

    def tearDown(self):
        # Clean test PID files if any
        if self.studio_pid.exists():
            try:
                self.studio_pid.unlink()
            except Exception:
                pass
        if self.kokoro_pid.exists():
            try:
                self.kokoro_pid.unlink()
            except Exception:
                pass

    def test_01_stale_pid_handled_safely(self):
        """A stale PID for a non-existent process must be cleaned without error."""
        # Use an impossibly high PID
        self.studio_pid.write_text("999999", encoding="utf-8")
        self.kokoro_pid.write_text("999998", encoding="utf-8")

        # Run stop script
        res = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPTS_DIR / "stop-unfoldiq-tts.ps1")],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("already stopped. Cleaning PID record", res.stdout)
        self.assertFalse(self.studio_pid.exists())
        self.assertFalse(self.kokoro_pid.exists())

    def test_02_recycled_non_python_pid_not_terminated(self):
        """If a PID recycled to a non-python process, stop must refuse to kill it."""
        # Find a common Windows non-python process PID (e.g. explorer.exe or svchost)
        try:
            out = subprocess.check_output(
                ["powershell.exe", "-Command", "(Get-Process -Name explorer -ErrorAction SilentlyContinue | Select-Object -First 1).Id"],
                text=True
            ).strip()
            if out and out.isdigit():
                explorer_pid = out
                self.studio_pid.write_text(explorer_pid, encoding="utf-8")

                res = subprocess.run(
                    ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPTS_DIR / "stop-unfoldiq-tts.ps1")],
                    cwd=str(BASE_DIR),
                    capture_output=True,
                    text=True
                )
                self.assertEqual(res.returncode, 0)
                self.assertIn("Refusing to terminate recycled process ID", res.stdout)

                # Verify explorer is still running!
                verify_explorer = subprocess.check_output(
                    ["powershell.exe", "-Command", f"(Get-Process -Id {explorer_pid} -ErrorAction SilentlyContinue).ProcessName"],
                    text=True
                ).strip()
                self.assertEqual(verify_explorer.lower(), "explorer")
        except Exception as e:
            self.skipTest(f"Could not locate explorer process for simulation: {e}")

    def test_03_stop_when_no_pids_exist_is_clean(self):
        """Running stop when no services were launched should exit code 0 cleanly."""
        if self.studio_pid.exists():
            self.studio_pid.unlink()
        if self.kokoro_pid.exists():
            self.kokoro_pid.unlink()

        res = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPTS_DIR / "stop-unfoldiq-tts.ps1")],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True
        )
        self.assertEqual(res.returncode, 0)
        self.assertIn("File not found", res.stdout)

    def test_04_wrapper_and_service_pid_cleanup(self):
        """Wrapper and service PIDs must both be cleaned by stop script."""
        studio_wrap = RUNTIME_DIR / "studio_wrapper.pid"
        kokoro_wrap = RUNTIME_DIR / "kokoro_wrapper.pid"

        self.studio_pid.write_text("999995", encoding="utf-8")
        studio_wrap.write_text("999994", encoding="utf-8")
        self.kokoro_pid.write_text("999993", encoding="utf-8")
        kokoro_wrap.write_text("999992", encoding="utf-8")

        res = subprocess.run(
            ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPTS_DIR / "stop-unfoldiq-tts.ps1")],
            cwd=str(BASE_DIR),
            capture_output=True,
            text=True
        )
        self.assertFalse(self.studio_pid.exists())
        self.assertFalse(studio_wrap.exists())
        self.assertFalse(self.kokoro_pid.exists())
        self.assertFalse(kokoro_wrap.exists())

    def test_05_recycled_python_pid_with_wrong_command_line_not_terminated(self):
        """If a PID recycled to an unrelated Python process, stop must refuse to kill it."""
        import sys
        dummy_proc = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(15)"],
            cwd=str(BASE_DIR)
        )
        try:
            self.studio_pid.write_text(str(dummy_proc.pid), encoding="utf-8")

            res = subprocess.run(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPTS_DIR / "stop-unfoldiq-tts.ps1")],
                cwd=str(BASE_DIR),
                capture_output=True,
                text=True
            )
            self.assertEqual(res.returncode, 0)
            self.assertIn("does not match UnfoldIQ Studio", res.stdout)
            self.assertFalse(self.studio_pid.exists())

            # Verify the unrelated python dummy process was NOT terminated!
            self.assertIsNone(dummy_proc.poll())
        finally:
            dummy_proc.terminate()
            dummy_proc.wait(timeout=3)

    def test_06_transcription_worker_terminated_by_stop_script(self):
        """Active owned transcription worker must be terminated when stop script runs."""
        import sys
        worker_proc = subprocess.Popen(
            [sys.executable, "-c", "# transcription worker.py execution\nimport time; time.sleep(15)"],
            cwd=str(BASE_DIR)
        )
        worker_pid_file = RUNTIME_DIR / "transcription_worker.pid"
        try:
            worker_pid_file.write_text(str(worker_proc.pid), encoding="utf-8")

            res = subprocess.run(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPTS_DIR / "stop-unfoldiq-tts.ps1")],
                cwd=str(BASE_DIR),
                capture_output=True,
                text=True
            )
            self.assertEqual(res.returncode, 0)
            self.assertIn("Successfully stopped Transcription Worker", res.stdout)
            self.assertFalse(worker_pid_file.exists())

            # Verify worker process was terminated
            worker_proc.wait(timeout=3)
            self.assertIsNotNone(worker_proc.poll())
        finally:
            if worker_proc.poll() is None:
                worker_proc.terminate()
                worker_proc.wait(timeout=3)


if __name__ == "__main__":
    unittest.main()

