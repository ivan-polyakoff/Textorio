const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024; // 5 МБ на файл
const MAX_LOG_FILES = 10; // храним до 10 файлов: app.log + app.log.1..9

fs.mkdirSync(LOG_DIR, { recursive: true });

const logFilePath = path.join(LOG_DIR, 'app.log');

function rotateIfNeeded() {
  try {
    if (fs.existsSync(logFilePath) && fs.statSync(logFilePath).size >= MAX_LOG_FILE_BYTES) {
      for (let index = MAX_LOG_FILES - 1; index >= 1; index -= 1) {
        const from = `${logFilePath}.${index}`;
        const to = `${logFilePath}.${index + 1}`;

        if (fs.existsSync(from)) {
          fs.renameSync(from, to);
        }
      }

      fs.renameSync(logFilePath, `${logFilePath}.1`);
    }
  } catch {
    // Ротация не должна ронять бота при проблемах с диском/правами.
  }
}

function formatValue(value) {
  if (value instanceof Error) {
    return value.stack || `${value.name}: ${value.message}`;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function write(level, args) {
  const timestamp = new Date().toISOString();
  const line = `${timestamp} [${level}] ${args.map(formatValue).join(' ')}\n`;

  // Дублируем в консоль: под journald/pm2 stdout тоже собирается.
  if (level === 'ERROR') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }

  try {
    rotateIfNeeded();
    fs.appendFileSync(logFilePath, line);
  } catch {
    // Нет прав/места — консольный вывод всё равно остаётся.
  }
}

const logger = {
  log: (...args) => write('INFO', args),
  warn: (...args) => write('WARN', args),
  error: (...args) => write('ERROR', args)
};

module.exports = {
  logger,
  logFilePath
};
