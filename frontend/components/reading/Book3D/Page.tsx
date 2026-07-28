'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import {
  Bone,
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  MathUtils,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type Group,
  type Texture,
} from 'three';

import {
  EASING_FACTOR,
  EASING_FACTOR_FOLD,
  INSIDE_CURVE_STRENGTH,
  OUTSIDE_CURVE_STRENGTH,
  PAGE_DEPTH,
  PAGE_HEIGHT,
  PAGE_SEGMENTS,
  PAGE_WIDTH,
  SEGMENT_WIDTH,
  SPINE_BONES,
  TURNING_CURVE_STRENGTH,
  TURN_WINDOW_MS,
} from './constants';

/**
 * One shared geometry for every page in the book.
 *
 * This is the load-bearing optimisation: the vertex positions and skin weights
 * are identical for all pages, so they are computed once at module scope. Only
 * the skeleton is per-page, which is what lets each leaf bend independently
 * while costing one geometry upload total.
 */
const pageGeometry = new BoxGeometry(
  PAGE_WIDTH,
  PAGE_HEIGHT,
  PAGE_DEPTH,
  PAGE_SEGMENTS,
  2,
);

// Move the pivot to the spine edge so a page rotates about its binding rather
// than its centre.
pageGeometry.translate(PAGE_WIDTH / 2, 0, 0);

{
  // Weight every vertex between the two bones straddling its x position. The
  // fractional part within a segment is the blend, so the bend is continuous
  // across bone boundaries instead of hinging at each one.
  const position = pageGeometry.attributes.position;
  const vertex = new Vector3();
  const skinIndexes: number[] = [];
  const skinWeights: number[] = [];

  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    const x = vertex.x;
    const skinIndex = Math.max(0, Math.floor(x / SEGMENT_WIDTH));
    const skinWeight = (x % SEGMENT_WIDTH) / SEGMENT_WIDTH;

    skinIndexes.push(skinIndex, skinIndex + 1, 0, 0);
    skinWeights.push(1 - skinWeight, skinWeight, 0, 0);
  }

  pageGeometry.setAttribute('skinIndex', new Uint16BufferAttribute(skinIndexes, 4));
  pageGeometry.setAttribute('skinWeight', new Float32BufferAttribute(skinWeights, 4));
}

/** Paper edge colour — the thin visible border around each leaf. */
const EDGE_COLOR = new Color('#fdfbf7');
/** Spine edge sits in shadow. */
const SPINE_COLOR = new Color('#d8d2c6');

export type PageProps = {
  /** Index of this leaf within the book. */
  number: number;
  /** Whether this leaf has been turned past. */
  opened: boolean;
  /** True when the book is fully shut (front or back), so leaves lie flat. */
  bookClosed: boolean;
  /** Art for the recto (right-facing) side. Null renders blank paper. */
  front: Texture | null;
  /** Art for the verso (left-facing) side. */
  back: Texture | null;
  /** Total leaves, used to sit each page correctly in the stack. */
  pageCount: number;
  /** Current leaf, so the whole block shifts as the reader progresses. */
  currentPage: number;
};

/**
 * A single leaf of the book.
 *
 * The page is a SkinnedMesh driven by a chain of bones running along its width.
 * Rotating those bones by graduated amounts is what makes the paper *bend*
 * rather than rotate rigidly — a flat rotation reads as a sliding card, which
 * is exactly the failure mode of the previous 2D implementation.
 */
export function Page({
  number,
  opened,
  bookClosed,
  front,
  back,
  pageCount,
  currentPage,
}: PageProps) {
  const groupRef = useRef<Group>(null);
  const skinnedMeshRef = useRef<SkinnedMesh>(null);

  const turnedAt = useRef<number>(0);
  const lastOpened = useRef<boolean>(opened);

  // Six materials, one per box face. Indices 4 and 5 are the two page faces
  // that carry the art; the rest are paper edges.
  const materials = useMemo(
    () => [
      new MeshStandardMaterial({ color: EDGE_COLOR }),
      new MeshStandardMaterial({ color: SPINE_COLOR }),
      new MeshStandardMaterial({ color: EDGE_COLOR }),
      new MeshStandardMaterial({ color: EDGE_COLOR }),
      new MeshStandardMaterial({ color: EDGE_COLOR, roughness: 0.85 }),
      new MeshStandardMaterial({ color: EDGE_COLOR, roughness: 0.85 }),
    ],
    [],
  );

  // Swap textures in place rather than rebuilding materials, so a page whose
  // art arrives late (or is disposed as it leaves the window) does not force a
  // shader recompile mid-turn.
  useEffect(() => {
    const mat = materials[4] as MeshStandardMaterial;
    mat.map = front;
    mat.color.set(front ? '#ffffff' : EDGE_COLOR);
    mat.needsUpdate = true;
  }, [front, materials]);

  useEffect(() => {
    const mat = materials[5] as MeshStandardMaterial;
    mat.map = back;
    mat.color.set(back ? '#ffffff' : EDGE_COLOR);
    mat.needsUpdate = true;
  }, [back, materials]);

  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);

  const manualSkinnedMesh = useMemo(() => {
    const bones: Bone[] = [];
    for (let i = 0; i <= PAGE_SEGMENTS; i++) {
      const bone = new Bone();
      bones.push(bone);
      // Bone 0 sits at the spine; each subsequent bone is one segment further
      // out, parented to the previous so rotations accumulate along the page.
      bone.position.x = i === 0 ? 0 : SEGMENT_WIDTH;
      if (i > 0) bones[i - 1].add(bone);
    }

    const skeleton = new Skeleton(bones);
    const mesh = new SkinnedMesh(pageGeometry, materials);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned bounds are computed from the rest pose, so a bent page would be
    // culled while still on screen.
    mesh.frustumCulled = false;
    mesh.add(skeleton.bones[0]);
    mesh.bind(skeleton);
    return mesh;
  }, [materials]);

  useFrame((_, delta) => {
    const skinned = skinnedMeshRef.current;
    const group = groupRef.current;
    if (!skinned || !group) return;

    if (lastOpened.current !== opened) {
      turnedAt.current = performance.now();
      lastOpened.current = opened;
    }

    // A half-sine over the turn window: the flex swells as the page passes
    // through vertical and settles as it lands.
    const elapsed = Math.min(TURN_WINDOW_MS, performance.now() - turnedAt.current);
    const turningTime = Math.sin((elapsed / TURN_WINDOW_MS) * Math.PI);

    let targetRotation = opened ? -Math.PI / 2 : Math.PI / 2;
    if (!bookClosed) {
      // Fan the stack slightly so the closed side reads as many sheets rather
      // than one thick slab.
      targetRotation += MathUtils.degToRad(number * 0.8);
    }

    const bones = skinned.skeleton.bones;
    for (let i = 0; i < bones.length; i++) {
      // Bone 0's rotation is applied to the wrapping group instead, so the leaf
      // pivots at the spine rather than shearing from its first segment.
      const target = i === 0 ? group : bones[i];

      const insideCurveIntensity = i < SPINE_BONES ? Math.sin(i * 0.2 + 0.25) : 0;
      const outsideCurveIntensity = i >= SPINE_BONES ? Math.cos(i * 0.3 + 0.09) : 0;
      const turningIntensity =
        Math.sin(i * Math.PI * (1 / bones.length)) * turningTime;

      let rotationAngle =
        INSIDE_CURVE_STRENGTH * insideCurveIntensity * targetRotation -
        OUTSIDE_CURVE_STRENGTH * outsideCurveIntensity * targetRotation +
        TURNING_CURVE_STRENGTH * turningIntensity * targetRotation;

      let foldRotationAngle = MathUtils.degToRad(Math.sign(targetRotation) * 2);

      if (bookClosed) {
        // A shut book has no curve at all — every leaf lies flat and only the
        // outermost carries the rotation.
        if (i === 0) {
          rotationAngle = targetRotation;
          foldRotationAngle = 0;
        } else {
          rotationAngle = 0;
          foldRotationAngle = 0;
        }
      }

      easing.dampAngle(target.rotation, 'y', rotationAngle, EASING_FACTOR, delta);

      // A gentle corner fold across the outer half of the leaf, so the free
      // edge lifts as it travels.
      const foldIntensity =
        i > SPINE_BONES
          ? Math.sin(i * Math.PI * (1 / bones.length) - 0.5) * turningTime
          : 0;
      easing.dampAngle(
        target.rotation,
        'x',
        foldRotationAngle * foldIntensity,
        EASING_FACTOR_FOLD,
        delta,
      );
    }
  });

  return (
    <group ref={groupRef}>
      <primitive
        object={manualSkinnedMesh}
        ref={skinnedMeshRef}
        position-z={-number * PAGE_DEPTH + currentPage * PAGE_DEPTH}
      />
    </group>
  );
}

export { pageGeometry, PAGE_HEIGHT, PAGE_WIDTH, PAGE_DEPTH };
export type { Texture };
export const TOTAL_PAGE_THICKNESS = (count: number) => count * PAGE_DEPTH;
