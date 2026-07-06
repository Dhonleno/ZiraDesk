#!/usr/bin/env bash
set -euo pipefail

# ==============================
# Variaveis customizaveis
# ==============================
DEPLOY_USER="${DEPLOY_USER:-deploy}"
SSH_PUB_KEY="${SSH_PUB_KEY:-COLE_SUA_CHAVE_PUBLICA_AQUI}"
TIMEZONE="${TIMEZONE:-America/Sao_Paulo}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"
AUTO_CONFIRM="${AUTO_CONFIRM:-false}"

log() {
  printf '\n[INFO] %s\n' "$1"
}

warn() {
  printf '\n[WARN] %s\n' "$1" >&2
}

confirm() {
  local message="$1"

  if [[ "${AUTO_CONFIRM}" == "true" ]]; then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    warn "Execucao nao interativa sem AUTO_CONFIRM=true. Abortando por seguranca."
    exit 1
  fi

  read -r -p "${message} [y/N]: " answer
  case "${answer}" in
    y|Y|yes|YES) ;;
    *)
      warn "Operacao cancelada pelo usuario."
      exit 1
      ;;
  esac
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "Este script precisa ser executado como root (ou via sudo)." >&2
    exit 1
  fi
}

validate_inputs() {
  if [[ -z "${SSH_PUB_KEY}" || "${SSH_PUB_KEY}" == "COLE_SUA_CHAVE_PUBLICA_AQUI" ]]; then
    echo "Defina SSH_PUB_KEY com sua chave publica antes de executar o script." >&2
    exit 1
  fi
}

set_sshd_option() {
  local key="$1"
  local value="$2"
  local file="/etc/ssh/sshd_config"

  if grep -Eq "^[#[:space:]]*${key}[[:space:]]+" "${file}"; then
    sed -ri "s|^[#[:space:]]*${key}[[:space:]].*|${key} ${value}|g" "${file}"
  else
    echo "${key} ${value}" >> "${file}"
  fi
}

configure_sudoers_nopasswd() {
  local sudoers_file="/etc/sudoers.d/90-${DEPLOY_USER}-nopasswd"
  local sudoers_line="${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL"

  echo "${sudoers_line}" > "${sudoers_file}"
  chmod 440 "${sudoers_file}"
  visudo -cf "${sudoers_file}" >/dev/null
}

install_base_packages() {
  log "Atualizando pacotes e instalando dependencias base..."
  apt update
  apt upgrade -y
  apt install -y curl wget vim htop ufw fail2ban unattended-upgrades ca-certificates gnupg lsb-release
}

create_deploy_user() {
  log "Garantindo usuario de deploy e acesso SSH..."

  if id -u "${DEPLOY_USER}" >/dev/null 2>&1; then
    log "Usuario ${DEPLOY_USER} ja existe. Mantendo."
  else
    useradd -m -s /bin/bash "${DEPLOY_USER}"
    log "Usuario ${DEPLOY_USER} criado."
  fi

  usermod -aG sudo "${DEPLOY_USER}"
  configure_sudoers_nopasswd

  local ssh_dir="/home/${DEPLOY_USER}/.ssh"
  local auth_keys="${ssh_dir}/authorized_keys"
  mkdir -p "${ssh_dir}"
  touch "${auth_keys}"

  if ! grep -qxF "${SSH_PUB_KEY}" "${auth_keys}"; then
    echo "${SSH_PUB_KEY}" >> "${auth_keys}"
    log "Chave publica adicionada em ${auth_keys}."
  else
    log "Chave publica ja presente em ${auth_keys}."
  fi

  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "${ssh_dir}"
  chmod 700 "${ssh_dir}"
  chmod 600 "${auth_keys}"
}

harden_ssh() {
  log "Aplicando hardening do SSH..."
  local sshd_file="/etc/ssh/sshd_config"

  cp -a "${sshd_file}" "${sshd_file}.bak.$(date +%Y%m%d%H%M%S)"

  set_sshd_option "PermitRootLogin" "no"
  set_sshd_option "PasswordAuthentication" "no"
  set_sshd_option "PubkeyAuthentication" "yes"
  set_sshd_option "Port" "22"
  set_sshd_option "X11Forwarding" "no"
  set_sshd_option "MaxAuthTries" "3"
  set_sshd_option "ClientAliveInterval" "300"
  set_sshd_option "ClientAliveCountMax" "2"

  sshd -t
  systemctl restart ssh
}

configure_ufw() {
  log "Configurando firewall UFW..."
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow 22/tcp
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
}

configure_fail2ban() {
  log "Configurando fail2ban para SSH..."
  local jail_file="/etc/fail2ban/jail.d/sshd.local"

  cat > "${jail_file}" <<'EOF'
[sshd]
enabled = true
maxretry = 3
findtime = 600
bantime = 3600
EOF

  systemctl enable --now fail2ban
  systemctl restart fail2ban
}

configure_unattended_upgrades() {
  log "Configurando unattended-upgrades (apenas updates de seguranca, sem reboot automatico)..."

  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

  cat > /etc/apt/apt.conf.d/52zira-unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
        "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
EOF
}

install_docker() {
  log "Instalando Docker Engine e Docker Compose Plugin..."
  install -m 0755 -d /etc/apt/keyrings

  if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi

  local arch
  arch="$(dpkg --print-architecture)"
  local codename
  codename="$(. /etc/os-release && echo "${VERSION_CODENAME}")"

  cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codename} stable
EOF

  apt update
  apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  systemctl enable --now docker
  usermod -aG docker "${DEPLOY_USER}"
}

configure_swap() {
  log "Garantindo swap de ${SWAP_SIZE_GB}GB em /swapfile..."

  if swapon --show=NAME --noheadings | grep -qx "/swapfile"; then
    log "Swapfile /swapfile ja esta ativo. Mantendo."
  else
    if [[ ! -f /swapfile ]]; then
      fallocate -l "${SWAP_SIZE_GB}G" /swapfile
      chmod 600 /swapfile
      mkswap /swapfile
    fi
    swapon /swapfile
  fi

  if ! grep -Eq '^/swapfile[[:space:]]+none[[:space:]]+swap[[:space:]]+sw[[:space:]]+0[[:space:]]+0$' /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi
}

configure_timezone() {
  log "Configurando timezone para ${TIMEZONE}..."
  timedatectl set-timezone "${TIMEZONE}"
}

final_validation() {
  log "Validacao final:"

  echo "Docker: $(docker --version)"
  echo "Docker Compose: $(docker compose version)"
  echo
  echo "UFW status:"
  ufw status verbose
  echo
  echo "Fail2ban status:"
  fail2ban-client status sshd || fail2ban-client status
  echo
  echo "IP publico da VPS:"
  curl -fsS https://api.ipify.org || curl -fsS https://ifconfig.me
  echo
}

main() {
  require_root
  validate_inputs

  confirm "Este script vai aplicar hardening de SSH/UFW/fail2ban, instalar Docker e alterar swap. Deseja continuar?"

  install_base_packages
  create_deploy_user
  harden_ssh
  configure_ufw
  configure_fail2ban
  configure_unattended_upgrades
  install_docker
  configure_swap
  configure_timezone
  final_validation

  log "Bootstrap finalizado com sucesso. Nenhum reboot foi executado."
}

main "$@"
