import { SignJWT, jwtVerify } from 'jose';
import { json } from './respond.js';

const textEncoder = new TextEncoder();

function getSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    throw new Error('Missing ADMIN_JWT_SECRET');
  }
  return textEncoder.encode(secret);
}

export async function signAdminToken(payload: { role: 'admin' }) {
  const secret = getSecret();
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret);
}

export async function verifyAdminToken(token: string) {
  const secret = getSecret();
  const { payload } = await jwtVerify(token, secret);
  if (payload.role !== 'admin') throw new Error('Invalid role');
  return payload;
}

export async function requireAdmin(req: any, res: any): Promise<boolean> {
  const header = req.headers?.authorization || req.headers?.Authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    json(res, 401, { error: 'UNAUTHORIZED' });
    return false;
  }
  try {
    await verifyAdminToken(token);
    return true;
  } catch {
    json(res, 401, { error: 'UNAUTHORIZED' });
    return false;
  }
}
