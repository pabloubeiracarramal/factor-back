import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

export interface GoogleUser {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateGoogleUser(googleUser: GoogleUser) {
    // Find user by Google ID or email
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { googleId: googleUser.googleId },
          { email: googleUser.email },
        ],
      },
      include: {
        company: true,
      },
    });

    // If user doesn't exist, create a new user WITHOUT a company
    if (!user) {
      // Check if there's a pending invitation for this email
      const invitation = await this.prisma.companyInvitation.findFirst({
        where: {
          email: googleUser.email,
          acceptedAt: null,
          expiresAt: {
            gt: new Date(), // Not expired
          },
        },
        include: {
          company: true,
        },
      });

      // Create the user
      user = await this.prisma.user.create({
        data: {
          googleId: googleUser.googleId,
          email: googleUser.email,
          name: googleUser.name,
          avatarUrl: googleUser.avatarUrl,
          companyId: invitation ? invitation.companyId : null, // Assign company if invited
        },
        include: {
          company: true,
        },
      });

      // Mark invitation as accepted if it exists
      if (invitation) {
        await this.prisma.companyInvitation.update({
          where: { id: invitation.id },
          data: { acceptedAt: new Date() },
        });
      }
    } else if (!user.googleId) {
      // Update existing user with Google ID
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: googleUser.googleId,
          avatarUrl: googleUser.avatarUrl,
        },
        include: {
          company: true,
        },
      });
    }

    return user;
  }

  async generateJwtToken(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      role: user.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        companyId: user.companyId,
        company: user.company,
        role: user.role,
      },
    };
  }

  async getUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        company: true,
      },
    });
  }

  async createInvitation(companyId: string, email: string) {
    // Generate a unique token
    const token = this.generateInvitationToken();
    
    // Set expiration to 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await this.prisma.companyInvitation.create({
      data: {
        email,
        token,
        companyId,
        expiresAt,
      },
      include: {
        company: true,
      },
    });

    return invitation;
  }

  async acceptInvitation(token: string, userId: string) {
    const invitation = await this.prisma.companyInvitation.findUnique({
      where: { token },
      include: { company: true },
    });

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.acceptedAt) {
      throw new Error('Invitation already accepted');
    }

    if (invitation.expiresAt < new Date()) {
      throw new Error('Invitation expired');
    }

    // Update user with company
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { companyId: invitation.companyId },
      include: { company: true },
    });

    // Mark invitation as accepted
    await this.prisma.companyInvitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    });

    return user;
  }

  async getInvitationByToken(token: string) {
    return this.prisma.companyInvitation.findUnique({
      where: { token },
      include: { company: true },
    });
  }

  async getPendingInvitation(email: string) {
    return this.prisma.companyInvitation.findFirst({
      where: {
        email,
        acceptedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: { company: true },
    });
  }

  private generateInvitationToken(): string {
    // Generate a random token
    const randomBytes = require('crypto').randomBytes(32);
    return randomBytes.toString('hex');
  }
}
