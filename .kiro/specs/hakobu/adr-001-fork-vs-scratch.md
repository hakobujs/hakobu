# ADR-001: Fork `@yao-pkg/pkg` Instead of Starting From Scratch

## Status

Accepted

## Context

Hakobu needs to solve two hard problems at once:

- support `Node 24.x` LTS
- add full native ESM support to a `pkg`-style executable runtime

The project also needs to preserve the core strengths of the historical `pkg`
model:

- patched Node runtime
- packaged snapshot filesystem
- cross-platform executable assembly
- compatibility with Node child-process behavior

Starting from scratch would require rebuilding all of those foundations before
the team could even validate the new ESM and runtime semantics.

## Decision

Hakobu will start from forks of:

- `@yao-pkg/pkg`
- `@yao-pkg/pkg-fetch`

The forks may be refactored aggressively. This is not a promise to preserve the
entire inherited architecture unchanged. It is a decision to reuse the existing
runtime-packaging foundation rather than recreate it from zero.

## Rationale

### Why Not Start From Scratch

Starting from scratch would increase risk in the wrong areas:

- more time spent rebuilding executable assembly mechanics
- more time spent rebuilding patched-base tooling
- less early proof on Node 24 and ESM
- no compatibility bridge for existing `pkg` users

### Why Forking Is Better

Forking retains useful assets:

- target model and naming conventions
- runtime base build workflow
- snapshot filesystem lineage
- a CLI mental model familiar to `pkg` users

This lets the project focus on the differentiators:

- modern Node 24 support
- native ESM execution
- stronger process compatibility on Windows

## Consequences

### Positive

- faster path to a usable alpha
- lower implementation risk for executable assembly
- easier migration story for existing users
- clearer compatibility proof against current `pkg` expectations

### Negative

- inherited technical debt from the `pkg` line
- inherited security and maintenance burden
- possible need for invasive refactors in inherited bootstrap code
- possible divergence from legacy behaviors that some users expect

## Follow-Up Rules

1. Fork debt is acceptable only if it does not block Node 24 or native ESM.
2. Inherited behavior is preserved when it helps compatibility and does not
   conflict with the new goals.
3. If a forked subsystem becomes harder to modernize than replace, it may be
   rewritten behind the forked public contract.
4. Every major divergence from inherited `pkg` behavior should be documented in
   a new ADR or release note.

