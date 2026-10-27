// Resolve hook: points the Neon driver at the in-memory stand-in.
export async function resolve(specifier, context, next) {
  if (specifier === '@neondatabase/serverless') {
    return { url: new URL('./neon-pglite.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
