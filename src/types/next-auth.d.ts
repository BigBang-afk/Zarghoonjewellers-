import type { DefaultSession, DefaultUser } from "next-auth";

export type UserRole = "CUSTOMER" | "ADMIN";

declare module "next-auth" {
  interface User extends DefaultUser {
    role: UserRole;
    username: string;
  }

  interface Session {
    user: {
      role: UserRole;
      username: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: UserRole;
    username: string;
  }
}
