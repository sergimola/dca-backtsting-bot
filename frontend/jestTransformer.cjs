/**
 * Jest transformer: wraps TsJestTransformer and pre-replaces Vite import.meta.env.*
 * so modules with Vite-specific env variables load cleanly in Jest (CJS mode).
 */
const { TsJestTransformer } = require('ts-jest')

const tsJest = new TsJestTransformer({
  tsconfig: {
    module: 'CommonJS',
    moduleResolution: 'node',
    isolatedModules: false,
    allowImportingTsExtensions: false,
    noEmit: false,
  },
  diagnostics: false,
})

module.exports = {
  process(sourceText, sourcePath, options) {
    // Replace import.meta.env.VAR with ("") so Node.js CommonJS can evaluate the module.
    const patched = sourceText.replace(/import\.meta\.env\.(\w+)/g, '("")')
    return tsJest.process(patched, sourcePath, options)
  },
  getCacheKey(sourceText, sourcePath, options) {
    const patched = sourceText.replace(/import\.meta\.env\.(\w+)/g, '("")')
    return tsJest.getCacheKey(patched, sourcePath, options)
  },
}
