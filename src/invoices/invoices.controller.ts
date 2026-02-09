import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Query, Res, StreamableFile } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { FilterInvoiceDto } from './dto/filter-invoice.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  create(@Body() createInvoiceDto: CreateInvoiceDto, @CurrentUser() user: any) {
    return this.invoicesService.create(createInvoiceDto, user.userId);
  }

  @Get('dashboard')
  getDashboardStats(@CurrentUser() user: any) {
    return this.invoicesService.getDashboardStats(user.userId);
  }

  @Get()
  findAll(@Query() filterDto: FilterInvoiceDto, @CurrentUser() user: any) {
    return this.invoicesService.findAll(user.userId, filterDto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoicesService.findOne(id);
  }

  @Patch(':id/confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: any) {
    return this.invoicesService.confirm(id, user.userId);
  }

  @Patch(':id/pay')
  pay(@Param('id') id: string, @CurrentUser() user: any) {
    return this.invoicesService.pay(id, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateInvoiceDto: UpdateInvoiceDto) {
    return this.invoicesService.update(id, updateInvoiceDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.invoicesService.remove(id);
  }

  @Get(':id/pdf/preview')
  async previewPDF(@Param('id') id: string, @Res() res: any) {
    try {
      const pdfBuffer = await this.invoicesService.generatePDF(id);
      
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Length': pdfBuffer.length,
      });
      
      res.end(pdfBuffer);
    } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).json({ 
        message: 'Failed to generate PDF',
        error: error.message 
      });
    }
  }

  @Get(':id/pdf/download')
  async downloadPDF(@Param('id') id: string, @Res() res: any) {
    try {
      const invoice = await this.invoicesService.findOne(id);
      const pdfBuffer = await this.invoicesService.generatePDF(id);
      
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${invoice.invoiceSeries}-${invoice.invoiceNumber}.pdf"`,
        'Content-Length': pdfBuffer.length,
      });
      
      res.end(pdfBuffer);
    } catch (error) {
      console.error('Error generating PDF:', error);
      res.status(500).json({ 
        message: 'Failed to generate PDF',
        error: error.message 
      });
    }
  }
}
