import {
  BadRequestException,
  Body,
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
import { registerUser } from './register-user';
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

    const user = await registerUser(this.orgs, {
      email: parsed.data.email,
      password: parsed.data.password,
      name: parsed.data.name,
      inviteToken: parsed.data.inviteToken,
    });

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
