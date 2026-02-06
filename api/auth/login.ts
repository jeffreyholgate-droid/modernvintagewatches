import { json, methodNotAllowed, readJson } from '../_lib/respond.js';
import { signAdminToken } from '../_lib/auth.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const body = await readJson(req);
  const password = (body?.password ?? '').toString();

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return json(res, 500, { error: 'SERVER_NOT_CONFIGURED', detail: 'Missing ADMIN_PASSWORD' });
  }

  if (!password || password !== expected) {
    return json(res, 401, { error: 'INVALID_CREDENTIALS' });
  }

  try {
    const token = await signAdminToken({ role: 'admin' });
    return json(res, 200, { token });
  } catch (e: any) {
    return json(res, 500, { error: 'TOKEN_ERROR', detail: e?.message ?? 'unknown' });
  }
}

