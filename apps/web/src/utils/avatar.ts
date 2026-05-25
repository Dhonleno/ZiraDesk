const AV_CLASSES = ['av-pink', 'av-purple', 'av-green', 'av-rose', 'av-blue', 'av-amber'] as const;

export type AvatarClass = (typeof AV_CLASSES)[number];

export function avatarClass(seed: string): AvatarClass {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return AV_CLASSES[h % AV_CLASSES.length]!;
}
