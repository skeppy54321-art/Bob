import { buildApp } from '../src/server/app.ts';
export async function testApp() {
  const app = await buildApp();
  const client = async () => {
    const r = await app.inject({ method: 'GET', url: '/api/me' });
    let cookie = String(r.headers['set-cookie']).split(';')[0];
    const call = async (method: string, url: string, payload?: unknown) => {
      const res = await app.inject({ method: method as any, url, payload: payload as any, headers: { cookie } });
      const sc = res.headers['set-cookie'];
      if (sc) cookie = String(Array.isArray(sc) ? sc[0] : sc).split(';')[0];
      return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
    };
    return { call, me: JSON.parse(r.body).user, get cookie() { return cookie; } };
  };
  return { app, client };
}
