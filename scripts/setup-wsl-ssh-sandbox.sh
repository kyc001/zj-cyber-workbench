#!/usr/bin/env bash
set -euo pipefail

SANDBOX_USER="${ZJ_WSL_SANDBOX_USER:-zj_sandbox}"
SSH_PORT="${ZJ_WSL_SANDBOX_PORT:-2222}"
SECRET_FILE="${ZJ_WSL_SANDBOX_SECRET_FILE:-$HOME/.zj-wsl-sandbox-ssh.env}"
SSHD_CONFIG="/etc/ssh/sshd_config.d/zj-wsl-sandbox.conf"

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required." >&2
  exit 1
fi

if ! id -u "$SANDBOX_USER" >/dev/null 2>&1; then
  sudo adduser --disabled-password --gecos "" "$SANDBOX_USER"
fi

PASSWORD="$(openssl rand -base64 24 | tr -d '\n')"
printf '%s:%s\n' "$SANDBOX_USER" "$PASSWORD" | sudo chpasswd

sudo mkdir -p "/home/$SANDBOX_USER/workspace"
sudo chown -R "$SANDBOX_USER:$SANDBOX_USER" "/home/$SANDBOX_USER"
sudo chmod 700 "/home/$SANDBOX_USER"
sudo chmod 700 "/home/$SANDBOX_USER/workspace"

if ! command -v sshd >/dev/null 2>&1; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openssh-server
fi

missing_tools=()
for tool in nmap sqlmap; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    missing_tools+=("$tool")
  fi
done
if ((${#missing_tools[@]} > 0)); then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing_tools[@]}"
fi

sudo mkdir -p /run/sshd /etc/ssh/sshd_config.d
sudo tee "$SSHD_CONFIG" >/dev/null <<EOF
Port $SSH_PORT
ListenAddress 0.0.0.0
PasswordAuthentication yes
PubkeyAuthentication yes
PermitRootLogin no

Match User $SANDBOX_USER
    X11Forwarding no
    AllowTcpForwarding no
    PermitTunnel no
    PermitTTY yes
    PasswordAuthentication yes
EOF

sudo sshd -t
if command -v systemctl >/dev/null 2>&1 && systemctl is-system-running >/dev/null 2>&1; then
  sudo systemctl restart ssh
else
  sudo service ssh restart
fi

WSL_IP="$(hostname -I | awk '{print $1}')"
umask 077
cat >"$SECRET_FILE" <<EOF
ZJ_WSL_SANDBOX_USER=$SANDBOX_USER
ZJ_WSL_SANDBOX_PASSWORD=$PASSWORD
ZJ_WSL_SANDBOX_PORT=$SSH_PORT
ZJ_WSL_SANDBOX_IP=$WSL_IP
ZJ_WSL_SANDBOX_DIRECT_SSH=ssh $SANDBOX_USER@$WSL_IP -p $SSH_PORT
ZJ_WSL_SANDBOX_PORTPROXY_SSH=ssh $SANDBOX_USER@127.0.0.1 -p $SSH_PORT
EOF
chmod 600 "$SECRET_FILE"

cat <<EOF
WSL SSH sandbox is ready.

User: $SANDBOX_USER
Port: $SSH_PORT
WSL IP: $WSL_IP
Secret file: $SECRET_FILE

Use this in ZJ managed host:
- ip_address=$WSL_IP, ssh_port=$SSH_PORT, host_account=$SANDBOX_USER
  or, after Windows portproxy:
- ip_address=127.0.0.1, ssh_port=$SSH_PORT, host_account=$SANDBOX_USER

Read the generated password with:
  sed -n 's/^ZJ_WSL_SANDBOX_PASSWORD=//p' "$SECRET_FILE"
EOF
