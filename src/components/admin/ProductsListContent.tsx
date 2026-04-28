'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { CATALOG_CATEGORIES, PRODUCTS } from '@/lib/catalog-data';
import type { CatalogProduct } from '@/lib/catalog-data';
import { ProductCard } from './ProductCard';
import { ProductWizard } from './ProductWizard';
import { ProductDeleteDialog } from './ProductDeleteDialog';
import { Overlay, OverlayTitle } from '@/components/ui/Overlay';

type TabValue = 'todos' | string;

const CATEGORY_TABS: { label: string; value: TabValue }[] = [
  { label: 'Todos', value: 'todos' },
  ...CATALOG_CATEGORIES.map((cat) => ({
    label: cat.type.charAt(0).toUpperCase() + cat.type.slice(1).replace(/-/g, ' '),
    value: cat.type,
  })),
];

// Set of static product IDs for quick lookup
const STATIC_IDS = new Set(PRODUCTS.map((p) => p.id));

export function ProductsListContent() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>('todos');
  const [showWizard, setShowWizard] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CatalogProduct | null>(null);
  const [editTarget, setEditTarget] = useState<CatalogProduct | null>(null);

  const fetchProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/products');
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products);
      }
    } catch (err) {
      console.error('Error fetching products:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const filteredProducts = activeTab === 'todos'
    ? products
    : products.filter((p) => p.category === activeTab);

  const categoryCount = (value: TabValue) => {
    if (value === 'todos') return products.length;
    return products.filter((p) => p.category === value).length;
  };

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/admin/products/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteTarget(null);
        fetchProducts();
      }
    } catch (err) {
      console.error('Error deleting product:', err);
    }
  }, [deleteTarget, fetchProducts]);

  return (
    <div className="flex flex-col gap-6">
      {/* Top bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-warm-gray">
          {products.length} productos ({PRODUCTS.length} estaticos, {products.length - PRODUCTS.length} dinamicos)
        </p>
        <button
          onClick={() => setShowWizard(true)}
          className="rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90"
        >
          + Agregar Producto
        </button>
      </div>

      {/* Category tabs */}
      <div
        className="flex gap-1 overflow-x-auto rounded-lg bg-white p-1"
        style={{ border: '1px solid #e5e0d4' }}
      >
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={[
              'shrink-0 cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.value
                ? 'bg-terracotta text-white'
                : 'text-warm-gray hover:bg-cream hover:text-charcoal',
            ].join(' ')}
          >
            {tab.label}
            <span className={[
              'ml-1.5 inline-block min-w-[18px] rounded-full px-1 py-0.5 text-center text-[10px] leading-none',
              activeTab === tab.value
                ? 'bg-white/20 text-white'
                : 'bg-warm-gray/10 text-warm-gray',
            ].join(' ')}>
              {categoryCount(tab.value)}
            </span>
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-warm-gray/20 border-t-terracotta" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredProducts.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-xl bg-white py-16" style={{ border: '1px solid #e5e0d4' }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#d4cfc5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          <p className="mt-4 text-sm text-warm-gray">
            No hay productos en esta categoria.
          </p>
        </div>
      )}

      {/* Product grid */}
      {!isLoading && filteredProducts.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {filteredProducts.map((product, i) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03, duration: 0.3 }}
            >
              <ProductCard
                product={product}
                isStatic={STATIC_IDS.has(product.id)}
                onEdit={() => setEditTarget(product)}
                onDelete={() => setDeleteTarget(product)}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Wizard modal */}
      {showWizard && (
        <ProductWizard
          onClose={() => setShowWizard(false)}
          onSaved={() => {
            setShowWizard(false);
            fetchProducts();
          }}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <ProductDeleteDialog
          productName={deleteTarget.name}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Edit dialog (for now, simple inline - can be expanded later) */}
      {editTarget && !STATIC_IDS.has(editTarget.id) && (
        <EditProductDialog
          product={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            fetchProducts();
          }}
        />
      )}
    </div>
  );
}

// ─── Inline Edit Dialog ──────────────────────────────────────────────────────

function EditProductDialog({
  product,
  onClose,
  onSaved,
}: {
  product: CatalogProduct;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [price, setPrice] = useState(product.price);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    try {
      const res = await fetch(`/api/admin/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, price }),
      });
      if (res.ok) onSaved();
    } catch (err) {
      console.error('Error updating product:', err);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Overlay
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      variant="modal-center"
      zLayer="modal"
      ariaLabel="Editar producto"
      contentClassName="bg-white p-6 max-w-sm"
      closeOnOverlayClick={!isSaving}
      closeOnEscape={!isSaving}
    >
      <OverlayTitle asChild>
        <h3 className="text-lg font-semibold text-charcoal" style={{ fontFamily: 'var(--font-cormorant), Georgia, serif' }}>
          Editar producto
        </h3>
      </OverlayTitle>

      <div className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="edit-name" className="text-xs font-medium text-warm-gray">Nombre</label>
          <input
            id="edit-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg bg-white px-3 py-2 text-sm text-charcoal"
            style={{ border: '1px solid #e5e0d4' }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="edit-price" className="text-xs font-medium text-warm-gray">Precio (MXN)</label>
          <input
            id="edit-price"
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            min={0}
            className="rounded-lg bg-white px-3 py-2 text-sm text-charcoal"
            style={{ border: '1px solid #e5e0d4' }}
          />
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <button
          onClick={onClose}
          disabled={isSaving}
          className="flex-1 min-h-[44px] rounded-lg px-4 py-2.5 text-sm font-medium text-warm-gray transition-colors hover:bg-cream"
          style={{ border: '1px solid #e5e0d4' }}
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving || !name.trim()}
          className="flex-1 min-h-[44px] rounded-lg bg-terracotta px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-terracotta/90 disabled:opacity-50"
        >
          {isSaving ? 'Guardando...' : 'Guardar'}
        </button>
      </div>
    </Overlay>
  );
}
