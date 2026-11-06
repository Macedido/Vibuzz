# Build from the repository root:  docker build -f apps/api/Dockerfile -t vibuzz-api .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @vibuzz/api --workspace @vibuzz/shared --include-workspace-root=false --ignore-scripts
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @vibuzz/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @vibuzz/api --include-workspace-root=false --ignore-scripts && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
USER node
EXPOSE 8787
CMD ["node", "apps/api/dist/index.js"]
