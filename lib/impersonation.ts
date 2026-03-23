/**
 * Impersonation — "View as" mode for admins.
 *
 * Admins stay logged in as themselves. The impersonation context is stored in a
 * signed cookie (el_impersonating) containing the target user's role/email.
 * getTeamSession() overlays this onto the real session so the UI renders as the
 * target user. Every impersonation is logged to staff.impersonation_log.
 *
 * Security rules:
 *   - Admin-only
 *   - Cannot impersonate another admin
 *   - Cookie is signed + expires after 2 hours
 *   - Audit log is append-only
 */

import { SignJWT, jwtVerify } from 'jose'

const SECRET_KEY = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? 'fallback-dev-secret'
)

export const IMPERSONATION_COOKIE = 'el_impersonating'

export interface ImpersonationPayload {
  targetEmail:      string
  targetName:       string
  targetRole:       string
  targetStaffId:    string
  impersonatorEmail: string
  iat:              number
  exp:              number
}

export async function signImpersonationToken(payload: Omit<ImpersonationPayload, 'iat' | 'exp'>): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(SECRET_KEY)
}

export async function verifyImpersonationToken(token: string): Promise<ImpersonationPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET_KEY)
    return payload as unknown as ImpersonationPayload
  } catch {
    return null
  }
}
