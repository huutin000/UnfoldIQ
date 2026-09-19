"""Phase 9 Task 11: real FFmpeg fixtures, corruption matrix, detector evidence.

Exercises the production RenderQaService (real ffprobe + real full decode)
on genuine generated media. Temp dirs only; never real project data.
"""
import asyncio
import json
import shutil
from pathlib import Path

import pytest

from studio.render_qa_report_store import RenderQaReportStore
from tests.phase09_qa_media import (
    make_black_gap_final,
    make_clean_final,
    make_eof_freeze_final,
    make_freeze_final,
    make_silence_gap_final,
    make_srt,
    mux_soft_subtitles,
    write_export,
)

N = 96


def _clips(n_frames, media="VIDEO", transition="CUT", dur=0):
    return [{"clipId": "clip_0001", "sceneId": "scene_001",
             "shotId": "shot_001", "sequenceIndex": 1,
             "startFrame": 0, "durationFrames": n_frames,
             "endFrame": n_frames, "assetId": "a1",
             "acceptedAssetVersion": 1, "checksum": "0" * 64,
             "filePath": "assets/s1.png", "mediaType": media,
             "transition": {"type": transition, "durationFrames": dur}}]


@pytest.fixture(scope="module")
def media(tmp_path_factory):
    from tests.phase09_qa_media import probe_frames
    d = tmp_path_factory.mktemp("phase09_media")
    out = {}
    clean = d / "clean4.mp4"
    make_clean_final(clean, 4.0)
    out["clean4"] = clean
    r = d / "wrongres.mp4"
    make_clean_final(r, 4.0, width=1280, height=720)
    out["wrongres"] = r
    f = d / "wrongfps.mp4"
    make_clean_final(f, N / 30.0, fps=30)
    out["wrongfps"] = f
    s = d / "short3s.mp4"
    make_clean_final(s, 3.0)
    out["short3s"] = s
    na = d / "noaudio.mp4"
    make_clean_final(na, 4.0, with_audio=False)
    out["noaudio"] = na
    r44 = d / "rate441.mp4"
    make_clean_final(r44, 4.0, sample_rate=44100)
    out["rate441"] = r44
    mo = d / "mono.mp4"
    make_clean_final(mo, 4.0, channels=1)
    out["mono"] = mo
    srt = make_srt(d / "subs.srt", 4.0)
    sub = d / "subbed.mp4"
    mux_soft_subtitles(clean, srt, sub)
    out["subbed"] = sub
    trunc_src = d / "faststart.mp4"
    make_clean_final(trunc_src, 4.0, extra_args=["-movflags", "+faststart"])
    trunc = d / "truncated.mp4"
    raw = trunc_src.read_bytes()
    trunc.write_bytes(raw[:int(len(raw) * 0.6)])
    out["truncated"] = trunc
    cor = d / "corrupt_mid.mp4"
    buf = bytearray(clean.read_bytes())
    off = len(buf) // 2
    buf[off:off + 8192] = b"\x00" * 8192
    cor.write_bytes(bytes(buf))
    out["corrupt_mid"] = cor
    for name, gap in (("black05", 0.5), ("black46f", 46 / 24.0),
                      ("black48f", 48 / 24.0), ("black4", 4.0)):
        p = d / f"{name}.mp4"
        make_black_gap_final(p, gap, 8.0, 2.0)
        out[name] = p
    bt = d / "black_trans.mp4"
    make_black_gap_final(bt, 0.5, 8.0, 5.75)
    out["black_trans"] = bt
    for name, fr in (("freeze2", 2.0), ("freeze4", 4.0), ("freeze5", 5.0)):
        p = d / f"{name}.mp4"
        make_freeze_final(p, fr, 2.0, 2.0, workdir=d)
        out[name] = p
    for name, fr in (("eoffreeze2", 2.0), ("eoffreeze4", 4.0),
                     ("eoffreeze5", 5.0)):
        p = d / f"{name}.mp4"
        make_eof_freeze_final(p, fr, 2.0, workdir=d)
        out[name] = p
    for name, sil in (("sil3", 3.0), ("sil6", 6.0), ("sil9", 9.0)):
        p = d / f"{name}.mp4"
        make_silence_gap_final(p, sil, 13.0, 2.0)
        out[name] = p
    out["frames"] = {k: probe_frames(v) for k, v in out.items()
                     if isinstance(v, type(clean)) and v.suffix == ".mp4"}
    return out


async def _run_qa(tmp_path, project_name, export_id, timeout=600.0):
    from studio.jobs_manager import JobsManager
    from studio.render_qa_service import RenderQaService
    jobs = JobsManager(runtime_dir=tmp_path / f"jobs_{project_name}",
                       projects_dir=tmp_path)
    svc = RenderQaService(projects_dir=tmp_path, jobs=jobs)
    req = svc.request_qa(project_name, export_id, "MANUAL_RERUN")
    job = await svc.wait_for_job(req["jobId"], timeout=timeout)
    report = RenderQaReportStore().read_report(
        tmp_path / project_name / "exports" / export_id, req["qaRunId"])
    return job, report


def _hard_codes(report):
    return {f["code"] for f in (report.get("hardFailures") or [])}


def test_clean_pass_end_to_end(tmp_path, media):
    async def _go():
        proj = tmp_path / "projClean"
        proj.mkdir()
        clips = [
            {**_clips(48, "IMAGE")[0], "shotId": "shot_001",
             "clipId": "clip_0001", "sequenceIndex": 1},
            {"clipId": "clip_0002", "sceneId": "scene_001",
             "shotId": "shot_002", "sequenceIndex": 2,
             "startFrame": 48, "durationFrames": 48, "endFrame": 96,
             "assetId": "a1", "acceptedAssetVersion": 1,
             "checksum": "0" * 64, "filePath": "assets/s1.png",
             "mediaType": "VIDEO",
             "transition": {"type": "CROSSFADE", "durationFrames": 12}},
        ]
        write_export(proj, "export_001", media["clean4"], clips=clips)
        job, report = await _run_qa(tmp_path, "projClean", "export_001")
        assert job["status"] == "COMPLETED"
        assert report["verdict"] == "PASS"
        assert report["fullDecode"]["decodeErrorCount"] == 0
        assert report["probe"]["observedFrameCount"] == N
        assert job["metadata"]["artifactStatus"] == "READY"
    asyncio.run(_go())


@pytest.mark.parametrize("key,code", [
    ("wrongres", "QA_VIDEO_RESOLUTION_MISMATCH"),
    ("wrongfps", "QA_VIDEO_FPS_MISMATCH"),
    ("noaudio", "QA_AUDIO_STREAM_MISSING"),
    ("rate441", "QA_AUDIO_RATE_MISMATCH"),
    ("mono", "QA_AUDIO_CHANNELS_MISMATCH"),
])
def test_structural_mismatch_exact_code(tmp_path, media, key, code):
    async def _go():
        name = f"proj_{key}"
        proj = tmp_path / name
        proj.mkdir()
        write_export(proj, "export_001", media[key])
        job, report = await _run_qa(tmp_path, name, "export_001")
        assert job["status"] == "COMPLETED"
        assert report["verdict"] == "FAIL"
        assert code in _hard_codes(report)
        assert job["metadata"]["artifactStatus"] == "BLOCKED"
    asyncio.run(_go())


def test_wrong_frame_count(tmp_path, media):
    async def _go():
        proj = tmp_path / "proj_frames"
        proj.mkdir()
        write_export(proj, "export_001", media["short3s"],
                     clips=_clips(N), n_frames=N)
        job, report = await _run_qa(tmp_path, "proj_frames", "export_001")
        assert report["verdict"] == "FAIL"
        assert "QA_FRAME_COUNT_MISMATCH" in _hard_codes(report)
        assert job["metadata"]["artifactStatus"] == "BLOCKED"
    asyncio.run(_go())


def test_soft_subtitle_missing_and_unexpected(tmp_path, media):
    async def _go():
        p1 = tmp_path / "proj_submiss"
        p1.mkdir()
        write_export(p1, "export_001", media["clean4"],
                     subtitle_mode="soft")
        job1, rep1 = await _run_qa(tmp_path, "proj_submiss", "export_001")
        assert rep1["verdict"] == "FAIL"
        assert "QA_SUBTITLE_CONTRACT_MISMATCH" in _hard_codes(rep1)
        assert job1["metadata"]["artifactStatus"] == "BLOCKED"
        p2 = tmp_path / "proj_subextra"
        p2.mkdir()
        write_export(p2, "export_001", media["subbed"],
                     subtitle_mode="none")
        job2, rep2 = await _run_qa(tmp_path, "proj_subextra", "export_001")
        assert rep2["verdict"] == "FAIL"
        assert "QA_SUBTITLE_CONTRACT_MISMATCH" in _hard_codes(rep2)
    asyncio.run(_go())


def test_truncated_and_midstream_corruption_fail(tmp_path, media):
    async def _go():
        for name, key in (("proj_trunc", "truncated"),
                          ("proj_corrupt", "corrupt_mid")):
            proj = tmp_path / name
            proj.mkdir()
            write_export(proj, "export_001", media[key])
            job, report = await _run_qa(tmp_path, name, "export_001")
            assert job["status"] == "COMPLETED", job.get("metadata")
            assert report["verdict"] == "FAIL"
            assert job["metadata"]["artifactStatus"] == "BLOCKED"
    asyncio.run(_go())
    # Mid-stream file probes clean but must fail on full decode evidence.
    proj = tmp_path / "proj_corrupt_probe"
    proj.mkdir()
    write_export(proj, "export_001", media["corrupt_mid"])
    from studio.render_qa_probe import load_qa_input_snapshot, run_ffprobe
    snap = load_qa_input_snapshot(proj, "export_001")
    assert not snap.preflight_findings
    probe = run_ffprobe(proj / "exports" / "export_001" / "final.mp4")
    assert probe.video.read_frames == snap.expected_final_frames


def test_midstream_corruption_decode_failure_code(tmp_path, media):
    async def _go():
        proj = tmp_path / "proj_midcode"
        proj.mkdir()
        write_export(proj, "export_001", media["corrupt_mid"])
        job, report = await _run_qa(tmp_path, "proj_midcode", "export_001")
        assert "QA_FULL_DECODE_FAILED" in _hard_codes(report)
        assert report["fullDecode"]["decodeErrorCount"] > 0
    asyncio.run(_go())


@pytest.mark.parametrize("key,expect_verdict,expect_sev", [
    ("black05", "PASS_WITH_WARNINGS", "WARNING"),
    ("black46f", "PASS_WITH_WARNINGS", "WARNING"),
    ("black48f", "FAIL", "HARD_FAIL"),
    ("black4", "FAIL", "HARD_FAIL"),
])
def test_black_matrix(tmp_path, media, key, expect_verdict, expect_sev):
    async def _go():
        name = f"proj_{key}"
        proj = tmp_path / name
        proj.mkdir()
        info = write_export(proj, "export_001", media[key])
        job, report = await _run_qa(tmp_path, name, "export_001")
        assert report["verdict"] == expect_verdict, report.get("hardFailures")
        blacks = [f for f in (report.get("contextEvaluations") or [])
                  if f.get("detector") == "BLACK"]
        assert blacks and all(b["severity"] == expect_sev for b in blacks)
        want_artifact = "READY" if expect_verdict.startswith("PASS") else "BLOCKED"
        assert job["metadata"]["artifactStatus"] == want_artifact
    asyncio.run(_go())


def test_black_near_transition_context(tmp_path, media):
    async def _go():
        proj = tmp_path / "proj_blacktrans"
        proj.mkdir()
        clips = [
            {**_clips(144)[0], "shotId": "shot_001", "clipId": "clip_0001",
             "sequenceIndex": 1},
            {"clipId": "clip_0002", "sceneId": "scene_001",
             "shotId": "shot_002", "sequenceIndex": 2,
             "startFrame": 144, "durationFrames": 48, "endFrame": 192,
             "assetId": "a1", "acceptedAssetVersion": 1,
             "checksum": "0" * 64, "filePath": "assets/s1.png",
             "mediaType": "VIDEO",
             "transition": {"type": "CROSSFADE", "durationFrames": 12}},
        ]
        write_export(proj, "export_001", media["black_trans"], clips=clips)
        job, report = await _run_qa(tmp_path, "proj_blacktrans", "export_001")
        assert report["verdict"] == "PASS_WITH_WARNINGS"
        contexts = {f.get("context") for f in
                    (report.get("contextEvaluations") or [])}
        assert "BLACK_NEAR_TRANSITION" in contexts
    asyncio.run(_go())


def test_freeze_image_expected_video_warn_fail(tmp_path, media):
    async def _go():
        frames = media["frames"]
        p1 = tmp_path / "proj_imgfrz"
        p1.mkdir()
        n1 = frames["freeze5"]
        write_export(p1, "export_001", media["freeze5"],
                     clips=_clips(n1, "IMAGE"), n_frames=n1)
        job1, rep1 = await _run_qa(tmp_path, "proj_imgfrz", "export_001")
        assert rep1["verdict"] == "PASS"
        assert "QA_VIDEO_FREEZE_EXCESSIVE" not in _hard_codes(rep1)
        p2 = tmp_path / "proj_vidfrz2"
        p2.mkdir()
        write_export(p2, "export_001", media["freeze2"])
        job2, rep2 = await _run_qa(tmp_path, "proj_vidfrz2", "export_001")
        assert rep2["verdict"] == "PASS_WITH_WARNINGS"
        p3 = tmp_path / "proj_vidfrz4"
        p3.mkdir()
        write_export(p3, "export_001", media["freeze4"])
        job3, rep3 = await _run_qa(tmp_path, "proj_vidfrz4", "export_001")
        assert rep3["verdict"] == "FAIL"
        assert "QA_VIDEO_FREEZE_EXCESSIVE" in _hard_codes(rep3)
        assert job3["metadata"]["artifactStatus"] == "BLOCKED"
    asyncio.run(_go())


@pytest.mark.parametrize("bgm", [False, True])
@pytest.mark.parametrize("key,expect_verdict,expect_sev", [
    ("sil3", "PASS", "OBSERVED"),
    ("sil6", "PASS_WITH_WARNINGS", "WARNING"),
    ("sil9", "FAIL", "HARD_FAIL"),
])
def test_silence_matrix(tmp_path, media, bgm, key, expect_verdict, expect_sev):
    async def _go():
        name = f"proj_{key}_{'bgm' if bgm else 'nobgm'}"
        proj = tmp_path / name
        proj.mkdir()
        write_export(proj, "export_001", media[key],
                     music_configured=bgm)
        job, report = await _run_qa(tmp_path, name, "export_001")
        assert report["verdict"] == expect_verdict, report.get("hardFailures")
        sils = [f for f in (report.get("contextEvaluations") or [])
                if f.get("detector") == "SILENCE"]
        assert sils and all(s["severity"] == expect_sev for s in sils)
    asyncio.run(_go())


def test_final_changed_during_run_real(tmp_path, media):
    async def _go():
        from studio.jobs_manager import JobsManager
        from studio.render_qa_detector import run_full_decode_detectors
        from studio.render_qa_service import RenderQaService
        jobs = JobsManager(runtime_dir=tmp_path / "jobs_mut",
                           projects_dir=tmp_path)
        svc = RenderQaService(projects_dir=tmp_path, jobs=jobs)

        async def _mutating_detector(final_path=None, **kwargs):
            Path(final_path).write_bytes(b"\x02" * 4096)
            return await run_full_decode_detectors(
                Path(final_path), kwargs.get("expected_duration_seconds", 4.0),
                kwargs.get("expected_frames", N), kwargs["log_path"],
                kwargs["cancel_event"], kwargs.get("progress_cb"), "ffmpeg")
        svc.run_detector_fn = _mutating_detector
        proj = tmp_path / "proj_mut"
        proj.mkdir()
        write_export(proj, "export_001", media["clean4"])
        req = svc.request_qa("proj_mut", "export_001", "MANUAL_RERUN")
        job = await svc.wait_for_job(req["jobId"], timeout=600.0)
        assert job["status"] == "COMPLETED"
        assert job["metadata"]["qaVerdict"] == "FAIL"
        assert job["metadata"]["artifactStatus"] == "BLOCKED"
        report = RenderQaReportStore().read_report(
            proj / "exports" / "export_001", req["qaRunId"])
        assert "QA_FINAL_CHANGED_DURING_RUN" in _hard_codes(report)
    asyncio.run(_go())


def test_eof_freeze_video_tail_warning_and_fail(tmp_path, media):
    async def _go():
        frames = media["frames"]
        p2 = tmp_path / "proj_eoffrz2"
        p2.mkdir()
        n2 = frames["eoffreeze2"]
        write_export(p2, "export_001", media["eoffreeze2"],
                     clips=_clips(n2), n_frames=n2)
        job2, rep2 = await _run_qa(tmp_path, "proj_eoffrz2", "export_001")
        assert rep2["verdict"] == "PASS_WITH_WARNINGS", rep2.get("hardFailures")
        frz2 = [f for f in (rep2.get("contextEvaluations") or [])
                if f.get("detector") == "FREEZE"]
        assert frz2 and all(f["severity"] == "WARNING" for f in frz2)
        assert frz2[0]["end_frame_exclusive"] == n2
        p4 = tmp_path / "proj_eoffrz4"
        p4.mkdir()
        n4 = frames["eoffreeze4"]
        write_export(p4, "export_001", media["eoffreeze4"],
                     clips=_clips(n4), n_frames=n4)
        job4, rep4 = await _run_qa(tmp_path, "proj_eoffrz4", "export_001")
        assert rep4["verdict"] == "FAIL"
        assert "QA_VIDEO_FREEZE_EXCESSIVE" in _hard_codes(rep4)
        assert job4["metadata"]["artifactStatus"] == "BLOCKED"
    asyncio.run(_go())


def test_eof_freeze_image_held_is_expected(tmp_path, media):
    async def _go():
        frames = media["frames"]
        proj = tmp_path / "proj_eofimg"
        proj.mkdir()
        n5 = frames["eoffreeze5"]
        write_export(proj, "export_001", media["eoffreeze5"],
                     clips=_clips(n5, "IMAGE"), n_frames=n5)
        job, report = await _run_qa(tmp_path, "proj_eofimg", "export_001")
        assert report["verdict"] == "PASS", report.get("hardFailures")
        frz = [f for f in (report.get("contextEvaluations") or [])
               if f.get("detector") == "FREEZE"]
        assert frz and all(f["severity"] == "EXPECTED" for f in frz)
    asyncio.run(_go())
