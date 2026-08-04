# Landing page estatica: sem build, sem dependencias, fora do workspace pnpm.
# Por isso o contexto de build e a propria pasta (nao a raiz do repo, como
# api/web precisam): nada aqui depende do monorepo.
FROM nginx:alpine
COPY public/ /usr/share/nginx/html/
COPY nginx.default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost/healthz || exit 1
CMD ["nginx", "-g", "daemon off;"]
