"""Regression coverage for the v1.0.0 production-smoke STT interface drift.

Root cause (PRODUCTION_SMOKE_TEST_REPORT.md §15): WhisperSTTProvider forwarded
provider-level ``script_text``/``force`` kwargs into
``TranscriptionService.start_transcription(project_id, is_tts_active_fn=None)``,
raising ``TypeError: ... unexpected keyword argument 'script_text'`` on every
real Voice QA and STT request. Existing tests used FakeSTT mocks, so the real
provider → service delegation path was never exercised.

These tests pin the delegation contract with a strict-signature fake service
whose ``start_transcription`` accepts EXACTLY the real service signature, so
any kwarg leak fails loudly.
"""
import asyncio
import inspect
import json
import time
from pathlib import Path

import pytest

from studio.providers.whisper_provider import WhisperSTTProvider
from studio import transcription_service as ts_module


class StrictServiceEdge:
    """Stands in for TranscriptionService at the execution edge.

    Accepts EXACTLY the real service signature. Records every call.
    Writes a minimal transcription_raw.json so the Voice QA pipeline can
    proceed to evaluation without a GPU worker.
    """

    def __init__(self, project_dir: Path):
        self.project_dir = project_dir
        self.calls = []

    async def start_transcription(self, project_id, is_tts_active_fn=None):
        self.calls.append({"project_id": project_id,
                           "is_tts_active_fn": is_tts_active_fn})
        words = (self.project_dir / "script.txt").read_text(encoding="utf-8").split()
        wlist, t = [], 0.0
        for w in words:
            wlist.append({"word": w, "start": round(t, 2), "end": round(t + 0.4, 2),
                          "probability": 0.99})
            t += 0.5
        raw = {"audio_duration": round(t, 2),
               "segments": [{"id": 1, "start": 0.0, "end": round(t, 2),
                             "text": " ".join(words), "words": wlist}]}
        (self.project_dir / "transcription_raw.json").write_text(
            json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        return {"project_id": project_id, "state": "completed",
                "stage": "done", "percent": 100, "message": "stubbed complete"}

    async def cancel_transcription(self, project_id):
        return True

    def get_job(self, project_id):
        return None  # pipeline breaks its poll loop immediately

    def check_project_timestamps_status(self, project_id):
        return {"exists": False, "has_audio": True}


def _tiny_script(project_dir: Path) -> None:
    (project_dir / "script.txt").write_text(
        "Smoke verification speaks clearly.", encoding="utf-8")


class TestProviderDelegation:
    """Case A — real provider, strict service edge, full provider-level inputs."""

    def test_script_text_and_force_do_not_leak_into_service(self, tmp_path):
        (tmp_path / "script.txt").write_text("spoken words here", encoding="utf-8")
        edge = StrictServiceEdge(tmp_path)
        provider = WhisperSTTProvider(service=edge)
        seen = []

        async def go():
            return await provider.start_transcription(
                project_id="smoke-proj",
                script_text="spoken words here",
                force=True,
                is_tts_active_fn=lambda: False)
        result = asyncio.run(go())
        assert result["state"] == "completed"
        assert len(edge.calls) == 1
        assert edge.calls[0]["project_id"] == "smoke-proj"
        assert callable(edge.calls[0]["is_tts_active_fn"])
        seen.append(True)
        assert seen == [True]

    def test_force_false_and_true_both_accepted(self, tmp_path):
        (tmp_path / "script.txt").write_text("x", encoding="utf-8")
        for flag in (False, True):
            edge = StrictServiceEdge(tmp_path)
            provider = WhisperSTTProvider(service=edge)
            result = asyncio.run(provider.start_transcription(
                project_id="p", script_text="x", force=flag))
            assert result["state"] == "completed", flag


class TestServiceSignatureCompatibility:
    """Case D — existing direct service callers keep working."""

    def test_service_accepts_positional_and_keyword_guard(self):
        sig = inspect.signature(ts_module.TranscriptionService.start_transcription)
        params = list(sig.parameters.values())
        assert params[1].name == "project_id"
        assert params[2].name == "is_tts_active_fn"
        assert params[2].default is None
        # no required provider-level params may exist on the service
        required = [p.name for p in params[1:]
                    if p.default is inspect.Parameter.empty
                    and p.kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD,
                                   inspect.Parameter.KEYWORD_ONLY)]
        assert required == ["project_id"], required


PROJ = "2026-09-12_210003_youtube-narration-01"


@pytest.fixture()
def qa_project():
    from tests.fixtures.project_factory import hermetic_canonical_project_in_projects_dir
    with hermetic_canonical_project_in_projects_dir(PROJ) as p:
        _tiny_script(p)
        yield p


def _patched_client(monkeypatch):
    import studio.app as app_module
    from starlette.testclient import TestClient
    edge_holder = {}

    real_provider_cls = WhisperSTTProvider

    def _factory():
        from studio.config import PROJECTS_DIR
        return real_provider_cls(service=StrictServiceEdge(PROJECTS_DIR / PROJ))

    provider = _factory()
    edge_holder["edge"] = provider.service
    monkeypatch.setattr(app_module, "stt_provider", provider)
    # voice-qa pipeline reads module-global stt_provider at call time
    return TestClient(app_module.app), edge_holder


class TestVoiceQaRouteDelegation:
    """Case B — real POST voice-qa/run → real provider delegation, no TypeError."""

    def test_voice_qa_pipeline_completes_without_signature_crash(
            self, qa_project, monkeypatch):
        import studio.app as app_module
        client, holder = _patched_client(monkeypatch)
        try:
            r = client.post(f"/api/projects/{PROJ}/voice-qa/run", json={})
            assert r.status_code == 200, r.text[:300]
            assert r.json()["status"] == "started"
            terminal = None
            t0 = time.time()
            while time.time() - t0 < 150:
                time.sleep(2)
                g = client.get(f"/api/projects/{PROJ}/voice-qa")
                assert g.status_code == 200
                body = g.json()
                if body.get("status") != "running":
                    terminal = body
                    break
            assert terminal is not None, "QA pipeline never reached terminal state"
            blob = json.dumps(terminal)
            assert "unexpected keyword argument" not in blob, terminal
            assert "TypeError" not in blob, terminal
            assert len(holder["edge"].calls) >= 1, "provider delegation never reached"
        finally:
            app_module.active_qa_jobs.pop(PROJ, None)


class TestTimestampRouteDelegation:
    """Case C — real POST timestamps/generate, no provider/service 500."""

    def test_timestamps_generate_accepts_without_signature_500(
            self, qa_project, monkeypatch):
        client, holder = _patched_client(monkeypatch)
        r = client.post(f"/api/projects/{PROJ}/timestamps/generate", json={"force": True})
        assert r.status_code == 200, r.text[:300]
        assert r.json()["status"] == "started"
        assert len(holder["edge"].calls) >= 1, "provider delegation never reached"
