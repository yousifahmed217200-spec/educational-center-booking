// ============================================================================
// EDGE FUNCTION: send-reservation-email
// ============================================================================
// Sends an admin notification email after a reservation is created.
// Uses Resend (https://resend.com) - simplest transactional email API with a
// generous free tier. The Resend API key is stored as a Supabase secret and
// NEVER touches the browser.
//
// This function is called by the frontend AFTER create_reservation() has
// already committed successfully. If the email fails, the reservation is
// NOT rolled back or deleted - see the calling code in app.js.
//
// Deploy with:
//   supabase functions deploy send-reservation-email
//   supabase secrets set RESEND_API_KEY=re_xxxxxxxx
//   supabase secrets set ADMIN_NOTIFICATION_EMAIL=yousif.ahmed217@gmail.com
//   supabase secrets set RESEND_FROM_EMAIL="Bright Path Center <onboarding@resend.dev>"
// ============================================================================

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const ADMIN_EMAIL = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") ?? "yousif.ahmed217@gmail.com";
const FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") ?? "onboarding@resend.dev";

// CORS: allow the frontend origin to call this function directly.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatTime(t: string): string {
  // t looks like "16:00:00"
  const [hStr, m] = t.split(":");
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

function buildEmailHtml(payload: any): string {
  const { reservation_code, created_at, student, grade, items } = payload;

  const lessonsHtml = items
    .map(
      (item: any) => `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${item.subject_name}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${item.teacher_name}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${DAY_NAMES[item.day_of_week]}</td>
        <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${formatTime(item.start_time)} - ${formatTime(item.end_time)}</td>
      </tr>`
    )
    .join("");

  return `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; max-width:640px; margin:0 auto; color:#1f2937;">
    <div style="background:#155e75;padding:24px 28px;border-radius:12px 12px 0 0;">
      <h1 style="color:#fff;margin:0;font-size:20px;">New Student Reservation</h1>
      <p style="color:#a5f3fc;margin:6px 0 0;font-size:14px;">Reservation Code: ${reservation_code}</p>
    </div>
    <div style="border:1px solid #e5e7eb;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px;">
      <h2 style="font-size:16px;margin:0 0 12px;">Student Details</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
        <tr><td style="padding:6px 0;color:#6b7280;width:170px;">Full Name</td><td style="padding:6px 0;font-weight:600;">${student.full_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Mobile</td><td style="padding:6px 0;font-weight:600;">${student.mobile}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Age</td><td style="padding:6px 0;font-weight:600;">${student.age}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Gender</td><td style="padding:6px 0;font-weight:600;">${student.gender}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Parent Name</td><td style="padding:6px 0;font-weight:600;">${student.parent_name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Parent Mobile</td><td style="padding:6px 0;font-weight:600;">${student.parent_mobile}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Email</td><td style="padding:6px 0;font-weight:600;">${student.email || "—"}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Grade</td><td style="padding:6px 0;font-weight:600;">${grade.name}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Reservation Code</td><td style="padding:6px 0;font-weight:600;">${reservation_code}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Submitted At</td><td style="padding:6px 0;font-weight:600;">${new Date(created_at).toLocaleString("en-GB", { timeZone: "Africa/Cairo" })} (Cairo time)</td></tr>
      </table>

      <h2 style="font-size:16px;margin:0 0 12px;">Booked Lessons</h2>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f3f4f6;">
            <th style="text-align:left;padding:8px 14px;">Subject</th>
            <th style="text-align:left;padding:8px 14px;">Teacher</th>
            <th style="text-align:left;padding:8px 14px;">Day</th>
            <th style="text-align:left;padding:8px 14px;">Time</th>
          </tr>
        </thead>
        <tbody>${lessonsHtml}</tbody>
      </table>

      <p style="margin-top:24px;font-size:12px;color:#9ca3af;">This is an automated notification from the Educational Center booking system.</p>
    </div>
  </div>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();

    if (!payload?.reservation_code || !payload?.student || !payload?.items) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!RESEND_API_KEY) {
      // Email is not configured yet. Do NOT fail hard - the reservation
      // itself already succeeded before this function was called.
      console.warn("RESEND_API_KEY not set - skipping email send.");
      return new Response(JSON.stringify({ sent: false, reason: "Email provider not configured" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        subject: `New Student Reservation — ${payload.reservation_code}`,
        html: buildEmailHtml(payload),
      }),
    });

    const emailResult = await emailRes.json();

    if (!emailRes.ok) {
      console.error("Resend API error:", emailResult);
      // Still return 200 to the caller with sent:false - reservation must
      // never be undone because of an email failure.
      return new Response(JSON.stringify({ sent: false, error: emailResult }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true, id: emailResult.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-reservation-email error:", err);
    return new Response(JSON.stringify({ sent: false, error: String(err) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
