#!/usr/bin/env bash
set -euo pipefail

if [[ ! "${IMAGE:-}" =~ ^[a-z0-9][a-z0-9._-]*/api-ci-cd:[0-9a-f]{40}$ ]]; then
  echo "IMAGE must be a Docker Hub api-ci-cd image tagged with a full commit SHA." >&2
  exit 1
fi

state_file=/opt/api-ci-cd/active-slot
upstream_file=/etc/nginx/conf.d/api-upstream.conf
active_slot=$(cat "$state_file" 2>/dev/null || printf 'blue')

if [ "$active_slot" = "blue" ]; then
  target_slot=green
  target_port=8082
  previous_container=api-blue
else
  target_slot=blue
  target_port=8081
  previous_container=api-green
fi

target_container="api-$target_slot"
sudo docker pull "$IMAGE"
sudo docker rm -f "$target_container" >/dev/null 2>&1 || true
sudo docker run -d --name "$target_container" --restart unless-stopped \
  -p "127.0.0.1:$target_port:3000" "$IMAGE"

healthy=0
for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:$target_port/api/health"; then
    healthy=1
    break
  fi
  sleep 2
done

if [ "$healthy" -ne 1 ]; then
  sudo docker logs "$target_container" || true
  sudo docker rm -f "$target_container"
  echo "New container failed its health check; the active version was not changed." >&2
  exit 1
fi

previous_upstream=$(mktemp)
sudo cp "$upstream_file" "$previous_upstream"
restore_previous_upstream() {
  sudo cp "$previous_upstream" "$upstream_file"
  sudo nginx -t && sudo systemctl reload nginx
  sudo docker rm -f "$target_container" >/dev/null 2>&1 || true
}

printf 'upstream api_backend {\n    server 127.0.0.1:%s;\n    keepalive 16;\n}\n' \
  "$target_port" | sudo tee "$upstream_file" >/dev/null

if ! sudo nginx -t; then
  restore_previous_upstream
  sudo rm -f "$previous_upstream"
  exit 1
fi

if ! sudo systemctl reload nginx; then
  restore_previous_upstream
  sudo rm -f "$previous_upstream"
  exit 1
fi

if ! curl --fail --silent --retry 5 --retry-delay 1 http://127.0.0.1/api/health; then
  restore_previous_upstream
  sudo rm -f "$previous_upstream"
  exit 1
fi

printf '%s\n' "$target_slot" | sudo tee "$state_file" >/dev/null
sudo rm -f "$previous_upstream"
sudo docker rm -f "$previous_container" >/dev/null 2>&1 || true

echo "Deployed $IMAGE to $target_slot; Nginx health check passed."
