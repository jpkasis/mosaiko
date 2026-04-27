import { useState, useCallback, useMemo, useRef } from 'react';
import { GRID_CONFIGS, getEffectiveGridConfig, type GridSize, type GridConfig } from '@/lib/grid-config';
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

export type TonosIndex = 0 | 1 | 2;

export interface TonosState {
  fileRefs: React.RefObject<[File | null, File | null, File | null]>;
  imageSrcs: [string | null, string | null, string | null];
  cropAreas: [CropArea | null, CropArea | null, CropArea | null];
  liveCropAreas: [CropArea | null, CropArea | null, CropArea | null];
  intensity: TonosIntensity;
  slots: TonosSlotConfigs;
  /**
   * Phase 6.2 (Codex audit fix) — per-slot remount counter. Bumped by
   * `handleTonosSlotReset` and `handleTonosSlotReplacePhoto` so the
   * cropper for that slot remounts with fresh local state (crop/zoom/
   * imageSize). Without this, a Reset on a slot already at fill/0
   * doesn't trigger the local crop/zoom effect (deps unchanged) AND a
   * pending debounced onCropChange could fire after Reset and
   * repopulate `liveCropAreas` with stale data. Remount via React
   * `key={resetSeq[i]}` clears all local state cleanly in one shot.
   */
  resetSeq: [number, number, number];
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

  // Tonos (multi-image)
  tonos: TonosState;
  handleTonosImageSelected: (index: TonosIndex, file: File) => void;
  handleTonosImagesSelected: (files: [File, File, File]) => void;
  handleTonosCropChange: (index: TonosIndex, cropAreaPixels: CropArea) => void;
  handleTonosCropComplete: (index: TonosIndex, cropAreaPixels: CropArea) => void;
  setTonosIntensity: (intensity: TonosIntensity) => void;
  setTonosFitMode: (index: TonosIndex, mode: TonosFitMode) => void;
  toggleTonosRotation: (index: TonosIndex) => void;
  /**
   * Phase 6.2 — Reset a single Tonos slot's cropper state to defaults
   * (fitMode='fill', rotation=0, crop areas cleared). Keeps the photo
   * intact. Mirrors the single-image cropper's `Restablecer` button.
   */
  handleTonosSlotReset: (index: TonosIndex) => void;
  /**
   * Phase 6.2 — Replace a single Tonos slot's photo. Revokes the prior
   * URL, swaps in the new file, and clears that slot's crop areas so
   * the cropper picks up the new photo cleanly. Other slots untouched.
   */
  handleTonosSlotReplacePhoto: (index: TonosIndex, file: File) => void;
  advanceFromTonosCrop: () => void;

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
  const tonosFileRefs = useRef<[File | null, File | null, File | null]>([null, null, null]);
  const [tonosImageSrcs, setTonosImageSrcs] = useState<[string | null, string | null, string | null]>(
    emptyTuple<string | null>(null),
  );
  const [tonosCropAreas, setTonosCropAreas] = useState<[CropArea | null, CropArea | null, CropArea | null]>(
    emptyTuple<CropArea | null>(null),
  );
  const [tonosLiveCropAreas, setTonosLiveCropAreas] = useState<[CropArea | null, CropArea | null, CropArea | null]>(
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
  const [tonosResetSeq, setTonosResetSeq] = useState<[number, number, number]>([0, 0, 0]);

  // ─── Layout rotation ───
  const [layoutRotated, setLayoutRotated] = useState(false);

  // ─── Customization ───
  const [customizationValues, setCustomizationValues] = useState<Record<string, string>>({});

  // ─── Upload ───
  const [isUploading, setIsUploading] = useState(false);
  const [addToCartError, setAddToCartError] = useState<string | null>(null);

  // ─── Stable Tonos view ───
  const tonos = useMemo<TonosState>(
    () => ({
      fileRefs: tonosFileRefs,
      imageSrcs: tonosImageSrcs,
      cropAreas: tonosCropAreas,
      liveCropAreas: tonosLiveCropAreas,
      intensity: tonosIntensity,
      slots: tonosSlots,
      resetSeq: tonosResetSeq,
    }),
    [tonosImageSrcs, tonosCropAreas, tonosLiveCropAreas, tonosIntensity, tonosSlots, tonosResetSeq],
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
    tonosImageSrcs.forEach((s) => { if (s) URL.revokeObjectURL(s); });
    tonosFileRefs.current = [null, null, null];
    setTonosImageSrcs(emptyTuple<string | null>(null));
    setTonosCropAreas(emptyTuple<CropArea | null>(null));
    setTonosLiveCropAreas(emptyTuple<CropArea | null>(null));
    setTonosIntensityState('medium');
    setTonosSlots([
      { ...DEFAULT_TONOS_SLOT },
      { ...DEFAULT_TONOS_SLOT },
      { ...DEFAULT_TONOS_SLOT },
    ]);
  }, [tonosImageSrcs]);

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
  const handleTonosImageSelected = useCallback((index: TonosIndex, file: File) => {
    const refs = tonosFileRefs.current;
    refs[index] = file;
    const url = URL.createObjectURL(file);
    setTonosImageSrcs((prev) => {
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
    setTonosCropAreas((p) => {
      if (p[index] === null) return p;
      const n: [CropArea | null, CropArea | null, CropArea | null] = [...p];
      n[index] = null;
      return n;
    });
    setTonosLiveCropAreas((p) => {
      if (p[index] === null) return p;
      const n: [CropArea | null, CropArea | null, CropArea | null] = [...p];
      n[index] = null;
      return n;
    });
    setTonosResetSeq((p) => {
      const n: [number, number, number] = [...p];
      n[index] = p[index] + 1;
      return n;
    });
  }, []);

  const handleTonosImagesSelected = useCallback((files: [File, File, File]) => {
    files.forEach((file, i) => handleTonosImageSelected(i as TonosIndex, file));
    setDirection(1);
    setCurrentStepId('crop');
  }, [handleTonosImageSelected]);

  const handleTonosCropChange = useCallback((index: TonosIndex, cropAreaPixels: CropArea) => {
    setTonosLiveCropAreas((prev) => {
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = cropAreaPixels;
      return next;
    });
  }, []);

  const handleTonosCropComplete = useCallback((index: TonosIndex, cropAreaPixels: CropArea) => {
    setTonosCropAreas((prev) => {
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = cropAreaPixels;
      return next;
    });
  }, []);

  const setTonosIntensity = useCallback((intensity: TonosIntensity) => {
    setTonosIntensityState(intensity);
  }, []);

  const setTonosFitMode = useCallback((index: TonosIndex, mode: TonosFitMode) => {
    setTonosSlots((prev) => {
      if (prev[index].fitMode === mode) return prev;
      const next: [TonosSlot, TonosSlot, TonosSlot] = [...prev];
      next[index] = { ...prev[index], fitMode: mode };
      return next;
    });
    // Reset that slot's crop area so the new mode starts fresh.
    setTonosCropAreas((prev) => {
      if (!prev[index]) return prev;
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
    setTonosLiveCropAreas((prev) => {
      if (!prev[index]) return prev;
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
  }, []);

  const toggleTonosRotation = useCallback((index: TonosIndex) => {
    setTonosSlots((prev) => {
      const next: [TonosSlot, TonosSlot, TonosSlot] = [...prev];
      next[index] = { ...prev[index], rotation: nextRotation(prev[index].rotation) };
      return next;
    });
    // Rotation invalidates the previous crop area; clear and let cropper re-emit.
    setTonosCropAreas((prev) => {
      if (!prev[index]) return prev;
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
    setTonosLiveCropAreas((prev) => {
      if (!prev[index]) return prev;
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
  }, []);

  const advanceFromTonosCrop = useCallback(() => {
    setDirection(1);
    setCurrentStepId('preview');
  }, []);

  // Phase 6.2 — Per-slot reset. Mirrors the single-image cropper's
  // `Restablecer` semantics for Tonos's 3-slot grid: clear fitMode +
  // rotation + crop areas for ONE slot only; leave the photo intact
  // and the OTHER two slots completely untouched.
  const handleTonosSlotReset = useCallback((index: TonosIndex) => {
    setTonosSlots((prev) => {
      const next: [TonosSlot, TonosSlot, TonosSlot] = [...prev];
      next[index] = { ...DEFAULT_TONOS_SLOT };
      return next;
    });
    setTonosCropAreas((prev) => {
      const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
      next[index] = null;
      return next;
    });
    setTonosLiveCropAreas((prev) => {
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
    setTonosResetSeq((prev) => {
      const next: [number, number, number] = [...prev];
      next[index] = prev[index] + 1;
      return next;
    });
  }, []);

  // Phase 6.2 — Per-slot photo replace. Revokes the prior object URL,
  // swaps in the new file, and clears that slot's crop areas so the
  // cropper picks up the new photo cleanly. Same revoke-and-set pattern
  // as `handleTonosImageSelected` but also wipes downstream crop state
  // (which is stale once the image changes). Other slots untouched.
  const handleTonosSlotReplacePhoto = useCallback(
    (index: TonosIndex, file: File) => {
      const refs = tonosFileRefs.current;
      refs[index] = file;
      const url = URL.createObjectURL(file);
      setTonosImageSrcs((prev) => {
        const next: [string | null, string | null, string | null] = [...prev];
        if (next[index]) URL.revokeObjectURL(next[index] as string);
        next[index] = url;
        return next;
      });
      // Clear stale crop areas — they were sized to the prior image.
      setTonosCropAreas((prev) => {
        const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
        next[index] = null;
        return next;
      });
      setTonosLiveCropAreas((prev) => {
        const next: [CropArea | null, CropArea | null, CropArea | null] = [...prev];
        next[index] = null;
        return next;
      });
      // Force remount — local imageSize from the OLD image must NOT
      // be used to compute crop dimensions for the new one. Without
      // remount, a rapid replace could leave stale imageSize visible
      // until the new img.onload fires. (Codex Phase 6.2 audit MAJOR.)
      setTonosResetSeq((prev) => {
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

    tonos,
    handleTonosImageSelected,
    handleTonosImagesSelected,
    handleTonosCropChange,
    handleTonosCropComplete,
    setTonosIntensity,
    setTonosFitMode,
    toggleTonosRotation,
    handleTonosSlotReset,
    handleTonosSlotReplacePhoto,
    advanceFromTonosCrop,

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
