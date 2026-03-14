# Отчет по обслуживанию (14.03.2026)

## 1. Структурные проблемы

- [ ] README.md:121 - В разделе «Структура проекта» указано, что движок находится в `.sdlc/engine/`, но фактическое расположение - корень `engine/`. (Исправление: Обновить README, указав `engine/` на корневом уровне)
- [ ] `documents/rnd/human-in-the-loop.md` - Исследовательский документ на 18 КБ на русском языке, возможно, устарел (11.03.2026). (Исправление: Подтвердить актуальность; архивировать или удалить, если он заменен реализацией HITL в `engine/hitl.ts`)
- [ ] `.sdlc/runs/*/implementation` - 14 пустых директорий от итераций цикла, которые не дали результата. (Исправление: Очистить; `.gitignore` уже охватывает `.sdlc/runs/`)

## 2. Гигиена и качество

- [ ] `engine/lock_test.ts:143` - Тест "releaseLock - no error if lock file already removed" не содержит проверок (assertions). (Исправление: Добавить явную проверку, например, `assertEquals(await releaseLock(lockPath), undefined)`)
- [ ] `engine/mod.ts` - Файл экспорта (barrel export) никогда не импортируется в рабочем коде или тестах; используется только как цель для проверки типов `run:validate`. (Исправление: Удалить, если не нужен, или задокументировать назначение)
- [ ] `scripts/self_runner.ts:10-12` и `scripts/loop_in_claude.ts:13` - Дублирование функции `nextPause()` (нарушение DRY). (Исправление: Вынести в общий файл `scripts/backoff.ts` и импортировать в обоих местах)
- [ ] `deno.json` задачи `test:pm`, `test:tech-lead` и т. д. - Ссылаются на устаревшие тесты `.sdlc/scripts/stage-*_test.ts`. (Исправление: Проверить, выполняются ли они еще; удалить устаревшие задачи, если они заменены движком)

## 3. Точки сложности (Complexity Hotspots)

- [ ] `engine/agent.ts` - 746 строк (лимит: 500). Основной виновник: `executeClaudeProcess()` на 211 строк с дублирующейся логикой парсинга событий (строки 414-474 ≈ строки 476-520). (Исправление: Вынести вспомогательную функцию `processStreamLine()`)
- [ ] `engine/engine.ts` - 845 строк (limit: 500). Основные виновники: `executeAgentNode()` 171 строка с дублирующимся вызовом HITL (строки 391-405 ≈ 479-493); `runWithLock()` 97 строк с запутанной логикой после конвейера. (Исправление: Вынести обработчик HITL; вынести исполнитель после конвейера)
- [ ] `scripts/generate-dashboard.ts` - `renderHtml()` 88 строк, где группировка фаз смешана с рендерингом. (Исправление: Вынести вспомогательную функцию `groupNodesByPhase()`)

## 4. Технический долг

- В рабочем коде (engine/, scripts/) отсутствуют метки TODO/FIXME/HACK/XXX. В файлах шаблонов (`.claude/skills/flow-engineer-*/scripts/init_*.ts`) есть 8 меток TODO - это намеренные заглушки для пользователей, а не долг.

## 5. Согласованность (Документация vs Код)

- [ ] README.md:5 - В списке агентов указаны "Reviewer, SDS Update, Presenter", но их не существует. Фактические агенты: PM, Architect, Tech Lead, Developer, QA, Tech Lead Review, Meta-Agent (всего 7). (Исправление: Обновить список агентов в README)
- [ ] AGENTS.md:44-45 - В списке агентов указан "Presenter", которого не существует. (Исправление: Привести в соответствие с фактическими 7 агентами)
- [x] AGENTS.md - Указано "3 verbosity levels", исправлено на "4 verbosity levels (`-q`/default/`-s`/`-v`)".
- [x] AGENTS.md - Указано "parallel levels" / "run concurrently", исправлено на "sequential level execution" (параллельности пока нет).
- [ ] README.md:72 - Указано "3 уровня детализации" (verbosity levels), но в реализации их 4 (quiet, normal, semi-verbose, verbose). (Исправление: Обновить до "4 уровней детализации")
- [ ] README.md:77-92 - В разделе CLI-флагов отсутствует флаг `-s`/`--semi-verbose` (реализован в FR-41, `engine/cli.ts:54-56`). (Исправление: Добавить флаг `-s` в документацию CLI)

## 6. Покрытие документацией

### Файлы без JSDoc на уровне модуля
- [ ] `engine/cli.ts` (Исправление: Добавить JSDoc модуля)
- [ ] `scripts/check.ts` (Исправление: Добавить JSDoc модуля)
- [ ] `scripts/claude_stream_formatter.ts` (Исправление: Добавить JSDoc модуля)
- [ ] `scripts/generate-dashboard.ts` (Исправление: Добавить JSDoc модуля)
- [ ] `scripts/self_runner.ts` (Исправление: Добавить JSDoc модуля)

### Модули с самым слабым покрытием JSDoc (много экспортируемых символов не задокументировано)
- [ ] `engine/state.ts` - 15+ экспортируемых функций без JSDoc (createRunState, updateNodeState, markNodeStarted и т. д.). (Исправление: Добавить JSDoc для всех экспортов)
- [ ] `engine/config.ts` - 7 экспортируемых функций без JSDoc (validateSchema, validateNode, validateSettings и т. д.). (Исправление: Добавить JSDoc)
- [ ] `engine/validate.ts` - 6+ экспортируемых функций без JSDoc (runValidations, allPassed, formatFailures и т. д.). (Исправление: Добавить JSDoc)
- [ ] `engine/output.ts` - Класс OutputManager и его методы без JSDoc. (Исправление: Добавить документацию к классу и методам)
- [ ] `engine/cli.ts` - parseArgs, printUsage без JSDoc. (Исправление: Добавить JSDoc)

### Сложные функции без комментариев «почему» (why)
- [ ] `engine/agent.ts:363-573` - `executeClaudeProcess()` 210 строк, сложная асинхронная обработка потока. (Исправление: Добавить комментарии «почему» для стратегии потока, обработки таймаутов, отслеживания чтения файлов)
- [ ] `engine/config.ts:105-250` - `validateNode()` 145 строк, вложенная валидация. (Исправление: Добавить комментарии по стратегии)
- [ ] `engine/engine.ts:124-240` - `runWithLock()` логика перехода между фазами. (Исправление: Добавить комментарии к переходам фаз)
- [ ] `engine/validate.ts:164-228` - `checkFrontmatterField()` парсинг через regex. (Исправление: Добавить комментарии к стратегии парсинга)

## 7. SRS vs Код: расхождения

### Критерии помечены `[ ]`, но реализованы (требуют `[x]` + evidence)
- [ ] FR-1 (Pipeline Trigger) — все 4 критерия реализованы: `deno task run`, `--prompt`, `--resume`/`--dry-run`/`-v`/`-q`/`--config`. Evidence: `engine/cli.ts:36-76`. (Исправление: Пометить `[x]` в SRS)
- [ ] FR-10 (Agent Log Storage) — loop iteration logs реализованы с iteration-qualified именами `<node-id>-iter-<N>`. Evidence: `engine/engine.ts:573-582`. (Исправление: Пометить `[x]` в SRS)
- [ ] FR-24 (Loop Body Node Nesting) — body nodes определены inline в `nodes` sub-object. Evidence: `.sdlc/pipeline.yaml:120-159`. (Исправление: Пометить все критерии `[x]` в SRS)
- [ ] FR-25 (run_on) — `NodeConfig.run_on` реализован, `normalizeRunOn()` в config.ts, фильтрация post-pipeline в engine.ts. Evidence: `engine/types.ts:66`, `engine/config.ts:340-347`, `engine/engine.ts:180-195`. (Исправление: Пометить `[x]` в SRS)
- [ ] FR-28 (Dry-Run Output) — dry-run корректно отображает post-pipeline nodes отдельно. Evidence: `engine/engine.ts:68-92`, `engine/output.ts:173-199`. (Исправление: Пометить `[x]` в SRS)
- [ ] FR-34 (on_failure_script) — реализован: `PipelineDefaults.on_failure_script` в types.ts:23, `runFailureHook()` в engine.ts:808-831, настроен в pipeline.yaml:18. (Исправление: Пометить `[x]` в SRS)

### SRS: устранённые расхождения
- [x] FR-9 (Presenter) — помечен как ABSORBED в SRS. Функционал распределён между Tech Lead и Tech Lead Review. Упоминания Presenter убраны из README.md, AGENTS.md. Legacy-диаграмма в SDS помечена как DEPRECATED.
- [x] FR-30 (Node Result Summary) — отсутствовал в SRS, добавлен как §3.30 с evidence.
- [x] SRS §5 — `--output-format json` исправлен на `--output-format stream-json`.
- [x] SRS §5 — branching `agent/<run-id>` + committer nodes исправлены на `sdlc/issue-<N>` + developer-owned commits.
- [x] SRS §6 — ссылка на Presenter заменена на Tech Lead + Tech Lead Review.
- [x] SRS §2 — "sequentially/in parallel" исправлено на "sequentially".
- [x] Дубликат FR-39 (§3.38, второй экземпляр с `[ ]` маркерами) удалён из SRS.

### Незакрытые FR в SRS (действительно pending)
- FR-17 (Project Directory Structure) — `pipeline.yaml` всё ещё в `.sdlc/`, legacy scripts всё ещё в `.sdlc/scripts/`
- FR-20 (Pipeline Config Drift Detection) — `deno task check:pipeline` не существует, pipeline validation не реализована в `scripts/check.ts`
- FR-23 (Run Artifacts Folder Structure) — phase subdirs не создаются; `getNodeDir()` возвращает плоский путь

## 8. SDS vs Код: расхождения

### SDS описывает нереализованные компоненты
- [x] SDS 3.7 (Phase Registry) — `setPhaseRegistry()`, `clearPhaseRegistry()`, `getPhaseForNode()` описаны в design.md, но НЕ СУЩЕСТВУЮТ в коде. SDS 3.7 помечен как "NOT IMPLEMENTED", ссылки в §3.6 и §5 скорректированы.
- [x] SDS 2.2, 3.6 — ссылки на "parallel levels/dispatch" исправлены на "sequential". SDS 6-7 "Sequential stages" — корректно, параллельности пока нет.

### SDS содержит устаревшие ссылки
- [ ] SDS 2.1 (Legacy Pipeline Diagram) — показывает Stage 3: Reviewer, Stage 4: Architect, Stage 5: SDS Update, Stage 8: Presenter — все удалены/поглощены после FR-26. (Исправление: Добавить пометку "(DEPRECATED — pre-FR-26)" или удалить диаграмму)
- [ ] SDS 3.2 (Stage Scripts) — помечены как DEPRECATED, но `deno.json` всё ещё содержит 9 задач `test:*` для legacy scripts. (Исправление: Удалить legacy test tasks из deno.json или оставить с пометкой)

### SDS: верифицированные компоненты (совпадают)
- types.ts — все заявленные типы (Verbosity 4 values, run_on, phase, env, model, ErrorCategory, cost_usd, HitlConfig) подтверждены
- config.ts — normalizeRunOn(), validateNode(), phases validation — подтверждены
- agent.ts — FileReadTracker, stream-json, formatEventForOutput с verbosity, --model flag — подтверждены
- loop.ts — buildLoopBodyOrder (в dag.ts), LoopResult.bodyResults — подтверждены
- engine.ts — runFailureHook(), resolveInputArtifacts() — подтверждены
- git.ts — удалён как заявлено
- output.ts — 4 verbose-метода присутствуют, verboseSafety/verboseCommit удалены — подтверждено
- Dashboard (3.10) — все 8 функций (readRunState, renderCard, renderHtml, escHtml, computeTimeline, renderTimeline, computeCostBars, renderCostChart) подтверждены
- HITL scripts (3.8) — hitl-ask.sh и hitl-check.sh соответствуют описанию
