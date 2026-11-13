const { detectFeedback } = require('../src/core/feedback');

describe('detectFeedback', () => {
  it('короткая негативная реакция — вариация без критики', () => {
    expect(detectFeedback('плохо')).toEqual({ type: 'variation', critique: null });
    expect(detectFeedback('ПЛОХО!')).toEqual({ type: 'variation', critique: null });
    expect(detectFeedback('ещё раз')).toEqual({ type: 'variation', critique: null });
    expect(detectFeedback('не то')).toEqual({ type: 'variation', critique: null });
    expect(detectFeedback('заново')).toEqual({ type: 'variation', critique: null });
    expect(detectFeedback('переделай')).toEqual({ type: 'variation', critique: null });
  });

  it('длинная фраза — критика целиком', () => {
    expect(detectFeedback('переделай без эмодзи и покороче')).toEqual({
      type: 'critique',
      critique: 'переделай без эмодзи и покороче'
    });
    expect(detectFeedback('плохо, слишком длинно и скучно')).toEqual({
      type: 'critique',
      critique: 'плохо, слишком длинно и скучно'
    });
    expect(detectFeedback('ещё раз, но короче')).toEqual({
      type: 'critique',
      critique: 'ещё раз, но короче'
    });
  });

  it('ключевое слово не в начале короткой болтовни не считается реакцией', () => {
    expect(detectFeedback('мне не нравится этот пост')).toBeNull();
    expect(detectFeedback('всё плохо')).toBeNull();
    expect(detectFeedback('у меня всё плохо')).toBeNull();
  });

  it('обычные сообщения — не реакция', () => {
    expect(detectFeedback('сделай пост про котиков')).toBeNull();
    expect(detectFeedback('')).toBeNull();
    expect(detectFeedback(null)).toBeNull();
    expect(detectFeedback(undefined)).toBeNull();
    expect(detectFeedback('нравится!')).toBeNull();
  });
});
