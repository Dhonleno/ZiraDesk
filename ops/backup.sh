#!/usr/bin/env bash
set -Eeuo pipefail

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ziradesk-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-ziradesk}"
R2_REMOTE="${R2_REMOTE:-r2:ziradesk-backups}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/home/deploy/.config/rclone/rclone.conf}"
LOG_FILE="${LOG_FILE:-/home/deploy/ziradesk-backup.log}"

: "${UPLOADS_DIR:?Defina UPLOADS_DIR com o caminho dos uploads persistentes}"

timestamp="$(date +%Y-%m-%d_%H-%M-%S)"
tmp_dir="$(mktemp -d)"
postgres_file="postgres_${timestamp}.dump"
uploads_file="uploads_${timestamp}.tar.gz"

cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

log() {
  mkdir -p "$(dirname "${LOG_FILE}")"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "${LOG_FILE}"
}

run_rclone() {
  rclone "$@" --config "${RCLONE_CONFIG}"
}

log "Iniciando backup do ZiraDesk"

log "Gerando dump PostgreSQL (${POSTGRES_CONTAINER}/${POSTGRES_DB})"
docker exec "${POSTGRES_CONTAINER}" \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc \
  > "${tmp_dir}/${postgres_file}"

log "Compactando uploads (${UPLOADS_DIR})"
tar -czf "${tmp_dir}/${uploads_file}" -C "$(dirname "${UPLOADS_DIR}")" "$(basename "${UPLOADS_DIR}")"

log "Enviando backup diario para ${R2_REMOTE}"
run_rclone copy "${tmp_dir}/${postgres_file}" "${R2_REMOTE}/daily/postgres/"
run_rclone copy "${tmp_dir}/${uploads_file}" "${R2_REMOTE}/daily/uploads/"

if [ "$(date +%d)" = "01" ]; then
  month="$(date +%Y-%m)"
  log "Enviando backup mensal para ${R2_REMOTE}/monthly/${month}"
  run_rclone copy "${tmp_dir}/${postgres_file}" "${R2_REMOTE}/monthly/${month}/postgres/"
  run_rclone copy "${tmp_dir}/${uploads_file}" "${R2_REMOTE}/monthly/${month}/uploads/"
fi

log "Aplicando retencao dos backups diarios"
run_rclone delete "${R2_REMOTE}/daily/postgres/" --min-age 7d
run_rclone delete "${R2_REMOTE}/daily/uploads/" --min-age 7d
run_rclone rmdirs "${R2_REMOTE}/daily/"

log "Aplicando retencao dos backups mensais"
run_rclone delete "${R2_REMOTE}/monthly/" --min-age 120d
run_rclone rmdirs "${R2_REMOTE}/monthly/"

log "Backup concluido com sucesso"
