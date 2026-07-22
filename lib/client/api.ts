// Thin fetch wrapper for the app's own API.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Turn a page-load failure into user copy: callers own the 404 wording,
// the server's friendly 429 message passes through, everything else gets
// the generic copy.
export function loadErrorMessage(
  err: unknown,
  notFound: string,
  generic: string,
): string {
  if (err instanceof ApiError && err.status === 404) return notFound;
  if (err instanceof ApiError && err.status === 429) return err.message;
  return generic;
}

interface Options {
  method?: string;
  body?: unknown;
  token?: string;
}

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { "x-member-token": opts.token } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data.error === "string" ? data.error : "Something went wrong",
    );
  }
  return data as T;
}
