import { UserRole } from '@prisma/client';

export class User {
  id: string;
  email: string;
  name: string | null;
  googleId: string | null;
  avatarUrl: string | null;
  role: UserRole;
  companyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
