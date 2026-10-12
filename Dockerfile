FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY dist ./dist
EXPOSE 3100
CMD ["node", "dist/server.js"]
