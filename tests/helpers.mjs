// Minimal req/res pair that matches how the Vercel handlers use them.
export function call(handler, { method = 'GET', headers = {}, query = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200, headers: {}, body: undefined,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; resolve(this); return this; },
      write() {},
      end(c) { this.body ??= c; resolve(this); return this; },
    };
    Promise.resolve(handler({ method, headers, query, body }, res)).catch(reject);
  });
}

export const auth = token => ({ authorization: `Bearer ${token}` });
