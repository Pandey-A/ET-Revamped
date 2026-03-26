import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Hono } from "https://deno.land/x/hono@v3.11.7/mod.ts";
import { cors } from "https://deno.land/x/hono@v3.11.7/middleware.ts";

// Initialize Hono
const app = new Hono();

// CORS config
app.use("*", cors());

// Initialize Supabase Admin Client (using service role for privileged tasks)
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false } }
);

// ── Helpers ───────────────────────────────────────────────────

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendEmail(to: string, subject: string, html: string) {
  const SMTP_HOST = Deno.env.get("SMTP_HOST") || "smtp.resend.com";
  const SMTP_PORT = Deno.env.get("SMTP_PORT") || "587";
  const SMTP_USER = Deno.env.get("SMTP_USER") || "resend";
  const SMTP_PASS = Deno.env.get("SMTP_PASS");
  const EMAIL_FROM = Deno.env.get("EMAIL_FROM");

  if (!SMTP_PASS || !EMAIL_FROM) {
    console.error("Missing SMTP config in Supabase Secrets");
    return;
  }

  // Use Resend API or SMTP? 
  // For Edge Functions, using Resend's REST API is MUCH easier than raw SMTP.
  // I'll use the Resend API if SMTP_PASS starts with 're_', else fallback.
  if (SMTP_PASS.startsWith("re_")) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SMTP_PASS}`,
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) console.error("Resend API error", await res.text());
  } else {
    // Basic Deno SMTP implementation or just log it
    console.log(`[STUB] Sending email to ${to}: ${subject}`);
  }
}

// ── Auth Endpoints ─────────────────────────────────────────────

app.post("/register", async (c) => {
  const { userName, email, password, role = "user" } = await c.req.json();
  const normalizedEmail = email.trim().toLowerCase();

  // Create auth user
  const { data: authData, error: signUpError } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
  });

  if (signUpError) return c.json({ success: false, message: signUpError.message }, 400);

  const authUserId = authData.user.id;

  // Insert profile
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .insert({
      id: authUserId,
      user_name: userName,
      email: normalizedEmail,
      role: ["user", "admin"].includes(role) ? role : "user",
      is_email_verified: false,
    })
    .select()
    .single();

  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(authUserId);
    return c.json({ success: false, message: "Profile creation failed" }, 500);
  }

  // Send verification email
  const verificationToken = crypto.randomUUID().replace(/-/g, "");
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await supabaseAdmin
    .from("profiles")
    .update({ 
      email_verification_token_hash: verificationToken, 
      email_verification_token_expiry: expiry 
    })
    .eq("id", authUserId);

  const verifyUrl = `${Deno.env.get("FRONTEND_URL")}/v/${verificationToken}`;
  await sendEmail(
    normalizedEmail,
    "Verify Your Email - ElevateTrust AI",
    `<p>Hello ${userName || "User"},</p><p>Please verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p>`
  );

  return c.json({ success: true, message: "Registered. Please verify email.", user: profile }, 201);
});

app.post("/verify-email", async (c) => {
  const { token } = await c.req.json();
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update({ is_email_verified: true, email_verification_token_hash: null })
    .eq("email_verification_token_hash", token)
    .gt("email_verification_token_expiry", new Date().toISOString())
    .select()
    .maybeSingle();

  if (error || !data) return c.json({ success: false, message: "Invalid or expired token" }, 400);
  return c.json({ success: true, message: "Email verified" });
});

app.post("/forgot-password", async (c) => {
  const { email } = await c.req.json();
  const normalizedEmail = email.toLowerCase();
  const otp = generateOTP();
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { data: user } = await supabaseAdmin
    .from("profiles")
    .update({ reset_otp_hash: otp, reset_otp_expiry: expiry })
    .eq("email", normalizedEmail)
    .select("email")
    .maybeSingle();

  if (user) {
    await sendEmail(
      normalizedEmail,
      "Your password reset code",
      `<p>Your code is: <strong>${otp}</strong></p>`
    );
  }

  return c.json({ success: true, message: "If account exists, OTP sent." });
});

app.post("/verify-otp", async (c) => {
  const { email, otp } = await c.req.json();
  const { data: user } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email.toLowerCase())
    .eq("reset_otp_hash", otp)
    .gt("reset_otp_expiry", new Date().toISOString())
    .maybeSingle();

  if (!user) return c.json({ success: false, message: "Invalid or expired OTP" }, 400);

  const resetToken = crypto.randomUUID();
  await supabaseAdmin
    .from("profiles")
    .update({ password_reset_token_hash: resetToken, reset_otp_hash: null })
    .eq("id", user.id);

  return c.json({ success: true, resetToken });
});

app.post("/reset-password", async (c) => {
  const { email, resetToken, newPassword } = await c.req.json();
  const { data: user } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email.toLowerCase())
    .eq("password_reset_token_hash", resetToken)
    .maybeSingle();

  if (!user) return c.json({ success: false, message: "Invalid reset token" }, 400);

  const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword });
  if (error) return c.json({ success: false, message: error.message }, 500);

  await supabaseAdmin
    .from("profiles")
    .update({ password_reset_token_hash: null, is_email_verified: true })
    .eq("id", user.id);

  return c.json({ success: true, message: "Password updated" });
});

// ── Admin Endpoints (RBAC) ─────────────────────────────────────

async function isAdmin(c: any, next: any) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) return c.json({ message: "Unauthorized" }, 401);

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (error || !user) return c.json({ message: "Unauthorized" }, 401);

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") return c.json({ message: "Admin access required" }, 403);
  
  c.set("user", user);
  return await next();
}

app.get("/admin/users", isAdmin, async (c) => {
  const { data: users, error: usersError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false });

  if (usersError) return c.json({ success: false, message: usersError.message }, 500);

  const userIds = users.map((u) => u.id);
  const { data: usageLogs } = await supabaseAdmin
    .from("usage_logs")
    .select("*")
    .in("user_id", userIds)
    .order("created_at", { ascending: false });

  // Simple aggregation for the list view
  const usersWithUsage = users.map((u) => {
    const logs = (usageLogs || []).filter(l => l.user_id === u.id);
    return {
      id: u.id,
      _id: u.id,
      userName: u.user_name,
      email: u.email,
      role: u.role,
      isEmailVerified: u.is_email_verified,
      analysisRequestsUsed: u.analysis_requests_used,
      analysisRequestLimit: u.analysis_request_limit,
      isBlocked: u.is_blocked,
      blockedUntil: u.blocked_until,
      createdAt: u.created_at,
      usage: {
        totalUsageCount: logs.length,
        recentActivities: logs.slice(0, 5).map(l => ({
          serviceType: l.media_type,
          createdAt: l.created_at,
        }))
      }
    };
  });

  return c.json({ success: true, users: usersWithUsage });
});

app.get("/admin/users/:id", isAdmin, async (c) => {
  const id = c.req.param("id");
  const { data: profile } = await supabaseAdmin.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!profile) return c.json({ success: false, message: "User not found" }, 404);

  const { data: logs } = await supabaseAdmin.from("usage_logs").select("*").eq("user_id", id).order("created_at", { ascending: false });

  return c.json({
    success: true,
    user: {
      id: profile.id,
      userName: profile.user_name,
      email: profile.email,
      role: profile.role,
      isEmailVerified: profile.is_email_verified,
      analysisRequestsUsed: profile.analysis_requests_used,
      analysisRequestLimit: profile.analysis_request_limit,
      isBlocked: profile.is_blocked,
      blockedUntil: profile.blocked_until,
    },
    activities: (logs || []).map(l => ({
      serviceType: l.media_type,
      verdict: l.verdict,
      createdAt: l.created_at
    }))
  });
});

app.post("/admin/block/:id", isAdmin, async (c) => {
  const id = c.req.param("id");
  const { minutes } = await c.req.json();
  const blockedUntil = (minutes && minutes > 0) 
    ? new Date(Date.now() + minutes * 60000).toISOString()
    : null; // null for indefinite block or similar? 
    // In old Express, toggleBlock(userId, true) sent {}, so minutes was undefined.
    // Default to 1 year if not provided for generic block?
  
  const finalBlockedUntil = blockedUntil || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

  await supabaseAdmin.from("profiles").update({ is_blocked: true, blocked_until: finalBlockedUntil }).eq("id", id);
  return c.json({ success: true, blockedUntil: finalBlockedUntil });
});

app.post("/admin/unblock/:id", isAdmin, async (c) => {
  const id = c.req.param("id");
  await supabaseAdmin.from("profiles").update({ is_blocked: false, blocked_until: null }).eq("id", id);
  return c.json({ success: true });
});

app.post("/admin/role/:id", isAdmin, async (c) => {
  const id = c.req.param("id");
  const { role } = await c.req.json();
  if (!["user", "admin"].includes(role)) return c.json({ message: "Invalid role" }, 400);

  await supabaseAdmin.from("profiles").update({ role }).eq("id", id);
  return c.json({ success: true });
});

// ── Analysis Endpoints ──────────────────────────────────────────

app.post("/upload/:type", async (c) => {
  const type = c.req.param("type"); // video, image, prebuilt, etc.
  const authHeader = c.req.header("Authorization");
  if (!authHeader) return c.json({ message: "Unauthorized" }, 401);

  // Get user session
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) return c.json({ message: "Unauthorized" }, 401);

  // 1. Consume Quota via RPC
  const { data: quotaRes, error: quotaErr } = await supabaseAdmin.rpc("consume_analysis_quota", {
    p_user_id: user.id
  });

  if (quotaErr) return c.json({ message: "Quota system error" }, 500);
  if (!quotaRes?.success) {
    return c.json({
      success: false,
      code: "ANALYSIS_LIMIT_REACHED",
      message: "Monthly quota reached.",
      ...quotaRes
    }, 403);
  }

  // 2. Proxy to Analysis Service
  const baseUrl = Deno.env.get("VIDEO_ANALYSIS_BASE") || "http://103.22.140.216:5009";
  const proxyUrl = `${baseUrl}/predict/${type}`;

  const contentType = c.req.header("Content-Type") || "";
  const body = await c.req.blob(); // Get raw body for streaming

  try {
    const response = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: body
    });

    const result = await response.json();

    // 3. Log Usage
    await supabaseAdmin.from("usage_logs").insert({
      user_id: user.id,
      media_type: type,
      verdict: result.prediction || result.verdict || "unknown",
      raw_response: result
    });

    return c.json({
      ...result,
      quota: {
        analysisRequestsUsed: quotaRes.used,
        analysisRequestLimit: quotaRes.limit,
        remainingAnalysisRequests: quotaRes.limit - quotaRes.used,
      }
    });

  } catch (err) {
    // Rollback quota on failure
    await supabaseAdmin.rpc("rollback_analysis_quota", { p_user_id: user.id });
    return c.json({ success: false, message: "Analysis service unavailable" }, 502);
  }
});

// Start Deno server
serve(app.fetch);
