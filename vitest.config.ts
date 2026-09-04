import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      // See tests/stubs/server-only.ts for why.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // lib/env.ts validates at import and fails loudly by design (module 01). Tests
    // that pull in a server module need it satisfied; these values are placeholders
    // and no test ever reaches the network.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key-placeholder-value',
      /**
       * Pinned, because `limitFor(plan, kind, phase = process.env.PHASE)` uses a DEFAULT
       * PARAMETER — and a default parameter fires on an explicit `undefined`. The budget
       * tests pass `undefined` meaning "no phase set" and were in fact reading whatever
       * the developer's shell had, so `PHASE=test` in a sourced .env.local made two of
       * them fail with no code change. Empty string is not 'test', so production caps
       * apply, deterministically and whatever the shell holds.
       */
      PHASE: '',
    },
  },
});
