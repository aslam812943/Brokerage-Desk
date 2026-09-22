import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  // Login endpoints must remain public so they can establish a session.
  matcher: ["/((?!login|api/auth|api/mis-login|_next/static|_next/image|favicon.ico).*)"],
};
