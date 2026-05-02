<!-- ADR template — copy to documents/adrs/<NNNN>-<kebab-title>.md
     Numbering: 4-digit, monotonic, no gaps. Status field MUST be exactly
     one of: Proposed | Accepted | Superseded by ADR-NNNN. Required sections
     (in this order, exact wording, level-2): Status, Context, Decision,
     Consequences, Alternatives Considered. Enforced by
     `scripts/check.ts::validateAdrSet`. -->

# ADR-NNNN: <Short Title in Sentence Case>

## Status

Proposed

## Context

<Problem statement first. What forces (technical, organisational,
historical) make this decision necessary right now? Quote the concrete
incident or constraint that triggered it; link to FR-E<N> / FR-S<N> /
issue numbers. No solution prose here.>

## Decision

<The position taken, in active voice. State what we DO now, not what
we considered. Cite the file paths or commits that embody the decision.>

## Consequences

<Both positive and negative. What becomes easier? What becomes harder?
What invariants must future code uphold to keep the decision intact?
List concrete enforcement points (lint rules, audit tests).>

## Alternatives Considered

<Each alternative as a sub-bullet with a one-line "rejected because"
rationale. Keep it short — this is not a full comparison matrix, just
the record of paths NOT taken so future readers don't re-derive them.>
