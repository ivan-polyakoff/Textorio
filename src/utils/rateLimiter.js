function createRateLimiter(intervalMs) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('createRateLimiter: intervalMs должен быть положительным числом');
  }

  const lastRequestAt = new Map();

  function isLimited(key, now = Date.now()) {
    const last = lastRequestAt.get(key);

    if (last !== undefined && now - last < intervalMs) {
      return true;
    }

    lastRequestAt.set(key, now);
    return false;
  }

  function clear(key) {
    lastRequestAt.delete(key);
  }

  function prune(now = Date.now()) {
    for (const [key, timestamp] of lastRequestAt) {
      if (now - timestamp >= intervalMs) {
        lastRequestAt.delete(key);
      }
    }
  }

  function size() {
    return lastRequestAt.size;
  }

  return {
    isLimited,
    clear,
    prune,
    size
  };
}

module.exports = {
  createRateLimiter
};
