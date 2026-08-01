# Vetted External Code Registry

The whitelist for THIS project. Every external artifact admitted gets a
row AFTER passing the External Code Vetting Protocol (run via `/vet`).
**In the environment but not listed here = unvetted → vet or remove.**

Verdicts: 🟢 approved · 🟡 approved-with-conditions · 🔴 rejected (do-not-retry record).

| Date | Artifact | Source (canonical) | Pinned version/SHA | Tier | Scanners run | Verdict | Conditions / notes |
|---|---|---|---|---|---|---|---|
| 2026-07-22 | Anthropic `frontend-design` skill v1.1.0 (vendored at `.claude/skills/frontend-design/`) | https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design | repo `ac062f33ab0c` · see `.claude/skills/frontend-design/PROVENANCE.md` | T1 (verified anthropics org) | SkillSpector `--with-llm` + full-file read + quarantine dry-run — **performed once in `yabro-hq`, not re-run here** | GREEN (inherited) | Pure instruction layer, zero code, requests no tools/permissions. Vendored byte-identical rather than marketplace-installed, so upstream cannot auto-update past the pin. **Master row + full evidence: `yabro-hq/docs/vetted-external-code.md`** — this row exists so the skill is not "present but unlisted" here. Updates only via re-vet. |

## Rejected log

(none yet)

## Last upstream sweep

(never)
