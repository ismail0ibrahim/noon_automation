import type { BrowserContext, Frame, Page, Route } from '@playwright/test';

// Checkout is an inspection phase: unknown writes and third-party tokenization
// must also be blocked. Prepare and clean the cart outside this phase.
const SENSITIVE_READ = /(?:^|\/)(?:cards?|payments?|orders?|tokenize|place[-_]?order)(?:\/|$)|checkout\/(?:submit|confirm|pay)(?:\/|$)/i;
const activeGuards = new WeakSet<BrowserContext>();

export function requirePaymentStop(context: BrowserContext): void {
  if (!activeGuards.has(context)) throw new Error('Install the payment stop before opening or filling checkout.');
}

export async function installPaymentStop(context: BrowserContext) {
  if (activeGuards.has(context)) throw new Error('Payment stop is already installed.');
  if (context.serviceWorkers().length) throw new Error('Checkout inspection requires serviceWorkers blocked.');
  let blocked = 0;
  let disposed = false;
  const pending = new Set<Promise<void>>();
  const key = `__noonPaymentStop_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const installInFrame = async (frame: Frame) => {
    await frame.evaluate(key => {
      const state = window as unknown as Record<string, EventListener>;
      if (state[key]) return;
      const prevent: EventListener = event => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      state[key] = prevent;
      document.addEventListener('submit', prevent, true);
    }, key).catch(() => {}); // Network interception remains authoritative during navigation.
  };
  const watched = new Set<Page>();
  const attach = (frame: Frame) => {
    if (disposed) return;
    const task = installInFrame(frame);
    pending.add(task);
    void task.finally(() => pending.delete(task));
  };
  const onFrame = (frame: Frame) => { attach(frame); };
  const watch = (page: Page) => {
    if (disposed || watched.has(page)) return;
    watched.add(page);
    page.on('framenavigated', onFrame);
    for (const frame of page.frames()) attach(frame);
  };
  const handler = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    let path: string;
    try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) || SENSITIVE_READ.test(path)) {
      blocked++;
      await route.abort('blockedbyclient');
    } else await route.fallback();
  };
  await context.route('**/*', handler);
  activeGuards.add(context);
  context.on('page', watch);
  for (const page of context.pages()) watch(page);
  await Promise.all(context.pages().flatMap(page => page.frames().map(installInFrame)));
  return {
    blockedCount: () => blocked,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      context.off('page', watch);
      for (const page of watched) page.off('framenavigated', onFrame);
      await Promise.all(pending);
      await Promise.all([...watched].flatMap(page => page.frames().map(frame => frame.evaluate(key => {
        const state = window as unknown as Record<string, EventListener>;
        if (state[key]) document.removeEventListener('submit', state[key], true);
        delete state[key];
      }, key).catch(() => {}))));
      await context.unroute('**/*', handler);
      activeGuards.delete(context);
    },
  };
}
