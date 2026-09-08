function safeCode(error) {
  const value = String(error?.code ?? "operation_failed");
  return /^[a-z0-9_]{1,80}$/u.test(value) ? value : "operation_failed";
}

export function createReusableSessionManager({
  create,
  authenticate = async () => {},
  isAuthenticationError = (error) => error?.code === "authentication_required",
  nowMs = () => Date.now()
} = {}) {
  if (typeof create !== "function") throw new TypeError("Session manager requires create");
  let active = null;
  let creating = null;
  const values = {
    browserCreated: 0,
    sessionReused: 0,
    authenticationMs: 0,
    operationMs: 0,
    lastErrorCode: null
  };

  async function dispose(entry) {
    if (!entry?.session) return;
    await entry.session.close?.().catch(() => {});
  }

  async function invalidate(entry = active) {
    if (!entry) return;
    if (active === entry) active = null;
    await dispose(entry);
  }

  async function acquire({ key = "default", descriptor } = {}) {
    if (active?.key === key) {
      values.sessionReused += 1;
      return active;
    }
    if (creating) {
      const pending = await creating;
      if (pending.key === key) {
        values.sessionReused += 1;
        return pending;
      }
    }
    if (active) await invalidate(active);
    creating = (async () => {
      const session = await create(descriptor);
      const entry = { key, session };
      values.browserCreated += 1;
      const started = nowMs();
      try {
        await authenticate(session, descriptor);
        values.authenticationMs += Math.max(0, nowMs() - started);
        active = entry;
        return entry;
      } catch (error) {
        values.authenticationMs += Math.max(0, nowMs() - started);
        values.lastErrorCode = safeCode(error);
        await dispose(entry);
        throw error;
      }
    })();
    try {
      return await creating;
    } finally {
      creating = null;
    }
  }

  async function run(options, operation) {
    const idempotent = options?.idempotent !== false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const entry = await acquire(options);
      const started = nowMs();
      try {
        const result = await operation(entry.session);
        values.operationMs += Math.max(0, nowMs() - started);
        return result;
      } catch (error) {
        values.operationMs += Math.max(0, nowMs() - started);
        values.lastErrorCode = safeCode(error);
        if (!isAuthenticationError(error)) throw error;
        await invalidate(entry);
        if (!idempotent || attempt === 1) throw error;
      }
    }
    throw new Error("unreachable");
  }

  async function close() {
    const pending = creating;
    if (pending) await pending.catch(() => {});
    await invalidate(active);
  }

  return { run, close, metrics: () => ({ ...values }) };
}
