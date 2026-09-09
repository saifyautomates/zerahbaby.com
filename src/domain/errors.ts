/**
 * ZÉRAH BABY & KIDS — Application Error Architecture
 * Standardized typed error hierarchy separating validation, auth,
 * conflict, payment, inventory, and external service errors.
 */

export type ErrorSeverity = "info" | "warning" | "error" | "critical";

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly userMessage: string;
  public readonly severity: ErrorSeverity;
  public readonly context?: Record<string, unknown>;

  constructor({
    message,
    code = "INTERNAL_ERROR",
    statusCode = 500,
    userMessage = "An unexpected error occurred. Please try again.",
    severity = "error",
    context,
  }: {
    message: string;
    code?: string;
    statusCode?: number;
    userMessage?: string;
    severity?: ErrorSeverity;
    context?: Record<string, unknown>;
  }) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
    this.severity = severity;
    this.context = context;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      statusCode: this.statusCode,
      userMessage: this.userMessage,
      context: this.context,
    };
  }
}

/** 400 Bad Request — Form or payload validation failure */
export class ValidationError extends AppError {
  constructor(message: string, userMessage?: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "VALIDATION_ERROR",
      statusCode: 400,
      userMessage: userMessage || message,
      severity: "warning",
      context,
    });
  }
}

/** 401 Unauthorized — Authentication required / session missing */
export class AuthenticationError extends AppError {
  constructor(
    message = "Authentication required",
    userMessage = "Please sign in to continue.",
    context?: Record<string, unknown>,
  ) {
    super({
      message,
      code: "AUTHENTICATION_REQUIRED",
      statusCode: 401,
      userMessage,
      severity: "warning",
      context,
    });
  }
}

/** 403 Forbidden — Insufficient permissions */
export class AuthorizationError extends AppError {
  constructor(
    message = "Access denied: insufficient privileges",
    userMessage = "You do not have permission to perform this action.",
    context?: Record<string, unknown>,
  ) {
    super({
      message,
      code: "FORBIDDEN",
      statusCode: 403,
      userMessage,
      severity: "error",
      context,
    });
  }
}

/** 404 Not Found — Entity missing */
export class NotFoundError extends AppError {
  constructor(entity: string, id?: string, context?: Record<string, unknown>) {
    super({
      message: `${entity}${id ? ` (${id})` : ""} not found`,
      code: "NOT_FOUND",
      statusCode: 404,
      userMessage: `The requested ${entity.toLowerCase()} could not be found.`,
      severity: "info",
      context: { entity, id, ...context },
    });
  }
}

/** 409 Conflict — Stale state, concurrent mutation, or duplicate entity */
export class ConflictError extends AppError {
  constructor(message: string, userMessage?: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "CONFLICT",
      statusCode: 409,
      userMessage: userMessage || "This item was modified by another session. Please refresh.",
      severity: "warning",
      context,
    });
  }
}

/** 402 Payment Required / Gateway Failure */
export class PaymentError extends AppError {
  constructor(message: string, userMessage?: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "PAYMENT_ERROR",
      statusCode: 402,
      userMessage:
        userMessage || "Payment processing could not be completed. No funds were charged.",
      severity: "critical",
      context,
    });
  }
}

/** 422 Unprocessable Entity — Stock unavailable / overselling blocked */
export class InventoryError extends AppError {
  constructor(message: string, userMessage?: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "INVENTORY_ERROR",
      statusCode: 422,
      userMessage: userMessage || "One or more items in your order are out of stock.",
      severity: "warning",
      context,
    });
  }
}

/** 502 Bad Gateway — External logistics (Shiprocket) or SMS (MSG91) failure */
export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, context?: Record<string, unknown>) {
    super({
      message: `[${service}] ${message}`,
      code: "EXTERNAL_SERVICE_ERROR",
      statusCode: 502,
      userMessage: `Service is temporarily busy. Please try again shortly.`,
      severity: "error",
      context: { service, ...context },
    });
  }
}

/** 500 Internal Database / Postgres RPC Error */
export class DatabaseError extends AppError {
  constructor(message: string, context?: Record<string, unknown>) {
    super({
      message,
      code: "DATABASE_ERROR",
      statusCode: 500,
      userMessage: "A database operation failed. The engineering team has been notified.",
      severity: "critical",
      context,
    });
  }
}
