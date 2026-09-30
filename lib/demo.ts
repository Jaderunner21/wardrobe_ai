/**
 * The seeded demo wardrobes (scripts/demo/seed.mjs). Server only: the shared password
 * lives in DEMO_PASSWORD and never reaches the browser — the demo button asks the server
 * to sign in, it is never handed the credentials.
 */
import 'server-only';
import accounts from '@/lib/demo-accounts.json';

export interface DemoAccount {
  email: string;
  name: string;
  city: string;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = accounts;

/** Any demo account; judges arriving together land in different wardrobes. */
export const randomDemoAccount = (): DemoAccount =>
  DEMO_ACCOUNTS[Math.floor(Math.random() * DEMO_ACCOUNTS.length)] ?? DEMO_ACCOUNTS[0]!;
