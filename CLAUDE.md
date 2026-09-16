# StockFloor — project rules

Working name. Hackathon project for **Stocklana** (Solana Foundation), targeting the **Best Use of Meteora DBC** bounty and the main track.
**Hard deadline: Friday 2026-09-25** (extended from Fri 2026-09-18, 16:00 ET; confirm the new closing time on the hackathon page). Read `docs/BRIEF.md` before doing anything else. It is the full spec.

## Language (strict)
- Talk to the user **in Russian**. That covers chat replies and questions to the user.
- Write **everything else in English**: code, comments, tests, docs, `docs/STATUS.md`, commit messages, README, scripts, UI copy, and messages to subagents or other sessions.

## How to work
- Work **autonomously**. Don't ask the user questions unless you reach a hard stop (below) or are truly blocked.
  - For every other decision, pick a sensible default, write it in `docs/DECISIONS.md`, and keep going.
- Use **subagents** for parallel work: program, tests, web app, docs, and an independent reviewer. If the user opted into multi-agent workflows (for example, they wrote "ultracode"), use workflows for fan-out and adversarial review.
- **Test first.** A milestone isn't done until its tests pass locally. Never mark work done while tests fail; say so in `docs/STATUS.md` instead.
- Before each checkpoint, have an independent subagent review the code for correctness and security, and fix what it finds.
- Keep `docs/STATUS.md` current. Update it at least at every milestone and whenever you are blocked on the user. Format is in `docs/BRIEF.md` §11.
- Make small, frequent git commits with clear English messages. The repo stays **local** until the user approves publishing.
- Prefer the simplest design that satisfies the spec. No speculative features before the MVP flow works end-to-end.
- The `solana-dev` skill and the Meteora docs (`https://docs.meteora.ag/llms.txt`, MCP at `https://docs.meteora.ag/mcp`) are available. Prefer primary sources such as the DBC source, IDL, and on-chain data over memory.

## Hard stops (ask the user in Russian and wait; keep working on other tasks meanwhile)
1. Any **mainnet** transaction or program deploy, and anything that spends real funds.
2. Using any keypair other than a dedicated one generated inside this repo under `keys/` (gitignored).
   - **Never** read, copy, or use `~/.config/solana/id.json` or any other user wallet.
3. Revoking a program's upgrade authority, or any other irreversible on-chain action.
4. Pushing to GitHub, publishing anything, contacting third parties, or submitting to the hackathon.
5. `sudo`, or changes to global system configuration.
   - Installing dev tools without `sudo` is fine: Surfpool, cargo crates, npm packages.

## Checkpoints (stop, summarize in Russian, wait for the user's OK)
- **C1:** The full flow passes on a mainnet fork: DBC config quoted in SPYx → pool → buys → curve complete → migration → migration fee harvested into the vault PDA → redeem.
- **C2:** Before any mainnet deploy. The user must fund the dedicated deployer keypair.
- **C3:** Before hackathon submission.

## Toolchain already installed
Versions checked 2026-09-15:
- rustc 1.94.1
- solana-cli 4.1.0-beta.2 (Agave)
- anchor-cli 1.0.2 (avm 0.32.1)
- node 24.12, pnpm 10.30, npm 11.6
- docker 29.4, gh 2.97 (**not logged in**)

Surfpool is **not** installed. Install it yourself.

## Never commit
`keys/`, `.env*`, keypair JSON files, API keys, RPC URLs that embed keys.
