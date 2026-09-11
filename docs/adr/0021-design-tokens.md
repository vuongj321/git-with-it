# ADR 0021: Design tokens (CSS variables)

## Status

Accepted (Phase 3 / Phase 5 polish)

## Context

The product UI needs a single visual language across overview, graph chrome, timeline, metrics, compare, and insights. Hard-coded colors and radii diverge quickly; heatmap coloring has different accessibility constraints than brand chrome.

## Decision

1. **Product chrome tokens** live in `apps/web/src/app/globals.css` under `:root`:
   - Surfaces: `--bg-0`, `--bg-1`, `--bg-2`
   - Text: `--ink`, `--muted`
   - Accents: `--accent`, `--accent-2`, `--danger`
   - Structure: `--line`, `--glow`, `--shadow`, `--radius`
2. **Fonts** are injected as CSS variables from Next.js font loaders in `apps/web/src/app/layout.tsx`:
   - `--font-display` (Newsreader)
   - `--font-sans` (Source Sans 3)
   - `--font-mono` (IBM Plex Mono)
3. Components consume these tokens (and fallbacks) rather than inventing one-off palette values for chrome.
4. **Graph heatmap** does **not** use the purple accent tokens. `ArchitectureGraph` maps metric intensity through a separate **colorblind-safe sequential palette** (blue → amber) so heat reads independently of brand chrome.

## Consequences

- Theme tweaks are centralized in `globals.css` / layout font variables.
- Heatmap and brand accent can evolve independently without breaking either accessibility or brand.
- New UI surfaces should prefer tokens; metric overlays keep sequential/diverging scientific palettes where needed.
