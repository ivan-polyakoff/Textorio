# Первичная настройка VDS (Ubuntu 22.04/24.04) — один раз

Схема: два независимых инстанса из одного репозитория.

| Инстанс | Каталог              | Ветка     | systemd-сервис | Группа ВК        |
|---------|----------------------|-----------|----------------|------------------|
| prod    | `/opt/textorio/prod` | `main`    | `textorio-prod`| продакшен-группа |
| test    | `/opt/textorio/test` | dev-ветка | `textorio-test`| тест-группа      |

Каждый инстанс: свой `.env` (свой токен группы ВК), свои `logs/`, свой сервис.
Код один и тот же — различается только конфигурацией.

## 1. Базовое ПО

```bash
sudo apt update && sudo apt upgrade -y
# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v  # должно быть v22.x
```

## 2. Пользователь и каталоги приложения

```bash
sudo useradd -r -m -d /opt/textorio -s /usr/sbin/nologin textorio
sudo -u textorio mkdir -p /opt/textorio/prod /opt/textorio/test
```

Репозиторий приватный — создайте deploy key только на чтение:

```bash
sudo -u textorio ssh-keygen -t ed25519 -f /opt/textorio/.ssh/id_ed25519 -N ''
# Публичный ключ вывести и добавить в GitHub -> Settings -> Deploy keys (read-only):
sudo cat /opt/textorio/.ssh/id_ed25519.pub
```

## 3. Код

```bash
# Прод: ветка main
sudo -u textorio git clone -b main git@github.com:ivan-polyakoff/Textorio.git /opt/textorio/prod
# Тест: дев-ветка (название уточнить; пример):
sudo -u textorio git clone -b dev git@github.com:ivan-polyakoff/Textorio.git /opt/textorio/test

cd /opt/textorio/prod && sudo -u textorio npm ci && sudo -u textorio npm test
```

## 4. .env каждого инстанса

```bash
cd /opt/textorio/prod
sudo -u textorio cp .env.example .env
sudo -u textorio chmod 600 .env
sudo -u textorio nano .env
# Прод: VK_GROUP_TOKEN прод-группы, GROUP_ID прод-группы, GIGACHAT_API_KEY.
```

Повторить в `/opt/textorio/test` с токеном и GROUP_ID **тест-группы**.

Требования к каждой группе ВК (настраивается в интерфейсе VK):
- «Работа с API» → тип сервера Long Poll API, включён и активен;
- Управление сообществом → Сообщения → Настройки для бота → Возможности ботов — вкл;
- токен с правом управления сообщениями группы.

Опционально: `LOG_DIR=/var/log/textorio/prod` (и `.../test`) — если хотите
собрать логи вне каталога приложения; по умолчанию пишется в `<чекают>/logs/`.

## 5. systemd-сервисы

```bash
sudo cp /opt/textorio/prod/deploy/textorio-prod.service /etc/systemd/system/
sudo cp /opt/textorio/test/deploy/textorio-test.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now textorio-prod
sudo systemctl enable --now textorio-test
```

Пути в юнитах (`WorkingDirectory=/opt/textorio/prod` / `.../test`) уже соответствуют схеме.

## 6. Проверка

```bash
systemctl status textorio-prod textorio-test
journalctl -u textorio-prod -f          # живой журнал прода
journalctl -u textorio-test -f          # живой журнал теста
# В каждой группе ВК отправить боту /start — должен ответить.
```

## 7. Обновление при разработке

Рабочий цикл:

1. Разработка локально → коммит в dev-ветку → пуш.
2. На сервере в каталоге теста: `/opt/textorio/test/deploy/deploy.sh dev`
   — проверка в тест-группе.
3. Merge dev → main → пуш.
4. На сервере в каталоге прода: `/opt/textorio/prod/deploy/deploy.sh main`.

Скрипт сам выводит имя сервиса из имени каталога (`prod` → `textorio-prod`,
`test` → `textorio-test`); ветка — первый аргумент (по умолчанию `main`).
Порядок: тянет ветку → `npm ci` → `npm test` → перезапуск сервиса.
Если тесты упали или сервис не поднялся — автоматический откат к предыдущему коммиту.

## 8. Сертификаты (GigaChat / российские CA)

Если Node.js не доверяет цепочке GigaChat (`SELF_SIGNED_CERT_IN_CHAIN`),
скачайте корневой сертификат НУЦ Минцифры в формате PEM и укажите его
в `.env` каждого инстанса:

```
GIGACHAT_CA_BUNDLE_FILE=certs/russian-trusted-root.pem
```

Для быстрой локальной диагностики можно временно
`GIGACHAT_REJECT_UNAUTHORIZED=false` — **не оставляйте это в продакшене**.
