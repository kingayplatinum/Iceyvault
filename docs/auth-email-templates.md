# IceyVault authentication email templates

These branded templates are ready to paste into Supabase Dashboard → Authentication → Email Templates. Supabase Auth renders the templates; an SMTP provider (planned: Resend) is still required for reliable branded delivery. Do not put SMTP credentials in SQL or browser variables.

## Confirm signup
Subject: Confirm your IceyVault account
HTML:
<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:Arial,sans-serif;color:#171923"><div style="max-width:560px;margin:40px auto;background:#fff;border-radius:18px;padding:36px"><div style="font-size:25px;font-weight:800;letter-spacing:-1px">icey<span style="color:#7457ed">vault</span></div><h1 style="font-size:25px;margin:32px 0 12px">Welcome to IceyVault</h1><p style="line-height:1.7;color:#55596a">Confirm your email address to activate your account and securely manage your number services.</p><p style="margin:28px 0"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#7457ed;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Verify email address</a></p><p style="font-size:13px;color:#777">If you did not create this account, you can safely ignore this email.</p><hr style="border:0;border-top:1px solid #eee;margin:28px 0"><p style="font-size:12px;color:#888">IceyVault · Secure number services</p></div></body></html>

## Reset password
Subject: Reset your IceyVault password
HTML:
<!doctype html><html><body style="margin:0;background:#f5f6fa;font-family:Arial,sans-serif;color:#171923"><div style="max-width:560px;margin:40px auto;background:#fff;border-radius:18px;padding:36px"><div style="font-size:25px;font-weight:800">icey<span style="color:#7457ed">vault</span></div><h1 style="font-size:25px;margin:32px 0 12px">Reset your password</h1><p style="line-height:1.7;color:#55596a">We received a request to change the password for your IceyVault account.</p><p style="margin:28px 0"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#7457ed;color:#fff;text-decoration:none;padding:14px 22px;border-radius:10px;font-weight:700">Choose a new password</a></p><p style="font-size:13px;color:#777">If you did not request this, ignore this message. Your password will not change.</p><hr style="border:0;border-top:1px solid #eee;margin:28px 0"><p style="font-size:12px;color:#888">IceyVault · Secure number services</p></div></body></html>
