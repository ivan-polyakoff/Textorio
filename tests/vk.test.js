const { splitMessage } = require('../src/utils/vk');


const LIMIT = 4096;

describe('splitMessage', () => {
  it('не режет короткий текст', () => {
    const text = 'Привет, это короткое сообщение.';
    expect(splitMessage(text)).toEqual([text]);
  });

  it('возвращает одну пустую часть для пустой строки', () => {
    expect(splitMessage('')).toEqual(['']);
  });

  it('возвращает [""] для null/undefined', () => {
    expect(splitMessage(null)).toEqual(['']);
    expect(splitMessage(undefined)).toEqual(['']);
  });

  it('режет текст длиннее 4096 символов', () => {
    const text = 'x'.repeat(5000);
    const parts = splitMessage(text);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(LIMIT);
    }
    // Ничего не потерялось
    expect(parts.join('')).toBe(text);
  });

  it('режет по переводам строк, если они есть в первой половине лимита', () => {
    const line = 'a'.repeat(2000);
    const text = `${line}\n${line}\n${line}\n${line}`;
    const parts = splitMessage(text);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(LIMIT);
      // Разрезы прошли по переводам строк — части не начинаются/заканчиваются ими
      expect(part).not.toMatch(/^\n|\n$/);
    }
  });

  it('режет по пробелам, если переводов строк нет', () => {
    const word = 'a'.repeat(2000);
    const text = Array(5).fill(word).join(' ');
    const parts = splitMessage(text);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('жёстко режет очень длинное слово без пробелов', () => {
    const text = 'y'.repeat(10000);
    const parts = splitMessage(text);

    expect(parts.length).toBe(3);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('ровно 4096 символов остаётся одной частью', () => {
    const text = 'z'.repeat(LIMIT);
    expect(splitMessage(text)).toEqual([text]);
  });
});
