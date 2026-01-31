import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsNumber,
  IsDateString,
  IsEnum,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
}

export class InvoiceItemDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  taxRate?: number = 21.00;
}

export class CreateInvoiceDto {
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  observations?: string;

  @IsDateString()
  @IsOptional()
  emissionDate?: string;

  @IsDateString()
  dueDate: string;

  @IsString()
  @IsOptional()
  invoiceSeries?: string;

  @IsString()
  @IsOptional()
  reference?: string;

  @IsString()
  @IsOptional()
  currency?: string = 'EUR';

  @IsEnum(InvoiceStatus)
  @IsOptional()
  status?: InvoiceStatus = InvoiceStatus.DRAFT;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemDto)
  items: InvoiceItemDto[];
}
