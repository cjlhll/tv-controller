FROM node:20-alpine
WORKDIR /app
COPY cloudfunctions/api/logic.js ./cloudfunctions/api/logic.js
COPY cloud/local-server/server.js ./cloud/local-server/server.js
COPY cloud/local-server/wechat-notify.js ./cloud/local-server/wechat-notify.js
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production
ENV PORT=8787
ENV DATA_FILE=/data/data.json
EXPOSE 8787
USER node
CMD ["node", "cloud/local-server/server.js"]
