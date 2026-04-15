function write(level, message, details) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message
  };

  if (details && Object.keys(details).length) {
    payload.details = details;
  }

  console.log(JSON.stringify(payload));
}

export const logger = {
  info(message, details = undefined) {
    write("info", message, details);
  },
  warn(message, details = undefined) {
    write("warn", message, details);
  },
  error(message, details = undefined) {
    write("error", message, details);
  }
};
