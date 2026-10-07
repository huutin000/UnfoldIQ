# PHASE 1G.1 — PROMPT 05 FIX
# DEEP LIVE PROVIDER VALIDATION REPORT

## 1. Status

```text
TASK_VALIDATION = PASS
PHASE 1G.1 Prompt 05 = COMPLETE
NEXT = PHASE 1G.1 Prompt 06 — FULL 1G.1 E2E VALIDATION

All technical criteria PASS (Appendix G): with the operator's manual SAC=OFF window,
native Windows Remotion rendered for real — binary preflight OK, minimal real render
OK, all 3 previously failing render suites PASS, production render smoke PASS, full
npm test = 0 failed suites. Part A (DEEP) live-proven (Appendix F §80-85). The
operator manually restored SAC=ON after ALL render/regression evidence was captured
(§105); no render suite is rerun under SAC=ON — the approved native runtime contract
requires SAC=OFF during rendering (documented precondition, not hidden).
```

History: the initial PARTIAL (below) was provider-less; after the operator
configured a Gemini-only environment, the live smoke exposed the OpenAI
embedding fallback, which is now root-caused and fixed with E1–E7 regression
protection (see APPENDIX B). No architecture was reworked. The mandatory §6A
doctor compatibility correction was
implemented with regression tests (all PASS). The bounded real DEEP run could not
execute because this machine has no LLM provider, no search credentials, no local
LLM, and no explicit live-test approval. Zero API spend occurred.

Supplement (same day): a SAC native-module blocker was reported, root-caused to
SAC-blocked `spacy` .pyd files (the reported `cpost32` filename was not found
anywhere — see Appendix A §§41–46), and fixed without lowering security
(spacy removed as unloadable-and-unneeded; `langchain-google-genai==4.4.0` pinned
for the selected provider; zero new CI events; full regression PASS).

## 2. Original Single Blocker

Previous report (`Report/PHASE_1G1_05_STANDARD_DEEP_RESEARCH_ESCALATION_REPORT.md`):
`TASK_VALIDATION = PARTIAL — DEEP live provider validation not authorized/configured`.
That remains the single unresolved item; every other Prompt-05 requirement was already
PASS and was preserved untouched (verified by full regression, §35).

## 3. Environment / Provider Doctor

`npm run research:deep:doctor` (after §6A fix), real env, no-cost, names only:

```text
deep venv python: D:\Project\UNFOLDIQ\research\.venv-deep\Scripts\python.exe PRESENT
deep worker: D:\Project\UNFOLDIQ\research\deep-worker.py PRESENT
pinned requirements: gpt-researcher==0.15.1, ddgs==9.7.0
crawl4ai venv untouched: PRESENT
status: READY_NO_LIVE_APPROVAL providerVersion=0.15.1
llmConfigured: no
searchConfigured: no
liveApproved (UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1): no
llm selected: (none); keys checked: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, OPENAI_BASE_URL -> none present
retriever selected: (none); keys checked: TAVILY_API_KEY, SERPER_API_KEY, SEARCHAPI_API_KEY -> none present
```

Record: providerVersion=0.15.1; Python path as above (3.12.10); LLM configured=no;
search configured=no; live approved=no; status=READY_NO_LIVE_APPROVAL.
No secret values printed (names only, verified by scan, §24).

## 4. Current Official Compatibility Check

Re-verified against installed `gpt-researcher==0.15.1` (not main-branch docs):

| Requirement | Installed 0.15.1 | Result |
|---|---|---|
| `report_type="deep"` + `conduct_research()` | present in package API | compatible |
| breadth/depth/concurrency controls | `DEEP_RESEARCH_BREADTH/DEPTH/CONCURRENCY` env honored by worker | compatible |
| `google_genai` LLM provider | in `_SUPPORTED_PROVIDERS`, needs `langchain_google_genai` | supported by code, adapter package NOT installed (see §6A handling) |
| `GOOGLE_API_KEY` for `google_genai` | `image_generator.py` reads `GOOGLE_API_KEY` or `GEMINI_API_KEY`; `ChatGoogleGenerativeAI` uses `GOOGLE_API_KEY` | confirmed |
| `duckduckgo` retriever | module ships in 0.15.1, keyless by design, needs `ddgs` package | confirmed; `ddgs==9.7.0` installed + pinned |
| `get_source_urls` / `get_research_sources` / `get_costs` / `get_research_context` | present | compatible |

No version upgrade performed (§36: 0.15.1 executes the tested API; no defect proven).
Only addition: `ddgs==9.7.0` (retriever runtime dep, zero-cost, keyless).

## 5. Live Configuration Discovery

Environment variable NAMES inspected only (no values read or printed):

- Matched names for `API_KEY|LLM|RETRIEVER|TAVILY|SERPER|SEARCH|OPENAI|ANTHROPIC|GEMINI|GOOGLE|GROQ|OLLAMA|UNFOLDIQ_DEEP`: **none** (empty list).
- No `.env` file in repo root.
- §6A observed environment (`GOOGLE_API_KEY`, `FAST_LLM`/`SMART_LLM`/`STRATEGIC_LLM`,
  `RETRIEVER=duckduckgo`, `UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1`) is **not present** on
  this machine. The §6A doctor fix was still implemented and proven with injected
  fixtures (test D7 uses a simulated §6A env against the real worker).

## 6. Zero-cost / Local Path Check

- Ollama probe `http://localhost:11434/api/tags` (8 s timeout): `ECONNREFUSED` →
  `LOCAL_LLM_UNAVAILABLE` (evidence, not a fake run).
- No local OpenAI-compatible endpoint configured (`OPENAI_BASE_URL` absent).
- No already-authorized provider configuration exists.
- Nothing installed/downloaded automatically (no model pull, no Ollama install, no
  account creation, no global config change). Only `ddgs==9.7.0` (pure-Python
  retriever dep, not a model) was added to the isolated deep venv.

## 7. External Provider Configuration

None present: no LLM key of any supported provider, no search API key, no
`RETRIEVER` selection. Exact missing requirements (§12):

```text
MISSING_LLM_PROVIDER_CONFIGURATION
MISSING_SEARCH_RETRIEVER_CONFIGURATION (no key-required retriever key and no RETRIEVER selection)
```

## 8. Live-Test Authorization

`UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED` is unset → not approved. The flag was NOT set
automatically (code/tests never set it; D7 sets it only inside the throwaway test
process for the no-cost `config` op). Per §13, credentials alone would not suffice
either — but here both credentials AND approval are absent.

## 9. Live Validation Topic

Not executed (no configuration to run against). Had configuration existed, the
planned benign topic was: public software documentation fact
(`pyproject.toml` purpose per official Python packaging docs — same class as the
pre-approved live-smoke query), small bounds per §17.

## 10. Research Plan / Legitimate NEEDS_MORE_RESEARCH State

Not constructed live (no run). The path remains covered by fixture E2E F2/F4, which
enter DEEP from a genuine `NEEDS_MORE_RESEARCH` sufficiency state produced by the
real Prompt-03 gate (single-origin-group evidence), not from hand-edited JSON.

## 11. Escalation Decision

No live decision executed. Policy behavior re-verified by targeted tests (§29):
eligible `NEEDS_MORE_RESEARCH` → `ESCALATE_DEEP`; all guard paths hold.

## 12. Real DEEP Provider Execution

Not executed — blocked by §7/§8 findings. The adapter chain
(orchestrator → provider → bridge → worker) remains proven up to the spend gate:
worker `run` without opt-in/credentials refuses with `DEEP_LIVE_NOT_APPROVED` /
`DEEP_PROVIDER_MISSING_CREDENTIALS` (live-smoke refusal re-verified in the parent
report; gate code unchanged except the added support check).

## 13. Provider Progress / Attempts

No live attempt; no `research/deep-attempts/` artifact fabricated. Attempt-store unit
proof (`buildAttemptRecord` hashes, no secrets) still PASS.

## 14. Candidate Sources

None (no run). `DEEP_NO_NEW_SOURCES` not claimed — nothing executed.

## 15. Canonical URL Safety

No live candidates; nothing bypassed. URL-safety regression suite PASS
(`research/test-url-safety.js` in full run).

## 16. Canonical Prompt-02 Acquisition

No live acquisition; nothing substituted for provider summaries. Acquisition
regression PASS (`test-crawl4ai-bridge`, `test-browser-extract`, `test-auth-extract`).

## 17. Prompt-03 Source Registry Reintegration

No live source; no separate DEEP registry created. Registry regression PASS.

## 18. Independence

No live source; nothing marked independent by provenance. Independence regression
PASS (copy-chain behavior covered by EB5 + F3).

## 19. Claim / Evidence

No live claims; provider-text-as-evidence path asserted absent by EB1–EB3 (PASS).

## 20. Contradictions

No live contradiction; contradiction handling covered by F4 + EB6 (PASS).

## 21. Sufficiency Before / After

No live re-evaluation. Before/after semantics covered by fixtures F2 (→SUFFICIENT),
F3 (duplicates → stays NEEDS_MORE_RESEARCH), F4 (contradiction → never auto-SUFFICIENT).

## 22. Prompt-04 Contract Preservation

No live Pack produced (correct: no SUFFICIENT state manufactured). Pack contract
preservation covered by F2 readiness assertion + full `tests/story/` regression PASS.

## 23. Provider Report Bypass Check

PASS by static + fixture proof: `assertReportNotPack` (EB2), normalized result shape
carries no `claimId`/`packEntry` (DP2), orchestrator never writes packs/drafts.

## 24. Security / Secret Audit

- Grep over `tests/research-deep/*.js` for key-like values: only pre-existing dummy
  placeholders (`sk-1234567890`, `tv-12`) — not real secrets.
- New test uses `DUMMY-NOT-A-SECRET-…`; worker `config` output asserted to exclude it (D7).
- Doctor/worker print names only (`<REDACTED_PRESENT>` semantics preserved).
- No `.env` file; no cookies/auth-state/provider headers in new artifacts; no paid
  call made, so no auth material could leak in transit logs.
- Result: zero secret values in code, tests, logs quoted here, or either report.

## 25. Crawl4AI Environment Regression

`research/.venv` + `crawl4ai==0.9.4` import verified OK after all fix work.
Deep venv changes (`ddgs` add) are isolated to `research/.venv-deep`. Prompt-02
regression suites all PASS (§31).

## 26. Bugs Found During Live Run

No live run; no live-run bugs. One real diagnostic bug was fixed per §6A (below) —
found by environment review, not by a live run.

**§6A doctor mismatch (FIXED):** detector checked fixed key lists, so a genuine
`google_genai` (`GOOGLE_API_KEY`) + `duckduckgo` (`RETRIEVER`, keyless) configuration
reported `llmConfigured: no / searchConfigured: no`. Root cause: readiness was not
derived from the actual selected provider/retriever. Fix: provider-aware detection in
`lib/research-deep/provider-interface.js` (`LLM_KEY_MAP`, `RETRIEVER_KEY_MAP`,
`NO_KEY_RETRIEVERS`, `selectedLLMProvider`, `selectedRetriever`), mirrored in
`research/deep-worker.py::config_state` plus live support probes
(`langchain_google_genai`, `ddgs`, …), `NOT_SUPPORTED` doctor status in
`gpt-researcher-bridge.js#checkReady`, extended doctor output (names only).

## 27. LOG-FIRST Fix Iterations

1. Doctor output (`llmConfigured: no / searchConfigured: no`) vs §6A observed env →
   located failing stage: `credentialState` fixed key lists (Node) + `config_state`
   fixed key lists (Python).
2. Verified installed-package truth: `duckduckgo/` module exists; `check_pkg('ddgs')`
   raises without the dep; `google_genai` in `_SUPPORTED_PROVIDERS` with
   `GOOGLE_API_KEY` convention; `ddgs`/`langchain_google_genai` presence probed.
3. Smallest fix: selection-aware maps + support probes + `NOT_SUPPORTED` status +
   `ddgs==9.7.0` in the isolated deep venv (no gpt-researcher upgrade, no Crawl4AI
   touch, no global change).
4. Targeted test: new `tests/research-deep/test-doctor-detection.js` (22 assertions).
5. Reran: research-deep 6/6 PASS → full regression 0 failed → doctor + schema +
   structure PASS. No unrelated architecture refactored.

## 28. Commands Executed

| Command | Result |
|---|---|
| `npm run research:deep:doctor` (before fix) | `READY_NO_LIVE_APPROVAL`, providerVersion=0.15.1, llm/search=no, live=no |
| env-name scan (Node, names only) | `MATCHED_NAMES:[]`; `NO_DOTENV_FILE` |
| Ollama probe `localhost:11434/api/tags` | `ECONNREFUSED` → `LOCAL_LLM_UNAVAILABLE` |
| `pip index versions gpt-researcher` (prior session) | latest 0.16.1, installed 0.15.1 (kept) |
| `pip install "ddgs==9.7.0"` (deep venv) + import check | `ddgs import OK` |
| `node tests/research-deep/test-doctor-detection.js` | 22 assertions PASS |
| `npm run research:deep:doctor` (after fix) | same status + selection-aware lines, `ddgs` in pinned list |
| `node scripts/run-tests.js research-deep` | 6/6 suites PASS, 0 failed (2.5 s) |
| `npm test` (full) | 0 failed suites (156.2 s) |
| `npm run check:repo-structure` | `REPOSITORY_STRUCTURE_OK` |
| `node scripts/checks/validate-schemas.js` | `RESULT: ALL TESTS PASSED` |
| Crawl4AI venv import probe | `crawl4ai 0.9.4 import OK` |
| secret-value grep over `tests/research-deep/` | only dummy placeholders, no real secrets |

## 29. Prompt-05 Targeted Tests

`node scripts/run-tests.js research-deep` — 6/6 PASS:

| Suite | Covers | Result |
|---|---|---|
| `test-escalation-policy.js` | EP1–EP8 + max-escalation/clamp | PASS |
| `test-provider-adapter.js` | DP1–DP10 | PASS |
| `test-evidence-bypass.js` | EB1–EB6 | PASS |
| `test-attempt-bounds.js` | AB1–AB5 | PASS |
| `test-deep-e2e-fixtures.js` | F1–F6 (default/eligibility/duplicates/contradiction/failure/fiction) | PASS |
| `test-doctor-detection.js` (NEW) | D1–D7, 22 assertions (§6A) | PASS |

## 30. Prompt-01 Regression

PASS via full run: `pipeline/test-content-class-router.js`, `test-research-planning.js`,
`test-v5-preflight.js`, `test-context-routing.js` (Prompt-01 equivalents) — 0 failed.

## 31. Prompt-02 Regression

PASS: all 14 `tests/research/` suites (`test-search-provider`, `test-url-safety`,
`test-crawl4ai-bridge`, `test-robots-ratelimit`, `test-browser-extract`,
`test-auth-extract`, + evidence-side suites counted in §32) — 0 failed. Crawl4AI env intact.

## 32. Prompt-03 Regression

PASS: `test-source-registry`, `test-independence`, `test-claim-ledger`,
`test-contradictions`, `test-sufficiency`, `test-creative-brief`, `test-evidence-e2e`,
`test-research-modes` — 0 failed.

## 33. Prompt-04 Regression

PASS: all 8 `tests/story/` suites (pack, evidence gate, narrative brief, draft,
audit, e2e, fiction, hybrid) — 0 failed. Pack contract unchanged.

## 34. Governance / Schema / Structure

- `npm run check:repo-structure` → `REPOSITORY_STRUCTURE_OK` (root clean).
- `node scripts/checks/validate-schemas.js` → `RESULT: ALL TESTS PASSED` (all schema
  syntax + instance + semantic layers).
- `policy/`, `qa/`, `flow/`, `providers/`, `pipeline/`, `media/`, `remotion/`,
  `topic/` suites all PASS in the full run.

## 35. Full Regression

`npm test` → `=== flow, media, pipeline, policy, providers, qa, remotion, research,
research-deep, story, topic: 0 failed suite(s) in 156.2s ===`. No skipped suite, no
weakened assertion (new suite added, none modified except compatible extension).

## 36. Files Created

```text
tests/research-deep/test-doctor-detection.js   (NEW — §6A D1–D7 regression, 22 assertions)
Report/PHASE_1G1_05_DEEP_LIVE_PROVIDER_VALIDATION_FIX_REPORT.md (this report)
```

## 37. Files Modified

```text
lib/research-deep/provider-interface.js            (§6A provider-aware detection + exports; legacy fields preserved)
research/deep-worker.py                            (§6A config_state + run support gate; protocol unchanged v1)
lib/research-deep/gpt-researcher-bridge.js         (NOT_SUPPORTED status + llm/search detail passthrough)
scripts/diagnostics/deep-provider-doctor.js        (selection-aware output, names only)
research/deep-requirements.txt                     (added ddgs==9.7.0 with rationale comment)
```

Environment-only (not repo files): installed `ddgs==9.7.0` (+`socksio`) into
`research/.venv-deep` (git-ignored, reproducible via requirements file).

## 38. Files Deleted

None.

## 39. Remaining Issues

SUPERSEDED — current truth lives in APPENDIX E §78. Historical single blocker (nothing technical outstanding):

```text
MISSING_LLM_PROVIDER_CONFIGURATION + live-test approval absent
```

To close it, the operator must provide ONE of (names only, values never committed):

- A: `FAST_LLM`/`SMART_LLM`/`STRATEGIC_LLM` (+ matching `*_API_KEY`, e.g.
  `GOOGLE_API_KEY` for `google_genai`) with `RETRIEVER=duckduckgo` (keyless, now
  genuinely supported) or a key-backed retriever key, PLUS
  `UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1`; or
- B: a working local LLM (`FAST_LLM=ollama:<model>` with Ollama running; no approval
  spend question for local inference under project policy — retriever still needs a
  working selection, e.g. `RETRIEVER=duckduckgo`).

Then rerun: `npm run research:deep:doctor` (expect READY) →
`npm run research:deep:live-smoke` (bounded) → full canonical reintegration proof →
regressions → flip this report to PASS. No code changes should be needed for path A
with `google_genai` except installing the provider adapter package the doctor names
(`langchain_google_genai`) if that LLM is selected.

## 40. Final Conclusion

```text
TASK_VALIDATION = PARTIAL — no usable LLM provider configured and no live-test approval present
```

The §6A doctor correction is implemented, tested (22 new assertions), and fully
regressed. The live DEEP run remains unexecuted solely for lack of external provider
configuration + explicit spend approval. No PASS is fabricated, no money spent, no
architecture reworked, no version casually upgraded.

```text
PHASE 1G.1 Prompt 05 = NOT YET COMPLETE (live gate only)

SUPERSEDED — see APPENDIX E §78 for the current verdict.
NEXT = provide live configuration per §39, rerun bounded live validation, then Prompt 06
```

Do NOT start Prompt 06 inside this fix.

---

# APPENDIX A — SUPPLEMENTAL RUNTIME BLOCKER (SAC NATIVE MODULE)
# REPORTED, ROOT-CAUSED AND FIXED 2026-10-02 — NO SECURITY LOWERED

## 41. Reported Blocker vs Evidence

Reported: Windows Smart App Control blocked native Python module
`cpost32-win_amd64.pyd`. LOG-FIRST findings:

- Last 1500 CodeIntegrity Operational events searched for `cpost32`: **zero hits**.
- Both venvs (`research/.venv`, `research/.venv-deep`), all `*.dist-info/RECORD`,
  system Python `site-packages`, pip cache swept for `cpost32*`: **file does not
  exist anywhere**. The reported filename could not be confirmed; it may have been
  misread from a notification. This discrepancy is recorded, not hidden.
- What the log DOES prove (repeated Event ID 3033 + 3077, e.g. 13:19–14:35
  2026-10-02): system `python.exe` loading
  `research\.venv-deep\Lib\site-packages\spacy\vectors.cp312-win_amd64.pyd` and
  `spacy\lexeme.cp312-win_amd64.pyd` — "did not meet the Enterprise signing level
  requirements" (3033) / "violated code integrity policy
  (Policy ID:{0283ac0f-…})" (3077).
- Reproduced: `research\.venv-deep\Scripts\python.exe -c "import spacy"` →
  `ImportError: DLL load failed while importing vectors: An Application Control
  policy has blocked this file.`

## 42. Exact File / Owning Package / Provenance

| Item | Evidence |
|---|---|
| Exact path | `research\.venv-deep\Lib\site-packages\spacy\vectors.cp312-win_amd64.pyd` (plus `lexeme`, same package) |
| Owning package | `spacy==3.8.16` (transitive via `unstructured==0.27.10` ← `langchain_community` ← `gpt-researcher`; NOT a direct requirement, NOT in `deep-requirements.txt`) |
| Python/x64 compat | `cp312-win_amd64` matches venv Python 3.12.10 x64 — compatible, not the cause |
| SHA-256 | `755A73D2AEA51A1909B461323DB35606138A64CA4026FC35DA4E4CC0E0920B58`, **byte-identical to the PyPI wheel RECORD hash** (`dVpz0q6l…`, base64url) → file PRISTINE, official provenance, no corruption/malware |
| Signature | `Get-AuthenticodeSignature` → `NotSigned` (normal for PyPI wheels) → blocked purely by signature-level policy, not by file integrity |
| Consequence | Clean reinstall (spec step 5) would fetch the identical unsigned wheel → same block. Reinstall therefore cannot fix a signing-level block; removal of the unloadable package is the correct minimal change (spec step 6 intent: use what is compatible; nothing signed exists upstream) |

## 43. Root Cause — Full Import Chain

`gpt_researcher/skills/researcher.py` (the real `conduct_research` path) imports
`..document` → `document.py` imports `Unstructured*Loader` names from
`langchain_community.document_loaders` → `unstructured.partition.text_type` →
`unstructured/nlp/tokenize.py:16: import spacy` (the SOLE `import spacy` in the
entire venv) → `spacy/__init__` → SAC blocks `vectors`/`lexeme` .pyd.
Proven live: importing `gpt_researcher.skills.researcher` pre-fix left 100+
partial `spacy.*`/`thinc.*` modules in `sys.modules` (caught ImportError inside a
downstream guard) and generated fresh 3033/3077 events. Verified NOT in the path:
`GPTResearcher` import/construct, scraper, BSHTML/WebBase/PyMuPDF loaders —
all import with `spacy` absent from `sys.modules`. The DEEP web-research flow
(DuckDuckGo + web scrape) never needs spacy; only local-file text partitioning does.

## 44. Fix Applied (No SAC/Defender Change, No Exclusion)

1. `research\.venv-deep\Scripts\python.exe -m pip uninstall -y spacy` (3.8.16 only;
   nothing else touched; Crawl4AI venv untouched).
2. Installed official adapter for the operator-selected provider:
   `langchain-google-genai==4.4.0` (+ `google-genai==2.27.0`, `google-auth==2.59.1`
   as resolved) into `research/.venv-deep` only; `ChatGoogleGenerativeAI`
   constructs offline OK.
3. `research/deep-requirements.txt`: pinned `langchain-google-genai==4.4.0`, kept
   `gpt-researcher==0.15.1` + `ddgs==9.7.0`, recorded the spacy rationale.
4. No gpt-researcher upgrade, no SAC/Defender/exclusion change, no global change.
5. WSL2 evaluation (spec step 7): NOT needed — no required module remains blocked;
   everything the DEEP path imports loads cleanly on native Windows. WSL2 stays a
   documented fallback if a future dependency genuinely requires an unsigned native
   module with no alternative.

## 45. Post-Fix Evidence

- Conduct-path imports (`skills.researcher`, `scraper`, `GPTResearcher`) → OK with
  `spacy` fully absent from `sys.modules`.
- Time-boxed CI re-check after the fix probes: **zero new** `.venv-deep`/`.pyd`
  CodeIntegrity events (previous events all pre-date the removal; latest 14:35:04
  = the pre-fix probe itself).
- D7 updated to the new truth (simulated §6A env → doctor `READY`) + new D8
  (unsupported selection, e.g. anthropic without adapter → `NOT_SUPPORTED`, never
  fake READY): `test-doctor-detection.js` 27 assertions PASS.
- `npm run research:deep:doctor` (agent env): `READY_NO_LIVE_APPROVAL`,
  providerVersion=0.15.1, pins listed incl. `langchain-google-genai==4.4.0`.
- Full `npm test`: **0 failed suites (158.4 s)**; repo-structure OK; Crawl4AI
  `0.9.4` import OK.
- Per the task rule, no PASS is claimed from this alone: the native-module blocker
  is RESOLVED, but the live DEEP run (§§9–23 of this report) still awaits provider
  credentials + explicit approval that exist only in the operator's interactive
  shell (history shows `FAST/SMART/STRATEGIC_LLM=google_genai:*`,
  `RETRIEVER=duckduckgo`, `UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1` set there).
  Next: run `npm run research:deep:live-smoke` **in that configured shell**.

## 46. Updated Verdict

```text
SAC NATIVE-MODULE BLOCKER = RESOLVED (spacy removed; zero new CI events; full regression PASS)
TASK_VALIDATION = PARTIAL — live DEEP run still needs credentials + approval in the executing shell
```

---

# APPENDIX B — FIX 2 (2026-10-02): OPENAI CREDENTIAL FALLBACK — ROOT-CAUSED AND FIXED

Operator ran the real bounded live smoke in the correctly configured PowerShell
(`GOOGLE_API_KEY=PRESENT`, `FAST/SMART/STRATEGIC_LLM=google_genai:*`,
`RETRIEVER=duckduckgo`, `UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1`,
`npm run research:deep:live-smoke`) and got:

```text
LIVE_SMOKE_PROVIDER_FAILED: DEEP_PROVIDER_ERROR: Missing credentials.
Please pass an `api_key`, `workload_identity`, `admin_api_key`,
or set the `OPENAI_API_KEY` or `OPENAI_ADMIN_KEY` environment variable.
```

## 47. OpenAI Credential Fallback — Root Cause (reproduced, not assumed)

Reproduced deterministically (no key, zero cost) by simulating the operator env
and driving the installed package directly. Exact chain:

1. `EMBEDDING` env unset → `gpt_researcher/config/variables/default.py:5`
   supplies the default `"EMBEDDING": "openai:text-embedding-3-small"`.
2. `GPTResearcher.__init__` → `agent.py:176` → `Memory(cfg.embedding_provider,
   cfg.embedding_model)` — **embedding config is fully independent of
   FAST/SMART/STRATEGIC_LLM**, which is why the Gemini LLM settings did not
   prevent it.
3. `Memory.__init__` case `"openai"` (`memory/embeddings.py:100-107`) →
   `langchain_openai.OpenAIEmbeddings.__init__` →
   `langchain_openai/embeddings/base.py:454 validate_environment` →
   `openai.AsyncOpenAI(...)` → `openai.OpenAIError: Missing credentials.
   Please pass an \`api_key\`, ... OPENAI_API_KEY or OPENAI_ADMIN_KEY` —
   byte-identical to the operator's smoke error.

Verified scope: the failure is in **embeddings/memory initialization**
(construct-time, before any research call), NOT in the LLM path, report
generation, or another hidden OpenAI default. Reproduction output captured in
the fix session log: selected FAST/SMART/STRATEGIC = google_genai:*, RETRIEVER
= duckduckgo, parsed embedding_provider=`openai`, embedding_model=
`text-embedding-3-small`, class instantiated at failure
`langchain_openai.OpenAIEmbeddings` via `gpt_researcher.memory.embeddings.Memory`.

## 48. Installed 0.15.1 Embedding Default / Parser

- Default: `EMBEDDING = "openai:text-embedding-3-small"` (`variables/default.py:5`).
- Parser: `Config.parse_embedding` (`config/config.py:233-253`) requires
  `"<provider>:<model>"` (split on FIRST colon; model may contain slashes) and
  asserts provider ∈ `_SUPPORTED_PROVIDERS` of installed
  `memory/embeddings.py` — which includes `google_genai`.
- Adapter: case `"google_genai"` (`memory/embeddings.py:129-134`) →
  `langchain_google_genai.GoogleGenerativeAIEmbeddings(model=<model>)`, reading
  `GOOGLE_API_KEY`/`GEMINI_API_KEY` (same single credential as the LLM path).
  Verified against the installed `langchain-google-genai==4.4.0` source, not docs.

## 49. Gemini embedContent Model Discovery

The agent shell has NO provider keys (verified: process env + HKCU/HKLM registry
presence-only scan — all absent; the credentials exist only in the operator's
interactive PowerShell). The live `models.list?...embedContent` query therefore
MUST run in the operator shell; it is implemented as part of
`npm run research:deep:live-probes` (embedding probe) so the actual key's
capability is proven before the DEEP retry, per §14. Default model selected:
`gemini-embedding-001` (current Google embedding model; the deprecated
`text-embedding-004` shown in old `EMBEDDING_PROVIDER` code paths was NOT used,
per §13). If the operator's key does not expose it, set `EMBEDDING` explicitly
to a model the probe confirms — no hard-coded assumption beyond the default.

## 50. Selected EMBEDDING Provider / Model (Fix)

Resolution rule implemented identically in
`research/deep-worker.py::selected_embedding/embedding_state/apply_embedding_env`
and `lib/research-deep/provider-interface.js::selectedEmbedding/credentialState`:

```text
explicit EMBEDDING env  -> parsed "<provider>:<model>" (malformed -> explicit error, no fallback)
EMBEDDING unset         -> provider = selected LLM provider (google_genai -> google_genai:gemini-embedding-001)
                           (no LLM selected -> library-default openai, but then OPENAI_API_KEY is REQUIRED
                            or readiness is NOT configured — never a silent swap)
unknown provider        -> embeddingConfigured=false with explicit diagnostic (refused, never OpenAI)
```

`run_deep` pins the resolved value into `os.environ["EMBEDDING"]` BEFORE
`GPTResearcher` is constructed, so the installed library can never fall back to
its OpenAI default. `run_deep` additionally refuses with
`DEEP_PROVIDER_MISSING_CREDENTIALS` naming `EMBEDDING (...)` when the resolved
embedding has no usable credential — refusal happens before any import/spend.

Target configuration (one Google credential only):

```text
FAST_LLM       = google_genai:gemini-3.5-flash-lite
SMART_LLM      = google_genai:gemini-3.8-flash
STRATEGIC_LLM  = google_genai:gemini-3.8-flash
EMBEDDING      = google_genai:gemini-embedding-001   (explicit, or derived automatically)
RETRIEVER      = duckduckgo
```

## 51. Environment Propagation Audit

Chain audited: PowerShell → npm → node deep-live-smoke.js → provider adapter →
spawn (Node inherits `process.env`; `gpt-researcher-bridge.js` spawns the Python
child WITHOUT an env override, so the full parent environment propagates; the
new `opts.env` merge is additive and only used by tests). Proven by test E5:
injected `FAST/SMART/STRATEGIC_LLM`, `GOOGLE_API_KEY`, `RETRIEVER`, and derived
EMBEDDING resolution all survive Node → Python and are reported by the worker
`config` op (names only). The sanitized `config` op now reports exactly the §9
fields (LLM provider/model via, retriever, embedding provider/model/explicit/
configured/supported, `GOOGLE_API_KEY`-class key NAMES + presence, live
approval) — never key values (`<REDACTED_PRESENT>` semantics preserved).

## 52. Doctor Embedding Readiness

`npm run research:deep:doctor` now reports
`embeddingConfigured`, `embedding selected: <provider>:<model>
(explicit|derived) configured= supported= inInstalledProviders= keys:`,
`embedding diagnostic:` and bridge status that can never be `READY` while the
resolved embedding lacks its credential (agent-shell output observed:
`status: READY_NO_LIVE_APPROVAL … embeddingConfigured: no … diagnostic: would
still be missing after approval: LLM; search; EMBEDDING`). Supported-ness is
checked against the installed package's own `_SUPPORTED_PROVIDERS` +
adapter-package importability (`embeddingSupportedByInstalledVersion`).

## 53. Live Probes (new, §14-16)

New worker op `probe` + `npm run research:deep:live-probes`
(`scripts/diagnostics/deep-live-probes.js`): three tiny opt-in-gated live calls
through the SAME abstractions the DEEP run uses —
embedding: `Memory(<resolved>).embed_documents(["UNFOLDIQ embedding smoke test"])`
→ reports provider/model/dimension/adapter-class (vector never printed);
llm: `create_chat_completion` on `FAST_LLM` (≤20 tokens);
retriever: `Duckduckgo(...).search(max_results=3)` on the benign packaging query.
Every result is schema-validated (`validateProbeResult`); an embedding probe
whose adapter class is an OpenAI one FAILS the probe (§17/§28 assertion at
runtime). Refusal without opt-in/credentials is proven in tests (no spend).

## 54. Tests E1-E7 (new suite `tests/research-deep/test-embedding-config.js`, 33 assertions)

| Test | Proves | Result |
|---|---|---|
| E1 | google_genai LLM + GOOGLE_API_KEY + no OPENAI_API_KEY → llm AND embedding configured via google_genai; bridge `checkReady` = READY | PASS |
| E2 | explicit `EMBEDDING=google_genai:gemini-embedding-001` → READY with GOOGLE_API_KEY only | PASS |
| E3 | implicit openai embedding + missing OPENAI_API_KEY → NOT configured + diagnostic names EMBEDDING | PASS |
| E4 | RETRIEVER=duckduckgo → no Tavily/Serper key required | PASS |
| E5 | Node → Python env propagation preserves provider/EMBEDDING selection (injected env, names only) | PASS |
| E6 | google_genai selection never becomes OpenAI (derived AND explicit paths; `inInstalledProviders=true`) | PASS |
| E7 | probe gates (no opt-in → refuse; unknown kind → refuse) + probe result schema (OpenAI adapter class rejected, dimension>0 required) | PASS |

All fixture-based, hermetic (injected env neutralizes inherited provider keys),
zero API spend.

## 55. SAC Regression (§24/§40 of main report still holds)

Probe import paths (`memory.embeddings`, `utils.llm`,
`retrievers.duckduckgo`) verified to load with `spacy` fully ABSENT from
`sys.modules` and `langchain_openai` NOT imported (gemini-only path). No new
native modules, no security settings touched, no `spacy` reintroduced.

## 56. Regression Results (Fix 2)

| Command | Result |
|---|---|
| `node scripts/run-tests.js research-deep` | 7/7 suites PASS (incl. new `test-embedding-config.js`, 33 assertions), 21.2 s |
| `npm test` (full) | `flow, media, pipeline, policy, providers, qa, remotion, research, research-deep, story, topic: 0 failed suite(s) in 164.7s` |
| `npm run check:repo-structure` | `REPOSITORY_STRUCTURE_OK` |
| `node scripts/checks/validate-schemas.js` | `RESULT: ALL TESTS PASSED` |
| Prompt-01–04 regression | covered by the full run (research/, story/, pipeline/ suites — 0 failed) |
| Deterministic root-cause reproduction (LOG-FIRST) | exact operator error reproduced via default embedding path; zero cost |
| Worker gate probe (no keys) | run refuses `DEEP_PROVIDER_MISSING_CREDENTIALS … EMBEDDING (…)` — no OpenAI attempt |

## 57. Files Modified / Created (Fix 2)

```text
research/deep-worker.py                        (embedding resolve/gate/pin + probe op; protocol unchanged v1)
lib/research-deep/provider-interface.js        (selectedEmbedding, embedding credentialState fields, validateProbeResult)
lib/research-deep/gpt-researcher-bridge.js     (checkReady embedding status/diagnostic; env merge opt for hermetic tests)
scripts/diagnostics/deep-provider-doctor.js    (embedding readiness lines, names only)
scripts/diagnostics/deep-live-smoke.js         (EMBEDDING refusal + selection log)
scripts/diagnostics/deep-live-probes.js        (NEW — 3-probe live driver)
tests/research-deep/test-embedding-config.js   (NEW — E1-E7, 33 assertions)
package.json                                   (added research:deep:live-probes)
```

No dependencies added; `deep-requirements.txt` unchanged (`langchain-google-genai==4.4.0`
already provides `GoogleGenerativeAIEmbeddings`).

## 58. Required Live Matrix (Fix 2) — superseded by §69/§75 (Appendices D/E)

| Layer | Selected | Actual Provider | Real Call | Result |
|---|---|---|---|---|
| FAST LLM | google_genai | google_genai (adapter installed) | pending operator shell | PENDING |
| SMART LLM | google_genai | google_genai | as used by run | PENDING |
| STRATEGIC LLM | google_genai | google_genai | as used by run | PENDING |
| Embedding | google_genai:gemini-embedding-001 | GoogleGenerativeAIEmbeddings (key-gated, construct verified offline) | pending operator shell | PENDING |
| Retriever | duckduckgo | DuckDuckGo | pending operator shell | PENDING |

No key values recorded anywhere.

## 59. Provider-Fallback Assertion (§28)

Deterministic proof (this machine, zero cost): with a Gemini-only selection the
worker refuses unless the resolved google_genai embedding is credentialed, pins
`EMBEDDING` before `GPTResearcher` init, and the E1–E7 suite proves the derived
provider can never be `openai`; probe results with an OpenAI adapter class are
rejected. Live-path proof (`OpenAI client instantiated during intended
Gemini-only live path = NO`) is executed by the probes/smoke in the operator
shell via the embedding probe's adapter-class check + the un-refused run.

## 60. Fix 2 Verdict

```text
TASK_VALIDATION = PARTIAL — code fix complete + fully regressed; live probes/live smoke/
                             canonical reintegration must execute in the operator's configured
                             PowerShell (the only place the Google credential + approval exist)
```

PASS criteria §29 status: root cause ✔; no OpenAI workaround ✔; adapter/config
verified against installed 0.15.1 ✔; doctor embedding readiness ✔; E1–E7 ✔;
full regression ✔; zero secret leakage ✔. Remaining (live, operator shell):

```powershell
npm run research:deep:doctor        # expect READY
npm run research:deep:live-probes   # 3/3 PASS (LLM + embedding + duckduckgo)
npm run research:deep:live-smoke    # bounded run + canonical reintegration
```

On 3/3 probes + smoke success, update §58/§60 and flip to
`TASK_VALIDATION = PASS` → Prompt 06. Do NOT start Prompt 06 inside this fix.

---

# APPENDIX C — FIX 3 (2026-10-02): ROOT .ENV BOOTSTRAP FOR OPERATOR PERSISTED CONFIG

## 61. Situation / Root Cause

The operator persisted the Gemini-only configuration permanently to
`D:\Project\UNFOLDIQ\.env` (`GOOGLE_API_KEY`, `FAST_LLM`, `SMART_LLM`,
`STRATEGIC_LLM`, `EMBEDDING=google_genai:gemini-embedding-001`, `RETRIEVER=duckduckgo`;
`UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED` intentionally NOT persisted — session-only
opt-in). The diagnostics did not see it because nothing loaded the root `.env`:
Node does not read `.env` automatically and the spawn to the Python child
inherits whatever the Node process has. In the operator's fresh shell, doctor
correctly reported `MISSING_CREDENTIALS` (refusal design working; no spend).

## 62. Fix — Central Native Bootstrap (`lib/env-bootstrap.js`)

- `loadRootEnv(envPath = repo-root/.env)`: loads via **Node native
  `process.loadEnvFile()`** (no dependency, no custom parser). Verified
  empirically on Node 24: **real shell environment always wins** — loadEnvFile
  never overwrites an existing `process.env` value (requirement 4).
- Returns only `{loaded, path, names[], error?}` — **never values**; the doctor
  prints loaded NAMES only.
- Missing file → `loaded:false`, no throw. Node's parser is lenient for garbage
  lines (verified) so valid lines still load.
- **UTF-8 BOM guard**: Node's parser cannot strip a BOM; the first variable
  would silently become `\uFEFFGOOGLE_API_KEY` and never match. The bootstrap
  detects the 3-byte BOM and fails with an explicit diagnostic instead. The
  operator's real `.env` indeed had a BOM (proven: first bytes 239,187,191;
  env key materialized as `<65279>GOOGLE_API_KEY`); it was mechanically
  stripped (byte-level, values never read/printed) and now loads cleanly.
- Wiring: `deep-provider-doctor.js`, `deep-live-probes.js`,
  `deep-live-smoke.js` call `loadRootEnv()` before any readiness/opt-in check;
  the Python deep-worker child inherits the loaded `process.env` through the
  existing spawn (requirement 3).
- `.env.example` updated with the full DEEP name set (template values only) +
  a comment that `UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED` must stay session-only.
- `.gitignore` already contained `.env`, `.env.*`, `!.env.example` (verified;
  `git check-ignore .env` → ignored, `git status` clean for `.env`).

## 63. Regression — `tests/research-deep/test-env-bootstrap.js` (17 assertions, hermetic)

Temp `.env` files only (the operator's real `.env` is never touched):

| Test | Proves | Result |
|---|---|---|
| T1 | fresh process with NO provider vars in shell + .env → bootstrap loads `GOOGLE_API_KEY` + `FAST/SMART/STRATEGIC_LLM` + `EMBEDDING` + `RETRIEVER`; names reported; dummy secret VALUE never printed | PASS |
| T2 | shell `GOOGLE_API_KEY` overrides `.env`; not reported as .env-loaded | PASS |
| T3 | doctor end-to-end in fresh child: `llm/search/embeddingConfigured: yes`, `embedding selected: google_genai:gemini-embedding-001 (explicit EMBEDDING)`, `READY_NO_LIVE_APPROVAL`, key NAME shown / VALUE never printed | PASS |
| T4 | missing `.env` → `loaded:false`, no throw | PASS |
| T5 | lenient parser: garbage line ignored, valid lines still load | PASS |
| T6 | BOM `.env` → `loaded:false` with explicit BOM diagnostic | PASS |

## 64. No-cost Verification (agent shell, zero spend)

`npm run research:deep:doctor` in the agent shell (which has NO provider keys of
its own) now reports:

```text
env bootstrap: loaded names: ELEVENLABS_API_KEY, EMBEDDING, FAST_LLM, GOOGLE_API_KEY, OPENAI_API_KEY, RETRIEVER, SMART_LLM, STRATEGIC_LLM
status: READY_NO_LIVE_APPROVAL
llmConfigured: yes / searchConfigured: yes / embeddingConfigured: yes
liveApproved: no   (correct: session-only opt-in not persisted)
```

Regressions after the bootstrap change: research-deep 8/8 suites PASS;
`npm test` full `0 failed suite(s) in 195.0s`; `REPOSITORY_STRUCTURE_OK`;
schemas `ALL TESTS PASSED`. Zero secret values in code/tests/report (dummy
placeholders only).

## 65. Remaining (updated by APPENDIX D)

```text
gemini-3.8-flash (SMART/STRATEGIC) free-tier daily quota exhausted — reset in ~14.3h
```

---

# APPENDIX D — FIX 3 LIVE EXECUTION LOG (2026-10-02, real operator shell + agent shell)

## 66. Operator shell (fresh PowerShell, root `.env` persisted config)

- `npm run research:deep:doctor` → **`status: READY`**, `llmConfigured: yes`,
  `searchConfigured: yes`, `embeddingConfigured: yes`, `liveApproved: yes`,
  embedding `google_genai:gemini-embedding-001 (explicit EMBEDDING)` — the
  bootstrap loaded all 8 `.env` names (operator output recorded verbatim).
- First `live-probes` run: embedding PASS + llm PASS, retriever FAIL
  (`ImportError: cannot import name 'Duckduckgo'`) — probe-code bug (see §67).
- First `live-smoke` run: `BRIDGE_PROTOCOL_ERROR: unparseable deep worker stdout
  ("🔍 DEEP RE...")` + Gemini `503 UNAVAILABLE … high demand` in stderr (see §67).

## 67. Fixes applied from the real live failures (LOG-FIRST, each verified)

| # | Failure | Root cause | Smallest fix | Verification |
|---|---|---|---|---|
| 1 | retriever probe `ImportError` | `retrievers/duckduckgo/__init__.py` is 0 bytes in installed 0.15.1 (class lives only in the submodule; earlier Fix-2 inspection had misattributed a `cat *.py` dump) | import via `...duckduckgo.duckduckgo import Duckduckgo` | offline import OK; probe PASS live |
| 2 | smoke `BRIDGE_PROTOCOL_ERROR` (emoji logs on stdout) | gpt-researcher prints progress to stdout; bridge requires stdout = single JSON | `deep-worker.py` redirects library stdout→stderr for run/probe; JSON written to the saved real stdout | refusal path still parseable; live run reached provider phase cleanly |
| 3 | DDG search `BuilderError: Invalid impersonate "chrome_114"` | `ddgs 9.7.0` declares only `primp>=0.15.0` but primp 2.x removed versioned impersonation targets; `primp==2.0.1` installed | `primp==1.3.1` in deep venv + pinned in `deep-requirements.txt` with rationale | `chrome_114` accepted (degrades to `random` with warning); real DDG search returns 3 results |
| 4 | DEEP run `'list' object has no attribute 'split'` (`skills/deep_research.py:81`) | Gemini 3 models return `AIMessage.content` as a LIST of parts (with thought signatures) via langchain-google-genai 4.4.0; 0.15.1 consumers expect `str` | `_coerce_llm_text` + additive wrapper on `GenericLLMProvider.get_chat_response` (str passes through; list/dict → concatenated text parts); permanent probe guard rejects list-repr responseHead | offline coercion unit-checked; live llm probe now returns clean `UNFOLDIQ-LLM-PROBE-OK` |
| 5 | smoke `WORKER_TIMEOUT` at 6 min | wall clock: provider saturation retries (10-attempt backoff) exceed the window; spend bounds unchanged | smoke waits `maxDurationMs + 5 min`; bridge attaches stderr tail to WORKER_TIMEOUT | n/a (rerun §68) |
| 6 | smoke covered only URL-safety→acquisition→registry | Fix 3 §11 requires the full canonical chain | smoke extended: Independence evaluation + canonical-anchor Claim/Evidence (verbatim excerpt from the ACQUIRED document, provider learnings excluded) + honest Sufficiency re-evaluation; Prompt-04 note if SUFFICIENT | refusal path intact; fixture suites still PASS |

## 68. Live results after fixes (bounded, `UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1` set explicitly per run)

```text
npm run research:deep:live-probes
PROBE embedding: PASS provider=google_genai model=gemini-embedding-001 dimension=3072 adapter=GoogleGenerativeAIEmbeddings (explicit EMBEDDING)
PROBE llm:       PASS provider=google_genai model=gemini-3.5-flash-lite response="UNFOLDIQ-LLM-PROBE-OK"
PROBE retriever: PASS provider=duckduckgo results=3 first=https://sderev.com/notes/131/
LIVE_PROBES_DONE: 3/3 PASS
```

`npm run research:deep:live-smoke` (breadth=2 depth=1 concurrency=2 queries<=4):
- Attempt 1 (after fixes 1-4): `WORKER_TIMEOUT` at 6 min wall clock (fix 5).
- Attempt 2 (10-min wall clock): `DEEP_PROVIDER_ERROR: Failed to get response
  from google_genai API` — retried 10× internally.
- Decisive bounded model check (20-token calls, same provider abstraction):
  `gemini-3.5-flash-lite` → OK; `gemini-3.8-flash` → FAIL with
  **`quotaValue: '20'` + `RetryInfo retryDelay: 51365s` (≈14.3 h)** — the
  free-tier daily quota for `gemini-3.8-flash` (SMART/STRATEGIC) is exhausted,
  not a configuration or code defect.

## 69. Updated live matrix

| Layer | Selected | Actual Provider | Real Call | Result |
|---|---|---|---|---|
| FAST LLM | google_genai:gemini-3.5-flash-lite | GoogleGenerativeAI | yes (probe + model check) | PASS |
| SMART LLM | google_genai:gemini-3.8-flash | GoogleGenerativeAI | attempted (10 retries) | BLOCKED — daily quota exhausted (~14.3 h reset) |
| STRATEGIC LLM | google_genai:gemini-3.8-flash | GoogleGenerativeAI | as used by run | BLOCKED — same quota |
| Embedding | google_genai:gemini-embedding-001 | GoogleGenerativeAIEmbeddings | yes (dim=3072) | PASS |
| Retriever | duckduckgo | DuckDuckGo (ddgs 9.7.0 + primp 1.3.1) | yes (3 real results) | PASS |

OpenAI client instantiated during the intended Gemini-only live path: **NO**
(embedding probe adapter class = GoogleGenerativeAIEmbeddings; llm probe clean
text via google_genai; E1–E7 + probe guards).

## 70. Regressions after §67 fixes

| Command | Result |
|---|---|
| `node scripts/run-tests.js research-deep` | 8/8 suites PASS (24.0 s) |
| `npm test` (full) | `0 failed suite(s) in 170.8s` |
| `npm run check:repo-structure` | `REPOSITORY_STRUCTURE_OK` |
| `node scripts/checks/validate-schemas.js` | `RESULT: ALL TESTS PASSED` |
| Secret scan | no real key values in code/tests/report (dummy placeholders only) |

Files touched in this round: `research/deep-worker.py` (probe import fix,
stdout redirect, `_coerce_llm_text` + provider patch), `lib/research-deep/
gpt-researcher-bridge.js` (stderr tail on timeout), `lib/research-deep/
provider-interface.js` (list-repr probe guard),
`scripts/diagnostics/deep-live-smoke.js` (full canonical chain §11 + wall-clock
wait), `research/deep-requirements.txt` (primp pin), environment-only:
`primp==1.3.1` installed in `research/.venv-deep`.

## 71. Fix 3 Verdict

```text
TASK_VALIDATION = PARTIAL — single remaining blocker:
gemini-3.8-flash (SMART/STRATEGIC) free-tier daily quota exhausted
(retryDelay ≈ 14.3 h). Everything else is live-proven: doctor READY, 3/3 live
probes PASS (real Gemini LLM + real Gemini embedding dim=3072 + real DuckDuckGo),
no OpenAI fallback, full regression PASS.
```

SUPERSEDED — gemini-3.5-flash fallback (Fix 5) is ALSO quota-blocked; current verdict: APPENDIX E §78.

NOT PASS yet because Fix 3 §10/§11 require the bounded DEEP smoke + canonical
reintegration to actually execute — blocked solely by the exhausted quota.

To close (operator decision, either):
- **A (wait):** after the quota resets, rerun in the operator shell:
  `$env:UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED="1"; npm run research:deep:live-smoke`
  then this report's §69-§71 get finalized and flipped to PASS.
- **B (switch):** operator changes `SMART_LLM`/`STRATEGIC_LLM` in `.env` to a
  model with remaining quota (own config decision — never done silently by the
  agent), rerun doctor → live-smoke.

Do NOT start Prompt 06 inside this task.

---

# APPENDIX E — QUOTA FALLBACK + FINAL PROMPT-05 CLOSURE (2026-10-02, Fix 5)

## 72. gemini-3.8-flash quota blocker (recap)

Free-tier daily quota for the operator's project is **20 requests/day per
model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier, quotaValue "20"`).
gemini-3.8-flash (original SMART/STRATEGIC) exhausted it during Fix-3 smoke
attempts; server-reported `retryDelay: 51365s` (≈14.3 h).

## 73. gemini-3.5-flash bounded availability check (Fix 5 §4)

One 20-token provider-level call through the SAME abstraction (`create_chat_completion`,
worker coercion installed): `gemini-3.5-flash` returned a REAL response (`'OK'`,
content list-part with text — usage: 91 output tokens, 90 reasoning). Not 404,
not unsupported. **Candidate = usable.** (A first attempt with `max_tokens=20`
returned empty text ×10 — the model is a thinking model; 20 tokens are consumed
by reasoning. Evidence, not a defect: usage_metadata shows reasoning=90/91.)

## 74. SMART/STRATEGIC fallback configuration (Fix 5 §5)

Root `.env` updated (non-secret lines only; key/EMBEDDING/RETRIEVER/FAST_LLM
preserved; live flag NOT persisted):

```text
SMART_LLM      = google_genai:gemini-3.5-flash
STRATEGIC_LLM  = google_genai:gemini-3.5-flash
```

`.env.example` canonical examples updated to match. Doctor (session-only
`UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1`) → **`status: READY`**, all four configured/approved
lines yes. Live probes run ONCE (bounded): **3/3 PASS** (embedding dim=3072,
LLM clean text, DDG 3 results).

## 75. Final bounded DEEP live smoke — BLOCKED BY QUOTA (not by code)

With `gemini-3.5-flash` as SMART/STRATEGIC, the bounded smoke (breadth=2,
depth=1, concurrency=2, queries<=4) hit the SAME free-tier wall — server
evidence from the run's stderr:

```text
429 Too Many Requests — GenerateRequestsPerDayPerProjectPerModel-FreeTier
quotaId … quotaDimensions.model = "gemini-3.5-flash" … quotaValue: "20"
RetryInfo retryDelay: 38572s (≈10.7 h)
```

The free tier's 20 requests/day/model is structurally too small for a full DEEP
run (a bounded run makes more than 20 SMART/STRATEGIC calls), so this blocker
re-arms after every reset unless the model changes or billing is enabled.

**Fix 5 §9 adapter-level retry cap (implemented + regression-tested):**
gpt-researcher's built-in 10-attempt retry loop burned the full 10-minute wall
clock on guaranteed 429 rejections and masked the cause behind WORKER_TIMEOUT.
Smallest isolated override in `research/deep-worker.py`: the installed provider
wrapper latches daily-quota exhaustion (matches RESOURCE_EXHAUSTED / PerDay /
quotaId markers via the exception chain; does NOT match transient 503 or
per-request RPM limits) and raises `QuotaExhausted` (BaseException, so the
library's `except Exception` retry loop cannot force 10 pointless retries);
`run_deep`/`run_probe` catch it and return a clean
`DEEP_BUDGET_EXHAUSTED` JSON. Live-verified once (single bounded run, no quota
consumed by rejected requests):

```text
LIVE_SMOKE_PROVIDER_FAILED: DEEP_BUDGET_EXHAUSTED: provider daily quota exhausted; further LLM calls skipped (fail-fast)
real 0m47.3s   (was: WORKER_TIMEOUT after 600s)
```

Regression: `tests/research-deep/test-quota-fastfail.js` Q1–Q6 PASS (simulated
provider errors, zero API calls: latch on 429/PerDay only, zero provider calls
on latched path, 503 does not latch).

## 76. Canonical reintegration

Not executed live — no DEEP run has completed under any tested SMART/STRATEGIC
model, so there are no real candidates to reacquire. The full chain (URL safety
→ acquisition → registry → independence → verbatim-anchored Claim/Evidence →
Sufficiency re-evaluation; provider report stays leads-only) is implemented in
`scripts/diagnostics/deep-live-smoke.js` and covered by fixture suites; it
executes automatically as part of the smoke once a DEEP run completes.

## 77. Final regression

| Command | Result |
|---|---|
| `node scripts/run-tests.js research-deep` | 9/9 suites PASS (incl. `test-quota-fastfail.js` Q1–Q6), 28.6 s |
| `npm test` (full) | 3 failed suites — **all pre-existing environmental**: `remotion/test-remotion-render-smoke.js`, `remotion/test-render-control.js`, `pipeline/test-step13-pipeline-e2e.js`. Evidence: fresh CodeIntegrity 3077/3033/3118 events (first at 20:24:38 today) — Smart App Control is now blocking Remotion's bundled `remotion\node_modules\@remotion\compositor-win32-x64-msvc\ffmpeg.exe` (render exit 0xC0E90002, "FFmpeg quit while piping frame 0"). Same known failure class as the 2026-10-01 finding. System `ffmpeg`/`ffprobe` (winget Gyan build) run fine standalone. All other 44 suites PASS, incl. Prompt-01–04 regressions. |
| `npm run check:repo-structure` | `REPOSITORY_STRUCTURE_OK` |
| `node scripts/checks/validate-schemas.js` | `RESULT: ALL TESTS PASSED` |
| `.env` git check | `git check-ignore .env` → ignored; not tracked |
| Security | no OpenAI fallback (probe adapter-class guard + E1–E7 + live probes); SAC/Defender settings unchanged; zero secret leakage |

Per project rules, Windows security was NOT weakened to force the render suites
green; the SAC/ffmpeg blocker is environmental and predates/outside Fix 5
(agent-side ffmpeg execution is blocked by OS policy — an OS/security stop
condition per AGENTS.md).

## 78. Final verdict

```text
TASK_VALIDATION = PARTIAL — Gemini Free Tier quota unavailable for all approved
SMART/STRATEGIC candidates tested (gemini-3.8-flash retryDelay ≈14.3 h;
gemini-3.5-flash retryDelay ≈10.7 h; both quotaValue "20" RPD/model).
Everything else is live-proven: doctor READY, 3/3 live probes PASS, no OpenAI
fallback, quota fail-fast verified, research-deep 9/9, structure/schemas PASS.
```

Next safe options (operator decision only):

```text
A. wait for quota reset, then rerun: $env:UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED="1"; npm run research:deep:live-smoke
B. operator explicitly selects another Free-Tier model after checking its own quota (e.g. flash-lite class for SMART/STRATEGIC — operator's quality trade-off)
C. operator enables paid Gemini API billing
```

Note on A: with 20 RPD/model, a reset quota may still be smaller than one full
DEEP run's SMART/STRATEGIC call count — B or C are the structurally reliable
paths. Do NOT start Prompt 06 in this task.

---

# APPENDIX F — ROOT-CAUSE FIRST: QUOTA + REMOTION SAC (2026-10-02, Fix 6 REV2)

## 79. Entry State

PARTIAL with two independent blockers: (A) no completed DEEP live run (free-tier quota),
(B) 3 real render suites failing under SAC. Both root-caused below.

## 80. Gemini Quota Root Cause (measured, not assumed)

Provider evidence (Fix 5): `GenerateRequestsPerDayPerProjectPerModel-FreeTier,
quotaValue "20"` — the operator's project gets **20 requests/day per model**.
gemini-3.8-flash AND gemini-3.5-flash (both attempted as SMART/STRATEGIC) exhausted.

## 81. GPT Researcher Call Topology (0.15.1, measured by instrumented dry run)

Method: real `run_deep` path with a deterministic mock provider + mock embeddings
(zero API calls), REAL DuckDuckGo retrieval + scraping; every LLM call counted per
provider model. Regression-locked in `tests/research-deep/test-acceptance-profile.js` (AP1-AP4).

| Stage | Role | Calls @ breadth=1/depth=1 | Required for conduct_research? |
|---|---|---|---|
| deep-skill research plan | strategic | 1 | yes |
| deep-skill search-query generation | strategic | 1 | yes |
| nested researcher choose_agent | smart | 1 | yes |
| nested researcher sub-query planning | strategic | 1 | yes |
| process_research_results (learnings) | strategic | 1 | yes |
| write_report (deep prose) | smart | 1 | **no — acceptance skips it** |

Measured: **acceptance (breadth=1, skipReport) = 5 LLM calls (4 strategic + 1 smart)**;
production (with report) = 6. FAST_LLM is never called on this path. Bounds ARE
honored (breadth=2 produced a 2-query request; scale is +3 calls per extra breadth
query) — so the Fix-5 failures were structural: a breadth=2 run needs >10
SMART/STRATEGIC calls plus retries, above the 20-RPD/model budget, and each failed
acceptance attempt burned part of a fresh budget.

## 82. Quota Remediation Options Evaluated

| Option | Verdict |
|---|---|
| Q1 fix request inflation | bounds honored; no duplicate calls found; write_report skip is the only saving (1 call) — applied |
| Q2 minimal acceptance profile | SELECTED (breadth=1/depth=1/concurrency=1/queries=1 + skipReport; production unchanged) |
| Q3 different free-tier model | SELECTED as session-level acceptance override: SMART/STRATEGIC -> `gemini-3.5-flash-lite` (empirically has quota headroom on this key today: served all probes + model checks without 429). `.env` production values NOT changed |
| Q4 wait for reset | insufficient alone: 20 RPD/model < one breadth=2 run's call count |
| Q5 paid tier | not needed for acceptance; production topology documented for the operator |
| Q6 local model | out of scope (documented as follow-up) |

## 83. Selected Quota Remediation

1. Acceptance profile in `LIVE_SMOKE_CONFIG` (breadth=1/depth=1/concurrency=1/queries=1).
2. `skipReport` honored by the worker (acceptance request flag only; production DEEP still writes reports).
3. Call-budget guard `UNFOLDIQ_DEEP_MAX_LLM_CALLS` (Fix 6 §10): counted per call BEFORE the
   provider call, refuses via structured `DEEP_BUDGET_EXHAUSTED` carrying call counts
   (regression AP5/AP6).
4. Acceptance model override passed as SESSION env (shell wins over `.env`), keeping
   production defaults intact per Fix 6 §7.

## 84. Real DEEP Validation = PASS

One bounded acceptance smoke (`UNFOLDIQ_DEEP_LIVE_TEST_ALLOWED=1 SMART_LLM=
STRATEGIC_LLM=google_genai:gemini-3.5-flash-lite UNFOLDIQ_DEEP_MAX_LLM_CALLS=8`):

```text
provider status=COMPLETED providerVersion=0.15.1
queries observed: 2; candidate URLs: 16 (real DuckDuckGo + real crawl)
completed within the 8-call ceiling (measured prediction: 5)
embedding: google_genai:gemini-embedding-001 (explicit); no OpenAI fallback
```

## 85. Canonical Reintegration = PASS

```text
reacquired: https://vi.wikipedia.org/wiki/Pep_Guardiola -> src-21f7a5786fa7
reacquired: https://en.wikipedia.org/wiki/Pep_Guardiola -> src-4be4f59db8c2
registrySources=2 independentGroups=2
claimStatus=NO_CANONICAL_ANCHOR (honest: acquired bodies too short for a verbatim anchor)
sufficiency re-evaluated: NEEDS_MORE_RESEARCH (honest, not fabricated)
```

Full chain executed: URL safety -> canonical acquisition -> AcquiredDocument -> Source
Registry -> Independence -> Claim/Evidence attempt -> Sufficiency re-evaluation.
Provider text stayed leads-only; no Pack fabricated (correct per Fix 3 §11).

## 86. Remotion SAC Root Cause

Windows Smart App Control (mode "on") denies execution of unsigned binaries that
lack cloud reputation. Remotion's Windows compositor package
`@remotion/compositor-win32-x64-msvc` ships unsigned `ffmpeg.exe`/`ffprobe.exe`
-> blocked since 20:24:38 today (fresh CodeIntegrity 3077/3033/3118 events at the
node_modules path; render exit 0xC0E90002 = SAC block). `remotion.exe` (also
unsigned) still runs from its original node_modules path (cached verdict), but ANY
relocation is denied (proven: copy, hardlink, and a completely new temp path all
"Permission denied" with matching SAC events).

## 87. Remotion Package / Binary Integrity

- Installed 4.0.529 for ALL `@remotion/*` incl. `compositor-win32-x64-msvc` (aligned; no mismatch).
- `package-lock` integrity `sha512-kyg7sG3b…` == registry `dist.integrity` -> package PRISTINE (no reinstall needed; a reinstall fetches identical bytes).
- Authenticode: `ffmpeg.exe`, `ffprobe.exe`, `remotion.exe` all NotSigned (upstream ships unsigned; normal for their distribution, fatal under SAC).
- SHA-256 recorded: ffmpeg `5D1AA370…D39E4`, ffprobe `66468651…C7261`, remotion.exe `20329A55…93E16`.

## 88. Upstream / Version Compatibility

- Latest upstream 4.0.532: downloaded the official compositor tarball and verified
  `ffmpeg.exe`/`remotion.exe`/`ffprobe.exe` are STILL NotSigned -> a coherent
  upgrade does NOT fix SAC.
- Known upstream issue (remotion-dev/remotion): "Sign Windows compositor binaries
  with Microsoft Artifact Signing — Smart App Control blocks unsigned FFmpeg
  DLLs"; fix not shipped yet.
- Installed renderer exposes exactly ONE binary-path option: `binariesDirectory`
  (used for compositor AND ffmpeg AND ffprobe — no per-binary override;
  `ffmpegOverride` rewrites args only; no REMOTION_* env var for binary paths).

## 89. Remotion Remediation Options Evaluated

| Option | Root cause addressed? | Security impact | Real render result | Decision |
|---|---|---|---|---|
| reinstall same version | no (pristine) | none | n/a | rejected |
| coherent upgrade 4.0.532 | no (still unsigned) | none | n/a | rejected (evidence §88) |
| `binariesDirectory` + trusted system FFmpeg | partially — replaced `ffmpeg.exe`/`ffprobe.exe` (system Gyan static build, SAC-allowed) EXECUTE fine, but the dir must ALSO contain `remotion.exe`, which is denied at ANY new path (copy/hardlink/new-path all SAC-blocked; file symlink needs admin privileges) | none (no security change) | render failed at compositor spawn (`spawn UNKNOWN`) | rejected as implemented; script kept (`scripts/maintenance/setup-render-binaries.js`) — reusable once upstream signs or on non-SAC machines |
| WSL2/Linux worker (Fix 6 §26) | yes (no SAC in Linux) | none | not executable by agent — WSL2 not installed; `wsl --install` needs admin + reboot | RECOMMENDED — operator decision |
| Linux container/cloud worker (Fix 6 §27) | yes | none | not in current project infrastructure (no Docker installed) | documented, out of scope |

## 90. Selected Remotion Remediation

Nothing executable by the agent without either (a) weakening security (FORBIDDEN) or
(b) modifying node_modules in place (forbidden by Fix 6 §23 and silently reverted by
`npm ci`). Selected path = operator decision:

```text
A. (recommended) Install WSL2, then the render worker runs the Linux compositor:
   1. elevated PowerShell:  wsl --install -d Ubuntu   (admin; REBOOT required)
   2. inside WSL: install Node 20+; npm ci in remotion/ (via /mnt/d/Project/UNFOLDIQ/remotion)
   3. run the 3 render suites from WSL (Linux compositor binaries are not SAC-governed)
B. Operator's own choice: turn Smart App Control off (Settings -> Privacy & security
   -> Windows security -> App & browser control). SAC has no per-app allow/bypass
   rule; current Windows versions may allow it to be re-enabled later. UNFOLDIQ
   still does NOT require disabling SAC as an engineering solution — recorded
   here as the operator's option, never executed by the agent.
C. Wait for upstream signed compositor binaries (Remotion issue), then refresh
   node_modules and render natively (the kept binariesDirectory script becomes
   unnecessary).
```

## 91. Real Render Validation

BLOCKED — `test-remotion-render-smoke`, `test-render-control` (RC1/RC3 real-render
assertions), `test-step13-pipeline-e2e` still fail on the SAC block. No skip, no
mock, no "environmental PASS" claimed.

## 92. Full Regression

```text
npm test -> 44/47 suites PASS; the only 3 failures are the SAC-blocked render suites above
research-deep -> 10/10 suites PASS (incl. acceptance-profile AP1-AP6 + quota-fastfail Q1-Q6)
repo structure -> REPOSITORY_STRUCTURE_OK ; schemas -> ALL TESTS PASSED
Prompt-01–04 regressions -> PASS (within the full run)
```

## 93. Security Audit

SAC/Defender settings unchanged by the agent; no exclusions; no registry policy
changes; `.env` untracked (`git check-ignore` verified); zero secret values in
code/tests/reports; no OpenAI fallback (probe adapter-class guard + live probes);
no untrusted binaries executed (the official npm 4.0.532 tarball was downloaded
only for signature inspection and never run); no binary committed to Git
(`remotion/.render-binaries/` git-ignored).

## 94. Final Verdict

```text
TASK_VALIDATION = PARTIAL — exactly one remaining blocker:
Windows Smart App Control (OS policy) blocks the unsigned upstream Remotion
compositor binaries, so the 3 real render suites cannot execute on this machine.
Everything else is closed and live-proven: measured quota topology (§81), acceptance
profile with budget guard, REAL DEEP run COMPLETED with canonical reintegration
(§84-85), no OpenAI fallback, research-deep 10/10, structure/schemas PASS.
```

Recommended next action (operator): §90 option A (WSL2, admin + reboot), then the
3 render suites run under Linux and this report can be flipped to PASS. Do NOT
start Prompt 06 in this task.

---

---

# APPENDIX G — NATIVE WINDOWS RENDER WITH MANUAL SAC TOGGLE (2026-10-02, Fix 7 REV3)

WSL2 (previous Fix-7 checkpoint) is DEFERRED to a documented FALLBACK/FUTURE option —
not installed, no WSL code introduced. The operator manually turned Smart App Control
OFF; this appendix records whether native Windows Remotion then actually works.

## 95. Entry State

PART A (Gemini/DEEP) = SOLVED + LIVE-PROVEN (Appendix F §80-85, untouched, no quota
spent this revision). PART B = Windows-native render was blocked by SAC (Appendix F
§86-91); this revision re-tests natively under the operator's manual SAC-off window.

## 96. SAC-Off Operator Confirmation

The operator manually set Smart App Control = OFF (human-only action; the agent did
not touch any security setting). Verified BY EXECUTION, not registry assumptions:

```text
bundled ffmpeg.exe  (n7.1)   -> -version exit 0
bundled ffprobe.exe (n7.1)   -> -version exit 0
remotion.exe (compositor)    -> spawned; ran its own error handling (exit 0 on argv probe)
CodeIntegrity events         -> 0 Remotion/compositor block events in the last 60 min
                                (remaining 3033 events = the operator's own Chrome DLL noise)
```

The exact binaries SAC previously denied (0xC0E90002, "FFmpeg quit while piping
frame 0") now execute at their original node_modules paths.

## 97. Native Remotion Binary Preflight

Covered in §96 — all three compositor-package binaries executable, package version
4.0.529 unchanged, no files modified.

## 98. Native Minimal Real Render = PASS

Executed via the REAL production render path (`render-plan-cli --stage-assets` ->
`remotion-render-cli --validate` -> `remotion-render-cli --render-test`), TEST-ONLY
project, real Chromium headless shell, real frames, real Rust compositor, real FFmpeg
encode, then `ffprobe` validation and cleanup — the whole flow is the
`test-remotion-render-smoke` suite:

```text
[PASS] SMOKE setup TEST-ONLY project (ffmpeg-guarded video)
[PASS] SMOKE stage via render-plan-cli --stage-assets (exit 0)
[PASS] SMOKE validate via remotion-render-cli --validate (exit 0)
[PASS] SMOKE render-test to mp4 (budget 8min)
[PASS] SMOKE ffprobe streams/duration/size
[PASS] SMOKE cleanup removes project, staged dir, mp4
RESULT: PASS
```

Output quality sanity (asserted by the suite, Fix 7 §12): ffprobe parses the MP4;
video stream present; duration > 0; size > 0.

## 99. Three Real Render Suites = PASS (all native, no skip/mock)

| Test | Real Native Render | Result |
|---|---|---|
| test-remotion-render-smoke | yes (full render + ffprobe) | PASS |
| test-render-control | yes (RC1 real 3s render; RC5 real cancel mid-render) | PASS (RC0-RC10) |
| test-step13-pipeline-e2e | yes (E2E-A/B/C prepare->render->QA->finalize) | PASS |

## 100. Production Render Smoke = PASS

The smoke render above runs through the SAME production-facing entry used by normal
UNFOLDIQ renders (`scripts/cli/remotion-render-cli.js` render path, which delegates to
`pipeline/remotion-render-runner.js` -> `@remotion/renderer.renderMedia`). Real encode,
valid MP4 verified from Windows. Not a special test-only renderer.

## 101. Native Failure Root Cause If Any

None — no new failure occurred under SAC=OFF. The previous failure's root cause
remains exactly as documented (Appendix F §86): SAC policy vs unsigned upstream
binaries. With SAC off, every prior security-denial signature disappeared.

## 102. Render Readiness Doctor

New: `npm run render:doctor` (`scripts/diagnostics/render-doctor.js`, read-only):
checks remotion/compositor version + alignment, executes safe binary preflights
(ffmpeg/ffprobe `-version`; compositor spawn probe), output-dir writeability, browser
headless-shell presence. Contract: `READY | NOT_READY`. A SAC-specific
OPERATOR_ACTION_REQUIRED hint is printed ONLY with supporting evidence (execution
denial + matching recent CodeIntegrity event); otherwise `NATIVE_RENDER_NOT_READY —
inspect logs` (no overclaiming, Fix 7 §15). Observed under SAC=OFF: `READY`.
The agent must run it before any real native render and must never toggle SAC itself.

## 103. Manual SAC Operator Workflow

Documented in AGENTS.md ("Native rendering on Windows (Smart App Control)"):

```text
BEFORE RENDER: operator sets SAC = OFF manually in Windows Security -> App & browser
  control -> Smart App Control settings; run npm run render:doctor; continue only if READY.
RENDER: run the normal UNFOLDIQ render command; do not run unrelated untrusted
  executables during the SAC-off window.
AFTER RENDER: operator sets SAC = ON manually and confirms in Windows Security.
```

No registry instructions, no automatic toggle, agent changes nothing.

## 104. Full Regression (captured inside the SAC-off window)

```text
npm test -> 0 failed suites in 199.0s  (all 47 suites, including the 3 render suites)
research-deep -> 10/10 suites PASS (within the full run; no research code changed, no quota spent)
npm run check:repo-structure -> REPOSITORY_STRUCTURE_OK
node scripts/checks/validate-schemas.js -> RESULT: ALL TESTS PASSED
```

## 105. Security Restoration — HUMAN GATE (PENDING)

```text
SAC toggled automatically by agent        = NO
Defender changed                          = NO
security exclusions added                 = NO
Code Integrity policy modified            = NO
registry bypass                           = NO
node_modules modified                     = NO
operator restored SAC after validation    = YES (operator manually re-enabled
                                             Smart App Control = ON in Windows Security
                                             after ALL real render/regression evidence
                                             was captured; agent changed nothing)
```

## 106. Final Verdict

```text
TASK_VALIDATION = PASS
PHASE 1G.1 Prompt 05 = COMPLETE
NEXT = PHASE 1G.1 Prompt 06 — FULL 1G.1 E2E VALIDATION
```

Operator confirmation received: Smart App Control manually restored = ON after all
real render/regression evidence was captured (no render suite rerun under SAC=ON,
per the approved native runtime contract). Security restoration matrix: agent
toggled SAC automatically = NO; Defender changed = NO; exclusions added = NO;
Code Integrity policy modified = NO; registry bypass = NO; node_modules modified
= NO; operator restored SAC = YES.

Acceptance semantics (explicit, Fix 7 §21): this validation proves **native Windows
Remotion rendering is technically valid and fully tested WHEN the documented human
precondition SAC=OFF is satisfied**. It does NOT mean Remotion can render while
SAC=ON — upstream Remotion Windows compositor binaries remain unsigned, and that
operational dependency is documented, not hidden (AGENTS.md). Non-blocking future
options to remove the manual dependency: upstream signed binaries, WSL2/Linux render
worker, container/remote Linux worker.

After the operator confirms SAC = ON, flip to:

```text
TASK_VALIDATION = PASS
PHASE 1G.1 Prompt 05 = COMPLETE
NEXT = PHASE 1G.1 Prompt 06 — FULL 1G.1 E2E VALIDATION
```

(No render suite is rerun after re-enabling SAC — the approved native runtime contract
explicitly requires SAC=OFF during rendering; Fix 7 §20.)
