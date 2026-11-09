// Plain binary Merkle tree. There are NO sums in the tree: an inner node is only a hash, so a
// sibling hash in a proof reveals nothing about a neighbour's pay.
//
//   node = SHA-256( "PSP/v1/node" 0x00 || left[32] || right[32] )
//
// Odd node at the end of a level: it is promoted unchanged to the next level (RFC 6962 style).
// It is never duplicated, which avoids the known "duplicate last leaf" collision of Bitcoin-style trees.
// The run builder always pads to a power of two, so promotion only matters for third-party trees.
import { fromHex, toHex, bytesEqual } from './bytes.js';
import { sha256 } from './hash.js';
import { LABEL_NODE } from './encoding.js';

export async function nodeHash(left, right) {
  return sha256(LABEL_NODE, left, right);
}

export async function buildTree(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) throw new RangeError('a tree needs at least one leaf');
  const levels = [leaves];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? await nodeHash(prev[i], prev[i + 1]) : prev[i]);
    }
    levels.push(next);
  }
  return { levels, root: levels[levels.length - 1][0] };
}

/** Sibling path for leaf `index`: [{ side, hash }], side = where the sibling sits ('left' | 'right'). */
export function proofFor(levels, index) {
  const proof = [];
  let i = index;
  for (let depth = 0; depth < levels.length - 1; depth++) {
    const sib = i ^ 1;
    if (sib < levels[depth].length) {
      proof.push({ side: i % 2 === 0 ? 'right' : 'left', hash: toHex(levels[depth][sib]) });
    }
    i >>= 1;
  }
  return proof;
}

export async function rootFromProof(leaf, proof) {
  let h = leaf;
  for (const step of proof) {
    if (!step || (step.side !== 'left' && step.side !== 'right')) throw new TypeError('bad proof step');
    const sib = fromHex(step.hash, 32);
    h = step.side === 'left' ? await nodeHash(sib, h) : await nodeHash(h, sib);
  }
  return h;
}

export async function verifyProof(leaf, proof, root) {
  return bytesEqual(await rootFromProof(leaf, proof), root);
}
