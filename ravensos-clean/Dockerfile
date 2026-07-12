# Portable image — works on Railway, Fly.io, or any Docker host.
FROM node:22-slim
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev
COPY backend ./backend
COPY webapp ./webapp
WORKDIR /app/backend
ENV PORT=4000
EXPOSE 4000
CMD ["node", "src/index.js"]
