FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY certs ./certs
COPY public ./public
COPY database ./database
COPY scripts ./scripts
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["npm", "start"]
