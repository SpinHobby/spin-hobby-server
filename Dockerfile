# Spin Hobby API (NestJS)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Same npm major as development machines: Node 22's bundled npm 10 rejects lockfiles written by
# npm 11 ("Missing: ... from lock file"), which silently blocked every deploy.
RUN npm install -g npm@11 && npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Applied on start (see src/database/migrations): keeps the Supabase schema in step with the code.
COPY supabase/migrations ./supabase/migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
