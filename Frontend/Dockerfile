# syntax=docker/dockerfile:1

# ---- Stage 1: prep static files (no build step needed — vanilla JS) -----
FROM alpine:3.19 AS prep
WORKDIR /src
# Copy only the assets we actually need to serve
COPY index.html ./
COPY styles.css ./
COPY app.js ./
COPY config.js ./
# Background images (the file names from styles.css)
COPY *.png ./
COPY *.jpg ./
COPY *.jpeg ./

# ---- Stage 2: nginx serving the assets ----------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine

# Drop nginx config that listens on 80 by default; ours listens on 8080
# (unprivileged image runs as nginx uid 101)
COPY --chown=101:101 nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=prep --chown=101:101 /src /usr/share/nginx/html

EXPOSE 8080

# nginx already runs as non-root in this image
CMD ["nginx", "-g", "daemon off;"]
