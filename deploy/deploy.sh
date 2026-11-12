#!/usr/bin/env bash
# Обновление Textorio на VDS.
# Использование: ./deploy/deploy.sh [branch]
# Тянет последнюю ветку, ставит зависимости, гоняет тесты.
# Перезапускает сервис ТОЛЬКО если всё прошло; иначе откатывается к старой версии.
#
# Инстансы: имя сервиса выводится из имени каталога чекаута —
#   /opt/textorio/prod -> textorio-prod, /opt/textorio/test -> textorio-test.
# Override: TEXTORIO_SERVICE=textorio ./deploy/deploy.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="${TEXTORIO_SERVICE:-textorio-$(basename "$APP_DIR")}"
BRANCH="${1:-main}"

cd "$APP_DIR"

OLD_COMMIT=$(git rev-parse HEAD)

git fetch origin "$BRANCH"
NEW_COMMIT=$(git rev-parse "origin/$BRANCH")

if [ "$NEW_COMMIT" = "$OLD_COMMIT" ]; then
  echo "Обновлений нет: $NEW_COMMIT"
  exit 0
fi

echo "Обновление: $OLD_COMMIT -> $NEW_COMMIT"
git reset --hard "$NEW_COMMIT"

rollback() {
  echo "Откат к $OLD_COMMIT..."
  git reset --hard "$OLD_COMMIT"
  npm ci
  systemctl restart "$SERVICE"
  echo "Откат выполнен, сервис перезапущен на старой версии."
}

if ! npm ci; then
  echo "ОШИБКА: npm ci упал."
  rollback
  exit 1
fi

if ! npm test; then
  echo "ОШИБКА: тесты не прошли."
  rollback
  exit 1
fi

systemctl restart "$SERVICE"

# Даём боту время подняться и подключиться к Long Poll.
sleep 5

if systemctl is-active --quiet "$SERVICE"; then
  echo "Готово: $SERVICE работает на $NEW_COMMIT"
else
  echo "ОШИБКА: сервис не поднялся после перезапуска."
  echo "Логи: journalctl -u $SERVICE -n 50"
  rollback
  exit 1
fi
