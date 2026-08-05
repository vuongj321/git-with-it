# syntax=docker/dockerfile:1
FROM rust:1.86-bookworm AS rust-build
WORKDIR /src
COPY Cargo.toml rust-toolchain.toml ./
COPY crates/gwi-git ./crates/gwi-git
RUN cargo build -p gwi-git --release

FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git zstd ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json ./
COPY packages ./packages
COPY apps/worker-ts/package.json ./apps/worker-ts/package.json
RUN pnpm install --filter @gwi/worker-ts... --frozen-lockfile || pnpm install --filter @gwi/worker-ts...

FROM deps AS build
COPY apps/worker-ts ./apps/worker-ts
COPY packages ./packages
RUN pnpm --filter @gwi/shared-types build && pnpm --filter @gwi/worker-ts build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=rust-build /src/target/release/gwi-git /usr/local/bin/gwi-git
COPY --from=build /app/apps/worker-ts/dist ./dist
COPY --from=build /app/apps/worker-ts/package.json ./
COPY --from=build /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]
