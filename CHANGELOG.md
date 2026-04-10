# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.1.8](https://github.com/korchasa/flowai-workflow/compare/v0.1.7...v0.1.8) (2026-04-10)


### Bug Fixes

* **ci:** detect engine: commits as releasable; force patch bump ([#191](https://github.com/korchasa/flowai-workflow/issues/191)) ([1e7e06e](https://github.com/korchasa/flowai-workflow/commit/1e7e06ec0e4c627999caef9334db40f211995bee))

### [0.1.7](https://github.com/korchasa/flowai-workflows/compare/v0.1.6...v0.1.7) (2026-04-10)


### Features

* **setup:** add comprehensive setup guide for flowai-workflow engine ([e73191a](https://github.com/korchasa/flowai-workflows/commit/e73191aac8ac83c5417ba2a08e277ff37a1d8bc0))


### Code Refactoring

* **cli:** remove self-update functionality ([d984280](https://github.com/korchasa/flowai-workflows/commit/d984280169715858449af20f5bd4435fc3a7314d))

### [0.1.6](https://github.com/korchasa/flowai-workflows/compare/v0.1.5...v0.1.6) (2026-04-10)


### Features

* **engine:** add OpenCode runtime support with provider-agnostic abstraction ([#186](https://github.com/korchasa/flowai-workflows/issues/186)) ([f418386](https://github.com/korchasa/flowai-workflows/commit/f4183867b7a9e064a64d4e195ec3bdd4aded906f))

### [0.1.5](https://github.com/korchasa/flowai-workflows/compare/v0.1.4...v0.1.5) (2026-04-08)


### Bug Fixes

* **ci:** use CWD .env file for deno compile version embedding ([20f6fe2](https://github.com/korchasa/flowai-workflows/commit/20f6fe213808a9381eaf5d679e2b8c66abe582e7))

### [0.1.4](https://github.com/korchasa/flowai-workflows/compare/v0.1.3...v0.1.4) (2026-04-08)


### Bug Fixes

* **ci:** show compile errors and add --no-check to deno compile ([5fd0228](https://github.com/korchasa/flowai-workflows/commit/5fd0228ff0494749e4306974829a364b722f8ce8))

### [0.1.3](https://github.com/korchasa/flowai-workflows/compare/v0.1.2...v0.1.3) (2026-04-08)


### Code Refactoring

* **ci:** merge release workflow into CI pipeline ([7c0510e](https://github.com/korchasa/flowai-workflows/commit/7c0510ecf8406905bae558e21b9d38120c082367))

### 0.1.2 (2026-04-08)


### Features

* add `start-in-claude` deno command to launch app via claude CLI ([af23fe3](https://github.com/korchasa/flowai-workflows/commit/af23fe328e2a83ad78d8f9331d00df4859047c80))
* add agent log storage, claude CLI fixes, task pipeline config ([c7ce8fd](https://github.com/korchasa/flowai-workflows/commit/c7ce8fd5de67cead19f217ab2e334a20a02f61bc))
* add configurable node-based pipeline engine ([e2d757b](https://github.com/korchasa/flowai-workflows/commit/e2d757b33c488297db106e4c5c888f9953e24680))
* add permission flag to claude command in start script ([a02aeb4](https://github.com/korchasa/flowai-workflows/commit/a02aeb442a48f6c5edacebfdf5e28834fb60696b))
* **agent:** replace onOutput with OutputManager in AgentRunOptions ([4e4a57a](https://github.com/korchasa/flowai-workflows/commit/4e4a57a22e18d93e8a128c376987781897139a27))
* **check:** add pipeline integrity validation to deno task check ([d3112e2](https://github.com/korchasa/flowai-workflows/commit/d3112e2636298e8df4a06be70ed991cd020c3015))
* **engine:** add CLI auto-update and automated release pipeline (FR-E41) ([344ea45](https://github.com/korchasa/flowai-workflows/commit/344ea45c35fc150f9b5017ad7ece4dccc4f82913))
* **engine:** add ErrorCategory type for structured node failure classification ([f67bc35](https://github.com/korchasa/flowai-workflows/commit/f67bc35b291728f3a0c1d6b7a4d07404ae4f8e78))
* **engine:** add graceful shutdown — kill child processes on SIGINT/SIGTERM (FR-E25) ([5b3ef14](https://github.com/korchasa/flowai-workflows/commit/5b3ef1404fefe3a46e946517d582be7bf0f03271))
* **engine:** add lock_path option to EngineOptions for test isolation ([4666af1](https://github.com/korchasa/flowai-workflows/commit/4666af1652f893616de6199cb4819412f9f0b151))
* **engine:** add per-node effort level and fallback model configuration ([0730f18](https://github.com/korchasa/flowai-workflows/commit/0730f185e9799a56567d17c3743512c62cc28bff))
* **engine:** add permission_mode config field (FR-E40) ([42d372a](https://github.com/korchasa/flowai-workflows/commit/42d372a47608ce0de2f8421cfa9dbf6cc596c4ec))
* **engine:** add pre_run script support for two-phase config loading (FR-E24) ([56fab5b](https://github.com/korchasa/flowai-workflows/commit/56fab5b05b37f2db83f80982c3e316910c556b03))
* **engine:** add run_always node support for Meta-Agent trigger ([4c0c6d8](https://github.com/korchasa/flowai-workflows/commit/4c0c6d8dcb56607cbdb88b526234b63acb54ab8c))
* **engine:** cache prompt file contents at config load time ([a5d029e](https://github.com/korchasa/flowai-workflows/commit/a5d029ec2ec2776ec8b67087e9f970c37d038b00))
* **engine:** integrate safetyCheckDiff into continuation flow ([acfb7b2](https://github.com/korchasa/flowai-workflows/commit/acfb7b2db6db572f1921274ccb602b496ffbcaa3))
* **engine:** replace pre_run with git worktree isolation (FR-E24) ([cf74166](https://github.com/korchasa/flowai-workflows/commit/cf7416620f9340e9cd194993c59169097467e321))
* **engine:** wire verbose output for inputs, safety, commit, agent/loop dispatch ([a759173](https://github.com/korchasa/flowai-workflows/commit/a7591730b1945265a7470468cedfc48a10f7b781))
* **fr-19:** create 9 agent SKILL.md files with frontmatter ([0306348](https://github.com/korchasa/flowai-workflows/commit/0306348e294518f09dd041bce3d44f182e9d898d))
* **fr-19:** create 9 symlinks from .claude/skills/ to agents/ ([dbf098f](https://github.com/korchasa/flowai-workflows/commit/dbf098f69d5a0f85ff68c66d39dbd09b84db5dcf))
* **fr-19:** deferred commit strategy — committer agent replaces auto-commit ([468ebda](https://github.com/korchasa/flowai-workflows/commit/468ebdab5909b88196ed59b8daceeb4672e9604a))
* **fr-19:** fix test fixtures referencing .sdlc/agents/ paths ([8e9730d](https://github.com/korchasa/flowai-workflows/commit/8e9730d8047c0d3f99da812ee53f97d8c8aca4e3))
* **fr-19:** remove .sdlc/agents/ directory after migration ([9f016ad](https://github.com/korchasa/flowai-workflows/commit/9f016adafc0d2babc2fb8425627c526a1e1b1828))
* **fr-19:** update .gitleaks.toml path references for agents/ ([d62c3e2](https://github.com/korchasa/flowai-workflows/commit/d62c3e2b2eeb70674c02d885d363da8a82b25ffd))
* **fr-19:** update pipeline YAML prompt paths to agents/<name>/SKILL.md ([7e63ad5](https://github.com/korchasa/flowai-workflows/commit/7e63ad56599d607dad0dfc49a68e53ed2a7151b6))
* **fr-19:** update SRS path references from .sdlc/agents/ to agents/ ([49fb776](https://github.com/korchasa/flowai-workflows/commit/49fb776b3b3ab701228ae9f7d193e87670f5a2f5))
* **fr-21:** implement Human-in-the-Loop via AskUserQuestion interception ([a0a4e29](https://github.com/korchasa/flowai-workflows/commit/a0a4e294cedd0d4c034b4523b79933284461657a))
* **git:** add gitleaks CLI to safetyCheckDiff ([91a9a0e](https://github.com/korchasa/flowai-workflows/commit/91a9a0e2f1ad54af4f9329ac1bd61e5990b03c3e))
* **git:** enrich CommitResult/SafetyCheckResult return types, add branch() helper ([fb5d311](https://github.com/korchasa/flowai-workflows/commit/fb5d3110438d78c66b0fe40ec24e75bb80aa3f7d))
* **loop:** replace onOutput with OutputManager in LoopRunOptions ([eae9011](https://github.com/korchasa/flowai-workflows/commit/eae90112073b423249e54ba2cfe5fab4a18d9768))
* nest loop body nodes inline in pipeline config ([#18](https://github.com/korchasa/flowai-workflows/issues/18)) ([#24](https://github.com/korchasa/flowai-workflows/issues/24)) ([8d621da](https://github.com/korchasa/flowai-workflows/commit/8d621da3498fe8ada0e2a2e8f7234aec8ec122e0))
* **output:** add 6 verbose methods to OutputManager ([2bdb96f](https://github.com/korchasa/flowai-workflows/commit/2bdb96fbe2a8c383f49570e8155be3587e504a1e))
* **pipeline:** consolidate dual-pipeline into single autonomous pipeline ([421c79c](https://github.com/korchasa/flowai-workflows/commit/421c79cfbc390a1e051ebc1808838510cb28b295))
* **pipeline:** migrate executor check from after hook to custom_script validation ([d02a624](https://github.com/korchasa/flowai-workflows/commit/d02a624e80399143bebdd80ec4334d9b78f264af))
* **pm:** prefer in-progress issues and pull main before triage ([512a3c2](https://github.com/korchasa/flowai-workflows/commit/512a3c266ba6f8ac39029bdf54278f60ee6f8162))
* **pm:** select issues by in-progress label instead of avoiding them ([b7e4ae1](https://github.com/korchasa/flowai-workflows/commit/b7e4ae143e6d491fccdf513591b8813094ad7b94))
* **requirements:** update acceptance criteria for agent prompts and pipeline structure ([3e03fa1](https://github.com/korchasa/flowai-workflows/commit/3e03fa19d79f4d227cb625d30ce2908185f7eed1))
* **scripts:** add self-runner for autonomous issue-driven pipeline execution ([cbcf3de](https://github.com/korchasa/flowai-workflows/commit/cbcf3de11e3a592d3822498fcb736957e90628d7))
* **state:** add label suffix to run IDs for readability ([385b92e](https://github.com/korchasa/flowai-workflows/commit/385b92e70554f549b6e87e805bcc60d2d3aa4db5))
* stream log timestamps — mark FR-32 complete (issue [#42](https://github.com/korchasa/flowai-workflows/issues/42)) ([#58](https://github.com/korchasa/flowai-workflows/issues/58)) ([c93fa47](https://github.com/korchasa/flowai-workflows/commit/c93fa479bc19718b9464c9404db1a178f01aae3b))
* **validate:** add frontmatter_field validation rule type ([635fdb1](https://github.com/korchasa/flowai-workflows/commit/635fdb13f5e312f58fc964d5d8f9f324edc3b18c))
* vendor @std/assert and @std/yaml for environments where jsr.io is blocked ([9c813be](https://github.com/korchasa/flowai-workflows/commit/9c813befc71347803379eeb0e627c2f3003563c9))


### Bug Fixes

* add trailing newline to .claude JSON files ([dfb3cfe](https://github.com/korchasa/flowai-workflows/commit/dfb3cfe4d1bf1b1e187e192356702a64c12bae79))
* **agents:** remove hardcoded pipeline paths, add resilience to presenter/meta-agent prompts ([9857853](https://github.com/korchasa/flowai-workflows/commit/9857853f822d56a9aa59ba238e2c267c7d4e5bf1))
* **agents:** replace hardcoded pipeline paths with dynamic task message paths ([f73b2ae](https://github.com/korchasa/flowai-workflows/commit/f73b2ae2394c5b4cbf6d84983d2b1c7c4ac64aec))
* **check:** make comment scan mandatory (exit 1 on markers) ([63a51dc](https://github.com/korchasa/flowai-workflows/commit/63a51dc5bcbe9ee778e6e666289299366c8ba3d9))
* **ci:** install gitleaks in CI and handle missing binary gracefully ([8dd6bed](https://github.com/korchasa/flowai-workflows/commit/8dd6bed9635656af23fe81b2598a639ab5ddceb4))
* **ci:** use annotated tag and explicit push for release workflow ([5c63674](https://github.com/korchasa/flowai-workflows/commit/5c6367432ce4a7cc24dd069c7601ac09878739c4))
* clarify Claude CLI auth (OAuth primary, API key optional), fix nested session env ([1ed6284](https://github.com/korchasa/flowai-workflows/commit/1ed62844338454280cab5048043f0804930a3213))
* **config:** add allowed_paths to executor node in pipeline.yaml ([f925a79](https://github.com/korchasa/flowai-workflows/commit/f925a79d3991185420de5e63c3cf264034c71292))
* dashboard result summary display (issue [#47](https://github.com/korchasa/flowai-workflows/issues/47)) ([#61](https://github.com/korchasa/flowai-workflows/issues/61)) ([444c43f](https://github.com/korchasa/flowai-workflows/commit/444c43fda2ce50f147ec181723f8e5954bab1e99))
* **engine:** add frontmatter_field to valid config rule types ([9f3f280](https://github.com/korchasa/flowai-workflows/commit/9f3f280d7e9bc21382265dc6ee9422b294b6336f))
* **engine:** add hostname to pipeline lock for cross-host (Docker) safety ([e5d7495](https://github.com/korchasa/flowai-workflows/commit/e5d749550db2f5be9a1c661244bd826a0eb8f261))
* **engine:** code style and unused-ignore fixes ([7e2213d](https://github.com/korchasa/flowai-workflows/commit/7e2213d4030b5b2b73fadbc40fd9639567938215))
* **engine:** ensure worktree test uses 'main' branch in CI ([adcc202](https://github.com/korchasa/flowai-workflows/commit/adcc202c32650b64c23d7f15fbc9f8131ac21b58))
* **engine:** use PID-only stale lock detection, drop hostname comparison ([1ec9381](https://github.com/korchasa/flowai-workflows/commit/1ec9381cea4024c3cf1c237255c11a8a48bf5ae6))
* ensure newline at end of files in flowai-hooks.json, settings.json, and .flowai.yaml ([e1a396a](https://github.com/korchasa/flowai-workflows/commit/e1a396a4c6dca0e00fb27c23b60bb039b340d2dd))
* executor commits own code, PR bodies include Closes #N for auto-close ([2b48dad](https://github.com/korchasa/flowai-workflows/commit/2b48dad30ecbf4cb5b2fd9d6db3afaf0bfaf9d85))
* **loop:** pass claude_args to loop body nodes ([f596254](https://github.com/korchasa/flowai-workflows/commit/f5962543d9903cef38034ce84637a4d88c67e061))
* **pipeline:** add missing input dependencies for template variables ([dbbfe45](https://github.com/korchasa/flowai-workflows/commit/dbbfe45fca261cfea342713aba341581392c764e))
* **pm:** remove {{args.prompt}} from task_template, improve issue triage ([091e79e](https://github.com/korchasa/flowai-workflows/commit/091e79e17826b2ffdd8d3facaa7fc943eeaee388))
* **qa-prompt:** remove hardcoded artifact paths, follow task prompt Output path ([00ff569](https://github.com/korchasa/flowai-workflows/commit/00ff5691780fdd42696a40c3a08522e0d79d8908))
* resolve all lint/fmt issues, add .env.example and .gitignore ([a13f4b2](https://github.com/korchasa/flowai-workflows/commit/a13f4b25577098beff23a4f7c40194c83dcca6b3))
* **skill:** rename agent-committer to committer and add merge step ([d1880a9](https://github.com/korchasa/flowai-workflows/commit/d1880a959a89b495b1dda096aaf9f0562e8ecb19))
* sync pipeline-task.yaml with pipeline.yaml, add gitleaks allowlist ([564d475](https://github.com/korchasa/flowai-workflows/commit/564d475265e7ffc7ca36775977b8abd814c1d2d6))


### Tests

* **engine,git:** add edge case tests — empty input dir, stat failure, zero-file commit ([191daa9](https://github.com/korchasa/flowai-workflows/commit/191daa93b8a9a0b2cd2daff874c0a66c8fc21394))
* **engine:** add AC6 safety check verbose coverage for allowed_paths ([ed73405](https://github.com/korchasa/flowai-workflows/commit/ed73405695ef235c912eaf418346a8008dc0621b))
* **output:** add AC8 negative test — default mode emits zero verbose output ([14e7c6e](https://github.com/korchasa/flowai-workflows/commit/14e7c6e626cee1d484516ce605fe9ac01141d283))


### Code Refactoring

* consolidate to a single autonomous pipeline, removing dual-pipeline structure and CLI flags ([9f234d6](https://github.com/korchasa/flowai-workflows/commit/9f234d6c5b23a0835cc3e8086894710170a8baf5))
* **docs:** split monolithic requirements and design files into engine and SDLC scopes ([f4ca410](https://github.com/korchasa/flowai-workflows/commit/f4ca410427991436c3ec03c3670c454374fc2662))
* **engine:** move stream log into agent node directory ([#29](https://github.com/korchasa/flowai-workflows/issues/29)) ([649e78b](https://github.com/korchasa/flowai-workflows/commit/649e78bbe677724d039850243a995f0c8cf9df9b))
* housekeeping — remove stale run artifacts, rename skill, add cursorignore ([ca8cb35](https://github.com/korchasa/flowai-workflows/commit/ca8cb35e06296dd9c71c93f422a68b1dd2c8277c))
* migrate pipeline assets to native Claude Code primitives ([33d55a0](https://github.com/korchasa/flowai-workflows/commit/33d55a08fc36dd34f923b22ec40cf22cf05ed4af))
* **pipeline:** consolidate commit nodes and merge presenter into committer ([6ae4c38](https://github.com/korchasa/flowai-workflows/commit/6ae4c38ed12d4bd7493db5e11c09311ae6d2ca4a))
* rename pipeline → workflow in code, configs, and docs ([69bf81e](https://github.com/korchasa/flowai-workflows/commit/69bf81e7590737672eab3b973cdb48a5b13bc8c4))
* rename project flowai-pipelines → flowai-workflow ([87cbfb5](https://github.com/korchasa/flowai-workflows/commit/87cbfb5178c7e1424c147c0b67cd3c9dc9be1e18))
* replace start-in-claude with loop-in-claude, rename run:self to loop ([1144aae](https://github.com/korchasa/flowai-workflows/commit/1144aae2c91f63b984cde29528f998a95172231b))
* **sdlc:** extract shared agent rules, compress SKILL.md prompts ([22b3717](https://github.com/korchasa/flowai-workflows/commit/22b37179c1d21ba4440c7238b8ed036fe397ee66))


### Documentation

* add ADR-001 research — agent context setup method analysis ([c646e67](https://github.com/korchasa/flowai-workflows/commit/c646e67e0a416c9c1c2e1ca3cfda5f060c7bd552))
* add Mermaid architecture diagrams to README, update pipeline table ([d0a8879](https://github.com/korchasa/flowai-workflows/commit/d0a8879a67c9c39494815daa8019e5f2ec87d5e8))
* add requirement-ticket skill and pipeline structure review ([1c794df](https://github.com/korchasa/flowai-workflows/commit/1c794df43a068a2bc1836bac51cc3090d7cb6771))
* delete superseded ADR-001, preserve actionable content in SDS ([d2dc9c8](https://github.com/korchasa/flowai-workflows/commit/d2dc9c8366e56b7a5e965bb264b051b324571ee4))
* **pm, presenter:** enhance SKILL.md with efficiency tips and clarification on artifact creation ([28d8353](https://github.com/korchasa/flowai-workflows/commit/28d8353ce946de6ee66834fba51c9855e24e4df5))
* remove GHA/CI-CD launch method, adopt local Deno engine execution ([205456d](https://github.com/korchasa/flowai-workflows/commit/205456da743e18088ab2904573fc9b8dbcfd1f8b))
* **requirements:** add FR-23 run artifacts folder structure ([77dde7a](https://github.com/korchasa/flowai-workflows/commit/77dde7a41f416233ea9555df360b613642594442))
* **srs:** add FR-17 (directory structure), FR-18 (verbose output), expand FR-1 with text input mode ([d7f8070](https://github.com/korchasa/flowai-workflows/commit/d7f8070b3a392e5def6bc7e7d85d557fc38b1725))


### Chores

* add Phase 0 task file for SRS/SDS cleanup ([a5a6f57](https://github.com/korchasa/flowai-workflows/commit/a5a6f57899088400389740b4758566cd4c8cbe1e))
* add task files for Phases 1-4 ([a9ab599](https://github.com/korchasa/flowai-workflows/commit/a9ab59979dee065a717b2e00986af348539cbf4f))
* add whiteboard to gitignore, update roadmap ([bab7e4d](https://github.com/korchasa/flowai-workflows/commit/bab7e4d55ce8dbce162447b9642034374ee9a543))
* **framework:** update flowai framework ([e555a1a](https://github.com/korchasa/flowai-workflows/commit/e555a1af7a11c20c3d855b36b779f7c39da3d822))
* **framework:** update flowai framework ([dafa468](https://github.com/korchasa/flowai-workflows/commit/dafa468752e0a8228707c685f4b288e6660a67d0))
* Phase 0 — SRS/SDS scope cleanup, AC markers, FR-19 ([ab74fa7](https://github.com/korchasa/flowai-workflows/commit/ab74fa718fe4496a82ce1ca5a996c031e0ed32a8))
* **release:** 0.1.1 ([aca3dac](https://github.com/korchasa/flowai-workflows/commit/aca3dace324028d6c8d9edd099294b690c1c2d1a))
* update claude settings with session permissions ([6a973f9](https://github.com/korchasa/flowai-workflows/commit/6a973f9148fed105cf0987a53d25bc035c007fca))

### 0.1.1 (2026-04-07)


### Features

* add `start-in-claude` deno command to launch app via claude CLI ([af23fe3](https://github.com/korchasa/flowai-workflows/commit/af23fe328e2a83ad78d8f9331d00df4859047c80))
* add agent log storage, claude CLI fixes, task pipeline config ([c7ce8fd](https://github.com/korchasa/flowai-workflows/commit/c7ce8fd5de67cead19f217ab2e334a20a02f61bc))
* add configurable node-based pipeline engine ([e2d757b](https://github.com/korchasa/flowai-workflows/commit/e2d757b33c488297db106e4c5c888f9953e24680))
* add permission flag to claude command in start script ([a02aeb4](https://github.com/korchasa/flowai-workflows/commit/a02aeb442a48f6c5edacebfdf5e28834fb60696b))
* **agent:** replace onOutput with OutputManager in AgentRunOptions ([4e4a57a](https://github.com/korchasa/flowai-workflows/commit/4e4a57a22e18d93e8a128c376987781897139a27))
* **check:** add pipeline integrity validation to deno task check ([d3112e2](https://github.com/korchasa/flowai-workflows/commit/d3112e2636298e8df4a06be70ed991cd020c3015))
* **engine:** add CLI auto-update and automated release pipeline (FR-E41) ([344ea45](https://github.com/korchasa/flowai-workflows/commit/344ea45c35fc150f9b5017ad7ece4dccc4f82913))
* **engine:** add ErrorCategory type for structured node failure classification ([f67bc35](https://github.com/korchasa/flowai-workflows/commit/f67bc35b291728f3a0c1d6b7a4d07404ae4f8e78))
* **engine:** add graceful shutdown — kill child processes on SIGINT/SIGTERM (FR-E25) ([5b3ef14](https://github.com/korchasa/flowai-workflows/commit/5b3ef1404fefe3a46e946517d582be7bf0f03271))
* **engine:** add lock_path option to EngineOptions for test isolation ([4666af1](https://github.com/korchasa/flowai-workflows/commit/4666af1652f893616de6199cb4819412f9f0b151))
* **engine:** add per-node effort level and fallback model configuration ([0730f18](https://github.com/korchasa/flowai-workflows/commit/0730f185e9799a56567d17c3743512c62cc28bff))
* **engine:** add permission_mode config field (FR-E40) ([42d372a](https://github.com/korchasa/flowai-workflows/commit/42d372a47608ce0de2f8421cfa9dbf6cc596c4ec))
* **engine:** add pre_run script support for two-phase config loading (FR-E24) ([56fab5b](https://github.com/korchasa/flowai-workflows/commit/56fab5b05b37f2db83f80982c3e316910c556b03))
* **engine:** add run_always node support for Meta-Agent trigger ([4c0c6d8](https://github.com/korchasa/flowai-workflows/commit/4c0c6d8dcb56607cbdb88b526234b63acb54ab8c))
* **engine:** cache prompt file contents at config load time ([a5d029e](https://github.com/korchasa/flowai-workflows/commit/a5d029ec2ec2776ec8b67087e9f970c37d038b00))
* **engine:** integrate safetyCheckDiff into continuation flow ([acfb7b2](https://github.com/korchasa/flowai-workflows/commit/acfb7b2db6db572f1921274ccb602b496ffbcaa3))
* **engine:** wire verbose output for inputs, safety, commit, agent/loop dispatch ([a759173](https://github.com/korchasa/flowai-workflows/commit/a7591730b1945265a7470468cedfc48a10f7b781))
* **fr-19:** create 9 agent SKILL.md files with frontmatter ([0306348](https://github.com/korchasa/flowai-workflows/commit/0306348e294518f09dd041bce3d44f182e9d898d))
* **fr-19:** create 9 symlinks from .claude/skills/ to agents/ ([dbf098f](https://github.com/korchasa/flowai-workflows/commit/dbf098f69d5a0f85ff68c66d39dbd09b84db5dcf))
* **fr-19:** deferred commit strategy — committer agent replaces auto-commit ([468ebda](https://github.com/korchasa/flowai-workflows/commit/468ebdab5909b88196ed59b8daceeb4672e9604a))
* **fr-19:** fix test fixtures referencing .sdlc/agents/ paths ([8e9730d](https://github.com/korchasa/flowai-workflows/commit/8e9730d8047c0d3f99da812ee53f97d8c8aca4e3))
* **fr-19:** remove .sdlc/agents/ directory after migration ([9f016ad](https://github.com/korchasa/flowai-workflows/commit/9f016adafc0d2babc2fb8425627c526a1e1b1828))
* **fr-19:** update .gitleaks.toml path references for agents/ ([d62c3e2](https://github.com/korchasa/flowai-workflows/commit/d62c3e2b2eeb70674c02d885d363da8a82b25ffd))
* **fr-19:** update pipeline YAML prompt paths to agents/<name>/SKILL.md ([7e63ad5](https://github.com/korchasa/flowai-workflows/commit/7e63ad56599d607dad0dfc49a68e53ed2a7151b6))
* **fr-19:** update SRS path references from .sdlc/agents/ to agents/ ([49fb776](https://github.com/korchasa/flowai-workflows/commit/49fb776b3b3ab701228ae9f7d193e87670f5a2f5))
* **fr-21:** implement Human-in-the-Loop via AskUserQuestion interception ([a0a4e29](https://github.com/korchasa/flowai-workflows/commit/a0a4e294cedd0d4c034b4523b79933284461657a))
* **git:** add gitleaks CLI to safetyCheckDiff ([91a9a0e](https://github.com/korchasa/flowai-workflows/commit/91a9a0e2f1ad54af4f9329ac1bd61e5990b03c3e))
* **git:** enrich CommitResult/SafetyCheckResult return types, add branch() helper ([fb5d311](https://github.com/korchasa/flowai-workflows/commit/fb5d3110438d78c66b0fe40ec24e75bb80aa3f7d))
* **loop:** replace onOutput with OutputManager in LoopRunOptions ([eae9011](https://github.com/korchasa/flowai-workflows/commit/eae90112073b423249e54ba2cfe5fab4a18d9768))
* nest loop body nodes inline in pipeline config ([#18](https://github.com/korchasa/flowai-workflows/issues/18)) ([#24](https://github.com/korchasa/flowai-workflows/issues/24)) ([8d621da](https://github.com/korchasa/flowai-workflows/commit/8d621da3498fe8ada0e2a2e8f7234aec8ec122e0))
* **output:** add 6 verbose methods to OutputManager ([2bdb96f](https://github.com/korchasa/flowai-workflows/commit/2bdb96fbe2a8c383f49570e8155be3587e504a1e))
* **pipeline:** consolidate dual-pipeline into single autonomous pipeline ([421c79c](https://github.com/korchasa/flowai-workflows/commit/421c79cfbc390a1e051ebc1808838510cb28b295))
* **pipeline:** migrate executor check from after hook to custom_script validation ([d02a624](https://github.com/korchasa/flowai-workflows/commit/d02a624e80399143bebdd80ec4334d9b78f264af))
* **pm:** prefer in-progress issues and pull main before triage ([512a3c2](https://github.com/korchasa/flowai-workflows/commit/512a3c266ba6f8ac39029bdf54278f60ee6f8162))
* **pm:** select issues by in-progress label instead of avoiding them ([b7e4ae1](https://github.com/korchasa/flowai-workflows/commit/b7e4ae143e6d491fccdf513591b8813094ad7b94))
* **requirements:** update acceptance criteria for agent prompts and pipeline structure ([3e03fa1](https://github.com/korchasa/flowai-workflows/commit/3e03fa19d79f4d227cb625d30ce2908185f7eed1))
* **scripts:** add self-runner for autonomous issue-driven pipeline execution ([cbcf3de](https://github.com/korchasa/flowai-workflows/commit/cbcf3de11e3a592d3822498fcb736957e90628d7))
* **state:** add label suffix to run IDs for readability ([385b92e](https://github.com/korchasa/flowai-workflows/commit/385b92e70554f549b6e87e805bcc60d2d3aa4db5))
* stream log timestamps — mark FR-32 complete (issue [#42](https://github.com/korchasa/flowai-workflows/issues/42)) ([#58](https://github.com/korchasa/flowai-workflows/issues/58)) ([c93fa47](https://github.com/korchasa/flowai-workflows/commit/c93fa479bc19718b9464c9404db1a178f01aae3b))
* **validate:** add frontmatter_field validation rule type ([635fdb1](https://github.com/korchasa/flowai-workflows/commit/635fdb13f5e312f58fc964d5d8f9f324edc3b18c))
* vendor @std/assert and @std/yaml for environments where jsr.io is blocked ([9c813be](https://github.com/korchasa/flowai-workflows/commit/9c813befc71347803379eeb0e627c2f3003563c9))


### Bug Fixes

* **agents:** remove hardcoded pipeline paths, add resilience to presenter/meta-agent prompts ([9857853](https://github.com/korchasa/flowai-workflows/commit/9857853f822d56a9aa59ba238e2c267c7d4e5bf1))
* **agents:** replace hardcoded pipeline paths with dynamic task message paths ([f73b2ae](https://github.com/korchasa/flowai-workflows/commit/f73b2ae2394c5b4cbf6d84983d2b1c7c4ac64aec))
* **check:** make comment scan mandatory (exit 1 on markers) ([63a51dc](https://github.com/korchasa/flowai-workflows/commit/63a51dc5bcbe9ee778e6e666289299366c8ba3d9))
* **ci:** install gitleaks in CI and handle missing binary gracefully ([8dd6bed](https://github.com/korchasa/flowai-workflows/commit/8dd6bed9635656af23fe81b2598a639ab5ddceb4))
* clarify Claude CLI auth (OAuth primary, API key optional), fix nested session env ([1ed6284](https://github.com/korchasa/flowai-workflows/commit/1ed62844338454280cab5048043f0804930a3213))
* **config:** add allowed_paths to executor node in pipeline.yaml ([f925a79](https://github.com/korchasa/flowai-workflows/commit/f925a79d3991185420de5e63c3cf264034c71292))
* dashboard result summary display (issue [#47](https://github.com/korchasa/flowai-workflows/issues/47)) ([#61](https://github.com/korchasa/flowai-workflows/issues/61)) ([444c43f](https://github.com/korchasa/flowai-workflows/commit/444c43fda2ce50f147ec181723f8e5954bab1e99))
* **engine:** add frontmatter_field to valid config rule types ([9f3f280](https://github.com/korchasa/flowai-workflows/commit/9f3f280d7e9bc21382265dc6ee9422b294b6336f))
* **engine:** add hostname to pipeline lock for cross-host (Docker) safety ([e5d7495](https://github.com/korchasa/flowai-workflows/commit/e5d749550db2f5be9a1c661244bd826a0eb8f261))
* **engine:** code style and unused-ignore fixes ([7e2213d](https://github.com/korchasa/flowai-workflows/commit/7e2213d4030b5b2b73fadbc40fd9639567938215))
* **engine:** use PID-only stale lock detection, drop hostname comparison ([1ec9381](https://github.com/korchasa/flowai-workflows/commit/1ec9381cea4024c3cf1c237255c11a8a48bf5ae6))
* ensure newline at end of files in flowai-hooks.json, settings.json, and .flowai.yaml ([e1a396a](https://github.com/korchasa/flowai-workflows/commit/e1a396a4c6dca0e00fb27c23b60bb039b340d2dd))
* executor commits own code, PR bodies include Closes #N for auto-close ([2b48dad](https://github.com/korchasa/flowai-workflows/commit/2b48dad30ecbf4cb5b2fd9d6db3afaf0bfaf9d85))
* **loop:** pass claude_args to loop body nodes ([f596254](https://github.com/korchasa/flowai-workflows/commit/f5962543d9903cef38034ce84637a4d88c67e061))
* **pipeline:** add missing input dependencies for template variables ([dbbfe45](https://github.com/korchasa/flowai-workflows/commit/dbbfe45fca261cfea342713aba341581392c764e))
* **pm:** remove {{args.prompt}} from task_template, improve issue triage ([091e79e](https://github.com/korchasa/flowai-workflows/commit/091e79e17826b2ffdd8d3facaa7fc943eeaee388))
* **qa-prompt:** remove hardcoded artifact paths, follow task prompt Output path ([00ff569](https://github.com/korchasa/flowai-workflows/commit/00ff5691780fdd42696a40c3a08522e0d79d8908))
* resolve all lint/fmt issues, add .env.example and .gitignore ([a13f4b2](https://github.com/korchasa/flowai-workflows/commit/a13f4b25577098beff23a4f7c40194c83dcca6b3))
* **skill:** rename agent-committer to committer and add merge step ([d1880a9](https://github.com/korchasa/flowai-workflows/commit/d1880a959a89b495b1dda096aaf9f0562e8ecb19))
* sync pipeline-task.yaml with pipeline.yaml, add gitleaks allowlist ([564d475](https://github.com/korchasa/flowai-workflows/commit/564d475265e7ffc7ca36775977b8abd814c1d2d6))


### Tests

* **engine,git:** add edge case tests — empty input dir, stat failure, zero-file commit ([191daa9](https://github.com/korchasa/flowai-workflows/commit/191daa93b8a9a0b2cd2daff874c0a66c8fc21394))
* **engine:** add AC6 safety check verbose coverage for allowed_paths ([ed73405](https://github.com/korchasa/flowai-workflows/commit/ed73405695ef235c912eaf418346a8008dc0621b))
* **output:** add AC8 negative test — default mode emits zero verbose output ([14e7c6e](https://github.com/korchasa/flowai-workflows/commit/14e7c6e626cee1d484516ce605fe9ac01141d283))


### Chores

* add Phase 0 task file for SRS/SDS cleanup ([a5a6f57](https://github.com/korchasa/flowai-workflows/commit/a5a6f57899088400389740b4758566cd4c8cbe1e))
* add task files for Phases 1-4 ([a9ab599](https://github.com/korchasa/flowai-workflows/commit/a9ab59979dee065a717b2e00986af348539cbf4f))
* add whiteboard to gitignore, update roadmap ([bab7e4d](https://github.com/korchasa/flowai-workflows/commit/bab7e4d55ce8dbce162447b9642034374ee9a543))
* **framework:** update flowai framework ([dafa468](https://github.com/korchasa/flowai-workflows/commit/dafa468752e0a8228707c685f4b288e6660a67d0))
* Phase 0 — SRS/SDS scope cleanup, AC markers, FR-19 ([ab74fa7](https://github.com/korchasa/flowai-workflows/commit/ab74fa718fe4496a82ce1ca5a996c031e0ed32a8))
* update claude settings with session permissions ([6a973f9](https://github.com/korchasa/flowai-workflows/commit/6a973f9148fed105cf0987a53d25bc035c007fca))


### Code Refactoring

* consolidate to a single autonomous pipeline, removing dual-pipeline structure and CLI flags ([9f234d6](https://github.com/korchasa/flowai-workflows/commit/9f234d6c5b23a0835cc3e8086894710170a8baf5))
* **docs:** split monolithic requirements and design files into engine and SDLC scopes ([f4ca410](https://github.com/korchasa/flowai-workflows/commit/f4ca410427991436c3ec03c3670c454374fc2662))
* **engine:** move stream log into agent node directory ([#29](https://github.com/korchasa/flowai-workflows/issues/29)) ([649e78b](https://github.com/korchasa/flowai-workflows/commit/649e78bbe677724d039850243a995f0c8cf9df9b))
* housekeeping — remove stale run artifacts, rename skill, add cursorignore ([ca8cb35](https://github.com/korchasa/flowai-workflows/commit/ca8cb35e06296dd9c71c93f422a68b1dd2c8277c))
* migrate pipeline assets to native Claude Code primitives ([33d55a0](https://github.com/korchasa/flowai-workflows/commit/33d55a08fc36dd34f923b22ec40cf22cf05ed4af))
* **pipeline:** consolidate commit nodes and merge presenter into committer ([6ae4c38](https://github.com/korchasa/flowai-workflows/commit/6ae4c38ed12d4bd7493db5e11c09311ae6d2ca4a))
* rename pipeline → workflow in code, configs, and docs ([69bf81e](https://github.com/korchasa/flowai-workflows/commit/69bf81e7590737672eab3b973cdb48a5b13bc8c4))
* rename project flowai-pipelines → flowai-workflow ([87cbfb5](https://github.com/korchasa/flowai-workflows/commit/87cbfb5178c7e1424c147c0b67cd3c9dc9be1e18))
* replace start-in-claude with loop-in-claude, rename run:self to loop ([1144aae](https://github.com/korchasa/flowai-workflows/commit/1144aae2c91f63b984cde29528f998a95172231b))
* **sdlc:** extract shared agent rules, compress SKILL.md prompts ([22b3717](https://github.com/korchasa/flowai-workflows/commit/22b37179c1d21ba4440c7238b8ed036fe397ee66))


### Documentation

* add ADR-001 research — agent context setup method analysis ([c646e67](https://github.com/korchasa/flowai-workflows/commit/c646e67e0a416c9c1c2e1ca3cfda5f060c7bd552))
* add Mermaid architecture diagrams to README, update pipeline table ([d0a8879](https://github.com/korchasa/flowai-workflows/commit/d0a8879a67c9c39494815daa8019e5f2ec87d5e8))
* add requirement-ticket skill and pipeline structure review ([1c794df](https://github.com/korchasa/flowai-workflows/commit/1c794df43a068a2bc1836bac51cc3090d7cb6771))
* delete superseded ADR-001, preserve actionable content in SDS ([d2dc9c8](https://github.com/korchasa/flowai-workflows/commit/d2dc9c8366e56b7a5e965bb264b051b324571ee4))
* **pm, presenter:** enhance SKILL.md with efficiency tips and clarification on artifact creation ([28d8353](https://github.com/korchasa/flowai-workflows/commit/28d8353ce946de6ee66834fba51c9855e24e4df5))
* remove GHA/CI-CD launch method, adopt local Deno engine execution ([205456d](https://github.com/korchasa/flowai-workflows/commit/205456da743e18088ab2904573fc9b8dbcfd1f8b))
* **requirements:** add FR-23 run artifacts folder structure ([77dde7a](https://github.com/korchasa/flowai-workflows/commit/77dde7a41f416233ea9555df360b613642594442))
* **srs:** add FR-17 (directory structure), FR-18 (verbose output), expand FR-1 with text input mode ([d7f8070](https://github.com/korchasa/flowai-workflows/commit/d7f8070b3a392e5def6bc7e7d85d557fc38b1725))
