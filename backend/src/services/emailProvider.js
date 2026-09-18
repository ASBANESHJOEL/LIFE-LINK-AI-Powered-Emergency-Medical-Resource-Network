let customSender = null;

/**
 * Configure a custom email sender function (used primarily in automated tests).
 * @param {Function|null} senderFn
 */
export function setEmailSender(senderFn) {
  customSender = senderFn;
}

/**
 * Reset email sender to default.
 */
export function resetEmailSender() {
  customSender = null;
}

/**
 * Send an email via the configured provider boundary.
 * Never logs secrets or patient-sensitive details.
 *
 * @param {object} params
 * @param {string} params.to
 * @param {string} params.subject
 * @param {string} params.html
 * @param {string} [params.text]
 * @returns {Promise<{ success: boolean, messageId: string, simulated?: boolean }>}
 */
export async function sendEmail({ to, subject, html, text }) {
  if (typeof customSender === 'function') {
    return customSender({ to, subject, html, text });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    // In local development or environments without RESEND_API_KEY, simulate delivery
    return {
      success: true,
      messageId: `simulated-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      simulated: true
    };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || 'LIFE-LINK Alerts <alerts@life-link.in>',
      to: [to],
      subject,
      html,
      text: text || html
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const err = new Error(`Email provider error HTTP ${response.status}: ${errorBody}`);
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  return {
    success: true,
    messageId: data.id || `resend-${Date.now()}`
  };
}
