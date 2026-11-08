#!/usr/bin/env bash
# Forced command for the production deploy key. sshd runs this instead of
# whatever the client asked for, so the key can do exactly two things:
#
#   deploy <full-commit-sha>   build and start a commit that is on main
#   health                     wait for the app's loopback health endpoint
#
# Everything else is refused: no shell, no file transfer, and (with `restrict`
# on the key line) no port forwarding. Setup is in docs/deploy.md.
#
# Install (as root). Do NOT point sshd at the copy in the clone: the clone is
# writable by the deploy user, so that copy can't restrict anything.
#   sudo install -o root -g root -m 755 ops/deploy/muster-deploy.sh /usr/local/bin/muster-deploy
#
# Changes here reach the server only by reinstalling; a deploy doesn't do it.
set -euo pipefail

REPO_DIR=/opt/muster
HEALTH_URL=http://127.0.0.1:3000/api/health
BUILD_CACHE_LIMIT=20GB

refuse() {
  echo "muster-deploy: $1" >&2
  exit 1
}

deploy() {
  local sha=$1
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || refuse "expected a full commit SHA"

  cd "$REPO_DIR"
  git fetch --tags --force origin
  # Only commits on main can ship, so a leaked key can't deploy a stray branch.
  git merge-base --is-ancestor "$sha" origin/main 2>/dev/null ||
    refuse "$sha is not on main"
  git checkout --detach "$sha"
  docker compose up -d --build

  # Drop dangling images from previous builds so the disk doesn't fill.
  docker image prune -f
  # Cap the build cache, but never touch cache mounts: the npm one holds the
  # Font Awesome kit, whose registry bills by bandwidth (see the Dockerfile).
  # The new container is already running, so a failure here is only a warning.
  docker buildx prune -f --max-used-space "$BUILD_CACHE_LIMIT" \
    --filter "type!=exec.cachemount" ||
    echo "muster-deploy: warning: build cache prune failed" >&2
}

health() {
  echo "Waiting for $HEALTH_URL ..."
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 10 "$HEALTH_URL"; then
      echo
      echo "Healthy."
      return 0
    fi
    sleep 10
  done
  refuse "app did not become healthy within 5 minutes"
}

request=${SSH_ORIGINAL_COMMAND:-}
case "$request" in
  health) health ;;
  "deploy "*) deploy "${request#deploy }" ;;
  *) refuse "command not allowed" ;;
esac
