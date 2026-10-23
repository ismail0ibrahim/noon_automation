import type { BrowserContext, Page } from '@playwright/test';
type State = Awaited<ReturnType<BrowserContext['storageState']>>;
export function filterNoonState(state: State): State;
export function verifyNoonSession(page: Page): Promise<void>;
export function saveNoonSession(context: BrowserContext, destination?: string): Promise<void>;
