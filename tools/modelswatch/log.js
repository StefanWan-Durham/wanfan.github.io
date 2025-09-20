// Model Watch logging helper
// Enable verbose debug logs by setting MODELSWATCH_DEBUG=1|true|yes|on
const DEBUG = /^(1|true|yes|on)$/i.test(process.env.MODELSWATCH_DEBUG || '');
function ts(){ return new Date().toISOString(); }
export function debug(...args){ if(DEBUG) console.debug(`[modelswatch][debug][${ts()}]`, ...args); }
export function info(...args){ console.log(`[modelswatch][info][${ts()}]`, ...args); }
export function warn(...args){ console.warn(`[modelswatch][warn][${ts()}]`, ...args); }
export function error(...args){ console.error(`[modelswatch][error][${ts()}]`, ...args); }
export function summary(label, obj){ if(DEBUG) console.debug(`[modelswatch][debug][${ts()}] ${label}:`, JSON.stringify(obj, null, 2)); }
export default { debug, info, warn, error, summary };
