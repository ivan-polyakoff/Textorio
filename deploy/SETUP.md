# Первичная настройка VDS (Ubuntu 22.04/24.04) — один раз

## 1. Базовое ПО

```bash
sudo apt update && sudo apt upgrade -y
# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node -v  # должно быть v22.x
```

## 2. Пользователь и каталог приложения

```bash
sudo useradd -r -m -d /opt/textorio -s /usr/sbin/nologin textorio
```

Репозиторий приватный — создайте deploy key только на чтение:

```bash
sudo -u textorio ssh-keygen -t ed25519 -f /opt/textorio/.ssh/id_ed25519 -N ''
# Публичный ключ вывести и добавить в GitHub -> Settings -> Deploy keys (read-only):
sudo cat /opt/textorio/.ssh/id_ed25519.pub
```

## 3. Код и .env

```bash
sudo -u textorio git clone git@github.com:ivan-polyakoff/Textorio.git /opt/textorio/app
cd /opt/textorio/app
sudo -u textorio cp .env.example .env
sudo -u textorio nano .env   # вписать реальные VK_GROUP_TOKEN, GROUP_ID, GIGACHAT_API_KEY
sudo -u textorio npm ci
```

## 4. systemd-сервис

```bash
sudo cp /opt/textorio/app/deploy/textorio.service /etc/systemd/system/textorio.service
# Проверьте в юните пути User= и WorkingDirectory= — они должны совпадать с п.2 и п.3
sudo systemctl daemon-reload
sudo systemctl enable --now textorio
```

## 5. Проверка

```bash
systemctl status textorio
journalctl -u textorio -f          # живой журнал
# В группе VK отправить боту /start — должен ответить.
```

## 6. Обновление при разработке

```bash
/opt/textorio/app/deploy/deploy.sh
```

Скрипт: тянет main → `npm ci` → `npm test` → перезапуск сервиса.
Если тесты упали или сервис не поднялся — автоматический откат к предыдущему коммиту.

Условия обновления (варианты):
- **Вручную по SSH** — просто запускать deploy.sh, когда готовы (по умолчанию).
- **Автоматически из GitHub Actions** — раскомментируйте/включите `.github/workflows/deploy.yml`
  и положите SSH-ключ на сервер (см. workflow).
