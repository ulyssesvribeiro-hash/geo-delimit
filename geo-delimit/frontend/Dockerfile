FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build
RUN npm install -g serve
EXPOSE 3000
CMD sh -c "echo \"window.__ENV__={VITE_API_URL:'$VITE_API_URL'}\" > /app/dist/env.js && serve -s dist -l 3000"
