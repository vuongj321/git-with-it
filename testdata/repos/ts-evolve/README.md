# Fixture: evolution cycle + rename (logical history)

This directory documents the multi-commit scenarios covered by CI goldens in
`testdata/goldens/evolution-*.json` and `packages/shared-types` unit tests.

## Commit A (`aaa1111`)

- `a.ts` depends on `b.ts` (acyclic)

## Commit B (`bbb2222`)

- Adds `b.ts` → `a.ts` dependency → **cycle_introduced**

## Commit C (`ccc3333`)

- File `src/old.ts` present

## Commit D (`ddd4444`)

- Git rename `src/old.ts` → `src/new.ts` → **rename_detected** (same entity UUID)
