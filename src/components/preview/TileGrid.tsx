'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { getTileLayout, type CategoryCustomization, type CategoryType } from '@/lib/customization-types';
import type { GridSize } from '@/lib/grid-config';
import type { SeamData } from '@/lib/catalog-data';

/**
 * Fridge-mockup tile-grid renderer. Used by:
 *   - Catalog product detail page (`PredesignedPreview`) for stock mosaics
 *   - Cart-item detail page (`/carrito/[itemId]`) for custom mosaics
 *
 * Renders the assembled composite image as a grid where each cell uses
 * CSS `backgroundPosition` + `backgroundSize` to show its slice of the
 * composite. Seam-aware for non-uniform grids (Arte) via `seamData`. Tiles
 * have spring-based entry animation + magnetic-shadow hover affordance.
 *
 * Both consumers (catalog + cart) pass the same primitives:
 *   - compositeUrl: full assembled mosaic (R2 URL or /api/cart-composite/blob/{id})
 *   - rows/cols: grid dimensions
 *   - seamData: optional non-uniform tile boundaries
 *   - categoryType: optional, only Arte uses it (4×3 grid with 9 occupied cells)
 *
 * NOTE: keeps the visual contract stable across consumers — any change
 * here updates both surfaces.
 */
interface TileGridProps {
  compositeUrl: string;
  rows: number;
  cols: number;
  /** Used to size occupiedCells (Arte's L-shape). Defaults to full rows×cols. */
  categoryType?: CategoryType;
  /** Equivalent to category's `gridSize`; required only when categoryType is Arte. */
  gridSize?: GridSize;
  /** Optional non-uniform tile boundaries (Arte uses this). */
  seamData?: SeamData;
  /** Whether to render entry/hover animations. Defaults to true. */
  animated?: boolean;
}

interface OccupiedCell {
  index: number;
  col: number;
  row: number;
  gridColumn?: number;
  gridRow?: number;
}

export function TileGrid({
  compositeUrl,
  rows,
  cols,
  categoryType,
  gridSize,
  seamData,
  animated = true,
}: TileGridProps) {
  const occupiedCells = useMemo<OccupiedCell[]>(() => {
    // Arte ships a 4×3 grid where only 9 of 12 cells are occupied (an
    // L-shape). The customization-types layout is the source of truth for
    // which cells are filled — read it instead of hardcoding here.
    if (categoryType === 'arte' && gridSize !== undefined) {
      const layout = getTileLayout({
        categoryType: 'arte',
        gridSize,
      } as CategoryCustomization);
      return layout.map((tile) => ({
        index: tile.index,
        col: tile.gridColumn ? tile.gridColumn - 1 : tile.index % cols,
        row: tile.gridRow ? tile.gridRow - 1 : Math.floor(tile.index / cols),
        gridColumn: tile.gridColumn,
        gridRow: tile.gridRow,
      }));
    }

    // Every other category fills the full grid row-major.
    return Array.from({ length: rows * cols }, (_, i) => ({
      index: i,
      col: i % cols,
      row: Math.floor(i / cols),
    }));
  }, [categoryType, gridSize, rows, cols]);

  const tileRotations = useMemo(() => {
    return Array.from({ length: occupiedCells.length }, (_, i) => {
      // Deterministic pseudo-random from index — avoids hydration
      // mismatches between server and client renders.
      const hash1 = Math.sin(i * 2654435761 + 0.1) * 10000;
      const hash2 = Math.sin(i * 1597334677 + 0.7) * 10000;
      return {
        initial: -2 + (hash1 - Math.floor(hash1)) * 4,
        hover: -1.5 + (hash2 - Math.floor(hash2)) * 3,
      };
    });
  }, [occupiedCells.length]);

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: seamData
          ? seamGridTemplate(seamData.vertical)
          : `repeat(${cols}, 1fr)`,
        gridTemplateRows: seamData
          ? seamGridTemplate(seamData.horizontal)
          : `repeat(${rows}, 1fr)`,
        gap: seamData ? 0 : '3px',
        aspectRatio: `${cols} / ${rows}`,
      }}
    >
      {occupiedCells.map((cell, i) => {
        const tileStyle = seamData
          ? seamTileStyle(compositeUrl, cell.col, cell.row, cols, rows, seamData)
          : {
              backgroundImage: `url(${compositeUrl})`,
              backgroundSize: `${cols * 100}% ${rows * 100}%`,
              backgroundPosition: bgPos(cell.col, cell.row, cols, rows),
            };

        return (
          <motion.div
            key={cell.index}
            initial={
              animated
                ? { opacity: 0, scale: 0.8, rotateZ: tileRotations[i].initial }
                : false
            }
            animate={animated ? { opacity: 1, scale: 1, rotateZ: 0 } : undefined}
            transition={
              animated
                ? {
                    type: 'spring',
                    stiffness: 260,
                    damping: 20,
                    delay: cell.index * 0.05 + 0.15,
                  }
                : undefined
            }
            whileHover={
              animated
                ? {
                    scale: 1.04,
                    rotateZ: tileRotations[i].hover,
                    zIndex: 10,
                    transition: { duration: 0.2 },
                  }
                : undefined
            }
            className="group/tile relative cursor-default rounded-md"
            style={{
              ...tileStyle,
              boxShadow:
                '0 2px 8px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
              ...(cell.gridColumn
                ? { gridColumn: cell.gridColumn, gridRow: cell.gridRow }
                : {}),
            }}
          >
            <div
              className="absolute -bottom-1 left-1/2 -z-10 h-2 w-4/5 -translate-x-1/2 rounded-full opacity-0 transition-opacity group-hover/tile:opacity-20"
              style={{
                background:
                  'radial-gradient(ellipse, rgba(0,0,0,0.3) 0%, transparent 70%)',
              }}
              aria-hidden="true"
            />
          </motion.div>
        );
      })}
    </div>
  );
}

/** Background-position for a cell in a uniform sprite grid. */
function bgPos(col: number, row: number, cols: number, rows: number): string {
  const x = cols > 1 ? (col / (cols - 1)) * 100 : 50;
  const y = rows > 1 ? (row / (rows - 1)) * 100 : 50;
  return `${x}% ${y}%`;
}

/**
 * Build a CSS grid-template from explicit seam positions.
 * Seams are normalized 0..1 splits between adjacent tiles.
 */
function seamGridTemplate(seams: number[]): string {
  const boundaries = [0, ...seams, 1];
  const fractions: string[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    fractions.push(`${((boundaries[i + 1] - boundaries[i]) * 100).toFixed(3)}%`);
  }
  return fractions.join(' ');
}

/**
 * Per-tile background-image CSS using exact seam boundaries. Each tile
 * shows exactly the portion of the composite between its boundary seams.
 */
function seamTileStyle(
  imageUrl: string,
  col: number,
  row: number,
  cols: number,
  rows: number,
  seamData: SeamData,
): React.CSSProperties {
  const xBounds = [0, ...seamData.vertical, 1];
  const yBounds = [0, ...seamData.horizontal, 1];

  const x0 = xBounds[col];
  const x1 = xBounds[col + 1];
  const y0 = yBounds[row];
  const y1 = yBounds[row + 1];

  const tileW = x1 - x0;
  const tileH = y1 - y0;

  const bgW = (1 / tileW) * 100;
  const bgH = (1 / tileH) * 100;

  const bgX = tileW < 1 ? (x0 / (1 - tileW)) * 100 : 0;
  const bgY = tileH < 1 ? (y0 / (1 - tileH)) * 100 : 0;

  return {
    backgroundImage: `url(${imageUrl})`,
    backgroundSize: `${bgW.toFixed(2)}% ${bgH.toFixed(2)}%`,
    backgroundPosition: `${bgX.toFixed(2)}% ${bgY.toFixed(2)}%`,
  };
}

// Re-exports needed by callers that want to control the seam logic
// directly. Kept intentionally small — most consumers should pass
// `seamData` and let the component handle the math.
export { bgPos, seamGridTemplate, seamTileStyle };
