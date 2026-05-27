# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# FFmpeg/libass needs fontconfig and real fonts to burn ASS subtitles.
RUN apk add --no-cache fontconfig ttf-dejavu ttf-liberation
ENV CONTRACT_FONT_PATH=/usr/share/fonts/TTF/DejaVuSans.ttf
ENV CONTRACT_BOLD_FONT_PATH=/usr/share/fonts/TTF/DejaVuSans-Bold.ttf

# Copy built assets and dependencies from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/proto ./proto
COPY --from=builder /app/server.js ./server.js

# Expose ports (Express and gRPC)
EXPOSE 1905
EXPOSE 50051

# Start the server
CMD ["node", "server.js"]
