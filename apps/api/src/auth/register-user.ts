import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { db } from '../db/client';
import { users, type User } from '../db/schema';
import type { OrgsService } from '../orgs/orgs.service';

export type RegisterUserInput = {
  email: string;
  password: string;
  name?: string | null;
  inviteToken?: string;
};

/**
 * Creates a user + personal workspace (and optionally accepts a team invite)
 * in a single database transaction. Validates the invite before any writes.
 */
export async function registerUser(
  orgs: OrgsService,
  input: RegisterUserInput,
): Promise<User> {
  const email = input.email.trim().toLowerCase();
  const name = input.name?.trim() || null;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing[0]) {
    throw new ConflictException('Email already registered');
  }

  if (input.inviteToken) {
    await orgs.assertInviteAcceptable(input.inviteToken, email);
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        name,
        passwordHash,
      })
      .returning();

    if (!user) {
      throw new InternalServerErrorException('Failed to create user');
    }

    await orgs.provisionPersonalWorkspace(
      user.id,
      { email: user.email, name: user.name },
      tx,
    );

    if (input.inviteToken) {
      await orgs.acceptInvite(input.inviteToken, user.id, user.email, tx);
    }

    return user;
  });
}
