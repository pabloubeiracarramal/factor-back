import { Controller, Get, Req, Res, UseGuards, Post, Body, Param, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleLogin(@Query('state') state?: string) {
    // Initiates Google OAuth flow
    // State parameter can contain invitation token or return URL
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('state') state?: string
  ) {
    // Validate and create/find user
    const user = await this.authService.validateGoogleUser(req.user as any);
    
    // Generate JWT token
    const { access_token } = await this.authService.generateJwtToken(user);

    // Determine redirect URL based on state parameter or company status
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    let redirectPath = '/dashboard'; // Default to dashboard
    
    // Check if state contains invitation token
    if (state && state.startsWith('invitation:')) {
      const invitationToken = state.replace('invitation:', '');
      redirectPath = `/accept-invitation?token=${invitationToken}`;
    }
    // Check if user has a pending invitation (in case they signed up directly from invitation link)
    else if (!user.companyId) {
      const pendingInvitation = await this.authService.getPendingInvitation(user.email);
      if (pendingInvitation) {
        redirectPath = `/accept-invitation?token=${pendingInvitation.token}`;
      } else {
        redirectPath = '/create-company';
      }
    }

    res.redirect(`${frontendUrl}/auth/callback?token=${access_token}&redirect=${redirectPath}`);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Req() req: Request) {
    const user = await this.authService.getUserById((req.user as any).userId);
    return user;
  }

  @Post('invitations')
  @UseGuards(JwtAuthGuard)
  async createInvitation(
    @Req() req: Request,
    @Body() body: { email: string }
  ) {
    const user = await this.authService.getUserById((req.user as any).userId);
    
    if (!user || !user.companyId) {
      throw new Error('User must belong to a company to send invitations');
    }

    const invitation = await this.authService.createInvitation(
      user.companyId,
      body.email
    );

    // Return the invitation link
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    return {
      ...invitation,
      invitationUrl: `${frontendUrl}/accept-invitation?token=${invitation.token}`
    };
  }

  @Get('invitations/:token')
  async getInvitation(@Param('token') token: string) {
    const invitation = await this.authService.getInvitationByToken(token);
    
    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.expiresAt < new Date()) {
      throw new Error('Invitation expired');
    }

    if (invitation.acceptedAt) {
      throw new Error('Invitation already accepted');
    }

    return {
      company: invitation.company,
      email: invitation.email,
    };
  }

  @Post('invitations/:token/accept')
  @UseGuards(JwtAuthGuard)
  async acceptInvitation(
    @Param('token') token: string,
    @Req() req: Request
  ) {
    const userId = (req.user as any).userId;
    const user = await this.authService.acceptInvitation(token, userId);
    
    return {
      message: 'Invitation accepted successfully',
      user,
    };
  }
}
