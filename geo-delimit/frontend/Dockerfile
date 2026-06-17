FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
ARG REACT_APP_MAPBOX_TOKEN
ARG REACT_APP_API_URL
ENV VITE_MAPBOX_TOKEN=$REACT_APP_MAPBOX_TOKEN
ENV VITE_API_URL=$REACT_APP_API_URL
RUN npm run build
RUN npm install -g serve
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
