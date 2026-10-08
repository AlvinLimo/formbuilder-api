export class HttpError extends Error {
  constructor(status, message, fieldId) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.fieldId = fieldId;
  }
}

export function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
