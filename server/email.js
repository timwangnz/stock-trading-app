/**
 * server/email.js
 * Resend-powered email helper.
 * Set RESEND_API_KEY in your environment variables.
 */

import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

// The "from" address must be a verified domain in your Resend account.
// During development you can use Resend's shared domain: onboarding@resend.dev
const FROM = process.env.EMAIL_FROM || 'TradeBuddy <onboarding@resend.dev>'

export async function sendClassInviteEmail({ to, className, schoolName, teacherName, joinUrl }) {
  await resend.emails.send({
    from:    FROM,
    to,
    subject: `You're invited to join ${className} on TradeBuddy`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#1a1a1a;margin-bottom:8px">You've been invited! 🎉</h2>
        <p style="color:#555;margin-bottom:24px">
          <strong>${teacherName}</strong> has invited you to join
          <strong>${className}</strong> at ${schoolName} on TradeBuddy —
          a simulated stock trading platform where you can practice investing with virtual money,
          compete on the class leaderboard, and share trading ideas with your classmates.
        </p>
        <a href="${joinUrl}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
          Join the Class
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px">
          This invite expires in 7 days. If you didn't expect this email you can safely ignore it.<br/><br/>
          Or copy this link: <a href="${joinUrl}" style="color:#2563eb">${joinUrl}</a>
        </p>
      </div>
    `,
  })
}

export async function sendPasswordResetEmail({ to, name, resetUrl }) {
  await resend.emails.send({
    from:    FROM,
    to,
    subject: 'Reset your TradeBuddy password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#1a1a1a;margin-bottom:8px">Reset your password</h2>
        <p style="color:#555;margin-bottom:24px">
          Hi ${name || 'there'},<br/><br/>
          We received a request to reset your TradeBuddy password.
          Click the button below to choose a new one. The link expires in <strong>1 hour</strong>.
        </p>
        <a href="${resetUrl}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
          Reset Password
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px">
          If you didn't request this, you can safely ignore this email — your password won't change.<br/><br/>
          Or copy this link: <a href="${resetUrl}" style="color:#2563eb">${resetUrl}</a>
        </p>
      </div>
    `,
  })
}
