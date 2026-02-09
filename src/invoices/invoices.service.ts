import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { FilterInvoiceDto } from './dto/filter-invoice.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Invoice, InvoiceItem, Company, Client } from '@prisma/client';
import PDFDocument = require('pdfkit');

type InvoiceWithRelations = Invoice & {
  items: InvoiceItem[];
  company: Company | null;
  client: Client | null;
};

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  private calculateInvoiceTotalWithTax(invoice: any): number {
    return invoice.items.reduce((sum, item) => {
      const itemSubtotal = Number(item.price) * item.quantity;
      const itemTax = itemSubtotal * (Number(item.taxRate) / 100);
      return sum + itemSubtotal + itemTax;
    }, 0);
  }

  async getDashboardStats(userId: string) {
    // Fetch user with companyId from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company to view dashboard',
      );
    }

    const companyId = user.companyId;
    const now = new Date();

    // Fetch all data in parallel
    const [invoices, users, invitations] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { companyId },
        include: { items: true, client: true },
      }),
      this.prisma.user.count({ where: { companyId } }),
      this.prisma.companyInvitation.count({
        where: { companyId, acceptedAt: null, expiresAt: { gt: now } },
      }),
    ]);

    // Calculate metrics
    const paid = invoices.filter((i) => i.status === 'PAID');
    const overdue = invoices.filter(
      (i) =>
        i.status === 'OVERDUE' ||
        (new Date(i.dueDate) < now && i.status !== 'PAID'),
    );
    const drafts = invoices.filter((i) => i.status === 'DRAFT');
    const pending = invoices.filter((i) => i.status === 'PENDING');

    const totalRevenue = paid.reduce(
      (sum, i) => sum + this.calculateInvoiceTotalWithTax(i),
      0,
    );
    const outstandingAmount = [...overdue, ...drafts, ...pending].reduce(
      (sum, i) => sum + this.calculateInvoiceTotalWithTax(i),
      0,
    );

    return {
      metrics: {
        totalRevenue,
        outstandingAmount,
        invoiceCount: {
          total: invoices.length,
          paid: paid.length,
          overdue: overdue.length,
          draft: drafts.length,
          pending: pending.length,
        },
      },
      topClients: this.getTopClients(paid),
      monthlyRevenue: this.getMonthlyRevenue(paid),
      team: {
        activeMembers: users,
        pendingInvitations: invitations,
      },
    };
  }

  private getTopClients(paidInvoices: any[]) {
    const clientMap = new Map<string, number>();
    paidInvoices.forEach((inv) => {
      const clientName = inv.client?.name || 'Unknown';
      const current = clientMap.get(clientName) || 0;
      clientMap.set(clientName, current + this.calculateInvoiceTotalWithTax(inv));
    });
    return Array.from(clientMap.entries())
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }

  private getMonthlyRevenue(paidInvoices: any[]) {
    const monthMap = new Map<string, number>();
    paidInvoices.forEach((inv) => {
      const month = new Date(inv.createdAt).toISOString().slice(0, 7);
      const current = monthMap.get(month) || 0;
      monthMap.set(month, current + this.calculateInvoiceTotalWithTax(inv));
    });
    return Array.from(monthMap.entries())
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  async create(createInvoiceDto: CreateInvoiceDto, userId: string) {
    // Fetch user with companyId from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company to create invoices',
      );
    }

    const companyId = user.companyId;

    // Determine invoice series
    const invoiceSeries = createInvoiceDto.invoiceSeries || new Date().getFullYear().toString();
    const isDraft = !createInvoiceDto.status || createInvoiceDto.status === 'DRAFT';
    const dueDays = createInvoiceDto.dueDays ?? 30;

    let invoiceNumber = '';
    let emissionDate: Date = new Date(0);

    if (!isDraft) {
      const invoiceCount = await this.prisma.invoice.count({
        where: { companyId, invoiceSeries, status: { not: 'DRAFT' } },
      });
      invoiceNumber = String(invoiceCount + 1).padStart(4, '0');
      emissionDate = createInvoiceDto.emissionDate ? new Date(createInvoiceDto.emissionDate) : new Date();
    }

    // Calculate dueDate from dueDays
    const baseDate = isDraft ? new Date() : emissionDate;
    const dueDate = new Date(baseDate);
    dueDate.setDate(dueDate.getDate() + dueDays);

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        invoiceSeries,
        reference: createInvoiceDto.reference,
        clientId: createInvoiceDto.clientId,
        description: createInvoiceDto.description,
        observations: createInvoiceDto.observations,
        status: isDraft ? 'DRAFT' : (createInvoiceDto.status || 'DRAFT'),
        emissionDate,
        operationDate: createInvoiceDto.operationDate ? new Date(createInvoiceDto.operationDate) : null,
        dueDays,
        dueDate,
        currency: createInvoiceDto.currency || 'EUR',
        paymentMethod: createInvoiceDto.paymentMethod,
        companyId,
        items: {
          create: createInvoiceDto.items.map((item) => ({
            name: item.name,
            description: item.description,
            quantity: item.quantity,
            price: item.price,
            taxRate: item.taxRate ?? 21.00,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    return invoice;
  }

  async confirm(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company to confirm invoices',
      );
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with id ${id} not found`);
    }

    if (invoice.status !== 'DRAFT') {
      throw new BadRequestException('Only draft invoices can be confirmed');
    }

    if (invoice.companyId !== user.companyId) {
      throw new BadRequestException('Invoice does not belong to your company');
    }

    const invoiceSeries = invoice.invoiceSeries;
    const invoiceCount = await this.prisma.invoice.count({
      where: {
        companyId: user.companyId,
        invoiceSeries,
        status: { not: 'DRAFT' },
      },
    });
    const invoiceNumber = String(invoiceCount + 1).padStart(4, '0');

    const emissionDate = new Date();
    const dueDate = new Date(emissionDate);
    dueDate.setDate(dueDate.getDate() + invoice.dueDays);

    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: 'PENDING',
        invoiceNumber,
        emissionDate,
        dueDate,
      },
      include: { items: true },
    });
  }

  async pay(id: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company to mark invoices as paid',
      );
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with id ${id} not found`);
    }

    if (invoice.status !== 'PENDING') {
      throw new BadRequestException('Only pending invoices can be marked as paid');
    }

    if (invoice.companyId !== user.companyId) {
      throw new BadRequestException('Invoice does not belong to your company');
    }

    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: 'PAID',
      },
      include: { items: true },
    });
  }

  async findAll(userId: string, filterDto: FilterInvoiceDto) {
    // Fetch user with companyId from database
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });

    if (!user?.companyId) {
      throw new BadRequestException(
        'User must be associated with a company to view invoices',
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

    // Filter by status
    if (filterDto.status) {
      where.status = filterDto.status;
    }

    // Filter by client ID
    if (filterDto.clientId) {
      where.clientId = filterDto.clientId;
    }

    // Filter by reference
    if (filterDto.reference) {
      where.reference = {
        contains: filterDto.reference,
        mode: 'insensitive',
      };
    }

    const invoices = await this.prisma.invoice.findMany({
      where,
      include: {
        items: true,
        client: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Filter by price range (calculated from items)
    let filteredInvoices = invoices;
    if (filterDto.priceMin !== undefined || filterDto.priceMax !== undefined) {
      filteredInvoices = invoices.filter((invoice) => {
        const total = this.calculateInvoiceTotalWithTax(invoice);
        if (filterDto.priceMin !== undefined && total < filterDto.priceMin) {
          return false;
        }
        if (filterDto.priceMax !== undefined && total > filterDto.priceMax) {
          return false;
        }
        return true;
      });
    }

    return filteredInvoices;
  }

  async findOne(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
        company: true,
        client: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with id ${id} not found`);
    }

    return invoice;
  }

  async update(id: string, updateInvoiceDto: UpdateInvoiceDto) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    // Separate items from other update data
    const { items, ...updateData } = updateInvoiceDto;

    // Build the update query
    const data: any = {
      ...updateData,
    };

    // If items are provided, replace them
    if (items) {
      data.items = {
        deleteMany: {}, // Delete all existing items
        create: items.map((item) => ({
          name: item.name,
          description: item.description,
          quantity: item.quantity,
          price: item.price,
          taxRate: item.taxRate ?? 21.00,
        })),
      };
    }

    // Convert date strings if provided
    if (updateData.emissionDate) {
      data.emissionDate = new Date(updateData.emissionDate);
    }

    // Recalculate dueDate if dueDays changed
    if (updateData.dueDays !== undefined) {
      const emissionDate = data.emissionDate || invoice.emissionDate;
      const baseDate = invoice.status === 'DRAFT' ? new Date() : new Date(emissionDate);
      const dueDate = new Date(baseDate);
      dueDate.setDate(dueDate.getDate() + updateData.dueDays);
      data.dueDate = dueDate;
    }

    return this.prisma.invoice.update({
      where: { id },
      data,
      include: { items: true },
    });
  }

  async remove(id: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    // Delete invoice items first, then delete the invoice
    await this.prisma.invoiceItem.deleteMany({
      where: { invoiceId: id },
    });

    await this.prisma.invoice.delete({
      where: { id },
    });

    return { message: `Invoice #${invoice.invoiceNumber} has been deleted successfully` };
  }

  // Helper to get currency symbol
  private getCurrencySymbol(currency: string): string {
    const symbols = {
      EUR: '€',
      USD: '$',
      GBP: '£',
      JPY: '¥',
      CHF: 'CHF',
    };
    return symbols[currency] || currency;
  }

  // PDF Layout Constants
  private readonly PDF_LAYOUT = {
    MARGINS: { LEFT: 40, RIGHT: 555, TOP: 40 },
    FONTS: {
      TITLE: 18,
      LARGE: 10,
      NORMAL: 9,
      SMALL: 8,
      TINY: 7,
    },
    SPACING: {
      LINE: 12,
      SECTION: 20,
      LARGE_SECTION: 40,
    },
    CLIENT_BOX: { X: 360, Y: 90, WIDTH: 195, HEIGHT: 105 },
    INVOICE_TABLE: { Y: 210, WIDTH: 515 },
  };

  private calculateInvoiceTotals(invoice: any) {
    let baseAmount = 0;
    let totalTax = 0;
    const taxBreakdown = new Map<string, { base: number; tax: number }>();

    invoice.items.forEach((item) => {
      const itemBase = Number(item.price) * item.quantity;
      const taxRate = Number(item.taxRate);
      const itemTax = itemBase * (taxRate / 100);

      baseAmount += itemBase;
      totalTax += itemTax;

      // Group by tax rate for summary
      const key = taxRate.toFixed(2);
      const existing = taxBreakdown.get(key) || { base: 0, tax: 0 };
      taxBreakdown.set(key, {
        base: existing.base + itemBase,
        tax: existing.tax + itemTax,
      });
    });

    return {
      baseAmount,
      totalTax,
      totalWithTax: baseAmount + totalTax,
      taxBreakdown: Array.from(taxBreakdown.entries()).map(([rate, amounts]) => ({
        rate: Number(rate),
        ...amounts,
      })),
    };
  }

  private drawCompanyInfo(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations): void {
    const { LEFT } = this.PDF_LAYOUT.MARGINS;
    let yPos = this.PDF_LAYOUT.MARGINS.TOP;

    doc
      .fontSize(this.PDF_LAYOUT.FONTS.LARGE)
      .font('Helvetica-Bold')
      .text(invoice.company?.name || 'Company Name', LEFT, yPos);

    yPos += this.PDF_LAYOUT.SPACING.LINE + 3;
    doc
      .fontSize(this.PDF_LAYOUT.FONTS.NORMAL)
      .font('Helvetica');

    // Company address - Street
    if (invoice.company?.street) {
      doc.text(invoice.company.street, LEFT, yPos);
      yPos += this.PDF_LAYOUT.SPACING.LINE;
    }

    // Company address - City, Postal Code, State
    const companyCityLine = [
      invoice.company?.postalCode,
      invoice.company?.city,
      invoice.company?.state,
    ].filter(Boolean).join(', ');
    if (companyCityLine) {
      doc.text(companyCityLine, LEFT, yPos);
      yPos += this.PDF_LAYOUT.SPACING.LINE;
    }

    // Company address - Country
    if (invoice.company?.country) {
      doc.text(invoice.company.country, LEFT, yPos);
      yPos += this.PDF_LAYOUT.SPACING.LINE;
    }

    doc.text(`Tel. ${invoice.company?.phone || 'N/A'}`, LEFT, yPos);

    yPos += this.PDF_LAYOUT.SPACING.LINE;
    doc.text(`e-Mail ${invoice.company?.email || 'N/A'}`, LEFT, yPos);

    yPos += this.PDF_LAYOUT.SPACING.SECTION;
    doc
      .fontSize(this.PDF_LAYOUT.FONTS.SMALL)
      .text(`C.I.F. ${invoice.company?.vatNumber || 'N/A'}`, LEFT, yPos);
  }

  private drawInvoiceHeader(doc: PDFKit.PDFDocument): void {
    doc
      .fontSize(this.PDF_LAYOUT.FONTS.TITLE)
      .font('Helvetica-Bold')
      .text('FACTURA', 400, this.PDF_LAYOUT.MARGINS.TOP, {
        align: 'right',
        width: 155,
      });

    doc
      .fontSize(this.PDF_LAYOUT.FONTS.SMALL)
      .font('Helvetica')
      .text('Página  1 / 1', 400, 65, { align: 'right', width: 155 });
  }

  private drawClientBox(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations): void {
    const { X, Y, WIDTH, HEIGHT } = this.PDF_LAYOUT.CLIENT_BOX;
    const padding = 5;
    const lineHeight = 11;

    doc.rect(X, Y, WIDTH, HEIGHT).stroke();

    let yPos = Y + 8;

    // Client name
    const clientName = invoice.client?.name || 'N/A';
    doc
      .fontSize(this.PDF_LAYOUT.FONTS.SMALL)
      .font('Helvetica-Bold')
      .text(clientName, X + padding, yPos, {
        width: WIDTH - padding * 2,
      });

    yPos += lineHeight + 2;
    doc.fontSize(this.PDF_LAYOUT.FONTS.SMALL).font('Helvetica');

    // Address - Street
    if (invoice.client?.street) {
      doc.text(invoice.client.street, X + padding, yPos, {
        width: WIDTH - padding * 2,
      });
      yPos += lineHeight;
    }

    // Address - City, Postal Code, State
    const cityLine = [
      invoice.client?.postalCode,
      invoice.client?.city,
      invoice.client?.state,
    ].filter(Boolean).join(', ');
    if (cityLine) {
      doc.text(cityLine, X + padding, yPos, {
        width: WIDTH - padding * 2,
      });
      yPos += lineHeight;
    }

    // Address - Country
    if (invoice.client?.country) {
      doc.text(invoice.client.country, X + padding, yPos, {
        width: WIDTH - padding * 2,
      });
      yPos += lineHeight;
    }

    // VAT Number
    if (invoice.client?.vatNumber) {
      doc.text(`NIF/CIF: ${invoice.client.vatNumber}`, X + padding, yPos, {
        width: WIDTH - padding * 2,
      });
      yPos += lineHeight;
    }

    // Email
    if (invoice.client?.email) {
      doc.text(invoice.client.email, X + padding, yPos, {
        width: WIDTH - padding * 2,
      });
      yPos += lineHeight;
    }

    // Phone
    if (invoice.client?.phone) {
      doc.text(invoice.client.phone, X + padding, yPos, {
        width: WIDTH - padding * 2,
      });
    }
  }

  private drawInvoiceDetailsTable(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations): number {
    const { LEFT } = this.PDF_LAYOUT.MARGINS;
    const { Y, WIDTH } = this.PDF_LAYOUT.INVOICE_TABLE;
    const colWidths = [100, 100, 100, 100, 115]; // 4 columns for top row
    const headerRowHeight = 20;
    const padding = 6;
    const fontSize = this.PDF_LAYOUT.FONTS.SMALL;
    const minDataRowHeight = 20;

    // Data to display (first row - invoice number, dates)
    const data = [
      `${invoice.invoiceSeries}-${invoice.invoiceNumber}`,
      new Date(invoice.emissionDate).toLocaleDateString('es-ES'),
      new Date(invoice.emissionDate).toLocaleDateString('es-ES'), // Operation date (same as emission for now)
      new Date(invoice.dueDate).toLocaleDateString('es-ES'),
    ];

    // Reference row data
    const referenceText = invoice.reference || '-';

    // Calculate dynamic row height based on content
    doc.fontSize(fontSize).font('Helvetica');
    let dataRowHeight = minDataRowHeight;
    data.forEach((value, i) => {
      if (value) {
        const textHeight = doc.heightOfString(value, { width: colWidths[i] - padding * 2 });
        const requiredHeight = textHeight + padding * 2;
        if (requiredHeight > dataRowHeight) {
          dataRowHeight = requiredHeight;
        }
      }
    });

    // Calculate reference row height
    const referenceTextHeight = doc.heightOfString(referenceText, { width: WIDTH - padding * 2 });
    const referenceRowHeight = Math.max(minDataRowHeight, referenceTextHeight + padding * 2);

    // Total table height: header + data row + reference header + reference data
    const tableHeight = headerRowHeight + dataRowHeight + headerRowHeight + referenceRowHeight;
    const verticalPadding = 7; // Consistent top padding for all rows

    // Draw table border
    doc.rect(LEFT, Y, WIDTH, tableHeight).stroke();

    // Draw vertical lines (only for the first two rows - 4 columns)
    let xPos = LEFT;
    for (let i = 0; i < 3; i++) {
      xPos += colWidths[i];
      doc.moveTo(xPos, Y).lineTo(xPos, Y + headerRowHeight + dataRowHeight).stroke();
    }

    // Draw horizontal lines
    // Line after first header row
    doc.moveTo(LEFT, Y + headerRowHeight).lineTo(LEFT + WIDTH, Y + headerRowHeight).stroke();
    // Line after first data row (before reference header)
    doc.moveTo(LEFT, Y + headerRowHeight + dataRowHeight).lineTo(LEFT + WIDTH, Y + headerRowHeight + dataRowHeight).stroke();
    // Line after reference header
    doc.moveTo(LEFT, Y + headerRowHeight + dataRowHeight + headerRowHeight).lineTo(LEFT + WIDTH, Y + headerRowHeight + dataRowHeight + headerRowHeight).stroke();

    // Headers (first row - 4 columns)
    doc.fontSize(fontSize).font('Helvetica-Bold');
    const headers = ['Número factura', 'Fecha emisión', 'Fecha operación', 'Fecha vencimiento'];
    xPos = LEFT;
    headers.forEach((header, i) => {
      doc.text(header, xPos + padding, Y + verticalPadding, {
        width: colWidths[i] - padding * 2,
        align: 'center',
      });
      xPos += colWidths[i];
    });

    // Data (first row - 4 columns)
    doc.font('Helvetica');
    const dataAlignments: ('left' | 'center' | 'right')[] = ['right', 'left', 'left', 'left'];
    xPos = LEFT;
    for (let i = 0; i < 4; i++) {
      doc.text(data[i], xPos + padding, Y + headerRowHeight + verticalPadding, {
        width: colWidths[i] - padding * 2,
        align: dataAlignments[i],
      });
      xPos += colWidths[i];
    }

    // Reference header (full width row)
    const referenceHeaderY = Y + headerRowHeight + dataRowHeight;
    doc.font('Helvetica-Bold');
    doc.text('Referencia', LEFT + padding, referenceHeaderY + verticalPadding, {
      width: WIDTH - padding * 2,
      align: 'left',
    });

    // Reference data (full width row)
    const referenceDataY = referenceHeaderY + headerRowHeight;
    doc.font('Helvetica');
    doc.text(referenceText, LEFT + padding, referenceDataY + verticalPadding, {
      width: WIDTH - padding * 2,
      align: 'left',
    });

    return Y + tableHeight;
  }

  private drawDescription(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations, yStart: number): number {
    const { LEFT, RIGHT } = this.PDF_LAYOUT.MARGINS;

    doc
      .fontSize(this.PDF_LAYOUT.FONTS.SMALL)
      .font('Helvetica-Bold')
      .text('Descripción', LEFT, yStart);

    doc
      .font('Helvetica')
      .text(invoice.description || invoice.items.map((i) => i.name).join(', '), LEFT, yStart + 12, {
        width: RIGHT - LEFT,
      });

    return yStart + this.PDF_LAYOUT.SPACING.SECTION + 35;
  }

  private drawItemsTable(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations, yStart: number): number {
    const { LEFT, RIGHT } = this.PDF_LAYOUT.MARGINS;
    const columns = [
      { label: 'Cantidad', x: 40, width: 50, align: 'center' as const },
      { label: 'Código', x: 90, width: 50, align: 'center' as const },
      { label: 'Artículo', x: 140, width: 150, align: 'left' as const },
      { label: 'Precio', x: 290, width: 65, align: 'right' as const },
      { label: 'IVA %', x: 355, width: 40, align: 'right' as const },
      { label: 'Subtotal', x: 395, width: 75, align: 'right' as const },
      { label: 'Total', x: 470, width: 70, align: 'right' as const },
    ];

    const minRowHeight = 20;
    const rowPadding = 5;
    const tableWidth = RIGHT - LEFT;

    // Table header
    doc.fontSize(this.PDF_LAYOUT.FONTS.SMALL).font('Helvetica-Bold');
    columns.forEach((col) => {
      doc.text(col.label, col.x, yStart, { width: col.width, align: col.align });
    });

    // Header line
    doc.moveTo(LEFT, yStart + 15).lineTo(RIGHT, yStart + 15).stroke();

    // Table rows
    doc.font('Helvetica');
    let yPosition = yStart + 20;
    let totalQuantity = 0;
    let rowIndex = 0;

    const currencySymbol = this.getCurrencySymbol(invoice.currency);

    invoice.items.forEach((item) => {
      const itemSubtotal = Number(item.price) * item.quantity;
      const itemTax = itemSubtotal * (Number(item.taxRate) / 100);
      const itemTotal = itemSubtotal + itemTax;
      totalQuantity += item.quantity;

      // Build item text: name + optional description (description in smaller text below)
      const itemText = item.description ? `${item.name}\n${item.description}` : item.name;

      // Calculate dynamic row height based on item text
      const itemTextHeight = doc.heightOfString(itemText, { width: columns[2].width });
      const rowHeight = Math.max(minRowHeight, itemTextHeight + rowPadding * 2 + 4); // Extra padding between rows
      const textY = yPosition + rowPadding;

      // Draw alternating row background
      if (rowIndex % 2 === 1) {
        doc.save();
        doc.fillColor('#f5f5f5').rect(LEFT, yPosition, tableWidth, rowHeight).fill();
        doc.fillColor('#000000');
        doc.restore();
      }

      // If quantity is 0, only show item text (no numbers)
      const isZeroQuantity = item.quantity === 0;

      doc.text(isZeroQuantity ? '' : item.quantity.toString(), columns[0].x, textY, {
        width: columns[0].width,
        align: columns[0].align,
      });
      doc.text('', columns[1].x, textY, { width: columns[1].width });
      
      // Draw item name (larger font, regular weight)
      doc.font('Helvetica').fontSize(this.PDF_LAYOUT.FONTS.NORMAL).text(item.name, columns[2].x, textY, {
        width: columns[2].width,
      });
      
      // Draw description below name if exists (smaller font)
      if (item.description) {
        const nameHeight = doc.heightOfString(item.name, { width: columns[2].width });
        doc.fontSize(this.PDF_LAYOUT.FONTS.TINY)
          .text(item.description, columns[2].x, textY + nameHeight + 3, {
            width: columns[2].width,
          });
      }
      
      doc.fontSize(this.PDF_LAYOUT.FONTS.SMALL);
      doc.text(isZeroQuantity ? '' : `${Number(item.price).toFixed(2)} ${currencySymbol}`, columns[3].x, textY, {
        width: columns[3].width,
        align: columns[3].align,
      });
      doc.text(isZeroQuantity ? '' : Number(item.taxRate).toFixed(0) + '%', columns[4].x, textY, {
        width: columns[4].width,
        align: columns[4].align,
      });
      doc.text(isZeroQuantity ? '' : `${itemSubtotal.toFixed(2)} ${currencySymbol}`, columns[5].x, textY, {
        width: columns[5].width,
        align: columns[5].align,
      });
      doc.text(isZeroQuantity ? '' : `${itemTotal.toFixed(2)} ${currencySymbol}`, columns[6].x, textY, {
        width: columns[6].width,
        align: columns[6].align,
      });

      yPosition += rowHeight;
      rowIndex++;
    });

    // Total row
    doc.moveTo(LEFT, yPosition).lineTo(RIGHT, yPosition).stroke();
    yPosition += 10;

    const totals = this.calculateInvoiceTotals(invoice);
    doc.font('Helvetica-Bold');
    doc.text(totalQuantity.toString(), columns[0].x, yPosition, {
      width: columns[0].width,
      align: columns[0].align,
    });
    doc.text(`${totals.baseAmount.toFixed(2)} ${currencySymbol}`, columns[5].x, yPosition, {
      width: columns[5].width,
      align: columns[5].align,
    });
    doc.text(`${totals.totalWithTax.toFixed(2)} ${currencySymbol}`, columns[6].x, yPosition, {
      width: columns[6].width,
      align: columns[6].align,
    });

    return yPosition + 30;
  }

  private drawTaxSummary(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations, yStart: number): number {
    const totals = this.calculateInvoiceTotals(invoice);
    const columns = [
      { label: 'Descuento', x: 40, width: 85 },
      { label: 'Descuento P. Pago', x: 125, width: 85 },
      { label: 'Base Imponible', x: 210, width: 85 },
      { label: 'Importe IVA', x: 295, width: 85 },
      { label: 'Importe R.E.', x: 380, width: 85 },
      { label: 'Total', x: 465, width: 90 },
    ];

    const headerRowHeight = 18;
    const valueRowHeight = 20;
    const tableHeight = headerRowHeight + valueRowHeight;

    // Draw table border and cells
    columns.forEach((col) => {
      doc.rect(col.x, yStart, col.width, tableHeight).stroke();
      // Draw horizontal line between header and values
      doc.moveTo(col.x, yStart + headerRowHeight).lineTo(col.x + col.width, yStart + headerRowHeight).stroke();
    });

    // Headers
    doc.fontSize(this.PDF_LAYOUT.FONTS.TINY).font('Helvetica-Bold');
    columns.forEach((col) => {
      doc.text(col.label, col.x, yStart + 5, { width: col.width, align: 'center' });
    });

    // Values
    doc.fontSize(this.PDF_LAYOUT.FONTS.SMALL).font('Helvetica');
    const yPos = yStart + headerRowHeight + 5;
    const currencySymbol = this.getCurrencySymbol(invoice.currency);

    // Show actual tax breakdown
    if (totals.taxBreakdown.length > 0) {
      doc.text('-', columns[0].x, yPos, { width: columns[0].width, align: 'center' });
      doc.text('-', columns[1].x, yPos, { width: columns[1].width, align: 'center' });
      doc.text(`${totals.baseAmount.toFixed(2)} ${currencySymbol}`, columns[2].x, yPos, {
        width: columns[2].width,
        align: 'center',
      });
      doc.text(`${totals.totalTax.toFixed(2)} ${currencySymbol}`, columns[3].x, yPos, {
        width: columns[3].width,
        align: 'center',
      });
      doc.text('-', columns[4].x, yPos, { width: columns[4].width, align: 'center' });
      doc.font('Helvetica-Bold').text(`${totals.totalWithTax.toFixed(2)} ${currencySymbol}`, columns[5].x, yPos, {
        width: columns[5].width,
        align: 'center',
      });
    }

    return yStart + tableHeight + this.PDF_LAYOUT.SPACING.SECTION;
  }

  private drawTotalSection(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations, yStart: number): number {
    const totals = this.calculateInvoiceTotals(invoice);
    const currencySymbol = this.getCurrencySymbol(invoice.currency);

    doc.fontSize(this.PDF_LAYOUT.FONTS.LARGE).font('Helvetica-Bold');
    doc.text('TOTAL FACTURA', 305, yStart, { width: 150 });
    doc.text(`${totals.totalWithTax.toFixed(2)} ${currencySymbol}`, 455, yStart, {
      width: 100,
      align: 'right',
    });

    return yStart + this.PDF_LAYOUT.SPACING.LARGE_SECTION;
  }

  private getPaymentMethodLabel(paymentMethod: string | null): string {
    const labels: Record<string, string> = {
      BANK_TRANSFER: 'TRANSFERENCIA BANCARIA',
      CASH: 'AL CONTADO',
      CREDIT_CARD: 'TARJETA DE CRÉDITO',
      PAYPAL: 'PAYPAL',
      OTHER: 'OTRO',
    };
    return labels[paymentMethod || 'BANK_TRANSFER'] || 'TRANSFERENCIA BANCARIA';
  }

  private drawPaymentInfo(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations, yStart: number): number {
    const { LEFT } = this.PDF_LAYOUT.MARGINS;
    const paymentMethod = invoice.paymentMethod || 'BANK_TRANSFER';

    doc
      .fontSize(this.PDF_LAYOUT.FONTS.SMALL)
      .font('Helvetica-Bold')
      .text('Forma de Pago:', LEFT, yStart);

    doc.font('Helvetica').text(this.getPaymentMethodLabel(paymentMethod), LEFT, yStart + 15);

    let yEnd = yStart + 30;

    // Show bank account number only for bank transfer
    if (paymentMethod === 'BANK_TRANSFER' && invoice.company?.bankAccountNumber) {
      doc
        .font('Helvetica-Bold')
        .text('Cuenta Bancaria (IBAN):', LEFT, yStart + 35);
      doc.font('Helvetica').text(invoice.company.bankAccountNumber, LEFT, yStart + 50);
      yEnd = yStart + 65;
    }

    return yEnd;
  }

  private drawObservations(doc: PDFKit.PDFDocument, invoice: InvoiceWithRelations, yStart: number): number {
    if (!invoice.observations) {
      return yStart;
    }

    const { LEFT, RIGHT } = this.PDF_LAYOUT.MARGINS;

    doc
      .fontSize(this.PDF_LAYOUT.FONTS.SMALL)
      .font('Helvetica-Bold')
      .text('Observaciones:', LEFT, yStart);

    doc
      .font('Helvetica')
      .text(invoice.observations, LEFT, yStart + 15, {
        width: RIGHT - LEFT,
      });

    const textHeight = doc.heightOfString(invoice.observations, { width: RIGHT - LEFT });
    return yStart + 15 + textHeight + this.PDF_LAYOUT.SPACING.SECTION;
  }

  async generatePDF(id: string): Promise<Buffer> {
    const invoice = await this.findOne(id);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margins: {
            top: this.PDF_LAYOUT.MARGINS.TOP,
            bottom: this.PDF_LAYOUT.MARGINS.TOP,
            left: this.PDF_LAYOUT.MARGINS.LEFT,
            right: this.PDF_LAYOUT.MARGINS.LEFT,
          },
        });

        const chunks: Buffer[] = [];

        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Draw all PDF sections
        this.drawCompanyInfo(doc, invoice);
        this.drawInvoiceHeader(doc);
        this.drawClientBox(doc, invoice);
        const invoiceTableEndY = this.drawInvoiceDetailsTable(doc, invoice);

        let yPos = invoiceTableEndY + 15;
        yPos = this.drawDescription(doc, invoice, yPos);
        yPos = this.drawItemsTable(doc, invoice, yPos);
        yPos = this.drawTaxSummary(doc, invoice, yPos);
        yPos = this.drawTotalSection(doc, invoice, yPos);
        yPos = this.drawPaymentInfo(doc, invoice, yPos);
        this.drawObservations(doc, invoice, yPos + 20);

        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }
}
