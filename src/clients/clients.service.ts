import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { FilterClientDto } from './dto/filter-client.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async create(createClientDto: CreateClientDto, userId: string) {
    // Fetch user with companyId from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company to create clients',
      );
    }

    const client = await this.prisma.client.create({
      data: {
        ...createClientDto,
        companyId: user.companyId,
      },
    });

    return client;
  }

  async findAll(userId: string, filterDto: FilterClientDto) {
    // Fetch user with companyId from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company to view clients',
      );
    }

    // Build where clause dynamically based on filters
    const where: any = {
      companyId: user.companyId,
    };

    // Filter by date range
    if (filterDto.dateFrom || filterDto.dateTo) {
      where.createdAt = {};
      if (filterDto.dateFrom) {
        where.createdAt.gte = new Date(filterDto.dateFrom);
      }
      if (filterDto.dateTo) {
        where.createdAt.lte = new Date(filterDto.dateTo);
      }
    }

    // Filter by name (case-insensitive partial match)
    if (filterDto.name) {
      where.name = {
        contains: filterDto.name,
        mode: 'insensitive',
      };
    }

    // Filter by email (case-insensitive partial match)
    if (filterDto.email) {
      where.email = {
        contains: filterDto.email,
        mode: 'insensitive',
      };
    }

    // Filter by phone (partial match)
    if (filterDto.phone) {
      where.phone = {
        contains: filterDto.phone,
      };
    }

    // Filter by VAT number (partial match)
    if (filterDto.vatNumber) {
      where.vatNumber = {
        contains: filterDto.vatNumber,
        mode: 'insensitive',
      };
    }

    const clients = await this.prisma.client.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });

    return clients;
  }

  async findOne(id: string, userId: string) {
    // Fetch user with companyId from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company',
      );
    }

    const client = await this.prisma.client.findFirst({
      where: {
        id,
        companyId: user.companyId,
      },
      include: {
        invoices: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!client) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    return client;
  }

  async update(id: string, updateClientDto: UpdateClientDto, userId: string) {
    // Fetch user with companyId from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company',
      );
    }

    // Verify client belongs to user's company
    const existingClient = await this.prisma.client.findFirst({
      where: {
        id,
        companyId: user.companyId,
      },
    });

    if (!existingClient) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    const client = await this.prisma.client.update({
      where: { id },
      data: updateClientDto,
    });

    return client;
  }

  async remove(id: string, userId: string) {
    // Fetch user with companyId from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company',
      );
    }

    // Verify client belongs to user's company
    const existingClient = await this.prisma.client.findFirst({
      where: {
        id,
        companyId: user.companyId,
      },
    });

    if (!existingClient) {
      throw new NotFoundException(`Client with ID ${id} not found`);
    }

    await this.prisma.client.delete({
      where: { id },
    });

    return { message: 'Client deleted successfully' };
  }
}
