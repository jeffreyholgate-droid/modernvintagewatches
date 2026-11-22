export function json(res: any, status: number, data: any) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

export async function readJson(req: any): Promise<any> {
  // Vercel parses JSON bodies before invoking a Node handler. Local streams do not.
  if (req.body !== undefined) {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      const text = req.body.toString();
      return text ? JSON.parse(text) : {};
    }
    return req.body ?? {};
  }
  return await new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk: any) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > 1024 * 1024) {
        tooLarge = true;
        body = '';
        reject(new Error('REQUEST_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('REQUEST_ABORTED')));
  });
}

export function methodNotAllowed(res: any, allowed: string[]) {
  res.setHeader('Allow', allowed.join(', '));
  return json(res, 405, { error: 'METHOD_NOT_ALLOWED', allowed });
}

