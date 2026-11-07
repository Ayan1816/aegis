import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Lets `node --test` load the TypeScript redactor without a bundler or extra packages.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.(?:[cm]?js|json|ts)$/.test(specifier)
    ) {
      const parent = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd();
      const candidate = resolve(dirname(parent), `${specifier}.ts`);
      if (existsSync(candidate)) return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
