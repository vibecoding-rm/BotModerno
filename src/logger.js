// Simple logger for Cloudflare Workers
export class Logger {
  constructor(context = '') {
    this.context = context;
  }

  log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      context: this.context,
      message,
      ...data
    };
    console.log(JSON.stringify(logEntry));
  }

  info(message, data = {}) {
    this.log('INFO', message, data);
  }

  warn(message, data = {}) {
    this.log('WARN', message, data);
  }

  error(message, error = null, data = {}) {
    const errorData = error ? { error: error.message || error, stack: error.stack } : {};
    this.log('ERROR', message, { ...errorData, ...data });
  }

  debug(message, data = {}) {
    this.log('DEBUG', message, data);
  }
}

// Global logger instance
export const logger = new Logger('CubaModelBot');