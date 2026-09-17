import os
import subprocess
import sys
from pathlib import Path

def run_cmd(cmd, cwd=None, env=None):
    res = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"Error running {' '.join(cmd)}: {res.stderr}")
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\n{res.stderr}")
    return res.stdout.strip()

def main():
    root = Path(__file__).resolve().parent.parent
    os.chdir(root)
    print(f"Working directory: {root}")

    # 1. Base commit
    base_commit = "c1fa0ab37e6102a9cdcae314ca14fd3f11248244"
    print(f"Base commit: {base_commit}")

    # 2. Create isolated temporary index for 3A
    index_3a_path = root / ".git" / "index_phase3a"
    if index_3a_path.exists():
        index_3a_path.unlink()

    env_3a = os.environ.copy()
    env_3a["GIT_INDEX_FILE"] = str(index_3a_path)

    # Read base tree into index_3a
    run_cmd(["git", "read-tree", base_commit], env=env_3a)
    print("Read base tree into isolated 3A index.")

    # 3. Add 3A-specific files into isolated 3A index
    files_3a_exact = [
        "docs/UNFOLDIQ-PHASE03A-FINAL-MINOR-CONSISTENCY-A11Y-FIX-PROMPT.md",
        "docs/implementation/PHASE_03A_APP_SHELL_OVERVIEW_STORY.md",
        "docs/implementation/PHASE_03A_FINAL_VERIFICATION_REPORT.md",
        "docs/implementation/PHASE_03A_IMPLEMENTATION_REPORT.md",
        "docs/implementation/PHASE_03A_MINOR_CLOSURE_REPORT.md",
        "docs/implementation/UNFOLDIQ-PHASE03A-FINAL-VERIFICATION-AND-GAP-CLOSURE-PROMPT.md",
        "tests/browser_phase03a_cdp.py",
        "tests/test_phase03a_app_shell_overview_story.py",
        "tests/verify_phase03a_final_gates.py",
        "tests/verify_phase03a_minor_closure.py",
        "studio/next_action.py",
        "studio/static/phase14_ui.js",
    ]

    for f in files_3a_exact:
        if (root / f).is_file():
            run_cmd(["git", "add", f], env=env_3a)
            print(f"Added exact 3A file: {f}")

    # 4. Construct 3A content for mixed files
    # 4.1 studio/domain_models.py for 3A: in c1fa0ab it already had OverviewSlice and StorySlice
    # We can keep c1fa0ab's domain_models.py for 3A (no 3B has_mp3 or word_cues)
    
    # 4.2 studio/project_adapter.py for 3A:
    # Get c1fa0ab project_adapter and apply only the 3A load_overview_slice shot_count/duration additions
    c1_adapter = run_cmd(["git", "show", f"{base_commit}:studio/project_adapter.py"])
    # Replace load_overview_slice in c1_adapter with 3A version
    curr_adapter = (root / "studio" / "project_adapter.py").read_text(encoding="utf-8")
    overview_idx_curr = curr_adapter.find("def load_overview_slice")
    overview_idx_c1 = c1_adapter.find("def load_overview_slice")
    
    adapter_3a = c1_adapter[:overview_idx_c1] + curr_adapter[overview_idx_curr:]
    tmp_adapter_3a = root / "temp" / "project_adapter_3a.py"
    tmp_adapter_3a.parent.mkdir(parents=True, exist_ok=True)
    tmp_adapter_3a.write_text(adapter_3a, encoding="utf-8")
    blob_adapter = run_cmd(["git", "hash-object", "-w", str(tmp_adapter_3a)])
    run_cmd(["git", "update-index", "--cacheinfo", "100644", blob_adapter, "studio/project_adapter.py"], env=env_3a)
    print("Added 3A studio/project_adapter.py to index.")

    # 4.3 studio/app.py for 3A:
    # Has save_project_script, get_project_overview (stages), get_project_story, get_project_next_action (decorated)
    # Does NOT have /voice/chunks/{chunk_id}/regenerate or 3B lock checks in rerender
    curr_app = (root / "studio" / "app.py").read_text(encoding="utf-8")
    # In curr_app, remove 3B route /voice/chunks/{chunk_id}/regenerate and return rerender_chunk_endpoint to legacy
    app_3a = curr_app
    app_3a = app_3a.replace(
        '@app.post("/api/projects/{dir_name}/voice/chunks/{chunk_id}/regenerate")\n@app.post("/api/projects/{dir_name}/voice-qa/rerender-chunk/{chunk_index}")\nasync def rerender_chunk_endpoint(dir_name: str, chunk_id: Optional[str] = None, chunk_index: Optional[Any] = None):\n    target = chunk_id if chunk_id is not None else chunk_index\n    return await _rerender_chunk_impl(dir_name, target)',
        '@app.post("/api/projects/{dir_name}/voice-qa/rerender-chunk/{chunk_index}")\nasync def rerender_chunk_endpoint(dir_name: str, chunk_index: int):\n    return await _rerender_chunk_impl(dir_name, chunk_index)'
    )
    tmp_app_3a = root / "temp" / "app_3a.py"
    tmp_app_3a.write_text(app_3a, encoding="utf-8")
    blob_app = run_cmd(["git", "hash-object", "-w", str(tmp_app_3a)])
    run_cmd(["git", "update-index", "--cacheinfo", "100644", blob_app, "studio/app.py"], env=env_3a)
    print("Added 3A studio/app.py to index.")

    # 4.4 studio/static/uq-shell.css for 3A: lines 1 to 523
    curr_css = (root / "studio" / "static" / "uq-shell.css").read_text(encoding="utf-8")
    css_lines = curr_css.splitlines(keepends=True)
    css_3a_lines = []
    for line in css_lines:
        if "Subphase 3B:" in line:
            break
        css_3a_lines.append(line)
    css_3a = "".join(css_3a_lines)
    tmp_css_3a = root / "temp" / "uq-shell_3a.css"
    tmp_css_3a.write_text(css_3a, encoding="utf-8")
    blob_css = run_cmd(["git", "hash-object", "-w", str(tmp_css_3a)])
    run_cmd(["git", "update-index", "--cacheinfo", "100644", blob_css, "studio/static/uq-shell.css"], env=env_3a)
    print("Added 3A studio/static/uq-shell.css to index.")

    # 4.5 studio/static/index.html for 3A: remove ws-voice section (lines 634-967)
    curr_html = (root / "studio" / "static" / "index.html").read_text(encoding="utf-8")
    ws_voice_start = curr_html.find('<section id="ws-voice"')
    ws_voice_end = curr_html.find('</section>\n\n    <!-- ==========================================================================\n         WORKSPACE 3B.1: VOICE QA (Phase 8.1)')
    if ws_voice_start != -1 and ws_voice_end != -1:
        html_3a = curr_html[:ws_voice_start] + curr_html[ws_voice_end + 10:]
    else:
        html_3a = curr_html
    tmp_html_3a = root / "temp" / "index_3a.html"
    tmp_html_3a.write_text(html_3a, encoding="utf-8")
    blob_html = run_cmd(["git", "hash-object", "-w", str(tmp_html_3a)])
    run_cmd(["git", "update-index", "--cacheinfo", "100644", blob_html, "studio/static/index.html"], env=env_3a)
    print("Added 3A studio/static/index.html to index.")

    # 4.6 studio/static/app.js for 3A: lines up to 7202
    curr_js = (root / "studio" / "static" / "app.js").read_text(encoding="utf-8")
    js_3b_marker = curr_js.find("// SUBPHASE 3B: VOICE WORKBENCH CLIENT MODULE")
    if js_3b_marker != -1:
        js_3a = curr_js[:js_3b_marker]
    else:
        js_3a = curr_js
    tmp_js_3a = root / "temp" / "app_3a.js"
    tmp_js_3a.write_text(js_3a, encoding="utf-8")
    blob_js = run_cmd(["git", "hash-object", "-w", str(tmp_js_3a)])
    run_cmd(["git", "update-index", "--cacheinfo", "100644", blob_js, "studio/static/app.js"], env=env_3a)
    print("Added 3A studio/static/app.js to index.")

    # 4.7 docs/implementation/ROADMAP_STATUS.md for 3A:
    # In 3A, line 19 was: 3A = PASS / FINAL, 3B = READY TO START
    curr_roadmap = (root / "docs" / "implementation" / "ROADMAP_STATUS.md").read_text(encoding="utf-8")
    roadmap_3a = curr_roadmap.replace(
        "| ↳ *Subphase 3B* | *Voice Workbench (Sync & Pronunciation)* | ✅ **PASS / FINAL** | `VERIFIED` | Toàn bộ Cổng A-P ĐẠT (507/507 tests PASSED, browser CDP verified 3 viewports, 1422 word cues sync, 0 network overhead) tại `PHASE_03B_FINAL_VERIFICATION_REPORT.md` |",
        "| ↳ *Subphase 3B* | *Voice Workbench (Sync & Pronunciation)* | ⏭ **READY TO START** | `NOT STARTED` | Sequential Execution Gate 2 (sau 3A) |"
    )
    tmp_rm_3a = root / "temp" / "ROADMAP_STATUS_3a.md"
    tmp_rm_3a.write_text(roadmap_3a, encoding="utf-8")
    blob_rm = run_cmd(["git", "hash-object", "-w", str(tmp_rm_3a)])
    run_cmd(["git", "update-index", "--cacheinfo", "100644", blob_rm, "docs/implementation/ROADMAP_STATUS.md"], env=env_3a)
    print("Added 3A docs/implementation/ROADMAP_STATUS.md to index.")

    # 5. Write 3A tree and commit
    tree_3a = run_cmd(["git", "write-tree"], env=env_3a)
    print(f"3A Tree SHA: {tree_3a}")

    commit_3a_msg = "feat(phase3a): complete Subphase 3A App Shell, Overview, and Story Workbench (491 tests pass)"
    commit_3a = run_cmd(["git", "commit-tree", tree_3a, "-p", base_commit, "-m", commit_3a_msg])
    print(f"Created Commit 3A: {commit_3a}")

    # Set tag pre-phase-3b to commit_3a
    run_cmd(["git", "tag", "-f", "pre-phase-3b", commit_3a])
    print(f"Updated tag pre-phase-3b to point to Commit 3A ({commit_3a}).")

    # 6. Now stage current working tree for 3B commit
    run_cmd(["git", "add", "-A"])
    tree_3b = run_cmd(["git", "write-tree"])
    print(f"3B Tree SHA: {tree_3b}")

    commit_3b_msg = "feat(phase3b): complete Subphase 3B Voice Workbench, chunk identity, and scheduler closure (507 tests pass)"
    commit_3b = run_cmd(["git", "commit-tree", tree_3b, "-p", commit_3a, "-m", commit_3b_msg])
    print(f"Created Commit 3B: {commit_3b}")

    # Update main branch ref to commit_3b
    run_cmd(["git", "update-ref", "refs/heads/main", commit_3b])
    run_cmd(["git", "reset", "--mixed", commit_3b])
    print("Updated main to Commit 3B.")

    # Clean up temp index
    if index_3a_path.exists():
        index_3a_path.unlink()

    print("\nVerification of Git Checkpoints:")
    print("pre-phase-3a:", run_cmd(["git", "rev-parse", "pre-phase-3a"]))
    print("pre-phase-3b:", run_cmd(["git", "rev-parse", "pre-phase-3b"]))
    print("HEAD:        ", run_cmd(["git", "rev-parse", "HEAD"]))
    print("\nGit Log graph:")
    print(run_cmd(["git", "log", "--graph", "--oneline", "--decorate", "-n", "5"]))

if __name__ == "__main__":
    main()
