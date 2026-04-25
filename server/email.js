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

export async function sendTeacherApprovedEmail({ to, name, appUrl }) {
  await resend.emails.send({
    from:    FROM,
    to,
    subject: '🎉 Your TradeBuddy teacher account is approved!',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#1a1a1a;margin-bottom:8px">You're verified! 🎓</h2>
        <p style="color:#555;margin-bottom:24px">
          Hi ${name || 'there'},<br/><br/>
          Great news — your teacher account on TradeBuddy has been verified.
          You can now create classes, invite students, and manage your roster.
        </p>
        <a href="${appUrl}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
          Open TradeBuddy
        </a>
        <p style="color:#999;font-size:12px;margin-top:24px">
          Head to <strong>My Classes</strong> in the sidebar to get started.
        </p>
      </div>
    `,
  })
}

export async function sendTeacherRejectedEmail({ to, name, reason, appUrl }) {
  await resend.emails.send({
    from:    FROM,
    to,
    subject: 'TradeBuddy teacher application update',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#1a1a1a;margin-bottom:8px">Application update</h2>
        <p style="color:#555;margin-bottom:16px">
          Hi ${name || 'there'},<br/><br/>
          We weren't able to verify your teacher application at this time.
        </p>
        ${reason ? `<p style="color:#555;margin-bottom:24px"><strong>Reason:</strong> ${reason}</p>` : ''}
        <p style="color:#555;margin-bottom:24px">
          If you think this is an error, please reply to this email with your school's
          official website or staff directory link and we'll take another look.
        </p>
        <a href="${appUrl}"
           style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px">
          Open TradeBuddy
        </a>
      </div>
    `,
  })
}

export async function sendSnapshotFailureEmail({ to, date, failedUserIds, totalUsers }) {
  await resend.emails.send({
    from:    FROM,
    to,
    subject: `⚠️ TradeBuddy snapshot failures — ${date}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
        <h2 style="color:#b91c1c;margin-bottom:8px">Daily snapshot failed</h2>
        <p style="color:#555;margin-bottom:16px">
          The daily portfolio snapshot ran on <strong>${date}</strong> but
          <strong>${failedUserIds.length} of ${totalUsers} user(s)</strong> could not be snapshotted
          after all retry attempts.
        </p>
        <p style="color:#555;margin-bottom:8px"><strong>Failed user IDs:</strong></p>
        <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:13px;overflow-x:auto">${failedUserIds.join('\n')}</pre>
        <p style="color:#555;margin-top:16px">
          Check the server logs for details. You can re-trigger a snapshot manually via:<br/>
          <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">POST /api/internal/snapshot-all</code>
        </p>
        <p style="color:#999;font-size:12px;margin-top:24px">
          This alert was sent automatically by the TradeBuddy snapshot scheduler.
        </p>
      </div>
    `,
  })
}

/**
 * Send a prompt result email to the user.
 * Called by the @email capability token when the LLM invokes send_email.
 */
export async function sendPromptResultEmail({ to, subject, body }) {
  await resend.emails.send({
    from:    FROM,
    to,
    subject: subject || 'TradeBuddy Prompt Result',
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px 24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:24px">
          <span style="font-size:20px">🤖</span>
          <span style="font-weight:600;color:#1a1a1a;font-size:16px">TradeBuddy Prompt Result</span>
        </div>
        <div style="background:#f8f9fa;border-radius:8px;padding:20px;color:#374151;font-size:14px;line-height:1.7;white-space:pre-wrap">${body}</div>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px">
          This was generated by a scheduled prompt in your TradeBuddy Prompt Manager.
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
