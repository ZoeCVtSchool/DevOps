#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta este script con sudo: sudo bash ec2/bootstrap.sh" >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io nginx curl
systemctl enable --now docker nginx

cat > /etc/nginx/conf.d/api-upstream.conf <<'EOF'
upstream api_backend {
    server 127.0.0.1:8081;
    keepalive 16;
}
EOF

cat > /etc/nginx/sites-available/api-ci-cd <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location / {
        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/api-ci-cd /etc/nginx/sites-enabled/api-ci-cd

deploy_user="${SUDO_USER:-ubuntu}"
install -d -o "$deploy_user" -g "$deploy_user" /opt/api-ci-cd
printf 'blue\n' > /opt/api-ci-cd/active-slot
chown "$deploy_user:$deploy_user" /opt/api-ci-cd/active-slot

nginx -t
systemctl reload nginx
echo "EC2 preparado. El primer despliegue publicará la API en el puerto 80."
