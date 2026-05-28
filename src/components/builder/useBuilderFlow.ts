import { useState, useCallback, useMemo, useRef } from 'react';
import { getEffectiveGridConfig, type GridSize, type GridConfig } from '@/lib/grid-config';
import {
  CATEGORY_REGISTRY,
  type CategoryType,
  type TonosIntensity,
} from '@/lib/customization-types';
import { CATEGORY_LAYOUTS } from '@/lib/category-layouts';
import type { CropArea } from '@/lib/canvas-utils';

// ─── Step system ────────────────────────────────────────────────────────────

export type StepId = 'category' | 'grid' | 'upload' | 'crop' | 'customize' | 'preview';

export function getStepsForCategory(cat: CategoryType): StepId[] {
  const meta = CATEGORY_REGISTRY[cat];
  const steps: StepId[] = ['category'];
  if (meta.allowedGridSizes.length > 1) steps.push('grid');
  steps.push('upload', 'crop');
  if (meta.textFields.length > 0 || meta.hasTheme) steps.push('customize');
  steps.push('preview');
  return steps;
}

/** i18n key for each step ID */
export const STEP_I18N_MAP: Record<StepId, string> = {
  category: 'stepCategory',
  grid: 'stepGrid',
  upload: 'stepUpload',
  crop: 'stepCrop',
  customize: 'stepCustomize',
  preview: 'stepPreview',
};

// ─── Tonos state (3 images) ─────────────────────────────────────────────────

// Use the centralized types from customization-types.ts (single source of
// truth) so cart-store, serializer, webhook, processor, and the builder all
// agree. Keep re-exports under the legacy names so existing consumers
// (ImageCropperMulti, MagnetBuilder, MagnetPreview) that import from this
// module continue to work without path changes. `TonosSlot` is the legacy
// local name; alias it to the canonical `TonosSlotConfig`.
import type {
  TonosFitMode,
  TonosRotation,
  TonosSlotConfig,
  TonosSlotConfigs,
} from '@/lib/customization-types';
export type { TonosFitMode, TonosRotation, TonosSlotConfigs };
export type TonosSlot = TonosSlotConfig;

/**
 * UAT-3 Phase 3b (Codex Approach B + C2): fixed 3-slot multi-photo
 * shape used by Tonos and STD-3 alike. The hard-coded length matches
 * `deriveUploadSlots(layout, grid) === 3` for both categories. If a
 * future category needs a different slot count, replace this with a
 * helper driven by `deriveUploadSlots`.
 */
export type MultiPhotoIndex = 0 | 1 | 2;
export type MultiPhotoSlots<T> = [T, T, T];

/**
 * Generic multi-photo state shared by Tonos and STD-3. Per Codex's
 * Phase 3b plan (state-decouple-implementation): ownership separation.
 * Tonos-only effects live in `TonosEffectsState` below.
 */
export interface MultiPhotoState {
  fileRefs: React.RefObject<MultiPhotoSlots<File | null>>;
  imageSrcs: MultiPhotoSlots<string | null>;
  cropAreas: MultiPhotoSlots<CropArea | null>;
  liveCropAreas: MultiPhotoSlots<CropArea | null>;
  /**
   * Phase 6.2 (Codex audit fix) — per-slot remount counter. Bumped by
   * `handleMultiPhotoSlotReset` and `handleMultiPhotoSlotReplacePhoto`
   * so the cropper for that slot remounts with fresh local state
   * (crop/zoom/imageSize). Without this, a Reset on a slot already at
   * fill/0 doesn't trigger the local crop/zoom effect (deps unchanged)
   * AND a pending debounced onCropChange could fire after Reset and
   * repopulate `liveCropAreas` with stale data. Remount via React
   * `key={resetSeq[i]}` clears all local state cleanly in one shot.
   */
  resetSeq: MultiPhotoSlots<number>;
}

/**
 * Tonos-only effects: color intensity + per-column tone/fitMode
 * configuration. STD-3 doesn't read these; the builder gates the
 * Tonos UI via `category === 'tonos'`.
 */
export interface TonosEffectsState {
  intensity: TonosIntensity;
  slots: TonosSlotConfigs;
}

const DEFAULT_TONOS_SLOT: TonosSlotConfig = { fitMode: 'fill', rotation: 0 };

function nextRotation(r: TonosRotation): TonosRotation {
  return ((r + 90) % 360) as TonosRotation;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export interface BuilderFlowState {
  // Step navigation
  currentStepId: StepId;
  stepSequence: StepId[];
  currentStepIndex: number;
  direction: number;
  goToStep: (stepId: StepId) => void;
  goBack: () => void;
  goForward: () => void;

  // Category
  selectedCategory: CategoryType | null;
  handleCategorySelect: (cat: CategoryType) => void;

  // Grid
  selectedGrid: GridSize | null;
  gridConfig: GridConfig | null;
  handleGridSelect: (grid: GridSize) => void;

  // Image (single-image categories)
  imageSrc: string | null;
  imageFileRef: React.RefObject<File | null>;
  handleImageSelected: (file: File) => void;

  // Crop (single-image)
  cropAreaPixels: CropArea | null;
  liveCropArea: CropArea | null;
  handleCropComplete: (croppedArea: CropArea, croppedAreaPixels: CropArea) => void;
  handleCropChange: (croppedAreaPixels: CropArea) => void;

  // Multi-photo (Tonos + STD-3): shared image/crop state
  multiPhoto: MultiPhotoState;
  handleMultiPhotoImageSelected: (index: MultiPhotoIndex, file: File) => void;
  handleMultiPhotoImagesSelected: (files: [File, File, File]) => void;
  handleMultiPhotoCropChange: (index: MultiPhotoIndex, cropAreaPixels: CropArea) => void;
  handleMultiPhotoCropComplete: (index: MultiPhotoIndex, cropAreaPixels: CropArea) => void;
  /**
   * Phase 6.2 — Reset a single multi-photo slot's cropper state to
   * defaults (fitMode='fill', rotation=0 for Tonos, crop areas cleared
   * for everyone). Keeps the photo intact. Mirrors the single-image
   * cropper's `Restablecer` button.
   */
  handleMultiPhotoSlotReset: (index: MultiPhotoIndex) => void;
  /**
   * Phase 6.2 — Replace a single multi-photo slot's photo. Revokes the
   * prior URL, swaps in the new file, and clears that slot's crop
   * areas so the cropper picks up the new photo cleanly. Other slots
   * untouched.
   */
  handleMultiPhotoSlotReplacePhoto: (index: MultiPhotoIndex, file: File) => void;
  advanceFromMultiCrop: () => void;

  // Tonos-only effects (intensity, per-column fitMode + rotation)
  tonosEffects: TonosEffectsState;
  setTonosIntensity: (intensity: TonosIntensity) => void;
  setTonosFitMode: (index: MultiPhotoIndex, mode: TonosFitMode) => void;
  toggleTonosRotation: (index: MultiPhotoIndex) => void;

  // Layout rotation
  layoutRotated: boolean;
  canRotateLayout: boolean;
  handleLayoutRotate: () => void;

  // Customization (text fields only — themes removed)
  customizationValues: Record<string, string>;
  setCustomizationValue: (field: string, value: string) => void;
  handleCustomizeComplete: () => void;

  // Upload state
  isUploading: boolean;
  setIsUploading: (v: boolean) => void;
  addToCartError: string | null;
  setAddToCartError: (v: string | null) => void;

  // Replace the currently-uploaded single image: clears photo + crop state
  // and navigates back to the upload step so the user can re-pick.
  handleReplaceSingleImage: () => void;

  // Reset
  handleReset: () => void;
}

const DEFAULT_STEPS: StepId[] = ['category'];

export interface BuilderFlowOptions {
  initialCategory?: CategoryType | null;
  initialGrid?: GridSize | null;
}

function emptyTuple<T>(value: T): [T, T, T] {
  return [value, value, value];
}

export function useBuilderFlow(options?: BuilderFlowOptions): BuilderFlowState {
  const { initialCategory = null, initialGrid = null } = options ?? {};

  const initState = useMemo(() => {
    if (!initialCategory || !CATEGORY_REGISTRY[initialCategory]) {
      return { category: null, grid: null, steps: DEFAULT_STEPS, startStep: 'category' as StepId };
    }

    const meta = CATEGORY_REGISTRY[initialCategory];
    const steps = getStepsForCategory(initialCategory);

    let grid: GridSize | null = null;
    if (initialGrid && meta.allowedGridSizes.includes(initialGrid)) {
      grid = initialGrid;
    } else if (meta.allowedGridSizes.length === 1) {
      grid = meta.allowedGridSizes[0];
    }

    let startStep: StepId = 'category';
    if (grid) {
      startStep = 'upload';
    } else if (steps.includes('grid')) {
      startStep = 'grid';
    } else {
      startStep = 'upload';
    }

    return { category: initialCategory, grid, steps, startStep };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Step state ───
  const [stepSequence, setStepSequence] = useState<StepId[]>(initState.steps);
  const [currentStepId, setCurrentStepId] = useState<StepId>(initState.startStep);
  const [direction, setDirection] = useState(1);

  // ─── Category ───
  const [selectedCategory, setSelectedCategory] = useState<CategoryType | null>(initState.category);

  // ─── Grid ───
  const [selectedGrid, setSelectedGrid] = useState<GridSize | null>(initState.grid);

  // ─── Single image ───
  const [, setImageFile] = useState<File | null>(null);
  const imageFileRef = useRef<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  // ─── Single crop ───
  const [cropAreaPixels, setCropAreaPixels] = useState<CropArea | null>(null);
  const [liveCropArea, setLiveCropArea] = useState<CropArea | null>(null);

  // ─── Tonos multi-image ───
  const multiPhotoFileRefs = useRef<[File | null, File | null, File | null]>([null, null, null]);
  const [multiPhotoImageSrcs, setMultiPhotoImageSrcs] = useState<[string | null, string | null, string | null]>(
    emptyTuple<string | null>(null),
  );
  const [multiPhotoCropAreas, setMultiPhotoCropAreas] = useState<[CropArea | null, CropArea | null, CropArea | null]>(
    emptyTuple<CropArea | null>(null),
  );
  const [multiPhotoLiveCropAreas, setMultiPhotoLiveCropAreas] = useState<[CropArea | null, CropArea | null, CropArea | null]>(
    emptyTuple<CropArea | null>(null),
  );
  const [tonosIntensity, setTonosIntensityState] = useState<TonosIntensity>('medium');
  const [tonosSlots, setTonosSlots] = useState<[TonosSlot, TonosSlot, TonosSlot]>([
    { ...DEFAULT_TONOS_SLOT },
    { ...DEFAULT_TONOS_SLOT },
    { ...DEFAULT_TONOS_SLOT },
  ]);
  // Per-slot remount counter (Phase 6.2). React key={resetSeq[i]} on
  // each TonosCropSlot — bumping the counter for slot i forces that
  // slot to remount with fresh local state. See TonosState comment.
  const [multiPhotoResetSeq, setMultiPhotoResetSeq] = useState<[number, number, number]>([0, 0, 0]);

  // ─── Layout rotation ───
  const [layoutRotated, setLayoutRotated] = useState(false);

  // ─── Customization ───
  const [customizationValues, setCustomizationValues] = useState<Record<string, string>>({});

  // ─── Upload ───
  const [isUploading, setIsUploading] = useState(false);
  const [addToCartError, setAddToCartError] = useState<string | null>(null);

  // ─── Stable views ───
  // UAT-3 Phase 3b: ownership separation per Codex Approach B. Generic
  // multi-photo state (image/crop/file/reset) lives in `multiPhoto`;
  // Tonos-only effects (intensity + per-column slots) live in
  // `tonosEffects`. STD-3 uses only `multiPhoto`; Tonos uses both.
  const multiPhoto = useMemo<MultiPhotoState>(
    () => ({
      fileRefs: multiPhotoFileRefs,
      imageSrcs: multiPhotoImageSrcs,
      cropAreas: multiPhotoCropAreas,
      liveCropAreas: multiPhotoLiveCropAreas,
      resetSeq: multiPhotoResetSeq,
    }),
    [multiPhotoImageSrcs, multiPhotoCropAreas, multiPhotoLiveCropAreas, multiPhotoResetSeq],
  );
  const tonosEffects = useMemo<TonosEffectsState>(
    () => ({
      intensity: tonosIntensity,
      slots: tonosSlots,
    }),
    [tonosIntensity, tonosSlots],
  );

  // ─── Derived ───
  const baseGridConfig: GridConfig | null = useMemo(
    () => (selectedGrid ? getEffectiveGridConfig(selectedGrid, selectedCategory ?? undefined) : null),
    [selectedGrid, selectedCategory],
  );

  const gridConfig: GridConfig | null = useMemo(() => {
    if (!baseGridConfig || !layoutRotated) return baseGridConfig;
    return {
      ...baseGridConfig,
      rows: baseGridConfig.cols,
      cols: baseGridConfig.rows,
      aspect: 1 / baseGridConfig.aspect,
    };
  }, [baseGridConfig, layoutRotated]);

  const canRotateLayout = useMemo(() => {
    if (!baseGridConfig || !selectedCategory) return false;
    // `layout.rotatable` collapses both the old checks (non-Tonos, non-override)
    // into a single declarative field on the category contract.
    if (!CATEGORY_LAYOUTS[selectedCategory].rotatable) return false;
    return baseGridConfig.rows !== baseGridConfig.cols;
  }, [baseGridConfig, selectedCategory]);

  const currentStepIndex = useMemo(
    () => stepSequence.indexOf(currentStepId),
    [stepSequence, currentStepId],
  );

  // ─── Navigation ───
  const navigateTo = useCallback((stepId: StepId, steps: StepId[]) => {
    const fromIdx = steps.indexOf(currentStepId);
    const toIdx = steps.indexOf(stepId);
    setDirection(toIdx > fromIdx ? 1 : -1);
    setCurrentStepId(stepId);
  }, [currentStepId]);

  const goToStep = useCallback((stepId: StepId) => {
    navigateTo(stepId, stepSequence);
  }, [navigateTo, stepSequence]);

  const goBack = useCallback(() => {
    const idx = stepSequence.indexOf(currentStepId);
    if (idx > 0) {
      setDirection(-1);
      setCurrentStepId(stepSequence[idx - 1]);
    }
  }, [stepSequence, currentStepId]);

  const goForward = useCallback(() => {
    const idx = stepSequence.indexOf(currentStepId);
    if (idx < stepSequence.length - 1) {
      setDirection(1);
      setCurrentStepId(stepSequence[idx + 1]);
    }
  }, [stepSequence, currentStepId]);

  // ─── Helpers to reset state ───
  const clearSingleImage = useCallback(() => {
    if (imageSrc) URL.revokeObjectURL(imageSrc);
    setImageFile(null);
    imageFileRef.current = null;
    setImageSrc(null);
    setCropAreaPixels(null);
    setLiveCropArea(null);
  }, [imageSrc]);

  const clearTonos = useCallback(() => {
    multiPhotoImageSrcs.forEach((s) => { if (s) URL.revokeObjectURL(s); });
    multiPhotoFileRefs.current = [null, null, null];
    setMultiPhotoImageSrcs(emptyTuple<string | null>(null));
    setMultiPhotoCropAreas(emptyTuple<CropArea | null>(null));
    setMultiPhotoLiveCropAreas(emptyTuple<CropArea | null>(null));
    setTonosIntensityState('medium');
    setTonosSlots([
      { ...DEFAULT_TONOS_SLOT },
      { ...DEFAULT_TONOS_SLOT },
      { ...DEFAULT_TONOS_SLOT },
    ]);
  }, [multiPhotoImageSrcs]);

  // ─── Category select ───
  const handleCategorySelect = useCallback((cat: CategoryType) => {
    setSelectedCategory(cat);

    const meta = CATEGORY_REGISTRY[cat];
    const newSteps = getStepsForCategory(cat);
    setStepSequence(newSteps);

    if (meta.allowedGridSizes.length === 1) {
      setSelectedGrid(meta.allowedGridSizes[0]);
    } else {
      setSelectedGrid(null);
    }

    clearSingleImage();
    clearTonos();
    setCustomizationValues({});
    setLayoutRotated(false);

    const nextStep = newSteps[1];
    setTimeout(() => {
      setDirection(1);
      setCurrentStepId(nextStep);
    }, 250);
  }, [clearSingleImage, clearTonos]);

  // ─── Grid select ───
  const handleGridSelect = useCallback((grid: GridSize) => {
    setSelectedGrid(grid);
    setLayoutRotated(false);
    setTimeout(() => {
      setDirection(1);
      setCurrentStepId('upload');
    }, 250);
  }, []);

  // ─── Single image selected ───
  const handleImageSelected = useCallback((file: File) => {
    setImageFile(file);
    imageFileRef.current = file;
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    setDirection(1);
    setCurrentStepId('crop');
  }, []);

  // ─── Single crop handlers ───
  const handleCropComplete = useCallback(
    (_croppedArea: CropArea, croppedAreaPixels: CropArea) => {
      setCropAreaPixels(croppedAreaPixels);
      setDirection(1);
      const nextStep = stepSequence.includes('customize') ? 'customize' : 'preview';
      setCurrentStepId(nextStep);
    },
    [stepSequence],
  );

  const handleCropChange = useCallback((croppedAreaPixels: CropArea) => {
    setLiveCropArea(croppedAreaPixels);
  }, []);

  // ─── Tonos handlers ───
  const handleMultiPhotoImageSelected = useCallback((index: MultiPhotoIndex, file: File) => {
    const refs = multiPhotoFileRefs.current;
    refs[index] = file;
    const url = URL.createObjectURL(file);
    setMultiPhotoImageSrcs((prev) => {
      const next: [string | null, string | null, string | null] = [...prev];
      if (next[index]) URL.revokeObjectURL(next[index] as string);
      next[index] = url;
      return next;
    });
    // Codex Phase 6.2 round-2 audit fix: PhotoUploaderMulti uses this
    // same handler for both initial empty-slot picks AND for changing
    // a non-empty slot after Back-from-crop. Both paths must clear
    // stale crop areas and remount the cropper; otherwise the
    // re-picked slot keeps a cropArea sized to the prior image and
    // Preview / Add-to-cart stay enabled with stale data.
    //
    // Doing this unconditionally is safe — initial empty picks have
    // null cropAreas already (these become no-ops via the React
    // bailout) and the slot wasn't mounted before so the resetSeq
    // bump is just the first mount's key.
    setMultiPhotoCropAreas((p) => {
      if (p[index] === null) return p;
      const n: [CropArea | null, CropArea | null, CropArea | null] = [...p];
      n[index] = null;
      return n;
    });
    setMultiPhotoLiveCropAreas((p) => {
      if (p[index] === null) return p;
      const n: [CropArea | null, CropArea | null, CropArea | null] = [...p];
      n[index] = null;
      return n;
    });
    setMultiPhotoResetSeq((p) => {
      const n: [number, number, number] = [...p];
      n[index] = p[index] + 1;
      return n;
    });
  }, []);

  const handleMultiPhotoImagesSelected = useCallback((files: [File, File, File]) => {
    files.forEach((file, i) => handleMultiPhotoImageSelected(i as MultiPhotoIndex, file));
    setDirection(1);
    setCurrentStepId('crop');
  }, [handleMultiPhotoImageSelected]);

  const handleMultiPhotoCropChange = useCallback((index: MultiPhotoIndex, cropAreaPixels: CropArea) => {
    setMultiPhotoLiveCropAreas((prev) => {
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = cropAreaPixels;
      return next;
    });
  }, []);

  const handleMultiPhotoCropComplete = useCallback((index: MultiPhotoIndex, cropAreaPixels: CropArea) => {
    setMultiPhotoCropAreas((prev) => {
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = cropAreaPixels;
      return next;
    });
  }, []);

  const setTonosIntensity = useCallback((intensity: TonosIntensity) => {
    setTonosIntensityState(intensity);
  }, []);

  const setTonosFitMode = useCallback((index: MultiPhotoIndex, mode: TonosFitMode) => {
    setTonosSlots((prev) => {
      if (prev[index].fitMode === mode) return prev;
      const next: [TonosSlot, TonosSlot, TonosSlot] = [...prev];
      next[index] = { ...prev[index], fitMode: mode };
      return next;
    });
    // Reset that slot's crop area so the new mode starts fresh.
    setMultiPhotoCropAreas((prev) => {
      if (!prev[index]) return prev;
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
    setMultiPhotoLiveCropAreas((prev) => {
      if (!prev[index]) return prev;
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
  }, []);

  const toggleTonosRotation = useCallback((index: MultiPhotoIndex) => {
    setTonosSlots((prev) => {
      const next: [TonosSlot, TonosSlot, TonosSlot] = [...prev];
      next[index] = { ...prev[index], rotation: nextRotation(prev[index].rotation) };
      return next;
    });
    // Rotation invalidates the previous crop area; clear and let cropper re-emit.
    setMultiPhotoCropAreas((prev) => {
      if (!prev[index]) return prev;
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
    setMultiPhotoLiveCropAreas((prev) => {
      if (!prev[index]) return prev;
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
  }, []);

  // UAT-1b: renamed from "advance from Tonos crop" to "advance from multi-
  // photo crop" because Save the Date 3-piece now uses the same multi-crop
  // step. Route to the next step in `stepSequence`, not hardcoded to
  // `preview`. STD-3 has `customize` between crop and preview (eventText
  // + date); Tonos has no text fields so its step sequence is
  // crop → preview directly. `goForward`-like math means both work
  // without category-specific branches.
  const advanceFromMultiCrop = useCallback(() => {
    setDirection(1);
    setCurrentStepId((current) => {
      const idx = stepSequence.indexOf(current);
      if (idx >= 0 && idx < stepSequence.length - 1) {
        return stepSequence[idx + 1];
      }
      return current;
    });
  }, [stepSequence]);

  // Phase 6.2 — Per-slot reset. Mirrors the single-image cropper's
  // `Restablecer` semantics for Tonos's 3-slot grid: clear fitMode +
  // rotation + crop areas for ONE slot only; leave the photo intact
  // and the OTHER two slots completely untouched.
  const handleMultiPhotoSlotReset = useCallback((index: MultiPhotoIndex) => {
    setTonosSlots((prev) => {
      const next: [TonosSlot, TonosSlot, TonosSlot] = [...prev];
      next[index] = { ...DEFAULT_TONOS_SLOT };
      return next;
    });
    setMultiPhotoCropAreas((prev) => {
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
    setMultiPhotoLiveCropAreas((prev) => {
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
    // Bump remount counter — forces TonosCropSlot for this index to
    // unmount + remount with fresh local crop/zoom/imageSize state and
    // cleared debounce timer. Without this, Reset on a slot already at
    // fill/0 wouldn't trigger the local effect (deps unchanged), and a
    // pending debounced onCropChange could fire AFTER Reset and
    // repopulate `liveCropAreas` with stale data.
    setMultiPhotoResetSeq((prev) => {
      const next: [number, number, number] = [...prev];
      next[index] = prev[index] + 1;
      return next;
    });
  }, []);

  // Phase 6.2 — Per-slot photo replace. Revokes the prior object URL,
  // swaps in the new file, and clears that slot's crop areas so the
  // cropper picks up the new photo cleanly. Same revoke-and-set pattern
  // as `handleMultiPhotoImageSelected` but also wipes downstream crop state
  // (which is stale once the image changes). Other slots untouched.
  const handleMultiPhotoSlotReplacePhoto = useCallback(
    (index: MultiPhotoIndex, file: File) => {
      const refs = multiPhotoFileRefs.current;
      refs[index] = file;
      const url = URL.createObjectURL(file);
      setMultiPhotoImageSrcs((prev) => {
        const next: [string | null, string | null, string | null] = [...prev];
        if (next[index]) URL.revokeObjectURL(next[index] as string);
        next[index] = url;
        return next;
      });
      // Clear stale crop areas — they were sized to the prior image.
      setMultiPhotoCropAreas((prev) => {
        const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
        next[index] = null;
        return next;
      });
      setMultiPhotoLiveCropAreas((prev) => {
        const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
        next[index] = null;
        return next;
      });
      // Force remount — local imageSize from the OLD image must NOT
      // be used to compute crop dimensions for the new one. Without
      // remount, a rapid replace could leave stale imageSize visible
      // until the new img.onload fires. (Codex Phase 6.2 audit MAJOR.)
      setMultiPhotoResetSeq((prev) => {
        const next: [number, number, number] = [...prev];
        next[index] = prev[index] + 1;
        return next;
      });
    },
    [],
  );

  // ─── Layout rotation ───
  const handleLayoutRotate = useCallback(() => {
    setLayoutRotated((prev) => !prev);
  }, []);

  // ─── Customization handlers ───
  const setCustomizationValue = useCallback((field: string, value: string) => {
    setCustomizationValues((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleCustomizeComplete = useCallback(() => {
    setDirection(1);
    setCurrentStepId('preview');
  }, []);

  // ─── Replace single image ───
  // Clears photo + crop state and navigates back to upload. Users invoke
  // this from the crop step's "Cambiar foto" toolbar button when they want
  // a different photo without unwinding the whole builder.
  const handleReplaceSingleImage = useCallback(() => {
    clearSingleImage();
    setDirection(-1);
    setCurrentStepId('upload');
  }, [clearSingleImage]);

  // ─── Reset ───
  const handleReset = useCallback(() => {
    clearSingleImage();
    clearTonos();
    setSelectedCategory(null);
    setSelectedGrid(null);
    setLayoutRotated(false);
    setCustomizationValues({});
    setStepSequence(DEFAULT_STEPS);
    setDirection(-1);
    setCurrentStepId('category');
  }, [clearSingleImage, clearTonos]);

  return {
    currentStepId,
    stepSequence,
    currentStepIndex,
    direction,
    goToStep,
    goBack,
    goForward,

    selectedCategory,
    handleCategorySelect,

    selectedGrid,
    gridConfig,
    handleGridSelect,

    imageSrc,
    imageFileRef,
    handleImageSelected,

    cropAreaPixels,
    liveCropArea,
    handleCropComplete,
    handleCropChange,

    multiPhoto,
    handleMultiPhotoImageSelected,
    handleMultiPhotoImagesSelected,
    handleMultiPhotoCropChange,
    handleMultiPhotoCropComplete,
    handleMultiPhotoSlotReset,
    handleMultiPhotoSlotReplacePhoto,
    advanceFromMultiCrop,

    tonosEffects,
    setTonosIntensity,
    setTonosFitMode,
    toggleTonosRotation,

    layoutRotated,
    canRotateLayout,
    handleLayoutRotate,

    customizationValues,
    setCustomizationValue,
    handleCustomizeComplete,

    isUploading,
    setIsUploading,
    addToCartError,
    setAddToCartError,

    handleReplaceSingleImage,

    handleReset,
  };
}
