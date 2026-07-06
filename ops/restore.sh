#!/usr/bin/env bash
set -Eeuo pipefail

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-ziradesk-postgres}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-ziradesk}"
R2_REMOTE="${R2_REMOTE:-r2:ziradesk-backups}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/home/deploy/.config/rclone/rclone.conf}"
LOG_FILE="${LOG_FILE:-/home/deploy/ziradesk-backup.log}"

usage() {
  cat <<'USAGE'
Uso:
  ./ops/restore.sh /caminho/postgres_YYYY-MM-DD_HH-MM-SS.dump [uploads_YYYY-MM-DD_HH-MM-SS.tar.gz]

Variaveis opcionais:
  POSTGRES_CONTAINER, POSTGRES_USER, POSTGRES_DB, UPLOADS_DIR, R2_REMOTE, RCLONE_CONFIG, LOG_FILE
USAGE
}

postgres_dump_arg="${1:-}"
uploads_archive_arg="${2:-}"
tmp_dir="$(mktemp -d)"

cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

if [ -z "${postgres_dump_arg}" ]; then
  usage
  exit 1
fi

log() {
  mkdir -p "$(dirname "${LOG_FILE}")"
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "${LOG_FILE}"
}

run_rclone() {
  rclone "$@" --config "${RCLONE_CONFIG}"
}

resolve_backup_file() {
  local source="$1"
  local destination="${tmp_dir}/$(basename "${source}")"

  if [ -f "${source}" ]; then
    printf '%s\n' "${source}"
    return
  fi

  if [[ "${source}" == *:* ]]; then
    run_rclone copyto "${source}" "${destination}"
  else
    run_rclone copyto "${R2_REMOTE}/${source}" "${destination}"
  fi

  if [ ! -f "${destination}" ]; then
    echo "Arquivo nao encontrado: ${source}" >&2
    exit 1
  fi

  printf '%s\n' "${destination}"
}

postgres_dump="$(resolve_backup_file "${postgres_dump_arg}")"
uploads_archive=""
if [ -n "${uploads_archive_arg}" ]; then
  uploads_archive="$(resolve_backup_file "${uploads_archive_arg}")"
fi

confirm_restore() {
  echo "ATENCAO: esta operacao substitui dados do banco ${POSTGRES_DB} no container ${POSTGRES_CONTAINER}."
  if [ -n "${uploads_archive}" ]; then
    : "${UPLOADS_DIR:?Defina UPLOADS_DIR para restaurar uploads}"
    echo "Uploads tambem serao restaurados em ${UPLOADS_DIR}."
  fi
  printf 'Digite "restore" para confirmar: '
  read -r confirmation
  if [ "${confirmation}" != "restore" ]; then
    echo "Restore cancelado."
    exit 1
  fi
}

confirm_restore

log "Iniciando restore do PostgreSQL a partir de ${postgres_dump}"
docker exec -i "${POSTGRES_CONTAINER}" \
  pg_restore --clean --if-exists --no-owner --no-privileges \
  -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  < "${postgres_dump}"
log "Restore do PostgreSQL concluido"

if [ -n "${uploads_archive}" ]; then
  if [ ! -f "${uploads_archive}" ]; then
    echo "Arquivo de uploads nao encontrado: ${uploads_archive}" >&2
    exit 1
  fi

  log "Restaurando uploads a partir de ${uploads_archive}"
  mkdir -p "${UPLOADS_DIR}"
  tar -xzf "${uploads_archive}" -C "$(dirname "${UPLOADS_DIR}")"
  log "Restore de uploads concluido"
fi

log "Restore concluido com sucesso"
