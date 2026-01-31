import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCompanyDto: CreateCompanyDto) {
    const { name, street, city, postalCode, state, country, vatNumber, adminEmail, adminName } = createCompanyDto;

    // Check if user with this email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (existingUser && existingUser.companyId) {
      throw new ConflictException('User already belongs to a company');
    }

    // Create company with admin user in a transaction
    const company = await this.prisma.company.create({
      data: {
        name,
        street,
        city,
        postalCode,
        state,
        country,
        vatNumber,
        users: {
          connectOrCreate: {
            where: { email: adminEmail },
            create: {
              email: adminEmail,
              name: adminName,
            },
          },
        },
      },
      include: {
        users: true,
      },
    });

    return company;
  }

  async findAll() {
    return this.prisma.company.findMany({
      include: {
        users: true,
        _count: {
          select: {
            invoices: true,
            users: true,
          },
        },
      },
    });
  }

  async findByUserId(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        company: {
          include: {
            users: true,
            _count: {
              select: {
                invoices: true,
                users: true,
                clients: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.company) {
      throw new NotFoundException('User does not belong to any company');
    }

    return user.company;
  }

  async findOne(id: string) {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: {
        users: true,
        invoices: true,
        invitations: {
          where: {
            acceptedAt: null,
            expiresAt: {
              gte: new Date(),
            },
          },
        },
      },
    });

    if (!company) {
      throw new NotFoundException(`Company with ID ${id} not found`);
    }

    return company;
  }

  async update(id: string, updateCompanyDto: UpdateCompanyDto) {
    const { adminEmail, adminName, ...companyData } = updateCompanyDto;

    // Verify company exists
    await this.findOne(id);

    const company = await this.prisma.company.update({
      where: { id },
      data: companyData,
      include: {
        users: true,
      },
    });

    return company;
  }

  async remove(id: string) {
    // Verify company exists
    await this.findOne(id);

    // Delete company (this will cascade to related records based on Prisma schema)
    await this.prisma.company.delete({
      where: { id },
    });

    return { message: 'Company deleted successfully' };
  }

  async removeUser(companyId: string, userIdToRemove: string, currentUserId: string) {
    // Verify company exists
    const company = await this.findOne(companyId);

    // Verify user to remove exists and belongs to this company
    const userToRemove = await this.prisma.user.findUnique({
      where: { id: userIdToRemove },
    });

    if (!userToRemove) {
      throw new NotFoundException('User not found');
    }

    if (userToRemove.companyId !== companyId) {
      throw new ConflictException('User does not belong to this company');
    }

    // Get current user to check if they're an admin
    const currentUser = await this.prisma.user.findUnique({
      where: { id: currentUserId },
    });

    if (!currentUser || currentUser.companyId !== companyId) {
      throw new ConflictException('You do not have permission to remove users from this company');
    }

    if (currentUser.role !== 'ADMIN') {
      throw new ConflictException('Only admins can remove users from the company');
    }

    // Prevent removing yourself
    if (userIdToRemove === currentUserId) {
      throw new ConflictException('You cannot remove yourself from the company');
    }

    // Check if this is the last admin
    if (userToRemove.role === 'ADMIN') {
      const adminCount = await this.prisma.user.count({
        where: {
          companyId,
          role: 'ADMIN',
        },
      });

      if (adminCount <= 1) {
        throw new ConflictException('Cannot remove the last admin from the company');
      }
    }

    // Remove user from company by setting companyId to null
    await this.prisma.user.update({
      where: { id: userIdToRemove },
      data: {
        companyId: null,
      },
    });

    return { message: 'User removed from company successfully' };
  }
}
