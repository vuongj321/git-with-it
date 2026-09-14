import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RegisterBodySchema } from '@gwi/shared-types';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db/client';
import { users } from '../db/schema';
import { OrgsService } from '../orgs/orgs.service';
import { signSessionToken } from './tokens';

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly orgs: OrgsService) {}

  @Post('register')
  async register(@Body() body: unknown) {
    const parsed = RegisterBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Invalid registration payload');
    }
    const email = parsed.data.email.trim().toLowerCase();
    const { password, name, inviteToken } = parsed.data;

    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing[0]) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const [user] = await db
      .insert(users)
      .values({
        email,
        name: name?.trim() || null,
        passwordHash,
      })
      .returning();

    await this.orgs.provisionPersonalWorkspace(user!.id, {
      email: user!.email,
      name: user!.name,
    });

    if (inviteToken) {
      await this.orgs.acceptInvite(inviteToken, user!.id, user!.email);
    }

    const accessToken = await signSessionToken({
      sub: user!.id,
      email: user!.email,
      name: user!.name,
    });
    return {
      accessToken,
      user: { id: user!.id, email: user!.email, name: user!.name },
    };
  }

  @Post('login')
  async login(@Body() body: unknown) {
    const parsed = LoginBody.safeParse(body);
    if (!parsed.success) {
      throw new UnauthorizedException('Invalid credentials payload');
    }
    const email = parsed.data.email.trim().toLowerCase();
    const { password } = parsed.data;
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
    const user = rows[0];
    if (!user?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const accessToken = await signSessionToken({
      sub: user.id,
      email: user.email,
      name: user.name,
    });
    return {
      accessToken,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }
}
