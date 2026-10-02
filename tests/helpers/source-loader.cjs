// Executes actual application modules with only explicit infrastructure replacements.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
exports.sourceLoader = function sourceLoader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    const filename = path.resolve(file);
    const alias = '@/'+path.relative(path.resolve('src'), filename).replace(/\.tsx?$/, '');
    if (Object.hasOwn(mocks, alias)) return mocks[alias];
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = new Module(filename, module);
    mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, mod);
    const native = Module.createRequire(filename);
    mod.require = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.endsWith('.css')) return {};
      if (id.startsWith('.') || id.startsWith('@/')) {
        const stem = id.startsWith('@/') ? path.resolve('src', id.slice(2)) : path.resolve(path.dirname(filename), id);
        for (const ext of ['.ts', '.tsx']) if (fs.existsSync(stem+ext)) return load(stem+ext);
      }
      return native(id);
    };
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
    } }).outputText, filename);
    return mod.exports;
  }
  return load;
};
// Savepoints reproduce transaction rollback inside a fixture transaction.
exports.transactionProxy = function transactionProxy(tx) {
  let sequence = 0;
  return new Proxy(tx, { get(target, key) {
    if (key !== '$transaction') return target[key];
    return async (fn) => {
      const name = `regression_${++sequence}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
      try {
        const result = typeof fn === 'function' ? await fn(tx) : await Promise.all(fn);
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
        throw error;
      }
    };
  } });
};
