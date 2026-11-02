# Vehicle showroom

The Motors phone app opens a full dealership panel while leaving the compact phone, garage and world simulation intact. The dealership is a client presentation layer over the existing server-authoritative lifestyle service; it does not maintain a second wallet, inventory or ownership store.

## Player flow

- Search by model/category, filter by category or ownership, and sort the five real catalog vehicles by price, speed or featured order.
- Inspect one vehicle at a time on a reflective display platform. Drag to orbit, use the wheel/pinch gesture to zoom, or choose the front/profile/rear camera presets. Headlights use the same vehicle rig as gameplay.
- Compare base-model top speed, acceleration, braking, steering coefficient, dry grip and seats. These values come from the handling catalog; paint and finish do not alter them.
- Choose any palette paint and gloss, metallic or matte clearcoat. The 3D material and authoritative total update together. Paint is included; metallic and matte cost the configured LRD surcharge.
- Purchase with a fresh request UUID, or select an already-owned vehicle. Confirmation includes the actual persisted plate and finish. Capacity, ownership, funds and selection are checked again by the server.

The interface includes loading, model-error/retry, empty-filter, insufficient-funds, full-garage, success and clear action-error states. Escape and Close release gameplay input and dispose the showroom renderer.

## Client architecture

- `src/client/showroom/dealership.ts` owns filters, selection, configuration, accessible DOM rendering and purchase/select actions.
- `src/client/showroom/showroom-scene.ts` owns the isolated Three.js studio, aspect-aware camera transitions, orbit controls, lighting, reflector and resource lifecycle. It consumes the same validated local graphics preferences as the district: quality-specific reflection/shadow resolutions and pixel ratio, bounded brightness, optional shadows, and reduced-motion camera/orbit behavior.
- `src/client/entities/vehicle-appearance.ts` is the shared physical-paint applicator for showroom and gameplay models.
- Existing `VehicleEntity`/`ModelLibrary` paths load only the selected detailed asset. Cached model templates may be reused; cloned instance resources and showroom-specific GPU resources are disposed on replacement/close.
- `src/shared/catalog.ts` is the canonical model, paint, finish and price source. `LifestyleService` recalculates the total inside its purchase transaction and ignores client-supplied prices.

The saved `paint_id`/`paint_finish` columns are nullable for backwards compatibility. Canonical appearance projection also supplies the gameplay color, so reconnects and garage selections restore the same finish. Migration `005_vehicle_request_configuration.sql` fingerprints pre-configuration purchase requests with their original default paint/gloss finish for replay safety.

## Assets and boundaries

The showroom reuses the repository's locally bundled CC0 Innerscene-derived hatchback/sedan/minibus assets and its original procedural modern sedan/SUV. No new asset or runtime package was introduced for this work. Existing attribution and hashes remain in `public/assets/CREDITS.md` and `public/assets/asset-manifest.json`.

The bundled models have exterior geometry only. There are no interior-camera, opening-door, engine-sound or unsupported performance-customization controls. The two original modern procedural vehicles remain stylized rather than photorealistic. Headless Chromium/WebGL interaction checks cover the integrated dealership flow, but hardware-GPU frame rates and broad device/browser coverage have not been measured.

## Verification

Run `npm run typecheck`, `npm test`, `npm run build` and, against the development server, `npm run smoke`. Focused tests cover pricing, validation, physical material changes, configured purchase/replay/funds behavior and API transport. Browser verification additionally covers model/search/filter controls, live appearance, camera/headlight controls, real purchase, garage configuration/selection and desktop/mobile overflow.
