# WC-001 蓉城战役 WBS 工作系统 —— 非生产回环部署镜像。
# 基础镜像使用本机已缓存的 node slim（构建期不回外网，见 deploy/deploy.sh 的 --network none）。
FROM docker.m.daocloud.io/library/node:24-slim

ENV NODE_ENV=production \
    WBS_HOST=127.0.0.1 \
    WBS_PORT=4180 \
    WBS_DATA_DIR=/app/data

WORKDIR /app

COPY package.json server.js ./
COPY public ./public
COPY data/wbs.seed.json ./data/wbs.seed.json

RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 4180

HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD node -e "require('http').get({host:'127.0.0.1',port:4180,path:'/api/health'},function(r){process.exit(r.statusCode===200?0:1)}).on('error',function(){process.exit(1)})"

CMD ["node", "server.js"]
