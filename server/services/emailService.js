/**
 * Сервис для отправки email уведомлений через Resend HTTP API
 * (SMTP заблокирован файрволом VDSina, используется HTTP API)
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.SMTP_PASS;
  const fromEmail = process.env.SMTP_FROM || 'Pet-Gang <noreply@pet-gang.ru>';
  
  if (!apiKey) {
    console.warn('⚠️ RESEND API ключ не найден (SMTP_PASS). Email отправка отключена.');
    return { success: false, error: 'API ключ не настроен' };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Resend API ошибка:', data);
      return { success: false, error: data.message || JSON.stringify(data) };
    }

    console.log('✅ Письмо отправлено:', data.id);
    return { success: true, messageId: data.id };
  } catch (error) {
    console.error('❌ Ошибка отправки письма:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Общий HTML-шаблон для email-уведомлений
 */
function notificationTemplate({ title, content, buttonText, buttonUrl }) {
  const buttonHtml = buttonText && buttonUrl
    ? `<p style="text-align:center;"><a href="${buttonUrl}" style="display:inline-block;padding:12px 28px;background:#4CAF50;color:white;text-decoration:none;border-radius:5px;font-weight:bold;">${buttonText}</a></p>`
    : '';

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="UTF-8"></head>
    <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:linear-gradient(135deg,#4CAF50 0%,#2E7D32 100%);color:white;padding:24px;text-align:center;border-radius:10px 10px 0 0;">
        <h1 style="margin:0;font-size:22px;">🐾 Pet-Gang</h1>
      </div>
      <div style="background:#f9f9f9;padding:28px;border-radius:0 0 10px 10px;">
        <h2 style="margin-top:0;">${title}</h2>
        <p>${content}</p>
        ${buttonHtml}
        <p style="color:#999;font-size:12px;margin-top:24px;">© 2026 Pet-Gang. Все права защищены.</p>
      </div>
    </body>
    </html>`;
}

/**
 * Отправить уведомление о сканировании QR-кода
 */
export async function sendQrScanEmail({ toEmail, petName, scanTime, scanUrl }) {
  if (!toEmail) return { success: false, error: 'Email не указан' };
  return sendEmail({
    to: toEmail,
    subject: `QR-код вашего питомца отсканирован — Pet-Gang`,
    html: notificationTemplate({
      title: 'QR-код отсканирован!',
      content: `QR-код питомца <strong>${petName}</strong> был отсканирован.`,
      buttonText: 'Посмотреть',
      buttonUrl: scanUrl,
    }),
  });
}

/**
 * Отправить email-код для авторизации
 */
export async function sendAuthCodeEmail({ toEmail, code }) {
  if (!toEmail) return { success: false, error: 'Email не указан' };
  return sendEmail({
    to: toEmail,
    subject: `Код для входа — Pet-Gang`,
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="UTF-8"></head>
      <body style="font-family:Arial,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#4CAF50 0%,#2E7D32 100%);color:white;padding:24px;text-align:center;border-radius:10px 10px 0 0;">
          <h1 style="margin:0;font-size:22px;">🐾 Pet-Gang</h1>
        </div>
        <div style="background:#f9f9f9;padding:28px;border-radius:0 0 10px 10px;">
          <h2 style="margin-top:0;">Код для входа</h2>
          <p>Ваш код подтверждения:</p>
          <div style="font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center;padding:20px;background:white;border-radius:8px;margin:20px 0;color:#4CAF50;">${code}</div>
          <p><strong>Важно:</strong> Код действителен в течение 10 минут.</p>
          <p style="color:#999;font-size:12px;margin-top:24px;">© 2026 Pet-Gang. Все права защищены.</p>
        </div>
      </body>
      </html>
    `,
    text: `Ваш код для входа: ${code}\nКод действителен в течение 10 минут.`,
  });
}

/**
 * Отправить email-багрепорт (копия на help@pet-gang.ru)
 */
export async function sendBugReportEmail({ title, description, authorName, reportUrl }) {
  return sendEmail({
    to: 'help@pet-gang.ru',
    subject: `[Багрепорт] ${title}`,
    html: notificationTemplate({
      title: '🐛 Новый багрепорт',
      content: `
        <strong>Автор:</strong> ${authorName}<br>
        <strong>Заголовок:</strong> ${title}<br><br>
        <strong>Описание:</strong><br>
        ${description || '(без описания)'}
      `,
      buttonText: 'Посмотреть на сайте',
      buttonUrl: reportUrl,
    }),
  });
}

export default {
  sendEmail,
  sendQrScanEmail,
  sendAuthCodeEmail,
  sendBugReportEmail,
};
