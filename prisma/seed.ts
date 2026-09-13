import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash("admin123@", 10);

  await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      fullName: "Administrator",
      username: "admin",
      password: hashedPassword,
      dob: new Date("1990-01-01"),
      mobile: "0000000000",
      role: "ADMIN",
    },
  });

  console.log("Admin user ready -> username: admin | password: admin123@");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
