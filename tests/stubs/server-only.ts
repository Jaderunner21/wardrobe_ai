/**
 * `server-only` throws on import outside a React Server Component, which is exactly
 * its job — but it also means a unit test cannot import the pure helpers that live
 * beside server code (lib/storage.ts). Vitest aliases the package to this empty
 * module so those helpers stay testable. The real guard is unaffected in the app,
 * where Next resolves the package normally.
 */
export {};
