import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/admin/auth';
import { PRODUCTS } from '@/lib/catalog-data';
import { getDynamicProducts, addProduct } from '@/lib/admin/product-store';
import { extractOriginal } from '@/lib/admin/original-extractor';
import { getObject } from '@/lib/storage';
import type { CategoryType } from '@/lib/customization-types';
import type { GridSize } from '@/lib/grid-config';
import type { SeamData } from '@/lib/catalog-data';
import type { SeamDetectionResult } from '@/lib/admin/seam-detection';

// GET /api/admin/products
export async function GET() {
  const isAdmin = await verifySession();
  if (!isAdmin) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const dynamic = await getDynamicProducts();
    const allProducts = [...PRODUCTS, ...dynamic];

    return NextResponse.json({
      products: allProducts,
      staticCount: PRODUCTS.length,
      dynamicCount: dynamic.length,
    });
  } catch (err) {
    console.error('[admin/products] GET error:', err);
    return NextResponse.json({ error: 'Error al obtener productos.' }, { status: 500 });
  }
}

// POST /api/admin/products
export async function POST(request: NextRequest) {
  const isAdmin = await verifySession();
  if (!isAdmin) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, category, price, gridSize, grid, pieces, tempImageKey, seamData, contentType, detection } = body as {
      name: string;
      category: CategoryType;
      price: number;
      gridSize: GridSize;
      grid: string;
      pieces: number;
      tempImageKey: string;
      seamData: SeamData;
      contentType: string;
      detection: SeamDetectionResult;
    };

    if (!name || !category || !price || !gridSize || !grid || !tempImageKey || !seamData) {
      return NextResponse.json({ error: 'Faltan campos requeridos.' }, { status: 400 });
    }

    // Fetch the temp image from R2 to generate the clean original
    const tempObj = await getObject('uploads', tempImageKey);
    const tempBuffer = Buffer.from(await tempObj.Body!.transformToByteArray());

    const originalBuffer = await extractOriginal(tempBuffer, detection);

    const product = await addProduct({
      name,
      category,
      price,
      gridSize,
      grid,
      pieces,
      tempImageKey,
      seamData,
      originalBuffer,
      contentType: contentType || 'image/png',
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (err) {
    console.error('[admin/products] POST error:', err);
    return NextResponse.json({ error: 'Error al crear producto.' }, { status: 500 });
  }
}
