# Цикл разработки auto-flow: Догфудинг

## Goal

Определить как разрабатывать auto-flow используя его же pipeline. Избежать
chicken-and-egg проблемы. Получить рабочий цикл: issue → pipeline → PR → merge.

## Overview

### Context

auto-flow — multi-agent pipeline автоматизирующий SDLC. Состоит из 9 stages
(PM → Tech Lead → Reviewer → Architect → Tech Lead SDS → Executor+QA →
Presenter → Meta-Agent). Каждый stage — shell-скрипт вызывающий `claude` CLI с
role-specific промптом.

Проблема: pipeline ещё не реализован. Нужно одновременно создавать pipeline и
тестировать его на реальных задачах. Решение: поэтапный догфудинг — сначала
ручное выполнение stages, затем постепенная автоматизация.

### Current State

- SRS: полностью описан (`documents/requirements.md`, 470 строк, 16 FR)
- SDS: полностью описан (`documents/design.md`, 148 строк)
- Инфраструктура: `scripts/check.ts`, `deno.json`, `.claude/` workspace
- Реализация stages: **0%** — ни одного shell-скрипта, Dockerfile, GHA workflow

### Constraints

- Стек: Deno, Shell/Bash, Docker, GHA, Claude CLI, `gh` CLI
- Agents stateless — весь контекст из file artifacts
- Sequential stages, no parallelism
- Max 3 QA iterations, max 3 continuations per stage

## Definition of Done

- [x] Определён порядок реализации stages
- [x] Определён формат "ручного" выполнения stages (пока pipeline не готов)
- [x] Определены issues для первого прогона pipeline
- [x] Определён критерий "pipeline работает" (переход на полный автомат)
- [x] План зафиксирован в whiteboard, одобрен пользователем

## Solution

### Фаза 0: Bootstrapping (ручной режим)

Порядок реализации stages определяется зависимостями. Первые stages можно
запускать вручную через `claude` CLI ещё до написания shell-скриптов.

**Порядок реализации:**

1. **lib.sh** — shared функции (log, run_agent, validate_artifact и др.)
   - Фундамент: все stage-скрипты зависят от него
2. **Stage 1 (PM)** — вход: issue text, выход: specification.md
   - Самый простой stage, нет зависимостей от предыдущих stages
3. **Stage 2 (Tech Lead)** — вход: specification.md, выход: plan.md
4. **Stage 3 (Reviewer)** — вход: plan.md, выход: ревизия plan.md
5. **Stage 4 (Architect)** — вход: plan.md, выход: decision (variant selection)
6. **Stage 5 (Tech Lead SDS)** — вход: plan+decision, выход: обновлённый SDS
7. **Stages 6-7 (Executor+QA)** — ядро: implementation loop
8. **Stage 8 (Presenter)** — PR creation
9. **Stage 9 (Meta-Agent)** — prompt optimization
10. **Dockerfile** — сборка image
11. **GHA workflow** — trigger по label, оркестрация stages

**Ручной прогон (до готовности shell-скриптов):**

```bash
# Создать pipeline директорию
mkdir -p .sdlc/pipeline/1

# Stage 1: PM
claude --append-system-prompt-file .sdlc/agents/pm.md \
  --output-format json \
  -p "Issue #1: <issue text>" > .sdlc/pipeline/1/specification.md

# Stage 2: Tech Lead (после готовности Stage 1)
claude --append-system-prompt-file .sdlc/agents/tech-lead.md \
  --output-format json \
  -p "$(cat .sdlc/pipeline/1/specification.md)" > .sdlc/pipeline/1/plan.md

# ... и так далее
```

### Фаза 1: Первые issues для догфудинга

Issues для тестирования pipeline (от простых к сложным):

1. **Issue: "Создать lib.sh с функцией log()"**
   - Тривиальная задача, 1 файл, 1 функция
   - Идеально для проверки Stage 1-2 (PM + Tech Lead)
2. **Issue: "Добавить функцию validate_artifact() в lib.sh"**
   - Немного сложнее: нужна валидация файлов, тесты
   - Проверяет Executor+QA loop
3. **Issue: "Создать stage-1-pm.sh"**
   - Первый полноценный stage-скрипт
   - Зависит от lib.sh — проверяет архитектурные решения
4. **Issue: "Создать Dockerfile"**
   - Интеграционная задача: docker build + тесты

### Фаза 2: Замыкание цикла

Когда stages 1-8 работают через shell-скрипты:

1. Создать GHA workflow
2. Повесить label на issue в GitHub
3. Pipeline запускается автоматически
4. PR создаётся ботом
5. Human review → merge

**Критерий "pipeline работает":** 3 consecutive issues обработаны
автоматически, PR прошли review без критических замечаний.

### Фаза 3: Полный догфудинг

Все новые фичи auto-flow разрабатываются через pipeline:
- Issue с label → автоматический pipeline → PR → review → merge
- Meta-Agent (Stage 9) оптимизирует промпты после каждого прогона
- Ручное вмешательство только на этапе PR review

### Риски и митигация

- **Рекурсивная поломка:** pipeline ломает код auto-flow → pipeline перестаёт
  работать
  - Митигация: PR review как единственный human gate. Не мержить PR, ломающие
    pipeline
  - Митигация: CI проверяет `deno task check` ДО merge
- **Complexity ceiling:** pipeline не справляется со сложными issues auto-flow
  - Митигация: декомпозировать сложные issues на простые
  - Митигация: Meta-Agent улучшает промпты итеративно
