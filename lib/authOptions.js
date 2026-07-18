import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { isRateLimited } from "./rateLimit";

// Fail fast in production if secret is missing — never allow default/empty secrets
if (process.env.NODE_ENV === "production" && !process.env.NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET environment variable must be set in production");
}

// How often (ms) the JWT callback re-validates the user against the DB.
// Keeps sessions invalidated within 15 minutes of account deletion / role change.
const SESSION_RECHECK_INTERVAL = 15 * 60 * 1000;

function getClientIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (forwarded) return String(forwarded).split(",")[0].trim();
  return req?.socket?.remoteAddress || req?.ip || null;
}

export const authOptions = {
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const username = String(credentials?.username || "").trim().toLowerCase();
        const password = String(credentials?.password || "");
        if (!username || !password) return null;

        const ip = getClientIp(req);

        // Rate-limit by both username AND IP (stops credential stuffing & password spray)
        if (isRateLimited(username, ip)) {
          throw new Error("Too many login attempts. Please wait a few minutes and try again.");
        }

        const user = await prisma.user.findUnique({ where: { username } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, name: user.username, role: user.role, mustChangePassword: user.mustChangePassword };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        // Initial sign-in: embed claims and a timestamp for periodic re-checks
        token.role = user.role;
        token.username = user.name;
        token.userId = user.id;
        token.mustChangePassword = user.mustChangePassword;
        token.lastChecked = Date.now();
      } else {
        // "update" is triggered explicitly by the client (e.g. right after a
        // successful password change) so mustChangePassword clears immediately
        // instead of waiting for the next periodic re-check.
        const now = Date.now();
        if (trigger === "update" || !token.lastChecked || now - token.lastChecked > SESSION_RECHECK_INTERVAL) {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.userId },
            select: { role: true, mustChangePassword: true },
          });
          if (!dbUser) {
            // User was deleted — invalidate the token
            return null;
          }
          token.role = dbUser.role; // Pick up role changes
          token.mustChangePassword = dbUser.mustChangePassword;
          token.lastChecked = now;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (!token) return null; // Token invalidated above
      session.user.role = token.role;
      session.user.name = token.username;
      session.user.id = token.userId;
      session.user.mustChangePassword = token.mustChangePassword;
      return session;
    },
  },
};
