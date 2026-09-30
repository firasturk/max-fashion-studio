/** Small fetch wrapper: same-origin cookies, JSON errors surfaced as Error messages. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function parse<T>(r: Response): Promise<T> {
  const data = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) throw new ApiError(data.error || `Request failed (${r.status})`, r.status);
  return data;
}

export async function get<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { credentials: "same-origin" }));
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function postForm<T>(path: string, form: FormData): Promise<T> {
  return parse<T>(await fetch(path, { method: "POST", credentials: "same-origin", body: form }));
}

export async function del<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { method: "DELETE", credentials: "same-origin" }));
}
