/**
 * Cross-component signals for the personalizar builder. The top-nav
 * "Personalizar" link dispatches this event when clicked from inside
 * /personalizar so MagnetBuilder can reset its flow to step 1 — the URL
 * doesn't change in that case, so a normal Link navigation is a no-op.
 */
export const BUILDER_RESET_EVENT = 'builder:reset';
