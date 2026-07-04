/**
 * Utility functions for error handling
 */

/**
 * Safely extract a message from an unknown error
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return "Unknown error occurred";
}

/**
 * Log errors in a consistent format
 */
export function logError(context: string, error: unknown): void {
  const message = getErrorMessage(error);
  console.error(`[${context}] ${message}`, error);
}

/**
 * Get detailed information from an API error
 */
export function getApiErrorDetails(error: unknown): {
  message: string;
  status?: number;
  code?: string;
} {
  if (error instanceof Error) {
    // Fetch API error
    if (error.message.includes("HTTP")) {
      const match = error.message.match(/HTTP (\d+):/);
      const status = match ? parseInt(match[1]) : undefined;
      return {
        message: error.message,
        status,
      };
    }

    return {
      message: error.message,
    };
  }

  return {
    message: getErrorMessage(error),
  };
}
