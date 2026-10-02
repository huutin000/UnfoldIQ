# PHASE 1G.1 — PROMPT 05 FIX
# DEEP LIVE PROVIDER VALIDATION REPORT

## 1. Status

```text
TASK_VALIDATION = PARTIAL — OpenAI-credential fallback root-caused + fixed (Appendix B);
                             live probes/live smoke pending in the operator's configured shell
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

Single external blocker (nothing technical outstanding):

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

## 58. Required Live Matrix (Fix 2)

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

