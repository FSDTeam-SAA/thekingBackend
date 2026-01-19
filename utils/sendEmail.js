import nodemailer from 'nodemailer';

// ✅ Email Configuration
const EMAIL_USER = 'noyonahamed461@gmail.com';
const EMAIL_PASS = 'rzun gaah hksx emzq';

// ✅ Main sendEmail Function
export const sendEmail = async (to, subject, html) => {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
  });
  
  await transporter.sendMail({
    from: EMAIL_USER,
    to,
    subject: subject || 'DocMobi Notification',
    html,
  });
};

// ✅ OTP Email Template for Password Reset
export const otpEmailTemplate = (otp, userName) => {
  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border-radius: 12px; overflow: hidden; background-color: #f9fafb; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1);">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #0B3267, #1664CD); padding: 30px; text-align: center; color: white;">
        <h1 style="margin: 0; font-size: 28px; font-weight: bold;">DocMobi</h1>
        <p style="margin-top: 8px; font-size: 16px; opacity: 0.9;">Password Reset Request</p>
      </div>

      <!-- Body -->
      <div style="padding: 40px 30px; background-color: #ffffff;">
        <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
          Hello <strong>${userName || 'User'}</strong>,
        </p>
        
        <p style="font-size: 16px; color: #374151; margin-bottom: 25px;">
          You requested to reset your password. Please use the following OTP code:
        </p>

        <!-- OTP Box -->
        <div style="background: linear-gradient(135deg, #E8F1FF, #F0F7FF); border: 2px dashed #1664CD; border-radius: 12px; padding: 25px; text-align: center; margin: 30px 0;">
          <p style="font-size: 14px; color: #6B7280; margin: 0 0 10px;">Your OTP Code</p>
          <h2 style="font-size: 42px; font-weight: bold; color: #0B3267; margin: 0; letter-spacing: 8px; font-family: 'Courier New', monospace;">
            ${otp}
          </h2>
        </div>

        <div style="background-color: #FEF3C7; border-left: 4px solid #F59E0B; padding: 15px; border-radius: 8px; margin: 25px 0;">
          <p style="font-size: 14px; color: #92400E; margin: 0;">
            ⚠️ This OTP will expire in <strong>10 minutes</strong>.
          </p>
        </div>

        <p style="font-size: 14px; color: #6B7280; margin-top: 25px;">
          If you did not request this, please ignore this email and your account will remain secure.
        </p>
      </div>

      <!-- Footer -->
      <div style="background-color: #F3F4F6; text-align: center; padding: 20px; font-size: 13px; color: #9CA3AF;">
        <p style="margin: 0;">This email was sent from DocMobi</p>
        <p style="margin: 5px 0 0;">&copy; 2025 DocMobi. All rights reserved.</p>
      </div>
    </div>
  `;
};

// ✅ Contact Message Template
export const sendMessageTemplate = ({ email, name, phone, message }) => {
  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: auto; border: 1px solid #e5e7eb; padding: 30px; border-radius: 12px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
      <header style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb;">
        <h1 style="color: #0f172a; margin: 0;">Hello Admin</h1>
        <p style="font-size: 14px; color: #6b7280; margin-top: 4px;">New Contact Message Notification</p>
      </header>

      <section style="padding: 25px 0;">
        <p style="font-size: 16px; color: #111827; margin: 0 0 10px;"><strong>Sender Email:</strong> ${email}</p>
        <p style="font-size: 16px; color: #111827; margin: 0 0 10px;"><strong>Name:</strong> ${name}</p>
        <p style="font-size: 16px; color: #111827; margin: 0 0 10px;"><strong>Phone:</strong> ${phone}</p>

        <div style="margin-top: 20px; padding: 20px; background-color: #f9fafb; border-left: 4px solid #1d4ed8; border-radius: 8px;">
          <p style="font-size: 15px; color: #374151; margin: 0; white-space: pre-wrap;">
            ${message}
          </p>
        </div>
      </section>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 30px 0;"/>

      <footer style="text-align: center; font-size: 13px; color: #9ca3af;">
        This message was sent via the DocMobi contact form.<br />
        &copy; 2025 DocMobi. All rights reserved.
      </footer>
    </div>
  `;
};

// ✅ Invite Link Template
export const inviteLinkTemplate = (inviterName, inviteLink) => {
  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 650px; margin: auto; border-radius: 14px; overflow: hidden; background-color: #f9fafb; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.08);">
      
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #0B3267, #1664CD); padding: 30px; text-align: center; color: white;">
        <h1 style="margin: 0; font-size: 26px; font-weight: bold;">You're Invited!</h1>
        <p style="margin-top: 6px; font-size: 15px; opacity: 0.9;">
          ${inviterName} has invited you to join DocMobi
        </p>
      </div>

      <!-- Body -->
      <div style="padding: 30px; background-color: #ffffff;">
        <p style="font-size: 16px; color: #374151; margin-bottom: 20px;">
          We're excited to have you onboard! Click the button below to accept your invitation and get started.
        </p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${inviteLink}" target="_blank" 
            style="display: inline-block; padding: 14px 28px; background-color: #1664CD; color: #ffffff; font-size: 16px; font-weight: 600; border-radius: 8px; text-decoration: none; box-shadow: 0 4px 10px rgba(22, 100, 205, 0.3);">
            Accept Invitation
          </a>
        </div>

        <p style="font-size: 14px; color: #6b7280; text-align: center;">
          If the button above doesn't work, copy and paste this link into your browser:
        </p>
        <p style="font-size: 14px; color: #1664CD; word-break: break-all; text-align: center;">
          ${inviteLink}
        </p>
      </div>

      <!-- Footer -->
      <div style="background-color: #f3f4f6; text-align: center; padding: 15px; font-size: 13px; color: #9ca3af;">
        &copy; 2025 DocMobi. All rights reserved.
      </div>
    </div>
  `;
};