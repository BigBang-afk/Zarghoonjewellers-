import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isBlockedPassword } from "@/lib/security/insecureCredentials";
import { clearLoginFailures, clientAddress, isLoginThrottled, recordLoginFailure } from "@/lib/security/loginThrottle";
import type { UserRole } from "@/types/next-auth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const username =
          typeof credentials?.username === "string" ? credentials.username.trim() : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!username || !password) return null;
        const address = clientAddress(request);
        if (isLoginThrottled(username, address)) return null;
        // Publicly known demo credentials are disabled everywhere this code runs.
        if (isBlockedPassword(password)) {
          recordLoginFailure(username, address);
          return null;
        }

        const user = await prisma.user.findUnique({ where: { username } });
        const valid = user ? await bcrypt.compare(password, user.password) : false;
        if (!user || !valid) {
          recordLoginFailure(username, address);
          return null;
        }
        clearLoginFailures(username);

        return {
          id: user.id,
          name: user.fullName,
          username: user.username,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.username = user.username;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as UserRole;
        session.user.username = token.username as string;
      }
      return session;
    },
  },
});
