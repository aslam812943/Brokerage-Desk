import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import bcrypt from "bcryptjs";
import { prisma } from "../../../lib/prisma";
import { isRateLimited, resetRateLimit } from "../../../lib/rateLimit";

const MAX_AGE = 8 * 60 * 60;

export async function POST(request) {
  const form = await request.formData();
  const username = String(form.get("username") || "").trim().toLowerCase();
  const password = String(form.get("password") || "");
  const loginUrl = new URL("/login?error=CredentialsSignin", request.url);
  const ip = String(request.headers.get("x-forwarded-for") || "").split(",")[0].trim();

  if (!username || !password || !process.env.NEXTAUTH_SECRET || isRateLimited(username, ip)) {
    return NextResponse.redirect(loginUrl, 303);
  }

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.redirect(loginUrl, 303);
  }
  resetRateLimit(username, ip);

  const token = await encode({
    secret: process.env.NEXTAUTH_SECRET,
    maxAge: MAX_AGE,
    token: {
      sub: user.id,
      name: user.username,
      role: user.role,
      username: user.username,
      userId: user.id,
      mustChangePassword: user.mustChangePassword,
      lastChecked: Date.now(),
    },
  });

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set({
    name: process.env.NODE_ENV === "production" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return response;
}
